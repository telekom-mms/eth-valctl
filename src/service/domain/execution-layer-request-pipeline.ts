import chalk from 'chalk';
import { formatEther, type JsonRpcProvider } from 'ethers';
import prompts from 'prompts';

import * as application from '../../constants/application';
import * as logging from '../../constants/logging';
import type { GlobalCliOptions } from '../../model/commander';
import type {
  DepositData,
  NetworkConfig,
  RequestBalanceCheck,
  RequestFeeCapCheckContext,
  RequestFeeCapPolicy,
  RequestFeeCapRuntime
} from '../../model/ethereum';
import { networkConfig } from '../../network-config';
import { encodeDepositCalldata } from './deposit-contract';
import { createEthereumConnection } from './ethereum';
import { extractAddressFromCredentials, getCredentialsTypePrefix } from './pre-request-validation';
import {
  DepositContractStateService,
  EthereumStateService,
  fetchMaxNetworkFees
} from './request/ethereum-state-service';
import { RequestFeeCapService } from './request/request-fee-cap-service';
import { createRequestFeeCapPolicy } from './request/request-fee-policy';
import { sendExecutionLayerRequests } from './request/send-request';
import { initializeSafe } from './safe/safe-init';
import { proposeSafeTransactions } from './safe/safe-propose-service';

/**
 * Encoder that transforms a validator public key into request calldata
 */
type RequestDataEncoder = (validatorPubkey: string) => string;

/**
 * Resolver that extracts the target contract address from network configuration
 */
type ContractAddressResolver = (config: NetworkConfig) => string;

/**
 * Configuration for an execution layer request pipeline run
 */
interface PipelineConfig {
  /** Global CLI options (network, RPC URLs, batch size, signer type) */
  globalOptions: GlobalCliOptions;
  /** Validator public keys to process */
  validatorPubkeys: string[];
  /** Encodes a single validator public key into request calldata */
  encodeRequestData: RequestDataEncoder;
  /** Extracts the target system contract address from network configuration */
  resolveContractAddress: ContractAddressResolver;
  /** Optional pre-request validation using the owner address for ownership checks */
  validate?: (ownerAddress: string, ownerLabel?: string) => Promise<void>;
}

/**
 * Execute a generic execution layer request pipeline
 *
 * Shared orchestration for consolidation and withdrawal operations:
 * 1. Encode request data for each validator
 * 2. Resolve target contract address
 * 3. Branch on Safe vs direct path (each creates its own signer)
 * 4. Run optional pre-request validation with signer address
 * 5. Send execution layer requests (direct broadcast or Safe proposal)
 *
 * @param config - Pipeline configuration with operation-specific callbacks
 */
export async function executeRequestPipeline(config: PipelineConfig): Promise<void> {
  const requestData = config.validatorPubkeys.map(config.encodeRequestData);
  const netConfig = networkConfig[config.globalOptions.network]!;
  const contractAddress = config.resolveContractAddress(netConfig);

  if (config.globalOptions.safe) {
    await executeSafePipeline(
      config.globalOptions,
      netConfig,
      contractAddress,
      requestData,
      config.validatorPubkeys,
      config.validate
    );
    return;
  }

  await executeDirectPipeline(config.globalOptions, contractAddress, requestData, config.validate);
}

/**
 * Execute the deposit pipeline (direct path only)
 *
 * Sends one deposit contract call per deposit with the deposit amount as transaction value.
 * Unlike {@link executeRequestPipeline} there is no request fee and no request-fee cap: the
 * per-request value comes from {@link DepositContractStateService}, so the deposit contract
 * storage is never read as a fee.
 *
 * @param globalOptions - CLI options including network, RPC URL, ledger flag, batch size
 * @param deposits - Validated deposits which share one amount
 */
