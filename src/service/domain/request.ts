import chalk from 'chalk';
import { JsonRpcProvider, NonceManager } from 'ethers';

import * as logging from '../../constants/logging';
import { PendingTransaction } from '../../model/ethereum';
import { calculateCurrentRequiredFee, createElTransaction } from './ethereum';
import { TransactionMonitor } from './transaction-monitor-2';

/**
 * Send execution layer requests via json rpc connection with dynamic fee adjustment
 *
 * @param systemContractAddress - The system contract where the request is sent to
 * @param jsonRpcProvider - The connected json rpc provider
 * @param wallet - The wallet from which request will be sent
 * @param requestData - The data sent to system contract
 * @param executionLayerRequestBatchSize - Number of transactions per batch
 */
export async function sendExecutionLayerRequests(
  systemContractAddress: string,
  jsonRpcProvider: JsonRpcProvider,
  wallet: NonceManager,
  requestData: string[],
  executionLayerRequestBatchSize: number
) {
  try {
    const executionLayerRequestBatches = splitToBatches(
      requestData,
      executionLayerRequestBatchSize
    );

    for (const batch of executionLayerRequestBatches) {
      // Process the batch and get pending transactions
      const pendingTransactions = await processTransactionBatch(
        systemContractAddress,
        jsonRpcProvider,
        wallet,
        batch
      );

      // Create a transaction monitor and start monitoring
      const transactionMonitor = new TransactionMonitor(
        pendingTransactions,
        systemContractAddress,
        jsonRpcProvider,
        wallet
      );

      // Wait for all transactions to be confirmed
      await transactionMonitor.monitor();
    }
  } catch (error) {
    console.error(logging.SENDING_TRANSACTION_ERROR, error);
  }
}

/**
 * Process a batch of transactions and prepare initial transactions
 *
 * @param systemContractAddress - The system contract where the request is sent to
 * @param jsonRpcProvider - The connected json rpc provider
 * @param wallet - The wallet from which request will be sent
 * @param requestDataBatch - The data batch sent to system contract
 * @returns List of pending transaction objects
 */
async function processTransactionBatch(
  systemContractAddress: string,
  jsonRpcProvider: JsonRpcProvider,
  wallet: NonceManager,
  requestDataBatch: string[]
): Promise<PendingTransaction[]> {
  const requiredFee = await calculateCurrentRequiredFee(systemContractAddress, jsonRpcProvider);
  const pendingTransactions: PendingTransaction[] = [];

  for (const data of requestDataBatch) {
    const executionLayerRequestTrx = createElTransaction(systemContractAddress, data, requiredFee);
    const response = await wallet.sendTransaction(executionLayerRequestTrx);
    console.log(chalk.yellow(logging.BROADCASTING_EL_REQUEST_INFO, response.hash, '...'));
    pendingTransactions.push({
      hash: response.hash,
      nonce: response.nonce,
      data,
      response,
      isConfirmed: false
    });
  }

  return pendingTransactions;
}

/**
 * Split array of request data to batches
 *
 * @param requestData - The list of execution layer request data
 * @returns The list of request data batches
 */
function splitToBatches(requestData: string[], batchSize: number): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < requestData.length; i += batchSize) {
    batches.push(requestData.slice(i, i + batchSize));
  }
  return batches;
}
