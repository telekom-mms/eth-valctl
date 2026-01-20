import chalk from 'chalk';
import { exit } from 'process';
import { fetch, Response } from 'undici';
import { format } from 'util';

import {
  VALIDATOR_STATE_BEACON_API_ENDPOINT,
  WITHDRAWAL_CREDENTIALS_0x00,
  WITHDRAWAL_CREDENTIALS_0x02
} from '../../constants/application';
import * as logging from '../../constants/logging';
import type { ValidatorResponse } from '../../model/ethereum';

/**
 * Check if the provided validator withdrawal credentials are of type compounding
 *
 * @param beaconApiUrl - The beacon api url
 * @param validatorPubkeys - The validator public keys to check
 */
export async function checkWithdrawalCredentialType(
  beaconApiUrl: string,
  validatorPubkeys: string[]
): Promise<void> {
  for (const validatorPubkey of validatorPubkeys) {
    try {
      const url = `${beaconApiUrl}${VALIDATOR_STATE_BEACON_API_ENDPOINT}${validatorPubkey}`;
      const response = await fetch(url);

      if (!response.ok) {
        await handleErrorResponse(response);
      }

      const data = (await response.json()) as ValidatorResponse;

      const withdrawalCredentialsType = data.data.validator.withdrawal_credentials.substring(0, 4);
      if (withdrawalCredentialsType !== WITHDRAWAL_CREDENTIALS_0x02) {
        await handleWithdrawalCredentialsType(withdrawalCredentialsType);
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
}

/**
 * Handle error response
 *
 * @param response - The response object
 */
async function handleErrorResponse(response: Response) {
  console.error(chalk.red(logging.BEACON_API_ERROR, response.statusText));
  console.error(chalk.red(logging.RESPONSE_ERROR, response.status, '-', await response.text()));
  exit(1);
}

/**
 * Handle withdrawal credentials type
 *
 * @param withdrawalCredentialsType - The withdrawal credentials type
 */
async function handleWithdrawalCredentialsType(withdrawalCredentialsType: string) {
  console.error(
    chalk.red(format(logging.GENERAL_WRONG_WITHDRAWAL_CREDENTIALS_ERROR, withdrawalCredentialsType))
  );
  if (withdrawalCredentialsType === WITHDRAWAL_CREDENTIALS_0x00) {
    console.error(chalk.red(logging.WRONG_WITHDRAWAL_CREDENTIALS_0x00_ERROR));
  } else {
    console.error(chalk.red(logging.WRONG_WITHDRAWAL_CREDENTIALS_0X01_ERROR));
  }
  exit(1);
}
