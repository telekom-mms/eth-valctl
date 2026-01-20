import chalk from 'chalk';

import * as logging from '../../constants/logging';
import type { GlobalCliOptions } from '../../model/commander';
import { withdraw } from './withdraw';

/**
 * Exit one or many validators
 *
 * @param globalOptions - The global cli options
 * @param validatorPubkeys - The validator pubkey(s) which will be exited
 */
export async function exit(
  globalOptions: GlobalCliOptions,
  validatorPubkeys: string[]
): Promise<void> {
  logExitWarning();
  await withdraw(globalOptions, validatorPubkeys, 0);
}

/**
 * Log exit specific warning
 */
function logExitWarning(): void {
  console.log(chalk.yellow(logging.EXIT_WARNING));
}
