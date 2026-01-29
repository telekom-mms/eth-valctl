import chalk from 'chalk';
import { JsonRpcProvider, NonceManager, Wallet } from 'ethers';

import * as logging from '../../constants/logging';
import type { EthereumConnection, SignerType } from '../../model/ethereum';
import { promptSecret } from '../prompt';
import { LedgerSigner, WalletSigner } from './signer';

/**
 * Create Ethereum related connection information
 *
 * @param jsonRpcUrl - The json rpc url used for creating a json rpc provider
 * @param signerType - Type of signer to use ('wallet' for private key, 'ledger' for hardware wallet)
 * @returns The ethereum connection information
 */
export async function createEthereumConnection(
  jsonRpcUrl: string,
  signerType: SignerType = 'wallet'
): Promise<EthereumConnection> {
  const provider = new JsonRpcProvider(jsonRpcUrl);
  await provider.getNetwork();

  if (signerType === 'ledger') {
    return createLedgerConnection(provider);
  }

  return createWalletConnection(provider);
}

/**
 * Create connection using private key wallet
 */
async function createWalletConnection(provider: JsonRpcProvider): Promise<EthereumConnection> {
  try {
    const privateKey = await promptSecret(chalk.green(logging.PROMPT_PRIVATE_KEY_INFO));
    const wallet = new Wallet(privateKey, provider);
    const signer = new WalletSigner(new NonceManager(wallet));
    return { signer, provider };
  } catch {
    console.error(chalk.red(logging.INVALID_PRIVATE_KEY_ERROR));
    process.exit(1);
  }
}

/**
 * Create connection using Ledger hardware wallet
 */
async function createLedgerConnection(provider: JsonRpcProvider): Promise<EthereumConnection> {
  try {
    const signer = await LedgerSigner.create(provider);
    return { signer, provider };
  } catch (error) {
    console.error(chalk.red(logging.LEDGER_CONNECTION_ERROR), error);
    process.exit(1);
  }
}
