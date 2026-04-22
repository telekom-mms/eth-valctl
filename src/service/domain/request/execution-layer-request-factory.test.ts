import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { JsonRpcProvider } from 'ethers';

import type { ISigner, SignerCapabilities } from '../../../ports/signer.interface';
import { BeaconService } from '../../infrastructure/beacon-service';
import { ParallelBroadcastStrategy } from './broadcast-strategy/parallel-broadcast-strategy';
import { SequentialBroadcastStrategy } from './broadcast-strategy/sequential-broadcast-strategy';
import { createTransactionPipeline } from './execution-layer-request-factory';

const SYSTEM_CONTRACT_ADDRESS = '0x0000BBdDc7CE488642fb579F8B00f3a590007251';
const BEACON_API_URL = 'http://localhost:5052';

/**
 * Minimal fake implementing the BeaconService-facing ISlotTimingService surface.
 * dispose() is spied to verify the factory wires it into the sequential strategy's cleanup chain.
 *
 * @returns A BeaconService test double whose methods are all jest/bun mock functions
 */
function createMockBeaconService(): BeaconService {
  return {
    calculateSlotPosition: mock(() => ({
      currentSlot: 1,
      secondInSlot: 0,
      secondsUntilNextSlot: 12
    })),
    waitForOptimalBroadcastWindow: mock(() => Promise.resolve()),
    dispose: mock(() => Promise.resolve())
  } as unknown as BeaconService;
}

/**
 * Build a minimal ISigner stub with configurable parallel-signing capability.
 *
 * @param capabilities - Capability flags exposed on the signer
 * @returns ISigner double — only `capabilities` is read by the factory under test
 */
function createMockSigner(capabilities: SignerCapabilities): ISigner {
  return {
    capabilities,
    address: '0xMockSigner',
    sendTransaction: mock(() => Promise.reject(new Error('unexpected'))),
    sendTransactionWithNonce: mock(() => Promise.reject(new Error('unexpected'))),
    dispose: mock(() => Promise.resolve())
  } as unknown as ISigner;
}

/**
 * Produce a placeholder JsonRpcProvider reference for identity checks.
 *
 * @returns An opaque object stand-in for the real provider
 */
function createMockProvider(): JsonRpcProvider {
  return { __mockProvider: true } as unknown as JsonRpcProvider;
}

