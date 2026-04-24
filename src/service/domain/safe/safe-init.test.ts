import type { SafeInfoResponse } from '@safe-global/api-kit';
import Safe from '@safe-global/protocol-kit';
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { JsonRpcProvider } from 'ethers';

import { SAFE_FOUND_INFO, SAFE_VERIFYING_INFO } from '../../../constants/logging';
import type { GlobalCliOptions } from '../../../model/commander';
import type { NetworkConfig, SafeContractAddresses } from '../../../model/ethereum';
import * as ethereumModule from '../ethereum';
import { initializeSafe } from './safe-init';
import * as preflightModule from './safe-preflight';
import * as sdkFactoryModule from './safe-sdk-factory';
import * as signerInitModule from './safe-signer-init';

const SAFE_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const SIGNER_ADDRESS = '0xaabbccddee1234567890aabbccddee1234567890';
const TX_SERVICE_URL = 'https://safe-transaction-example.safe.global/api';

const MOCK_SAFE_INFO: SafeInfoResponse = {
  address: SAFE_ADDRESS,
  nonce: '42',
  threshold: 2,
  owners: [SIGNER_ADDRESS, '0x1111111111111111111111111111111111111111'],
  singleton: '0x0000000000000000000000000000000000000000',
  modules: [],
  fallbackHandler: '0x0000000000000000000000000000000000000000',
  guard: '0x0000000000000000000000000000000000000000',
  version: '1.4.1'
};

const KURTOSIS_SAFE_CONTRACT_ADDRESSES: SafeContractAddresses = {
  safeSingletonAddress: '0x0000000000000000000000000000000000000011',
  safeProxyFactoryAddress: '0x0000000000000000000000000000000000000012',
  multiSendAddress: '0x0000000000000000000000000000000000000013',
  multiSendCallOnlyAddress: '0x0000000000000000000000000000000000000014',
  fallbackHandlerAddress: '0x0000000000000000000000000000000000000000',
  signMessageLibAddress: '0x0000000000000000000000000000000000000016',
  createCallAddress: '0x0000000000000000000000000000000000000017',
  simulateTxAccessorAddress: '0x0000000000000000000000000000000000000018'
};

const mockProvider = { __tag: 'provider' } as unknown as JsonRpcProvider;
const mockApiKit = { __tag: 'apiKit' };
const mockProtocolKitInstance = { __tag: 'protocolKit' };
const mockProtocolKitProviderConfig = 'http://pk-provider/';

/**
 * Builds a GlobalCliOptions fixture tuned for Safe initialization tests.
 *
 * @param overrides - Shallow overrides merged on top of the default options
 * @returns A GlobalCliOptions instance ready for injection into `initializeSafe`
 */
function buildGlobalOptions(overrides: Partial<GlobalCliOptions> = {}): GlobalCliOptions {
  return {
    network: 'hoodi',
    jsonRpcUrl: 'http://localhost:8545',
    beaconApiUrl: 'http://localhost:5052',
    maxRequestsPerBlock: 10,
    ledger: false,
    ...overrides
  };
}

/**
 * Builds a minimal NetworkConfig fixture for Safe initialization tests.
 *
 * @param overrides - Fields to override on the default network config
 * @returns A NetworkConfig shaped for Safe-compatible networks
 */
function buildNetworkConfig(overrides: Partial<NetworkConfig> = {}): NetworkConfig {
  return {
    consolidationContractAddress: '0x0000000000000000000000000000000000000251',
    withdrawalContractAddress: '0x0000000000000000000000000000000000007002',
    chainId: 560048n,
    safeTransactionServiceUrl: TX_SERVICE_URL,
    safeRequiresApiKey: false,
    ...overrides
  };
}

