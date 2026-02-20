import type { TransactionResponse, Wallet } from 'ethers';
import { NonceManager } from 'ethers';

import type { ExecutionLayerRequestTransaction, SigningContext } from '../../../model/ethereum';
import type { ISigner, SignerCapabilities } from '../../../ports/signer.interface';

/**
 * Software wallet signer using ethers NonceManager
 *
 * Supports parallel transaction signing since all operations are local.
 * Wraps the existing NonceManager pattern for backward compatibility.
 */
export class WalletSigner implements ISigner {
  readonly capabilities: SignerCapabilities = {
    supportsParallelSigning: true,
    requiresUserInteraction: false
  };

  readonly address: string;

  /**
   * Creates a wallet signer
   *
   * @param nonceManager - Ethers NonceManager wrapping a Wallet
   */
  constructor(private readonly nonceManager: NonceManager) {
    const wallet = this.nonceManager.signer as Wallet;
    this.address = wallet.address;
  }

  /**
   * Get underlying wallet instance from nonce manager
   *
   * @returns The wrapped ethers Wallet instance
   */
  private getWallet(): Wallet {
    return this.nonceManager.signer as Wallet;
  }

  async sendTransaction(
    tx: ExecutionLayerRequestTransaction,
    _context?: SigningContext
  ): Promise<TransactionResponse> {
    return await this.nonceManager.sendTransaction(tx);
  }

  async sendTransactionWithNonce(
    tx: ExecutionLayerRequestTransaction,
    nonce: number,
    _context?: SigningContext
  ): Promise<TransactionResponse> {
    const wallet = this.getWallet();
    return await wallet.sendTransaction({ ...tx, nonce });
  }

  async dispose(): Promise<void> {
    // No cleanup needed for software wallet
  }
}
