import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import * as undici from 'undici';

import { SLOT_BOUNDARY_BUFFER_MS } from '../../constants/application';
import { BlockchainStateError } from '../../model/ethereum';
import { BeaconService, fetchBeaconSpec } from './beacon-service';

const MOCK_GENESIS_TIME = 1606824023;
const SECONDS_PER_SLOT = 12;
const SLOT_BOUNDARY_THRESHOLD = 10;
const MOCK_SPEC = {
  SLOT_DURATION_MS: '12000',
  SECONDS_PER_SLOT: '12',
  SLOTS_PER_EPOCH: '32',
  SHARD_COMMITTEE_PERIOD: '256',
  MIN_ACTIVATION_BALANCE: '32000000000',
  PENDING_PARTIAL_WITHDRAWALS_LIMIT: '134217728',
  PENDING_CONSOLIDATIONS_LIMIT: '262144'
};

const createMockFetchResponse = (
  options: {
    ok?: boolean;
    status?: number;
    statusText?: string;
    jsonData?: unknown;
  } = {}
) => {
  const { ok = true, status = 200, statusText = 'OK', jsonData } = options;
  return {
    ok,
    status,
    statusText,
    json: () =>
      Promise.resolve(
        jsonData ?? { data: { genesis_time: String(MOCK_GENESIS_TIME), ...MOCK_SPEC } }
      )
  };
};

/**
 * Route mocked beacon API calls: the spec endpoint returns the given spec, every other endpoint
 * returns the given genesis response.
 *
 * @param genesisResponse - Response for the genesis endpoint
 * @param spec - Spec key/value map for the spec endpoint
 */
const routeFetch = (
  genesisResponse: ReturnType<typeof createMockFetchResponse>,
  spec: Record<string, string> = MOCK_SPEC
) =>
  mockFetch.mockImplementation(((url: string) =>
    Promise.resolve(
      url.endsWith('/eth/v1/config/spec')
        ? createMockFetchResponse({ jsonData: { data: spec } })
        : genesisResponse
    )) as never);

const mockFetch = mock(() => Promise.resolve(createMockFetchResponse()));

