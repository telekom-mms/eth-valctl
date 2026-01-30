import {
  DisconnectedDevice,
  DisconnectedDeviceDuringOperation,
  LockedDeviceError,
  TransportStatusError,
  UserRefusedOnDevice
} from '@ledgerhq/errors';

import * as logging from '../../../constants/logging';

const CONNECTION_TIMEOUT_MESSAGE = 'Connection timeout';

/**
 * Ledger error classification types
 */
export type LedgerErrorType =
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
  recoverable: true
};

const USER_REJECTED_INFO: LedgerErrorInfo = {
  type: 'USER_REJECTED',
  message: logging.LEDGER_USER_REJECTED_ERROR,
  recoverable: true
};

const FATAL_ERROR_TYPES: ReadonlySet<LedgerErrorType> = new Set([
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
    return {
      type: 'CONNECTION_TIMEOUT',
      message: logging.LEDGER_CONNECTION_TIMEOUT_ERROR,
      recoverable: false
    };
  }

  if (error instanceof LockedDeviceError) {
    return {
      type: 'LOCKED_DEVICE',
      message: logging.LEDGER_DEVICE_LOCKED_ERROR,
      recoverable: true
    };
  }

  if (error instanceof DisconnectedDeviceDuringOperation) {
    return DISCONNECTED_DURING_OPERATION_INFO;
  }

  if (error instanceof DisconnectedDevice) {
    if (options?.duringSigning) {
      return DISCONNECTED_DURING_OPERATION_INFO;
    }
    return {
      type: 'DISCONNECTED',
      message: logging.LEDGER_DEVICE_DISCONNECTED_ERROR,
      recoverable: true
    };
  }

  if (error instanceof UserRefusedOnDevice) {
    return USER_REJECTED_INFO;
  }

  if (error instanceof TransportStatusError) {
    return classifyTransportStatusError(error);
  }

  return {
    type: 'UNKNOWN',
    message: logging.LEDGER_CONNECTION_ERROR,
    recoverable: false
  };
}

/**
 * Classify TransportStatusError by APDU status code
 *
 * Maps known status codes to user-friendly error types:
 * - 0x6985: User rejected transaction
 * - 0x6d02, 0x6511: Ethereum app not open
 *
 * @param error - TransportStatusError with status code
 * @returns Classified error info with type and message
 */
function classifyTransportStatusError(error: TransportStatusError): LedgerErrorInfo {
  const code = error.statusCode;

  if (code === 0x6985) {
    return USER_REJECTED_INFO;
  }

  if (code === 0x6d02 || code === 0x6511) {
    return {
      type: 'ETH_APP_NOT_OPEN',
      message: logging.LEDGER_ETH_APP_NOT_OPEN_ERROR,
      recoverable: true
    };
  }

  return {
    type: 'UNKNOWN',
    message: logging.LEDGER_UNKNOWN_ERROR(code),
    recoverable: false
  };
}

/**
 * Check if an error is a known Ledger error type
 *
 * @param error - The error to check
 * @returns True if the error is a known Ledger error
 */
export function isLedgerError(error: unknown): boolean {
  return (
    isConnectionTimeout(error) ||
    error instanceof LockedDeviceError ||
    error instanceof DisconnectedDevice ||
    error instanceof DisconnectedDeviceDuringOperation ||
    error instanceof UserRefusedOnDevice ||
    error instanceof TransportStatusError
  );
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
