import type { JsonRpcProvider, TransactionReceipt, TransactionResponse } from 'ethers';

import type * as application from '../constants/application';
import type { ISigner } from '../ports/signer.interface';

/**
 * Signer type for transaction signing
 */
export type SignerType = 'wallet' | 'ledger';

/**
 * Context for signing operations (used for user prompts with hardware wallets)
 */
export interface SigningContext {
  /** Current transaction index (1-based) */
  currentIndex: number;
  /** Total number of transactions to sign */
  totalCount: number;
  /** Validator public key for this transaction */
  validatorPubkey: string;
}

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
  ALREADY_MINED = 'already_mined',
  USER_REJECTED = 'user_rejected'
}

/**
 * Connection to Ethereum network with signer abstraction
 */
export interface EthereumConnection {
  signer: ISigner;
  provider: JsonRpcProvider;
}

/**
 * Network-specific configuration for execution layer request contracts (EIP-7251, EIP-7002)
 */
export interface NetworkConfig {
  consolidationContractAddress: string;
  withdrawalContractAddress: string;
  chainId: bigint;
  safeTransactionServiceUrl?: string;
  safeRequiresApiKey?: boolean;
  safeContractAddresses?: SafeContractAddresses;
}

/**
 * Custom Safe contract addresses for networks not in \@safe-global/safe-deployments
 */
export interface SafeContractAddresses {
  safeSingletonAddress: string;
  safeProxyFactoryAddress: string;
  multiSendAddress: string;
  multiSendCallOnlyAddress: string;
  fallbackHandlerAddress: string;
  signMessageLibAddress: string;
  createCallAddress: string;
  simulateTxAccessorAddress: string;
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

export enum BroadcastStatusType {
  SUCCESS = 'success',
  FAILED = 'failed',
  REJECTED = 'rejected'
}

/**
 * Result of attempting to broadcast an execution layer request transaction
 */
export type BroadcastResult =
  /** Transaction successfully broadcast to network */
  | { status: BroadcastStatusType.SUCCESS; transaction: PendingTransactionInfo }
  /** Transaction broadcast failed */
  | { status: BroadcastStatusType.FAILED; validatorPubkey: string; error: unknown }
  /** Transaction rejected by user on hardware wallet */
  | { status: BroadcastStatusType.REJECTED; validatorPubkey: string };

/**
 * Result of processing a single batch of transactions
 */
export interface BatchProcessingResult {
  failedValidatorPubkeys: string[];
  rejectedValidatorPubkeys: string[];
}

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
  | { status: TransactionReplacementStatusType.ALREADY_MINED }
  /** Replacement rejected by user on hardware wallet */
  | { status: TransactionReplacementStatusType.USER_REJECTED; transaction: PendingTransactionInfo };

export interface ReplacementSummary {
  successful: number;
  underpriced: number;
  failed: number;
  alreadyMined: number;
  userRejected: number;
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
  rejectedValidatorPubkeys: string[];
}

export interface CategorizedTransactions {
  mined: TransactionReplacementResult[];
  reverted: PendingTransactionInfo[];
  pending: PendingTransactionInfo[];
}

/**
 * Beacon API genesis response structure
 */
export interface GenesisResponse {
  data: {
    genesis_time: string;
    genesis_validators_root: string;
    genesis_fork_version: string;
  };
}

/**
 * Current slot position within the beacon chain
 */
export interface SlotPosition {
  currentSlot: number;
  secondInSlot: number;
  secondsUntilNextSlot: number;
}

/**
 * Lifecycle contract for objects that hold resources requiring explicit cleanup
 */
export interface Disposable {
  dispose(): Promise<void>;
}

/**
 * Fee state from a system contract including calculated fee and raw excess value
 */
export interface ContractFeeState {
  /** Calculated contract fee in wei */
  fee: bigint;
  /** Raw excess value from storage slot 0 */
  excess: bigint;
}

/**
 * Minimal state reader required for request-fee estimation.
 */
export interface RequestFeeStateReader {
  fetchContractFeeWithExcess(): Promise<ContractFeeState>;
  getMaxNetworkFees(): Promise<MaxNetworkFees>;
}

/**
 * Minimal reader required for request-fee cap enforcement.
 */
export interface RequestFeeReader {
  fetchContractFee(): Promise<bigint>;
  fetchBlockNumber(): Promise<number>;
}

/**
 * Service contract for resolving an approved request fee under a cap policy.
 */
export interface RequestFeeCapResolver {
  resolveRequestFee(
    policy: RequestFeeCapPolicy,
    context: RequestFeeCapCheckContext
  ): Promise<bigint>;
}

/**
 * Runtime request-fee cap dependencies shared by request orchestration components.
 */
export interface RequestFeeCapRuntime {
  policy: RequestFeeCapPolicy;
  resolver: RequestFeeCapResolver;
  initialApprovedRequestFee?: bigint;
}

/**
 * Input for request-fee projection across idealized batches.
 */
export interface RequestFeeEstimateConfig {
  totalRequestCount: number;
  maxRequestsPerBlock: number;
  maxRequestFee: bigint;
}

/**
 * Parameters for estimating how long a request fee needs to drain to a target fee.
 */
export interface FeeDropEstimateConfig {
  currentExcess: bigint;
  targetFee: bigint;
  systemContractAddress: string;
}

/**
 * Input for projecting per-batch request fees, including the starting excess and contract address.
 */
export interface BatchProjectionConfig extends RequestFeeEstimateConfig {
  currentExcess: bigint;
  systemContractAddress: string;
}

/**
 * Per-batch request-fee projection.
 */
export interface RequestFeeBatchProjection {
  batchNumber: number;
  requestCount: number;
  requestFee: bigint;
  capExceeded: boolean;
}

/**
 * Current request-fee and network-fee estimate.
 */
export interface RequestFeeEstimate {
  currentExcess: bigint;
  currentRequestFee: bigint;
  maxNetworkFees: MaxNetworkFees;
  gasLimit: bigint;
  gasCost: bigint;
  exceedsCap: boolean;
  estimatedBlocksUntilCap: bigint;
  batches: RequestFeeBatchProjection[];
}

/**
 * User-facing behavior when a request fee exceeds the configured cap.
 */
export type FeeCapDecision =
  | typeof application.FEE_ACTION_WAIT
  | typeof application.FEE_ACTION_CONTINUE
  | typeof application.FEE_ACTION_ABORT;

/**
 * Request-fee cap policy used before broadcasting or proposing requests.
 */
export interface RequestFeeCapPolicy {
  maxRequestFee: bigint;
  maxWaitBlocks: bigint;
  skipConfirmation: boolean;
}

/**
 * Request-fee cap check boundary operation.
 */
export type RequestFeeCapOperation =
  | typeof application.FEE_CAP_OPERATION_BATCH
  | typeof application.FEE_CAP_OPERATION_REPLACEMENT
  | typeof application.FEE_CAP_OPERATION_SAFE_PROPOSAL;

/**
 * Context for checking a request-fee cap at a broadcast/proposal boundary.
 */
export interface RequestFeeCapCheckContext {
  operation: RequestFeeCapOperation;
  requestCount: number;
}

export class RequestFeeCapExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestFeeCapExceededError';
  }
}

export class RequestFeeOperationCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestFeeOperationCancelledError';
  }
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

/**
 * Thrown when INSUFFICIENT_FUNDS is detected during broadcast to abort remaining batches
 */
export class InsufficientFundsAbortError extends Error {
  constructor(public readonly failedPubkeys: string[]) {
    super('Insufficient funds detected - aborting remaining batches');
    this.name = 'InsufficientFundsAbortError';
  }
}
