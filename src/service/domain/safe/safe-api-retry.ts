import chalk from 'chalk';

import * as application from '../../../constants/application';
import * as logging from '../../../constants/logging';
import { isRateLimitError, isUnauthorizedError } from '../error-utils';
import { sleep } from './safe-utils';

/**
 * Wrap a Safe API Kit call with 401 detection and 429 rate-limit retry
 *
 * - 401 Unauthorized: throws immediately with a clear error message (no retry)
 * - 429 Too Many Requests: retries up to 3 times with a 2 s delay between attempts
 * - Other errors: rethrows immediately
 *
 * @param fn - The async Safe API Kit call to execute
 * @returns The result of the API call
 */
export async function withRateRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= application.SAFE_RATE_LIMIT_MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (isUnauthorizedError(error)) {
        console.error(chalk.red(logging.SAFE_UNAUTHORIZED_ERROR));
        process.exit(1);
      }

      if (!isRateLimitError(error)) {
        throw error;
      }

      if (attempt === application.SAFE_RATE_LIMIT_MAX_RETRIES) {
        console.error(chalk.red(logging.SAFE_RATE_LIMIT_EXHAUSTED_ERROR));
        process.exit(1);
      }

      console.error(
        chalk.yellow(
          logging.SAFE_RATE_LIMITED_RETRY_WARNING(attempt, application.SAFE_RATE_LIMIT_MAX_RETRIES)
        )
      );
      await sleep(application.SAFE_RATE_LIMIT_DELAY_MS);
    }
  }

  throw new Error(logging.SAFE_RATE_LIMIT_EXHAUSTED_ERROR);
}
