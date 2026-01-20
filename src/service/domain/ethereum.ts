import chalk from 'chalk';
import { JsonRpcProvider, NonceManager, Wallet } from 'ethers';

import * as serviceConstants from '../../constants/application';
import * as logging from '../../constants/logging';
import type { EthereumConnection } from '../../model/ethereum';
import { promptSecret } from '../prompt';

/**
 * Create Ethereum related connection information
 *
 * @param jsonRpcUrl - The json rpc url used for creating a json rpc provider
 * @returns The ethereum connection information
 */
export async function createEthereumConnection(jsonRpcUrl: string): Promise<EthereumConnection> {
  try {
    const provider = new JsonRpcProvider(jsonRpcUrl);
    await provider.getNetwork();
    const privateKey = await promptSecret(chalk.green(logging.PROMPT_PRIVATE_KEY_INFO));
    const wallet = new Wallet(privateKey, provider);
    return { wallet: new NonceManager(wallet), provider: provider };
  } catch {
    console.error(chalk.red(logging.INVALID_PRIVATE_KEY_ERROR));
    process.exit(1);
  }
}

/**
 * Calculates the required fee for sending an execution layer request to a specific system contract
 *
 * @param numerator - The request queue length of a specific system contract
 * @returns The required fee for sending an execution layer request
 */
export function getRequiredFee(numerator: bigint): bigint {
  // https://eips.ethereum.org/EIPS/eip-7251#fee-calculation
  let i = 1n;
  let output = 0n;
  let numeratorAccum =
    serviceConstants.MIN_CONSOLIDATION_REQUEST_FEE *
    serviceConstants.CONSOLIDATION_REQUEST_FEE_UPDATE_FRACTION;
  while (numeratorAccum > 0n) {
    output += numeratorAccum;
    numeratorAccum =
      (numeratorAccum * numerator) /
      (serviceConstants.CONSOLIDATION_REQUEST_FEE_UPDATE_FRACTION * i);
    i += 1n;
  }
  return output / serviceConstants.CONSOLIDATION_REQUEST_FEE_UPDATE_FRACTION;
}
