import type { JsonRpcProvider } from 'ethers';

import type { Disposable, RequestFeeCapPolicy } from '../../../model/ethereum';
import type { IBroadcastStrategy } from '../../../ports/broadcast-strategy.interface';
import type { ISigner } from '../../../ports/signer.interface';
import { BeaconService } from '../../infrastructure/beacon-service';
import { ParallelBroadcastStrategy } from './broadcast-strategy/parallel-broadcast-strategy';
import { SequentialBroadcastStrategy } from './broadcast-strategy/sequential-broadcast-strategy';
import { EthereumStateService } from './ethereum-state-service';
import { RequestFeeCapService } from './request-fee-cap-service';
import { TransactionBatchOrchestrator } from './transaction-batch-orchestrator';
import { TransactionBroadcaster } from './transaction-broadcaster';
import { TransactionMonitor } from './transaction-monitor';
import { TransactionPipeline } from './transaction-pipeline';
import { TransactionProgressLogger } from './transaction-progress-logger';
import { TransactionReplacer } from './transaction-replacer';

/**
 * Create a fully-wired TransactionPipeline with all dependencies
 *
 * Constructs the dependency graph: EthereumStateService, broadcast strategy selection,
 * TransactionBroadcaster, TransactionMonitor, TransactionReplacer, and orchestrator.
 * Returns a pipeline that owns both the orchestrator and all disposable resources.
 *
 * @param systemContractAddress - System contract address for execution layer requests
 * @param jsonRpcProvider - JSON-RPC provider for blockchain interaction
 * @param signer - Signer for transaction signing (wallet or Ledger)
 * @param beaconApiUrl - Beacon API URL for slot-aware broadcasting (required for Ledger)
 * @param requestFeeCapPolicy - Optional request-fee cap policy
 * @param initialApprovedRequestFee - Optional approved request fee for the first batch
 * @returns Pipeline ready to send execution layer requests and dispose resources
 */
export async function createTransactionPipeline(
  systemContractAddress: string,
  jsonRpcProvider: JsonRpcProvider,
  signer: ISigner,
  beaconApiUrl: string,
  requestFeeCapPolicy?: RequestFeeCapPolicy,
  initialApprovedRequestFee?: bigint
): Promise<TransactionPipeline> {
  const ethereumStateService = new EthereumStateService(jsonRpcProvider, systemContractAddress);
  const logger = new TransactionProgressLogger();
  const disposables: Disposable[] = [];
  const requestFeeCapService = requestFeeCapPolicy
    ? new RequestFeeCapService(ethereumStateService)
    : undefined;

  const broadcastStrategy = await createBroadcastStrategy(
    signer,
    ethereumStateService,
    systemContractAddress,
    beaconApiUrl,
    logger,
    requestFeeCapPolicy,
    requestFeeCapService
  );
  disposables.push(broadcastStrategy);

  const transactionBroadcaster = new TransactionBroadcaster(
    signer,
    systemContractAddress,
    ethereumStateService,
    logger,
    broadcastStrategy
  );

  const transactionMonitor = new TransactionMonitor(jsonRpcProvider);

  const transactionReplacer = new TransactionReplacer(
    signer,
    ethereumStateService,
    systemContractAddress,
    transactionMonitor,
    logger
  );

  const orchestrator = new TransactionBatchOrchestrator(
    ethereumStateService,
    transactionBroadcaster,
    transactionMonitor,
    transactionReplacer,
    logger,
    requestFeeCapPolicy,
    requestFeeCapService,
    initialApprovedRequestFee
  );

  return new TransactionPipeline(orchestrator, disposables);
}

/**
 * Select and create the appropriate broadcast strategy based on signer capabilities
 *
 * @param signer - Signer to check capabilities
 * @param ethereumStateService - Service for fetching contract fees (sequential only)
 * @param systemContractAddress - Target contract address (sequential only)
 * @param beaconApiUrl - Beacon API URL for slot timing (sequential only)
 * @param logger - Logger for transaction progress
 * @param requestFeeCapPolicy - Optional request-fee cap policy
 * @param requestFeeCapService - Optional cap enforcement service
 * @returns Configured broadcast strategy
 */
async function createBroadcastStrategy(
  signer: ISigner,
  ethereumStateService: EthereumStateService,
  systemContractAddress: string,
  beaconApiUrl: string,
  logger: TransactionProgressLogger,
  requestFeeCapPolicy?: RequestFeeCapPolicy,
  requestFeeCapService?: RequestFeeCapService
): Promise<IBroadcastStrategy> {
  if (signer.capabilities.supportsParallelSigning) {
    return new ParallelBroadcastStrategy(logger);
  }

  const beaconService = await BeaconService.create(beaconApiUrl);
  return new SequentialBroadcastStrategy(
    ethereumStateService,
    systemContractAddress,
    beaconService,
    logger,
    requestFeeCapPolicy,
    requestFeeCapService
  );
}
