import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import { RequestFeeCapExceededError, RequestFeeOperationCancelledError } from '../model/ethereum';
import { handleCliError } from './error-handler';

class ProcessExitError extends Error {
  constructor(readonly code?: string | number | null) {
    super('process.exit');
  }
}

describe('handleCliError', () => {
  let stderrSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    stderrSpy = spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      throw new ProcessExitError(code);
    }) as typeof process.exit);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('prints request-fee cap exhaustion as a clean warning and exits with code 1', () => {
    expect(() => handleCliError(new RequestFeeCapExceededError('cap exceeded'))).toThrow(
      ProcessExitError
    );

    expect(stderrSpy.mock.calls[0]?.[0]).toContain('cap exceeded');
    expect(stderrSpy.mock.calls[0]?.[0]).not.toContain('Fatal error');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('keeps user cancellation as a clean exit', () => {
    expect(() => handleCliError(new RequestFeeOperationCancelledError('cancelled'))).toThrow(
      ProcessExitError
    );

    expect(stderrSpy.mock.calls[0]?.[0]).toContain('cancelled');
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
