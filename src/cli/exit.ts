import { Command } from 'commander';

import type { GlobalCliOptions, ValidatorOption } from '../model/commander';
import { exit } from '../service/domain/exit';
import { parseAndValidateValidatorPubKeys } from '../service/validation/cli';

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
