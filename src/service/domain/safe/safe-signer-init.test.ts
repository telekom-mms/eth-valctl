import * as hwAppEthModule from '@ledgerhq/hw-app-eth';
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { JsonRpcProvider } from 'ethers';
import * as ethersModule from 'ethers';

import type { GlobalCliOptions } from '../../../model/commander';
import type { AddressSelectionResult } from '../../../model/ledger';
import * as promptModule from '../../prompt';
import * as ledgerEip1193Module from '../signer/ledger-eip1193-provider';
import * as ledgerTransportModule from '../signer/ledger-transport';
import { initializeSafeSigner } from './safe-signer-init';

const LEDGER_SELECTED_ADDRESS = '0xLedger0000000000000000000000000000000001';
const LEDGER_DERIVATION_PATH = "44'/60'/0'/0/3";
const LEDGER_SELECTED_INDEX = 3;

const PRIVATE_KEY = '0x' + 'ab'.repeat(32);
const WALLET_ADDRESS = '0xWallet0000000000000000000000000000000002';

const JSON_RPC_URL = 'http://localhost:8545';

const INVALID_PRIVATE_KEY_ERROR_MESSAGE = 'invalid private key';
const LEDGER_TRANSPORT_ERROR_MESSAGE = 'transport connect failed';

const DEFAULT_LEDGER_SELECTION: AddressSelectionResult = {
  address: LEDGER_SELECTED_ADDRESS,
  derivationPath: LEDGER_DERIVATION_PATH,
  index: LEDGER_SELECTED_INDEX
};

/**
 * Build a GlobalCliOptions fixture with the two fields that safe-signer-init reads.
 *
 * @param overrides - Per-test overrides on top of wallet-path defaults
 * @returns A GlobalCliOptions object with minimal fields populated
 */
function createGlobalOptions(overrides: Partial<GlobalCliOptions> = {}): GlobalCliOptions {
  return {
    network: 'hoodi',
    jsonRpcUrl: JSON_RPC_URL,
    beaconApiUrl: 'http://localhost:5052',
    maxRequestsPerBlock: 10,
    ledger: false,
    ...overrides
  };
}

/**
 * Produce an opaque JsonRpcProvider stand-in; identity checks only.
 *
 * @returns A placeholder object reused as a `JsonRpcProvider`
 */
function createMockProvider(): JsonRpcProvider {
  return { __mockProvider: true } as unknown as JsonRpcProvider;
}

