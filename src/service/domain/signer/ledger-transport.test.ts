import type Transport from '@ledgerhq/hw-transport';
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { LEDGER_CONNECTION_TIMEOUT_MS } from '../../../constants/application';

const mockCreate = mock(() => Promise.resolve({} as Transport));

mock.module('@ledgerhq/hw-transport-node-hid', () => ({
  default: { create: mockCreate }
}));

const { connectWithTimeout } = await import('./ledger-transport');

/**
 * Build a minimal transport test double.
 *
 * @returns Transport stub with only the fields referenced by tests in this file
 */
function createFakeTransport(): Transport {
  return { close: mock(() => Promise.resolve()) } as unknown as Transport;
}

/**
 * Wait for a single macrotask tick so that microtask-scheduled timer callbacks
 * have an opportunity to run before the caller inspects the resulting state.
 *
 * @param ms - Sleep duration in milliseconds
 */
function waitMilliseconds(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('connectWithTimeout', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  afterEach(() => {
    mockCreate.mockReset();
  });

  describe('happy path', () => {
    it('resolves with the transport returned by TransportNodeHid.create', async () => {
      const transport = createFakeTransport();
      mockCreate.mockImplementation(() => Promise.resolve(transport));

      const result = await connectWithTimeout();

      expect(result).toBe(transport);
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });
  });

  describe('timeout behavior', () => {
    it(
      'rejects with a Connection timeout error after LEDGER_CONNECTION_TIMEOUT_MS when the transport never resolves',
      async () => {
        mockCreate.mockImplementation(() => new Promise<Transport>(() => {}));

        const startedAt = Date.now();
        const error = await connectWithTimeout().catch((e: unknown) => e);
        const elapsed = Date.now() - startedAt;

        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('Connection timeout');
        expect(elapsed).toBeGreaterThanOrEqual(LEDGER_CONNECTION_TIMEOUT_MS - 200);
      },
      LEDGER_CONNECTION_TIMEOUT_MS + 2000
    );
  });

  describe('underlying rejection propagation', () => {
    it('propagates the TransportNodeHid.create rejection when it fails before the timeout', async () => {
      const deviceError = new Error('No Ledger device found');
      mockCreate.mockImplementation(() => Promise.reject(deviceError));

      await expect(connectWithTimeout()).rejects.toBe(deviceError);
    });

    it('rejects with the underlying error synchronously without waiting for the timeout window', async () => {
      const deviceError = new Error('USB busy');
      mockCreate.mockImplementation(() => Promise.reject(deviceError));

      const startedAt = Date.now();
      await expect(connectWithTimeout()).rejects.toBe(deviceError);
      const elapsed = Date.now() - startedAt;

      expect(elapsed).toBeLessThan(LEDGER_CONNECTION_TIMEOUT_MS);
    });
  });

  describe('timer cleanup after process lifetime', () => {
    it('allows the event loop to quiesce after a successful connect within the timeout window', async () => {
      const transport = createFakeTransport();
      mockCreate.mockImplementation(() => Promise.resolve(transport));

      const result = await connectWithTimeout();

      await waitMilliseconds(0);
      expect(result).toBe(transport);
    });
  });
});
