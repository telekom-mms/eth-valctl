import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

import {
  OWNER_LABEL_SAFE,
  OWNER_LABEL_SIGNER,
  WITHDRAWAL_CREDENTIALS_0x00,
  WITHDRAWAL_CREDENTIALS_0x01,
  WITHDRAWAL_CREDENTIALS_0x02
} from '../../constants/application';
import {
  BEACON_API_ERROR,
  GENERAL_WRONG_WITHDRAWAL_CREDENTIALS_ERROR,
  SWITCH_SOURCE_VALIDATOR_0x00_CREDENTIALS_ERROR,
  SWITCH_SOURCE_VALIDATOR_ALREADY_0x02_WARNING,
  UNEXPECTED_BEACON_API_ERROR,
  WITHDRAWAL_ADDRESS_MISMATCH_ERROR,
  WITHDRAWAL_ADDRESS_OWNERSHIP_HEADER,
  WITHDRAWAL_ADDRESS_TARGET_MISMATCH_HINT,
  WRONG_WITHDRAWAL_CREDENTIALS_0x00_ERROR,
  WRONG_WITHDRAWAL_CREDENTIALS_0X01_ERROR
} from '../../constants/logging';

const OWNER_ADDRESS = '0xaabbccddeeff00112233445566778899aabbccdd';
const OWNER_ADDRESS_MIXED_CASE = '0xAabbCCddEEff00112233445566778899aabBccDd';
const OTHER_ADDRESS = '0x1111111111111111111111111111111111111111';
const BEACON_URL = 'http://localhost:5052';

const PUBKEY_A = `0x${'a'.repeat(96)}`;
const PUBKEY_B = `0x${'b'.repeat(96)}`;
const PUBKEY_C = `0x${'c'.repeat(96)}`;

/**
 * Build a full withdrawal credentials hex string (32 bytes) for a given prefix and address.
 *
 * Format: `<prefix (1 byte)><padding (11 bytes zeros)><address (20 bytes)>`.
 *
 * @param prefix - The credentials type prefix (e.g. '0x00', '0x01', '0x02')
 * @param address - The embedded Ethereum address (0x-prefixed, 20 bytes)
 * @returns 32-byte withdrawal credentials hex string
 */
function buildCredentials(prefix: string, address: string = OTHER_ADDRESS): string {
  const prefixByte = prefix.slice(2);
  const addressBytes = address.slice(2).toLowerCase();
  const padding = '00'.repeat(11);
  return `0x${prefixByte}${padding}${addressBytes}`;
}

/**
 * Build a mocked Beacon API response for the validator endpoint.
 *
 * @param credentials - The full withdrawal credentials hex string
 * @param options - Optional overrides for the response status
 * @returns A minimal object matching the shape the source expects from `undici` fetch
 */
function buildFetchResponse(
  credentials: string,
  options: { ok?: boolean; status?: number; statusText?: string; text?: string } = {}
) {
  const { ok = true, status = 200, statusText = 'OK', text = 'error body' } = options;
  return {
    ok,
    status,
    statusText,
    json: () => Promise.resolve({ data: { validator: { withdrawal_credentials: credentials } } }),
    text: () => Promise.resolve(text)
  };
}

const mockFetch = mock(() => Promise.resolve(buildFetchResponse(buildCredentials('0x01'))));

mock.module('undici', () => ({
  fetch: mockFetch
}));

const REAL_PRE_REQUEST_VALIDATION_SPECIFIER = './pre-request-validation?real';
const {
  checkCompoundingCredentials,
  checkHasExecutionCredentials,
  checkWithdrawalAddressOwnership,
  filterSwitchableValidators
} = (await import(
  REAL_PRE_REQUEST_VALIDATION_SPECIFIER
)) as typeof import('./pre-request-validation');

