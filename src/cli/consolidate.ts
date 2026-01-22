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
} from '../service/validation/cli';

const consolidateCommand = new Command();

const sourceValidatorOptionName = 'source';
const targetValidatorOptionName = 'target';

consolidateCommand
  .name('consolidate')
  .description('Consolidate one or many source validators into one target validator')
  .requiredOption(
    `-s, --${sourceValidatorOptionName} <validatorPubkey...>`,
    'Space separated list of validator pubkeys which will be consolidated into the target validator',
    parseAndValidateValidatorPubKeys
  )
  .requiredOption(
    `-t, --${targetValidatorOptionName} <validatorPubkey>`,
    'Target validator pubkey',
    parseAndValidateValidatorPubKey
  )
  .action(async (options: ConsolidationOptions, command) => {
    const globalOptions: GlobalCliOptions = command.parent.opts();
    await consolidate(globalOptions, options.source, options.target);
  });

export { consolidateCommand };