export async function executeDepositPipeline(
  globalOptions: GlobalCliOptions,
  deposits: DepositData[]
): Promise<void> {
  const depositContractAddress = networkConfig[globalOptions.network]!.deposit!.contractAddress;
  const depositWei = sharedDepositWei(deposits);
  const signerType = globalOptions.ledger ? 'ledger' : 'wallet';
  const ethereumConnection = await createEthereumConnection(globalOptions.jsonRpcUrl, signerType);
  const signerAddress = ethereumConnection.signer.address;

  try {
    const { maxFeePerGas } = await fetchMaxNetworkFees(ethereumConnection.provider);
    await exitOnInsufficientSignerBalance(
      ethereumConnection.provider,
      signerAddress,
      BigInt(deposits.length) * (depositWei + gasCostPerRequest(maxFeePerGas))
    );
    if (!(await confirmDeposits(globalOptions, signerAddress, deposits))) {
      console.log(logging.DEPOSIT_DECLINED_INFO);
      await ethereumConnection.signer.dispose();
      return;
    }
  } catch (error) {
    await ethereumConnection.signer.dispose();
    throw error;
  }

  await sendExecutionLayerRequests(
    depositContractAddress,
    ethereumConnection.provider,
    ethereumConnection.signer,
    deposits.map(encodeDepositCalldata),
    globalOptions.maxRequestsPerBlock,
    globalOptions.beaconApiUrl,
    undefined,
    new DepositContractStateService(ethereumConnection.provider, depositContractAddress, depositWei)
  );
}

/**
 * Print the deposit summary and ask for confirmation
 *
 * @param globalOptions - CLI options with network and `--yes` flag
 * @param signerAddress - Address paying the deposits
 * @param deposits - Deposits to send (one shared amount)
 * @returns True if the deposits should be sent
 */
async function confirmDeposits(
  globalOptions: GlobalCliOptions,
  signerAddress: string,
  deposits: DepositData[]
): Promise<boolean> {
  const depositWei = sharedDepositWei(deposits);
  const amountEth = formatEther(depositWei);
  const totalEth = formatEther(BigInt(deposits.length) * depositWei);
  const withdrawalCounts = new Map<string, number>();
  for (const { withdrawalCredentials } of deposits) {
    withdrawalCounts.set(
      withdrawalCredentials,
      (withdrawalCounts.get(withdrawalCredentials) ?? 0) + 1
    );
  }

  console.log(chalk.bold(logging.DEPOSIT_SUMMARY_HEADER(globalOptions.network)));
  console.log(
    logging.DEPOSIT_SUMMARY_CONTRACT(networkConfig[globalOptions.network]!.deposit!.contractAddress)
  );
  console.log(logging.DEPOSIT_SUMMARY_SIGNER(signerAddress));
  console.log(logging.DEPOSIT_SUMMARY_DEPOSITS(deposits.length, amountEth, totalEth));
  for (const [credentials, count] of withdrawalCounts) {
    console.log(
      logging.DEPOSIT_SUMMARY_WITHDRAWAL(
        getCredentialsTypePrefix(credentials),
        extractAddressFromCredentials(credentials),
        count
      )
    );
  }

  if (globalOptions.yes) {
    return true;
  }
  const { confirmed } = await prompts({
    type: 'confirm',
    name: 'confirmed',
    message: logging.DEPOSIT_CONFIRM_PROMPT(deposits.length, totalEth),
    initial: false
  });
  return confirmed === true;
}

/**
 * Deposit amount in wei shared by all deposits of a run
 *
 * @param deposits - Deposits with one shared amount
 * @returns Deposit amount in wei
 */
function sharedDepositWei(deposits: DepositData[]): bigint {
  return deposits[0]!.amountGwei * application.WEI_PER_GWEI;
}

/**
 * Execute the direct broadcast pipeline branch
 *
 * Creates an Ethereum connection (prompting for private key or Ledger),
 * runs optional validation, and broadcasts transactions directly.
 *
 * @param globalOptions - CLI options including RPC URL, ledger flag, batch size
 * @param contractAddress - Target system contract address
 * @param requestData - Encoded calldata for each validator
 * @param validate - Optional pre-request validation callback
 */
