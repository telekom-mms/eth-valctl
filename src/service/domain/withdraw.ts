import { parseUnits } from 'ethers';

import { PREFIX_0x } from '../../constants/application';
import type { GlobalCliOptions } from '../../model/commander';
import { executeRequestPipeline } from './execution-layer-request-pipeline';
import { checkCompoundingCredentials } from './pre-request-validation';

/**
 * Withdraw the provided amount from one or many validators / Exit one or many validators
 *
 * @param globalOptions - The global cli options
 * @param validatorPubkeys - The validator pubkey(s) from which the provided amount is withdrawn / which are exited
 * @param amount - The amount which will be withdrawn
 */
export async function withdraw(
  globalOptions: GlobalCliOptions,
  validatorPubkeys: string[],
  amount: number
): Promise<void> {
  await executeRequestPipeline({
    globalOptions,
    validatorPubkeys,
    encodeRequestData: (pubkey) => createWithdrawRequestData(pubkey, amount),
    resolveContractAddress: (config) => config.withdrawalContractAddress,
    validate:
      amount > 0
        ? async () => {
            await checkCompoundingCredentials(globalOptions.beaconApiUrl, validatorPubkeys);
          }
        : undefined
  });
}

/**
 * Create withdraw request data
 *
 * @param validatorPubkey - The validator pubkey
 * @param amount - The amount in ETH to withdraw from validator (0 for exit)
 * @returns The withdraw request data
 */
function createWithdrawRequestData(validatorPubkey: string, amount: number): string {
  const parsedGwei = parseUnits(amount.toString(), 'gwei');
  const parsedGweiHex = parsedGwei.toString(16).padStart(16, '0');
  return PREFIX_0x.concat(validatorPubkey.substring(2)).concat(parsedGweiHex);
}
