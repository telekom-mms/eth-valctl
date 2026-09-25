import { LEDGER_ERROR_NAMES } from '../../../constants/application';
import * as logging from '../../../constants/logging';

const CONNECTION_TIMEOUT_MESSAGE = 'Connection timeout';

const APDU_USER_REJECTED = 0x6985;
const APDU_ETH_APP_NOT_OPEN_1 = 0x6d02;
const APDU_ETH_APP_NOT_OPEN_2 = 0x6511;

/**
 * Ledger error classification types
 */
export type LedgerErrorType =
  | 'BLIND_SIGNING_REQUIRED'
  | 'CONNECTION_TIMEOUT'
  | 'LOCKED_DEVICE'
  | 'DISCONNECTED'
  | 'DISCONNECTED_DURING_OPERATION'
  | 'USER_REJECTED'
  | 'ETH_APP_NOT_OPEN'
  | 'UNKNOWN';

/**
 * Classified Ledger error information
 */
export interface LedgerErrorInfo {
  type: LedgerErrorType;
  message: string;
  recoverable: boolean;
}

/**
 * Options for error classification
 */
export interface ClassifyLedgerErrorOptions {
  duringSigning?: boolean;
}

const DISCONNECTED_DURING_OPERATION_INFO: LedgerErrorInfo = {
  type: 'DISCONNECTED_DURING_OPERATION',
  message: logging.LEDGER_DEVICE_DISCONNECTED_DURING_OPERATION_ERROR,
  recoverable: false
};

const USER_REJECTED_INFO: LedgerErrorInfo = {
  type: 'USER_REJECTED',
  message: logging.LEDGER_USER_REJECTED_ERROR,
  recoverable: true
};

const CONNECTION_TIMEOUT_INFO: LedgerErrorInfo = {
  type: 'CONNECTION_TIMEOUT',
  message: logging.LEDGER_CONNECTION_TIMEOUT_ERROR,
  recoverable: false
};

const LOCKED_DEVICE_INFO: LedgerErrorInfo = {
  type: 'LOCKED_DEVICE',
  message: logging.LEDGER_DEVICE_LOCKED_ERROR,
  recoverable: true
};

const DISCONNECTED_INFO: LedgerErrorInfo = {
  type: 'DISCONNECTED',
  message: logging.LEDGER_DEVICE_DISCONNECTED_ERROR,
  recoverable: false
};

const BLIND_SIGNING_REQUIRED_INFO: LedgerErrorInfo = {
  type: 'BLIND_SIGNING_REQUIRED',
  message: logging.LEDGER_BLIND_SIGNING_REQUIRED_ERROR,
  recoverable: false
};

const ETH_APP_NOT_OPEN_INFO: LedgerErrorInfo = {
  type: 'ETH_APP_NOT_OPEN',
  message: logging.LEDGER_ETH_APP_NOT_OPEN_ERROR,
  recoverable: true
};

// Generic fallback for unrecognized errors (no runtime context available).
// classifyTransportStatusError() uses a dynamic message with the APDU status code instead.
const UNKNOWN_ERROR_INFO: LedgerErrorInfo = {
  type: 'UNKNOWN',
  message: logging.LEDGER_CONNECTION_ERROR,
  recoverable: false
};

const FATAL_ERROR_TYPES: ReadonlySet<LedgerErrorType> = new Set([
  'BLIND_SIGNING_REQUIRED',
  'DISCONNECTED',
  'DISCONNECTED_DURING_OPERATION',
  'CONNECTION_TIMEOUT'
]);

/**
 * Check if error is a connection timeout from Promise.race
 *
 * @param error - Error to check
 * @returns True if error message matches timeout sentinel
 */
function isConnectionTimeout(error: unknown): boolean {
  return error instanceof Error && error.message === CONNECTION_TIMEOUT_MESSAGE;
}

/**
 * Match Ledger errors across different installed versions of the errors package.
 *
 * @param error - Error to check
 * @param name - Ledger error name
 * @returns True when the error has the requested name
 */
function hasErrorName(error: unknown, name: string): error is Error {
  return error instanceof Error && error.name === name;
}

/**
 * Check if error is a Ledger blind signing requirement
 *
 * @param error - Error to check
 * @returns True if the error indicates blind signing is not enabled
 */
function isBlindSigningError(error: unknown): boolean {
  return hasErrorName(error, LEDGER_ERROR_NAMES.BLIND_SIGNING);
}

/**
 * Check that a transport status error has the numeric APDU code needed for classification.
 *
 * @param error - Error to check
 * @returns True when the error has a transport status code
 */
