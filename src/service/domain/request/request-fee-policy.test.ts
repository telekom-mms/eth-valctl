import { describe, expect, it, mock } from 'bun:test';

import * as application from '../../../constants/application';
import type { GlobalCliOptions } from '../../../model/commander';
import type { RequestFeeCapCheckContext, RequestFeeCapRuntime } from '../../../model/ethereum';
import {
  RequestFeeCapExceededError,
  RequestFeeOperationCancelledError
} from '../../../model/ethereum';
import type { EthereumStateService } from './ethereum-state-service';
import {
  createRequestFeeCapPolicy,
  isRequestFeePolicyStopError,
  resolveRequestFee
} from './request-fee-policy';

/**
 * Builds a minimal GlobalCliOptions fixture for policy tests.
 *
 * @param overrides - Partial overrides merged on top of the default options
 * @returns A GlobalCliOptions instance ready for `createRequestFeeCapPolicy`
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

const CONTEXT: RequestFeeCapCheckContext = {
  operation: application.FEE_CAP_OPERATION_BATCH,
  requestCount: 1
};

describe('createRequestFeeCapPolicy', () => {
  it('returns undefined when maxRequestFee is not set', () => {
    const policy = createRequestFeeCapPolicy(buildGlobalOptions());

    expect(policy).toBeUndefined();
  });

  it('builds a policy from global options when maxRequestFee is set', () => {
    const policy = createRequestFeeCapPolicy(
      buildGlobalOptions({ maxRequestFee: 5n, maxRequestFeeWaitBlocks: 20n, yes: true })
    );

    expect(policy).toEqual({
      maxRequestFee: 5n,
      maxWaitBlocks: 20n,
      skipConfirmation: true
    });
  });

  it('defaults maxWaitBlocks and skipConfirmation when not provided', () => {
    const policy = createRequestFeeCapPolicy(buildGlobalOptions({ maxRequestFee: 5n }));

    expect(policy).toEqual({
      maxRequestFee: 5n,
      maxWaitBlocks: application.DEFAULT_MAX_REQUEST_FEE_WAIT_BLOCKS,
      skipConfirmation: false
    });
  });
});

describe('isRequestFeePolicyStopError', () => {
  it('returns true for RequestFeeCapExceededError', () => {
    expect(isRequestFeePolicyStopError(new RequestFeeCapExceededError('exceeded'))).toBe(true);
  });

  it('returns true for RequestFeeOperationCancelledError', () => {
    expect(isRequestFeePolicyStopError(new RequestFeeOperationCancelledError('cancelled'))).toBe(
      true
    );
  });

  it('returns false for an unrelated error', () => {
    expect(isRequestFeePolicyStopError(new Error('unrelated'))).toBe(false);
  });

  it('returns false for a non-error value', () => {
    expect(isRequestFeePolicyStopError('not an error')).toBe(false);
  });
});

describe('resolveRequestFee', () => {
  it('falls back to a plain contract-fee read when no runtime is configured', async () => {
    const fetchContractFee = mock(() => Promise.resolve(42n));
    const stateService = { fetchContractFee } as unknown as EthereumStateService;

    const fee = await resolveRequestFee(undefined, stateService, CONTEXT);

    expect(fee).toBe(42n);
    expect(fetchContractFee).toHaveBeenCalledTimes(1);
  });

  it('delegates to the runtime resolver when a runtime is configured', async () => {
    const resolveViaRuntime = mock(() => Promise.resolve(7n));
    const runtime: RequestFeeCapRuntime = {
      policy: { maxRequestFee: 1n, maxWaitBlocks: 50n, skipConfirmation: false },
      resolver: { resolveRequestFee: resolveViaRuntime }
    };
    const fetchContractFee = mock(() => Promise.resolve(99n));
    const stateService = { fetchContractFee } as unknown as EthereumStateService;

    const fee = await resolveRequestFee(runtime, stateService, CONTEXT);

    expect(fee).toBe(7n);
    expect(resolveViaRuntime).toHaveBeenCalledWith(runtime.policy, CONTEXT);
    expect(fetchContractFee).not.toHaveBeenCalled();
  });
});
