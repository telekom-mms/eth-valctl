import chalk from 'chalk';
import { JsonRpcProvider, NonceManager, Wallet } from 'ethers';

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
    return { wallet: new NonceManager(wallet), provider };
  } catch {
    console.error(chalk.red(logging.INVALID_PRIVATE_KEY_ERROR));
    process.exit(1);
  }
}
