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
 * Maximum execution layer requests per block - EIP-7002 and EIP-7251 combined limit
 */
export const MAX_NUMBER_OF_REQUESTS_PER_BLOCK = 220;

/** Transaction retry configuration */
export const MAX_TRANSACTION_RETRIES = 3;
export const TRANSACTION_RETRY_DELAY_MS = 1000;
export const MAX_FETCH_NETWORK_FEES_RETRIES = 5;

/**
 * Fee increase percentage for transaction replacement (112% = 12% increase minimum)
 */
export const TRANSACTION_FEE_INCREASE_PERCENTAGE = 112n;

/** Withdrawal credential types */
export const WITHDRAWAL_CREDENTIALS_0x00 = '0x00';
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

/** General */
export const PREFIX_0x = '0x';

/** Time conversion */
export const MS_PER_SECOND = 1000;

/** System contract addresses */
export const CONSOLIDATION_CONTRACT_ADDRESS = '0x0000BBdDc7CE488642fb579F8B00f3a590007251';
export const WITHDRAWAL_CONTRACT_ADDRESS = '0x00000961Ef480Eb55e80D19ad83579A64c007002';

/** Ledger hardware wallet constants */
export const LEDGER_CONNECTION_TIMEOUT_MS = 5000;
export const LEDGER_ADDRESSES_PER_PAGE = 5;

/** Error codes */
export const REPLACEMENT_UNDERPRICED_ERROR_CODE = 'REPLACEMENT_UNDERPRICED';
export const NONCE_EXPIRED_ERROR_CODE = 'NONCE_EXPIRED';
export const INSUFFICIENT_FUNDS_ERROR_CODE = 'INSUFFICIENT_FUNDS';
