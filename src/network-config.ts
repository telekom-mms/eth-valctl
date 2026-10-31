import * as application from './constants/application';
import type { NetworkConfig } from './model/ethereum';

/**
 * Network configurations for supported Ethereum networks
 *
 * Maps network names to their respective system contract addresses and chain IDs.
 * System contracts are EIP-7251 (consolidation) and EIP-7002 (withdrawal) addresses.
 * Sepolia has no deposit config because its deposit contract is token-gated.
 *
 * Supported networks:
 * - mainnet: Ethereum mainnet (chain ID 1)
 * - sepolia: Sepolia testnet (chain ID 11155111)
 * - hoodi: Hoodi testnet (chain ID 560048)
 * - kurtosis_devnet: Kurtosis Pectra devnet (chain ID 3151908)
 */
export const networkConfig: Record<string, NetworkConfig> = {
  mainnet: {
    consolidationContractAddress: application.CONSOLIDATION_CONTRACT_ADDRESS,
    withdrawalContractAddress: application.WITHDRAWAL_CONTRACT_ADDRESS,
    chainId: 1n,
    safeTransactionServiceUrl: 'https://safe-transaction-mainnet.safe.global/api',
    safeRequiresApiKey: true,
    deposit: {
      contractAddress: application.DEPOSIT_CONTRACT_ADDRESS,
      genesisForkVersion: application.MAINNET_GENESIS_FORK_VERSION
    }
  },
  sepolia: {
    consolidationContractAddress: application.CONSOLIDATION_CONTRACT_ADDRESS,
    withdrawalContractAddress: application.WITHDRAWAL_CONTRACT_ADDRESS,
    chainId: 11155111n,
    safeTransactionServiceUrl: 'https://safe-transaction-sepolia.safe.global/api',
    safeRequiresApiKey: true
  },
  hoodi: {
    consolidationContractAddress: application.CONSOLIDATION_CONTRACT_ADDRESS,
    withdrawalContractAddress: application.WITHDRAWAL_CONTRACT_ADDRESS,
    chainId: 560048n,
    safeTransactionServiceUrl: 'https://transaction-ethereum-hoodi.safe.protofire.io/api',
    safeRequiresApiKey: false,
    deposit: {
      contractAddress: application.DEPOSIT_CONTRACT_ADDRESS,
      genesisForkVersion: application.HOODI_GENESIS_FORK_VERSION
    }
  },
  kurtosis_devnet: {
    consolidationContractAddress: application.CONSOLIDATION_CONTRACT_ADDRESS,
    withdrawalContractAddress: application.WITHDRAWAL_CONTRACT_ADDRESS,
    chainId: 3151908n,
    safeTransactionServiceUrl: 'http://localhost:5555/api',
    safeRequiresApiKey: false,
    deposit: {
      contractAddress: application.DEPOSIT_CONTRACT_ADDRESS,
      genesisForkVersion: application.KURTOSIS_GENESIS_FORK_VERSION
    },
    safeContractAddresses: {
      safeSingletonAddress: '',
      safeProxyFactoryAddress: '',
      multiSendAddress: '',
      multiSendCallOnlyAddress: '',
      fallbackHandlerAddress: '',
      signMessageLibAddress: '',
      createCallAddress: '',
      simulateTxAccessorAddress: ''
    }
  }
};
