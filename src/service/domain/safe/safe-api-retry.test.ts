import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

import {
  SAFE_RATE_LIMIT_MAX_RETRIES,
  SAFE_RATE_LIMIT_PATTERNS,
  SAFE_UNAUTHORIZED_PATTERN
} from '../../../constants/application';
import * as logging from '../../../constants/logging';
import { withRateRetry } from './safe-api-retry';

describe('withRateRetry', () => {
  let exitSpy: ReturnType<typeof spyOn>;
  let consoleErrorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    exitSpy = spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    mock.restore();
  });

  it('returns result on first successful call', async () => {
    const fn = mock(() => Promise.resolve('ok'));

    const result = await withRateRetry(fn);

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 and succeeds on second attempt', async () => {
    const fn = mock()
      .mockRejectedValueOnce(new Error(SAFE_RATE_LIMIT_PATTERNS[0]!))
      .mockResolvedValueOnce('ok');

    const result = await withRateRetry(fn);

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        logging.SAFE_RATE_LIMITED_RETRY_WARNING(1, SAFE_RATE_LIMIT_MAX_RETRIES)
      )
    );
  });

  it('exits after max consecutive 429 retries', async () => {
    const fn = mock(() => Promise.reject(new Error(SAFE_RATE_LIMIT_PATTERNS[1]!)));

    await expect(withRateRetry(fn)).rejects.toThrow('process.exit called');

    expect(fn).toHaveBeenCalledTimes(SAFE_RATE_LIMIT_MAX_RETRIES);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining(logging.SAFE_RATE_LIMIT_EXHAUSTED_ERROR)
    );
  });

  it('rethrows non-429 errors immediately without retry', async () => {
    const fn = mock(() => Promise.reject(new Error('some other error')));

    await expect(withRateRetry(fn)).rejects.toThrow('some other error');

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('exits immediately on 401 Unauthorized without retry', async () => {
    const fn = mock(() => Promise.reject(new Error(SAFE_UNAUTHORIZED_PATTERN)));

    await expect(withRateRetry(fn)).rejects.toThrow('process.exit called');

    expect(fn).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining(logging.SAFE_UNAUTHORIZED_ERROR)
    );
  });

  it('detects 401 before checking 429 patterns', async () => {
    const fn = mock(() =>
      Promise.reject(new Error(`${SAFE_UNAUTHORIZED_PATTERN} ${SAFE_RATE_LIMIT_PATTERNS[0]!}`))
    );

    await expect(withRateRetry(fn)).rejects.toThrow('process.exit called');

    expect(fn).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining(logging.SAFE_UNAUTHORIZED_ERROR)
    );
  });
});
