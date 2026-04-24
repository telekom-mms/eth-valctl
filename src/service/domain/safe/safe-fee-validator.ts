import type { SafeMultisigTransactionResponse } from '@safe-global/types-kit';
import chalk from 'chalk';
import type { JsonRpcProvider } from 'ethers';

import {
  FEE_WAIT_POLL_INTERVAL_MS,
  TARGET_PER_BLOCK_BY_CONTRACT
} from '../../../constants/application';
import * as logging from '../../../constants/logging';
import type { ContractFeeState } from '../../../model/ethereum';
import type {
  BatchFeeValidationConfig,
  FeeValidationResult,
  FeeWaitConfig,
  SingleFeeValidationConfig,
  TransactionFeeInfo,
  TransactionFeeValidation
} from '../../../model/safe';
import { FeeStatus } from '../../../model/safe';
import { EthereumStateService } from '../request/ethereum-state-service';
import { extractFeeInfo } from './safe-fee-extractor';
import { sleep } from './safe-utils';

/**
 * Validate contract fees for pending Safe transactions against current on-chain fees
 *
 * For each transaction, extracts the frozen proposed fee and compares against
 * the current system contract fee. Classifies each as SUFFICIENT, STALE,
 * OVERPAID, or UNVALIDATED (when fee read fails).
 *
 * @param config - Validation configuration with transactions and provider
 * @returns Aggregated validation result with per-transaction details
 */
export async function validateTransactionFees(
  config: BatchFeeValidationConfig
): Promise<FeeValidationResult> {
  console.error(chalk.blue(logging.SAFE_FEE_VALIDATING_INFO));

  const feeStates = await fetchCurrentFeeStates(config.provider, config.systemContractAddresses);
  const validations = classifyTransactions(
    config.transactions,
    config.systemContractAddresses,
    feeStates,
    config.overpaymentThreshold
  );

  return {
    validations,
    hasStale: validations.some((v) => v.status === FeeStatus.STALE),
    hasUnvalidated: validations.some((v) => v.status === FeeStatus.UNVALIDATED)
  };
}

/**
 * Fetch current fee state for each unique system contract address
 *
 * @param provider - JSON-RPC provider for storage reads
 * @param systemContractAddresses - Contract addresses to query
 * @returns Map of contract address (lowercased) to fee state, absent on read failure
 */
async function fetchCurrentFeeStates(
  provider: JsonRpcProvider,
  systemContractAddresses: string[]
): Promise<Map<string, ContractFeeState>> {
  const feeStates = new Map<string, ContractFeeState>();

  for (const address of systemContractAddresses) {
    try {
      const service = new EthereumStateService(provider, address);
      const state = await service.fetchContractFeeWithExcess();
      feeStates.set(address.toLowerCase(), state);
    } catch (error) {
      console.error(error);
    }
  }

  return feeStates;
}

/**
 * Classify each transaction's fee status by comparing proposed vs current fee
 *
 * Transactions not targeting a system contract (e.g. rejection transactions)
 * are excluded from the result.
 *
 * @param transactions - Pending Safe transactions to validate
 * @param systemContractAddresses - Known system contract addresses
 * @param feeStates - Current fee states keyed by lowercased contract address
 * @param overpaymentThreshold - Wei threshold above which overpayment is flagged
 * @returns Validation results for fee-bearing transactions only
 */
function classifyTransactions(
  transactions: SafeMultisigTransactionResponse[],
  systemContractAddresses: string[],
  feeStates: Map<string, ContractFeeState>,
  overpaymentThreshold: bigint
): TransactionFeeValidation[] {
  return transactions.flatMap((tx) => {
    const feeInfo = extractFeeInfo(tx, systemContractAddresses);

    if (!feeInfo) {
      return [];
    }

    const state = feeStates.get(feeInfo.contractAddress.toLowerCase());

    if (!state) {
      return [createUnvalidatedResult(tx, feeInfo)];
    }

    return [classifySingleTransaction(tx, feeInfo, state, overpaymentThreshold)];
  });
}

/**
 * Classify a single transaction's fee against current on-chain state
 */
export function classifySingleTransaction(
  tx: SafeMultisigTransactionResponse,
  feeInfo: TransactionFeeInfo,
  state: ContractFeeState,
  overpaymentThreshold: bigint
): TransactionFeeValidation {
  const { fee: currentFee, excess: currentExcess } = state;

  if (feeInfo.proposedFee < currentFee) {
    const estimatedBlocks = estimateBlocksUntilFeeDrops(
      currentExcess,
      feeInfo.proposedFee,
      feeInfo.contractAddress
    );

    return {
      transaction: tx,
      status: FeeStatus.STALE,
      proposedFee: feeInfo.proposedFee,
      currentFee,
      contractAddress: feeInfo.contractAddress,
      estimatedBlocks
    };
  }

  if (feeInfo.proposedFee > currentFee + overpaymentThreshold) {
    return {
      transaction: tx,
      status: FeeStatus.OVERPAID,
      proposedFee: feeInfo.proposedFee,
      currentFee,
      contractAddress: feeInfo.contractAddress,
      overpaymentAmount: feeInfo.proposedFee - currentFee
    };
  }

  return {
    transaction: tx,
    status: FeeStatus.SUFFICIENT,
    proposedFee: feeInfo.proposedFee,
    currentFee,
    contractAddress: feeInfo.contractAddress
  };
}