async function executeDirectPipeline(
  globalOptions: GlobalCliOptions,
  contractAddress: string,
  requestData: string[],
  validate?: (ownerAddress: string, ownerLabel?: string) => Promise<void>
): Promise<void> {
  const signerType = globalOptions.ledger ? 'ledger' : 'wallet';
  const ethereumConnection = await createEthereumConnection(globalOptions.jsonRpcUrl, signerType);

  let requestFeeCapRuntime: RequestFeeCapRuntime | undefined;
  try {
    if (validate) {
      await validate(ethereumConnection.signer.address);
    }
    await checkSignerBalance(ethereumConnection.provider, ethereumConnection.signer.address, {
      contractAddress,
      requestCount: requestData.length,
      maxRequestFee: globalOptions.maxRequestFee
    });

    const requestFeeCapPolicy = createRequestFeeCapPolicy(globalOptions);
    requestFeeCapRuntime = requestFeeCapPolicy
      ? await createRequestFeeCapRuntime(
          ethereumConnection.provider,
          contractAddress,
          requestFeeCapPolicy,
          {
            operation: application.FEE_CAP_OPERATION_BATCH,
            requestCount: Math.min(requestData.length, globalOptions.maxRequestsPerBlock)
          }
        )
      : undefined;
  } catch (error) {
    await ethereumConnection.signer.dispose();
    throw error;
  }

  await sendExecutionLayerRequests(
    contractAddress,
    ethereumConnection.provider,
    ethereumConnection.signer,
    requestData,
    globalOptions.maxRequestsPerBlock,
    globalOptions.beaconApiUrl,
    requestFeeCapRuntime
  );
}

/**
 * Execute the Safe proposal pipeline branch
 *
 * Initializes Safe SDK instances via shared preflight, runs optional
 * validation, fetches the contract fee, and proposes batched MultiSend
 * transactions to the Safe Transaction Service.
 *
 * @param globalOptions - CLI options including safe address, network, ledger flag
 * @param netConfig - Network configuration with TX Service URL and chain ID
 * @param contractAddress - Target system contract address
 * @param requestData - Encoded calldata for each validator
 * @param validatorPubkeys - Validator public keys (for failure output)
 * @param validate - Optional pre-request validation callback
 */
async function executeSafePipeline(
  globalOptions: GlobalCliOptions,
  netConfig: NetworkConfig,
  contractAddress: string,
  requestData: string[],
  validatorPubkeys: string[],
  validate?: (ownerAddress: string, ownerLabel?: string) => Promise<void>
): Promise<void> {
  const safeAddress = globalOptions.safe!;
  const safeInitResult = await initializeSafe(globalOptions, netConfig, safeAddress);

  try {
    if (validate) {
      await validate(safeAddress, application.OWNER_LABEL_SAFE);
    }

    const stateService = new EthereumStateService(safeInitResult.provider, contractAddress);
    const requestFeeCapPolicy = createRequestFeeCapPolicy(globalOptions);
    const contractFee = requestFeeCapPolicy
      ? await new RequestFeeCapService(stateService).resolveRequestFee(requestFeeCapPolicy, {
          operation: application.FEE_CAP_OPERATION_SAFE_PROPOSAL,
          requestCount: requestData.length
        })
      : await stateService.fetchContractFee();
    const safeFeeTip = globalOptions.safeFeeTip ?? application.DEFAULT_SAFE_FEE_TIP;
    const proposalFee = contractFee + safeFeeTip;

    if (safeFeeTip > 0n) {
      console.error(chalk.blue(logging.SAFE_FEE_TIP_INFO(contractFee, safeFeeTip, proposalFee)));
    }

    await warnOnLowSafeBalance(
      safeInitResult.provider,
      safeAddress,
      BigInt(requestData.length) * proposalFee
    );

    await proposeSafeTransactions({
      apiKit: safeInitResult.apiKit,
      protocolKit: safeInitResult.protocolKit,
      safeAddress,
      senderAddress: safeInitResult.signerAddress,
      contractAddress,
      requestData,
      contractFee: proposalFee,
      maxRequestsPerBatch: globalOptions.maxRequestsPerBlock,
      validatorPubkeys,
      threshold: safeInitResult.safeInfo.threshold
    });
  } finally {
    await safeInitResult.dispose();
  }
}

/**
 * Create request-fee cap runtime and pre-approve the first operation boundary.
 *
 * @param provider - JSON-RPC provider for request fee reads
 * @param contractAddress - System contract address
 * @param policy - Request-fee cap policy
 * @param context - Initial operation boundary to approve
 * @returns Request-fee cap runtime shared by the direct request pipeline
 */
