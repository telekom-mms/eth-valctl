#! /usr/bin/env node
/**
 * CLI entry point for eth-valctl - Ethereum validator control tool
 *
 * Provides commands for managing execution layer requests:
 * - consolidate: Consolidate validator balances (EIP-7251)
 * - switch: Switch withdrawal credentials from 0x01 to 0x02
 * - withdraw: Partial withdrawal from validators
 * - exit: Full validator exit
 */
import chalk from 'chalk';
import { Command, Option } from 'commander';

import packageJson from '../../package.json';
import { DISCLAIMER_INFO } from '../constants/logging';
import type { GlobalCliOptions } from '../model/commander';
import { consolidateCommand } from './consolidate';
import { exitCommand } from './exit';
import { switchWithdrawalCredentialTypeCommand } from './switch';
import {
  parseAndValidateMaxNumberOfRequestsPerBlock,
  parseAndValidateNodeUrl,
  validateNetwork
} from './validation/cli';
import { withdrawCommand } from './withdraw';

process.on('unhandledRejection', (reason) => {
  console.error(chalk.red('Unhandled promise rejection:'), reason);
});

const program = new Command();

program
  .name('eth-valctl')
  .description(`CLI tool for managing Ethereum validators.\n${chalk.yellow(DISCLAIMER_INFO)}`)
  .version(packageJson.version)
  .addOption(
    new Option(
      `-n, --network <network>`,
      'Ethereum network which will be used for request processing'
    )
      .choices(['mainnet', 'hoodi', 'sepolia', 'kurtosis_devnet'])
      .makeOptionMandatory(true)
      .default('mainnet')
  )
  .requiredOption(
    `-r, --json-rpc-url <jsonRpcUrl>`,
    'Json rpc url which is used to connect to the defined network',
    parseAndValidateNodeUrl,
    'http://localhost:8545'
  )
  .requiredOption(
    `-b, --beacon-api-url <beaconApiUrl>`,
    'Beacon api url which is used for pre transaction checks',
    parseAndValidateNodeUrl,
    'http://localhost:5052'
  )
  .requiredOption(
    `-m, --max-requests-per-block <number>`,
    'Max. number of sent execution layer requests per block',
    parseAndValidateMaxNumberOfRequestsPerBlock,
    10
  )
  .option(
    `-l, --ledger`,
    'Use Ledger hardware wallet for transaction signing (requires device connection)',
    false
  )
  .hook('preAction', (thisCommand) => {
    console.log(chalk.yellow(DISCLAIMER_INFO));
    const globalOptions: GlobalCliOptions = thisCommand.opts();
    validateNetwork(globalOptions.jsonRpcUrl, globalOptions.network);
  })
  .addCommand(consolidateCommand)
  .addCommand(switchWithdrawalCredentialTypeCommand)
  .addCommand(withdrawCommand)
  .addCommand(exitCommand);

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(chalk.red('Fatal error:'), error);
  process.exit(1);
});
