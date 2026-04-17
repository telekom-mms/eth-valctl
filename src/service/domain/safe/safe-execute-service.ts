import type SafeApiKit from '@safe-global/api-kit';
import type Safe from '@safe-global/protocol-kit';
import type { SafeMultisigTransactionResponse } from '@safe-global/types-kit';
import chalk from 'chalk';
import type { JsonRpcProvider } from 'ethers';
import prompts from 'prompts';

import * as application from '../../../constants/application';
import * as logging from '../../../constants/logging';
import type { PerTransactionFeeCheckConfig, SafeExecuteConfig } from '../../../model/safe';
import { FeeStatus } from '../../../model/safe';
import {
  extractErrorSummary,
  extractRevertReason,
  isViemInsufficientFundsError
} from '../error-utils';
import { withRateRetry } from './safe-api-retry';
import { handleFeeValidationResult, handleStaleFeeBeforeExecution } from './safe-fee-prompt';
import {
  validateSingleTransactionFee,
  validateTransactionFees,
  waitForSufficientFee
} from './safe-fee-validator';
import {
  countRejections,
  deduplicateByNonce,
  filterEthValctlTransactions
} from './safe-transaction-filter';

/**
 * Fetch, filter, and execute fully-signed Safe transactions on-chain
 *
 * Filters pending transactions by origin and system contract address,
 * selects only those with enough confirmations (threshold met),
 * deduplicates competing transactions at the same nonce (preferring rejections),
 * checks for nonce gaps, and executes sequentially in nonce order.
 * Fee validation is skipped when all transactions are rejections.
 *
 * @param config - Configuration with SDK instances and filter criteria
 * @throws Error if nonce gap detected, execution fails, or insufficient funds
 */
export async function executeReadyTransactions(config: SafeExecuteConfig): Promise<void> {
  const overpaymentThreshold =
    config.overpaymentThreshold ?? application.DEFAULT_FEE_OVERPAYMENT_THRESHOLD;
  const maxFeeWaitBlocks = config.maxFeeWaitBlocks ?? application.DEFAULT_MAX_FEE_WAIT_BLOCKS;

  const sorted = await loadExecutableTransactions(
    config.apiKit,
    config.safeAddress,
    config.systemContractAddresses,
    config.multiSendAddress
  );
  if (sorted.length === 0) return;

  const allRejections = countRejections(sorted, config.safeAddress) === sorted.length;

  if (!allRejections) {
    const feeResult = await validateTransactionFees({
      transactions: sorted,
      provider: config.provider,
      systemContractAddresses: config.systemContractAddresses,
      overpaymentThreshold
    });
    const action = await handleFeeValidationResult({
      feeValidationResult: feeResult,
      protocolKit: config.protocolKit,
      apiKit: config.apiKit,
      safeAddress: config.safeAddress,
      signerAddress: config.signerAddress,
      skipConfirmation: config.skipConfirmation,
      staleFeeAction: config.staleFeeAction
    });
    if (action !== application.FEE_ACTION_PROCEED) return;
  }

  await validateNonceSequence(config.protocolKit, sorted, config.safeAddress);

  if (!config.skipConfirmation) {
    const { confirmed } = await prompts({
      type: 'confirm',
      name: 'confirmed',
      message: logging.SAFE_EXECUTE_CONFIRM_PROMPT(sorted.length),
      initial: false
    });
    if (!confirmed) return;
  }

  let executedCount = 0;

  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) {
      const shouldAbort = await checkFeePerTransaction({
        transaction: sorted[i]!,
        provider: config.provider,
        systemContractAddresses: config.systemContractAddresses,
        overpaymentThreshold,
        maxFeeWaitBlocks,
        txIndex: i + 1,
        totalTxs: sorted.length,
        skipConfirmation: config.skipConfirmation,
        staleFeeAction: config.staleFeeAction
      });
      if (shouldAbort) {
        printRemainingHashes(sorted, i);
        process.exitCode = 1;
        return;
      }
    }

    try {
      await executeSingleTransaction(
        config.apiKit,
        config.protocolKit,
        config.provider,
        sorted[i]!,
        i + 1,
        sorted.length
      );
      executedCount++;
    } catch (error) {
      handleExecutionFailure(error, sorted[i]!.safeTxHash, sorted, i + 1);
      process.exitCode = 1;
      return;
    }
  }

  console.error(chalk.green(logging.SAFE_EXECUTION_COMPLETE_INFO(executedCount)));
}

