import { DEFAULT_MAX_FEE, DEFAULT_MAX_FEE_PER_GAS, PREFIX_0x } from '../../constants/application';
import { SOURCE_VALIDATOR_0x00_CREDENTIALS_ERROR } from '../../constants/logging';
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
 * @param maxFee - Maximum contract fee per request in wei (numeric string, optional)
 * @param maxFeePerGas - Maximum gas fee per gas in wei (numeric string, optional)
 */
export async function consolidate(
  globalOptions: GlobalCliOptions,
  sourceValidatorPubkeys: string[],
  targetValidatorPubkey: string,
  skipTargetOwnershipCheck: boolean = false,
  maxFee?: string,
  maxFeePerGas?: string
): Promise<void> {
  const maxFeeBigInt = BigInt(maxFee ?? String(DEFAULT_MAX_FEE));
  const maxFeePerGasBigInt = BigInt(maxFeePerGas ?? String(DEFAULT_MAX_FEE_PER_GAS));

  await executeRequestPipeline({
    globalOptions,
    maxFee: maxFeeBigInt,
    maxFeePerGasCap: maxFeePerGasBigInt,
    validatorPubkeys: sourceValidatorPubkeys,
    encodeRequestData: (pubkey) => createConsolidationRequestData(pubkey, targetValidatorPubkey),
    resolveContractAddress: (config) => config.consolidationContractAddress,
    validate: async (ownerAddress, ownerLabel) => {
      await checkCompoundingCredentials(globalOptions.beaconApiUrl, [targetValidatorPubkey]);
      await checkHasExecutionCredentials(
        globalOptions.beaconApiUrl,
        sourceValidatorPubkeys,
        SOURCE_VALIDATOR_0x00_CREDENTIALS_ERROR
      );
      const pubkeysToCheck = skipTargetOwnershipCheck
        ? sourceValidatorPubkeys
        : [targetValidatorPubkey, ...sourceValidatorPubkeys];
      await checkWithdrawalAddressOwnership(
        globalOptions.beaconApiUrl,
        ownerAddress,
        pubkeysToCheck,
        [targetValidatorPubkey],
        ownerLabel
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
