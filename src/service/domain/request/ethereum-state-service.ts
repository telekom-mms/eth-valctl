import chalk from 'chalk';
import { formatUnits, JsonRpcProvider, toBeHex, toBigInt } from 'ethers';

import * as serviceConstants from '../../../constants/application';
import {
  FAILED_TO_FETCH_REQUIRED_FEE_ERROR,
  MAX_FEE_PER_GAS_EXCEEDED_ERROR,
  MAX_FEE_PER_GAS_WAITING_INFO,
  MAX_FEE_WAITING_INFO,
  SYSTEM_CONTRACT_NOT_ACTIVATED_ERROR
} from '../../../constants/logging';
import type { ContractFeeState, MaxNetworkFees } from '../../../model/ethereum';
import { BlockchainStateError } from '../../../model/ethereum';
import { TransactionProgressLogger } from './transaction-progress-logger';

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

      const fee = EthereumStateService.calculateContractFee(excess);
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
   * Wait until the contract fee drops to or below the specified maximum
   *
   * Detects the next block by polling for a block number change (every 2s),
   * then rechecks the fee. Logs current block number on each wait cycle.
   *
   * @param maxFee - Maximum acceptable contract fee in wei
   * @returns The current contract fee once it is within the acceptable range
   */
  async waitForContractFee(maxFee: bigint): Promise<bigint> {
    let currentBlock = await this.fetchBlockNumber();
    while (true) {
      const fee = await this.fetchContractFee();
      if (fee <= maxFee) return fee;
      console.error(
        chalk.yellow(
          MAX_FEE_WAITING_INFO(
            TransactionProgressLogger.formatFeeForDisplay(fee),
            TransactionProgressLogger.formatFeeForDisplay(maxFee),
            currentBlock
          )
        )
      );

      currentBlock = await this.waitForNextBlock(currentBlock);
    }
  }

  /**
   * Wait until the max fee per gas drops to or below the specified maximum
   *
   * Polls for block number change (every 2s) up to maxBlocks times, then throws.
   * Logs progress showing blocks remaining on each wait cycle.
   *
   * @param cap - Maximum acceptable max fee per gas in wei
   * @param maxBlocks - Maximum number of blocks to wait before throwing (default 32 = 1 epoch)
   * @throws BlockchainStateError if fee does not drop within maxBlocks
   */
  async waitForMaxFeePerGas(
    cap: bigint,
    maxBlocks: number = serviceConstants.MAX_FEE_PER_GAS_WAIT_BLOCKS
  ): Promise<void> {
    let currentBlock = await this.fetchBlockNumber();
    let blocksWaited = 0;
    while (true) {
      const fees = await this.getMaxNetworkFees();
      if (fees.maxFeePerGas <= cap) return;
      blocksWaited++;
      const remaining = maxBlocks - blocksWaited;
      const currentFeeGwei = formatUnits(fees.maxFeePerGas, 'gwei');
      const capGwei = formatUnits(cap, 'gwei');
      console.error(
        chalk.yellow(MAX_FEE_PER_GAS_WAITING_INFO(currentFeeGwei, capGwei, currentBlock, remaining))
      );
      if (blocksWaited >= maxBlocks) {
        throw new BlockchainStateError(MAX_FEE_PER_GAS_EXCEEDED_ERROR(capGwei, maxBlocks));
      }
      currentBlock = await this.waitForNextBlock(currentBlock);
    }
  }

  /**
   * Wait for the block number to advance past the given block
   *
   * Polls every BLOCK_CHANGE_POLL_INTERVAL_MS until a new block is detected.
   *
   * @param block - The current block number to advance past
   * @returns The new block number
   * @throws BlockchainStateError if unable to fetch block number
   */
  private async waitForNextBlock(block: number): Promise<number> {
    while (true) {
      await new Promise((resolve) =>
        setTimeout(resolve, serviceConstants.TRANSACTION_RECEIPT_POLL_INTERVAL_MS)
      );
      const newBlock = await this.fetchBlockNumber();
      if (newBlock !== block) return newBlock;
    }
  }

  /**
   * Calculates the contract fee for sending an execution layer request to a specific system contract
   *
   * @param numerator - The excess value (queue length) of a specific system contract
   * @returns The contract fee for sending an execution layer request
   */
  static calculateContractFee(numerator: bigint): bigint {
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
