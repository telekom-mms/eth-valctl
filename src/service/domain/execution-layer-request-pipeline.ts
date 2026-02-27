import type { GlobalCliOptions } from '../../model/commander';
import type { EthereumConnection, NetworkConfig } from '../../model/ethereum';
import { networkConfig } from '../../network-config';
import { createEthereumConnection } from './ethereum';
import { sendExecutionLayerRequests } from './request/send-request';

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
  /** Optional pre-request validation run after connection is established */
  validate?: (connection: EthereumConnection) => Promise<void>;
}

/**
 * Execute a generic execution layer request pipeline
 *
 * Shared orchestration for consolidation and withdrawal operations:
 * 1. Determine signer type from global options
 * 2. Create Ethereum connection
 * 3. Run optional pre-request validation
 * 4. Encode request data for each validator
 * 5. Resolve target contract address
 * 6. Send execution layer requests
 *
 * @param config - Pipeline configuration with operation-specific callbacks
 */
export async function executeRequestPipeline(config: PipelineConfig): Promise<void> {
  const {
    globalOptions,
    validatorPubkeys,
    encodeRequestData,
    resolveContractAddress,
    validate
  } = config;

  const signerType = globalOptions.ledger ? 'ledger' : 'wallet';
  const ethereumConnection = await createEthereumConnection(globalOptions.jsonRpcUrl, signerType);

  if (validate) {
    await validate(ethereumConnection);
  }

  const requestData = validatorPubkeys.map(encodeRequestData);
  const contractAddress = resolveContractAddress(networkConfig[globalOptions.network]!);

  await sendExecutionLayerRequests(
    contractAddress,
    ethereumConnection.provider,
    ethereumConnection.signer,
    requestData,
    globalOptions.maxRequestsPerBlock,
    globalOptions.beaconApiUrl
  );
}