/**
 * Check a single transaction's fee before execution and handle stale fees
 *
 * Returns true if execution should abort, false if execution should proceed.
 *
 * @param config - Per-transaction fee check configuration
 * @returns true if execution should abort
 */
async function checkFeePerTransaction(config: PerTransactionFeeCheckConfig): Promise<boolean> {
  const validation = await validateSingleTransactionFee(config);

  if (validation.status !== FeeStatus.STALE) {
    return false;
  }

  const promptResult = await handleStaleFeeBeforeExecution({
    validation,
    txIndex: config.txIndex,
    totalTxs: config.totalTxs,
    maxFeeWaitBlocks: config.maxFeeWaitBlocks,
    skipConfirmation: config.skipConfirmation,
    staleFeeAction: config.staleFeeAction
  });

  if (promptResult === application.FEE_ACTION_ABORT) {
    return true;
  }

  await waitForSufficientFee(config);

  return false;
}

/**
 * Load executable transactions from the Safe Transaction Service
 *
 * Fetches pending transactions, filters by eth-valctl origin and system
 * contract addresses, selects only those meeting the confirmation threshold,
 * deduplicates competing transactions at the same nonce, and sorts by
 * nonce in ascending order.
 *
 * @param apiKit - Safe API Kit instance
 * @param safeAddress - Safe multisig address
 * @param systemContractAddresses - Allowed system contract addresses
 * @param multiSendAddress - Optional MultiSend contract address
 * @returns Deduplicated executable transactions sorted by nonce, or empty array
 */
async function loadExecutableTransactions(
  apiKit: SafeApiKit,
  safeAddress: string,
  systemContractAddresses: string[],
  multiSendAddress?: string
): Promise<SafeMultisigTransactionResponse[]> {
  console.error(chalk.blue(logging.SAFE_FETCHING_EXECUTABLE_INFO(safeAddress)));

  const response = await withRateRetry(() => apiKit.getPendingTransactions(safeAddress));
  const filtered = filterEthValctlTransactions(
    response.results,
    systemContractAddresses,
    multiSendAddress
  );
  const executable = filtered.filter(isExecutable);

  if (executable.length === 0) {
    console.error(chalk.yellow(logging.SAFE_NO_EXECUTABLE_TXS_INFO));
    return [];
  }

  const sorted = sortByNonce(executable);
  return deduplicateByNonce(sorted, safeAddress);
}

/**
 * Validate that no nonce gaps exist between on-chain nonce and queued transactions
 *
 * @param protocolKit - Safe Protocol Kit instance
 * @param sorted - Transactions sorted by nonce in ascending order
 * @param safeAddress - Safe multisig address (for rejection count logging)
 * @throws Error if a nonce gap is detected
 */
async function validateNonceSequence(
  protocolKit: Safe,
  sorted: SafeMultisigTransactionResponse[],
  safeAddress: string
): Promise<void> {
  const lowestNonce = Number(sorted[0]!.nonce);
  const onChainNonce = await protocolKit.getNonce();

  if (lowestNonce > onChainNonce) {
    const gapCount = lowestNonce - onChainNonce;
    throw new Error(logging.SAFE_NONCE_GAP_ERROR(gapCount, onChainNonce, lowestNonce - 1));
  }

  const rejectionCount = countRejections(sorted, safeAddress);
  console.error(
    chalk.blue(logging.SAFE_FOUND_EXECUTABLE_INFO(sorted.length, rejectionCount || undefined))
  );
}

/**
 * Execute a single Safe transaction on-chain and wait for confirmation
 *
 * @param apiKit - Safe API Kit instance
 * @param protocolKit - Safe Protocol Kit instance
 * @param provider - JSON-RPC provider for receipt waiting
 * @param tx - Transaction to execute
 * @param index - 1-based index for progress logging
 * @param total - Total number of transactions
 */
