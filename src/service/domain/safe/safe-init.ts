import type SafeApiKit from '@safe-global/api-kit';
import type { SafeInfoResponse } from '@safe-global/api-kit';
import type { ContractNetworksConfig } from '@safe-global/protocol-kit';
import Safe from '@safe-global/protocol-kit';
import chalk from 'chalk';
import type { JsonRpcProvider } from 'ethers';

import { SAFE_FOUND_INFO, SAFE_VERIFYING_INFO } from '../../../constants/logging';
import type { GlobalCliOptions } from '../../../model/commander';
import type { NetworkConfig, SafeContractAddresses } from '../../../model/ethereum';
import { createValidatedProvider } from '../ethereum';
import {
  checkTransactionServiceHealth,
  validateSafeExists,
  validateSignerIsOwner
} from './safe-preflight';
import { createSafeApiKit } from './safe-sdk-factory';
import { initializeSafeSigner } from './safe-signer-init';

/**
 * Result of Safe initialization containing all SDK instances and validated state
 */
export interface SafeInitResult {
  apiKit: SafeApiKit;
  protocolKit: Safe;
  provider: JsonRpcProvider;
  signerAddress: string;
  safeInfo: SafeInfoResponse;
  dispose: () => Promise<void>;
}

/**
 * Initialize Safe SDK instances with full preflight validation
 *
 * Creates a validated provider, initializes the API Kit, verifies TX Service
 * health, validates the Safe exists, initializes the signer (private key or
 * Ledger), verifies signer ownership, and creates the Protocol Kit.
 *
 * @param globalOptions - Global CLI options (network, RPC URL, ledger flag)
 * @param netConfig - Network configuration with TX Service URL and chain ID
 * @param safeAddress - Validated Safe multisig address
 * @returns Fully initialized SDK instances ready for sign/execute/propose operations
 */
export async function initializeSafe(
  globalOptions: GlobalCliOptions,
  netConfig: NetworkConfig,
  safeAddress: string
): Promise<SafeInitResult> {
  const safeConfig = {
    safeAddress,
    chainId: netConfig.chainId,
    txServiceUrl: netConfig.safeTransactionServiceUrl!,
    rpcUrl: globalOptions.jsonRpcUrl
  };

  const provider = await createValidatedProvider(globalOptions.jsonRpcUrl);
  const apiKit = createSafeApiKit(safeConfig, netConfig.safeRequiresApiKey ?? false);

  console.error(chalk.blue(SAFE_VERIFYING_INFO(safeAddress, globalOptions.network)));
  await checkTransactionServiceHealth(apiKit, safeConfig.txServiceUrl);
  const safeInfo = await validateSafeExists(apiKit, safeAddress, globalOptions.network);

  const { signerAddress, protocolKitProvider, protocolKitSigner, dispose } =
    await initializeSafeSigner(globalOptions, provider);

  validateSignerIsOwner(safeInfo, signerAddress, safeAddress);
  console.error(
    chalk.green(SAFE_FOUND_INFO(safeInfo.threshold, safeInfo.owners.length, signerAddress))
  );

  const protocolKit = await Safe.init({
    provider: protocolKitProvider,
    signer: protocolKitSigner,
    safeAddress,
    ...(netConfig.safeContractAddresses && {
      contractNetworks: buildContractNetworks(netConfig.chainId, netConfig.safeContractAddresses)
    })
  });

  return { apiKit, protocolKit, provider, signerAddress, safeInfo, dispose };
}

/**
 * Build Protocol Kit contract network configuration for chains not in safe-global/safe-deployments
 *
 * @param chainId - Chain ID of the network
 * @param addresses - Safe contract addresses for the network
 * @returns ContractNetworksConfig object for Protocol Kit initialization
 */
function buildContractNetworks(
  chainId: bigint,
  addresses: SafeContractAddresses
): ContractNetworksConfig {
  return {
    [chainId.toString()]: addresses
  };
}
