import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

import {
  SECONDS_PER_SLOT,
  SLOT_BOUNDARY_BUFFER_MS,
  SLOT_BOUNDARY_THRESHOLD
} from '../../constants/application';
import { BlockchainStateError } from '../../model/ethereum';

const MOCK_GENESIS_TIME = 1606824023;

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
    json: () => Promise.resolve(jsonData ?? { data: { genesis_time: String(MOCK_GENESIS_TIME) } })
  };
};

const mockFetch = mock(() => Promise.resolve(createMockFetchResponse()));

mock.module('undici', () => ({
  fetch: mockFetch
}));

const { BeaconService } = await import('./beacon-service');

describe('BeaconService', () => {
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    mockFetch.mockClear();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('initialize', () => {
    it('fetches and parses genesis time from beacon API', async () => {
      mockFetch.mockResolvedValueOnce(createMockFetchResponse());

      const service = new BeaconService('http://localhost:5052');
      await service.initialize();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5052/eth/v1/beacon/genesis'
      );

      const position = service.calculateSlotPosition();
      expect(position.currentSlot).toBeGreaterThan(0);
    });

    it('throws BlockchainStateError when API returns non-200 status', async () => {
      mockFetch.mockResolvedValue(
        createMockFetchResponse({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error'
        })
      );

      const service = new BeaconService('http://localhost:5052');

      await expect(service.initialize()).rejects.toThrow(BlockchainStateError);
      await expect(service.initialize()).rejects.toThrow(
        'Failed to fetch beacon genesis: 500 Internal Server Error'
      );
    });

    it('throws BlockchainStateError when genesis time is invalid', async () => {
      mockFetch.mockResolvedValue(
        createMockFetchResponse({
          jsonData: { data: { genesis_time: 'not-a-number' } }
        })
      );

      const service = new BeaconService('http://localhost:5052');

      await expect(service.initialize()).rejects.toThrow(BlockchainStateError);
      await expect(service.initialize()).rejects.toThrow(
        'Invalid genesis time received from beacon API'
      );
    });

    it('throws BlockchainStateError when network request fails', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const service = new BeaconService('http://localhost:5052');

      await expect(service.initialize()).rejects.toThrow(BlockchainStateError);
      await expect(service.initialize()).rejects.toThrow('Unable to initialize beacon service');
    });

    it('includes original error as cause when network request fails', async () => {
      const originalError = new Error('Network error');
      mockFetch.mockRejectedValue(originalError);

      const service = new BeaconService('http://localhost:5052');

      try {
        await service.initialize();
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(BlockchainStateError);
        expect((error as BlockchainStateError).cause).toBe(originalError);
      }
    });
  });

  describe('calculateSlotPosition', () => {
    it('throws error when service not initialized', () => {
      const service = new BeaconService('http://localhost:5052');

      expect(() => service.calculateSlotPosition()).toThrow(
        'BeaconService not initialized - call initialize() first'
      );
    });

    it('calculates correct slot position for known timestamp', async () => {
      mockFetch.mockResolvedValueOnce(createMockFetchResponse());

      const service = new BeaconService('http://localhost:5052');
      await service.initialize();

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

      const service = new BeaconService('http://localhost:5052');
      await service.initialize();

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

      const service = new BeaconService('http://localhost:5052');
      await service.initialize();

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

    it('waits when secondInSlot exceeds threshold', async () => {
      mockFetch.mockResolvedValueOnce(createMockFetchResponse());

      const service = new BeaconService('http://localhost:5052');
      await service.initialize();

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
