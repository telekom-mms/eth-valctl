import type { RequestFeeEstimate } from './ethereum';

/**
 * CLI options for commands targeting specific validators
 */
export interface ValidatorOption {
  validator: string[];
}

/**
 * CLI options for consolidation and switch credential type commands
 */
export interface ConsolidationOptions {
  source: string[];
  target: string;
  skipTargetOwnershipCheck: boolean;
}

/**
 * CLI options for partial withdrawal command
 */
export interface WithdrawOptions extends ValidatorOption {
  amount: number;
}

/**
 * Global CLI options available across all commands
 */
export interface GlobalCliOptions {
  network: string;
  jsonRpcUrl: string;
  beaconApiUrl: string;
  maxRequestsPerBlock: number;
  ledger: boolean;
  safe?: string;
  safeFeeTip?: string;
  maxRequestFee?: bigint;
  maxRequestFeeWaitBlocks?: bigint;
  yes?: boolean;
}

/**
 * CLI options for the read-only fees command.
 */
export interface FeesOptions {
  totalRequestCount: number;
}

/**
 * Fee estimate and display metadata for rendering `fees` command output.
 */
export interface FeeEstimateRenderConfig {
  operation: string;
  network: string;
  estimate: RequestFeeEstimate;
  totalRequestCount: number;
  maxRequestsPerBlock: number;
  contractAddress: string;
}
