import chalk from 'chalk';

import * as serviceConstants from '../../../../constants/application';
import * as logging from '../../../../constants/logging';
import type {
  BroadcastResult,
  ExecutionLayerRequestTransaction,
  SigningContext
} from '../../../../model/ethereum';
import type { ISigner } from '../../signer';
import type { ISlotTimingService } from '../../slot-timing.interface';
import type { EthereumStateService } from '../ethereum-state-service';
import type { IBroadcastStrategy } from './broadcast-strategy.interface';
import { createPendingTransactionInfo, extractValidatorPubkey } from './broadcast-utils';

/**
 * Sequential broadcast strategy for hardware wallets
 *
 * Broadcasts transactions one at a time with user prompts.
 * Required for signers that need user interaction (e.g., Ledger).
 * Fetches fresh contract fee before each signing to avoid stale fee reverts.
 * Waits for optimal slot position before broadcasting to prevent fee race conditions.
 */
export class SequentialBroadcastStrategy implements IBroadcastStrategy {
  readonly isParallel = false;

  /**
   * Creates a sequential broadcast strategy
   *
   * @param blockchainStateService - Service for fetching fresh contract fees
   * @param systemContractAddress - Target system contract address
   * @param slotTimingService - Service for slot-aware timing
   */
  constructor(
    private readonly blockchainStateService: EthereumStateService,
    private readonly systemContractAddress: string,
    private readonly slotTimingService: ISlotTimingService
  ) {}

  /**
   * Broadcast transactions sequentially with slot-aware timing
   *
   * Processes each transaction one at a time, waiting for optimal slot position
   * and fetching fresh fees before each signing to avoid stale fee reverts.
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
    const results: BroadcastResult[] = [];
    const total = transactions.length;

    for (let index = 0; index < total; index++) {
      const { requestData } = transactions[index]!;
      const validatorPubkey = extractValidatorPubkey(requestData);

      const context: SigningContext = {
        currentIndex: index + 1,
        totalCount: total,
        validatorPubkey
      };

      try {
        await this.slotTimingService.waitForOptimalBroadcastWindow();
        const freshContractFee = await this.blockchainStateService.fetchContractFee();
        const freshTransaction = this.createElTransaction(requestData, freshContractFee);
        const response = await signer.sendTransaction(freshTransaction, context);
        console.log(chalk.yellow(logging.BROADCASTING_EL_REQUEST_INFO, response.hash, '...'));
        results.push({
          status: 'success',
          transaction: createPendingTransactionInfo(
            response,
            requestData,
            this.systemContractAddress,
            blockNumber
          )
        });
      } catch (error) {
        console.error(chalk.red(logging.FAILED_TO_BROADCAST_TRANSACTION_ERROR), error);
        results.push({
          status: 'failed',
          validatorPubkey,
          error
        });
      }
    }

    return results;
  }

  /**
   * Create an execution layer request transaction object
   *
   * @param encodedRequestData - Encoded request data for the transaction
   * @param fee - Contract fee amount
   * @returns Transaction object ready for signing
   */
  private createElTransaction(encodedRequestData: string, fee: bigint): ExecutionLayerRequestTransaction {
    return {
      to: this.systemContractAddress,
      data: encodedRequestData,
      value: fee,
      gasLimit: serviceConstants.TRANSACTION_GAS_LIMIT
    };
  }
}
