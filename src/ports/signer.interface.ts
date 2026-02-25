import type { TransactionResponse } from 'ethers';

import type { ExecutionLayerRequestTransaction, SigningContext } from '../model/ethereum';

/**
 * Signer capabilities indicating supported features
 */
export interface SignerCapabilities {
  /** Whether the signer can process multiple transactions in parallel */
  supportsParallelSigning: boolean;
}

/**
 * Abstraction for transaction signing that supports different signing backends
 *
 * Implementations include software wallets (private key) and hardware wallets (Ledger).
 * The interface allows the transaction broadcasting layer to adapt its strategy
 * based on signer capabilities.
 */
export interface ISigner {
  /** Capabilities of this signer for strategy selection */
  readonly capabilities: SignerCapabilities;
  /** Ethereum address of the signer */
  readonly address: string;

  /**
   * Send a transaction using the next available nonce
   *
   * For wallet signers, nonce is managed automatically.
   * For Ledger signers, nonce is fetched and tracked internally.
   *
   * @param tx - Transaction to sign and send
   * @param context - Optional signing context for interactive signers (e.g., Ledger prompts)
   * @returns Transaction response from the network
   */
  sendTransaction(
    tx: ExecutionLayerRequestTransaction,
    context?: SigningContext
  ): Promise<TransactionResponse>;

  /**
   * Send a transaction with an explicit nonce
   *
   * Used for transaction replacement where the same nonce must be reused.
   *
   * @param tx - Transaction to sign and send
   * @param nonce - Explicit nonce to use
   * @param context - Optional signing context for interactive signers (e.g., Ledger prompts)
   * @returns Transaction response from the network
   */
  sendTransactionWithNonce(
    tx: ExecutionLayerRequestTransaction,
    nonce: number,
    context?: SigningContext
  ): Promise<TransactionResponse>;

  /**
   * Release resources held by the signer
   *
   * For Ledger signers, this closes the USB transport connection.
   * For wallet signers, this is typically a no-op.
   */
  dispose(): Promise<void>;
}
