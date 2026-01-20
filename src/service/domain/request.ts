import chalk from 'chalk';
import { JsonRpcProvider, NonceManager, toBeHex, toBigInt, TransactionReceipt } from 'ethers';
import { median } from 'mathjs';
import { exit } from 'process';

import * as serviceConstants from '../../constants/application';
import * as logging from '../../constants/logging';
import type { ExecutionLayerRequestTransaction } from '../../model/ethereum';
import { getRequiredFee } from './ethereum';

/**
 * Send execution layer requests via json rpc connection
 *
 * @param systemContractAddress - The system contract where the request is sent to
 * @param jsonRpcProvider - The connected json rpc provider
 * @param wallet - The wallet from which request will be sent
 * @param requestData - The data sent to system contract
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
      const contractQueue = await jsonRpcProvider.getStorage(systemContractAddress, toBeHex(0));
      const requiredFee = getRequiredFee(
        toBigInt(contractQueue) +
          toBigInt(await calculateMedianContractQueueLength(systemContractAddress, jsonRpcProvider))
      );
      const broadcastedExecutionLayerRequests = await broadcastExecutionLayerRequests(
        systemContractAddress,
        wallet,
        batch,
        requiredFee
      );
      await Promise.allSettled(mineExecutionLayerRequests(broadcastedExecutionLayerRequests));
    }
  } catch (error) {
    console.error(logging.SENDING_TRANSACTION_ERROR, error);
  }
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

/**
 * Calculate the median contract queue length over the last 50 blocks.
 * This is added to the actual contract queue length in order to prevent transaction reverts
 * when a request batch will be included in multiple blocks.
 *
 * @param systemContractAddress - The system contract where the request is sent to
 * @param jsonRpcProvider - The connected json rpc provider
 * @returns The median contract queue length for the last 50 blocks
 */
async function calculateMedianContractQueueLength(
  contractAddress: string,
  jsonRpcProvider: JsonRpcProvider
): Promise<number> {
  try {
    const numberOflogsByBlock = await getNumberOfLogsByBlock(contractAddress, jsonRpcProvider);
    const medianContractQueueLength = median(numberOflogsByBlock);
    return medianContractQueueLength;
  } catch (error) {
    console.error(logging.FETCHING_LOGS_ERROR, error);
    exit(1);
  }
}

/**
 * Fetch system contract logs to get a list with number of logs by block
 *
 * @param systemContractAddress - The system contract where the request is sent to
 * @param jsonRpcProvider - The connected json rpc provider
 * @returns The list of number of logs by blocks
 */
async function getNumberOfLogsByBlock(
  contractAddress: string,
  jsonRpcProvider: JsonRpcProvider
): Promise<number[]> {
  const currentBlock = await jsonRpcProvider.getBlockNumber();
  const startBlock = currentBlock - (serviceConstants.NUMBER_OF_BLOCKS_FOR_LOG_LOOKUP - 1);
  const logs = await jsonRpcProvider.getLogs({
    address: contractAddress,
    fromBlock: startBlock,
    toBlock: currentBlock
  });
  const numberOflogsByBlock = new Map(
    Array.from({ length: currentBlock - startBlock + 1 }, (_, i) => [startBlock + i, 0])
  );
  for (const log of logs) {
    numberOflogsByBlock.set(log.blockNumber, (numberOflogsByBlock.get(log.blockNumber) || 0) + 1);
  }
  return [...numberOflogsByBlock.values()];
}

/**
 * Broadcast execution layer requests to Ethereum
 *
 * @param systemContractAddress - The system contract where the request is sent to
 * @param wallet - The wallet from which request will be sent
 * @param requestData - The data sent to system contract
 * @param requiredFee - The fee which needs to be sent with the request
 * @returns The broadcasted execution layer requests
 */
async function broadcastExecutionLayerRequests(
  systemContractAddress: string,
  wallet: NonceManager,
  requestData: string[],
  requiredFee: bigint
): Promise<Promise<null | TransactionReceipt>[]> {
  const broadcastedExecutionLayerRequests: Promise<null | TransactionReceipt>[] = [];
  for (const data of requestData) {
    const executionLayerRequestTrx = createElTransaction(systemContractAddress, data, requiredFee);
    const executionLayerRequestResponse = await wallet.sendTransaction(executionLayerRequestTrx);
    console.log(
      chalk.yellow(logging.BROADCASTING_EL_REQUEST_INFO, executionLayerRequestResponse.hash, '...')
    );
    broadcastedExecutionLayerRequests.push(executionLayerRequestResponse.wait());
  }
  return broadcastedExecutionLayerRequests;
}

/**
 * Create an execution layer request transaction
 *
 * @param systemContractAddress - The system contract where the request is sent to
 * @param requestData - The data sent to system contract
 * @param requiredFee - The fee which needs to be sent with the request
 * @returns The execution layer request transaction
 */
function createElTransaction(
  systemContractAddress: string,
  requestData: string,
  requiredFee: bigint
): ExecutionLayerRequestTransaction {
  const executionLayerRequestTrx: ExecutionLayerRequestTransaction = {
    to: systemContractAddress,
    data: requestData,
    value: requiredFee,
    gasLimit: serviceConstants.TRANSACTION_GAS_LIMIT
  };
  return executionLayerRequestTrx;
}

/**
 * Include broadcasted execution layer requests into blocks
 *
 * @param broadcastedTransactions - The already broadcasted execution layer requests
 */
function mineExecutionLayerRequests(
  broadcastedTransactions: Promise<null | TransactionReceipt>[]
): Promise<void>[] {
  return broadcastedTransactions.map((broadcastedTransaction) =>
    broadcastedTransaction
      .then((broadcastResult) => {
        if (broadcastResult) {
          console.log(chalk.green(logging.MINED_EL_REQUEST_INFO, broadcastResult.hash));
        }
      })
      .catch((error) => {
        console.error(error);
      })
  );
}