async function createRequestFeeCapRuntime(
  provider: JsonRpcProvider,
  contractAddress: string,
  policy: RequestFeeCapPolicy,
  context: RequestFeeCapCheckContext
): Promise<RequestFeeCapRuntime> {
  const stateService = new EthereumStateService(provider, contractAddress);
  const resolver = new RequestFeeCapService(stateService);
  const initialApprovedRequestFee = await resolver.resolveRequestFee(policy, context);

  return { policy, resolver, initialApprovedRequestFee };
}

/**
 * Check that the signer can pay the request fees and gas of all requests
 *
 * The request fee is bounded by the request fee cap (which no request exceeds without approval).
 * Gas is priced at the fixed transaction gas limit, which nodes reserve up front, and includes the
 * fee bump of one replacement transaction.
 *
 * @param provider - JSON-RPC provider
 * @param signerAddress - Address of the signer paying fees and gas
 * @param check - Target system contract, number of requests and request fee cap
 */
async function checkSignerBalance(
  provider: JsonRpcProvider,
  signerAddress: string,
  check: RequestBalanceCheck
): Promise<void> {
  const stateService = new EthereumStateService(provider, check.contractAddress);
  const [contractFee, networkFees] = await Promise.all([
    stateService.fetchContractFee(),
    stateService.getMaxNetworkFees()
  ]);
  const costPerRequest =
    feeUpperBound(contractFee, check.maxRequestFee) + gasCostPerRequest(networkFees.maxFeePerGas);

  await exitOnInsufficientSignerBalance(
    provider,
    signerAddress,
    BigInt(check.requestCount) * costPerRequest
  );
}

/**
 * Gas cost of one request at the fixed transaction gas limit, including the fee bump of one
 * replacement transaction
 *
 * @param maxFeePerGas - Current max fee per gas in wei
 * @returns Gas cost in wei
 */
function gasCostPerRequest(maxFeePerGas: bigint): bigint {
  return (
    (maxFeePerGas *
      application.TRANSACTION_GAS_LIMIT *
      application.TRANSACTION_FEE_INCREASE_PERCENTAGE) /
    application.PERCENTAGE_DENOMINATOR
  );
}

/**
 * Terminate the process if the signer cannot pay the required amount
 *
 * @param provider - JSON-RPC provider
 * @param signerAddress - Address of the signer
 * @param requiredWei - Total wei required for all requests
 */
async function exitOnInsufficientSignerBalance(
  provider: JsonRpcProvider,
  signerAddress: string,
  requiredWei: bigint
): Promise<void> {
  const balance = await provider.getBalance(signerAddress);
  if (balance < requiredWei) {
    console.error(
      chalk.red(
        logging.INSUFFICIENT_BALANCE_ERROR(
          application.OWNER_LABEL_SIGNER,
          signerAddress,
          formatEther(balance),
          formatEther(requiredWei)
        )
      )
    );
    process.exit(1);
  }
}

/**
 * Warn if the Safe balance is below the amount needed to execute the proposals
 *
 * ETH only leaves the Safe at `safe execute`, where the balance is checked again. At proposal
 * time a low balance is only a warning, so the Safe can still be funded before execution.
 *
 * @param provider - JSON-RPC provider
 * @param safeAddress - Safe multisig address
 * @param requiredWei - Total proposed value in wei of all proposals
 */
async function warnOnLowSafeBalance(
  provider: JsonRpcProvider,
  safeAddress: string,
  requiredWei: bigint
): Promise<void> {
  const balance = await provider.getBalance(safeAddress);
  if (balance < requiredWei) {
    console.error(
      chalk.yellow(
        logging.SAFE_BALANCE_LOW_AT_PROPOSAL_WARNING(
          safeAddress,
          formatEther(balance),
          formatEther(requiredWei)
        )
      )
    );
  }
}

/**
 * Return the larger of a fee and an optional fee cap
 *
 * @param fee - The current fee
 * @param cap - Optional fee cap
 * @returns The larger value, or the fee when no cap is set
 */
function feeUpperBound(fee: bigint, cap?: bigint): bigint {
  return cap !== undefined && cap > fee ? cap : fee;
}
