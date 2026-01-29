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
import {
  parseAndValidateMaxNumberOfRequestsPerBlock,
  parseAndValidateNodeUrl,
  validateNetwork
} from '../service/validation/cli';
import { consolidateCommand } from './consolidate';
import { exitCommand } from './exit';
import { switchWithdrawalCredentialTypeCommand } from './switch';
import { withdrawCommand } from './withdraw';

const program = new Command();

const networkOptionName = 'network';
const jsonRpcOptionName = 'json-rpc-url';
const beaconApiOptionName = 'beacon-api-url';
const maxRequestsPerBlockOptionName = 'max-requests-per-block';
const ledgerOptionName = 'ledger';

program
  .name('eth-valctl')
  .description(`CLI tool for managing Ethereum validators.\n${chalk.yellow(DISCLAIMER_INFO)}`)
  .version(packageJson.version)
  .addOption(
    new Option(
      `-n, --${networkOptionName} <network>`,
      'Ethereum network which will be used for request processing'
    )
      .choices(['mainnet', 'hoodi', 'sepolia', 'kurtosis_devnet'])
      .makeOptionMandatory(true)
      .default('mainnet')
  )
  .requiredOption(
    `-r, --${jsonRpcOptionName} <jsonRpcUrl>`,
    'Json rpc url which is used to connect to the defined network',
    parseAndValidateNodeUrl,
    'http://localhost:8545'
  )
  .requiredOption(
    `-b, --${beaconApiOptionName} <beaconApiUrl>`,
    'Beacon api url which is used for pre transaction checks',
    parseAndValidateNodeUrl,
    'http://localhost:5052'
  )
  .requiredOption(
    `-m, --${maxRequestsPerBlockOptionName} <number>`,
    'Max. number of sent execution layer requests per block',
    parseAndValidateMaxNumberOfRequestsPerBlock,
    10
  )
  .option(
    `-l, --${ledgerOptionName}`,
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

program.parseAsync(process.argv).then(() => {});
