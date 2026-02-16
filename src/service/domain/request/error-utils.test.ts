import { describe, expect, it } from 'bun:test';

import {
  hasErrorCode,
  isInsufficientFundsError,
  isNonceExpiredError,
  isReplacementUnderpricedError
} from './error-utils';

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
