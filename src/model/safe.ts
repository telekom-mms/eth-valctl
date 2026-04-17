import type SafeApiKit from '@safe-global/api-kit';
import type Safe from '@safe-global/protocol-kit';
import type { SafeMultisigTransactionResponse } from '@safe-global/types-kit';
import type { JsonRpcProvider } from 'ethers';

/**
 * Safe multisig connection configuration for SDK initialization
 */
export interface SafeConnectionConfig {
  safeAddress: string;
  chainId: bigint;
  txServiceUrl: string;
  rpcUrl: string;
}

/**
 * Fee status for a validated Safe transaction
 */
export enum FeeStatus {
  SUFFICIENT = 'SUFFICIENT',
  STALE = 'STALE',
  OVERPAID = 'OVERPAID',
  UNVALIDATED = 'UNVALIDATED'
}

/**
 * Extracted fee information from a Safe transaction's per-operation data
 */
export interface TransactionFeeInfo {
  /** Per-operation fee in wei */
  proposedFee: bigint;
  /** Target system contract address */
  contractAddress: string;
}

/**
 * Base fields shared by all fee validation variants
 */
interface TransactionFeeValidationBase {
  transaction: SafeMultisigTransactionResponse;
  proposedFee: bigint;
  contractAddress: string;
}

/**
 * Validation result for a single Safe transaction's fee (discriminated union on `status`)
 */
export type TransactionFeeValidation =
  | (TransactionFeeValidationBase & {
      status: FeeStatus.SUFFICIENT;
      currentFee: bigint;
    })
  | (TransactionFeeValidationBase & {
      status: FeeStatus.STALE;
      currentFee: bigint;
      estimatedBlocks: bigint;
    })
  | (TransactionFeeValidationBase & {
      status: FeeStatus.OVERPAID;
      currentFee: bigint;
      overpaymentAmount: bigint;
    })
  | (TransactionFeeValidationBase & {
      status: FeeStatus.UNVALIDATED;
    });

/**
 * Aggregated fee validation result for all transactions
 */
export interface FeeValidationResult {
  validations: TransactionFeeValidation[];
  hasStale: boolean;
  hasUnvalidated: boolean;
}

/**
 * Action chosen by user after fee validation
 */
export type FeeValidationAction = 'proceed' | 'wait' | 'reject';

/**
 * Non-interactive action for stale fees (used with --yes to select behavior)
 */
export type StaleFeeAction = 'wait' | 'reject';

/**
 * Action chosen during per-transaction fee check in the execution loop
 */
export type ExecutionFeeAction = 'wait' | 'abort';

/**
 * Shared context for all fee validation operations
 */
export interface FeeValidationContext {
  provider: JsonRpcProvider;
  systemContractAddresses: string[];
  overpaymentThreshold: bigint;
}

/**
 * Configuration for validating fees across a batch of Safe transactions
 */
export interface BatchFeeValidationConfig extends FeeValidationContext {
  transactions: SafeMultisigTransactionResponse[];
}

/**
 * Configuration for validating a single Safe transaction's fee against on-chain state
 */
export interface SingleFeeValidationConfig extends FeeValidationContext {
  transaction: SafeMultisigTransactionResponse;
}

/**
 * Configuration for polling until a stale fee becomes sufficient
 */
export interface FeeWaitConfig extends SingleFeeValidationConfig {
  maxFeeWaitBlocks: bigint;
  txIndex: number;
  totalTxs: number;
}

/**
 * Configuration for per-transaction fee checking during sequential Safe execution
 */
export interface PerTransactionFeeCheckConfig extends FeeWaitConfig {
  skipConfirmation?: boolean;
  staleFeeAction?: StaleFeeAction;
}

/**
 * Configuration for executing Safe transactions on-chain
 */
export interface SafeExecuteConfig {
  apiKit: SafeApiKit;
  protocolKit: Safe;
  provider: JsonRpcProvider;
  safeAddress: string;
  signerAddress: string;
  systemContractAddresses: string[];
  multiSendAddress?: string;
  overpaymentThreshold?: bigint;
  skipConfirmation?: boolean;
  staleFeeAction?: StaleFeeAction;
  maxFeeWaitBlocks?: bigint;
}
