import { SecretKey } from '@chainsafe/blst';
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { getBytes } from 'ethers';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import * as application from '../../constants/application';
import * as logging from '../../constants/logging';
import type { GlobalCliOptions } from '../../model/commander';
import type { DepositData, DepositDataFileEntry } from '../../model/ethereum';
import { deposit, loadDepositData } from './deposit';
import {
  computeDepositDataRoot,
  computeDepositMessageRoot,
  computeDepositSigningRoot
} from './deposit-contract';
import * as pipelineModule from './execution-layer-request-pipeline';
import * as preRequestValidationModule from './pre-request-validation';

const NETWORK = 'kurtosis_devnet';
const WITHDRAWAL_ADDRESS = '9667d6c9aea09e41878a95724515d4d206a3349e';
const PROCESS_EXIT = 'process.exit';

// eslint-disable-next-line no-control-regex -- Matches ANSI escape sequences emitted by chalk
const ANSI_ESCAPE_PATTERN = /\u001B\[[0-9;]*m/g;

interface EntryOptions {
  seed?: number;
  prefix?: string;
  amount?: number;
  forkVersion?: string;
}

/**
 * Build a correctly signed deposit-cli file entry
 *
 * @param options - Key seed, credentials prefix, amount (gwei) and fork version to sign for
 * @returns Deposit data file entry without 0x prefixes, like deposit-cli writes it
 */
function buildEntry(options: EntryOptions = {}): DepositDataFileEntry {
  const {
    seed = 1,
    prefix = '01',
    amount = 32_000_000_000,
    forkVersion = application.KURTOSIS_GENESIS_FORK_VERSION
  } = options;
  const secretKey = SecretKey.fromKeygen(new Uint8Array(32).fill(seed));
  const unsigned: DepositData = {
    pubkey: `0x${Buffer.from(secretKey.toPublicKey().toBytes()).toString('hex')}`,
    withdrawalCredentials: `0x${prefix}${'00'.repeat(11)}${WITHDRAWAL_ADDRESS}`,
    amountGwei: BigInt(amount),
    signature: ''
  };
  const signature = secretKey.sign(getBytes(computeDepositSigningRoot(unsigned, forkVersion)));
  const data = { ...unsigned, signature: `0x${Buffer.from(signature.toBytes()).toString('hex')}` };
  return {
    pubkey: data.pubkey.slice(2),
    withdrawal_credentials: data.withdrawalCredentials.slice(2),
    amount,
    signature: data.signature.slice(2),
    deposit_message_root: computeDepositMessageRoot(data).slice(2),
    deposit_data_root: computeDepositDataRoot(data).slice(2),
    fork_version: forkVersion.slice(2)
  };
}

describe('deposit', () => {
  let directory: string;
  let exitSpy: ReturnType<typeof spyOn>;
  let stderrSpy: ReturnType<typeof spyOn>;
  let stdoutSpy: ReturnType<typeof spyOn>;

  /**
   * Write content to a deposit data file in the test directory
   *
   * @param content - File content; non-strings are serialized as JSON
   * @returns Path of the written file
   */
  function writeDepositFile(content: unknown): string {
    const path = join(directory, 'deposit_data.json');
    writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
    return path;
  }

  /**
   * Load a deposit file and return the reported failures (expects the run to exit)
   *
   * @param content - File content
   * @returns stderr output without ANSI codes
   */
  function loadExpectingFailure(content: unknown): string {
    expect(() => loadDepositData(writeDepositFile(content), NETWORK)).toThrow(PROCESS_EXIT);
    expect(exitSpy).toHaveBeenCalledWith(1);
    return stderrSpy.mock.calls.flat().join('\n').replace(ANSI_ESCAPE_PATTERN, '');
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'eth-valctl-deposit-'));
    exitSpy = spyOn(process, 'exit').mockImplementation((() => {
      throw new Error(PROCESS_EXIT);
    }) as never);
    stderrSpy = spyOn(console, 'error').mockImplementation(() => {});
    stdoutSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
    mock.restore();
  });

  describe('loadDepositData', () => {
    it('returns normalised deposits for a valid file with and without 0x prefixes', () => {
      const plain = buildEntry({ seed: 1 });
      const prefixed = buildEntry({ seed: 2, prefix: '02' });
      const withPrefix = Object.fromEntries(
        Object.entries(prefixed).map(([key, value]) => [
          key,
          typeof value === 'string' ? `0x${value.toUpperCase()}` : value
        ])
      );

      const deposits = loadDepositData(writeDepositFile([plain, withPrefix]), NETWORK);

      expect(deposits).toEqual([
        {
          pubkey: `0x${plain.pubkey}`,
          withdrawalCredentials: `0x${plain.withdrawal_credentials}`,
          amountGwei: 32_000_000_000n,
          signature: `0x${plain.signature}`
        },
        {
          pubkey: `0x${prefixed.pubkey}`,
          withdrawalCredentials: `0x${prefixed.withdrawal_credentials}`,
          amountGwei: 32_000_000_000n,
          signature: `0x${prefixed.signature}`
        }
      ]);
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it.each([
      ['not JSON', '{', logging.DEPOSIT_FILE_NOT_JSON_ERROR],
      ['not an array', { pubkey: 'x' }, logging.DEPOSIT_FILE_EMPTY_ERROR],
      ['an empty array', [], logging.DEPOSIT_FILE_EMPTY_ERROR]
    ])('rejects a file which is %s', (_name, content, message) => {
      const path = writeDepositFile(content);

      expect(() => loadDepositData(path, NETWORK)).toThrow(PROCESS_EXIT);
      expect(stderrSpy.mock.calls.flat().join('\n')).toContain(message(path));
    });

    it('rejects a missing file', () => {
      expect(() => loadDepositData(join(directory, 'missing.json'), NETWORK)).toThrow(PROCESS_EXIT);
    });

    it('reports missing fields, wrong types and bad hex lengths of an entry', () => {
      const stderr = loadExpectingFailure([
        { ...buildEntry(), signature: undefined, amount: '32000000000', pubkey: 'abcd' }
      ]);

      const subject = logging.DEPOSIT_ENTRY_SUBJECT(1);
      expect(stderr).toContain(logging.DEPOSIT_FIELD_INVALID_ERROR(subject, 'signature'));
      expect(stderr).toContain(logging.DEPOSIT_FIELD_INVALID_ERROR(subject, 'amount'));
      expect(stderr).toContain(logging.DEPOSIT_FIELD_HEX_ERROR(subject, 'pubkey', 48));
    });

    it('reports a negative amount as invalid field instead of crashing', () => {
      const stderr = loadExpectingFailure([{ ...buildEntry(), amount: -1 }]);

      expect(stderr).toContain(
        logging.DEPOSIT_FIELD_INVALID_ERROR(logging.DEPOSIT_ENTRY_SUBJECT(1), 'amount')
      );
    });

    it('rejects a pubkey which is not a BLS public key', () => {
      const stderr = loadExpectingFailure([{ ...buildEntry(), pubkey: 'ff'.repeat(48) }]);

      expect(stderr).toContain(
        logging.DEPOSIT_INVALID_PUBKEY_ERROR(logging.DEPOSIT_ENTRY_SUBJECT(1))
      );
    });

    it('rejects 0x00 credentials with a dedicated message', () => {
      const stderr = loadExpectingFailure([buildEntry({ prefix: '00' })]);

      expect(stderr).toContain(
        logging.DEPOSIT_0x00_CREDENTIALS_ERROR(logging.DEPOSIT_ENTRY_SUBJECT(1))
      );
    });

    it('rejects execution credentials with non-zero padding', () => {
      const entry = buildEntry();
      const credentials = `01${'00'.repeat(10)}01${WITHDRAWAL_ADDRESS}`;

      const stderr = loadExpectingFailure([{ ...entry, withdrawal_credentials: credentials }]);

      expect(stderr).toContain(
        logging.DEPOSIT_INVALID_CREDENTIALS_ERROR(
          logging.DEPOSIT_ENTRY_SUBJECT(1),
          `0x${credentials}`
        )
      );
    });

    it.each([
      [
        'below 1 ETH',
        '01',
        999_999_999,
        logging.DEPOSIT_AMOUNT_TOO_LOW_ERROR('Deposit data entry 1', '1.0')
      ],
      [
        'above 32 ETH for 0x01',
        '01',
        33_000_000_000,
        logging.DEPOSIT_AMOUNT_TOO_HIGH_ERROR('Deposit data entry 1', '0x01', '32.0')
      ],
      [
        'above 2048 ETH for 0x02',
        '02',
        2_049_000_000_000,
        logging.DEPOSIT_AMOUNT_TOO_HIGH_ERROR('Deposit data entry 1', '0x02', '2048.0')
      ]
    ])('rejects an amount %s', (_name, prefix, amount, message) => {
      expect(loadExpectingFailure([buildEntry({ prefix, amount })])).toContain(message);
    });

    it('accepts 0x02 deposits above 32 ETH', () => {
      const deposits = loadDepositData(
        writeDepositFile([buildEntry({ prefix: '02', amount: 64_000_000_000 })]),
        NETWORK
      );

      expect(deposits[0]!.amountGwei).toBe(64_000_000_000n);
    });

    it('warns but accepts amounts below 32 ETH', () => {
      loadDepositData(writeDepositFile([buildEntry({ amount: 1_000_000_000 })]), NETWORK);

      expect(stdoutSpy.mock.calls.flat().join('\n')).toContain(
        logging.DEPOSIT_AMOUNT_BELOW_ACTIVATION_WARNING('1.0', '32.0')
      );
    });

    it('reports a file for another network once as fork version mismatch', () => {
      const stderr = loadExpectingFailure([
        buildEntry({ forkVersion: application.HOODI_GENESIS_FORK_VERSION })
      ]);

      expect(stderr).toContain(logging.SANITY_CHECK_FAILED_HEADER(1));
      expect(stderr).toContain(
        logging.DEPOSIT_FORK_VERSION_MISMATCH_ERROR(
          logging.DEPOSIT_ENTRY_SUBJECT(1),
          application.HOODI_GENESIS_FORK_VERSION,
          NETWORK,
          application.KURTOSIS_GENESIS_FORK_VERSION
        )
      );
    });

    it('reports only the signature when the fork version was patched to the selected network', () => {
      const entry = {
        ...buildEntry({ forkVersion: application.HOODI_GENESIS_FORK_VERSION }),
        fork_version: application.KURTOSIS_GENESIS_FORK_VERSION.slice(2)
      };

      const stderr = loadExpectingFailure([entry]);

      expect(stderr).toContain(logging.SANITY_CHECK_FAILED_HEADER(1));
      expect(stderr).toContain(
        logging.DEPOSIT_SIGNATURE_INVALID_ERROR(logging.DEPOSIT_ENTRY_SUBJECT(1), NETWORK)
      );
    });

    it('reports root mismatches and the invalid signature of tampered credentials', () => {
      const entry = buildEntry();
      const tampered = {
        ...entry,
        withdrawal_credentials: `01${'00'.repeat(11)}${'1'.repeat(40)}`
      };

      const stderr = loadExpectingFailure([tampered]);

      const subject = logging.DEPOSIT_ENTRY_SUBJECT(1);
      expect(stderr).toContain(logging.SANITY_CHECK_FAILED_HEADER(3));
      expect(stderr).toContain(logging.DEPOSIT_MESSAGE_ROOT_MISMATCH_ERROR(subject));
      expect(stderr).toContain(logging.DEPOSIT_DATA_ROOT_MISMATCH_ERROR(subject));
      expect(stderr).toContain(logging.DEPOSIT_SIGNATURE_INVALID_ERROR(subject, NETWORK));
    });

    it('reports a deposit_data_root which does not match the data', () => {
      const stderr = loadExpectingFailure([
        { ...buildEntry(), deposit_data_root: 'ab'.repeat(32) }
      ]);

      expect(stderr).toContain(logging.SANITY_CHECK_FAILED_HEADER(1));
      expect(stderr).toContain(
        logging.DEPOSIT_DATA_ROOT_MISMATCH_ERROR(logging.DEPOSIT_ENTRY_SUBJECT(1))
      );
    });

    it('reports duplicate pubkeys and mixed amounts together', () => {
      const entry = buildEntry();

      const stderr = loadExpectingFailure([
        entry,
        entry,
        buildEntry({ seed: 2, amount: 16_000_000_000 })
      ]);

      expect(stderr).toContain(logging.SANITY_CHECK_FAILED_HEADER(2));
      expect(stderr).toContain(logging.DEPOSIT_DUPLICATE_PUBKEY_ERROR(`0x${entry.pubkey}`));
      expect(stderr).toContain(logging.DEPOSIT_MIXED_AMOUNTS_ERROR);
    });
  });

  describe('deposit', () => {
    const globalOptions: GlobalCliOptions = {
      network: NETWORK,
      jsonRpcUrl: 'http://localhost:8545',
      beaconApiUrl: 'http://localhost:5052',
      maxRequestsPerBlock: 10,
      ledger: false
    };

    it('sends the deposits left after the beacon checks to the deposit contract', async () => {
      const path = writeDepositFile([buildEntry({ seed: 1 }), buildEntry({ seed: 2 })]);
      const filterSpy = spyOn(
        preRequestValidationModule,
        'filterDepositRequests'
      ).mockImplementation((_url, _network, deposits) => Promise.resolve(deposits.slice(1)));
      const pipelineSpy = spyOn(pipelineModule, 'executeDepositPipeline').mockResolvedValue();

      await deposit(globalOptions, path);

      const loaded = loadDepositData(path, NETWORK);
      expect(filterSpy).toHaveBeenCalledWith(globalOptions.beaconApiUrl, NETWORK, loaded);
      expect(pipelineSpy).toHaveBeenCalledWith(globalOptions, loaded.slice(1));
    });

    it('sends nothing and creates no connection when every validator is already deposited', async () => {
      spyOn(preRequestValidationModule, 'filterDepositRequests').mockResolvedValue([]);
      const pipelineSpy = spyOn(pipelineModule, 'executeDepositPipeline').mockResolvedValue();

      await deposit(globalOptions, writeDepositFile([buildEntry()]));

      expect(pipelineSpy).not.toHaveBeenCalled();
      expect(stdoutSpy.mock.calls.flat().join('\n')).toContain(
        logging.DEPOSIT_NOTHING_TO_SEND_INFO
      );
    });
  });
});
