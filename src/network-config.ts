import {
  CONSOLIDATION_CONTRACT_ADDRESS,
  WITHDRAWAL_CONTRACT_ADDRESS
} from './constants/application';
import type { NetworkConfig } from './model/ethereum';

export const networkConfig: Record<string, NetworkConfig> = {
  mainnet: {
    consolidationContractAddress: CONSOLIDATION_CONTRACT_ADDRESS,
    withdrawalContractAddress: WITHDRAWAL_CONTRACT_ADDRESS,
    chainId: 1n
  },
  holesky: {
    consolidationContractAddress: CONSOLIDATION_CONTRACT_ADDRESS,
    withdrawalContractAddress: WITHDRAWAL_CONTRACT_ADDRESS,
    chainId: 17000n
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
  kurtosis_pectra_devnet: {
    consolidationContractAddress: CONSOLIDATION_CONTRACT_ADDRESS,
    withdrawalContractAddress: WITHDRAWAL_CONTRACT_ADDRESS,
    chainId: 3151908n
  }
};