describe('initializeSafeSigner', () => {
  let promptSecretSpy: ReturnType<typeof spyOn>;
  let promptLedgerSpy: ReturnType<typeof spyOn>;
  let connectWithTimeoutSpy: ReturnType<typeof spyOn>;
  let ledgerEip1193Spy: ReturnType<typeof spyOn>;
  let ethSpy: ReturnType<typeof spyOn>;
  let walletSpy: ReturnType<typeof spyOn>;

  let ledgerProviderDispose: ReturnType<typeof mock>;
  let transportClose: ReturnType<typeof mock>;

  let capturedEthArgs: unknown[][];
  let capturedLedgerProviderArgs: unknown[][];
  let capturedWalletArgs: unknown[][];

  beforeEach(() => {
    capturedEthArgs = [];
    capturedLedgerProviderArgs = [];
    capturedWalletArgs = [];

    ledgerProviderDispose = mock(() => Promise.resolve());
    transportClose = mock(() => Promise.resolve());

    promptSecretSpy = spyOn(promptModule, 'promptSecret').mockImplementation(() =>
      Promise.resolve(PRIVATE_KEY)
    );
    promptLedgerSpy = spyOn(promptModule, 'promptLedgerAddressSelection').mockImplementation(() =>
      Promise.resolve(DEFAULT_LEDGER_SELECTION)
    );

    const mockTransport = { close: transportClose, __mockTransport: true };
    connectWithTimeoutSpy = spyOn(ledgerTransportModule, 'connectWithTimeout').mockImplementation(
      () => Promise.resolve(mockTransport as never)
    );

    ledgerEip1193Spy = spyOn(ledgerEip1193Module, 'LedgerEip1193Provider').mockImplementation(
      function (...args: unknown[]) {
        capturedLedgerProviderArgs.push(args);
        return {
          dispose: ledgerProviderDispose,
          __mockLedgerProvider: true
        };
      } as never
    );

    ethSpy = spyOn(hwAppEthModule, 'default').mockImplementation(function (...args: unknown[]) {
      capturedEthArgs.push(args);
      return { __mockEth: true };
    } as never);

    walletSpy = spyOn(ethersModule, 'Wallet').mockImplementation(function (
      privateKey: string,
      provider: unknown
    ) {
      capturedWalletArgs.push([privateKey, provider]);
      return { address: WALLET_ADDRESS, __mockWallet: true };
    } as never);
  });

  afterEach(() => {
    promptSecretSpy.mockRestore();
    promptLedgerSpy.mockRestore();
    connectWithTimeoutSpy.mockRestore();
    ledgerEip1193Spy.mockRestore();
    ethSpy.mockRestore();
    walletSpy.mockRestore();
  });

  describe('ledger branch (globalOptions.ledger === true)', () => {
    it('prompts for Ledger address selection using the supplied provider', async () => {
      const globalOptions = createGlobalOptions({ ledger: true });
      const provider = createMockProvider();

      await initializeSafeSigner(globalOptions, provider);

      expect(promptLedgerSpy).toHaveBeenCalledTimes(1);
      expect(promptLedgerSpy).toHaveBeenCalledWith(provider);
    });

    it('opens the Ledger transport via connectWithTimeout', async () => {
      const globalOptions = createGlobalOptions({ ledger: true });

      await initializeSafeSigner(globalOptions, createMockProvider());

      expect(connectWithTimeoutSpy).toHaveBeenCalledTimes(1);
    });

    it('builds LedgerEip1193Provider with transport, eth, derivation path, address, and provider', async () => {
      const globalOptions = createGlobalOptions({ ledger: true });
      const provider = createMockProvider();

      await initializeSafeSigner(globalOptions, provider);

      expect(capturedLedgerProviderArgs).toHaveLength(1);
      const [transportArg, ethArg, pathArg, addressArg, providerArg] =
        capturedLedgerProviderArgs[0]!;
      expect((transportArg as { __mockTransport?: boolean }).__mockTransport).toBe(true);
      expect((ethArg as { __mockEth?: boolean }).__mockEth).toBe(true);
      expect(pathArg).toBe(LEDGER_DERIVATION_PATH);
      expect(addressArg).toBe(LEDGER_SELECTED_ADDRESS);
      expect(providerArg).toBe(provider);
    });

    it('returns the selected address as signerAddress', async () => {
      const globalOptions = createGlobalOptions({ ledger: true });

      const result = await initializeSafeSigner(globalOptions, createMockProvider());

      expect(result.signerAddress).toBe(LEDGER_SELECTED_ADDRESS);
    });

    it('returns the LedgerEip1193Provider instance as protocolKitProvider', async () => {
      const globalOptions = createGlobalOptions({ ledger: true });

      const result = await initializeSafeSigner(globalOptions, createMockProvider());

      expect(
        (result.protocolKitProvider as { __mockLedgerProvider?: boolean }).__mockLedgerProvider
      ).toBe(true);
    });

    it('returns the selected ADDRESS (never a private key) as protocolKitSigner', async () => {
      const globalOptions = createGlobalOptions({ ledger: true });

      const result = await initializeSafeSigner(globalOptions, createMockProvider());

      expect(result.protocolKitSigner).toBe(LEDGER_SELECTED_ADDRESS);
      expect(result.protocolKitSigner).not.toBe(PRIVATE_KEY);
    });

    it('never prompts for a private key in the Ledger branch', async () => {
      const globalOptions = createGlobalOptions({ ledger: true });

      await initializeSafeSigner(globalOptions, createMockProvider());

      expect(promptSecretSpy).not.toHaveBeenCalled();
      expect(capturedWalletArgs).toHaveLength(0);
    });

    it('dispose delegates to LedgerEip1193Provider.dispose', async () => {
      const globalOptions = createGlobalOptions({ ledger: true });

      const result = await initializeSafeSigner(globalOptions, createMockProvider());
      await result.dispose();

      expect(ledgerProviderDispose).toHaveBeenCalledTimes(1);
    });
  });

  describe('wallet branch (globalOptions.ledger === false)', () => {
    it('prompts the user for a private key', async () => {
      const globalOptions = createGlobalOptions();

      await initializeSafeSigner(globalOptions, createMockProvider());

      expect(promptSecretSpy).toHaveBeenCalledTimes(1);
    });

    it('constructs a Wallet with the prompted private key and supplied provider', async () => {
      const globalOptions = createGlobalOptions();
      const provider = createMockProvider();

      await initializeSafeSigner(globalOptions, provider);

      expect(capturedWalletArgs).toHaveLength(1);
      expect(capturedWalletArgs[0]).toEqual([PRIVATE_KEY, provider]);
    });

    it("returns the wallet's address as signerAddress", async () => {
      const globalOptions = createGlobalOptions();

      const result = await initializeSafeSigner(globalOptions, createMockProvider());

      expect(result.signerAddress).toBe(WALLET_ADDRESS);
    });

    it('returns globalOptions.jsonRpcUrl as protocolKitProvider (URL string, NOT a provider object)', async () => {
      const globalOptions = createGlobalOptions({ jsonRpcUrl: JSON_RPC_URL });

      const result = await initializeSafeSigner(globalOptions, createMockProvider());

      expect(result.protocolKitProvider).toBe(JSON_RPC_URL);
      expect(typeof result.protocolKitProvider).toBe('string');
    });

    it('returns the raw private key as protocolKitSigner (Protocol Kit signing contract)', async () => {
      const globalOptions = createGlobalOptions();

      const result = await initializeSafeSigner(globalOptions, createMockProvider());

      expect(result.protocolKitSigner).toBe(PRIVATE_KEY);
    });

    it('never opens a Ledger transport in the wallet branch', async () => {
      const globalOptions = createGlobalOptions();

      await initializeSafeSigner(globalOptions, createMockProvider());

      expect(connectWithTimeoutSpy).not.toHaveBeenCalled();
      expect(promptLedgerSpy).not.toHaveBeenCalled();
      expect(capturedLedgerProviderArgs).toHaveLength(0);
    });

    it('dispose is a no-op that resolves without side effects', async () => {
      const globalOptions = createGlobalOptions();

      const result = await initializeSafeSigner(globalOptions, createMockProvider());
      await expect(result.dispose()).resolves.toBeUndefined();

      expect(ledgerProviderDispose).not.toHaveBeenCalled();
      expect(transportClose).not.toHaveBeenCalled();
    });
  });

  describe('error propagation', () => {
    it('propagates Ledger transport connect failure without building the Eip1193 provider', async () => {
      connectWithTimeoutSpy.mockImplementationOnce(() =>
        Promise.reject(new Error(LEDGER_TRANSPORT_ERROR_MESSAGE))
      );
      const globalOptions = createGlobalOptions({ ledger: true });

      await expect(initializeSafeSigner(globalOptions, createMockProvider())).rejects.toThrow(
        LEDGER_TRANSPORT_ERROR_MESSAGE
      );

      expect(capturedLedgerProviderArgs).toHaveLength(0);
      expect(ledgerProviderDispose).not.toHaveBeenCalled();
    });

    it('propagates Wallet construction failure before any return value is produced', async () => {
      walletSpy.mockImplementationOnce(() => {
        throw new Error(INVALID_PRIVATE_KEY_ERROR_MESSAGE);
      });
      const globalOptions = createGlobalOptions();

      await expect(initializeSafeSigner(globalOptions, createMockProvider())).rejects.toThrow(
        INVALID_PRIVATE_KEY_ERROR_MESSAGE
      );
    });
  });
});
