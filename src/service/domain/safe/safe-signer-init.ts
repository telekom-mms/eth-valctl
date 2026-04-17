import Eth from '@ledgerhq/hw-app-eth';
import type { SafeProviderConfig } from '@safe-global/protocol-kit';
import chalk from 'chalk';
import type { JsonRpcProvider } from 'ethers';
import { Wallet } from 'ethers';

import { PROMPT_SAFE_SIGNER_PRIVATE_KEY_INFO } from '../../../constants/logging';
import type { GlobalCliOptions } from '../../../model/commander';
import { promptLedgerAddressSelection, promptSecret } from '../../prompt';
import { LedgerEip1193Provider } from '../signer/ledger-eip1193-provider';
import { connectWithTimeout } from '../signer/ledger-transport';

/**
 * Signer initialization result for Safe Protocol Kit
 */
export interface SafeSignerInfo {
  signerAddress: string;
  protocolKitProvider: SafeProviderConfig['provider'];
  protocolKitSigner: string;
  dispose: () => Promise<void>;
}

/**
 * Initialize signer for Safe operations (private key or Ledger)
 *
 * @param globalOptions - Global CLI options (ledger flag, JSON-RPC URL)
 * @param provider - JSON-RPC provider for address resolution
 * @returns Signer address and Protocol Kit initialization params
 */
export async function initializeSafeSigner(
  globalOptions: GlobalCliOptions,
  provider: JsonRpcProvider
): Promise<SafeSignerInfo> {
  if (globalOptions.ledger) {
    const selection = await promptLedgerAddressSelection(provider);
    const transport = await connectWithTimeout();
    const eth = new Eth(transport);
    const ledgerProvider = new LedgerEip1193Provider(
      transport,
      eth,
      selection.derivationPath,
      selection.address,
      provider
    );

    return {
      signerAddress: selection.address,
      protocolKitProvider: ledgerProvider,
      protocolKitSigner: selection.address,
      dispose: () => ledgerProvider.dispose()
    };
  }

  const privateKey = await promptSecret(chalk.blue(PROMPT_SAFE_SIGNER_PRIVATE_KEY_INFO));
  const wallet = new Wallet(privateKey, provider);

  return {
    signerAddress: wallet.address,
    protocolKitProvider: globalOptions.jsonRpcUrl,
    protocolKitSigner: privateKey,
    dispose: async () => {}
  };
}
