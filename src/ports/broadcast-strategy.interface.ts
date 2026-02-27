import type { BroadcastResult, ExecutionLayerRequestTransaction } from '../model/ethereum';
import type { ISigner } from './signer.interface';

/**
 * Strategy interface for broadcasting execution layer request transactions
 *
 * Different implementations handle parallel vs sequential broadcasting
 * based on signer capabilities.
 */
export interface IBroadcastStrategy {
  /**
   * Whether this strategy broadcasts in parallel (true) or sequentially (false)
   */
  readonly isParallel: boolean;

  /**
   * Broadcast multiple transactions using the strategy's approach
   *
   * @param signer - Signer to use for transaction signing
   * @param transactions - Array of transaction data and parameters
   * @param blockNumber - Current block number when broadcasting
   * @returns Array of broadcast results
   */
  broadcast(
    signer: ISigner,
    transactions: Array<{
      transaction: ExecutionLayerRequestTransaction;
      requestData: string;
    }>,
    blockNumber: number
  ): Promise<BroadcastResult[]>;
}
