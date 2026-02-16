import { INSUFFICIENT_FUNDS_ERROR_CODE } from '../../../constants/application';

/**
 * Check if an error is an ethers.js INSUFFICIENT_FUNDS error
 *
 * @param error - Error to check
 * @returns True if the error has code INSUFFICIENT_FUNDS
 */
export function isInsufficientFundsError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === INSUFFICIENT_FUNDS_ERROR_CODE
  );
}
