import type { JsonRpcProvider } from 'ethers';

import type { Disposable } from '../../../model/ethereum';
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
 * Constructs the dependency graph: EthereumStateService, broadcast strategy selection,
 * TransactionBroadcaster, TransactionMonitor, TransactionReplacer, and orchestrator.
 * Returns a pipeline that owns both the orchestrator and all disposable resources.
 *
 * @param systemContractAddress - System contract address for execution layer requests
 * @param jsonRpcProvider - JSON-RPC provider for blockchain interaction
 * @param signer - Signer for transaction signing (wallet or Ledger)
 * @param beaconApiUrl - Beacon API URL for slot-aware broadcasting (required for Ledger)
 * @returns Pipeline ready to send execution layer requests and dispose resources
 */
export async function createTransactionPipeline(
  systemContractAddress: string,
  jsonRpcProvider: JsonRpcProvider,
  signer: ISigner,
  beaconApiUrl: string
): Promise<TransactionPipeline> {
  const ethereumStateService = new EthereumStateService(jsonRpcProvider, systemContractAddress);
  const logger = new TransactionProgressLogger();
  const disposables: Disposable[] = [];

  const broadcastStrategy = await createBroadcastStrategy(
    signer,
    ethereumStateService,
    systemContractAddress,
    beaconApiUrl,
    logger
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
    logger
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
 * @returns Configured broadcast strategy
 */
async function createBroadcastStrategy(
  signer: ISigner,
  ethereumStateService: EthereumStateService,
  systemContractAddress: string,
  beaconApiUrl: string,
  logger: TransactionProgressLogger
): Promise<IBroadcastStrategy> {
  if (signer.capabilities.supportsParallelSigning) {
    return new ParallelBroadcastStrategy(logger);
  }

  const beaconService = await BeaconService.create(beaconApiUrl);
  return new SequentialBroadcastStrategy(
    ethereumStateService,
    systemContractAddress,
    beaconService,
    logger
  );
}
