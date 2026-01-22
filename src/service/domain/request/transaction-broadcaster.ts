import chalk from 'chalk';
import { formatUnits, NonceManager, TransactionResponse } from 'ethers';

import * as serviceConstants from '../../../constants/application';
import * as logging from '../../../constants/logging';
import type {
  BroadcastResult,
  ExecutionLayerRequestTransaction,
  PendingTransactionInfo
} from '../../../model/ethereum';
import { EthereumStateService } from './ethereum-state-service';
import { TransactionProgressLogger } from './transaction-progress-logger';

/**
 * Service for broadcasting execution layer request transactions to the blockchain.
 */
export class TransactionBroadcaster {
  /**
   * Creates a transaction broadcaster
   *
   * @param wallet - Nonce-managed wallet for transaction signing
   * @param systemContractAddress - Target system contract address for requests
   * @param blockchainStateService - Service for fetching network fees
   * @param logger - Service for logging progress
   */
  constructor(
    private readonly wallet: NonceManager,
    private readonly systemContractAddress: string,
    private readonly blockchainStateService: EthereumStateService,
    private readonly logger: TransactionProgressLogger
  ) {}

  /**
   * Broadcast execution layer requests to the network
   *
   * Creates and sends transactions for each request data item in parallel.
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

    const broadcastPromises = requestData.map(async (data) => {
      try {
        const transaction = this.createElTransaction(data, requiredFee);
        const response = await this.wallet.sendTransaction(transaction);
        console.log(chalk.yellow(logging.BROADCASTING_EL_REQUEST_INFO, response.hash, '...'));
        return {
          status: 'success' as const,
          transaction: this.createPendingTransactionInfo(response, data, blockNumber)
        };
      } catch (error) {
        console.error(chalk.red(logging.FAILED_TO_BROADCAST_TRANSACTION_ERROR), error);
        return {
          status: 'failed' as const,
          validatorPubkey: this.extractSourceValidatorPubkey(data),
          error
        };
      }
    });

    return await Promise.all(broadcastPromises);
  }

  /**
   * Create an execution layer request transaction object
   *
   * @param encodedRequestData - Single encoded request data for the transaction
   * @param requiredFee - Fee amount to send with transaction
   * @param maxFeePerGas - Optional maximum fee per gas for transaction replacement
   * @param maxPriorityFeePerGas - Optional maximum priority fee per gas
   * @returns Transaction object ready for broadcasting
   */
  createElTransaction(
    encodedRequestData: string,
    requiredFee: bigint,
    maxFeePerGas?: bigint,
    maxPriorityFeePerGas?: bigint
  ): ExecutionLayerRequestTransaction {
    const executionLayerRequestTransaction: ExecutionLayerRequestTransaction = {
      to: this.systemContractAddress,
      data: encodedRequestData,
      value: requiredFee,
      gasLimit: serviceConstants.TRANSACTION_GAS_LIMIT
    };

    if (maxFeePerGas) {
      executionLayerRequestTransaction.maxFeePerGas = maxFeePerGas;
    }

    if (maxPriorityFeePerGas) {
      executionLayerRequestTransaction.maxPriorityFeePerGas = maxPriorityFeePerGas;
    }

    return executionLayerRequestTransaction;
  }

  /**
   * Create a PendingTransactionInfo object
   *
   * @param response - Transaction response from blockchain
   * @param data - Original request data
   * @param blockNumber - Block number when transaction was sent
   * @returns Pending transaction info for monitoring
   */
  private createPendingTransactionInfo(
    response: TransactionResponse,
    data: string,
    blockNumber: number
  ): PendingTransactionInfo {
    return {
      response,
      nonce: response.nonce,
      data,
      systemContractAddress: this.systemContractAddress,
      blockNumber
    };
  }

  /**
   * Extract source validator pubkey from execution layer request data
   *
   * Request data format: 0x + source_pubkey (96 hex chars) + optional target_pubkey (96 hex chars)
   *
   * @param encodedRequestData - Encoded execution layer request data
   * @returns Source validator public key with 0x prefix
   */
  private extractSourceValidatorPubkey(encodedRequestData: string): string {
    return encodedRequestData.slice(0, 98);
  }

  /**
   * Log broadcast start with block and fee info
   *
   * Fetches current network fees and delegates to logger for formatted output.
   * Handles fee fetch errors gracefully by logging with fallback value.
   *
   * @param count - Number of execution layer requests being broadcast
   * @param blockNumber - Target block number
   */
  private async logBroadcastStart(count: number, blockNumber: number): Promise<void> {
    try {
      const maxNetworkFees = await this.blockchainStateService.getMaxNetworkFees();
      this.logger.logBroadcastStart(
        count,
        blockNumber,
        formatUnits(maxNetworkFees.maxFeePerGas, 'gwei')
      );
    } catch {
      this.logger.logBroadcastFeesFetchError();
      this.logger.logBroadcastStart(count, blockNumber, '0');
    }
  }
}
