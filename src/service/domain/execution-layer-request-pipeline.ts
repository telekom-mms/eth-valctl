import chalk from 'chalk';

import { DEFAULT_SAFE_FEE_TIP, OWNER_LABEL_SAFE } from '../../constants/application';
import { SAFE_FEE_TIP_INFO } from '../../constants/logging';
import type { GlobalCliOptions } from '../../model/commander';
import type { NetworkConfig } from '../../model/ethereum';
import { networkConfig } from '../../network-config';
import { createEthereumConnection } from './ethereum';
import { EthereumStateService } from './request/ethereum-state-service';
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

  if (validate) {
    await validate(ethereumConnection.signer.address);
  }

  await sendExecutionLayerRequests(
    contractAddress,
    ethereumConnection.provider,
    ethereumConnection.signer,
    requestData,
    globalOptions.maxRequestsPerBlock,
    globalOptions.beaconApiUrl
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
      await validate(safeAddress, OWNER_LABEL_SAFE);
    }

    const stateService = new EthereumStateService(safeInitResult.provider, contractAddress);
    const contractFee = await stateService.fetchContractFee();
    const safeFeeTip = BigInt(globalOptions.safeFeeTip ?? String(DEFAULT_SAFE_FEE_TIP));
    const proposalFee = contractFee + safeFeeTip;

    if (safeFeeTip > 0n) {
      console.error(chalk.blue(SAFE_FEE_TIP_INFO(contractFee, safeFeeTip, proposalFee)));
    }

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
