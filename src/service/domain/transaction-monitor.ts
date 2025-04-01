import chalk from 'chalk';
import { JsonRpcProvider, NonceManager } from 'ethers';

import * as logging from '../../constants/logging';
import { PendingTransaction } from '../../model/ethereum';
import { calculateCurrentRequiredFee, createElTransaction } from './ethereum';

/**
 * Class that monitors transactions and adjusts fees for pending transactions
 */
export class TransactionMonitor {
  private processedBlocks = new Set<number>();
  private blockListener: (blockNumber: number) => void;
  private resolvePromise: (() => void) | null = null;

  constructor(
    private pendingTransactions: PendingTransaction[],
    private systemContractAddress: string,
    private jsonRpcProvider: JsonRpcProvider,
    private wallet: NonceManager
  ) {
    this.blockListener = this.handleNewBlock.bind(this);
  }

  /**
   * Check transaction statuses and update fees for pending transactions
   */
  private async checkTransactions(blockNumber: number): Promise<void> {
    // Skip if we've already processed this block
    if (this.processedBlocks.has(blockNumber)) return;
    this.processedBlocks.add(blockNumber);

    // Check transaction statuses and update fees if needed
    const stillPending = await this.updatePendingTransactions();

    // If no transactions are pending, remove listener and resolve
    if (stillPending === 0 && this.resolvePromise) {
      this.jsonRpcProvider.removeListener('block', this.blockListener);
      this.resolvePromise();
    }
  }

  /**
   * Update the state of pending transactions
   */
  private async updatePendingTransactions(): Promise<number> {
    let pendingCount = 0;

    // First check which transactions are confirmed
    for (const tx of this.pendingTransactions) {
      if (tx.isConfirmed) continue;

      try {
        const receipt = await this.jsonRpcProvider.getTransactionReceipt(tx.hash);

        if (receipt && receipt.blockNumber) {
          // Check if the transaction was successful (status 1) or failed (status 0)
          if (receipt.status === 0) {
            console.log(chalk.red(`Transaction ${tx.hash} failed with status 0. Will replace it.`));
            await this.replaceFailedTransaction(tx);
            pendingCount++;
          } else {
            tx.isConfirmed = true;
            console.log(chalk.green(logging.MINED_EL_REQUEST_INFO, tx.hash));
          }
        } else {
          pendingCount++;
        }
      } catch (error) {
        console.error(`Error checking transaction ${tx.hash}:`, error);
        pendingCount++;
      }
    }

    // Only update fees if we've processed at least one block AND there are still pending transactions
    if (pendingCount > 0 && this.processedBlocks.size > 1) {
      const newRequiredFee = await calculateCurrentRequiredFee(
        this.systemContractAddress,
        this.jsonRpcProvider
      );

      for (const tx of this.pendingTransactions) {
        if (!tx.isConfirmed) {
          await this.replaceTransaction(tx, newRequiredFee);
        }
      }
    }

    return pendingCount;
  }

  /**
   * Replace a failed transaction with a new one
   */
  private async replaceFailedTransaction(pendingTx: PendingTransaction): Promise<void> {
    const newRequiredFee = await calculateCurrentRequiredFee(
      this.systemContractAddress,
      this.jsonRpcProvider
    );
    await this.replaceTransaction(pendingTx, newRequiredFee);
  }

  /**
   * Replace a pending transaction with a new one that has updated fee
   */
  private async replaceTransaction(
    pendingTx: PendingTransaction,
    newRequiredFee: bigint
  ): Promise<void> {
    try {
      // Create a new transaction with the same nonce but updated fee
      const updatedTx = createElTransaction(
        this.systemContractAddress,
        pendingTx.data,
        newRequiredFee
      );

      const feeData = await this.jsonRpcProvider.getFeeData();

      // Add the nonce to ensure we replace the existing transaction
      // and update network fees
      const replacementTx = {
        ...updatedTx,
        nonce: pendingTx.nonce,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
          ? (feeData.maxPriorityFeePerGas * 110n) / 100n
          : 1000000000n, // Fallback to 1 gwei if null
        // Use 110% of current network max fee
        maxFeePerGas: feeData.maxFeePerGas ? (feeData.maxFeePerGas * 110n) / 100n : 30000000000n // Fallback to 30 gwei if null
      };

      // Send the replacement transaction
      const response = await this.wallet.sendTransaction(replacementTx);

      // Update the pending transaction with the new hash and response
      pendingTx.hash = response.hash;
      pendingTx.response = response;

      console.log(
        chalk.yellow(
          logging.BROADCASTING_EL_REQUEST_INFO,
          `Replaced transaction with new hash: ${response.hash}`,
          '...'
        )
      );
    } catch (error) {
      console.error('Failed to replace transaction:', error);
    }
  }

  /**
   * Handler for new block events
   */
  private handleNewBlock(blockNumber: number): void {
    this.checkTransactions(blockNumber);
  }

  /**
   * Start monitoring pending transactions
   */
  public async monitor(): Promise<void> {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;

      // First perform initial check with current block
      this.jsonRpcProvider
        .getBlockNumber()
        .then((currentBlock) => {
          return this.checkTransactions(currentBlock);
        })
        .then(() => {
          // Only add the listener if we haven't resolved yet
          if (!this.pendingTransactions.every((tx) => tx.isConfirmed)) {
            this.jsonRpcProvider.on('block', this.blockListener);
          } else if (this.resolvePromise) {
            this.resolvePromise();
          }
        })
        .catch((error) => {
          console.error('Error during initial transaction check:', error);
          // Still set up the listener in case of error
          this.jsonRpcProvider.on('block', this.blockListener);
        });
    });
  }
}
