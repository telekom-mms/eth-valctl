import type { SafeInfoResponse } from '@safe-global/api-kit';
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { JsonRpcProvider } from 'ethers';

import {
  CONSOLIDATION_CONTRACT_ADDRESS,
  DEFAULT_SAFE_FEE_TIP,
  OWNER_LABEL_SAFE,
  WITHDRAWAL_CONTRACT_ADDRESS
} from '../../constants/application';
import { SAFE_FEE_TIP_INFO } from '../../constants/logging';
import type { GlobalCliOptions } from '../../model/commander';
import type { ISigner } from '../../ports/signer.interface';
import * as ethereumModule from './ethereum';
import { executeRequestPipeline } from './execution-layer-request-pipeline';
import * as ethereumStateServiceModule from './request/ethereum-state-service';
import * as sendRequestModule from './request/send-request';
import * as safeInitModule from './safe/safe-init';
import * as safeProposeModule from './safe/safe-propose-service';

const SAFE_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const SAFE_SIGNER_ADDRESS = '0xaabbccddee1234567890aabbccddee1234567890';
const DIRECT_SIGNER_ADDRESS = '0x9999999999999999999999999999999999999999';
const CONTRACT_FEE = 1_000n;

const MOCK_SAFE_INFO: SafeInfoResponse = {
  address: SAFE_ADDRESS,
  nonce: '42',
  threshold: 3,
  owners: [SAFE_SIGNER_ADDRESS, '0x1111111111111111111111111111111111111111'],
  singleton: '0x0000000000000000000000000000000000000000',
  modules: [],
  fallbackHandler: '0x0000000000000000000000000000000000000000',
  guard: '0x0000000000000000000000000000000000000000',
  version: '1.4.1'
};

const mockProvider = {} as JsonRpcProvider;
const mockSigner = {
  address: DIRECT_SIGNER_ADDRESS,
  dispose: mock(() => Promise.resolve())
} as unknown as ISigner;

const mockApiKit = { __tag: 'apiKit' };
const mockProtocolKit = { __tag: 'protocolKit' };

/**
 * Builds a fully-populated GlobalCliOptions fixture with sensible defaults for pipeline tests.
 *
 * @param overrides - Partial overrides merged on top of the default options
 * @returns A GlobalCliOptions instance ready for injection into `executeRequestPipeline`
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
 * Builds a PipelineConfig-like argument where encoder returns the pubkey verbatim and the
 * contract address resolver returns the consolidation contract address.
 *
 * @param overrides - Overrides to shallow-merge into the config
 * @returns A config object compatible with `executeRequestPipeline`
 */
function buildPipelineConfig(
  overrides: Partial<Parameters<typeof executeRequestPipeline>[0]> = {}
): Parameters<typeof executeRequestPipeline>[0] {
  return {
    globalOptions: buildGlobalOptions(),
    validatorPubkeys: ['0xpubkey1'],
    encodeRequestData: (pubkey: string) => `data:${pubkey}`,
    resolveContractAddress: () => CONSOLIDATION_CONTRACT_ADDRESS,
    ...overrides
  };
}

