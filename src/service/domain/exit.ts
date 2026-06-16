import { EXIT_VALIDATOR_0x00_CREDENTIALS_ERROR } from '../../constants/logging';
import type { GlobalCliOptions } from '../../model/commander';
import { checkHasExecutionCredentials } from './pre-request-validation';
import { withdraw } from './withdraw';

/**
 * Exit one or many validators
 *
 * @param globalOptions - The global cli options
 * @param validatorPubkeys - The validator pubkey(s) which will be exited
 * @param maxFee - Maximum contract fee per request in wei (numeric string, optional)
 * @param maxFeePerGas - Maximum gas fee per gas in wei (numeric string, optional)
 */
export async function exit(
  globalOptions: GlobalCliOptions,
  validatorPubkeys: string[],
  maxFee?: string,
  maxFeePerGas?: string
): Promise<void> {
  await checkHasExecutionCredentials(
    globalOptions.beaconApiUrl,
    validatorPubkeys,
    EXIT_VALIDATOR_0x00_CREDENTIALS_ERROR
  );
  await withdraw(globalOptions, validatorPubkeys, 0, maxFee, maxFeePerGas);
}
