import type { JsonRpcProvider } from 'ethers';

import type { RequestFeeCapRuntime } from '../../../model/ethereum';
import type { ISigner } from '../../../ports/signer.interface';
import type { EthereumStateService } from './ethereum-state-service';
import { createTransactionPipeline } from './execution-layer-request-factory';

/**
 * Send execution layer requests via JSON-RPC connection
 *
 * Public API for sending execution layer requests with automatic batching,
 * retry logic, and fee recalculation on block changes.
 *
 * @param systemContractAddress - Target contract address (system contract or deposit contract)
 * @param jsonRpcProvider - JSON-RPC provider for blockchain interaction
 * @param signer - Signer for transaction signing (wallet or Ledger)
 * @param requestData - Array of encoded request data to send
 * @param executionLayerRequestBatchSize - Maximum number of requests per batch
 * @param beaconApiUrl - Beacon API URL for slot-aware broadcasting (required for Ledger)
 * @param requestFeeCapRuntime - Optional request-fee cap runtime dependencies
 * @param ethereumStateService - Optional state service providing the per-request value
 */
export async function sendExecutionLayerRequests(
  systemContractAddress: string,
  jsonRpcProvider: JsonRpcProvider,
  signer: ISigner,
  requestData: string[],
  executionLayerRequestBatchSize: number,
  beaconApiUrl: string,
  requestFeeCapRuntime?: RequestFeeCapRuntime,
  ethereumStateService?: EthereumStateService
): Promise<void> {
  const pipeline = await createTransactionPipeline(
    systemContractAddress,
    jsonRpcProvider,
    signer,
    beaconApiUrl,
    requestFeeCapRuntime,
    ethereumStateService
  );

  try {
    await pipeline.sendExecutionLayerRequests(requestData, executionLayerRequestBatchSize);
  } finally {
    await pipeline.dispose();
    await signer.dispose();
  }
}
