import { ethers } from 'ethers';

import type { ConfirmationRecord, SafeInfoRecord, TransactionRecord } from './types';

const SAFE_ABI = [
  'function getOwners() view returns (address[])',
  'function getThreshold() view returns (uint256)',
  'function nonce() view returns (uint256)',
  'function VERSION() view returns (string)',
  'function getModulesPaginated(address start, uint256 pageSize) view returns (address[] array, address next)',
  'function fallbackHandler() view returns (address)'
];

const SENTINEL_ADDRESS = '0x0000000000000000000000000000000000000001';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * In-memory store for the mock Safe Transaction Service.
 *
 * Stores Safe info and transactions in Maps. Safe info is lazily loaded
 * from the chain on first access via the Safe proxy contract ABI.
 */
export class TransactionStore {
  private readonly safes = new Map<string, SafeInfoRecord>();
  private readonly transactions = new Map<string, TransactionRecord>();
  private readonly provider: ethers.JsonRpcProvider;
  private failAfterCount: number | undefined;
  private hidePending = false;

  constructor(rpcUrl: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
  }

  /**
   * Get Safe info, reading from chain if not cached
   */
  async getSafeInfo(address: string): Promise<SafeInfoRecord | null> {
    const key = address.toLowerCase();
    const cached = this.safes.get(key);
    if (cached) {
      return this.refreshOnChainState(cached);
    }

    return this.loadSafeFromChain(address);
  }

  /**
   * Store a proposed transaction with its initial confirmation
   *
   * @throws Error when failAfterCount reaches zero (injected failure for testing)
   */
  addTransaction(tx: TransactionRecord): void {
    if (this.failAfterCount !== undefined) {
      if (this.failAfterCount <= 0) {
        throw new Error('Injected proposal failure (failAfterCount exhausted)');
      }
      this.failAfterCount--;
    }
    this.transactions.set(tx.safeTxHash, tx);
  }

  /**
   * Set the failure injection counter — after this many successful addTransaction
   * calls, the next one throws an error
   *
   * @param count - Number of successful proposals before failure
   */
  setFailAfterCount(count: number): void {
    this.failAfterCount = count;
  }

  /**
   * Clear the failure injection counter
   */
  resetFailAfter(): void {
    this.failAfterCount = undefined;
  }

  /**
   * Hide pending transactions from query results.
   *
   * When enabled, getPendingTransactions() returns empty results, which
   * tricks SafeApiKit's client-side getNextNonce() into returning the
   * on-chain nonce. Transactions remain in the store and are still found
   * by hasTransaction() — enabling duplicate proposal detection testing.
   *
   * @param hide - Whether to hide pending transactions
   */
  setHidePending(hide: boolean): void {
    this.hidePending = hide;
  }

  /**
   * Remove all pending (non-executed) transactions from the store.
   *
   * Used between test phases to prevent leftover pending nonces from
   * shifting subsequent proposals.
   */
  clearPendingTransactions(): void {
    for (const [hash, tx] of this.transactions) {
      if (!tx.isExecuted) {
        this.transactions.delete(hash);
      }
    }
  }

  /**
   * Get a single transaction by safeTxHash
   */
  getTransaction(safeTxHash: string): TransactionRecord | undefined {
    return this.transactions.get(safeTxHash);
  }

  /**
   * Add a confirmation to an existing transaction
   */
  addConfirmation(safeTxHash: string, confirmation: ConfirmationRecord): boolean {
    const tx = this.transactions.get(safeTxHash);
    if (!tx) return false;

    const alreadySigned = tx.confirmations.some(
      (c) => c.owner.toLowerCase() === confirmation.owner.toLowerCase()
    );
    if (alreadySigned) return false;

    tx.confirmations.push(confirmation);
    tx.modified = new Date().toISOString();
    return true;
  }

  /**
   * Mark a transaction as executed (called when we detect on-chain execution)
   */
  markExecuted(safeTxHash: string, transactionHash: string, blockNumber: number): void {
    const tx = this.transactions.get(safeTxHash);
    if (!tx) return;

    tx.isExecuted = true;
    tx.isSuccessful = true;
    tx.executionDate = new Date().toISOString();
    tx.transactionHash = transactionHash;
    tx.blockNumber = blockNumber;
  }

