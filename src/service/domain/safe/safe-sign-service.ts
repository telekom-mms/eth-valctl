import type SafeApiKit from '@safe-global/api-kit';
import type Safe from '@safe-global/protocol-kit';
import type { SafeMultisigTransactionResponse } from '@safe-global/types-kit';
import chalk from 'chalk';
import prompts from 'prompts';

import * as logging from '../../../constants/logging';
import { withRateRetry } from './safe-api-retry';
import {
  countRejections,
  deduplicateByNonce,
  filterEthValctlTransactions
} from './safe-transaction-filter';

/**
 * Configuration for signing pending Safe transactions
 */
export interface SafeSignConfig {
  apiKit: SafeApiKit;
  protocolKit: Safe;
  safeAddress: string;
  signerAddress: string;
  systemContractAddresses: string[];
  multiSendAddress?: string;
  skipConfirmation?: boolean;
  threshold?: number;
}

/**
 * Fetch, filter, and sign pending Safe transactions created by eth-valctl
 *
 * Filters pending transactions by origin ("eth-valctl") or by system contract
 * address. Deduplicates competing transactions at the same nonce (preferring
 * rejections). Skips already-signed transactions. Signs and submits
 * confirmations for remaining transactions.
 *
 * @param config - Configuration with SDK instances and filter criteria
 * @throws Error if any confirmation submission fails
 */
export async function signPendingTransactions(config: SafeSignConfig): Promise<void> {
  const toSign = await loadSignableTransactions(
    config.apiKit,
    config.safeAddress,
    config.signerAddress,
    config.systemContractAddresses,
    config.multiSendAddress
  );
  if (!toSign) return;

  if (!config.skipConfirmation) {
    const { confirmed } = await prompts({
      type: 'confirm',
      name: 'confirmed',
      message: logging.SAFE_SIGN_CONFIRM_PROMPT(toSign.length),
      initial: false
    });
    if (!confirmed) return;
  }

  let signedCount = 0;

  for (let i = 0; i < toSign.length; i++) {
    await signSingleTransaction(
      config.apiKit,
      config.protocolKit,
      toSign[i]!,
      i + 1,
      toSign.length
    );
    signedCount++;
  }

  printCompletionSummary(toSign, signedCount, config.safeAddress, config.threshold);
}

/**
 * Load transactions that need signing from the Safe Transaction Service
 *
 * Fetches pending transactions, filters by eth-valctl origin and system
 * contract addresses, deduplicates competing transactions at the same nonce,
 * partitions by signature status, and prints a summary.
 *
 * @param apiKit - Safe API Kit instance
 * @param safeAddress - Safe multisig address
 * @param signerAddress - Address of the current signer
 * @param systemContractAddresses - Allowed system contract addresses
 * @param multiSendAddress - Optional MultiSend contract address
 * @returns Transactions needing signature, or null if none found
 */
async function loadSignableTransactions(
  apiKit: SafeApiKit,
  safeAddress: string,
  signerAddress: string,
  systemContractAddresses: string[],
  multiSendAddress?: string
): Promise<SafeMultisigTransactionResponse[] | null> {
  console.error(chalk.blue(logging.SAFE_FETCHING_PENDING_INFO(safeAddress)));

  const response = await withRateRetry(() => apiKit.getPendingTransactions(safeAddress));
  const filtered = filterEthValctlTransactions(
    response.results,
    systemContractAddresses,
    multiSendAddress
  );

  if (filtered.length === 0) {
    console.error(chalk.yellow(logging.SAFE_NO_PENDING_TXS_INFO));
    return null;
  }

  const deduplicated = deduplicateByNonce(filtered, safeAddress);
  const { toSign, alreadySignedCount } = partitionBySignatureStatus(deduplicated, signerAddress);

  if (toSign.length === 0) {
    console.error(chalk.yellow(logging.SAFE_ALL_ALREADY_SIGNED_INFO(alreadySignedCount)));
    return null;
  }

  const rejectionCount = countRejections(deduplicated, safeAddress);
  printSummary(deduplicated, alreadySignedCount, rejectionCount);
  return toSign;
}

/**
 * Sign a single pending Safe transaction and submit confirmation
 *
 * @param apiKit - Safe API Kit instance
 * @param protocolKit - Safe Protocol Kit instance
 * @param tx - Transaction to sign
 * @param index - 1-based index for progress logging
 * @param total - Total number of transactions to sign
 * @throws Error if confirmation submission fails
 */
async function signSingleTransaction(
  apiKit: SafeApiKit,
  protocolKit: Safe,
  tx: SafeMultisigTransactionResponse,
  index: number,
  total: number
): Promise<void> {
  const safeTxHash = tx.safeTxHash;
  const signature = await protocolKit.signHash(safeTxHash);

  try {
    await withRateRetry(() => apiKit.confirmTransaction(safeTxHash, signature.data));
    console.error(chalk.green(logging.SAFE_SIGNING_PROGRESS_INFO(index, total, safeTxHash)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(logging.SAFE_SIGN_FAILED_ERROR(safeTxHash, message)));
    throw error;
  }
}

/**
 * Print signing completion summary with threshold status
 *
 * @param toSign - Transactions that were signed
 * @param signedCount - Number of successfully signed transactions
 * @param safeAddress - Safe multisig address (for next-step guidance)
 * @param threshold - Optional confirmation threshold override
 */
function printCompletionSummary(
  toSign: SafeMultisigTransactionResponse[],
  signedCount: number,
  safeAddress: string,
  threshold?: number
): void {
  const minExistingConfirmations = Math.min(...toSign.map((tx) => tx.confirmations?.length ?? 0));
  const confirmationCount = minExistingConfirmations + 1;
  const thresholdValue = threshold ?? toSign[0]?.confirmationsRequired ?? 2;
  console.error(
    chalk.green(logging.SAFE_SIGNING_COMPLETE_INFO(signedCount, confirmationCount, thresholdValue))
  );

  if (confirmationCount >= thresholdValue) {
    console.error(chalk.blue(logging.SAFE_EXECUTE_NEXT_STEP_INFO(safeAddress)));
  }
}

/**
 * Partition transactions into those needing signature and already-signed
 *
 * @param transactions - Filtered pending transactions
 * @param signerAddress - Address of the current signer
 * @returns Transactions to sign and count of already-signed
 */
function partitionBySignatureStatus(
  transactions: SafeMultisigTransactionResponse[],
  signerAddress: string
): { toSign: SafeMultisigTransactionResponse[]; alreadySignedCount: number } {
  const normalizedSigner = signerAddress.toLowerCase();
  const toSign: SafeMultisigTransactionResponse[] = [];
  let alreadySignedCount = 0;

  for (const tx of transactions) {
    const alreadySigned = tx.confirmations?.some((c) => c.owner.toLowerCase() === normalizedSigner);
    if (alreadySigned) {
      alreadySignedCount++;
    } else {
      toSign.push(tx);
    }
  }

  return { toSign, alreadySignedCount };
}

/**
 * Print summary of pending transactions before signing
 */
function printSummary(
  all: SafeMultisigTransactionResponse[],
  alreadySignedCount: number,
  rejectionCount: number
): void {
  console.error(
    chalk.blue(logging.SAFE_FOUND_PENDING_INFO(all.length, rejectionCount || undefined))
  );
  console.error(chalk.blue(logging.SAFE_SIGN_SUMMARY_ALREADY_SIGNED(alreadySignedCount)));
}
