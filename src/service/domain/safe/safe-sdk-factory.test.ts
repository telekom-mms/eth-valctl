import * as safeApiKitModule from '@safe-global/api-kit';
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import { SAFE_API_KEY_ENV } from '../../../constants/application';
import { SAFE_API_KEY_REQUIRED_ERROR } from '../../../constants/logging';
import type { SafeConnectionConfig } from '../../../model/safe';
import { createSafeApiKit } from './safe-sdk-factory';

const MAINNET_CHAIN_ID = 1n;
const SEPOLIA_CHAIN_ID = 11155111n;
const HOODI_CHAIN_ID = 560048n;
const UNKNOWN_CHAIN_ID = 9999999999n;

const MAINNET_TX_SERVICE_URL = 'https://safe-transaction-mainnet.safe.global/api';
const HOODI_TX_SERVICE_URL = 'https://transaction-ethereum-hoodi.safe.protofire.io/api';

const API_KEY_VALUE = 'test-api-key-12345';

/**
 * Build a SafeConnectionConfig fixture with sensible defaults for test clarity.
 *
 * @param overrides - Per-test overrides on top of mainnet defaults
 * @returns Fully-populated SafeConnectionConfig
 */
function createConfig(overrides: Partial<SafeConnectionConfig> = {}): SafeConnectionConfig {
  return {
    safeAddress: '0x1234567890abcdef1234567890abcdef12345678',
    chainId: MAINNET_CHAIN_ID,
    txServiceUrl: MAINNET_TX_SERVICE_URL,
    rpcUrl: 'http://localhost:8545',
    ...overrides
  };
}

describe('createSafeApiKit', () => {
  let originalApiKey: string | undefined;
  let safeApiKitSpy: ReturnType<typeof spyOn>;
  let capturedConstructorArgs: unknown[][];

  beforeEach(() => {
    originalApiKey = process.env[SAFE_API_KEY_ENV];
    delete process.env[SAFE_API_KEY_ENV];

    capturedConstructorArgs = [];
    const spyTarget = safeApiKitModule as unknown as {
      default: (...args: unknown[]) => unknown;
    };
    safeApiKitSpy = spyOn(spyTarget, 'default').mockImplementation((...args: unknown[]) => {
      capturedConstructorArgs.push(args);
      return { __capturedArgs: args };
    });
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env[SAFE_API_KEY_ENV];
    } else {
      process.env[SAFE_API_KEY_ENV] = originalApiKey;
    }
    safeApiKitSpy.mockRestore();
  });

  describe('API key gating', () => {
    it('omits the apiKey field entirely when requiresApiKey is false and env is unset', () => {
      const config = createConfig({ chainId: HOODI_CHAIN_ID, txServiceUrl: HOODI_TX_SERVICE_URL });

      createSafeApiKit(config, false);

      expect(capturedConstructorArgs).toHaveLength(1);
      const [constructorOpts] = capturedConstructorArgs[0]! as [Record<string, unknown>];
      expect(Object.keys(constructorOpts)).not.toContain('apiKey');
      expect(constructorOpts).toEqual({
        chainId: HOODI_CHAIN_ID,
        txServiceUrl: HOODI_TX_SERVICE_URL
      });
    });

    it('forwards the apiKey verbatim when requiresApiKey is true and env is set', () => {
      process.env[SAFE_API_KEY_ENV] = API_KEY_VALUE;
      const config = createConfig();

      createSafeApiKit(config, true);

      expect(capturedConstructorArgs).toHaveLength(1);
      const [constructorOpts] = capturedConstructorArgs[0]! as [Record<string, unknown>];
      expect(constructorOpts).toEqual({
        chainId: MAINNET_CHAIN_ID,
        txServiceUrl: MAINNET_TX_SERVICE_URL,
        apiKey: API_KEY_VALUE
      });
    });

    it('forwards the apiKey when requiresApiKey is false but env is set (opt-in key usage)', () => {
      process.env[SAFE_API_KEY_ENV] = API_KEY_VALUE;
      const config = createConfig({ chainId: HOODI_CHAIN_ID, txServiceUrl: HOODI_TX_SERVICE_URL });

      createSafeApiKit(config, false);

      const [constructorOpts] = capturedConstructorArgs[0]! as [Record<string, unknown>];
      expect(constructorOpts['apiKey']).toBe(API_KEY_VALUE);
    });

    it('trims surrounding whitespace from a valid apiKey before forwarding', () => {
      process.env[SAFE_API_KEY_ENV] = `  ${API_KEY_VALUE}  `;
      const config = createConfig();

      createSafeApiKit(config, true);

      const [constructorOpts] = capturedConstructorArgs[0]! as [Record<string, unknown>];
      expect(constructorOpts['apiKey']).toBe(API_KEY_VALUE);
    });
  });

  describe('API key requirement violations', () => {
    it('throws SAFE_API_KEY_REQUIRED_ERROR when requiresApiKey is true and env is unset', () => {
      const config = createConfig();

      expect(() => createSafeApiKit(config, true)).toThrow(SAFE_API_KEY_REQUIRED_ERROR('mainnet'));
    });

    it('throws when env is an empty string', () => {
      process.env[SAFE_API_KEY_ENV] = '';
      const config = createConfig();

      expect(() => createSafeApiKit(config, true)).toThrow(SAFE_API_KEY_REQUIRED_ERROR('mainnet'));
    });

    it('throws when env contains only whitespace', () => {
      process.env[SAFE_API_KEY_ENV] = '   \t\n  ';
      const config = createConfig();

      expect(() => createSafeApiKit(config, true)).toThrow(SAFE_API_KEY_REQUIRED_ERROR('mainnet'));
    });

    it('does not construct SafeApiKit when the requirement check fails', () => {
      const config = createConfig();

      expect(() => createSafeApiKit(config, true)).toThrow();
      expect(capturedConstructorArgs).toHaveLength(0);
    });
  });

  describe('network reverse lookup for error messages', () => {
    it('resolves mainnet chain ID to "mainnet" in the error message', () => {
      const config = createConfig({ chainId: MAINNET_CHAIN_ID });

      expect(() => createSafeApiKit(config, true)).toThrow(SAFE_API_KEY_REQUIRED_ERROR('mainnet'));
    });

    it('resolves sepolia chain ID to "sepolia" in the error message', () => {
      const config = createConfig({ chainId: SEPOLIA_CHAIN_ID });

      expect(() => createSafeApiKit(config, true)).toThrow(SAFE_API_KEY_REQUIRED_ERROR('sepolia'));
    });

    it('falls back to "chain <id>" when chain ID matches no known network', () => {
      const config = createConfig({ chainId: UNKNOWN_CHAIN_ID });

      expect(() => createSafeApiKit(config, true)).toThrow(
        SAFE_API_KEY_REQUIRED_ERROR(`chain ${UNKNOWN_CHAIN_ID}`)
      );
    });
  });
});
