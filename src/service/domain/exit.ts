import * as logging from '../../constants/logging';
import type { GlobalCliOptions } from '../../model/commander';
import { checkHasExecutionCredentials } from './pre-request-validation';
import { withdraw } from './withdraw';

/**
 * Exit one or many validators
 *
 * @param globalOptions - The global cli options
 * @param validatorPubkeys - The validator pubkey(s) which will be exited
 */
export async function exit(
  globalOptions: GlobalCliOptions,
  validatorPubkeys: string[]
): Promise<void> {
  await checkHasExecutionCredentials(globalOptions.beaconApiUrl, validatorPubkeys, logging.EXIT_VALIDATOR_0x00_CREDENTIALS_ERROR);
  await withdraw(globalOptions, validatorPubkeys, 0);
}
