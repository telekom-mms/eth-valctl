import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import prompts from 'prompts';

import * as application from '../../../constants/application';
import * as logging from '../../../constants/logging';
import type {
  RequestFeeCapCheckContext,
  RequestFeeCapPolicy,
  RequestFeeReader
} from '../../../model/ethereum';
import {
  RequestFeeCapExceededError,
  RequestFeeOperationCancelledError
} from '../../../model/ethereum';
import { RequestFeeCapService } from './request-fee-cap-service';

const CONTEXT: RequestFeeCapCheckContext = {
  operation: 'batch',
  requestCount: 1
};

/**
 * Build a request-fee cap policy for tests.
 *
 * @param overrides - Policy values to override
 * @returns Request fee cap policy
 */
function buildPolicy(overrides: Partial<RequestFeeCapPolicy> = {}): RequestFeeCapPolicy {
  return {
    maxRequestFee: 10n,
    maxWaitBlocks: 0n,
    skipConfirmation: false,
    ...overrides
  };
}

/**
 * Build a request fee reader with deterministic fee and block sequences.
 *
 * @param fees - Fees returned by consecutive reads
 * @param blocks - Block numbers returned by consecutive reads
 * @returns Request fee reader test double
 */
function buildReader(fees: bigint[], blocks: number[] = [100]): RequestFeeReader {
  return {
    fetchContractFee: mock(() => Promise.resolve(fees.shift() ?? fees.at(-1) ?? 0n)),
    fetchBlockNumber: mock(() => Promise.resolve(blocks.shift() ?? blocks.at(-1) ?? 100))
  };
}

/**
 * Replace setTimeout with an immediate callback runner for wait-loop tests.
 *
 * @returns Spy that restores the original setTimeout implementation
 */
function mockImmediateTimeout(): ReturnType<typeof spyOn> {
  return spyOn(globalThis, 'setTimeout').mockImplementation(((
    callback: Parameters<typeof setTimeout>[0]
  ) => {
    if (typeof callback === 'function') {
      callback();
    }

    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout);
}

describe('RequestFeeCapService', () => {
  let stderrSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    stderrSpy = spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    prompts.inject([]);
    mock.restore();
  });

  it('accepts a fee below the configured cap', async () => {
    const reader = buildReader([9n]);
    const service = new RequestFeeCapService(reader);

    const fee = await service.resolveRequestFee(buildPolicy(), CONTEXT);

    expect(fee).toBe(9n);
    expect(reader.fetchBlockNumber).not.toHaveBeenCalled();
  });

  it('accepts a fee equal to the configured cap', async () => {
    const reader = buildReader([10n]);
    const service = new RequestFeeCapService(reader);

    const fee = await service.resolveRequestFee(buildPolicy(), CONTEXT);

    expect(fee).toBe(10n);
  });

  it('throws a cancellation error when the user aborts an above-cap fee', async () => {
    prompts.inject([application.FEE_ACTION_ABORT]);
    const service = new RequestFeeCapService(buildReader([11n]));

    await expect(service.resolveRequestFee(buildPolicy(), CONTEXT)).rejects.toThrow(
      RequestFeeOperationCancelledError
    );
  });

  it('throws a cancellation error when the prompt returns an unsupported action', async () => {
    prompts.inject(['unexpected']);
    const service = new RequestFeeCapService(buildReader([11n]));

    await expect(service.resolveRequestFee(buildPolicy(), CONTEXT)).rejects.toThrow(
      logging.REQUEST_FEE_CAP_ABORTED_INFO
    );
  });

  it('continues at the approved above-cap fee until a later fee is higher', async () => {
    prompts.inject([application.FEE_ACTION_CONTINUE, application.FEE_ACTION_ABORT]);
    const service = new RequestFeeCapService(buildReader([11n, 11n, 12n]));
    const policy = buildPolicy();

    await expect(service.resolveRequestFee(policy, CONTEXT)).resolves.toBe(11n);
    await expect(service.resolveRequestFee(policy, CONTEXT)).resolves.toBe(11n);
    await expect(service.resolveRequestFee(policy, CONTEXT)).rejects.toThrow(
      RequestFeeOperationCancelledError
    );
  });

  it('clears a prior above-cap approval after a fee within cap is observed', async () => {
    prompts.inject([application.FEE_ACTION_CONTINUE, application.FEE_ACTION_ABORT]);
    const service = new RequestFeeCapService(buildReader([11n, 9n, 11n]));
    const policy = buildPolicy();

    await expect(service.resolveRequestFee(policy, CONTEXT)).resolves.toBe(11n);
    await expect(service.resolveRequestFee(policy, CONTEXT)).resolves.toBe(9n);
    await expect(service.resolveRequestFee(policy, CONTEXT)).rejects.toThrow(
      RequestFeeOperationCancelledError
    );
  });

  it('throws without polling block numbers when wait mode has no block budget', async () => {
    const reader = buildReader([11n], [100]);
    const service = new RequestFeeCapService(reader);

    await expect(
      service.resolveRequestFee(buildPolicy({ maxWaitBlocks: 0n, skipConfirmation: true }), CONTEXT)
    ).rejects.toThrow(logging.REQUEST_FEE_CAP_WAIT_EXCEEDED_ERROR(11n, 10n, 0n));
    expect(reader.fetchBlockNumber).not.toHaveBeenCalled();
  });

  it('waits by observed block advancement instead of poll count', async () => {
    const timeoutSpy = mockImmediateTimeout();
    const reader = buildReader([11n, 11n, 10n], [100, 100, 101, 102]);
    const service = new RequestFeeCapService(reader);

    const fee = await service.resolveRequestFee(
      buildPolicy({ maxWaitBlocks: 2n, skipConfirmation: true }),
      CONTEXT
    );

    expect(fee).toBe(10n);
    expect(reader.fetchBlockNumber).toHaveBeenCalledTimes(4);
    expect(reader.fetchContractFee).toHaveBeenCalledTimes(3);

    timeoutSpy.mockRestore();
  });

  it('throws when the fee stays above cap after the allowed block advancement', async () => {
    const timeoutSpy = mockImmediateTimeout();
    const service = new RequestFeeCapService(buildReader([11n, 11n], [100, 101]));

    await expect(
      service.resolveRequestFee(buildPolicy({ maxWaitBlocks: 1n, skipConfirmation: true }), CONTEXT)
    ).rejects.toThrow(RequestFeeCapExceededError);

    timeoutSpy.mockRestore();
  });

  it('throws when observed block advancement overshoots the wait budget', async () => {
    const timeoutSpy = mockImmediateTimeout();
    const reader = buildReader([11n, 10n], [100, 103]);
    const service = new RequestFeeCapService(reader);

    await expect(
      service.resolveRequestFee(buildPolicy({ maxWaitBlocks: 1n, skipConfirmation: true }), CONTEXT)
    ).rejects.toThrow(RequestFeeCapExceededError);
    expect(reader.fetchContractFee).toHaveBeenCalledTimes(1);

    timeoutSpy.mockRestore();
  });
});
