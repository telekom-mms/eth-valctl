import chalk from 'chalk';
import { formatEther, type JsonRpcProvider } from 'ethers';

import * as application from '../../constants/application';
import { INSUFFICIENT_BALANCE_ERROR, SAFE_FEE_TIP_INFO } from '../../constants/logging';
import type { GlobalCliOptions } from '../../model/commander';
import type {
  NetworkConfig,
  RequestFeeCapCheckContext,
  RequestFeeCapPolicy,
  RequestFeeCapRuntime
} from '../../model/ethereum';
import { networkConfig } from '../../network-config';
import { createEthereumConnection } from './ethereum';
import { EthereumStateService } from './request/ethereum-state-service';
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
      requestData,
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
    const safeFeeTip = BigInt(globalOptions.safeFeeTip ?? String(application.DEFAULT_SAFE_FEE_TIP));
    const proposalFee = contractFee + safeFeeTip;

    if (safeFeeTip > 0n) {
      console.error(chalk.blue(SAFE_FEE_TIP_INFO(contractFee, safeFeeTip, proposalFee)));
    }

    await exitOnInsufficientBalance(
      safeInitResult.provider,
      { address: safeAddress, label: application.OWNER_LABEL_SAFE },
      BigInt(requestData.length) *
        (feeUpperBound(contractFee, globalOptions.maxRequestFee) + safeFeeTip)
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
 * The estimate accounts for fees rising during a multi-batch run: the request fee is bounded by
 * the request fee cap (which no request exceeds without approval) and the gas cost includes the
 * replacement fee bump as margin.
 *
 * @param provider - JSON-RPC provider
 * @param signerAddress - Address of the signer paying fees and gas
 * @param requests - Target system contract, encoded calldata of all requests and request fee cap
 */
async function checkSignerBalance(
  provider: JsonRpcProvider,
  signerAddress: string,
  requests: { contractAddress: string; requestData: string[]; maxRequestFee?: bigint }
): Promise<void> {
  const stateService = new EthereumStateService(provider, requests.contractAddress);
  const [contractFee, networkFees] = await Promise.all([
    stateService.fetchContractFee(),
    stateService.getMaxNetworkFees()
  ]);
  const gasPerRequest = await provider.estimateGas({
    from: signerAddress,
    to: requests.contractAddress,
    data: requests.requestData[0],
    value: contractFee
  });
  const gasCostPerRequest =
    (gasPerRequest * networkFees.maxFeePerGas * application.TRANSACTION_FEE_INCREASE_PERCENTAGE) /
    application.PERCENTAGE_DENOMINATOR;
  const costPerRequest = feeUpperBound(contractFee, requests.maxRequestFee) + gasCostPerRequest;

  await exitOnInsufficientBalance(
    provider,
    { address: signerAddress, label: application.OWNER_LABEL_SIGNER },
    BigInt(requests.requestData.length) * costPerRequest
  );
}

/**
 * Terminate the process if the balance of an account is below the required amount
 *
 * @param provider - JSON-RPC provider
 * @param account - Address and label (e.g. 'signer' or 'Safe') of the paying account
 * @param requiredWei - Required balance in wei
 */
async function exitOnInsufficientBalance(
  provider: JsonRpcProvider,
  account: { address: string; label: string },
  requiredWei: bigint
): Promise<void> {
  const balance = await provider.getBalance(account.address);
  if (balance < requiredWei) {
    console.error(
      chalk.red(
        INSUFFICIENT_BALANCE_ERROR(
          account.label,
          account.address,
          formatEther(balance),
          formatEther(requiredWei)
        )
      )
    );
    process.exit(1);
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
