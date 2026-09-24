import * as application from '../../../constants/application';
import type { GlobalCliOptions } from '../../../model/commander';
import type {
  RequestFeeCapCheckContext,
  RequestFeeCapPolicy,
  RequestFeeCapRuntime
} from '../../../model/ethereum';
import {
  RequestFeeCapExceededError,
  RequestFeeOperationCancelledError
} from '../../../model/ethereum';
import type { EthereumStateService } from './ethereum-state-service';

/**
 * Build a request-fee cap policy from global CLI options.
 *
 * The cap is undefined only in tests or programmatic callers that omit the option.
 * Commander supplies a default in the real CLI.
 *
 * @param globalOptions - Global CLI options
 * @returns Request-fee cap policy, or undefined when no cap option was provided
 */
export function createRequestFeeCapPolicy(
  globalOptions: GlobalCliOptions
): RequestFeeCapPolicy | undefined {
  if (globalOptions.maxRequestFee === undefined) {
    return undefined;
  }

  return {
    maxRequestFee: globalOptions.maxRequestFee,
    maxWaitBlocks:
      globalOptions.maxRequestFeeWaitBlocks ?? application.DEFAULT_MAX_REQUEST_FEE_WAIT_BLOCKS,
    skipConfirmation: globalOptions.yes ?? false
  };
}

/**
 * Check whether an error represents a request-fee policy stop.
 *
 * @param error - Error caught while signing or replacing a request transaction
 * @returns True when the operation must abort instead of becoming a per-request failure
 */
export function isRequestFeePolicyStopError(
  error: unknown
): error is RequestFeeCapExceededError | RequestFeeOperationCancelledError {
  return (
    error instanceof RequestFeeCapExceededError ||
    error instanceof RequestFeeOperationCancelledError
  );
}

/**
 * Resolve the contract fee to use for a request-fee-cap check boundary.
 *
 * Falls back to a plain contract-fee read when no cap runtime is configured, otherwise enforces
 * the cap via the runtime's resolver.
 *
 * @param runtime - Optional request-fee cap runtime dependencies
 * @param stateService - Blockchain state service used when no cap runtime is configured
 * @param context - Current operation boundary
 * @returns Contract request fee in wei
 */
export async function resolveRequestFee(
  runtime: RequestFeeCapRuntime | undefined,
  stateService: EthereumStateService,
  context: RequestFeeCapCheckContext
): Promise<bigint> {
  if (!runtime) {
    return stateService.fetchContractFee();
  }

  return runtime.resolver.resolveRequestFee(runtime.policy, context);
}
