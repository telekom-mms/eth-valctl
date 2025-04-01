import chalk from 'chalk';
import { JsonRpcProvider, NonceManager, toBeHex, toBigInt, Wallet } from 'ethers';
import { median } from 'mathjs';
import { exit } from 'process';

import * as serviceConstants from '../../constants/application';
import * as logging from '../../constants/logging';
import { EthereumConnection, ExecutionLayerRequestTransaction } from '../../model/ethereum';
import { promptSecret } from '../prompt';

/**
 * Create Ethereum related connection information
 *
 * @param jsonRpcUrl - The json rpc url used for creating a json rpc provider
 * @returns The ethereum connection information
 */
export async function createEthereumConnection(jsonRpcUrl: string): Promise<EthereumConnection> {
  try {
    const provider = new JsonRpcProvider(jsonRpcUrl);
    await provider.getNetwork();
    const privateKey = await promptSecret(chalk.green(logging.PROMPT_PRIVATE_KEY_INFO));
    const wallet = new Wallet(privateKey, provider);
    return { wallet: new NonceManager(wallet), provider: provider };
  } catch {
    console.error(chalk.red(logging.INVALID_PRIVATE_KEY_ERROR));
    process.exit(1);
  }
}

/**
 * Calculate the current required fee based on contract state
 */
export async function calculateCurrentRequiredFee(
  systemContractAddress: string,
  jsonRpcProvider: JsonRpcProvider
): Promise<bigint> {
  const contractQueue = await jsonRpcProvider.getStorage(systemContractAddress, toBeHex(0));
  const medianQueueLength = await calculateMedianContractQueueLength(
    systemContractAddress,
    jsonRpcProvider
  );

  return getRequiredFee(toBigInt(contractQueue) + toBigInt(medianQueueLength));
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
  systemContractAddress: string,
  jsonRpcProvider: JsonRpcProvider
): Promise<number> {
  try {
    const numberOflogsByBlock = await getNumberOfLogsByBlock(
      systemContractAddress,
      jsonRpcProvider
    );
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
  systemContractAddress: string,
  jsonRpcProvider: JsonRpcProvider
): Promise<number[]> {
  const currentBlock = await jsonRpcProvider.getBlockNumber();
  const startBlock = currentBlock - (serviceConstants.NUMBER_OF_BLOCKS_FOR_LOG_LOOKUP - 1);
  const logs = await jsonRpcProvider.getLogs({
    address: systemContractAddress,
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
 * Calculates the required fee for sending an execution layer request to a specific system contract
 *
 * @param numerator - The request queue length of a specific system contract
 * @returns The required fee for sending an execution layer request
 */
function getRequiredFee(numerator: bigint): bigint {
  // https://eips.ethereum.org/EIPS/eip-7251#fee-calculation
  let i = 1n;
  let output = 0n;
  let numeratorAccum =
    serviceConstants.MIN_CONSOLIDATION_REQUEST_FEE *
    serviceConstants.CONSOLIDATION_REQUEST_FEE_UPDATE_FRACTION;
  while (numeratorAccum > 0n) {
    output += numeratorAccum;
    numeratorAccum =
      (numeratorAccum * numerator) /
      (serviceConstants.CONSOLIDATION_REQUEST_FEE_UPDATE_FRACTION * i);
    i += 1n;
  }
  return output / serviceConstants.CONSOLIDATION_REQUEST_FEE_UPDATE_FRACTION;
}

/**
 * Create an execution layer request transaction
 *
 * @param systemContractAddress - The system contract where the request is sent to
 * @param requestData - The data sent to system contract
 * @param requiredFee - The fee which needs to be sent with the request
 * @returns The execution layer request transaction
 */
export function createElTransaction(
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
