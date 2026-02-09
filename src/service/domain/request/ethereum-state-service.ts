import chalk from 'chalk';
import { JsonRpcProvider, toBeHex, toBigInt } from 'ethers';

import * as serviceConstants from '../../../constants/application';
import * as logging from '../../../constants/logging';
import type { MaxNetworkFees } from '../../../model/ethereum';
import { BlockchainStateError } from '../../../model/ethereum';

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
    try {
      const contractQueue = await this.provider.getStorage(this.systemContractAddress, toBeHex(0));
      const contractQueueValue = toBigInt(contractQueue);

      if (contractQueueValue === serviceConstants.EXCESS_INHIBITOR) {
        throw new BlockchainStateError(
          logging.SYSTEM_CONTRACT_NOT_ACTIVATED_ERROR(this.systemContractAddress)
        );
      }

      return this.calculateContractFee(contractQueueValue);
    } catch (error) {
      if (error instanceof BlockchainStateError) {
        throw error;
      }
      console.error(
        chalk.red(logging.FAILED_TO_FETCH_REQUIRED_FEE_ERROR(this.systemContractAddress)),
        error
      );
      throw new BlockchainStateError('Unable to fetch contract fee from system contract', error);
    }
  }

  /**
   * Calculates the contract fee for sending an execution layer request to a specific system contract
   *
   * @param numerator - The request queue length of a specific system contract
   * @returns The contract fee for sending an execution layer request
   */
  private calculateContractFee(numerator: bigint): bigint {
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
   * Get current max network fees per gas
   *
   * Fetches the current max network fees per gas without any modification.
   * Retries up to MAX_FETCH_NETWORK_FEES_RETRIES if fees are unavailable.
   *
   * @returns Current max network fees per gas
   * @throws BlockchainStateError if unable to fetch network fees
   */
  async getMaxNetworkFees(): Promise<MaxNetworkFees> {
    let feeData = await this.provider.getFeeData();
    let fetchNetworkFeeCounter = 0;
    while (
      (!feeData.maxFeePerGas || !feeData.maxPriorityFeePerGas) &&
      fetchNetworkFeeCounter < serviceConstants.MAX_FETCH_NETWORK_FEES_RETRIES
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      feeData = await this.provider.getFeeData();
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
}