// eslint-disable-next-line no-control-regex -- Matches ANSI escape sequences emitted by chalk
const ANSI_ESCAPE_PATTERN = /\u001B\[[0-9;]*m/g;

/**
 * Collect all console.error calls from a spy, join them with newlines, and strip
 * ANSI color codes so assertions can match raw message constants.
 *
 * Chalk wraps each line of a multi-line string in a fresh ANSI code pair, which
 * would otherwise break substring matches across line boundaries.
 *
 * @param spy - The spyOn handle over console.error
 * @returns Concatenated stderr output with ANSI codes removed
 */
function collectStderr(spy: ReturnType<typeof spyOn>): string {
  return spy.mock.calls.flat().join('\n').replace(ANSI_ESCAPE_PATTERN, '');
}

describe('pre-request-validation', () => {
  let stderrSpy: ReturnType<typeof spyOn>;
  let stdoutSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    mockFetch.mockReset();
    exitSpy = spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    stderrSpy = spyOn(console, 'error').mockImplementation(() => {});
    stdoutSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  describe('checkCompoundingCredentials', () => {
    it('passes when every validator has 0x02 credentials', async () => {
      mockFetch
        .mockResolvedValueOnce(buildFetchResponse(buildCredentials(WITHDRAWAL_CREDENTIALS_0x02)))
        .mockResolvedValueOnce(buildFetchResponse(buildCredentials(WITHDRAWAL_CREDENTIALS_0x02)));

      await checkCompoundingCredentials(BEACON_URL, [PUBKEY_A, PUBKEY_B]);

      expect(exitSpy).not.toHaveBeenCalled();
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('exits with paired 0x00 error constants when a validator has 0x00 credentials', async () => {
      mockFetch.mockResolvedValueOnce(
        buildFetchResponse(buildCredentials(WITHDRAWAL_CREDENTIALS_0x00))
      );

      await checkCompoundingCredentials(BEACON_URL, [PUBKEY_A]);

      expect(exitSpy).toHaveBeenCalledWith(1);
      const stderrOutput = collectStderr(stderrSpy);
      expect(stderrOutput).toContain(
        GENERAL_WRONG_WITHDRAWAL_CREDENTIALS_ERROR(WITHDRAWAL_CREDENTIALS_0x00)
      );
      expect(stderrOutput).toContain(WRONG_WITHDRAWAL_CREDENTIALS_0x00_ERROR);
    });

    it('exits with the 0x01 error constant when a validator has 0x01 credentials', async () => {
      mockFetch.mockResolvedValueOnce(
        buildFetchResponse(buildCredentials(WITHDRAWAL_CREDENTIALS_0x01))
      );

      await checkCompoundingCredentials(BEACON_URL, [PUBKEY_A]);

      expect(exitSpy).toHaveBeenCalledWith(1);
      const stderrOutput = collectStderr(stderrSpy);
      expect(stderrOutput).toContain(
        GENERAL_WRONG_WITHDRAWAL_CREDENTIALS_ERROR(WITHDRAWAL_CREDENTIALS_0x01)
      );
      expect(stderrOutput).toContain(WRONG_WITHDRAWAL_CREDENTIALS_0X01_ERROR);
    });
  });

  describe('checkHasExecutionCredentials', () => {
    const formatError = (pubkey: string) => `validator ${pubkey} has no execution credentials`;

    it('passes when every validator has at least 0x01 (mixed 0x01 and 0x02)', async () => {
      mockFetch
        .mockResolvedValueOnce(buildFetchResponse(buildCredentials(WITHDRAWAL_CREDENTIALS_0x01)))
        .mockResolvedValueOnce(buildFetchResponse(buildCredentials(WITHDRAWAL_CREDENTIALS_0x02)));

      await checkHasExecutionCredentials(BEACON_URL, [PUBKEY_A, PUBKEY_B], formatError);

      expect(exitSpy).not.toHaveBeenCalled();
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('accumulates all 0x00 pubkeys and exits exactly once after logging each', async () => {
      mockFetch
        .mockResolvedValueOnce(buildFetchResponse(buildCredentials(WITHDRAWAL_CREDENTIALS_0x00)))
        .mockResolvedValueOnce(buildFetchResponse(buildCredentials(WITHDRAWAL_CREDENTIALS_0x01)))
        .mockResolvedValueOnce(buildFetchResponse(buildCredentials(WITHDRAWAL_CREDENTIALS_0x00)));

      await checkHasExecutionCredentials(BEACON_URL, [PUBKEY_A, PUBKEY_B, PUBKEY_C], formatError);

      expect(exitSpy).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledWith(1);
      const stderrOutput = collectStderr(stderrSpy);
      expect(stderrOutput).toContain(formatError(PUBKEY_A));
      expect(stderrOutput).toContain(formatError(PUBKEY_C));
      expect(stderrOutput).not.toContain(formatError(PUBKEY_B));
    });
  });

  describe('filterSwitchableValidators', () => {
    it('returns only 0x01 pubkeys and warns about each 0x02 skipped', async () => {
      mockFetch
        .mockResolvedValueOnce(buildFetchResponse(buildCredentials(WITHDRAWAL_CREDENTIALS_0x01)))
        .mockResolvedValueOnce(buildFetchResponse(buildCredentials(WITHDRAWAL_CREDENTIALS_0x02)))
        .mockResolvedValueOnce(buildFetchResponse(buildCredentials(WITHDRAWAL_CREDENTIALS_0x01)));

      const switchable = await filterSwitchableValidators(BEACON_URL, [
        PUBKEY_A,
        PUBKEY_B,
        PUBKEY_C
      ]);

      expect(switchable).toEqual([PUBKEY_A, PUBKEY_C]);
      expect(exitSpy).not.toHaveBeenCalled();
      const stdoutOutput = stdoutSpy.mock.calls.flat().join('\n');
      expect(stdoutOutput).toContain(SWITCH_SOURCE_VALIDATOR_ALREADY_0x02_WARNING(PUBKEY_B));
    });

    it('accumulates all 0x00 mismatches before exiting once', async () => {
      mockFetch
        .mockResolvedValueOnce(buildFetchResponse(buildCredentials(WITHDRAWAL_CREDENTIALS_0x00)))
        .mockResolvedValueOnce(buildFetchResponse(buildCredentials(WITHDRAWAL_CREDENTIALS_0x01)))
        .mockResolvedValueOnce(buildFetchResponse(buildCredentials(WITHDRAWAL_CREDENTIALS_0x00)));

      await filterSwitchableValidators(BEACON_URL, [PUBKEY_A, PUBKEY_B, PUBKEY_C]);

      expect(exitSpy).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledWith(1);
      const stderrOutput = collectStderr(stderrSpy);
      expect(stderrOutput).toContain(SWITCH_SOURCE_VALIDATOR_0x00_CREDENTIALS_ERROR(PUBKEY_A));
      expect(stderrOutput).toContain(SWITCH_SOURCE_VALIDATOR_0x00_CREDENTIALS_ERROR(PUBKEY_C));
      expect(stderrOutput).not.toContain(SWITCH_SOURCE_VALIDATOR_0x00_CREDENTIALS_ERROR(PUBKEY_B));
    });

    it('returns empty list without exiting when all validators are 0x02', async () => {
      mockFetch
        .mockResolvedValueOnce(buildFetchResponse(buildCredentials(WITHDRAWAL_CREDENTIALS_0x02)))
        .mockResolvedValueOnce(buildFetchResponse(buildCredentials(WITHDRAWAL_CREDENTIALS_0x02)));

      const switchable = await filterSwitchableValidators(BEACON_URL, [PUBKEY_A, PUBKEY_B]);

      expect(switchable).toEqual([]);
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  describe('checkWithdrawalAddressOwnership', () => {
    it('passes when the signer address matches the credentials address case-insensitively', async () => {
      mockFetch.mockResolvedValueOnce(
        buildFetchResponse(buildCredentials(WITHDRAWAL_CREDENTIALS_0x01, OWNER_ADDRESS_MIXED_CASE))
      );

      await checkWithdrawalAddressOwnership(BEACON_URL, OWNER_ADDRESS, [PUBKEY_A]);

      expect(exitSpy).not.toHaveBeenCalled();
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('accumulates all mismatches before exiting once', async () => {
      mockFetch
        .mockResolvedValueOnce(
          buildFetchResponse(buildCredentials(WITHDRAWAL_CREDENTIALS_0x01, OTHER_ADDRESS))
        )
        .mockResolvedValueOnce(
          buildFetchResponse(buildCredentials(WITHDRAWAL_CREDENTIALS_0x01, OWNER_ADDRESS))
        )
        .mockResolvedValueOnce(
          buildFetchResponse(buildCredentials(WITHDRAWAL_CREDENTIALS_0x01, OTHER_ADDRESS))
        );

      await checkWithdrawalAddressOwnership(BEACON_URL, OWNER_ADDRESS, [
        PUBKEY_A,
        PUBKEY_B,
        PUBKEY_C
      ]);

      expect(exitSpy).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledWith(1);
      const stderrOutput = collectStderr(stderrSpy);
      expect(stderrOutput).toContain(PUBKEY_A);
      expect(stderrOutput).toContain(PUBKEY_C);
      expect(stderrOutput).not.toContain(PUBKEY_B);
    });

    it('omits Source/Target role labels when targetPubkeys is not supplied', async () => {
      mockFetch.mockResolvedValueOnce(
        buildFetchResponse(buildCredentials(WITHDRAWAL_CREDENTIALS_0x01, OTHER_ADDRESS))
      );

      await checkWithdrawalAddressOwnership(BEACON_URL, OWNER_ADDRESS, [PUBKEY_A]);

      const stderrOutput = collectStderr(stderrSpy);
      expect(stderrOutput).toContain(
        WITHDRAWAL_ADDRESS_MISMATCH_ERROR(
          PUBKEY_A,
          `0x${OTHER_ADDRESS.slice(2).toLowerCase()}`,
          OWNER_ADDRESS,
          OWNER_LABEL_SIGNER
        )
      );
      expect(stderrOutput).not.toContain(WITHDRAWAL_ADDRESS_TARGET_MISMATCH_HINT);
    });

    it('labels mismatches as Source and Target when targetPubkeys is supplied', async () => {
      mockFetch
        .mockResolvedValueOnce(
          buildFetchResponse(buildCredentials(WITHDRAWAL_CREDENTIALS_0x01, OTHER_ADDRESS))
        )
        .mockResolvedValueOnce(
          buildFetchResponse(buildCredentials(WITHDRAWAL_CREDENTIALS_0x01, OTHER_ADDRESS))
        );

      await checkWithdrawalAddressOwnership(
        BEACON_URL,
        OWNER_ADDRESS,
        [PUBKEY_A, PUBKEY_B],
        [PUBKEY_B]
      );

      const stderrOutput = collectStderr(stderrSpy);
      expect(stderrOutput).toContain(
        WITHDRAWAL_ADDRESS_MISMATCH_ERROR(
          PUBKEY_A,
          `0x${OTHER_ADDRESS.slice(2).toLowerCase()}`,
          OWNER_ADDRESS,
          OWNER_LABEL_SIGNER,
          'source'
        )
      );
      expect(stderrOutput).toContain(
        WITHDRAWAL_ADDRESS_MISMATCH_ERROR(
          PUBKEY_B,
          `0x${OTHER_ADDRESS.slice(2).toLowerCase()}`,
          OWNER_ADDRESS,
          OWNER_LABEL_SIGNER,
          'target'
        )
      );
      expect(stderrOutput).toContain(WITHDRAWAL_ADDRESS_TARGET_MISMATCH_HINT);
    });

    it('omits the target-mismatch hint when only source validators mismatch', async () => {
      mockFetch
        .mockResolvedValueOnce(
          buildFetchResponse(buildCredentials(WITHDRAWAL_CREDENTIALS_0x01, OTHER_ADDRESS))
        )
        .mockResolvedValueOnce(
          buildFetchResponse(buildCredentials(WITHDRAWAL_CREDENTIALS_0x01, OWNER_ADDRESS))
        );

      await checkWithdrawalAddressOwnership(
        BEACON_URL,
        OWNER_ADDRESS,
        [PUBKEY_A, PUBKEY_B],
        [PUBKEY_B]
      );

      const stderrOutput = collectStderr(stderrSpy);
      expect(stderrOutput).not.toContain(WITHDRAWAL_ADDRESS_TARGET_MISMATCH_HINT);
    });

    it('uses the default signer ownerLabel in the error header', async () => {
      mockFetch.mockResolvedValueOnce(
        buildFetchResponse(buildCredentials(WITHDRAWAL_CREDENTIALS_0x01, OTHER_ADDRESS))
      );

      await checkWithdrawalAddressOwnership(BEACON_URL, OWNER_ADDRESS, [PUBKEY_A]);

      const stderrOutput = collectStderr(stderrSpy);
      expect(stderrOutput).toContain(WITHDRAWAL_ADDRESS_OWNERSHIP_HEADER(OWNER_LABEL_SIGNER));
    });

    it('uses the Safe ownerLabel when OWNER_LABEL_SAFE is passed', async () => {
      mockFetch.mockResolvedValueOnce(
        buildFetchResponse(buildCredentials(WITHDRAWAL_CREDENTIALS_0x01, OTHER_ADDRESS))
      );

      await checkWithdrawalAddressOwnership(
        BEACON_URL,
        OWNER_ADDRESS,
        [PUBKEY_A],
        undefined,
        OWNER_LABEL_SAFE
      );

      const stderrOutput = collectStderr(stderrSpy);
      expect(stderrOutput).toContain(WITHDRAWAL_ADDRESS_OWNERSHIP_HEADER(OWNER_LABEL_SAFE));
    });
  });

  describe('beacon API error handling', () => {
    it('routes non-ok responses through exitWithApiError with status and statusText', async () => {
      mockFetch.mockResolvedValueOnce(
        buildFetchResponse(buildCredentials(WITHDRAWAL_CREDENTIALS_0x02), {
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          text: 'upstream beacon down'
        })
      );

      await checkCompoundingCredentials(BEACON_URL, [PUBKEY_A]);

      expect(exitSpy).toHaveBeenCalledWith(1);
      const stderrOutput = collectStderr(stderrSpy);
      expect(stderrOutput).toContain(BEACON_API_ERROR);
      expect(stderrOutput).toContain('Service Unavailable');
      expect(stderrOutput).toContain('503');
      expect(stderrOutput).toContain('upstream beacon down');
    });

    it('emits BEACON_API_ERROR with error.cause when fetch throws a TypeError', async () => {
      const causeMessage = 'ECONNREFUSED 127.0.0.1:5052';
      const cause = new Error(causeMessage);
      const typeError = new TypeError('fetch failed');
      (typeError as TypeError & { cause: unknown }).cause = cause;
      mockFetch.mockRejectedValueOnce(typeError);

      await checkCompoundingCredentials(BEACON_URL, [PUBKEY_A]);

      expect(exitSpy).toHaveBeenCalledWith(1);
      const stderrOutput = collectStderr(stderrSpy);
      expect(stderrOutput).toContain(BEACON_API_ERROR);
      expect(stderrOutput).toContain(causeMessage);
    });

    it('emits UNEXPECTED_BEACON_API_ERROR when fetch throws a non-TypeError', async () => {
      const unexpectedMessage = 'unexpected boom';
      const unexpectedError = new Error(unexpectedMessage);
      mockFetch.mockRejectedValueOnce(unexpectedError);

      await checkCompoundingCredentials(BEACON_URL, [PUBKEY_A]);

      expect(exitSpy).toHaveBeenCalledWith(1);
      const stderrOutput = collectStderr(stderrSpy);
      expect(stderrOutput).toContain(UNEXPECTED_BEACON_API_ERROR(BEACON_URL));
      expect(stderrOutput).toContain(unexpectedMessage);
    });

    it('routes fetch TypeError in filterSwitchableValidators to BEACON_API_ERROR', async () => {
      const cause = new Error('socket hang up');
      const typeError = new TypeError('fetch failed');
      (typeError as TypeError & { cause: unknown }).cause = cause;
      mockFetch.mockRejectedValueOnce(typeError);

      await filterSwitchableValidators(BEACON_URL, [PUBKEY_A]);

      expect(exitSpy).toHaveBeenCalledWith(1);
      const stderrOutput = collectStderr(stderrSpy);
      expect(stderrOutput).toContain(BEACON_API_ERROR);
    });

    it('routes fetch TypeError in checkWithdrawalAddressOwnership to BEACON_API_ERROR', async () => {
      const cause = new Error('connection reset');
      const typeError = new TypeError('fetch failed');
      (typeError as TypeError & { cause: unknown }).cause = cause;
      mockFetch.mockRejectedValueOnce(typeError);

      await checkWithdrawalAddressOwnership(BEACON_URL, OWNER_ADDRESS, [PUBKEY_A]);

      expect(exitSpy).toHaveBeenCalledWith(1);
      const stderrOutput = collectStderr(stderrSpy);
      expect(stderrOutput).toContain(BEACON_API_ERROR);
    });
  });
});
