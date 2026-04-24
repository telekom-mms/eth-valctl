import { describe, expect, it } from 'bun:test';

import {
  extractErrorSummary,
  extractRevertReason,
  hasErrorCode,
  isCallExceptionError,
  isDuplicateProposal,
  isInsufficientFundsError,
  isNonceExpiredError,
  isRateLimitError,
  isReplacementUnderpricedError,
  isUnauthorizedError,
  isViemInsufficientFundsError
} from './error-utils';

describe('extractErrorSummary', () => {
  it('returns details for viem error with details property', () => {
    const viemError = Object.assign(
      new Error('The total cost (gas * gas fee + value) of executing...'),
      { details: 'insufficient funds for transfer', shortMessage: 'The total cost...' }
    );
    expect(extractErrorSummary(viemError)).toBe('insufficient funds for transfer');
  });

  it('returns shortMessage when details is absent', () => {
    const error = Object.assign(new Error('full message'), {
      shortMessage: 'concise message'
    });
    expect(extractErrorSummary(error)).toBe('concise message');
  });

  it('returns message for standard Error', () => {
    expect(extractErrorSummary(new Error('standard error'))).toBe('standard error');
  });

  it('returns string representation for non-Error', () => {
    expect(extractErrorSummary('string error')).toBe('string error');
  });

  it('returns message for null', () => {
    expect(extractErrorSummary(null)).toBe('null');
  });
});

