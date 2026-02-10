import { PublicKey } from '@chainsafe/blst';
import chalk from 'chalk';
import { JsonRpcProvider } from 'ethers';
import { exit } from 'process';

import {
  MAX_NUMBER_OF_REQUESTS_PER_BLOCK,
  PREFIX_0x,
  VALID_URL_PREFIXES
} from '../../constants/application';
import * as logging from '../../constants/logging';
import { networkConfig } from '../../network-config';

/**
 * Check if json rpc url is correctly formatted
 *
 * @param nodeUrl - The json rpc url
 * @returns The json rpc url
 */
export function parseAndValidateNodeUrl(nodeUrl: string): string {
  if (!VALID_URL_PREFIXES.some((prefix) => nodeUrl.startsWith(prefix))) {
    console.error(chalk.red(logging.INVALID_URL_FORMAT_ERROR));
    exit(1);
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
    console.error(chalk.red(logging.INVALID_AMOUNT_ERROR));
    exit(1);
  }
  if (parsedAmount < 0.000001) {
    console.error(chalk.red(logging.AMOUNT_TOO_LOW_ERROR));
    exit(1);
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
    console.error(chalk.red(logging.INVALID_VALIDATOR_PUBKEY_ERROR));
    exit(1);
  }
}

/**
 * Check if provided validator pubkeys are valid
 *
 * @param validatorPubKey - The provided validator pubkey
 * @param previous - The previous provided validator pubkeys
 * @returns The validator pubkeys
 */
export function parseAndValidateValidatorPubKeys(
  validatorPubKey: string,
  previous: string[] = []
): string[] {
  try {
    PublicKey.fromHex(validatorPubKey).keyValidate();
    return [...previous, addPubKeyPrefix(validatorPubKey)];
  } catch {
    console.error(chalk.red(logging.INVALID_VALIDATORS_PUBKEY_ERROR));
    exit(1);
  }
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
      console.error(chalk.red(`Invalid network: ${network}`));
      exit(1);
    }
    const jsonRpcProvider = new JsonRpcProvider(jsonRpcUrl);
    const connectedNetwork = await jsonRpcProvider.getNetwork();
    if (connectedNetwork.chainId != config.chainId) {
      console.error(
        chalk.red(
          logging.WRONG_CONNECTED_NETWORK_ERROR(
            network,
            connectedNetwork.name,
            connectedNetwork.chainId
          )
        )
      );
      exit(1);
    }
  } catch (error) {
    console.error(chalk.red(logging.GENERAL_JSON_RPC_ERROR), error);
    exit(1);
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
    console.error(chalk.red(logging.INVALID_REQUESTS_PER_BLOCK_ERROR));
    exit(1);
  }
  if (parsedNumber > MAX_NUMBER_OF_REQUESTS_PER_BLOCK) {
    console.error(chalk.red(logging.TOO_MANY_REQUESTS_PER_BLOCK_ERROR));
    exit(1);
  }
  return parsedNumber;
}

/**
 * Add 0x suffix to validator pubkey if not present
 *
 * @param validatorPubKey - The validator pubkey to check
 * @returns The validator pubkey with suffix 0x
 */
function addPubKeyPrefix(validatorPubKey: string): string {
  if (!validatorPubKey.startsWith(PREFIX_0x)) {
    validatorPubKey = PREFIX_0x.concat(validatorPubKey);
  }
  return validatorPubKey;
}
