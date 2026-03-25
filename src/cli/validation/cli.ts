import { PublicKey } from '@chainsafe/blst';
import chalk from 'chalk';
import { getAddress, JsonRpcProvider } from 'ethers';
import { existsSync, readFileSync, statSync } from 'fs';

import * as application from '../../constants/application';
import * as logging from '../../constants/logging';
import { SAFE_OPTION_REQUIRED_ERROR } from '../../constants/logging';
import type { GlobalCliOptions } from '../../model/commander';
import { networkConfig } from '../../network-config';

/**
 * Check if json rpc url is correctly formatted
 *
 * @param nodeUrl - The json rpc url
 * @returns The json rpc url
 */
export function parseAndValidateNodeUrl(nodeUrl: string): string {
  if (!application.VALID_URL_PREFIXES.some((prefix) => nodeUrl.startsWith(prefix))) {
    exitWithValidationError(logging.INVALID_URL_FORMAT_ERROR);
  }
  return nodeUrl;
}

/**
 * Check if amount to withdraw is a number and parse to 8-byte hexstring
 *
 * @param amount - The amount in ETH to withdraw from validator
 * @returns The amount as 8-byte hexstring
 */
export function parseAndValidateWithdrawAmount(amount: string): number {
  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount)) {
    exitWithValidationError(logging.INVALID_AMOUNT_ERROR);
  }
  if (parsedAmount < 0.000001) {
    exitWithValidationError(logging.AMOUNT_TOO_LOW_ERROR);
  }
  return parsedAmount;
}

/**
 * Check if provided validator pubkey is valid
 *
 * @param validatorPubKey - The provided validator pubkey
 * @returns The validator pubkey
 */
export function parseAndValidateValidatorPubKey(validatorPubKey: string): string {
  try {
    PublicKey.fromHex(validatorPubKey).keyValidate();
    return addPubKeyPrefix(validatorPubKey);
  } catch {
    exitWithValidationError(logging.INVALID_VALIDATOR_PUBKEY_ERROR);
  }
}

/**
 * Parse and validate validator pubkeys from inline arguments or a file
 *
 * Auto-detects whether the argument is a pubkey or a file path:
 * 1. If it matches the pubkey pattern, validate as BLS pubkey
 * 2. If it exists as a file, read pubkeys from it (one per line)
 * 3. Otherwise, exit with an error
 *
 * @param value - A validator pubkey or path to a file containing pubkeys
 * @param previous - Previously accumulated pubkeys from prior arguments
 * @returns Accumulated array of validated pubkeys
 */
export function parseAndValidateValidatorPubKeys(value: string, previous: string[] = []): string[] {
  if (application.PUBKEY_PATTERN.test(value)) {
    try {
      PublicKey.fromHex(value).keyValidate();
      return [...previous, addPubKeyPrefix(value)];
    } catch {
      exitWithValidationError(logging.INVALID_VALIDATORS_PUBKEY_ERROR);
    }
  }

  if (existsSync(value) && statSync(value).isFile()) {
    return [...previous, ...readPubkeysFromFile(value)];
  }

  exitWithValidationError(logging.INVALID_PUBKEY_OR_FILE_ERROR(value));
}

/**
 * Check if provided json rpc url connection can be established
 *
 * @param jsonRpcUrl - The json rpc url
 * @param network - The user provided network
 */
export async function validateNetwork(jsonRpcUrl: string, network: string): Promise<void> {
  try {
    const config = networkConfig[network];
    if (!config) {
      exitWithValidationError(logging.INVALID_NETWORK_ERROR(network));
    }
    const jsonRpcProvider = new JsonRpcProvider(jsonRpcUrl);
    const connectedNetwork = await jsonRpcProvider.getNetwork();
    if (connectedNetwork.chainId != config.chainId) {
      exitWithValidationError(
        logging.WRONG_CONNECTED_NETWORK_ERROR(
          network,
          connectedNetwork.name,
          connectedNetwork.chainId
        )
      );
    }
  } catch (error) {
    if (
      error instanceof Error &&
      'message' in error &&
      error.message.includes(application.ECONNREFUSED_ERROR_CODE)
    ) {
      console.error(chalk.red(logging.GENERAL_JSON_RPC_ERROR(jsonRpcUrl)), error.message);
      process.exit(1);
    }
  }
}

