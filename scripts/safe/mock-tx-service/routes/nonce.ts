import type { TransactionStore } from '../store';

/**
 * Nonce computation for the mock TX Service.
 *
 * SafeApiKit's getNextNonce() doesn't call a dedicated endpoint — it calls
 * getPendingTransactions() and computes the nonce client-side. This module
 * provides the store-level nonce logic used by other routes.
 *
 * Algorithm (mirrors SafeApiKit):
 * 1. Get pending transactions for the Safe
 * 2. If any pending: nextNonce = max(pendingNonces) + 1
 * 3. Otherwise: nextNonce = on-chain nonce from Safe contract
 */
export async function getNextNonce(store: TransactionStore, safeAddress: string): Promise<number> {
  return store.getNextNonce(safeAddress);
}
