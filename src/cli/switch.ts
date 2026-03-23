/**
 * CLI command for switching withdrawal credential type
 *
 * Creates execution layer consolidation requests (EIP-7251) with matching source and target
 * to convert validators from 0x01 (BLS) to 0x02 (compounding) credentials.
 */
import { Command } from 'commander';

import type { GlobalCliOptions, ValidatorOption } from '../model/commander';
import { switchWithdrawalCredentialType } from '../service/domain/switch';
import { parseAndValidateValidatorPubKeys } from './validation/cli';

const switchWithdrawalCredentialTypeCommand = new Command();

switchWithdrawalCredentialTypeCommand
  .name('switch')
  .description('Switch withdrawal credential type from 0x01 to 0x02 for one or many validators')
  .requiredOption(
    `-v, --validator <validatorPubkey...>`,
    'Validator pubkeys (space separated) or path to a file containing one pubkey per line',
    parseAndValidateValidatorPubKeys
  )
  .action(async (options: ValidatorOption, command) => {
    const globalOptions: GlobalCliOptions = command.parent.opts();
    await switchWithdrawalCredentialType(globalOptions, options.validator);
  });

export { switchWithdrawalCredentialTypeCommand };