describe('BeaconService', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    mockFetch.mockReset();
    mockFetch.mockImplementation(() => Promise.resolve(createMockFetchResponse()));
    spyOn(undici, 'fetch').mockImplementation(mockFetch as never);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    mock.restore();
  });

  describe('create', () => {
    it('fetches and parses genesis time and spec from beacon API', async () => {
      mockFetch.mockResolvedValueOnce(createMockFetchResponse());

      const service = await BeaconService.create('http://localhost:5052');

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:5052/eth/v1/beacon/genesis');
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:5052/eth/v1/config/spec');
      expect(service.spec.slotDurationMs).toBe(12000);

      const position = service.calculateSlotPosition();
      expect(position.currentSlot).toBeGreaterThan(0);
    });

    it('throws BlockchainStateError when API returns non-200 status', async () => {
      routeFetch(
        createMockFetchResponse({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error'
        })
      );

      await expect(BeaconService.create('http://localhost:5052')).rejects.toThrow(
        BlockchainStateError
      );
      await expect(BeaconService.create('http://localhost:5052')).rejects.toThrow(
        'Failed to fetch beacon genesis: 500 Internal Server Error'
      );
    });

    it('throws BlockchainStateError when genesis time is invalid', async () => {
      routeFetch(
        createMockFetchResponse({
          jsonData: { data: { genesis_time: 'not-a-number' } }
        })
      );

      await expect(BeaconService.create('http://localhost:5052')).rejects.toThrow(
        BlockchainStateError
      );
      await expect(BeaconService.create('http://localhost:5052')).rejects.toThrow(
        'Invalid genesis time received from beacon API'
      );
    });

    it('throws BlockchainStateError when network request fails', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(BeaconService.create('http://localhost:5052')).rejects.toThrow(
        BlockchainStateError
      );
      await expect(BeaconService.create('http://localhost:5052')).rejects.toThrow(
        'Unable to initialize beacon service'
      );
    });

    it('includes original error as cause when network request fails', async () => {
      const originalError = new Error('Network error');
      mockFetch.mockRejectedValue(originalError);

      try {
        await BeaconService.create('http://localhost:5052');
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(BlockchainStateError);
        expect((error as BlockchainStateError).cause).toBe(originalError);
      }
    });
  });

  describe('fetchBeaconSpec', () => {
    it('prefers SLOT_DURATION_MS over SECONDS_PER_SLOT', async () => {
      routeFetch(createMockFetchResponse(), { ...MOCK_SPEC, SLOT_DURATION_MS: '6000' });

      const spec = await fetchBeaconSpec('http://localhost:5052');

      expect(spec.slotDurationMs).toBe(6000);
      expect(spec.slotsPerEpoch).toBe(32);
      expect(spec.shardCommitteePeriod).toBe(256);
      expect(spec.minActivationBalance).toBe(32000000000n);
      expect(spec.pendingPartialWithdrawalsLimit).toBe(134217728);
      expect(spec.pendingConsolidationsLimit).toBe(262144);
    });

    it('falls back to SECONDS_PER_SLOT when SLOT_DURATION_MS is missing', async () => {
      const legacySpec: Record<string, string> = { ...MOCK_SPEC };
      delete legacySpec['SLOT_DURATION_MS'];
      routeFetch(createMockFetchResponse(), legacySpec);

      const spec = await fetchBeaconSpec('http://localhost:5052');

      expect(spec.slotDurationMs).toBe(12000);
    });

    it('throws BlockchainStateError when a required key is missing', async () => {
      const incompleteSpec: Record<string, string> = { ...MOCK_SPEC };
      delete incompleteSpec['SLOTS_PER_EPOCH'];
      routeFetch(createMockFetchResponse(), incompleteSpec);

      await expect(fetchBeaconSpec('http://localhost:5052')).rejects.toThrow(
        'Invalid or missing beacon chain spec value for SLOTS_PER_EPOCH'
      );
    });

    it('throws BlockchainStateError when the spec endpoint fails', async () => {
      mockFetch.mockResolvedValue(
        createMockFetchResponse({ ok: false, status: 404, statusText: 'Not Found' })
      );

      await expect(fetchBeaconSpec('http://localhost:5052')).rejects.toThrow(
        'Failed to fetch beacon chain spec: 404 Not Found'
      );
    });
  });

  describe('calculateCurrentEpoch', () => {
    it('derives the epoch from the current slot and SLOTS_PER_EPOCH', async () => {
      const service = await BeaconService.create('http://localhost:5052');
      spyOn(service, 'calculateSlotPosition').mockReturnValue({
        currentSlot: 65,
        secondInSlot: 0,
        secondsUntilNextSlot: SECONDS_PER_SLOT
      });

      expect(service.calculateCurrentEpoch()).toBe(2);
    });
  });

  describe('calculateSlotPosition', () => {
    it('calculates correct slot position for known timestamp', async () => {
      mockFetch.mockResolvedValueOnce(createMockFetchResponse());

      const service = await BeaconService.create('http://localhost:5052');

      const now = Math.floor(Date.now() / 1000);
      const expectedSlot = Math.floor((now - MOCK_GENESIS_TIME) / SECONDS_PER_SLOT);

      const position = service.calculateSlotPosition();

      expect(position.currentSlot).toBe(expectedSlot);
      expect(position.secondInSlot).toBeGreaterThanOrEqual(0);
      expect(position.secondInSlot).toBeLessThan(SECONDS_PER_SLOT);
      expect(position.secondsUntilNextSlot).toBeGreaterThan(0);
      expect(position.secondsUntilNextSlot).toBeLessThanOrEqual(SECONDS_PER_SLOT);
      expect(position.secondInSlot + position.secondsUntilNextSlot).toBe(SECONDS_PER_SLOT);
    });
  });

  describe('waitForOptimalBroadcastWindow', () => {
    it('does not wait when secondInSlot is below threshold', async () => {
      mockFetch.mockResolvedValueOnce(createMockFetchResponse());

      const service = await BeaconService.create('http://localhost:5052');

      const calculateSlotPositionSpy = spyOn(service, 'calculateSlotPosition').mockReturnValue({
        currentSlot: 100,
        secondInSlot: SLOT_BOUNDARY_THRESHOLD - 1,
        secondsUntilNextSlot: SECONDS_PER_SLOT - (SLOT_BOUNDARY_THRESHOLD - 1)
      });

      const startTime = Date.now();
      await service.waitForOptimalBroadcastWindow();
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(100);
      expect(consoleSpy).not.toHaveBeenCalled();

      calculateSlotPositionSpy.mockRestore();
    });

    it('waits when secondInSlot equals threshold', async () => {
      mockFetch.mockResolvedValueOnce(createMockFetchResponse());

      const service = await BeaconService.create('http://localhost:5052');

      const secondsUntilNext = 2;
      const calculateSlotPositionSpy = spyOn(service, 'calculateSlotPosition').mockReturnValue({
        currentSlot: 100,
        secondInSlot: SLOT_BOUNDARY_THRESHOLD,
        secondsUntilNextSlot: secondsUntilNext
      });

      const startTime = Date.now();
      await service.waitForOptimalBroadcastWindow();
      const elapsed = Date.now() - startTime;

      const expectedWaitMs = secondsUntilNext * 1000 + SLOT_BOUNDARY_BUFFER_MS;
      expect(elapsed).toBeGreaterThanOrEqual(expectedWaitMs - 50);
      expect(elapsed).toBeLessThan(expectedWaitMs + 100);
      expect(consoleSpy).toHaveBeenCalled();

      calculateSlotPositionSpy.mockRestore();
    });

    it('scales the threshold with the slot duration', async () => {
      routeFetch(createMockFetchResponse(), { ...MOCK_SPEC, SLOT_DURATION_MS: '6000' });
      const service = await BeaconService.create('http://localhost:5052');
      spyOn(service, 'calculateSlotPosition').mockReturnValue({
        currentSlot: 100,
        secondInSlot: 5,
        secondsUntilNextSlot: 1
      });

      const startTime = Date.now();
      await service.waitForOptimalBroadcastWindow();

      expect(Date.now() - startTime).toBeGreaterThanOrEqual(1000 + SLOT_BOUNDARY_BUFFER_MS - 50);
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('waits when secondInSlot exceeds threshold', async () => {
      mockFetch.mockResolvedValueOnce(createMockFetchResponse());

      const service = await BeaconService.create('http://localhost:5052');

      const secondsUntilNext = 1;
      const calculateSlotPositionSpy = spyOn(service, 'calculateSlotPosition').mockReturnValue({
        currentSlot: 100,
        secondInSlot: SLOT_BOUNDARY_THRESHOLD + 1,
        secondsUntilNextSlot: secondsUntilNext
      });

      const startTime = Date.now();
      await service.waitForOptimalBroadcastWindow();
      const elapsed = Date.now() - startTime;

      const expectedWaitMs = secondsUntilNext * 1000 + SLOT_BOUNDARY_BUFFER_MS;
      expect(elapsed).toBeGreaterThanOrEqual(expectedWaitMs - 50);
      expect(elapsed).toBeLessThan(expectedWaitMs + 100);

      calculateSlotPositionSpy.mockRestore();
    });
  });
});
