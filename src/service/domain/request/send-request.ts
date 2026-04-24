import type { JsonRpcProvider } from 'ethers';

import type { ISigner } from '../../../ports/signer.interface';
import { createTransactionPipeline } from './execution-layer-request-factory';

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
  const pipeline = await createTransactionPipeline(
    systemContractAddress,
    jsonRpcProvider,
    signer,
    beaconApiUrl
  );

  try {
    await pipeline.sendExecutionLayerRequests(requestData, executionLayerRequestBatchSize);
  } finally {
    await pipeline.dispose();
    await signer.dispose();
  }
}
