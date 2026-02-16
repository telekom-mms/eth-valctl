import { describe, expect, it } from 'bun:test';

import { isInsufficientFundsError } from './error-utils';

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
