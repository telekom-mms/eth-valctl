import type { SafeMultisigTransactionResponse } from '@safe-global/types-kit';
import chalk from 'chalk';

import { PREFIX_0x, SAFE_ORIGIN } from '../../../constants/application';
import { SAFE_REJECTION_DEDUP_INFO } from '../../../constants/logging';

/**
 * Filter transactions by eth-valctl origin or system contract address
 *
 * Primary filter: origin === "eth-valctl"
 * Secondary filter: to address matches system contract or MultiSend address
 *
 * @param transactions - All pending transactions from TX Service
 * @param systemContractAddresses - Known system contract addresses
 * @param multiSendAddress - Optional MultiSend contract address
 * @returns Filtered transactions matching eth-valctl criteria
 */
export function filterEthValctlTransactions(
  transactions: SafeMultisigTransactionResponse[],
  systemContractAddresses: string[],
  multiSendAddress?: string
): SafeMultisigTransactionResponse[] {
  const knownAddresses = new Set(
    [...systemContractAddresses, ...(multiSendAddress ? [multiSendAddress] : [])].map((addr) =>
      addr.toLowerCase()
    )
  );

  return transactions.filter((tx) => {
    if (tx.origin === SAFE_ORIGIN) return true;
    return knownAddresses.has(tx.to.toLowerCase());
  });
}

/**
 * Check whether a Safe transaction is a rejection (cancellation) transaction
 *
 * Rejection transactions are zero-value calls from the Safe to itself with no calldata,
 * created by `protocolKit.createRejectionTransaction(nonce)` to cancel a pending
 * transaction at the same nonce.
 *
 * @param tx - Safe multisig transaction response
 * @param safeAddress - The Safe's own address
 * @returns True if the transaction is a rejection
 */
export function isRejectionTransaction(
  tx: SafeMultisigTransactionResponse,
  safeAddress: string
): boolean {
  return (
    tx.to.toLowerCase() === safeAddress.toLowerCase() && tx.value === '0' && isEmptyData(tx.data)
  );
}

/**
 * Deduplicate transactions at the same nonce, keeping one winner per nonce
 *
 * When a rejection transaction and an original coexist at the same nonce (both
 * executable), the rejection is preferred — it represents the user's explicit
 * intent to cancel. Among same-type transactions, the latest submission wins.
 *
 * @param transactions - Transactions sorted by nonce in ascending order
 * @param safeAddress - The Safe's own address (for rejection detection)
 * @returns Deduplicated transactions, one per nonce, in ascending nonce order
 */
export function deduplicateByNonce(
  transactions: SafeMultisigTransactionResponse[],
  safeAddress: string
): SafeMultisigTransactionResponse[] {
  const groups = groupByNonce(transactions);
  const result: SafeMultisigTransactionResponse[] = [];
  let totalDropped = 0;

  for (const [, group] of groups) {
    const priorizizedTransaction = selectPrioritizedTransaction(group, safeAddress);
    totalDropped += group.length - 1;
    result.push(priorizizedTransaction);
  }

  if (totalDropped > 0) {
    console.error(chalk.blue(SAFE_REJECTION_DEDUP_INFO(totalDropped)));
  }

  return result;
}

/**
 * Count how many transactions in a list are rejection transactions
 *
 * @param transactions - Transactions to inspect
 * @param safeAddress - The Safe's own address (for rejection detection)
 * @returns Number of rejection transactions
 */
export function countRejections(
  transactions: SafeMultisigTransactionResponse[],
  safeAddress: string
): number {
  return transactions.filter((tx) => isRejectionTransaction(tx, safeAddress)).length;
}

/**
 * @param transactions - Transactions sorted by nonce in ascending order
 * @returns Map of nonce to transactions at that nonce, preserving insertion order
 */
function groupByNonce(
  transactions: SafeMultisigTransactionResponse[]
): Map<number, SafeMultisigTransactionResponse[]> {
  const groups = new Map<number, SafeMultisigTransactionResponse[]>();

  for (const tx of transactions) {
    const nonce = Number(tx.nonce);
    const existing = groups.get(nonce);

    if (existing) {
      existing.push(tx);
    } else {
      groups.set(nonce, [tx]);
    }
  }

  return groups;
}

/**
 * Select the transaction with highest priority from a group sharing the same nonce
 *
 * Rejection transactions are preferred over originals. Among same-type
 * transactions, the one with the latest submission date wins.
 *
 * @param group - All transactions at a single nonce (at least one)
 * @param safeAddress - The Safe's own address
 * @returns The transaction to keep
 */
function selectPrioritizedTransaction(
  group: SafeMultisigTransactionResponse[],
  safeAddress: string
): SafeMultisigTransactionResponse {
  if (group.length === 1) {
    return group[0]!;
  }

  const rejections = group.filter((tx) => isRejectionTransaction(tx, safeAddress));

  if (rejections.length > 0) {
    return latestBySubmissionDate(rejections);
  }

  return latestBySubmissionDate(group);
}

/**
 * @param transactions - Non-empty array of transactions
 * @returns The transaction with the latest submissionDate
 */
function latestBySubmissionDate(
  transactions: SafeMultisigTransactionResponse[]
): SafeMultisigTransactionResponse {
  return transactions.reduce((latest, tx) =>
    new Date(tx.submissionDate) > new Date(latest.submissionDate) ? tx : latest
  );
}

/**
 * @param data - Transaction data field (may be undefined, empty, or "0x")
 * @returns True if the data represents no calldata
 */
function isEmptyData(data: string | undefined): boolean {
  return !data || data === PREFIX_0x || data === '';
}
