import { PREFIX_0x } from '../../constants/application';
import * as logging from '../../constants/logging';
import type { GlobalCliOptions } from '../../model/commander';
import { executeRequestPipeline } from './execution-layer-request-pipeline';
import {
  checkCompoundingCredentials,
  checkHasExecutionCredentials,
  checkWithdrawalAddressOwnership
} from './pre-request-validation';

/**
 * Consolidate one or many validators to one target validator
 *
 * @param globalOptions - The global cli options
 * @param sourceValidatorPubkeys - The validator pubkey(s) which will be consolidated
 * @param targetValidatorPubkey - The target validator for consolidation
 * @param skipTargetOwnershipCheck - Skip ownership validation for the target validator
 */
export async function consolidate(
  globalOptions: GlobalCliOptions,
  sourceValidatorPubkeys: string[],
  targetValidatorPubkey: string,
  skipTargetOwnershipCheck: boolean = false
): Promise<void> {
  await executeRequestPipeline({
    globalOptions,
    validatorPubkeys: sourceValidatorPubkeys,
    encodeRequestData: (pubkey) => createConsolidationRequestData(pubkey, targetValidatorPubkey),
    resolveContractAddress: (config) => config.consolidationContractAddress,
    validate: async (connection) => {
      await checkCompoundingCredentials(globalOptions.beaconApiUrl, [targetValidatorPubkey]);
      await checkHasExecutionCredentials(
        globalOptions.beaconApiUrl,
        sourceValidatorPubkeys,
        logging.SOURCE_VALIDATOR_0x00_CREDENTIALS_ERROR
      );
      const pubkeysToCheck = skipTargetOwnershipCheck
        ? sourceValidatorPubkeys
        : [targetValidatorPubkey, ...sourceValidatorPubkeys];
      await checkWithdrawalAddressOwnership(
        globalOptions.beaconApiUrl,
        connection.signer.address,
        pubkeysToCheck
      );
    }
  });
}

/**
 * Create consolidation request data
 *
 * @param sourceValidatorPubkey - The source validator pubkey
 * @param targetValidatorPubkey - The target validator pubkey
 * @returns The consolidation request data
 */
function createConsolidationRequestData(
  sourceValidatorPubkey: string,
  targetValidatorPubkey: string
): string {
  return PREFIX_0x.concat(sourceValidatorPubkey.substring(2)).concat(
    targetValidatorPubkey.substring(2)
  );
}
