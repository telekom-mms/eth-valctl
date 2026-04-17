import type { SafeInfoResponse } from '@safe-global/api-kit';
import { describe, expect, it, spyOn } from 'bun:test';

import {
  checkTransactionServiceHealth,
  validateSafeExists,
  validateSignerIsOwner
} from './safe-preflight';

const TX_SERVICE_URL = 'https://safe-transaction-mainnet.safe.global/api';
const SAFE_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const OWNER_ADDRESS = '0xaabbccddee1234567890aabbccddee1234567890';
const NON_OWNER_ADDRESS = '0x0000000000000000000000000000000000000001';

const MOCK_SAFE_INFO: SafeInfoResponse = {
  address: SAFE_ADDRESS,
  nonce: '0',
  threshold: 2,
  owners: [OWNER_ADDRESS, '0x1111111111111111111111111111111111111111'],
  singleton: '0x0000000000000000000000000000000000000000',
  modules: [],
  fallbackHandler: '0x0000000000000000000000000000000000000000',
  guard: '0x0000000000000000000000000000000000000000',
  version: '1.4.1'
};

function createMockApiKit(overrides: { getSafeInfo?: () => Promise<unknown> } = {}) {
  return {
    getSafeInfo: overrides.getSafeInfo ?? (() => Promise.resolve(MOCK_SAFE_INFO))
  } as unknown as Parameters<typeof validateSafeExists>[0];
}

function createMockHealthApiKit(overrides: { getServiceInfo?: () => Promise<unknown> } = {}) {
  return {
    getServiceInfo:
      overrides.getServiceInfo ??
      (() =>
        Promise.resolve({ name: 'Safe Transaction Service', version: '6.0.3', api_version: 'v1' }))
  } as unknown as Parameters<typeof checkTransactionServiceHealth>[0];
}

describe('checkTransactionServiceHealth', () => {
  it('succeeds when service returns valid response', async () => {
    const apiKit = createMockHealthApiKit();

    await expect(checkTransactionServiceHealth(apiKit, TX_SERVICE_URL)).resolves.toBeUndefined();
  });

  it('exits on connection refused', async () => {
    const error = Object.assign(new Error('Connection refused'), { code: 'ConnectionRefused' });
    const apiKit = createMockHealthApiKit({
      getServiceInfo: () => Promise.reject(error)
    });
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });

    await expect(checkTransactionServiceHealth(apiKit, TX_SERVICE_URL)).rejects.toThrow(
      'process.exit'
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('throws on unknown connection error', async () => {
    const apiKit = createMockHealthApiKit({
      getServiceInfo: () => Promise.reject(new Error('ECONNREFUSED'))
    });

    await expect(checkTransactionServiceHealth(apiKit, TX_SERVICE_URL)).rejects.toThrow(
      `Unexpected error connecting to Safe Transaction Service at ${TX_SERVICE_URL}`
    );
  });

  it('throws on unexpected response body with missing name', async () => {
    const apiKit = createMockHealthApiKit({
      getServiceInfo: () => Promise.resolve({ name: 'Unknown Service', version: '1.0' })
    });

    await expect(checkTransactionServiceHealth(apiKit, TX_SERVICE_URL)).rejects.toThrow(
      `Safe Transaction Service at ${TX_SERVICE_URL} returned unexpected response: name="Unknown Service"`
    );
  });
});

describe('validateSafeExists', () => {
  it('returns Safe info for deployed Safe', async () => {
    const apiKit = createMockApiKit();

    const result = await validateSafeExists(apiKit, SAFE_ADDRESS, 'hoodi');

    expect(result).toEqual(MOCK_SAFE_INFO);
  });

  it('throws for non-existent Safe address', async () => {
    const apiKit = createMockApiKit({
      getSafeInfo: () => Promise.reject(new Error('Not Found'))
    });

    await expect(validateSafeExists(apiKit, SAFE_ADDRESS, 'hoodi')).rejects.toThrow(
      `No Safe found at ${SAFE_ADDRESS} on hoodi`
    );
  });
});

describe('validateSignerIsOwner', () => {
  it('passes when signer is in owner list', () => {
    expect(() => validateSignerIsOwner(MOCK_SAFE_INFO, OWNER_ADDRESS, SAFE_ADDRESS)).not.toThrow();
  });

  it('passes with case-insensitive address comparison', () => {
    expect(() =>
      validateSignerIsOwner(MOCK_SAFE_INFO, OWNER_ADDRESS.toUpperCase(), SAFE_ADDRESS)
    ).not.toThrow();
  });

  it('throws when signer is not an owner', () => {
    expect(() => validateSignerIsOwner(MOCK_SAFE_INFO, NON_OWNER_ADDRESS, SAFE_ADDRESS)).toThrow(
      `Address ${NON_OWNER_ADDRESS} is not an owner of Safe ${SAFE_ADDRESS}`
    );
  });
});
