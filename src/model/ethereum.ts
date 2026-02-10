import { JsonRpcProvider, NonceManager, TransactionReceipt, TransactionResponse } from 'ethers';

export enum TransactionStatusType {
  MINED = 'mined',
  REVERTED = 'reverted',
  PENDING = 'pending',
  MINED_BY_COMPETITOR = 'mined_by_competitor'
}

export enum TransactionReplacementStatusType {
  SUCCESS = 'success',
  UNDERPRICED = 'underpriced',
  FAILED = 'failed',
  ALREADY_MINED = 'already_mined'
}

export interface EthereumConnection {
  wallet: NonceManager;
  provider: JsonRpcProvider;
}

/**
 * Network-specific configuration for execution layer request contracts (EIP-7251, EIP-7002)
 */
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
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}

export interface PendingTransactionInfo {
  response: TransactionResponse;
  nonce: number;
  data: string;
  systemContractAddress: string;
  /** Block number when transaction was broadcast (not target inclusion block) */
  blockNumber: number;
}

/**
 * Result of attempting to broadcast an execution layer request transaction
 */
export type BroadcastResult =
  /** Transaction successfully broadcast to network */
  | { status: 'success'; transaction: PendingTransactionInfo }
  /** Transaction broadcast failed */
  | { status: 'failed'; validatorPubkey: string; error: unknown };

export interface ValidatorResponse {
  data: {
    validator: {
      withdrawal_credentials: string;
    };
  };
}

/**
 * Transaction status with receipt data if confirmed
 */
export type TransactionStatus =
  /** Transaction successfully executed */
  | { type: TransactionStatusType.MINED; receipt: TransactionReceipt }
  /** Transaction executed but reverted */
  | { type: TransactionStatusType.REVERTED; receipt: TransactionReceipt }
  /** Transaction not yet included in block */
  | { type: TransactionStatusType.PENDING }
  /** Nonce consumed by a different transaction (original or competing replacement) */
  | { type: TransactionStatusType.MINED_BY_COMPETITOR };

export interface ReceiptCheckResult {
  pendingTransaction: PendingTransactionInfo;
  status: TransactionStatus;
}

/**
 * Result of attempting to replace a pending transaction with updated fees
 */
export type TransactionReplacementResult =
  /** Transaction replaced and broadcast with updated fees */
  | { status: TransactionReplacementStatusType.SUCCESS; transaction: PendingTransactionInfo }
  /** Replacement rejected as underpriced by network */
  | { status: TransactionReplacementStatusType.UNDERPRICED; transaction: PendingTransactionInfo }
  /** Replacement failed with error */
  | {
      status: TransactionReplacementStatusType.FAILED;
      transaction: PendingTransactionInfo;
      error: unknown;
    }
  /** Original transaction already mined before replacement */
  | { status: TransactionReplacementStatusType.ALREADY_MINED };

export interface ReplacementSummary {
  successful: number;
  underpriced: number;
  failed: number;
  alreadyMined: number;
}

export interface MaxNetworkFees {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export interface TransactionRetryResult {
  pendingTransactions: PendingTransactionInfo[];
  currentBlockNumber: number;
  /**
   * Whether to increment retry counter (false if progress was made)
   */
  incrementRetry: boolean;
}

export interface CategorizedTransactions {
  mined: TransactionReplacementResult[];
  reverted: PendingTransactionInfo[];
  pending: PendingTransactionInfo[];
}

export class BlockchainStateError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown
  ) {
    super(message);
    this.name = 'BlockchainStateError';
  }
}
