import chalk from 'chalk';
import { JsonRpcProvider, toBeHex, toBigInt } from 'ethers';

import * as serviceConstants from '../../../constants/application';
import {
  FAILED_TO_FETCH_REQUIRED_FEE_ERROR,
  SYSTEM_CONTRACT_NOT_ACTIVATED_ERROR
} from '../../../constants/logging';
import type { ContractFeeState, MaxNetworkFees } from '../../../model/ethereum';
import { BlockchainStateError } from '../../../model/ethereum';
import { calculateRequestFee } from './request-fee-estimation-service';

/**
 * Service for querying Ethereum state including block numbers, network fees, and contract fees.
 */
export class EthereumStateService {
  /**
   * Creates an Ethereum state service
   *
   * @param provider - JSON-RPC provider for blockchain interaction
   * @param systemContractAddress - System contract address for fee queries
   */
  constructor(
    private readonly provider: JsonRpcProvider,
    private readonly systemContractAddress: string
  ) {}

  /**
   * Fetch current block number from provider
   *
   * @returns Current block number
   * @throws BlockchainStateError if unable to fetch block number
   */
  async fetchBlockNumber(): Promise<number> {
    try {
      return await this.provider.getBlockNumber();
    } catch (error) {
      console.error(chalk.red('Failed to fetch current block number'), error);
      throw new BlockchainStateError('Unable to fetch block number', error);
    }
  }

  /**
   * Fetch contract fee from system contract storage
   *
   * Reads queue length from contract storage and calculates contract fee
   * based on current network congestion.
   *
   * @returns Contract fee amount in wei
   * @throws BlockchainStateError if system contract not yet activated (excess inhibitor active)
   * @throws BlockchainStateError if unable to fetch contract fee from system contract
   */
  async fetchContractFee(): Promise<bigint> {
    const { fee } = await this.fetchContractFeeWithExcess();
    return fee;
  }

  /**
   * Fetch contract fee and raw excess from system contract storage
   *
   * Returns both the calculated fee and the raw excess value from storage slot 0,
   * enabling callers to perform block estimation for fee changes.
   *
   * @returns Contract fee state with calculated fee and raw excess
   * @throws BlockchainStateError if system contract not yet activated (excess inhibitor active)
   * @throws BlockchainStateError if unable to fetch contract fee from system contract
   */
  async fetchContractFeeWithExcess(): Promise<ContractFeeState> {
    try {
      const contractQueue = await this.provider.getStorage(this.systemContractAddress, toBeHex(0));
      const excess = toBigInt(contractQueue);

      if (excess === serviceConstants.EXCESS_INHIBITOR) {
        throw new BlockchainStateError(
          SYSTEM_CONTRACT_NOT_ACTIVATED_ERROR(this.systemContractAddress)
        );
      }

      const fee = calculateRequestFee(excess);
      return { fee, excess };
    } catch (error) {
      if (error instanceof BlockchainStateError) {
        throw error;
      }
      console.error(
        chalk.red(FAILED_TO_FETCH_REQUIRED_FEE_ERROR(this.systemContractAddress)),
        error
      );
      throw new BlockchainStateError('Unable to fetch contract fee from system contract', error);
    }
  }

  /**
   * Get current max network fees per gas
   *
   * Fetches the current max network fees per gas without any modification.
   * Retries up to MAX_FETCH_NETWORK_FEES_RETRIES if fees are unavailable.
   *
   * @returns Current max network fees per gas
   * @throws BlockchainStateError if unable to fetch network fees
   */
  async getMaxNetworkFees(): Promise<MaxNetworkFees> {
    return fetchMaxNetworkFees(this.provider);
  }
}

/**
 * Fetch current max network fees from a JSON-RPC provider
 *
 * Retries up to MAX_FETCH_NETWORK_FEES_RETRIES if fees are unavailable.
 * Standalone function usable without EthereumStateService instantiation.
 *
 * @param provider - JSON-RPC provider for fee data queries
 * @returns Current max network fees per gas
 * @throws BlockchainStateError if unable to fetch network fees after retries
 */
export async function fetchMaxNetworkFees(provider: JsonRpcProvider): Promise<MaxNetworkFees> {
  let feeData = await provider.getFeeData();
  let fetchNetworkFeeCounter = 0;
  while (
    (!feeData.maxFeePerGas || !feeData.maxPriorityFeePerGas) &&
    fetchNetworkFeeCounter < serviceConstants.MAX_FETCH_NETWORK_FEES_RETRIES
  ) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    feeData = await provider.getFeeData();
    fetchNetworkFeeCounter++;
  }
  if (!feeData.maxFeePerGas || !feeData.maxPriorityFeePerGas) {
    throw new BlockchainStateError('Unable to fetch current network fees');
  }
  return {
    maxFeePerGas: feeData.maxFeePerGas,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
  };
}
