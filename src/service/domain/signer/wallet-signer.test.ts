import { describe, expect, it, mock } from 'bun:test';
import type { NonceManager, TransactionResponse } from 'ethers';

import type { ExecutionLayerRequestTransaction, SigningContext } from '../../../model/ethereum';
import { WalletSigner } from './wallet-signer';

const TEST_ADDRESS = '0x1234567890123456789012345678901234567890';
const CONTRACT_ADDRESS = '0x0000BBdDc7CE488642fb579F8B00f3a590007251';
const ENCODED_DATA = '0x' + 'ab'.repeat(48) + 'cd'.repeat(8);

const SIGNING_CONTEXT: SigningContext = {
  currentIndex: 1,
  totalCount: 1,
  validatorPubkey: '0x' + 'ab'.repeat(48)
};

const BASE_TX: ExecutionLayerRequestTransaction = {
  to: CONTRACT_ADDRESS,
  data: ENCODED_DATA,
  value: 1000n,
  gasLimit: 200000n,
  maxFeePerGas: 30_000_000_000n,
  maxPriorityFeePerGas: 1_000_000_000n
};

type WalletDouble = {
  address: string;
  sendTransaction: ReturnType<typeof mock>;
};

type NonceManagerDouble = {
  signer: WalletDouble;
  sendTransaction: ReturnType<typeof mock>;
};

/**
 * Construct a wallet + NonceManager test double pair where the NonceManager wraps the wallet.
 *
 * @param response - Transaction response returned by both `sendTransaction` variants
 * @returns The wallet double, the wrapping nonce manager double, and a configured signer
 */
function createSignerFixture(
  response: Partial<TransactionResponse> = { hash: '0xdeadbeef', nonce: 5 }
): {
  wallet: WalletDouble;
  nonceManager: NonceManagerDouble;
  signer: WalletSigner;
} {
  const wallet: WalletDouble = {
    address: TEST_ADDRESS,
    sendTransaction: mock(() => Promise.resolve(response as TransactionResponse))
  };
  const nonceManager: NonceManagerDouble = {
    signer: wallet,
    sendTransaction: mock(() => Promise.resolve(response as TransactionResponse))
  };
  const signer = new WalletSigner(nonceManager as unknown as NonceManager);
  return { wallet, nonceManager, signer };
}

describe('WalletSigner', () => {
  describe('capabilities', () => {
    it('reports supportsParallelSigning === true', () => {
      const { signer } = createSignerFixture();

      expect(signer.capabilities.supportsParallelSigning).toBe(true);
    });
  });

  describe('address', () => {
    it('reads address from the wrapped wallet', () => {
      const { signer } = createSignerFixture();

      expect(signer.address).toBe(TEST_ADDRESS);
    });
  });

  describe('sendTransaction', () => {
    it('delegates to nonceManager.sendTransaction', async () => {
      const { signer, nonceManager, wallet } = createSignerFixture();

      await signer.sendTransaction(BASE_TX);

      expect(nonceManager.sendTransaction).toHaveBeenCalledTimes(1);
      expect(nonceManager.sendTransaction).toHaveBeenCalledWith(BASE_TX);
      expect(wallet.sendTransaction).not.toHaveBeenCalled();
    });

    it('returns the TransactionResponse produced by nonceManager', async () => {
      const fakeResponse = { hash: '0xabc123', nonce: 17 } as Partial<TransactionResponse>;
      const { signer } = createSignerFixture(fakeResponse);

      const result = await signer.sendTransaction(BASE_TX);

      expect(result).toEqual(fakeResponse as TransactionResponse);
    });

    it('propagates rejection from the NonceManager', async () => {
      const { signer, nonceManager } = createSignerFixture();
      const failure = new Error('rpc down');
      nonceManager.sendTransaction.mockImplementation(() => Promise.reject(failure));

      await expect(signer.sendTransaction(BASE_TX)).rejects.toThrow('rpc down');
    });

    it('produces identical call shape whether context is undefined or {}', async () => {
      const { signer, nonceManager } = createSignerFixture();

      await signer.sendTransaction(BASE_TX, undefined);
      await signer.sendTransaction(BASE_TX, {} as SigningContext);

      expect(nonceManager.sendTransaction).toHaveBeenCalledTimes(2);
      expect(nonceManager.sendTransaction.mock.calls[0]).toEqual([BASE_TX]);
      expect(nonceManager.sendTransaction.mock.calls[1]).toEqual([BASE_TX]);
    });
  });

  describe('sendTransactionWithNonce', () => {
    it('delegates to wallet.sendTransaction, not nonceManager (NonceManager-bypass contract)', async () => {
      const { signer, nonceManager, wallet } = createSignerFixture();

      await signer.sendTransactionWithNonce(BASE_TX, 42);

      expect(wallet.sendTransaction).toHaveBeenCalledTimes(1);
      expect(nonceManager.sendTransaction).not.toHaveBeenCalled();
    });

    it('overrides only the nonce and preserves every other transaction field', async () => {
      const { signer, wallet } = createSignerFixture();

      await signer.sendTransactionWithNonce(BASE_TX, 42);

      const forwarded = wallet.sendTransaction.mock
        .calls[0]![0] as ExecutionLayerRequestTransaction & {
        nonce: number;
      };
      expect(forwarded).toEqual({
        to: BASE_TX.to,
        data: BASE_TX.data,
        value: BASE_TX.value,
        gasLimit: BASE_TX.gasLimit,
        maxFeePerGas: BASE_TX.maxFeePerGas,
        maxPriorityFeePerGas: BASE_TX.maxPriorityFeePerGas,
        nonce: 42
      });
    });

    it('ignores the signing context (wallet signer does not prompt)', async () => {
      const { signer, wallet } = createSignerFixture();

      await signer.sendTransactionWithNonce(BASE_TX, 42, undefined);
      await signer.sendTransactionWithNonce(BASE_TX, 42, SIGNING_CONTEXT);

      expect(wallet.sendTransaction.mock.calls[0]).toEqual(wallet.sendTransaction.mock.calls[1]);
    });

    it('returns the TransactionResponse produced by the wallet', async () => {
      const fakeResponse = { hash: '0xfeedface', nonce: 42 } as Partial<TransactionResponse>;
      const { signer } = createSignerFixture(fakeResponse);

      const result = await signer.sendTransactionWithNonce(BASE_TX, 42);

      expect(result).toEqual(fakeResponse as TransactionResponse);
    });

    it('propagates rejection from the underlying wallet', async () => {
      const { signer, wallet } = createSignerFixture();
      const failure = new Error('replacement underpriced');
      wallet.sendTransaction.mockImplementation(() => Promise.reject(failure));

      await expect(signer.sendTransactionWithNonce(BASE_TX, 42)).rejects.toThrow(
        'replacement underpriced'
      );
    });
  });

  describe('dispose', () => {
    it('resolves without touching wallet or nonceManager', async () => {
      const { signer, wallet, nonceManager } = createSignerFixture();

      await expect(signer.dispose()).resolves.toBeUndefined();
      expect(wallet.sendTransaction).not.toHaveBeenCalled();
      expect(nonceManager.sendTransaction).not.toHaveBeenCalled();
    });
  });
});
