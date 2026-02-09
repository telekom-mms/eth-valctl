import chalk from 'chalk';

import { PREFIX_0x } from '../../constants/application';
import * as logging from '../../constants/logging';
import type { GlobalCliOptions } from '../../model/commander';
import { networkConfig } from '../../network-config';
import { checkWithdrawalCredentialType } from '../validation/pre-request';
import { createEthereumConnection } from './ethereum';
import { sendExecutionLayerRequests } from './request/send-request';

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
  if (targetValidatorPubkey) {
    await checkWithdrawalCredentialType(globalOptions.beaconApiUrl, [targetValidatorPubkey]);
    logConsolidationWarning();
  }
  const ethereumConnection = await createEthereumConnection(globalOptions.jsonRpcUrl);
  const consolidationRequestData: string[] = [];
  for (const sourceValidator of sourceValidatorPubkeys) {
    const request = createConsolidationRequestData(sourceValidator, targetValidatorPubkey);
    consolidationRequestData.push(request);
  }
  await sendExecutionLayerRequests(
    networkConfig[globalOptions.network]!.consolidationContractAddress,
    ethereumConnection.provider,
    ethereumConnection.wallet,
    consolidationRequestData,
    globalOptions.maxRequestsPerBlock
  );
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
  let consolidationRequestData = PREFIX_0x.concat(sourceValidatorPubkey.substring(2));
  if (targetValidatorPubkey) {
    consolidationRequestData = consolidationRequestData.concat(targetValidatorPubkey.substring(2));
  } else {
    consolidationRequestData = consolidationRequestData.concat(sourceValidatorPubkey.substring(2));
  }
  return consolidationRequestData;
}

/**
 * Log consolidation specific warning
 */
function logConsolidationWarning(): void {
  console.log(chalk.yellow(logging.WITHDRAWAL_CREDENTIAL_WARNING));
}
