import type { JsonRpcProvider } from 'ethers';

import type { IBroadcastStrategy } from '../../../ports/broadcast-strategy.interface';
import type { ISigner } from '../../../ports/signer.interface';
import { BeaconService } from '../../infrastructure/beacon-service';
import { ParallelBroadcastStrategy } from './broadcast-strategy/parallel-broadcast-strategy';
import { SequentialBroadcastStrategy } from './broadcast-strategy/sequential-broadcast-strategy';
import { EthereumStateService } from './ethereum-state-service';
import { TransactionBatchOrchestrator } from './transaction-batch-orchestrator';
import { TransactionBroadcaster } from './transaction-broadcaster';
import { TransactionMonitor } from './transaction-monitor';
import { TransactionProgressLogger } from './transaction-progress-logger';
import { TransactionReplacer } from './transaction-replacer';

/**
 * Create a fully-wired TransactionBatchOrchestrator with all dependencies
 *
 * Constructs the dependency graph: EthereumStateService, broadcast strategy selection,
 * TransactionBroadcaster, TransactionMonitor, TransactionReplacer, and orchestrator.
 *
 * @param systemContractAddress - System contract address for execution layer requests
 * @param jsonRpcProvider - JSON-RPC provider for blockchain interaction
 * @param signer - Signer for transaction signing (wallet or Ledger)
 * @param beaconApiUrl - Beacon API URL for slot-aware broadcasting (required for Ledger)
 * @returns Fully-wired orchestrator ready to send execution layer requests
 */
export async function createTransactionBatchOrchestrator(
  systemContractAddress: string,
  jsonRpcProvider: JsonRpcProvider,
  signer: ISigner,
  beaconApiUrl: string
): Promise<TransactionBatchOrchestrator> {
  const ethereumStateService = new EthereumStateService(jsonRpcProvider, systemContractAddress);
  const logger = new TransactionProgressLogger();

  const broadcastStrategy = await createBroadcastStrategy(
    signer,
    ethereumStateService,
    systemContractAddress,
    beaconApiUrl,
    logger
  );

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

  return new TransactionBatchOrchestrator(
    ethereumStateService,
    transactionBroadcaster,
    transactionMonitor,
    transactionReplacer,
    logger
  );
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
