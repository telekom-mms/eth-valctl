import * as application from '../../../constants/application';
import type { GlobalCliOptions } from '../../../model/commander';
import type { RequestFeeCapPolicy } from '../../../model/ethereum';

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
    maxRequestFee: globalOptions.maxRequestFee ?? application.DEFAULT_MAX_REQUEST_FEE,
    maxWaitBlocks:
      globalOptions.maxRequestFeeWaitBlocks ?? application.DEFAULT_MAX_REQUEST_FEE_WAIT_BLOCKS,
    skipConfirmation: globalOptions.yes ?? false
  };
}
