/** CLI validation constants */
export const VALID_URL_PREFIXES = ['http://', 'https://'];

/** Request fee calculation constants (EIP-7251) */
export const MIN_CONSOLIDATION_REQUEST_FEE = 1n;

/**
 * Fee update fraction - queue size divided by this value determines fee adjustment (EIP-7251)
 */
export const CONSOLIDATION_REQUEST_FEE_UPDATE_FRACTION = 17n;

/**
 * Inhibitor value indicating system contract not yet activated (EIP-7002/EIP-7251).
 * Before the first system call processes the contract, storage slot 0 contains this value.
 */
export const EXCESS_INHIBITOR = 2n ** 256n - 1n;

/** Request constants */
export const NUMBER_OF_BLOCKS_FOR_LOG_LOOKUP = 50;
export const TRANSACTION_GAS_LIMIT = 200000n;

/**
 * Maximum execution layer requests accepted per block - EIP-7002 and EIP-7251 combined limit
 */
export const MAX_NUMBER_OF_REQUESTS_PER_BLOCK = 50;

/** Transaction retry configuration */
export const MAX_TRANSACTION_RETRIES = 3;
export const TRANSACTION_RETRY_DELAY_MS = 1000;
export const TRANSACTION_RECEIPT_TIMEOUT_MS = 15000;
export const TRANSACTION_RECEIPT_POLL_INTERVAL_MS = 2000;
export const MAX_FETCH_NETWORK_FEES_RETRIES = 5;

/**
 * Fee increase percentage for transaction replacement (112% = 12% increase minimum)
 */
export const TRANSACTION_FEE_INCREASE_PERCENTAGE = 112n;

/** Withdrawal credential types */
export const WITHDRAWAL_CREDENTIALS_0x00 = '0x00';
export const WITHDRAWAL_CREDENTIALS_0x01 = '0x01';
export const WITHDRAWAL_CREDENTIALS_0x02 = '0x02';

/** Beacon API endpoints */
export const VALIDATOR_STATE_BEACON_API_ENDPOINT = '/eth/v1/beacon/states/head/validators/';
export const GENESIS_BEACON_API_ENDPOINT = '/eth/v1/beacon/genesis';

/** Beacon chain timing constants */
export const SECONDS_PER_SLOT = 12;
export const SLOT_BOUNDARY_THRESHOLD = 10;

/**
 * Buffer time in milliseconds after slot boundary to account for network propagation
 */
export const SLOT_BOUNDARY_BUFFER_MS = 500;

/** Validator pubkey constants */
export const VALIDATOR_PUBKEY_HEX_LENGTH = 98;
export const PUBKEY_PATTERN = /^(0x)?[a-fA-F0-9]{96}$/;

/** General */
export const PREFIX_0x = '0x';

/** Time conversion */
export const MS_PER_SECOND = 1000;

/** System contract addresses */
export const CONSOLIDATION_CONTRACT_ADDRESS = '0x0000BBdDc7CE488642fb579F8B00f3a590007251';
export const WITHDRAWAL_CONTRACT_ADDRESS = '0x00000961Ef480Eb55e80D19ad83579A64c007002';

/** Target requests per block by contract type (EIP-7251 / EIP-7002) */
export const CONSOLIDATION_TARGET_PER_BLOCK = 1n;
export const WITHDRAWAL_TARGET_PER_BLOCK = 2n;
export const DEFAULT_FEE_OVERPAYMENT_THRESHOLD = 100n;
export const DEFAULT_SAFE_FEE_TIP = 100n;
export const DEFAULT_MAX_FEE_WAIT_BLOCKS = 50n;
export const FEE_WAIT_POLL_INTERVAL_MS = 12_000;

export const TARGET_PER_BLOCK_BY_CONTRACT: Record<string, bigint> = {
  [CONSOLIDATION_CONTRACT_ADDRESS.toLowerCase()]: CONSOLIDATION_TARGET_PER_BLOCK,
  [WITHDRAWAL_CONTRACT_ADDRESS.toLowerCase()]: WITHDRAWAL_TARGET_PER_BLOCK
};

