import { parseUnits } from 'ethers';

import { PREFIX_0x } from '../../constants/application';
import type { GlobalCliOptions } from '../../model/commander';
import { networkConfig } from '../../network-config';
import { checkWithdrawalCredentialType } from '../validation/pre-request';
import { createEthereumConnection } from './ethereum';
import { sendExecutionLayerRequests } from './request/send-request';

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
  if (amount > 0) {
    checkWithdrawalCredentialType(globalOptions.beaconApiUrl, validatorPubkeys);
  }
  const signerType = globalOptions.ledger ? 'ledger' : 'wallet';
  const ethereumConnection = await createEthereumConnection(globalOptions.jsonRpcUrl, signerType);
  const withdrawalRequestData: string[] = [];
  for (const validator of validatorPubkeys) {
    withdrawalRequestData.push(createWithdrawRequestData(validator, amount));
  }
  await sendExecutionLayerRequests(
    networkConfig[globalOptions.network]!.withdrawalContractAddress,
    ethereumConnection.provider,
    ethereumConnection.signer,
    withdrawalRequestData,
    globalOptions.maxRequestsPerBlock,
    globalOptions.beaconApiUrl
  );
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
