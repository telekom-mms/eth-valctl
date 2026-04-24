import type { Disposable } from '../../../model/ethereum';
import type { TransactionBatchOrchestrator } from './transaction-batch-orchestrator';

/**
 * Owns the orchestrator and all disposable resources created during pipeline setup.
 *
 * Separates batch processing (orchestrator) from lifecycle management (pipeline)
 * so callers can dispose all resources via a single `dispose()` call.
 */
export class TransactionPipeline implements Disposable {
  constructor(
    private readonly orchestrator: TransactionBatchOrchestrator,
    private readonly disposables: Disposable[]
  ) {}

  /**
   * Delegate batch sending to the orchestrator
   *
   * @param requestData - Encoded request data to send
   * @param batchSize - Maximum number of requests per batch
   */
  async sendExecutionLayerRequests(requestData: string[], batchSize: number): Promise<void> {
    await this.orchestrator.sendExecutionLayerRequests(requestData, batchSize);
  }

  /**
   * Dispose all collected resources in order
   */
  async dispose(): Promise<void> {
    for (const disposable of this.disposables) {
      await disposable.dispose();
    }
  }
}
