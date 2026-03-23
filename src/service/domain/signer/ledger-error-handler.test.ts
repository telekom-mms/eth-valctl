import {
  DisconnectedDevice,
  DisconnectedDeviceDuringOperation,
  LockedDeviceError,
  TransportStatusError,
  UserRefusedOnDevice
} from '@ledgerhq/errors';
import { describe, expect, it } from 'bun:test';

import {
  classifyLedgerError,
  isFatalLedgerError,
  isLedgerError,
  isUserRejectedError
} from './ledger-error-handler';

function createBlindSigningError(): Error {
  return Object.assign(new Error('blind signing'), {
    name: 'EthAppPleaseEnableContractData'
  });
}

describe('classifyLedgerError', () => {
  it('classifies connection timeout as non-recoverable', () => {
    const error = new Error('Connection timeout');
    const result = classifyLedgerError(error);

    expect(result.type).toBe('CONNECTION_TIMEOUT');
    expect(result.recoverable).toBe(false);
  });

  it('classifies locked device as recoverable', () => {
    const error = new LockedDeviceError();
    const result = classifyLedgerError(error);

    expect(result.type).toBe('LOCKED_DEVICE');
    expect(result.recoverable).toBe(true);
  });

  it('classifies disconnected device during operation as non-recoverable', () => {
    const error = new DisconnectedDeviceDuringOperation();
    const result = classifyLedgerError(error);

    expect(result.type).toBe('DISCONNECTED_DURING_OPERATION');
    expect(result.recoverable).toBe(false);
  });

  it('classifies disconnected device as non-recoverable', () => {
    const error = new DisconnectedDevice();
    const result = classifyLedgerError(error);

    expect(result.type).toBe('DISCONNECTED');
    expect(result.recoverable).toBe(false);
  });

  it('classifies disconnected device as DISCONNECTED_DURING_OPERATION when duringSigning', () => {
    const error = new DisconnectedDevice();
    const result = classifyLedgerError(error, { duringSigning: true });

    expect(result.type).toBe('DISCONNECTED_DURING_OPERATION');
  });

  it('classifies user rejection as recoverable', () => {
    const error = new UserRefusedOnDevice();
    const result = classifyLedgerError(error);

    expect(result.type).toBe('USER_REJECTED');
    expect(result.recoverable).toBe(true);
  });

  it('classifies blind signing error as BLIND_SIGNING_REQUIRED', () => {
    const error = createBlindSigningError();
    const result = classifyLedgerError(error);

    expect(result.type).toBe('BLIND_SIGNING_REQUIRED');
    expect(result.recoverable).toBe(false);
  });

  it('classifies ETH app not open for TransportStatusError 0x6d02', () => {
    const error = new TransportStatusError(0x6d02);
    const result = classifyLedgerError(error);

    expect(result.type).toBe('ETH_APP_NOT_OPEN');
    expect(result.recoverable).toBe(true);
  });

  it('classifies ETH app not open for TransportStatusError 0x6511', () => {
    const error = new TransportStatusError(0x6511);
    const result = classifyLedgerError(error);

    expect(result.type).toBe('ETH_APP_NOT_OPEN');
    expect(result.recoverable).toBe(true);
  });

  it('classifies unknown TransportStatusError with status code in message', () => {
    const error = new TransportStatusError(0xffff);
    const result = classifyLedgerError(error);

    expect(result.type).toBe('UNKNOWN');
    expect(result.recoverable).toBe(false);
    expect(result.message).toContain('0xffff');
  });

  it('classifies unknown error as non-recoverable', () => {
    const error = new Error('something unexpected');
    const result = classifyLedgerError(error);

    expect(result.type).toBe('UNKNOWN');
    expect(result.recoverable).toBe(false);
  });
});

describe('isUserRejectedError', () => {
  it('returns true for UserRefusedOnDevice', () => {
    const error = new UserRefusedOnDevice();

    expect(isUserRejectedError(error)).toBe(true);
  });

  it('returns true for TransportStatusError 0x6985', () => {
    const error = new TransportStatusError(0x6985);

    expect(isUserRejectedError(error)).toBe(true);
  });

  it('returns false for non-Ledger errors', () => {
    expect(isUserRejectedError(new Error('some error'))).toBe(false);
  });

  it('returns false for non-error values', () => {
    expect(isUserRejectedError(null)).toBe(false);
    expect(isUserRejectedError(undefined)).toBe(false);
    expect(isUserRejectedError('string')).toBe(false);
  });

  it('returns false for other TransportStatusError codes', () => {
    const error = new TransportStatusError(0x6d02);

    expect(isUserRejectedError(error)).toBe(false);
  });

  it('returns false for fatal Ledger errors', () => {
    const error = new Error('Connection timeout');

    expect(isUserRejectedError(error)).toBe(false);
  });

  it('returns false for blind signing errors', () => {
    const error = createBlindSigningError();

    expect(isUserRejectedError(error)).toBe(false);
  });
});

describe('isLedgerError', () => {
  it('returns true for blind signing errors', () => {
    const error = createBlindSigningError();

    expect(isLedgerError(error)).toBe(true);
  });
});

describe('isFatalLedgerError', () => {
  it('returns false for UserRefusedOnDevice', () => {
    const error = new UserRefusedOnDevice();

    expect(isFatalLedgerError(error)).toBe(false);
  });

  it('returns false for TransportStatusError 0x6985', () => {
    const error = new TransportStatusError(0x6985);

    expect(isFatalLedgerError(error)).toBe(false);
  });

  it('returns true for blind signing errors', () => {
    const error = createBlindSigningError();

    expect(isFatalLedgerError(error)).toBe(true);
  });
});
