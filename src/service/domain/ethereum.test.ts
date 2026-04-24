import { afterAll, afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { JsonRpcProvider, NonceManager, Wallet } from 'ethers';

import { INVALID_PRIVATE_KEY_ERROR } from '../../constants/logging';
import * as promptModule from '../prompt';
import { LedgerSigner } from './signer/ledger-signer';
import { WalletSigner } from './signer/wallet-signer';

const TEST_RPC_URL = 'http://localhost:8545';
const VALID_PRIVATE_KEY = '0x' + '11'.repeat(32);
const INVALID_PRIVATE_KEY = 'not-a-valid-key';
const TEST_SELECTED_PATH = "44'/60'/0'/0/3";
const TEST_SELECTED_ADDRESS = '0x1234567890123456789012345678901234567890';

const mockLedgerSignerInstance = { kind: 'ledger-signer' };

const REAL_ETHEREUM_SPECIFIER = './ethereum?real';
const { createEthereumConnection, createValidatedProvider } = (await import(
  REAL_ETHEREUM_SPECIFIER
)) as typeof import('./ethereum');

const getNetworkSpy = spyOn(JsonRpcProvider.prototype, 'getNetwork');
const ledgerCreateSpy = spyOn(LedgerSigner, 'create');
const promptSecretSpy = spyOn(promptModule, 'promptSecret');
const promptLedgerAddressSelectionSpy = spyOn(promptModule, 'promptLedgerAddressSelection');

afterAll(() => {
  getNetworkSpy.mockRestore();
  ledgerCreateSpy.mockRestore();
  promptSecretSpy.mockRestore();
  promptLedgerAddressSelectionSpy.mockRestore();
});

/**
 * Reset the getNetwork spy to a deterministic resolved value.
 *
 * Ensures each test starts from a clean getNetwork behavior without residual
 * rejections from previous tests leaking through.
 */
function resetGetNetwork(): void {
  getNetworkSpy.mockImplementation(
    () =>
      Promise.resolve({ chainId: 17000n, name: 'hoodi' }) as ReturnType<
        JsonRpcProvider['getNetwork']
      >
  );
}

describe('createValidatedProvider', () => {
  beforeEach(() => {
    resetGetNetwork();
    getNetworkSpy.mockClear();
  });

  it('constructs a JsonRpcProvider and validates it via getNetwork()', async () => {
    const provider = await createValidatedProvider(TEST_RPC_URL);

    expect(provider).toBeInstanceOf(JsonRpcProvider);
    expect(getNetworkSpy).toHaveBeenCalledTimes(1);
  });

  it('surfaces failures from getNetwork (unreachable RPC)', async () => {
    getNetworkSpy.mockImplementation(
      () => Promise.reject(new Error('ECONNREFUSED')) as ReturnType<JsonRpcProvider['getNetwork']>
    );

    await expect(createValidatedProvider(TEST_RPC_URL)).rejects.toThrow('ECONNREFUSED');
  });
});

describe('createEthereumConnection', () => {
  let exitSpy: ReturnType<typeof spyOn>;
  let consoleErrorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    resetGetNetwork();
    getNetworkSpy.mockClear();
    ledgerCreateSpy.mockClear();
    ledgerCreateSpy.mockImplementation(
      (_provider: JsonRpcProvider, _logger: unknown, _path: string) =>
        Promise.resolve(mockLedgerSignerInstance as unknown as LedgerSigner)
    );
    promptSecretSpy.mockClear();
    promptSecretSpy.mockImplementation((_msg: string) => Promise.resolve(VALID_PRIVATE_KEY));
    promptLedgerAddressSelectionSpy.mockClear();
    promptLedgerAddressSelectionSpy.mockImplementation((_provider: JsonRpcProvider) =>
      Promise.resolve({
        derivationPath: TEST_SELECTED_PATH,
        address: TEST_SELECTED_ADDRESS,
        index: 3
      })
    );
    exitSpy = spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('wallet signer path (happy)', () => {
    it('prompts for the private key', async () => {
      await createEthereumConnection(TEST_RPC_URL, 'wallet');

      expect(promptSecretSpy).toHaveBeenCalledTimes(1);
    });

    it('returns a real WalletSigner whose wrapped NonceManager points at a real Wallet', async () => {
      const connection = await createEthereumConnection(TEST_RPC_URL, 'wallet');

      expect(connection.signer).toBeInstanceOf(WalletSigner);
      expect(connection.signer.capabilities.supportsParallelSigning).toBe(true);
    });

    it('returns the validated JsonRpcProvider in the connection', async () => {
      const connection = await createEthereumConnection(TEST_RPC_URL, 'wallet');

      expect(connection.provider).toBeInstanceOf(JsonRpcProvider);
    });

    it('derives the signer address from the prompted private key (real Wallet + NonceManager)', async () => {
      const expectedAddress = new Wallet(VALID_PRIVATE_KEY).address;

      const connection = await createEthereumConnection(TEST_RPC_URL, 'wallet');

      expect(connection.signer.address).toBe(expectedAddress);
    });

    it('wires the underlying Wallet through a NonceManager (nonce-managed broadcast)', async () => {
      const connection = await createEthereumConnection(TEST_RPC_URL, 'wallet');

      const signer = connection.signer as WalletSigner;
      const nonceManager = (signer as unknown as { nonceManager: NonceManager }).nonceManager;
      expect(nonceManager).toBeInstanceOf(NonceManager);
      expect(nonceManager.signer).toBeInstanceOf(Wallet);
    });

    it('defaults to the wallet signer when signerType is omitted', async () => {
      const connection = await createEthereumConnection(TEST_RPC_URL);

      expect(promptSecretSpy).toHaveBeenCalledTimes(1);
      expect(ledgerCreateSpy).not.toHaveBeenCalled();
      expect(connection.signer).toBeInstanceOf(WalletSigner);
    });

    it('does not prompt for Ledger selection on the wallet path', async () => {
      await createEthereumConnection(TEST_RPC_URL, 'wallet');

      expect(promptLedgerAddressSelectionSpy).not.toHaveBeenCalled();
    });
  });

  describe('wallet signer path (unhappy)', () => {
    it('logs INVALID_PRIVATE_KEY_ERROR and exits(1) when the prompted key is invalid', async () => {
      promptSecretSpy.mockImplementation((_msg: string) => Promise.resolve(INVALID_PRIVATE_KEY));

      await createEthereumConnection(TEST_RPC_URL, 'wallet');

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy.mock.calls[0]![0]).toContain(INVALID_PRIVATE_KEY_ERROR);
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('logs INVALID_PRIVATE_KEY_ERROR and exits(1) when promptSecret itself rejects', async () => {
      promptSecretSpy.mockImplementation(() => Promise.reject(new Error('cancelled')));

      await createEthereumConnection(TEST_RPC_URL, 'wallet');

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy.mock.calls[0]![0]).toContain(INVALID_PRIVATE_KEY_ERROR);
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('ledger signer path (happy)', () => {
    it('prompts for the Ledger address before creating the signer', async () => {
      await createEthereumConnection(TEST_RPC_URL, 'ledger');

      expect(promptLedgerAddressSelectionSpy).toHaveBeenCalledTimes(1);
      const providerArg = promptLedgerAddressSelectionSpy.mock.calls[0]![0];
      expect(providerArg).toBeInstanceOf(JsonRpcProvider);
    });

    it('forwards the selected derivation path to LedgerSigner.create', async () => {
      await createEthereumConnection(TEST_RPC_URL, 'ledger');

      expect(ledgerCreateSpy).toHaveBeenCalledTimes(1);
      expect(ledgerCreateSpy.mock.calls[0]![2]).toBe(TEST_SELECTED_PATH);
    });

    it('returns an EthereumConnection carrying the mocked LedgerSigner and provider', async () => {
      const connection = await createEthereumConnection(TEST_RPC_URL, 'ledger');

      expect(connection.signer).toBe(
        mockLedgerSignerInstance as unknown as typeof connection.signer
      );
      expect(connection.provider).toBeInstanceOf(JsonRpcProvider);
    });

    it('never prompts for a private key on the Ledger path', async () => {
      await createEthereumConnection(TEST_RPC_URL, 'ledger');

      expect(promptSecretSpy).not.toHaveBeenCalled();
    });
  });

  describe('ledger signer path (unhappy)', () => {
    it('logs error.message and exits(1) when an Error instance is thrown', async () => {
      ledgerCreateSpy.mockImplementation(() =>
        Promise.reject(new Error('Ledger device not connected'))
      );

      await createEthereumConnection(TEST_RPC_URL, 'ledger');

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy.mock.calls[0]![0]).toContain('Ledger device not connected');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('exits(1) silently when a non-Error value is thrown (no console.error)', async () => {
      ledgerCreateSpy.mockImplementation(() => Promise.reject('string thrown' as unknown));

      await createEthereumConnection(TEST_RPC_URL, 'ledger');

      expect(consoleErrorSpy).not.toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('exits(1) and logs message when Ledger address selection rejects with an Error', async () => {
      promptLedgerAddressSelectionSpy.mockImplementation(() =>
        Promise.reject(new Error('user aborted selection'))
      );

      await createEthereumConnection(TEST_RPC_URL, 'ledger');

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy.mock.calls[0]![0]).toContain('user aborted selection');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('provider validation failure', () => {
    it('surfaces getNetwork() rejection before any signer work happens', async () => {
      getNetworkSpy.mockImplementation(
        () =>
          Promise.reject(new Error('RPC unreachable')) as ReturnType<JsonRpcProvider['getNetwork']>
      );

      await expect(createEthereumConnection(TEST_RPC_URL, 'wallet')).rejects.toThrow(
        'RPC unreachable'
      );

      expect(promptSecretSpy).not.toHaveBeenCalled();
      expect(ledgerCreateSpy).not.toHaveBeenCalled();
    });
  });
});
