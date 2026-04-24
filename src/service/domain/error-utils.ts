import * as application from '../../constants/application';

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
  return hasErrorCode(error, application.INSUFFICIENT_FUNDS_ERROR_CODE);
}

/**
 * Check if an error is a viem InsufficientFundsError (message-based detection)
 *
 * viem errors include "insufficient funds" in the error message text,
 * unlike ethers.js which uses structured error codes.
 *
 * @param error - Error to check
 * @returns True if the error message contains the viem insufficient funds pattern
 */
export function isViemInsufficientFundsError(error: unknown): boolean {
  return errorMessageContains(error, application.VIEM_INSUFFICIENT_FUNDS_PATTERN);
}

/**
 * Check if an error is an ethers.js NONCE_EXPIRED error
 *
 * @param error - Error to check
 * @returns True if the error has code NONCE_EXPIRED
 */
export function isNonceExpiredError(error: unknown): boolean {
  return hasErrorCode(error, application.NONCE_EXPIRED_ERROR_CODE);
}

/**
 * Check if an error is an ethers.js REPLACEMENT_UNDERPRICED error
 *
 * @param error - Error to check
 * @returns True if the error has code REPLACEMENT_UNDERPRICED
 */
export function isReplacementUnderpricedError(error: unknown): boolean {
  return hasErrorCode(error, application.REPLACEMENT_UNDERPRICED_ERROR_CODE);
}

/**
 * Check if an error matches the Safe API 401 Unauthorized pattern
 *
 * @param error - Error to check
 * @returns True if the error indicates an unauthorized API key
 */
export function isUnauthorizedError(error: unknown): boolean {
  return errorMessageContains(error, application.SAFE_UNAUTHORIZED_PATTERN);
}

/**
 * Check if an error matches any Safe API 429 rate limit pattern
 *
 * @param error - Error to check
 * @returns True if the error indicates a rate limit
 */
export function isRateLimitError(error: unknown): boolean {
  return application.SAFE_RATE_LIMIT_PATTERNS.some((pattern) =>
    errorMessageContains(error, pattern)
  );
}

/**
 * Check if an error indicates a duplicate proposal
 *
 * @param error - Error from proposeTransaction call
 * @returns True if the error indicates the proposal already exists
 */
export function isDuplicateProposal(error: unknown): boolean {
  return errorMessageContains(error, application.SAFE_DUPLICATE_ERROR_PATTERN);
}

/**
 * Check if an error is an ethers.js CALL_EXCEPTION error
 *
 * @param error - Error to check
 * @returns True if the error has code CALL_EXCEPTION
 */
export function isCallExceptionError(error: unknown): boolean {
  return hasErrorCode(error, application.CALL_EXCEPTION_ERROR_CODE);
}

/**
 * Extract revert reason from an ethers.js CALL_EXCEPTION error
 *
 * ethers.js v6 CALL_EXCEPTION errors include a `reason` property with
 * the decoded revert string (e.g., "GS013") from Solidity `require` statements.
 *
 * @param error - Error to extract reason from
 * @returns Decoded revert reason string, or undefined if not available
 */
export function extractRevertReason(error: unknown): string | undefined {
  if (!isCallExceptionError(error)) return undefined;
  if (typeof error === 'object' && error !== null && 'reason' in error) {
    const { reason } = error as { reason: unknown };
    if (typeof reason === 'string') return reason;
  }
  return undefined;
}

/**
 * Extract a concise error summary from an error
 *
 * Prefers viem's `details` or `shortMessage` properties over the full
 * `message` which includes verbose multi-line output with hex data.
 *
 * @param error - Error to extract summary from
 * @returns Concise error description
 */
export function extractErrorSummary(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    if ('details' in error && typeof error.details === 'string') {
      return error.details;
    }
    if ('shortMessage' in error && typeof error.shortMessage === 'string') {
      return error.shortMessage;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Check if an error message contains a specific pattern
 *
 * Unlike `hasErrorCode` which checks structured error codes (ethers.js),
 * this checks the error message text for SDK errors that use plain strings.
 *
 * @param error - Error to check
 * @param pattern - Substring to search for in the error message
 * @returns True if the error message contains the pattern
 */
function errorMessageContains(error: unknown, pattern: string): boolean {
  if (error instanceof Error) {
    return error.message.includes(pattern);
  }
  return String(error).includes(pattern);
}
