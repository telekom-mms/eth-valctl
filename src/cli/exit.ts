/**
 * CLI command for full validator exit
 *
 * Creates execution layer withdrawal requests (EIP-7002) with amount 0
 * to trigger complete validator exit and balance withdrawal.
 */
import { Command } from 'commander';

import type { GlobalCliOptions, ValidatorOption } from '../model/commander';
import { exit } from '../service/domain/exit';
import { parseAndValidateValidatorPubKeys } from './validation/cli';

const exitCommand = new Command();

const validatorOptionName = 'validator';

exitCommand
  .name('exit')
  .description('Exit one or many validators')
  .requiredOption(
    `-v, --${validatorOptionName} <validatorPubkey...>`,
    'Space separated list of validator pubkeys which will be exited',
    parseAndValidateValidatorPubKeys
  )
  .action(async (options: ValidatorOption, command) => {
    const globalOptions: GlobalCliOptions = command.parent.opts();
    await exit(globalOptions, options.validator);
  });

export { exitCommand };