describe('createTransactionPipeline', () => {
  let beaconCreateSpy: ReturnType<typeof spyOn>;
  let parallelDisposeSpy: ReturnType<typeof spyOn>;
  let sequentialDisposeSpy: ReturnType<typeof spyOn>;
  let mockBeacon: BeaconService;

  beforeEach(() => {
    mockBeacon = createMockBeaconService();
    beaconCreateSpy = spyOn(BeaconService, 'create').mockImplementation(() =>
      Promise.resolve(mockBeacon)
    );
    parallelDisposeSpy = spyOn(ParallelBroadcastStrategy.prototype, 'dispose');
    sequentialDisposeSpy = spyOn(SequentialBroadcastStrategy.prototype, 'dispose');
  });

  afterEach(() => {
    beaconCreateSpy.mockRestore();
    parallelDisposeSpy.mockRestore();
    sequentialDisposeSpy.mockRestore();
  });

  describe('wallet signer (supportsParallelSigning === true)', () => {
    it('does not call BeaconService.create', async () => {
      const signer = createMockSigner({ supportsParallelSigning: true });
      const provider = createMockProvider();

      await createTransactionPipeline(SYSTEM_CONTRACT_ADDRESS, provider, signer, BEACON_API_URL);

      expect(beaconCreateSpy).not.toHaveBeenCalled();
    });

    it('returns a pipeline whose dispose invokes ParallelBroadcastStrategy.dispose', async () => {
      const signer = createMockSigner({ supportsParallelSigning: true });
      const provider = createMockProvider();

      const pipeline = await createTransactionPipeline(
        SYSTEM_CONTRACT_ADDRESS,
        provider,
        signer,
        BEACON_API_URL
      );
      await pipeline.dispose();

      expect(parallelDisposeSpy).toHaveBeenCalledTimes(1);
      expect(sequentialDisposeSpy).not.toHaveBeenCalled();
    });

    it('resolves without throwing when beacon API URL is empty (wallet path ignores it)', async () => {
      const signer = createMockSigner({ supportsParallelSigning: true });
      const provider = createMockProvider();

      await expect(
        createTransactionPipeline(SYSTEM_CONTRACT_ADDRESS, provider, signer, '')
      ).resolves.toBeDefined();

      expect(beaconCreateSpy).not.toHaveBeenCalled();
    });
  });

  describe('ledger signer (supportsParallelSigning === false)', () => {
    it('calls BeaconService.create exactly once with the beaconApiUrl', async () => {
      const signer = createMockSigner({ supportsParallelSigning: false });
      const provider = createMockProvider();

      await createTransactionPipeline(SYSTEM_CONTRACT_ADDRESS, provider, signer, BEACON_API_URL);

      expect(beaconCreateSpy).toHaveBeenCalledTimes(1);
      expect(beaconCreateSpy).toHaveBeenCalledWith(BEACON_API_URL);
    });

    it('returns a pipeline whose dispose invokes SequentialBroadcastStrategy.dispose', async () => {
      const signer = createMockSigner({ supportsParallelSigning: false });
      const provider = createMockProvider();

      const pipeline = await createTransactionPipeline(
        SYSTEM_CONTRACT_ADDRESS,
        provider,
        signer,
        BEACON_API_URL
      );
      await pipeline.dispose();

      expect(sequentialDisposeSpy).toHaveBeenCalledTimes(1);
      expect(parallelDisposeSpy).not.toHaveBeenCalled();
    });

    it('disposing the sequential pipeline propagates dispose to the beacon service', async () => {
      const signer = createMockSigner({ supportsParallelSigning: false });
      const provider = createMockProvider();

      const pipeline = await createTransactionPipeline(
        SYSTEM_CONTRACT_ADDRESS,
        provider,
        signer,
        BEACON_API_URL
      );
      sequentialDisposeSpy.mockRestore();
      await pipeline.dispose();

      expect(mockBeacon.dispose).toHaveBeenCalledTimes(1);
    });
  });

  describe('error propagation in the Ledger path', () => {
    /**
     * REFACTOR-07: BeaconService.create runs AFTER the wallet-path branch but BEFORE the
     * SequentialBroadcastStrategy is constructed. If the factory is ever refactored to
     * allocate disposable resources ahead of the `await BeaconService.create(...)` call,
     * this test will flag the resource-leak regression.
     */
    it('propagates BeaconService.create rejection', async () => {
      const failure = new Error('beacon unreachable');
      beaconCreateSpy.mockImplementation(() => Promise.reject(failure));

      const signer = createMockSigner({ supportsParallelSigning: false });
      const provider = createMockProvider();

      await expect(
        createTransactionPipeline(SYSTEM_CONTRACT_ADDRESS, provider, signer, BEACON_API_URL)
      ).rejects.toThrow('beacon unreachable');
    });

    it('does not instantiate the sequential dispose chain when BeaconService.create rejects', async () => {
      beaconCreateSpy.mockImplementation(() => Promise.reject(new Error('boom')));

      const signer = createMockSigner({ supportsParallelSigning: false });
      const provider = createMockProvider();

      await expect(
        createTransactionPipeline(SYSTEM_CONTRACT_ADDRESS, provider, signer, BEACON_API_URL)
      ).rejects.toThrow();

      expect(sequentialDisposeSpy).not.toHaveBeenCalled();
      expect(mockBeacon.dispose).not.toHaveBeenCalled();
    });
  });
});
