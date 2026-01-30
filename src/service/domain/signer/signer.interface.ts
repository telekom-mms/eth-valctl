import type { TransactionResponse } from 'ethers';

import type { ExecutionLayerRequestTransaction, SigningContext } from '../../../model/ethereum';

/**
 * Signer capabilities indicating supported features
 */
export interface SignerCapabilities {
  /** Whether the signer can process multiple transactions in parallel */
  supportsParallelSigning: boolean;
  /** Whether signing requires user interaction (e.g., hardware wallet confirmation) */
  requiresUserInteraction: boolean;
  /** Type identifier for the signer */
  signerType: 'wallet' | 'ledger';
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
   * @returns Transaction response from the network
   */
  sendTransaction(tx: ExecutionLayerRequestTransaction): Promise<TransactionResponse>;

  /**
   * Send a transaction with an explicit nonce
   *
   * Used for transaction replacement where the same nonce must be reused.
   *
   * @param tx - Transaction to sign and send
   * @param nonce - Explicit nonce to use
   * @returns Transaction response from the network
   */
  sendTransactionWithNonce(
    tx: ExecutionLayerRequestTransaction,
    nonce: number
  ): Promise<TransactionResponse>;

  /**
   * Get the current nonce that would be used for the next transaction
   *
   * @returns Current nonce value
   */
  getCurrentNonce(): Promise<number>;

  /**
   * Manually increment the internal nonce counter
   *
   * Used after successful transaction broadcast to prepare for the next transaction.
   */
  incrementNonce(): void;

  /**
   * Release resources held by the signer
   *
   * For Ledger signers, this closes the USB transport connection.
   * For wallet signers, this is typically a no-op.
   */
  dispose(): Promise<void>;
}

/**
 * Extended signer interface for signers that require user interaction
 *
 * Hardware wallets like Ledger need signing context to display progress information
 * to users during the confirmation process.
 */
export interface IInteractiveSigner extends ISigner {
  /**
   * Send a transaction with optional signing context for user prompts
   *
   * @param tx - Transaction to sign and send
   * @param context - Optional context for user prompts (e.g., validator info)
   * @returns Transaction response from the network
   */
  sendTransaction(
    tx: ExecutionLayerRequestTransaction,
    context?: SigningContext
  ): Promise<TransactionResponse>;

  /**
   * Send a transaction with explicit nonce and optional signing context
   *
   * @param tx - Transaction to sign and send
   * @param nonce - Explicit nonce to use
   * @param context - Optional context for user prompts
   * @returns Transaction response from the network
   */
  sendTransactionWithNonce(
    tx: ExecutionLayerRequestTransaction,
    nonce: number,
    context?: SigningContext
  ): Promise<TransactionResponse>;
}

/**
 * Type guard to check if a signer supports interactive signing with context
 *
 * @param signer - Signer to check
 * @returns True if signer requires user interaction and supports SigningContext
 */
export function isInteractiveSigner(signer: ISigner): signer is IInteractiveSigner {
  return signer.capabilities.requiresUserInteraction;
}