/**
 * Create an UNVALIDATED result for transactions where fee extraction or read failed
 */
function createUnvalidatedResult(
  tx: SafeMultisigTransactionResponse,
  feeInfo?: { proposedFee: bigint; contractAddress: string }
): TransactionFeeValidation {
  return {
    transaction: tx,
    status: FeeStatus.UNVALIDATED,
    proposedFee: feeInfo?.proposedFee ?? 0n,
    contractAddress: feeInfo?.contractAddress ?? tx.to
  };
}

/**
 * Estimate blocks until the contract fee drops to a target level
 *
 * Uses binary search to find the excess value where `calculateContractFee(excess) <= targetFee`,
 * then calculates blocks as `ceil((currentExcess - targetExcess) / targetPerBlock)`.
 *
 * @param params - Current excess, target fee, and contract address for rate lookup
 * @returns Estimated number of blocks, or 0n if fee is already at or below target
 */
function estimateBlocksUntilFeeDrops(
  currentExcess: bigint,
  targetFee: bigint,
  systemContractAddress: string
): bigint {
  const targetPerBlock = TARGET_PER_BLOCK_BY_CONTRACT[systemContractAddress.toLowerCase()] ?? 1n;

  if (targetFee <= 0n) {
    return currentExcess / targetPerBlock + 1n;
  }

  const targetExcess = binarySearchMaxExcess(targetFee);

  if (currentExcess <= targetExcess) {
    return 0n;
  }

  const excessDelta = currentExcess - targetExcess;
  return (excessDelta + targetPerBlock - 1n) / targetPerBlock;
}

/**
 * Binary search for the largest excess where calculateContractFee(excess) does not exceed targetFee
 *
 * The fee function is monotonically increasing with excess, making binary search valid.
 *
 * @param targetFee - The fee threshold to search for
 * @returns Largest excess value that produces a fee at or below targetFee
 */
function binarySearchMaxExcess(targetFee: bigint): bigint {
  let low = 0n;
  let high = 1n;

  while (EthereumStateService.calculateContractFee(high) <= targetFee) {
    high *= 2n;
  }

  while (low < high - 1n) {
    const mid = (low + high) / 2n;
    if (EthereumStateService.calculateContractFee(mid) <= targetFee) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return low;
}

/**
 * Validate a single Safe transaction's fee against the current on-chain state
 *
 * Performs a fresh on-chain fee read and classifies the transaction's proposed fee
 * as SUFFICIENT, STALE, OVERPAID, or UNVALIDATED.
 *
 * @param config - Single transaction validation configuration
 * @returns Fee validation result for the transaction
 */
export async function validateSingleTransactionFee(
  config: SingleFeeValidationConfig
): Promise<TransactionFeeValidation> {
  const feeInfo = extractFeeInfo(config.transaction, config.systemContractAddresses);

  if (!feeInfo) {
    return createUnvalidatedResult(config.transaction);
  }

  try {
    const service = new EthereumStateService(config.provider, feeInfo.contractAddress);
    const state = await service.fetchContractFeeWithExcess();
    return classifySingleTransaction(
      config.transaction,
      feeInfo,
      state,
      config.overpaymentThreshold
    );
  } catch {
    return createUnvalidatedResult(config.transaction, feeInfo);
  }
}

/**
 * Wait for a stale transaction's fee to become sufficient by polling the on-chain state
 *
 * Polls every slot (12s) until the fee drops to or below the proposed level,
 * or the maximum wait block count is exceeded.
 *
 * @param config - Fee wait configuration with transaction, provider, and limits
 * @returns Fee validation result once fee is no longer stale
 * @throws Error if fee does not drop within maxWaitBlocks
 */
export async function waitForSufficientFee(
  config: FeeWaitConfig
): Promise<TransactionFeeValidation> {
  let blocksWaited = 0;

  while (BigInt(blocksWaited) < config.maxFeeWaitBlocks) {
    await sleep(FEE_WAIT_POLL_INTERVAL_MS);
    blocksWaited++;

    const validation = await validateSingleTransactionFee(config);

    if (validation.status !== FeeStatus.STALE) {
      console.error(
        chalk.green(logging.SAFE_FEE_WAIT_SUCCESS_INFO(config.txIndex, config.totalTxs))
      );
      return validation;
    }

    console.error(
      chalk.yellow(logging.SAFE_FEE_WAIT_PROGRESS_INFO(blocksWaited, validation.estimatedBlocks))
    );
  }

  throw new Error(
    logging.SAFE_FEE_WAIT_EXCEEDED_ERROR(config.txIndex, config.totalTxs, config.maxFeeWaitBlocks)
  );
}
