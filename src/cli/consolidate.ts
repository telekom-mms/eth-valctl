/**
 * CLI command for validator balance consolidation
 *
 * Creates execution layer consolidation requests (EIP-7251) to merge balances
 * from source validators into a single target validator.
 */
import { Command } from 'commander';

import type { ConsolidationOptions, GlobalCliOptions } from '../model/commander';
import { consolidate } from '../service/domain/consolidate';
import {
  parseAndValidateValidatorPubKey,
  parseAndValidateValidatorPubKeys
} from './validation/cli';

const consolidateCommand = new Command();

consolidateCommand
  .name('consolidate')
  .description('Consolidate one or many source validators into one target validator')
  .requiredOption(
    `-s, --source <validatorPubkey...>`,
    'Validator pubkeys (space separated) or path to a file containing one pubkey per line',
    parseAndValidateValidatorPubKeys
  )
  .requiredOption(
    `-t, --target <validatorPubkey>`,
    'Target validator pubkey',
    parseAndValidateValidatorPubKey
  )
  .option(
    '--skip-target-ownership-check',
    'Skip ownership validation for the target validator',
    false
  )
  .action(async (options: ConsolidationOptions, command) => {
    const globalOptions: GlobalCliOptions = command.parent.opts();
    await consolidate(
      globalOptions,
      options.source,
      options.target,
      options.skipTargetOwnershipCheck
    );
  });

export { consolidateCommand };