async function executeSingleTransaction(
  apiKit: SafeApiKit,
  protocolKit: Safe,
  provider: JsonRpcProvider,
  tx: SafeMultisigTransactionResponse,
  index: number,
  total: number
): Promise<void> {
  const fullTx = await withRateRetry(() => apiKit.getTransaction(tx.safeTxHash));
  const result = await protocolKit.executeTransaction(fullTx);
  const receipt = await provider.waitForTransaction(result.hash);

  if (receipt?.status === 0) {
    const reason = await extractTransactionRevertReason(provider, result.hash, receipt.blockNumber);
    throw new Error(logging.SAFE_EXECUTE_REVERTED_ERROR(tx.safeTxHash, result.hash, reason));
  }

  console.error(
    chalk.green(
      logging.SAFE_EXECUTING_PROGRESS_INFO(
        index,
        total,
        tx.safeTxHash,
        result.hash,
        receipt?.blockNumber ?? 0
      )
    )
  );
}

/**
 * Attempt to extract the revert reason by replaying the failed transaction
 *
 * Fetches the original transaction and replays it via provider.call()
 * at the block it reverted in. If the replay throws a CALL_EXCEPTION,
 * the revert reason is extracted. This is best-effort — returns undefined
 * if the replay fails for any reason (missing archive state, RPC limits, etc).
 *
 * @param provider - JSON-RPC provider
 * @param txHash - Hash of the reverted transaction
 * @param blockNumber - Block number the transaction was mined in
 * @returns Revert reason string, or undefined if extraction fails
 */
async function extractTransactionRevertReason(
  provider: JsonRpcProvider,
  txHash: string,
  blockNumber: number
): Promise<string | undefined> {
  try {
    const tx = await provider.getTransaction(txHash);
    if (!tx) return undefined;

    await provider.call({
      to: tx.to,
      from: tx.from,
      data: tx.data,
      value: tx.value,
      gasLimit: tx.gasLimit,
      blockTag: blockNumber
    });
    return undefined;
  } catch (error) {
    return extractRevertReason(error);
  }
}

/**
 * Handle execution failure by logging error details and remaining hashes
 *
 * @param error - The caught error
 * @param safeTxHash - Hash of the failed transaction
 * @param sorted - All sorted transactions
 * @param startIndex - Index to start printing remaining hashes from
 */
function handleExecutionFailure(
  error: unknown,
  safeTxHash: string,
  sorted: SafeMultisigTransactionResponse[],
  startIndex: number
): void {
  const summary = isInsufficientFunds(error)
    ? logging.INSUFFICIENT_FUNDS_ERROR
    : extractErrorSummary(error);
  console.error(chalk.red(logging.SAFE_EXECUTE_FAILED_ERROR(safeTxHash, summary)));
  printRemainingHashes(sorted, startIndex);
}

/**
 * Check if a transaction has enough confirmations to be executed
 */
function isExecutable(tx: SafeMultisigTransactionResponse): boolean {
  return (tx.confirmations?.length ?? 0) >= tx.confirmationsRequired;
}

/**
 * Sort transactions by nonce in ascending order
 */
function sortByNonce(
  transactions: SafeMultisigTransactionResponse[]
): SafeMultisigTransactionResponse[] {
  return [...transactions].sort((a, b) => Number(a.nonce) - Number(b.nonce));
}

/**
 * Print remaining Safe TX hashes that were not executed
 */
function printRemainingHashes(
  transactions: SafeMultisigTransactionResponse[],
  startIndex: number
): void {
  const remaining = transactions.slice(startIndex);
  if (remaining.length === 0) return;

  console.error(chalk.red(logging.SAFE_EXECUTE_REMAINING_HASHES_HEADER));
  for (const tx of remaining) {
    console.error(tx.safeTxHash);
  }
}

/**
 * Check if an error is an INSUFFICIENT_FUNDS error
 */
function isInsufficientFunds(error: unknown): boolean {
  return isViemInsufficientFundsError(error);
}
