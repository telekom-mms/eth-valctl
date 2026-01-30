import type {
  BroadcastResult,
  ExecutionLayerRequestTransaction,
  SigningContext
} from '../../../../model/ethereum';
import type { IInteractiveSigner, ISigner } from '../../signer';
import type { ISlotTimingService } from '../../slot-timing.interface';
import type { EthereumStateService } from '../ethereum-state-service';
import type { TransactionProgressLogger } from '../transaction-progress-logger';
import type { IBroadcastStrategy } from './broadcast-strategy.interface';
import {
  createElTransaction,
  createFailedBroadcastResult,
  createSuccessBroadcastResult,
  extractValidatorPubkey
} from './broadcast-utils';

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
   * @param logger - Logger for transaction progress
   */
  constructor(
    private readonly blockchainStateService: EthereumStateService,
    private readonly systemContractAddress: string,
    private readonly slotTimingService: ISlotTimingService,
    private readonly logger: TransactionProgressLogger
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
        const freshTransaction = createElTransaction(
          this.systemContractAddress,
          requestData,
          freshContractFee
        );
        const response = signer.capabilities.requiresUserInteraction
          ? await (signer as IInteractiveSigner).sendTransaction(freshTransaction, context)
          : await signer.sendTransaction(freshTransaction);
        this.logger.logBroadcastingTransaction(response.hash);
        results.push(
          createSuccessBroadcastResult(response, requestData, this.systemContractAddress, blockNumber)
        );
      } catch (error) {
        this.logger.logBroadcastFailure(error);
        results.push(createFailedBroadcastResult(requestData, error));
      }
    }

    return results;
  }
}
