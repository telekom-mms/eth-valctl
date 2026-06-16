import { parseUnits } from 'ethers';

import { DEFAULT_MAX_FEE, DEFAULT_MAX_FEE_PER_GAS, PREFIX_0x } from '../../constants/application';
import type { GlobalCliOptions } from '../../model/commander';
import { executeRequestPipeline } from './execution-layer-request-pipeline';
import {
  checkCompoundingCredentials,
  checkWithdrawalAddressOwnership
} from './pre-request-validation';

/**
 * Withdraw the provided amount from one or many validators / Exit one or many validators
 *
 * @param globalOptions - The global cli options
 * @param validatorPubkeys - The validator pubkey(s) from which the provided amount is withdrawn / which are exited
 * @param amount - The amount which will be withdrawn
 * @param maxFee - Maximum contract fee per request in wei (numeric string, optional)
 * @param maxFeePerGas - Maximum gas fee per gas in wei (numeric string, optional)
 */
export async function withdraw(
  globalOptions: GlobalCliOptions,
  validatorPubkeys: string[],
  amount: number,
  maxFee?: string,
  maxFeePerGas?: string
): Promise<void> {
  const maxFeeBigInt = BigInt(maxFee ?? String(DEFAULT_MAX_FEE));
  const maxFeePerGasBigInt = BigInt(maxFeePerGas ?? String(DEFAULT_MAX_FEE_PER_GAS));

  await executeRequestPipeline({
    globalOptions,
    maxFee: maxFeeBigInt,
    maxFeePerGasCap: maxFeePerGasBigInt,
    validatorPubkeys,
    encodeRequestData: (pubkey) => createWithdrawRequestData(pubkey, amount),
    resolveContractAddress: (config) => config.withdrawalContractAddress,
    validate: async (ownerAddress, ownerLabel) => {
      if (amount > 0) {
        await checkCompoundingCredentials(globalOptions.beaconApiUrl, validatorPubkeys);
      }
      await checkWithdrawalAddressOwnership(
        globalOptions.beaconApiUrl,
        ownerAddress,
        validatorPubkeys,
        undefined,
        ownerLabel
      );
    }
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
