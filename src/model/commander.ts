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
}