/**
 * Check if provided max. number of requests per block is a actual number and does not exceed
 * a the number of execution layer requests which would fit into a single block.
 *
 * @param maxNumberOfRequests - The maximal number of requests allowed in a single block
 * @returns The validated maximal number of requests allowed in a single block
 */
export function parseAndValidateMaxNumberOfRequestsPerBlock(maxNumberOfRequests: string): number {
  const parsedNumber = parseInt(maxNumberOfRequests);
  if (isNaN(parsedNumber)) {
    exitWithValidationError(logging.INVALID_REQUESTS_PER_BLOCK_ERROR);
  }
  if (parsedNumber > application.MAX_NUMBER_OF_REQUESTS_PER_BLOCK) {
    exitWithValidationError(logging.TOO_MANY_REQUESTS_PER_BLOCK_ERROR);
  }
  return parsedNumber;
}

/**
 * Parse and validate an Ethereum address for the --safe option
 *
 * Validates format (0x + 40 hex chars) and normalizes to checksummed form.
 *
 * @param address - The raw address string from CLI
 * @returns Checksummed Ethereum address
 */
export function parseAndValidateSafeAddress(address: string): string {
  if (!application.ETH_ADDRESS_PATTERN.test(address)) {
    exitWithValidationError(logging.INVALID_SAFE_ADDRESS_ERROR(address));
  }
  try {
    return getAddress(address);
  } catch {
    exitWithValidationError(logging.INVALID_SAFE_ADDRESS_ERROR(address));
  }
}

/**
 * Validate that the selected network supports Safe Transaction Service
 *
 * @param network - The network name
 * @param safeAddress - The Safe address (only checked when present)
 */
export function validateSafeNetworkSupport(network: string, safeAddress?: string): void {
  if (!safeAddress) return;

  const config = networkConfig[network];
  if (!config?.safeTransactionServiceUrl) {
    exitWithValidationError(logging.SAFE_NOT_SUPPORTED_ON_NETWORK_ERROR(network));
  }
}

/**
 * Validate that the --safe CLI option is present and return the address
 *
 * @param globalOptions - Global CLI options including safe address
 * @returns Validated Safe address
 */
export function validateSafeAddress(globalOptions: GlobalCliOptions): string {
  const safeAddress = globalOptions.safe;
  if (!safeAddress) {
    console.error(chalk.red(SAFE_OPTION_REQUIRED_ERROR));
    process.exit(1);
  }
  return safeAddress;
}

/**
 * Read and validate validator pubkeys from a file
 *
 * @param filePath - Path to file containing one pubkey per line
 * @returns Array of validated pubkeys with 0x prefix
 */
function readPubkeysFromFile(filePath: string): string[] {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const pubkeys: string[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const trimmed = lines[lineIndex]!.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    try {
      PublicKey.fromHex(trimmed).keyValidate();
      pubkeys.push(addPubKeyPrefix(trimmed));
    } catch {
      exitWithValidationError(logging.INVALID_PUBKEY_IN_FILE_ERROR(lineIndex + 1, filePath));
    }
  }

  if (pubkeys.length === 0) {
    exitWithValidationError(logging.EMPTY_PUBKEY_FILE_ERROR(filePath));
  }

  console.error(chalk.blue(logging.READ_PUBKEYS_FROM_FILE_INFO(pubkeys.length, filePath)));
  return pubkeys;
}

/**
 * Add 0x suffix to validator pubkey if not present
 *
 * @param validatorPubKey - The validator pubkey to check
 * @returns The validator pubkey with suffix 0x
 */
function addPubKeyPrefix(validatorPubKey: string): string {
  if (!validatorPubKey.startsWith(application.PREFIX_0x)) {
    validatorPubKey = application.PREFIX_0x.concat(validatorPubKey);
  }
  return validatorPubKey;
}

/**
 * Exit with a validation error message
 *
 * @param message - Error message
 */
function exitWithValidationError(message: string): never {
  console.error(chalk.red(message));
  process.exit(1);
}