function isTransportStatusError(error: unknown): error is Error & { statusCode: number } {
  return (
    hasErrorName(error, LEDGER_ERROR_NAMES.TRANSPORT_STATUS) &&
    'statusCode' in error &&
    typeof error.statusCode === 'number'
  );
}

/**
 * Classify a Ledger error and return user-friendly information
 *
 * @param error - The error to classify
 * @param options - Optional classification options
 * @returns Classified error information with type, message, and recoverability
 */
export function classifyLedgerError(
  error: unknown,
  options?: ClassifyLedgerErrorOptions
): LedgerErrorInfo {
  if (isConnectionTimeout(error)) {
    return CONNECTION_TIMEOUT_INFO;
  }

  if (hasErrorName(error, LEDGER_ERROR_NAMES.LOCKED_DEVICE)) {
    return LOCKED_DEVICE_INFO;
  }

  if (hasErrorName(error, LEDGER_ERROR_NAMES.DISCONNECTED_DURING_OPERATION)) {
    return DISCONNECTED_DURING_OPERATION_INFO;
  }

  if (hasErrorName(error, LEDGER_ERROR_NAMES.DISCONNECTED)) {
    if (options?.duringSigning) {
      return DISCONNECTED_DURING_OPERATION_INFO;
    }
    return DISCONNECTED_INFO;
  }

  if (hasErrorName(error, LEDGER_ERROR_NAMES.USER_REFUSED)) {
    return USER_REJECTED_INFO;
  }

  if (isBlindSigningError(error)) {
    return BLIND_SIGNING_REQUIRED_INFO;
  }

  if (isTransportStatusError(error)) {
    return classifyTransportStatusError(error.statusCode);
  }

  return UNKNOWN_ERROR_INFO;
}

/**
 * Classify TransportStatusError by APDU status code
 *
 * Maps known status codes to user-friendly error types:
 * - 0x6985: User rejected transaction
 * - 0x6d02, 0x6511: Ethereum app not open
 *
 * Note: 0x6a80 is remapped upstream by `@ledgerhq/hw-app-eth` to
 * `EthAppPleaseEnableContractData` and handled in `classifyLedgerError()` directly.
 *
 * @param code - APDU status code
 * @returns Classified error info with type and message
 */
function classifyTransportStatusError(code: number): LedgerErrorInfo {
  if (code === APDU_USER_REJECTED) {
    return USER_REJECTED_INFO;
  }

  if (code === APDU_ETH_APP_NOT_OPEN_1 || code === APDU_ETH_APP_NOT_OPEN_2) {
    return ETH_APP_NOT_OPEN_INFO;
  }

  // Inline: dynamic message includes the APDU status code for debugging
  return {
    type: 'UNKNOWN',
    message: logging.LEDGER_UNKNOWN_ERROR(code),
    recoverable: false
  };
}

/**
 * Check if an error is a known Ledger error type
 *
 * Ledger errors are logged with user-friendly messages at the point of origin
 * (LedgerSigner via TransactionProgressLogger). Downstream error handlers use
 * this guard to suppress duplicate logging: if `isLedgerError(error)` returns
 * true, the error has already been reported and should not be logged again.
 *
 * @param error - The error to check
 * @returns True if the error is a known Ledger error (already logged at source)
 */
export function isLedgerError(error: unknown): boolean {
  return classifyLedgerError(error).type !== 'UNKNOWN' || isTransportStatusError(error);
}

/**
 * Check if a Ledger error is fatal (should abort batch processing)
 *
 * Fatal errors indicate device is no longer available and further
 * transaction attempts would fail immediately.
 *
 * @param error - The error to check
 * @returns True if the error should abort batch processing
 */
export function isFatalLedgerError(error: unknown): boolean {
  if (!isLedgerError(error)) return false;
  return FATAL_ERROR_TYPES.has(classifyLedgerError(error).type);
}

/**
 * Check if a Ledger error is a user rejection (refused on device)
 *
 * User rejections are intentional and should not be retried or treated
 * as failures. They indicate the user chose not to sign a transaction.
 * Unlike fatal errors ({@link isFatalLedgerError}), a rejection does NOT
 * abort the batch — remaining transactions continue to be offered for signing.
 *
 * @param error - The error to check
 * @returns True if the error represents a user rejection on the Ledger device
 */
export function isUserRejectedError(error: unknown): boolean {
  if (!isLedgerError(error)) return false;
  return classifyLedgerError(error).type === 'USER_REJECTED';
}
