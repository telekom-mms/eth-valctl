import {
  INSUFFICIENT_FUNDS_ERROR_CODE,
  NONCE_EXPIRED_ERROR_CODE,
  REPLACEMENT_UNDERPRICED_ERROR_CODE
} from '../../../constants/application';

/**
 * Check if an error has a specific ethers.js error code
 *
 * @param error - Error to check
 * @param code - Error code to match
 * @returns True if the error has the specified code
 */
export function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

/**
 * Check if an error is an ethers.js INSUFFICIENT_FUNDS error
 *
 * @param error - Error to check
 * @returns True if the error has code INSUFFICIENT_FUNDS
 */
export function isInsufficientFundsError(error: unknown): boolean {
  return hasErrorCode(error, INSUFFICIENT_FUNDS_ERROR_CODE);
}

/**
 * Check if an error is an ethers.js NONCE_EXPIRED error
 *
 * @param error - Error to check
 * @returns True if the error has code NONCE_EXPIRED
 */
export function isNonceExpiredError(error: unknown): boolean {
  return hasErrorCode(error, NONCE_EXPIRED_ERROR_CODE);
}

/**
 * Check if an error is an ethers.js REPLACEMENT_UNDERPRICED error
 *
 * @param error - Error to check
 * @returns True if the error has code REPLACEMENT_UNDERPRICED
 */
export function isReplacementUnderpricedError(error: unknown): boolean {
  return hasErrorCode(error, REPLACEMENT_UNDERPRICED_ERROR_CODE);
}
