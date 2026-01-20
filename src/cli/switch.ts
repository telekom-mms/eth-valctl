import { Command } from 'commander';

import type { GlobalCliOptions, ValidatorOption } from '../model/commander';
import { switchWithdrawalCredentialType } from '../service/domain/switch';
import { parseAndValidateValidatorPubKeys } from '../service/validation/cli';

const switchWithdrawalCredentialTypeCommand = new Command();

const validatorOptionName = 'validator';

switchWithdrawalCredentialTypeCommand
  .name('switch')
  .description('Switch withdrawal credential type from 0x01 to 0x02 for one or many validators')
  .requiredOption(
    `-v, --${validatorOptionName} <validatorPubkey...>`,
    'Space separated list of validator pubkeys for which the withdrawal credential type will be changed to 0x02',
    parseAndValidateValidatorPubKeys
  )
  .action(async (options: ValidatorOption, command) => {
    const globalOptions: GlobalCliOptions = command.parent.opts();
    await switchWithdrawalCredentialType(globalOptions, options.validator);
  });

export { switchWithdrawalCredentialTypeCommand };
