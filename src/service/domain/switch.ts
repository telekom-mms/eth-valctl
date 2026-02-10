import type { GlobalCliOptions } from '../../model/commander';
import { consolidate } from './consolidate';

/**
 * Switch withdrawal credential type from 0x01 to 0x02 for one or many validators
 *
 * @param globalOptions - The global cli options
 * @param sourceValidatorPubkeys - The validator pubkey(s) for which the withdrawal credential type will be changed to 0x02
 */
export async function switchWithdrawalCredentialType(
  globalOptions: GlobalCliOptions,
  sourceValidatorPubkeys: string[]
): Promise<void> {
  await consolidate(globalOptions, sourceValidatorPubkeys);
}
