import chalk from 'chalk';

import * as logging from '../constants/logging';
import { RequestFeeCapExceededError, RequestFeeOperationCancelledError } from '../model/ethereum';

/**
 * Handle top-level CLI errors and exit with the appropriate process code.
 *
 * @param error - Error thrown by Commander action handling
 */
export function handleCliError(error: unknown): never {
  if (error instanceof RequestFeeOperationCancelledError) {
    console.error(chalk.yellow(error.message));
    process.exit(0);
  }

  if (error instanceof RequestFeeCapExceededError) {
    console.error(chalk.yellow(error.message));
    process.exit(1);
  }

  console.error(chalk.red(logging.FATAL_ERROR_PREFIX), error);
  process.exit(1);
}
