import type { JsonRpcProvider } from 'ethers';

import type { Disposable, RequestFeeCapRuntime } from '../../../model/ethereum';
import type { IBroadcastStrategy } from '../../../ports/broadcast-strategy.interface';
import type { ISigner } from '../../../ports/signer.interface';
import { BeaconService } from '../../infrastructure/beacon-service';
import { ParallelBroadcastStrategy } from './broadcast-strategy/parallel-broadcast-strategy';
import { SequentialBroadcastStrategy } from './broadcast-strategy/sequential-broadcast-strategy';
import { EthereumStateService } from './ethereum-state-service';
import { TransactionBatchOrchestrator } from './transaction-batch-orchestrator';
import { TransactionBroadcaster } from './transaction-broadcaster';
import { TransactionMonitor } from './transaction-monitor';
import { TransactionPipeline } from './transaction-pipeline';
import { TransactionProgressLogger } from './transaction-progress-logger';
import { TransactionReplacer } from './transaction-replacer';

/**
 * Create a fully-wired TransactionPipeline with all dependencies
 *
 * Constructs the dependency graph: broadcast strategy selection, TransactionBroadcaster,
 * TransactionMonitor, TransactionReplacer, and orchestrator. The state service is injectable and
 * defaults to an EthereumStateService reading the system contract fee.
 * Returns a pipeline that owns both the orchestrator and all disposable resources.
 *
 * @param systemContractAddress - Target contract address (system contract or deposit contract)
 * @param jsonRpcProvider - JSON-RPC provider for blockchain interaction
 * @param signer - Signer for transaction signing (wallet or Ledger)
 * @param beaconApiUrl - Beacon API URL for slot-aware broadcasting (required for Ledger)
 * @param requestFeeCapRuntime - Optional request-fee cap runtime dependencies
 * @param ethereumStateService - State service providing the per-request value (defaults to the system contract fee)
 * @returns Pipeline ready to send execution layer requests and dispose resources
 */
export async function createTransactionPipeline(
  systemContractAddress: string,
  jsonRpcProvider: JsonRpcProvider,
  signer: ISigner,
  beaconApiUrl: string,
  requestFeeCapRuntime?: RequestFeeCapRuntime,
  ethereumStateService = new EthereumStateService(jsonRpcProvider, systemContractAddress)
): Promise<TransactionPipeline> {
  const logger = new TransactionProgressLogger();
  const disposables: Disposable[] = [];

  const broadcastStrategy = await createBroadcastStrategy(
    signer,
    ethereumStateService,
    systemContractAddress,
    beaconApiUrl,
    logger,
    requestFeeCapRuntime
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
    logger,
    requestFeeCapRuntime
  );

  const orchestrator = new TransactionBatchOrchestrator(
    ethereumStateService,
    transactionBroadcaster,
    transactionMonitor,
    transactionReplacer,
    logger,
    requestFeeCapRuntime
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
 * @param requestFeeCapRuntime - Optional request-fee cap runtime dependencies
 * @returns Configured broadcast strategy
 */
async function createBroadcastStrategy(
  signer: ISigner,
  ethereumStateService: EthereumStateService,
  systemContractAddress: string,
  beaconApiUrl: string,
  logger: TransactionProgressLogger,
  requestFeeCapRuntime?: RequestFeeCapRuntime
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
    requestFeeCapRuntime
  );
}
