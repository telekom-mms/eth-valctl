import { formatUnits } from 'ethers';

import type { BroadcastResult } from '../../../model/ethereum';
import type { ISigner } from '../signer';
import type { IBroadcastStrategy } from './broadcast-strategy';
import { createElTransaction } from './broadcast-strategy/broadcast-utils';
import { EthereumStateService } from './ethereum-state-service';
import { TransactionProgressLogger } from './transaction-progress-logger';

/**
 * Service for broadcasting execution layer request transactions to the blockchain.
 */
export class TransactionBroadcaster {
  /**
   * Creates a transaction broadcaster
   *
   * @param signer - Signer for transaction signing (wallet or Ledger)
   * @param systemContractAddress - Target system contract address for requests
   * @param blockchainStateService - Service for fetching network fees
   * @param logger - Service for logging progress
   * @param broadcastStrategy - Strategy for broadcasting (parallel or sequential)
   */
  constructor(
    private readonly signer: ISigner,
    private readonly systemContractAddress: string,
    private readonly blockchainStateService: EthereumStateService,
    private readonly logger: TransactionProgressLogger,
    private readonly broadcastStrategy: IBroadcastStrategy
  ) {}

  /**
   * Broadcast execution layer requests to the network
   *
   * Uses the configured broadcast strategy (parallel for wallets, sequential for Ledger).
   * Individual transaction failures are logged but don't prevent other transactions from broadcasting.
   *
   * @param requestData - Array of encoded request data
   * @param requiredFee - Fee amount required by system contract
   * @param blockNumber - Current block number when broadcasting
   * @returns Array of broadcast results containing either successful transactions or failure info
   */
  async broadcastExecutionLayerRequests(
    requestData: string[],
    requiredFee: bigint,
    blockNumber: number
  ): Promise<BroadcastResult[]> {
    await this.logBroadcastStart(requestData.length, blockNumber + 1);

    const transactions = requestData.map((data) => ({
      transaction: createElTransaction(this.systemContractAddress, data, requiredFee),
      requestData: data
    }));

    return await this.broadcastStrategy.broadcast(this.signer, transactions, blockNumber);
  }

  /**
   * Log broadcast start with block and fee info
   *
   * Fetches current network fees and delegates to logger for formatted output.
   * Uses sequential format for Ledger (no target block) vs parallel format with target block.
   *
   * @param count - Number of execution layer requests being broadcast
   * @param blockNumber - Target block number (only used for parallel mode)
   */
  private async logBroadcastStart(count: number, blockNumber: number): Promise<void> {
    const feeGwei = await this.getFeeForLogging();
    if (this.broadcastStrategy.isParallel) {
      this.logger.logBroadcastStart(count, blockNumber, feeGwei);
    } else {
      this.logger.logBroadcastStartSequential(count, feeGwei);
    }
  }

  /**
   * Fetch current network fee for logging purposes
   *
   * @returns Fee in Gwei as string, or '0' if fetch fails
   */
  private async getFeeForLogging(): Promise<string> {
    try {
      const fees = await this.blockchainStateService.getMaxNetworkFees();
      return formatUnits(fees.maxFeePerGas, 'gwei');
    } catch {
      this.logger.logBroadcastFeesFetchError();
      return '0';
    }
  }
}
