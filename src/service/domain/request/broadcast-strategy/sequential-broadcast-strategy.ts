import type {
  BroadcastResult,
  ExecutionLayerRequestTransaction,
  SigningContext
} from '../../../../model/ethereum';
import type { IBroadcastStrategy } from '../../../../ports/broadcast-strategy.interface';
import type { ISlotTimingService } from '../../../../ports/slot-timing.interface';
import { isInsufficientFundsError } from '../../error-utils';
import { isFatalLedgerError, type ISigner, isUserRejectedError } from '../../signer';
import type { EthereumStateService } from '../ethereum-state-service';
import type { TransactionProgressLogger } from '../transaction-progress-logger';
import {
  createElTransaction,
  createFailedBroadcastResult,
  createRejectedBroadcastResult,
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
   * @param maxFee - Maximum contract fee in wei per request (waits if exceeded)
   */
  constructor(
    private readonly blockchainStateService: EthereumStateService,
    private readonly systemContractAddress: string,
    private readonly slotTimingService: ISlotTimingService,
    private readonly logger: TransactionProgressLogger,
    private readonly maxFee?: bigint,
    private readonly maxFeePerGasCap?: bigint
  ) {}

  /**
   * Dispose the slot timing service
   */
  async dispose(): Promise<void> {
    await this.slotTimingService.dispose();
  }

  /**
   * Fetch the contract fee, waiting for it to be within the max fee limit
   *
   * If maxFee is not set, returns the current fee immediately.
   * Otherwise loops until the contract fee drops to or below maxFee.
   *
   * @returns Contract fee within acceptable range
   */
  private async fetchContractFeeWithinMax(): Promise<bigint> {
    if (this.maxFee === undefined) {
      return this.blockchainStateService.fetchContractFee();
    }
    return this.blockchainStateService.waitForContractFee(this.maxFee);
  }

  /**
   * Fetch and check the current gas fee, waiting for it to be within the cap
   *
   * If maxFeePerGasCap is not set, returns immediately.
   * Otherwise waits up to 32 blocks for the gas fee to drop to or below the cap.
   */
  private async fetchMaxFeePerGasWithinCap(): Promise<void> {
    if (this.maxFeePerGasCap !== undefined) {
      await this.blockchainStateService.waitForMaxFeePerGas(this.maxFeePerGasCap);
    }
  }

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
        await this.fetchMaxFeePerGasWithinCap();
        const freshContractFee = await this.fetchContractFeeWithinMax();
        const freshTransaction = createElTransaction(
          this.systemContractAddress,
          requestData,
          freshContractFee
        );
        const response = await signer.sendTransaction(freshTransaction, context);
        this.logger.logBroadcastingTransaction(response.hash);
        results.push(
          createSuccessBroadcastResult(
            response,
            requestData,
            this.systemContractAddress,
            blockNumber
          )
        );
      } catch (error) {
        if (isUserRejectedError(error)) {
          results.push(createRejectedBroadcastResult(requestData));
          continue;
        }

        this.logger.logBroadcastFailure(error);
        results.push(createFailedBroadcastResult(requestData, error));

        if (isFatalLedgerError(error) || isInsufficientFundsError(error)) {
          for (let remaining = index + 1; remaining < total; remaining++) {
            const remainingData = transactions[remaining]!.requestData;
            results.push(createFailedBroadcastResult(remainingData, error));
          }
          break;
        }
      }
    }

    return results;
  }
}
