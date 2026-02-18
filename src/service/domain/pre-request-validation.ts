import chalk from 'chalk';
import { exit } from 'process';
import { fetch, Response } from 'undici';

import {
  VALIDATOR_STATE_BEACON_API_ENDPOINT,
  WITHDRAWAL_CREDENTIALS_0x00,
  WITHDRAWAL_CREDENTIALS_0x01,
  WITHDRAWAL_CREDENTIALS_0x02
} from '../../constants/application';
import * as logging from '../../constants/logging';
import type { ValidatorResponse } from '../../model/ethereum';

/**
 * Fetch the withdrawal credentials type for a validator from the Beacon API
 *
 * @param beaconApiUrl - The beacon api url
 * @param validatorPubkey - The validator public key
 * @returns The withdrawal credentials type prefix (e.g. '0x00', '0x01', '0x02')
 */
async function fetchWithdrawalCredentialsType(
  beaconApiUrl: string,
  validatorPubkey: string
): Promise<string> {
  const url = `${beaconApiUrl}${VALIDATOR_STATE_BEACON_API_ENDPOINT}${validatorPubkey}`;
  const response = await fetch(url);

  if (!response.ok) {
    await handleErrorResponse(response);
  }

  const data = (await response.json()) as ValidatorResponse;
  return data.data.validator.withdrawal_credentials.substring(0, 4);
}

/**
 * Iterate over validator pubkeys, fetch credentials, and apply a check callback
 *
 * @param beaconApiUrl - The beacon api url
 * @param validatorPubkeys - The validator public keys to check
 * @param check - Callback invoked with each validator's credentials type and pubkey
 */
async function validateWithdrawalCredentials(
  beaconApiUrl: string,
  validatorPubkeys: string[],
  check: (credentialsType: string, validatorPubkey: string) => void
): Promise<void> {
  for (const validatorPubkey of validatorPubkeys) {
    try {
      const credentialsType = await fetchWithdrawalCredentialsType(beaconApiUrl, validatorPubkey);
      check(credentialsType, validatorPubkey);
    } catch (error) {
      if (error instanceof TypeError) {
        console.error(chalk.red(logging.BEACON_API_ERROR, error.cause));
      } else {
        console.error(chalk.red(logging.UNEXPECTED_BEACON_API_ERROR, error));
      }
      exit(1);
    }
  }
}

/**
 * Check if the provided validators have compounding (0x02) withdrawal credentials
 *
 * @param beaconApiUrl - The beacon api url
 * @param validatorPubkeys - The validator public keys to check
 */
export async function checkCompoundingCredentials(
  beaconApiUrl: string,
  validatorPubkeys: string[]
): Promise<void> {
  await validateWithdrawalCredentials(beaconApiUrl, validatorPubkeys, (credentialsType) => {
    if (credentialsType !== WITHDRAWAL_CREDENTIALS_0x02) {
      handleWrongCredentialsType(credentialsType);
    }
  });
}

/**
 * Check if the provided validators have at least execution credentials (0x01 or 0x02)
 *
 * @param beaconApiUrl - The beacon api url
 * @param validatorPubkeys - The validator public keys to check
 * @param formatError - Formats the error message for a validator with invalid credentials
 */
export async function checkHasExecutionCredentials(
  beaconApiUrl: string,
  validatorPubkeys: string[],
  formatError: (pubkey: string) => string
): Promise<void> {
  const invalidPubkeys: string[] = [];

  await validateWithdrawalCredentials(
    beaconApiUrl,
    validatorPubkeys,
    (credentialsType, validatorPubkey) => {
      if (credentialsType === WITHDRAWAL_CREDENTIALS_0x00) {
        invalidPubkeys.push(validatorPubkey);
      }
    }
  );

  if (invalidPubkeys.length > 0) {
    for (const pubkey of invalidPubkeys) {
      console.error(chalk.red(formatError(pubkey)));
    }
    exit(1);
  }
}

/**
 * Filter validators that can be switched from 0x01 to 0x02
 *
 * - 0x00: hard error (cannot switch directly to 0x02)
 * - 0x01: included in returned list (valid for switch)
 * - 0x02: excluded with yellow warning (already compounding)
 *
 * @param beaconApiUrl - The beacon api url
 * @param validatorPubkeys - The validator public keys to check
 * @returns Filtered list of pubkeys that need switching
 */
export async function filterSwitchableValidators(
  beaconApiUrl: string,
  validatorPubkeys: string[]
): Promise<string[]> {
  const switchable: string[] = [];
  const unswitchable: string[] = [];

  for (const validatorPubkey of validatorPubkeys) {
    try {
      const credentialsType = await fetchWithdrawalCredentialsType(beaconApiUrl, validatorPubkey);

      if (credentialsType === WITHDRAWAL_CREDENTIALS_0x00) {
        unswitchable.push(validatorPubkey);
        continue;
      }

      if (credentialsType === WITHDRAWAL_CREDENTIALS_0x02) {
        console.log(
          chalk.yellow(logging.SWITCH_SOURCE_VALIDATOR_ALREADY_0x02_WARNING(validatorPubkey))
        );
        continue;
      }

      if (credentialsType === WITHDRAWAL_CREDENTIALS_0x01) {
        switchable.push(validatorPubkey);
      }
    } catch (error) {
      if (error instanceof TypeError) {
        console.error(chalk.red(logging.BEACON_API_ERROR, error.cause));
      } else {
        console.error(chalk.red(logging.UNEXPECTED_BEACON_API_ERROR, error));
      }
      exit(1);
    }
  }

  if (unswitchable.length > 0) {
    for (const pubkey of unswitchable) {
      console.error(chalk.red(logging.SWITCH_SOURCE_VALIDATOR_0x00_CREDENTIALS_ERROR(pubkey)));
    }
    exit(1);
  }

  return switchable;
}

/**
 * Handle error response from Beacon API
 *
 * @param response - The response object
 */
async function handleErrorResponse(response: Response) {
  console.error(chalk.red(logging.BEACON_API_ERROR, response.statusText));
  console.error(chalk.red(logging.RESPONSE_ERROR, response.status, '-', await response.text()));
  exit(1);
}

/**
 * Handle wrong withdrawal credentials type for compounding check
 *
 * @param withdrawalCredentialsType - The withdrawal credentials type
 */
function handleWrongCredentialsType(withdrawalCredentialsType: string): never {
  console.error(
    chalk.red(logging.GENERAL_WRONG_WITHDRAWAL_CREDENTIALS_ERROR(withdrawalCredentialsType))
  );
  if (withdrawalCredentialsType === WITHDRAWAL_CREDENTIALS_0x00) {
    console.error(chalk.red(logging.WRONG_WITHDRAWAL_CREDENTIALS_0x00_ERROR));
  } else {
    console.error(chalk.red(logging.WRONG_WITHDRAWAL_CREDENTIALS_0X01_ERROR));
  }
  exit(1);
}