  /**
   * Get pending (non-executed) transactions for a Safe, filtered by nonce.
   *
   * Performs nonce-based reconciliation first: any pending transaction whose
   * nonce is below the current on-chain Safe nonce has already been executed
   * and is marked as such. This compensates for the lack of a chain indexer.
   */
  async getPendingTransactions(
    safeAddress: string,
    nonceGte?: number,
    limit = 100,
    offset = 0
  ): Promise<{ results: TransactionRecord[]; count: number }> {
    if (this.hidePending) {
      return { results: [], count: 0 };
    }

    const safeLower = safeAddress.toLowerCase();

    const safeInfo = await this.getSafeInfo(safeAddress);
    const onChainNonce = safeInfo ? Number(safeInfo.nonce) : 0;

    for (const tx of this.transactions.values()) {
      if (
        tx.safe.toLowerCase() === safeLower &&
        !tx.isExecuted &&
        Number(tx.nonce) < onChainNonce
      ) {
        tx.isExecuted = true;
        tx.isSuccessful = true;
        tx.executionDate = new Date().toISOString();
      }
    }

    const all = Array.from(this.transactions.values())
      .filter((tx) => tx.safe.toLowerCase() === safeLower && !tx.isExecuted)
      .filter((tx) => (nonceGte !== undefined ? Number(tx.nonce) >= nonceGte : true))
      .sort((a, b) => Number(b.nonce) - Number(a.nonce));

    return {
      count: all.length,
      results: all.slice(offset, offset + limit)
    };
  }

  /**
   * Get all multisig transactions for a Safe with optional filters
   */
  getMultisigTransactions(
    safeAddress: string,
    filters: { executed?: boolean; nonce?: string; limit?: number; offset?: number }
  ): { results: TransactionRecord[]; count: number } {
    const safeLower = safeAddress.toLowerCase();
    let all = Array.from(this.transactions.values()).filter(
      (tx) => tx.safe.toLowerCase() === safeLower
    );

    if (filters.executed !== undefined) {
      all = all.filter((tx) => tx.isExecuted === filters.executed);
    }
    if (filters.nonce !== undefined) {
      all = all.filter((tx) => tx.nonce === filters.nonce);
    }

    all.sort((a, b) => Number(b.nonce) - Number(a.nonce));

    const limit = filters.limit ?? 100;
    const offset = filters.offset ?? 0;

    return {
      count: all.length,
      results: all.slice(offset, offset + limit)
    };
  }

  /**
   * Compute next nonce for a Safe (max of on-chain nonce and highest pending + 1)
   */
  async getNextNonce(safeAddress: string): Promise<number> {
    const safeInfo = await this.getSafeInfo(safeAddress);
    const onChainNonce = safeInfo ? Number(safeInfo.nonce) : 0;

    const { results } = await this.getPendingTransactions(safeAddress);
    if (results.length === 0) return onChainNonce;

    const maxPendingNonce = Math.max(...results.map((tx) => Number(tx.nonce)));
    return Math.max(onChainNonce, maxPendingNonce + 1);
  }

  /**
   * Check if a transaction with the given safeTxHash already exists
   */
  hasTransaction(safeTxHash: string): boolean {
    return this.transactions.has(safeTxHash);
  }

  private async loadSafeFromChain(address: string): Promise<SafeInfoRecord | null> {
    try {
      const code = await this.provider.getCode(address);
      if (code === '0x') return null;

      const safe = new ethers.Contract(address, SAFE_ABI, this.provider) as ethers.Contract & {
        getOwners: () => Promise<string[]>;
        getThreshold: () => Promise<bigint>;
        nonce: () => Promise<bigint>;
        VERSION: () => Promise<string>;
        fallbackHandler: () => Promise<string>;
        getModulesPaginated: (start: string, limit: number) => Promise<[string[], string]>;
      };

      const [owners, threshold, nonce, version] = await Promise.all([
        safe.getOwners(),
        safe.getThreshold(),
        safe.nonce(),
        safe.VERSION()
      ]);

      let fallbackHandler = ZERO_ADDRESS;
      try {
        fallbackHandler = await safe.fallbackHandler();
      } catch {
        // fallbackHandler storage read may fail on some versions
      }

      let modules: string[] = [];
      try {
        const [moduleList] = await safe.getModulesPaginated(SENTINEL_ADDRESS, 10);
        modules = moduleList;
      } catch {
        // modules may not be configured
      }

      const record: SafeInfoRecord = {
        address: ethers.getAddress(address),
        nonce: nonce.toString(),
        threshold: Number(threshold),
        owners: owners.map((o: string) => ethers.getAddress(o)),
        singleton: ZERO_ADDRESS,
        modules,
        fallbackHandler,
        guard: ZERO_ADDRESS,
        version
      };

      this.safes.set(address.toLowerCase(), record);
      return record;
    } catch (error) {
      console.error(`[store] Failed to load Safe ${address} from chain:`, error);
      return null;
    }
  }

  private async refreshOnChainState(record: SafeInfoRecord): Promise<SafeInfoRecord> {
    try {
      const safe = new ethers.Contract(
        record.address,
        SAFE_ABI,
        this.provider
      ) as ethers.Contract & {
        nonce: () => Promise<bigint>;
        getThreshold: () => Promise<bigint>;
      };
      const [nonce, threshold] = await Promise.all([safe.nonce(), safe.getThreshold()]);
      record.nonce = nonce.toString();
      record.threshold = Number(threshold);
    } catch {
      // keep cached values on failure
    }
    return record;
  }
}