describe('hasErrorCode', () => {
  it('returns true for object with matching code', () => {
    expect(hasErrorCode({ code: 'SOME_CODE' }, 'SOME_CODE')).toBe(true);
  });

  it('returns false for object with non-matching code', () => {
    expect(hasErrorCode({ code: 'OTHER_CODE' }, 'SOME_CODE')).toBe(false);
  });

  it('returns false for null', () => {
    expect(hasErrorCode(null, 'SOME_CODE')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(hasErrorCode(undefined, 'SOME_CODE')).toBe(false);
  });

  it('returns false for string', () => {
    expect(hasErrorCode('SOME_CODE', 'SOME_CODE')).toBe(false);
  });

  it('returns false for object without code property', () => {
    expect(hasErrorCode({ message: 'error' }, 'SOME_CODE')).toBe(false);
  });
});

describe('isInsufficientFundsError', () => {
  it('returns true for object with INSUFFICIENT_FUNDS code', () => {
    expect(isInsufficientFundsError({ code: 'INSUFFICIENT_FUNDS' })).toBe(true);
  });

  it('returns false for object with different error code', () => {
    expect(isInsufficientFundsError({ code: 'NONCE_EXPIRED' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isInsufficientFundsError(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isInsufficientFundsError(undefined)).toBe(false);
  });

  it('returns false for plain Error', () => {
    expect(isInsufficientFundsError(new Error('insufficient funds'))).toBe(false);
  });

  it('returns false for string', () => {
    expect(isInsufficientFundsError('INSUFFICIENT_FUNDS')).toBe(false);
  });
});

describe('isViemInsufficientFundsError', () => {
  it('returns true for viem ContractFunctionExecutionError with details in message', () => {
    const viemError = new Error(
      'The total cost (gas * gas fee + value) of executing this transaction exceeds the balance of the account.\n\nDetails: insufficient funds for transfer\nVersion: viem@2.47.6'
    );
    expect(isViemInsufficientFundsError(viemError)).toBe(true);
  });

  it('returns true for error with "insufficient funds" in message', () => {
    expect(isViemInsufficientFundsError(new Error('insufficient funds for transfer'))).toBe(true);
  });

  it('returns false for ethers.js structured error without matching message', () => {
    expect(isViemInsufficientFundsError({ code: 'INSUFFICIENT_FUNDS' })).toBe(false);
  });

  it('returns false for unrelated error', () => {
    expect(isViemInsufficientFundsError(new Error('execution reverted'))).toBe(false);
  });

  it('returns false for null', () => {
    expect(isViemInsufficientFundsError(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isViemInsufficientFundsError(undefined)).toBe(false);
  });
});

describe('isNonceExpiredError', () => {
  it('returns true for object with NONCE_EXPIRED code', () => {
    expect(isNonceExpiredError({ code: 'NONCE_EXPIRED' })).toBe(true);
  });

  it('returns false for object with different error code', () => {
    expect(isNonceExpiredError({ code: 'INSUFFICIENT_FUNDS' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isNonceExpiredError(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isNonceExpiredError(undefined)).toBe(false);
  });

  it('returns false for plain Error', () => {
    expect(isNonceExpiredError(new Error('nonce expired'))).toBe(false);
  });

  it('returns false for string', () => {
    expect(isNonceExpiredError('NONCE_EXPIRED')).toBe(false);
  });
});

describe('isReplacementUnderpricedError', () => {
  it('returns true for object with REPLACEMENT_UNDERPRICED code', () => {
    expect(isReplacementUnderpricedError({ code: 'REPLACEMENT_UNDERPRICED' })).toBe(true);
  });

  it('returns false for object with different error code', () => {
    expect(isReplacementUnderpricedError({ code: 'NONCE_EXPIRED' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isReplacementUnderpricedError(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isReplacementUnderpricedError(undefined)).toBe(false);
  });

  it('returns false for plain Error', () => {
    expect(isReplacementUnderpricedError(new Error('replacement underpriced'))).toBe(false);
  });

  it('returns false for string', () => {
    expect(isReplacementUnderpricedError('REPLACEMENT_UNDERPRICED')).toBe(false);
  });
});

describe('isUnauthorizedError', () => {
  it('returns true for Error with "Unauthorized" in message', () => {
    expect(isUnauthorizedError(new Error('Unauthorized'))).toBe(true);
  });

  it('returns true for Error with "Unauthorized" embedded in longer message', () => {
    expect(isUnauthorizedError(new Error('HTTP 401 Unauthorized response'))).toBe(true);
  });

  it('returns false for unrelated Error', () => {
    expect(isUnauthorizedError(new Error('Too Many Requests'))).toBe(false);
  });

  it('returns false for null', () => {
    expect(isUnauthorizedError(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isUnauthorizedError(undefined)).toBe(false);
  });
});

describe('isRateLimitError', () => {
  it('returns true for Error with "Too Many Requests"', () => {
    expect(isRateLimitError(new Error('Too Many Requests'))).toBe(true);
  });

  it('returns true for Error with "Request was throttled"', () => {
    expect(
      isRateLimitError(new Error('Request was throttled. Expected available in 2 seconds.'))
    ).toBe(true);
  });

  it('returns false for unrelated Error', () => {
    expect(isRateLimitError(new Error('Internal Server Error'))).toBe(false);
  });

  it('returns false for null', () => {
    expect(isRateLimitError(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isRateLimitError(undefined)).toBe(false);
  });
});

describe('isCallExceptionError', () => {
  it('returns true for object with CALL_EXCEPTION code', () => {
    expect(isCallExceptionError({ code: 'CALL_EXCEPTION' })).toBe(true);
  });

  it('returns false for object with different error code', () => {
    expect(isCallExceptionError({ code: 'INSUFFICIENT_FUNDS' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isCallExceptionError(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isCallExceptionError(undefined)).toBe(false);
  });

  it('returns false for plain Error', () => {
    expect(isCallExceptionError(new Error('call exception'))).toBe(false);
  });

  it('returns false for string', () => {
    expect(isCallExceptionError('CALL_EXCEPTION')).toBe(false);
  });
});

describe('extractRevertReason', () => {
  it('returns reason from CALL_EXCEPTION error', () => {
    const error = Object.assign(new Error('execution reverted'), {
      code: 'CALL_EXCEPTION',
      reason: 'GS013'
    });
    expect(extractRevertReason(error)).toBe('GS013');
  });

  it('returns undefined when CALL_EXCEPTION has no reason', () => {
    const error = Object.assign(new Error('execution reverted'), {
      code: 'CALL_EXCEPTION'
    });
    expect(extractRevertReason(error)).toBeUndefined();
  });

  it('returns undefined when CALL_EXCEPTION has null reason', () => {
    const error = Object.assign(new Error('execution reverted'), {
      code: 'CALL_EXCEPTION',
      reason: null
    });
    expect(extractRevertReason(error)).toBeUndefined();
  });

  it('returns undefined for non-CALL_EXCEPTION error', () => {
    const error = Object.assign(new Error('other error'), {
      code: 'INSUFFICIENT_FUNDS',
      reason: 'GS013'
    });
    expect(extractRevertReason(error)).toBeUndefined();
  });

  it('returns undefined for plain Error', () => {
    expect(extractRevertReason(new Error('some error'))).toBeUndefined();
  });

  it('returns undefined for null', () => {
    expect(extractRevertReason(null)).toBeUndefined();
  });
});

describe('isDuplicateProposal', () => {
  it('returns true for Error with "already exists" in message', () => {
    expect(isDuplicateProposal(new Error('Transaction with safe-tx-hash already exists'))).toBe(
      true
    );
  });

  it('returns false for unrelated Error', () => {
    expect(isDuplicateProposal(new Error('Internal Server Error'))).toBe(false);
  });

  it('returns false for null', () => {
    expect(isDuplicateProposal(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isDuplicateProposal(undefined)).toBe(false);
  });
});