/** Ledger hardware wallet constants */
export const LEDGER_CONNECTION_TIMEOUT_MS = 5000;
export const LEDGER_ADDRESSES_PER_PAGE = 5;
export const LEDGER_NAV_VALUE_NEXT = 'next';
export const LEDGER_NAV_VALUE_PREV = 'prev';

/** Error codes */
export const REPLACEMENT_UNDERPRICED_ERROR_CODE = 'REPLACEMENT_UNDERPRICED';
export const NONCE_EXPIRED_ERROR_CODE = 'NONCE_EXPIRED';
export const INSUFFICIENT_FUNDS_ERROR_CODE = 'INSUFFICIENT_FUNDS';
export const VIEM_INSUFFICIENT_FUNDS_PATTERN = 'insufficient funds';
export const ECONNREFUSED_ERROR_CODE = 'ECONNREFUSED';
export const CONNECTION_REFUSED_ERROR_CODE = 'ConnectionRefused';
export const CALL_EXCEPTION_ERROR_CODE = 'CALL_EXCEPTION';

/** EIP-1193 error codes */
export const EIP_1193_USER_REJECTED = 4001;
export const EIP_1193_DISCONNECTED = 4900;
export const EIP_1193_INVALID_PARAMS = -32602;
export const EIP_1193_INTERNAL_ERROR = -32603;

/** Ownership label constants */
export const OWNER_LABEL_SIGNER = 'signer';
export const OWNER_LABEL_SAFE = 'Safe';

/** Safe fee validation action values */
export const FEE_ACTION_WAIT = 'wait';
export const FEE_ACTION_REJECT = 'reject';
export const FEE_ACTION_PROCEED = 'proceed';
export const FEE_ACTION_ABORT = 'abort';

/** Safe multisig constants */
export const SAFE_TRANSACTION_SERVICE_NAME = 'Safe Transaction Service';
export const SAFE_API_KEY_ENV = 'SAFE_API_KEY';
export const ETH_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
export const SAFE_ORIGIN = 'eth-valctl';
export const SAFE_DUPLICATE_ERROR_PATTERN = 'already exists';
export const SAFE_UNAUTHORIZED_PATTERN = 'Unauthorized';
export const SAFE_RATE_LIMIT_PATTERNS = ['Too Many Requests', 'Request was throttled'];
export const SAFE_RATE_LIMIT_MAX_RETRIES = 3;
export const SAFE_RATE_LIMIT_DELAY_MS = 2000;

/** MultiSend encoding constants */
export const MULTISEND_SELECTOR = '0x8d80ff0a';
export const MULTISEND_OPERATION_BYTE_LENGTH = 1;
export const MULTISEND_ADDRESS_BYTE_LENGTH = 20;
export const MULTISEND_VALUE_BYTE_LENGTH = 32;
export const MULTISEND_DATA_LENGTH_BYTE_LENGTH = 32;

/**
 * Gas buffer percentage for Ledger-signed Safe transactions (20%).
 *
 * Between gas estimation and on-chain execution, system contract state can change
 * (e.g., consolidation excess shifts after a prior MultiSend lands), requiring
 * more gas than originally estimated.
 */
export const LEDGER_GAS_BUFFER_NUMERATOR = 120n;
export const LEDGER_GAS_BUFFER_DENOMINATOR = 100n;

/** EIP-712 constants */
export const EIP_712_DOMAIN_TYPE = 'EIP712Domain';

/** Ethereum JSON-RPC block tags */
export const PENDING_BLOCK_TAG = 'pending';

/** EIP-1193 RPC method names */
export const EIP_1193_METHOD_ETH_ACCOUNTS = 'eth_accounts';
export const EIP_1193_METHOD_ETH_REQUEST_ACCOUNTS = 'eth_requestAccounts';
export const EIP_1193_METHOD_ETH_SIGN = 'eth_sign';
export const EIP_1193_METHOD_PERSONAL_SIGN = 'personal_sign';
export const EIP_1193_METHOD_ETH_SIGN_TYPED_DATA_V4 = 'eth_signTypedData_v4';
export const EIP_1193_METHOD_ETH_SIGN_TRANSACTION = 'eth_signTransaction';
export const EIP_1193_METHOD_ETH_SEND_TRANSACTION = 'eth_sendTransaction';
