import type { GlobalCliOptions } from '../../model/commander';
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
  await withdraw(globalOptions, validatorPubkeys, 0);
}
