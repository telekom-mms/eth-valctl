import type { BroadcastResult, ExecutionLayerRequestTransaction } from '../../../../model/ethereum';
import type { ISigner } from '../../signer';
import type { TransactionProgressLogger } from '../transaction-progress-logger';
import type { IBroadcastStrategy } from './broadcast-strategy.interface';
import { createFailedBroadcastResult, createSuccessBroadcastResult } from './broadcast-utils';

/**
 * Parallel broadcast strategy for software wallets
 *
 * Broadcasts all transactions concurrently using Promise.all.
 * Suitable for signers that support parallel signing (e.g., private key wallets).
 */
export class ParallelBroadcastStrategy implements IBroadcastStrategy {
  readonly isParallel = true;

  /**
   * Creates a parallel broadcast strategy
   *
   * @param logger - Logger for transaction progress
   */
  constructor(private readonly logger: TransactionProgressLogger) {}

  /**
   * Broadcast all transactions concurrently
   *
   * Sends all transactions in parallel using Promise.all for maximum throughput.
   * Suitable for software wallets that can sign without user interaction.
   *
   * @param signer - Signer for transaction signing
   * @param transactions - Array of transactions with their request data
   * @param blockNumber - Current block number when broadcasting
   * @returns Array of broadcast results for each transaction
   */
  async broadcast(
    signer: ISigner,
    transactions: Array<{
      transaction: ExecutionLayerRequestTransaction;
      requestData: string;
    }>,
    blockNumber: number
  ): Promise<BroadcastResult[]> {
    const broadcastPromises = transactions.map(async ({ transaction, requestData }) => {
      try {
        const response = await signer.sendTransaction(transaction);
        this.logger.logBroadcastingTransaction(response.hash);
        return createSuccessBroadcastResult(response, requestData, transaction.to, blockNumber);
      } catch (error) {
        this.logger.logBroadcastFailure(error);
        return createFailedBroadcastResult(requestData, error);
      }
    });

    return Promise.all(broadcastPromises);
  }
}
