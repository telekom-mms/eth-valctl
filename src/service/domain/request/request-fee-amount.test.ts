import { describe, expect, it } from 'bun:test';

import * as application from '../../../constants/application';
import * as logging from '../../../constants/logging';
import { parseRequestFeeAmount, toEthersRequestFeeUnit } from './request-fee-amount';

describe('parseRequestFeeAmount', () => {
  it('parses wei amounts', () => {
    expect(parseRequestFeeAmount('42wei')).toBe(42n);
  });

  it('parses gwei amounts', () => {
    expect(parseRequestFeeAmount('1.5gwei')).toBe(1_500_000_000n);
  });

  it('parses eth amounts using the ethers ether unit', () => {
    expect(parseRequestFeeAmount('0.000000001eth')).toBe(1_000_000_000n);
  });

  it('parses amounts with whitespace and mixed-case units', () => {
    expect(parseRequestFeeAmount('2 GWEI')).toBe(2_000_000_000n);
  });

  it('rejects values without an explicit request fee unit', () => {
    expect(() => parseRequestFeeAmount('1000')).toThrow(
      logging.INVALID_MAX_REQUEST_FEE_FORMAT_ERROR
    );
  });

  it('rejects malformed amounts with the shared validation message', () => {
    expect(() => parseRequestFeeAmount('-1wei')).toThrow(
      logging.INVALID_MAX_REQUEST_FEE_FORMAT_ERROR
    );
  });

  it('rejects values below wei precision', () => {
    expect(() => parseRequestFeeAmount('1.0000000001gwei')).toThrow(
      logging.REQUEST_FEE_PRECISION_ERROR('1.0000000001', application.GWEI_UNIT)
    );
  });
});

describe('toEthersRequestFeeUnit', () => {
  it('maps CLI eth input to the ethers ether unit', () => {
    expect(toEthersRequestFeeUnit(application.ETH_UNIT)).toBe(application.ETHER_UNIT);
  });

  it('passes wei and gwei units through unchanged', () => {
    expect(toEthersRequestFeeUnit(application.WEI_UNIT)).toBe(application.WEI_UNIT);
    expect(toEthersRequestFeeUnit(application.GWEI_UNIT)).toBe(application.GWEI_UNIT);
  });
});
