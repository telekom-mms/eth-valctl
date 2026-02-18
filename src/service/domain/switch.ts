import { PREFIX_0x } from '../../constants/application';
import type { GlobalCliOptions } from '../../model/commander';
import { executeRequestPipeline } from './execution-layer-request-pipeline';
import { filterSwitchableValidators } from './pre-request-validation';

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
  const switchableValidators = await filterSwitchableValidators(
    globalOptions.beaconApiUrl,
    sourceValidatorPubkeys
  );

  if (switchableValidators.length === 0) {
    return;
  }

  await executeRequestPipeline({
    globalOptions,
    validatorPubkeys: switchableValidators,
    encodeRequestData: createSwitchRequestData,
    resolveContractAddress: (config) => config.consolidationContractAddress
  });
}

/**
 * Create switch request data (self-consolidation: source pubkey concatenated with itself)
 *
 * @param validatorPubkey - The validator pubkey
 * @returns The switch request data
 */
function createSwitchRequestData(validatorPubkey: string): string {
  const pubkeyWithoutPrefix = validatorPubkey.substring(2);
  return PREFIX_0x.concat(pubkeyWithoutPrefix).concat(pubkeyWithoutPrefix);
}