describe('initializeSafe', () => {
  let stderrSpy: ReturnType<typeof spyOn>;
  let callRecorder: string[];
  let mockDispose: ReturnType<typeof mock>;
  let createValidatedProviderSpy: ReturnType<typeof spyOn>;
  let createSafeApiKitSpy: ReturnType<typeof spyOn>;
  let checkHealthSpy: ReturnType<typeof spyOn>;
  let validateSafeExistsSpy: ReturnType<typeof spyOn>;
  let initializeSafeSignerSpy: ReturnType<typeof spyOn>;
  let validateSignerIsOwnerSpy: ReturnType<typeof spyOn>;
  let safeInitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    stderrSpy = spyOn(console, 'error').mockImplementation(() => {});
    spyOn(console, 'log').mockImplementation(() => {});

    callRecorder = [];
    mockDispose = mock(() => Promise.resolve());

    createValidatedProviderSpy = spyOn(
      ethereumModule,
      'createValidatedProvider'
    ).mockImplementation(async () => {
      callRecorder.push('createValidatedProvider');
      return mockProvider;
    });
    createValidatedProviderSpy.mockClear();

    createSafeApiKitSpy = spyOn(sdkFactoryModule, 'createSafeApiKit').mockImplementation(() => {
      callRecorder.push('createSafeApiKit');
      return mockApiKit as never;
    });
    createSafeApiKitSpy.mockClear();

    checkHealthSpy = spyOn(preflightModule, 'checkTransactionServiceHealth').mockImplementation(
      async () => {
        callRecorder.push('checkTransactionServiceHealth');
      }
    );
    checkHealthSpy.mockClear();

    validateSafeExistsSpy = spyOn(preflightModule, 'validateSafeExists').mockImplementation(
      async () => {
        callRecorder.push('validateSafeExists');
        return MOCK_SAFE_INFO;
      }
    );
    validateSafeExistsSpy.mockClear();

    initializeSafeSignerSpy = spyOn(signerInitModule, 'initializeSafeSigner').mockImplementation(
      async () => {
        callRecorder.push('initializeSafeSigner');
        return {
          signerAddress: SIGNER_ADDRESS,
          protocolKitProvider: mockProtocolKitProviderConfig,
          protocolKitSigner: SIGNER_ADDRESS,
          dispose: mockDispose
        };
      }
    );
    initializeSafeSignerSpy.mockClear();

    validateSignerIsOwnerSpy = spyOn(preflightModule, 'validateSignerIsOwner').mockImplementation(
      () => {
        callRecorder.push('validateSignerIsOwner');
      }
    );
    validateSignerIsOwnerSpy.mockClear();

    safeInitSpy = spyOn(Safe, 'init').mockImplementation((async () => {
      callRecorder.push('Safe.init');
      return mockProtocolKitInstance;
    }) as never);
    safeInitSpy.mockClear();
  });

  afterEach(() => {
    mock.restore();
  });

  describe('happy path', () => {
    it('invokes collaborators in preflight -> signer -> ownership -> Safe.init order', async () => {
      await initializeSafe(buildGlobalOptions(), buildNetworkConfig(), SAFE_ADDRESS);

      expect(callRecorder).toEqual([
        'createValidatedProvider',
        'createSafeApiKit',
        'checkTransactionServiceHealth',
        'validateSafeExists',
        'initializeSafeSigner',
        'validateSignerIsOwner',
        'Safe.init'
      ]);
    });

    it('forwards safeRequiresApiKey=false when netConfig omits the flag', async () => {
      const netConfig = buildNetworkConfig({ safeRequiresApiKey: undefined });

      await initializeSafe(buildGlobalOptions(), netConfig, SAFE_ADDRESS);

      const [, requiresApiKey] = createSafeApiKitSpy.mock.calls[0] as unknown as [unknown, boolean];
      expect(requiresApiKey).toBe(false);
    });

    it('forwards safeRequiresApiKey=true when netConfig enables it', async () => {
      const netConfig = buildNetworkConfig({ safeRequiresApiKey: true });

      await initializeSafe(buildGlobalOptions(), netConfig, SAFE_ADDRESS);

      const [, requiresApiKey] = createSafeApiKitSpy.mock.calls[0] as unknown as [unknown, boolean];
      expect(requiresApiKey).toBe(true);
    });

    it('includes contractNetworks keyed by chainId when safeContractAddresses is configured', async () => {
      const netConfig = buildNetworkConfig({
        chainId: 3151908n,
        safeContractAddresses: KURTOSIS_SAFE_CONTRACT_ADDRESSES
      });

      await initializeSafe(buildGlobalOptions(), netConfig, SAFE_ADDRESS);

      const initArg = safeInitSpy.mock.calls[0]![0] as {
        contractNetworks: Record<string, SafeContractAddresses>;
      };
      expect(initArg.contractNetworks).toEqual({
        '3151908': KURTOSIS_SAFE_CONTRACT_ADDRESSES
      });
    });

    it('omits contractNetworks entirely when safeContractAddresses is undefined', async () => {
      const netConfig = buildNetworkConfig({ safeContractAddresses: undefined });

      await initializeSafe(buildGlobalOptions(), netConfig, SAFE_ADDRESS);

      const initArg = safeInitSpy.mock.calls[0]![0] as Record<string, unknown>;
      expect(Object.prototype.hasOwnProperty.call(initArg, 'contractNetworks')).toBe(false);
    });

    it('logs SAFE_VERIFYING_INFO before preflight and SAFE_FOUND_INFO after ownership validation', async () => {
      const options = buildGlobalOptions({ network: 'hoodi' });

      await initializeSafe(options, buildNetworkConfig(), SAFE_ADDRESS);

      const verifyingLine = SAFE_VERIFYING_INFO(SAFE_ADDRESS, 'hoodi');
      const foundLine = SAFE_FOUND_INFO(
        MOCK_SAFE_INFO.threshold,
        MOCK_SAFE_INFO.owners.length,
        SIGNER_ADDRESS
      );
      const allStderr = stderrSpy.mock.calls.flat().join('\n');
      expect(allStderr).toContain(verifyingLine);
      expect(allStderr).toContain(foundLine);
      expect(allStderr.indexOf(verifyingLine)).toBeLessThan(allStderr.indexOf(foundLine));
    });

    it('returns a dispose function that delegates to the signer init dispose exactly once', async () => {
      const result = await initializeSafe(buildGlobalOptions(), buildNetworkConfig(), SAFE_ADDRESS);

      await result.dispose();

      expect(mockDispose).toHaveBeenCalledTimes(1);
    });

    it('returns all SDK instances and validated state on success', async () => {
      const result = await initializeSafe(buildGlobalOptions(), buildNetworkConfig(), SAFE_ADDRESS);

      expect(result.apiKit).toBe(mockApiKit as never);
      expect(result.protocolKit).toBe(mockProtocolKitInstance as never);
      expect(result.provider).toBe(mockProvider);
      expect(result.signerAddress).toBe(SIGNER_ADDRESS);
      expect(result.safeInfo).toBe(MOCK_SAFE_INFO);
    });

    it('passes the Safe address, protocol kit provider, and signer to Safe.init', async () => {
      await initializeSafe(buildGlobalOptions(), buildNetworkConfig(), SAFE_ADDRESS);

      const initArg = safeInitSpy.mock.calls[0]![0] as {
        safeAddress: string;
        provider: string;
        signer: string;
      };
      expect(initArg.safeAddress).toBe(SAFE_ADDRESS);
      expect(initArg.provider).toBe(mockProtocolKitProviderConfig);
      expect(initArg.signer).toBe(SIGNER_ADDRESS);
    });

    it('calls createValidatedProvider exactly once with the jsonRpcUrl', async () => {
      const options = buildGlobalOptions({ jsonRpcUrl: 'http://explicit-rpc:9999' });

      await initializeSafe(options, buildNetworkConfig(), SAFE_ADDRESS);

      expect(createValidatedProviderSpy).toHaveBeenCalledTimes(1);
      expect(createValidatedProviderSpy).toHaveBeenCalledWith('http://explicit-rpc:9999');
    });
  });

  describe('error paths', () => {
    it('propagates checkTransactionServiceHealth rejection and never calls Safe.init', async () => {
      checkHealthSpy.mockImplementationOnce(async () => {
        throw new Error('tx-service down');
      });

      await expect(
        initializeSafe(buildGlobalOptions(), buildNetworkConfig(), SAFE_ADDRESS)
      ).rejects.toThrow('tx-service down');

      expect(safeInitSpy).not.toHaveBeenCalled();
      expect(validateSafeExistsSpy).not.toHaveBeenCalled();
      expect(initializeSafeSignerSpy).not.toHaveBeenCalled();
    });

    it('propagates validateSafeExists rejection and never calls Safe.init', async () => {
      validateSafeExistsSpy.mockImplementationOnce(async () => {
        throw new Error('no safe here');
      });

      await expect(
        initializeSafe(buildGlobalOptions(), buildNetworkConfig(), SAFE_ADDRESS)
      ).rejects.toThrow('no safe here');

      expect(safeInitSpy).not.toHaveBeenCalled();
      expect(initializeSafeSignerSpy).not.toHaveBeenCalled();
    });

    it('propagates validateSignerIsOwner rejection and never calls Safe.init', async () => {
      validateSignerIsOwnerSpy.mockImplementationOnce(() => {
        throw new Error('not an owner');
      });

      await expect(
        initializeSafe(buildGlobalOptions(), buildNetworkConfig(), SAFE_ADDRESS)
      ).rejects.toThrow('not an owner');

      expect(safeInitSpy).not.toHaveBeenCalled();
    });

    it('propagates initializeSafeSigner rejection and never calls Safe.init or ownership check', async () => {
      initializeSafeSignerSpy.mockImplementationOnce(async () => {
        throw new Error('ledger unplugged');
      });

      await expect(
        initializeSafe(buildGlobalOptions(), buildNetworkConfig(), SAFE_ADDRESS)
      ).rejects.toThrow('ledger unplugged');

      expect(safeInitSpy).not.toHaveBeenCalled();
      expect(validateSignerIsOwnerSpy).not.toHaveBeenCalled();
    });
  });
});
