import { JsonRpcProvider, NonceManager, TransactionResponse } from 'ethers';

export interface EthereumConnection {
  wallet: NonceManager;
  provider: JsonRpcProvider;
}

export interface NetworkConfig {
  consolidationContractAddress: string;
  withdrawalContractAddress: string;
  chainId: bigint;
}

export interface ExecutionLayerRequestTransaction {
  to: string;
  data: string;
  value: bigint;
  gasLimit: bigint;
}

export interface ValidatorResponse {
  data: {
    validator: {
      withdrawal_credentials: string;
    };
  };
}

/**
 * Interface for tracking pending transactions
 */
export interface PendingTransaction {
  hash: string;
  nonce: number;
  data: string;
  response: TransactionResponse;
  isConfirmed: boolean;
}
