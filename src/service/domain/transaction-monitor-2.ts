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

  // Track replacement attempts for each transaction
  private replacementAttempts: Map<number, number> = new Map();
  // Maximum number of replacement attempts before skipping the transaction
  private readonly MAX_REPLACEMENT_ATTEMPTS = 5;

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
            console.log(
              chalk.red(
                `Transaction ${tx.hash} (nonce: ${tx.nonce}) failed with status 0. Will replace it.`
              )
            );
            await this.replaceFailedTransaction(tx);
            pendingCount++;
          } else {
            tx.isConfirmed = true;
            // Clear replacement attempts for this nonce
            this.replacementAttempts.delete(tx.nonce);
            console.log(
              chalk.green(logging.MINED_EL_REQUEST_INFO, `${tx.hash} (nonce: ${tx.nonce})`)
            );
          }
        } else {
          pendingCount++;
        }
      } catch (error) {
        console.error(`Error checking transaction ${tx.hash} (nonce: ${tx.nonce}):`, error);
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

    // Set initial replacement attempt for this nonce
    this.replacementAttempts.set(pendingTx.nonce, 1);

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
      // Get current attempt count for this nonce
      const attempts = this.replacementAttempts.get(pendingTx.nonce) || 0;

      // Increment and store attempt count
      this.replacementAttempts.set(pendingTx.nonce, attempts + 1);

      // If we've exceeded our maximum attempts, skip this transaction
      if (attempts >= this.MAX_REPLACEMENT_ATTEMPTS) {
        console.log(
          chalk.red(
            `Giving up on transaction with nonce ${pendingTx.nonce} after ${attempts} replacement attempts.`
          )
        );
        return;
      }

      // Create a new transaction with the same nonce but updated fee
      const updatedTx = createElTransaction(
        this.systemContractAddress,
        pendingTx.data,
        newRequiredFee
      );

      const feeData = await this.jsonRpcProvider.getFeeData();

      // Calculate fee multiplier based on attempts
      // Start with 110% and increase by 10% for each attempt
      const multiplier = 110n + BigInt(Math.min(attempts, 4) * 10);

      // Add the nonce to ensure we replace the existing transaction
      // and update network fees with dynamic multiplier
      const replacementTx = {
        ...updatedTx,
        nonce: pendingTx.nonce,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
          ? (feeData.maxPriorityFeePerGas * multiplier) / 100n
          : (1000000000n * multiplier) / 100n, // Fallback to 1 gwei * multiplier if null
        // Use dynamic multiplier for max fee
        maxFeePerGas: feeData.maxFeePerGas
          ? (feeData.maxFeePerGas * multiplier) / 100n
          : (30000000000n * multiplier) / 100n // Fallback to 30 gwei * multiplier if null
      };

      // Send the replacement transaction
      const response = await this.wallet.sendTransaction(replacementTx);

      // Update the pending transaction with the new hash and response
      pendingTx.hash = response.hash;
      pendingTx.response = response;

      // Log the fee values for debugging
      console.log(
        chalk.yellow(
          logging.BROADCASTING_EL_REQUEST_INFO,
          `Replaced transaction with new hash: ${response.hash} (nonce: ${pendingTx.nonce}, attempt: ${attempts + 1})`
        )
      );
      console.log(
        chalk.blue(
          `Fee details: multiplier=${multiplier}%, maxPriorityFeePerGas=${replacementTx.maxPriorityFeePerGas}, maxFeePerGas=${replacementTx.maxFeePerGas}`
        )
      );
    } catch (error) {
      console.error(`Failed to replace transaction for nonce ${pendingTx.nonce}:`, error);

      // If we get an error like "replacement transaction underpriced",
      // we need to increase the fee even more aggressively next time
      if (
        error &&
        typeof error === 'object' &&
        'message' in error &&
        typeof error.message === 'string' &&
        error.message.includes('underpriced')
      ) {
        const currentAttempts = this.replacementAttempts.get(pendingTx.nonce) || 0;
        this.replacementAttempts.set(
          pendingTx.nonce,
          Math.min(currentAttempts + 1, this.MAX_REPLACEMENT_ATTEMPTS)
        );
      }
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
