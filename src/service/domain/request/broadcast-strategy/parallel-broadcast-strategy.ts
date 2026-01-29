import chalk from 'chalk';

import * as logging from '../../../../constants/logging';
import type { BroadcastResult, ExecutionLayerRequestTransaction } from '../../../../model/ethereum';
import type { ISigner } from '../../signer';
import type { IBroadcastStrategy } from './broadcast-strategy.interface';
import { createPendingTransactionInfo, extractValidatorPubkey } from './broadcast-utils';

/**
 * Parallel broadcast strategy for software wallets
 *
 * Broadcasts all transactions concurrently using Promise.all.
 * Suitable for signers that support parallel signing (e.g., private key wallets).
 */
export class ParallelBroadcastStrategy implements IBroadcastStrategy {
  readonly isParallel = true;

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
        console.log(chalk.yellow(logging.BROADCASTING_EL_REQUEST_INFO, response.hash, '...'));
        return {
          status: 'success' as const,
          transaction: createPendingTransactionInfo(
            response,
            requestData,
            transaction.to,
            blockNumber
          )
        };
      } catch (error) {
        console.error(chalk.red(logging.FAILED_TO_BROADCAST_TRANSACTION_ERROR), error);
        return {
          status: 'failed' as const,
          validatorPubkey: extractValidatorPubkey(requestData),
          error
        };
      }
    });

    return Promise.all(broadcastPromises);
  }
}
