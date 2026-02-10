import {
  CONSOLIDATION_CONTRACT_ADDRESS,
  WITHDRAWAL_CONTRACT_ADDRESS
} from './constants/application';
import type { NetworkConfig } from './model/ethereum';

/**
 * Network configurations for supported Ethereum networks
 *
 * Maps network names to their respective system contract addresses and chain IDs.
 * System contracts are EIP-7251 (consolidation) and EIP-7002 (withdrawal) addresses.
 *
 * Supported networks:
 * - mainnet: Ethereum mainnet (chain ID 1)
 * - sepolia: Sepolia testnet (chain ID 11155111)
 * - hoodi: Hoodi testnet (chain ID 560048)
 * - kurtosis_devnet: Kurtosis Pectra devnet (chain ID 3151908)
 */
export const networkConfig: Record<string, NetworkConfig> = {
  mainnet: {
    consolidationContractAddress: CONSOLIDATION_CONTRACT_ADDRESS,
    withdrawalContractAddress: WITHDRAWAL_CONTRACT_ADDRESS,
    chainId: 1n
  },
  sepolia: {
    consolidationContractAddress: CONSOLIDATION_CONTRACT_ADDRESS,
    withdrawalContractAddress: WITHDRAWAL_CONTRACT_ADDRESS,
    chainId: 11155111n
  },
  hoodi: {
    consolidationContractAddress: CONSOLIDATION_CONTRACT_ADDRESS,
    withdrawalContractAddress: WITHDRAWAL_CONTRACT_ADDRESS,
    chainId: 560048n
  },
  kurtosis_devnet: {
    consolidationContractAddress: CONSOLIDATION_CONTRACT_ADDRESS,
    withdrawalContractAddress: WITHDRAWAL_CONTRACT_ADDRESS,
    chainId: 3151908n
  }
};
