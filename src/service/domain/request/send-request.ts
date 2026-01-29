import type { JsonRpcProvider } from 'ethers';

import { BeaconService } from '../../infrastructure/beacon-service';
import type { ISigner } from '../signer';
import type { IBroadcastStrategy } from './broadcast-strategy';
import { ParallelBroadcastStrategy, SequentialBroadcastStrategy } from './broadcast-strategy';
import { EthereumStateService } from './ethereum-state-service';
import { TransactionBatchOrchestrator } from './transaction-batch-orchestrator';
import { TransactionBroadcaster } from './transaction-broadcaster';
import { TransactionMonitor } from './transaction-monitor';
import { TransactionProgressLogger } from './transaction-progress-logger';
import { TransactionReplacer } from './transaction-replacer';

/**
 * Send execution layer requests via JSON-RPC connection
 *
 * Public API for sending execution layer requests with automatic batching,
 * retry logic, and fee recalculation on block changes.
 *
 * @param systemContractAddress - System contract address for execution layer requests
 * @param jsonRpcProvider - JSON-RPC provider for blockchain interaction
 * @param signer - Signer for transaction signing (wallet or Ledger)
 * @param requestData - Array of encoded request data to send
 * @param executionLayerRequestBatchSize - Maximum number of requests per batch
 * @param beaconApiUrl - Beacon API URL for slot-aware broadcasting (required for Ledger)
 */
export async function sendExecutionLayerRequests(
  systemContractAddress: string,
  jsonRpcProvider: JsonRpcProvider,
  signer: ISigner,
  requestData: string[],
  executionLayerRequestBatchSize: number,
  beaconApiUrl: string
): Promise<void> {
  const ethereumStateService = new EthereumStateService(jsonRpcProvider, systemContractAddress);
  const logger = new TransactionProgressLogger();

  let broadcastStrategy: IBroadcastStrategy;
  if (signer.capabilities.supportsParallelSigning) {
    broadcastStrategy = new ParallelBroadcastStrategy();
  } else {
    const beaconService = new BeaconService(beaconApiUrl);
    await beaconService.initialize();
    broadcastStrategy = new SequentialBroadcastStrategy(
      ethereumStateService,
      systemContractAddress,
      beaconService
    );
  }

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
    transactionBroadcaster,
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

  try {
    await orchestrator.sendExecutionLayerRequests(requestData, executionLayerRequestBatchSize);
  } finally {
    await signer.dispose();
  }
}
