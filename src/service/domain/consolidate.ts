import chalk from 'chalk';

import { PREFIX_0x } from '../../constants/application';
import * as logging from '../../constants/logging';
import type { GlobalCliOptions } from '../../model/commander';
import { executeRequestPipeline } from './execution-layer-request-pipeline';
import { checkWithdrawalCredentialType } from './pre-request-validation';

/**
 * Consolidate one or many validators to one target validator / Switch withdrawal credential type from 0x01 to 0x02 for one or many validators
 *
 * @param globalOptions - The global cli options
 * @param sourceValidatorPubkeys - The validator pubkey(s) which will be consolidated / for which withdrawal credential type will be switched
 * @param targetValidatorPubkey - The target validator for consolidation
 */
export async function consolidate(
  globalOptions: GlobalCliOptions,
  sourceValidatorPubkeys: string[],
  targetValidatorPubkey?: string
): Promise<void> {
  await executeRequestPipeline({
    globalOptions,
    validatorPubkeys: sourceValidatorPubkeys,
    encodeRequestData: (pubkey) => createConsolidationRequestData(pubkey, targetValidatorPubkey),
    resolveContractAddress: (config) => config.consolidationContractAddress,
    validate: targetValidatorPubkey
      ? async () => {
          await checkWithdrawalCredentialType(globalOptions.beaconApiUrl, [targetValidatorPubkey]);
          logConsolidationWarning();
        }
      : undefined
  });
}

/**
 * Create consolidation request data
 *
 * @param sourceValidatorPubkey - The validator pubkey(s) which will be consolidated / for which withdrawal credential type will be switched
 * @param targetValidatorPubkey - The target validator for consolidation
 * @returns The consolidation request data
 */
function createConsolidationRequestData(
  sourceValidatorPubkey: string,
  targetValidatorPubkey?: string
): string {
  const target = targetValidatorPubkey ?? sourceValidatorPubkey;
  return PREFIX_0x.concat(sourceValidatorPubkey.substring(2)).concat(target.substring(2));
}

/**
 * Log consolidation specific warning
 */
function logConsolidationWarning(): void {
  console.log(chalk.yellow(logging.WITHDRAWAL_CREDENTIAL_WARNING));
}