describe('executeRequestPipeline', () => {
  let stderrSpy: ReturnType<typeof spyOn>;
  let createEthereumConnectionSpy: ReturnType<typeof spyOn>;
  let initializeSafeSpy: ReturnType<typeof spyOn>;
  let proposeSafeTransactionsSpy: ReturnType<typeof spyOn>;
  let sendExecutionLayerRequestsSpy: ReturnType<typeof spyOn>;
  let fetchContractFeeSpy: ReturnType<typeof spyOn>;
  let mockDispose: ReturnType<typeof mock>;

  beforeEach(() => {
    stderrSpy = spyOn(console, 'error').mockImplementation(() => {});
    spyOn(console, 'log').mockImplementation(() => {});

    mockDispose = mock(() => Promise.resolve());

    createEthereumConnectionSpy = spyOn(
      ethereumModule,
      'createEthereumConnection'
    ).mockImplementation(() => Promise.resolve({ provider: mockProvider, signer: mockSigner }));
    createEthereumConnectionSpy.mockClear();

    initializeSafeSpy = spyOn(safeInitModule, 'initializeSafe').mockImplementation(() =>
      Promise.resolve({
        apiKit: mockApiKit as never,
        protocolKit: mockProtocolKit as never,
        provider: mockProvider,
        signerAddress: SAFE_SIGNER_ADDRESS,
        safeInfo: MOCK_SAFE_INFO,
        dispose: mockDispose
      })
    );
    initializeSafeSpy.mockClear();

    proposeSafeTransactionsSpy = spyOn(
      safeProposeModule,
      'proposeSafeTransactions'
    ).mockImplementation(() => Promise.resolve());
    proposeSafeTransactionsSpy.mockClear();

    sendExecutionLayerRequestsSpy = spyOn(
      sendRequestModule,
      'sendExecutionLayerRequests'
    ).mockImplementation(() => Promise.resolve());
    sendExecutionLayerRequestsSpy.mockClear();

    fetchContractFeeSpy = spyOn(
      ethereumStateServiceModule.EthereumStateService.prototype,
      'fetchContractFee'
    ).mockImplementation(() => Promise.resolve(CONTRACT_FEE));
    fetchContractFeeSpy.mockClear();
  });

  afterEach(() => {
    mock.restore();
  });

  describe('direct pipeline branch (no safe option)', () => {
    it('creates an ethereum connection with wallet signer when ledger is false', async () => {
      const options = buildGlobalOptions({ ledger: false, jsonRpcUrl: 'http://rpc:1234' });

      await executeRequestPipeline(buildPipelineConfig({ globalOptions: options }));

      expect(createEthereumConnectionSpy).toHaveBeenCalledTimes(1);
      expect(createEthereumConnectionSpy).toHaveBeenCalledWith('http://rpc:1234', 'wallet');
    });

    it('creates an ethereum connection with ledger signer when ledger is true', async () => {
      const options = buildGlobalOptions({ ledger: true, jsonRpcUrl: 'http://rpc:1234' });

      await executeRequestPipeline(buildPipelineConfig({ globalOptions: options }));

      expect(createEthereumConnectionSpy).toHaveBeenCalledWith('http://rpc:1234', 'ledger');
    });

    it('invokes validate with the signer address and no owner label', async () => {
      const validate = mock(() => Promise.resolve());

      await executeRequestPipeline(buildPipelineConfig({ validate }));

      expect(validate).toHaveBeenCalledTimes(1);
      expect(validate).toHaveBeenCalledWith(DIRECT_SIGNER_ADDRESS);
    });

    it('skips validate when not provided', async () => {
      await executeRequestPipeline(buildPipelineConfig());

      expect(sendExecutionLayerRequestsSpy).toHaveBeenCalledTimes(1);
    });

    it('forwards resolved contract address, provider, signer and encoded data to send-request', async () => {
      const options = buildGlobalOptions({ maxRequestsPerBlock: 5, beaconApiUrl: 'http://b:1' });
      const pubkeys = ['0xaaa', '0xbbb'];

      await executeRequestPipeline(
        buildPipelineConfig({
          globalOptions: options,
          validatorPubkeys: pubkeys,
          resolveContractAddress: () => WITHDRAWAL_CONTRACT_ADDRESS
        })
      );

      expect(sendExecutionLayerRequestsSpy).toHaveBeenCalledWith(
        WITHDRAWAL_CONTRACT_ADDRESS,
        mockProvider,
        mockSigner,
        ['data:0xaaa', 'data:0xbbb'],
        5,
        'http://b:1'
      );
    });

    it('does not invoke Safe initialization when safe option is not set', async () => {
      await executeRequestPipeline(buildPipelineConfig());

      expect(initializeSafeSpy).not.toHaveBeenCalled();
      expect(proposeSafeTransactionsSpy).not.toHaveBeenCalled();
    });
  });

  describe('safe pipeline branch', () => {
    it('initializes Safe with the provided safe address', async () => {
      const options = buildGlobalOptions({ safe: SAFE_ADDRESS });

      await executeRequestPipeline(buildPipelineConfig({ globalOptions: options }));

      expect(initializeSafeSpy).toHaveBeenCalledTimes(1);
      const [optsArg, netConfigArg, safeArg] = initializeSafeSpy.mock.calls[0] as unknown as [
        GlobalCliOptions,
        { chainId: bigint },
        string
      ];
      expect(optsArg).toBe(options);
      expect(netConfigArg.chainId).toBe(560048n);
      expect(safeArg).toBe(SAFE_ADDRESS);
    });

    it('calls validate with the safe address and OWNER_LABEL_SAFE', async () => {
      const validate = mock(() => Promise.resolve());
      const options = buildGlobalOptions({ safe: SAFE_ADDRESS });

      await executeRequestPipeline(buildPipelineConfig({ globalOptions: options, validate }));

      expect(validate).toHaveBeenCalledTimes(1);
      expect(validate).toHaveBeenCalledWith(SAFE_ADDRESS, OWNER_LABEL_SAFE);
    });

    it('uses the default safe fee tip when safeFeeTip is unset', async () => {
      const options = buildGlobalOptions({ safe: SAFE_ADDRESS });

      await executeRequestPipeline(buildPipelineConfig({ globalOptions: options }));

      const proposeCall = proposeSafeTransactionsSpy.mock.calls[0] as unknown as [
        { contractFee: bigint }
      ];
      expect(proposeCall[0].contractFee).toBe(CONTRACT_FEE + DEFAULT_SAFE_FEE_TIP);
    });

    it('adds an explicit safe fee tip on top of the contract fee', async () => {
      const options = buildGlobalOptions({ safe: SAFE_ADDRESS, safeFeeTip: '250' });

      await executeRequestPipeline(buildPipelineConfig({ globalOptions: options }));

      const proposeCall = proposeSafeTransactionsSpy.mock.calls[0] as unknown as [
        { contractFee: bigint }
      ];
      expect(proposeCall[0].contractFee).toBe(CONTRACT_FEE + 250n);
    });

    it('logs the fee tip info line when tip is greater than zero', async () => {
      const options = buildGlobalOptions({ safe: SAFE_ADDRESS, safeFeeTip: '250' });

      await executeRequestPipeline(buildPipelineConfig({ globalOptions: options }));

      const expectedMessage = SAFE_FEE_TIP_INFO(CONTRACT_FEE, 250n, CONTRACT_FEE + 250n);
      const allStderr = stderrSpy.mock.calls.flat().join('\n');
      expect(allStderr).toContain(expectedMessage);
    });

    it('does not log the fee tip info line when tip is zero', async () => {
      const options = buildGlobalOptions({ safe: SAFE_ADDRESS, safeFeeTip: '0' });

      await executeRequestPipeline(buildPipelineConfig({ globalOptions: options }));

      const zeroTipMessage = SAFE_FEE_TIP_INFO(CONTRACT_FEE, 0n, CONTRACT_FEE);
      const allStderr = stderrSpy.mock.calls.flat().join('\n');
      expect(allStderr).not.toContain(zeroTipMessage);
    });

    it('propagates maxRequestsPerBlock as maxRequestsPerBatch to the proposer', async () => {
      const options = buildGlobalOptions({ safe: SAFE_ADDRESS, maxRequestsPerBlock: 7 });

      await executeRequestPipeline(buildPipelineConfig({ globalOptions: options }));

      const proposeCall = proposeSafeTransactionsSpy.mock.calls[0] as unknown as [
        { maxRequestsPerBatch: number }
      ];
      expect(proposeCall[0].maxRequestsPerBatch).toBe(7);
    });

    it('uses the Safe init signer address as senderAddress', async () => {
      const options = buildGlobalOptions({ safe: SAFE_ADDRESS });

      await executeRequestPipeline(buildPipelineConfig({ globalOptions: options }));

      const proposeCall = proposeSafeTransactionsSpy.mock.calls[0] as unknown as [
        { senderAddress: string }
      ];
      expect(proposeCall[0].senderAddress).toBe(SAFE_SIGNER_ADDRESS);
    });

    it('forwards the safe threshold from safeInfo to the proposer', async () => {
      const options = buildGlobalOptions({ safe: SAFE_ADDRESS });

      await executeRequestPipeline(buildPipelineConfig({ globalOptions: options }));

      const proposeCall = proposeSafeTransactionsSpy.mock.calls[0] as unknown as [
        { threshold: number }
      ];
      expect(proposeCall[0].threshold).toBe(MOCK_SAFE_INFO.threshold);
    });

    it('forwards encoded request data and validator pubkeys to the proposer', async () => {
      const options = buildGlobalOptions({ safe: SAFE_ADDRESS });
      const pubkeys = ['0xaaa', '0xbbb'];

      await executeRequestPipeline(
        buildPipelineConfig({ globalOptions: options, validatorPubkeys: pubkeys })
      );

      const proposeCall = proposeSafeTransactionsSpy.mock.calls[0] as unknown as [
        {
          requestData: string[];
          validatorPubkeys: string[];
          contractAddress: string;
          safeAddress: string;
          apiKit: unknown;
          protocolKit: unknown;
        }
      ];
      expect(proposeCall[0].requestData).toEqual(['data:0xaaa', 'data:0xbbb']);
      expect(proposeCall[0].validatorPubkeys).toEqual(pubkeys);
      expect(proposeCall[0].contractAddress).toBe(CONSOLIDATION_CONTRACT_ADDRESS);
      expect(proposeCall[0].safeAddress).toBe(SAFE_ADDRESS);
      expect(proposeCall[0].apiKit).toBe(mockApiKit);
      expect(proposeCall[0].protocolKit).toBe(mockProtocolKit);
    });

    it('does not create a direct ethereum connection when Safe branch is taken', async () => {
      const options = buildGlobalOptions({ safe: SAFE_ADDRESS });

      await executeRequestPipeline(buildPipelineConfig({ globalOptions: options }));

      expect(createEthereumConnectionSpy).not.toHaveBeenCalled();
      expect(sendExecutionLayerRequestsSpy).not.toHaveBeenCalled();
    });
  });

  describe('safe pipeline resource disposal', () => {
    it('disposes safe init result when validate throws', async () => {
      const options = buildGlobalOptions({ safe: SAFE_ADDRESS });
      const validate = mock(() => Promise.reject(new Error('validation failed')));

      await expect(
        executeRequestPipeline(buildPipelineConfig({ globalOptions: options, validate }))
      ).rejects.toThrow('validation failed');

      expect(mockDispose).toHaveBeenCalledTimes(1);
      expect(proposeSafeTransactionsSpy).not.toHaveBeenCalled();
    });

    it('disposes safe init result when fee fetch throws', async () => {
      const options = buildGlobalOptions({ safe: SAFE_ADDRESS });
      fetchContractFeeSpy.mockImplementationOnce(() =>
        Promise.reject(new Error('fee fetch failed'))
      );

      await expect(
        executeRequestPipeline(buildPipelineConfig({ globalOptions: options }))
      ).rejects.toThrow('fee fetch failed');

      expect(mockDispose).toHaveBeenCalledTimes(1);
      expect(proposeSafeTransactionsSpy).not.toHaveBeenCalled();
    });

    it('disposes safe init result when proposeSafeTransactions throws', async () => {
      const options = buildGlobalOptions({ safe: SAFE_ADDRESS });
      proposeSafeTransactionsSpy.mockImplementationOnce(() =>
        Promise.reject(new Error('propose failed'))
      );

      await expect(
        executeRequestPipeline(buildPipelineConfig({ globalOptions: options }))
      ).rejects.toThrow('propose failed');

      expect(mockDispose).toHaveBeenCalledTimes(1);
    });

    it('disposes safe init result after a successful safe run', async () => {
      const options = buildGlobalOptions({ safe: SAFE_ADDRESS });

      await executeRequestPipeline(buildPipelineConfig({ globalOptions: options }));

      expect(mockDispose).toHaveBeenCalledTimes(1);
    });
  });

  describe('invalid network handling', () => {
    it('throws TypeError when resolveContractAddress dereferences an undefined netConfig', async () => {
      const options = buildGlobalOptions({ network: 'does-not-exist' });

      await expect(
        executeRequestPipeline(
          buildPipelineConfig({
            globalOptions: options,
            resolveContractAddress: (netConfig) => netConfig.consolidationContractAddress
          })
        )
      ).rejects.toThrow(TypeError);
    });
  });
});
