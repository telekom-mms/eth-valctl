import chalk from 'chalk';
import { formatEther, type JsonRpcProvider } from 'ethers';
import { exit } from 'process';
import Prompts from 'prompts';

import * as logging from '../constants/logging';
import type { AddressSelectionResult } from '../model/ledger';
import { LedgerAddressSelector } from './domain/signer/ledger-address-selector';
import { classifyLedgerError } from './domain/signer/ledger-error-handler';

/**
 * Prompt the user for a secret
 *
 * @param message - The output to be displayed for the user
 * @returns The secret entered by the user
 */
export async function promptSecret(message: string): Promise<string> {
  const answer = await Prompts({
    type: 'password',
    name: 'value',
    message: message
  });
  if (answer.value === undefined) {
    console.error(chalk.red(logging.NO_PRIVATE_KEY_ERROR));
    exit(1);
  }
  return answer.value;
}

const NAVIGATION_NEXT = 'next';
const NAVIGATION_PREV = 'prev';

/**
 * Prompt user to select a Ledger address from paginated list
 *
 * @param provider - JSON-RPC provider for balance fetching
 * @returns Selected address information
 */
export async function promptLedgerAddressSelection(
  provider: JsonRpcProvider
): Promise<AddressSelectionResult> {
  const selector = await createSelectorWithErrorHandling(provider);

  try {
    return await selectAddressInteractively(selector);
  } finally {
    await selector.dispose();
  }
}

/**
 * Create selector with error handling and exit on failure
 */
async function createSelectorWithErrorHandling(
  provider: JsonRpcProvider
): Promise<LedgerAddressSelector> {
  try {
    return await LedgerAddressSelector.create(provider);
  } catch (error) {
    const errorInfo = classifyLedgerError(error);
    console.error(chalk.red(errorInfo.message));
    return exit(1);
  }
}

/**
 * Run interactive address selection loop
 */
async function selectAddressInteractively(
  selector: LedgerAddressSelector
): Promise<AddressSelectionResult> {
  let currentPage = 0;

  while (true) {
    console.log(chalk.cyan(logging.LEDGER_ADDRESS_FETCHING_INFO(currentPage)));
    const pageState = await selector.getAddressPage(currentPage);

    const choices = buildAddressChoices(pageState.addresses, currentPage);
    const answer = await Prompts({
      type: 'select',
      name: 'selection',
      message: logging.LEDGER_ADDRESS_SELECTION_HEADER,
      choices
    });

    if (answer.selection === undefined) {
      console.error(chalk.yellow(logging.LEDGER_ADDRESS_SELECTION_CANCELLED));
      return exit(1);
    }

    if (answer.selection === NAVIGATION_NEXT) {
      currentPage++;
      continue;
    }

    if (answer.selection === NAVIGATION_PREV) {
      currentPage = Math.max(0, currentPage - 1);
      continue;
    }

    const selectedAddress = pageState.addresses.find((addr) => addr.index === answer.selection);
    if (!selectedAddress) {
      throw new Error('Selected address not found');
    }

    return {
      derivationPath: selectedAddress.derivationPath,
      address: selectedAddress.address,
      index: selectedAddress.index
    };
  }
}

/**
 * Build choice array for prompts select
 *
 * @param addresses - Addresses to display
 * @param currentPage - Current page number for navigation options
 * @returns Choice array for prompts
 */
function buildAddressChoices(
  addresses: Array<{ address: string; balance: bigint; index: number }>,
  currentPage: number
): Array<{ title: string; value: string | number }> {
  const choices: Array<{ title: string; value: string | number }> = addresses.map((addr) => ({
    title: formatAddressLine(addr.address, addr.balance, addr.index),
    value: addr.index
  }));

  choices.push({ title: '────────────────────────────────────', value: '' });

  if (currentPage > 0) {
    choices.push({ title: '← Previous Page', value: NAVIGATION_PREV });
  }

  choices.push({ title: '→ Next Page', value: NAVIGATION_NEXT });

  return choices;
}

/**
 * Format address line for display
 *
 * @param address - Full Ethereum address
 * @param balance - Balance in wei
 * @param index - Address index
 * @returns Formatted line string
 */
function formatAddressLine(address: string, balance: bigint, index: number): string {
  const shortAddress = `${address.slice(0, 6)}...${address.slice(-4)}`;
  const balanceEth = formatEther(balance);
  const formattedBalance = parseFloat(balanceEth).toFixed(6);
  return `[${index}] ${shortAddress}  ${formattedBalance.padStart(12)} ETH`;
}
