/**
 * Response types matching SafeApiKit expectations from @safe-global/types-kit
 *
 * Field names and types must match exactly what SafeApiKit parses.
 * Numeric values that can be large are represented as strings.
 */

export interface ServiceInfoResponse {
  readonly name: string;
  readonly version: string;
  readonly api_version: string;
  readonly secure: boolean;
  readonly settings: {
    readonly AWS_CONFIGURED: boolean;
    readonly AWS_S3_CUSTOM_DOMAIN: string;
    readonly ETHEREUM_NODE_URL: string;
    readonly ETHEREUM_TRACING_NODE_URL: string;
    readonly ETH_INTERNAL_TXS_BLOCK_PROCESS_LIMIT: number;
    readonly ETH_INTERNAL_NO_FILTER: boolean;
    readonly ETH_REORG_BLOCKS: number;
    readonly TOKENS_LOGO_BASE_URI: string;
    readonly TOKENS_LOGO_EXTENSION: string;
  };
}

export interface SafeInfoRecord {
  address: string;
  nonce: string;
  threshold: number;
  owners: string[];
  singleton: string;
  modules: string[];
  fallbackHandler: string;
  guard: string;
  version: string;
}

export interface ConfirmationRecord {
  owner: string;
  submissionDate: string;
  signature: string;
  signatureType: string;
}

export interface TransactionRecord {
  safe: string;
  to: string;
  value: string;
  data: string | null;
  operation: number;
  gasToken: string;
  safeTxGas: string;
  baseGas: string;
  gasPrice: string;
  refundReceiver: string;
  nonce: string;
  safeTxHash: string;
  submissionDate: string;
  modified: string;
  origin: string;
  confirmationsRequired: number;
  confirmations: ConfirmationRecord[];
  isExecuted: boolean;
  isSuccessful: boolean | null;
  executionDate: string | null;
  blockNumber: number | null;
  transactionHash: string | null;
  executor: string | null;
  proposer: string | null;
  trusted: boolean;
  signatures: string | null;
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/**
 * Proposal body as sent by SafeApiKit's proposeTransaction()
 */
export interface ProposeTransactionBody {
  to: string;
  value: string;
  data: string;
  operation: number;
  gasToken: string;
  safeTxGas: string;
  baseGas: string;
  gasPrice: string;
  refundReceiver: string;
  nonce: number;
  contractTransactionHash: string;
  sender: string;
  signature: string;
  origin?: string;
}

export interface ConfirmTransactionBody {
  signature: string;
}
