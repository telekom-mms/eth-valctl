import { JsonRpcProvider, NonceManager } from 'ethers';

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
 * @param wallet - Nonce-managed wallet for transaction signing
 * @param requestData - Array of encoded request data to send
 * @param executionLayerRequestBatchSize - Maximum number of requests per batch
 */
export async function sendExecutionLayerRequests(
  systemContractAddress: string,
  jsonRpcProvider: JsonRpcProvider,
  wallet: NonceManager,
  requestData: string[],
  executionLayerRequestBatchSize: number
): Promise<void> {
  const ethereumStateService = new EthereumStateService(jsonRpcProvider, systemContractAddress);
  const logger = new TransactionProgressLogger();
  const transactionBroadcaster = new TransactionBroadcaster(
    wallet,
    systemContractAddress,
    ethereumStateService,
    logger
  );
  const transactionMonitor = new TransactionMonitor(jsonRpcProvider);
  const transactionReplacer = new TransactionReplacer(
    wallet,
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

  await orchestrator.sendExecutionLayerRequests(requestData, executionLayerRequestBatchSize);
}
