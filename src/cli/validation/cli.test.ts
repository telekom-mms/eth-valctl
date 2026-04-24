import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import chalk from 'chalk';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { MAX_NUMBER_OF_REQUESTS_PER_BLOCK } from '../../constants/application';
import { SAFE_OPTION_REQUIRED_ERROR } from '../../constants/logging';
import type { GlobalCliOptions } from '../../model/commander';
import {
  parseAndValidateMaxNumberOfRequestsPerBlock,
  parseAndValidateNodeUrl,
  parseAndValidateSafeAddress,
  parseAndValidateValidatorPubKey,
  parseAndValidateValidatorPubKeys,
  parseAndValidateWithdrawAmount,
  validateSafeAddress,
  validateSafeNetworkSupport
} from './cli';

const VALID_BLS_PUBKEY =
  '0x93247f2209abcacf57b75a51dafae777f9dd38bc7053d1af526f220a7489a6d3a2753e5f3e8b1cfe39b56f43611df74a';

const VALID_BLS_PUBKEY_NO_PREFIX =
  '93247f2209abcacf57b75a51dafae777f9dd38bc7053d1af526f220a7489a6d3a2753e5f3e8b1cfe39b56f43611df74a';

describe('CLI Validation', () => {
  describe('parseAndValidateNodeUrl', () => {
    it('returns URL when starting with http://', () => {
      const result = parseAndValidateNodeUrl('http://localhost:8545');

      expect(result).toBe('http://localhost:8545');
    });

    it('returns URL when starting with https://', () => {
      const result = parseAndValidateNodeUrl('https://mainnet.infura.io/v3/key');

      expect(result).toBe('https://mainnet.infura.io/v3/key');
    });

    it('returns URL with path and query parameters', () => {
      const result = parseAndValidateNodeUrl('https://api.example.com/rpc?key=abc');

      expect(result).toBe('https://api.example.com/rpc?key=abc');
    });
  });

  describe('parseAndValidateWithdrawAmount', () => {
    it('returns parsed amount for valid decimal', () => {
      const result = parseAndValidateWithdrawAmount('1.5');

      expect(result).toBe(1.5);
    });

    it('returns parsed amount for minimum valid value', () => {
      const result = parseAndValidateWithdrawAmount('0.000001');

      expect(result).toBe(0.000001);
    });

    it('returns parsed amount for integer string', () => {
      const result = parseAndValidateWithdrawAmount('32');

      expect(result).toBe(32);
    });

    it('returns parsed amount for large value', () => {
      const result = parseAndValidateWithdrawAmount('1000.123456');

      expect(result).toBe(1000.123456);
    });
  });

  describe('parseAndValidateValidatorPubKey', () => {
    it('returns pubkey unchanged when valid with 0x prefix', () => {
      const result = parseAndValidateValidatorPubKey(VALID_BLS_PUBKEY);

      expect(result).toBe(VALID_BLS_PUBKEY);
    });

    it('adds 0x prefix when valid pubkey without prefix', () => {
      const result = parseAndValidateValidatorPubKey(VALID_BLS_PUBKEY_NO_PREFIX);

      expect(result).toBe(VALID_BLS_PUBKEY);
    });
  });

  describe('parseAndValidateValidatorPubKeys', () => {
    it('returns array with single pubkey when no previous provided', () => {
      const result = parseAndValidateValidatorPubKeys(VALID_BLS_PUBKEY);

      expect(result).toEqual([VALID_BLS_PUBKEY]);
    });

    it('accumulates pubkeys with previous array', () => {
      const previous = [VALID_BLS_PUBKEY];
      const result = parseAndValidateValidatorPubKeys(VALID_BLS_PUBKEY, previous);

      expect(result).toEqual([VALID_BLS_PUBKEY, VALID_BLS_PUBKEY]);
    });

    it('adds 0x prefix when pubkey without prefix', () => {
      const result = parseAndValidateValidatorPubKeys(VALID_BLS_PUBKEY_NO_PREFIX);

      expect(result).toEqual([VALID_BLS_PUBKEY]);
    });

    it('handles empty previous array', () => {
      const result = parseAndValidateValidatorPubKeys(VALID_BLS_PUBKEY, []);

      expect(result).toEqual([VALID_BLS_PUBKEY]);
    });

    describe('file-based input', () => {
      let tmpDir: string;
      let stderrSpy: ReturnType<typeof spyOn>;
      let exitSpy: ReturnType<typeof spyOn>;

      beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'valctl-test-'));
        stderrSpy = spyOn(console, 'error').mockImplementation(() => {});
        exitSpy = spyOn(process, 'exit').mockImplementation(() => {
          throw new Error('process.exit');
        });
      });

      afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
        stderrSpy.mockRestore();
        exitSpy.mockRestore();
      });

      it('reads pubkeys from a file', () => {
        const filePath = join(tmpDir, 'validators.txt');
        writeFileSync(filePath, `${VALID_BLS_PUBKEY}\n`);

        const result = parseAndValidateValidatorPubKeys(filePath);

        expect(result).toEqual([VALID_BLS_PUBKEY]);
      });

      it('reads multiple pubkeys from a file', () => {
        const filePath = join(tmpDir, 'validators.txt');
        writeFileSync(filePath, `${VALID_BLS_PUBKEY}\n${VALID_BLS_PUBKEY}\n`);

        const result = parseAndValidateValidatorPubKeys(filePath);

        expect(result).toEqual([VALID_BLS_PUBKEY, VALID_BLS_PUBKEY]);
      });

      it('skips empty lines and comments in file', () => {
        const filePath = join(tmpDir, 'validators.txt');
        const content = [
          '# My validators',
          '',
          VALID_BLS_PUBKEY,
          '',
          '# Batch 2',
          VALID_BLS_PUBKEY,
          ''
        ].join('\n');
        writeFileSync(filePath, content);

        const result = parseAndValidateValidatorPubKeys(filePath);

        expect(result).toEqual([VALID_BLS_PUBKEY, VALID_BLS_PUBKEY]);
      });

      it('trims trailing whitespace on lines', () => {
        const filePath = join(tmpDir, 'validators.txt');
        writeFileSync(filePath, `${VALID_BLS_PUBKEY}   \n`);

        const result = parseAndValidateValidatorPubKeys(filePath);

        expect(result).toEqual([VALID_BLS_PUBKEY]);
      });

      it('reads pubkeys without 0x prefix from file and adds prefix', () => {
        const filePath = join(tmpDir, 'validators.txt');
        writeFileSync(filePath, `${VALID_BLS_PUBKEY_NO_PREFIX}\n`);

        const result = parseAndValidateValidatorPubKeys(filePath);

        expect(result).toEqual([VALID_BLS_PUBKEY]);
      });

      it('accumulates file pubkeys with previous array', () => {
        const filePath = join(tmpDir, 'validators.txt');
        writeFileSync(filePath, `${VALID_BLS_PUBKEY}\n`);

        const result = parseAndValidateValidatorPubKeys(filePath, [VALID_BLS_PUBKEY]);

        expect(result).toEqual([VALID_BLS_PUBKEY, VALID_BLS_PUBKEY]);
      });

      it('prints info message to stderr when reading from file', () => {
        const filePath = join(tmpDir, 'validators.txt');
        writeFileSync(filePath, `${VALID_BLS_PUBKEY}\n${VALID_BLS_PUBKEY}\n`);

        parseAndValidateValidatorPubKeys(filePath);

        expect(stderrSpy).toHaveBeenCalledWith(
          chalk.blue(`Read 2 validator pubkeys from ${filePath}`)
        );
      });

      it('pubkey pattern takes priority over filename match', () => {
        const result = parseAndValidateValidatorPubKeys(VALID_BLS_PUBKEY);

        expect(result).toEqual([VALID_BLS_PUBKEY]);
      });

      it('exits with error for invalid pubkey in file', () => {
        const filePath = join(tmpDir, 'validators.txt');
        writeFileSync(filePath, 'not-a-valid-pubkey\n');

        expect(() => parseAndValidateValidatorPubKeys(filePath)).toThrow('process.exit');
        expect(stderrSpy).toHaveBeenCalledWith(
          chalk.red(`Invalid validator pubkey on line 1 of ${filePath}`)
        );
      });

      it('exits with error for empty file', () => {
        const filePath = join(tmpDir, 'validators.txt');
        writeFileSync(filePath, '# only comments\n\n');

        expect(() => parseAndValidateValidatorPubKeys(filePath)).toThrow('process.exit');
        expect(stderrSpy).toHaveBeenCalledWith(
          chalk.red(`File '${filePath}' contains no valid validator pubkeys`)
        );
      });

      it('exits with error for non-existent file argument', () => {
        expect(() => parseAndValidateValidatorPubKeys('/nonexistent/file.txt')).toThrow(
          'process.exit'
        );
        expect(stderrSpy).toHaveBeenCalledWith(
          chalk.red(
            "'/nonexistent/file.txt' is neither a valid validator pubkey nor an existing file"
          )
        );
      });

      it('exits with error for directory path', () => {
        const dirPath = join(tmpDir, 'subdir');
        mkdirSync(dirPath);

        expect(() => parseAndValidateValidatorPubKeys(dirPath)).toThrow('process.exit');
        expect(stderrSpy).toHaveBeenCalledWith(
          chalk.red(`'${dirPath}' is neither a valid validator pubkey nor an existing file`)
        );
      });
    });
  });

  describe('parseAndValidateSafeAddress', () => {
    let stderrSpy: ReturnType<typeof spyOn>;
    let exitSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
      stderrSpy = spyOn(console, 'error').mockImplementation(() => {});
      exitSpy = spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit');
      });
    });

    afterEach(() => {
      stderrSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('accepts valid checksummed address', () => {
      const result = parseAndValidateSafeAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');

      expect(result).toBe('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
    });

    it('normalizes non-checksummed address to checksummed form', () => {
      const result = parseAndValidateSafeAddress('0xd8da6bf26964af9d7eed9e03e53415d37aa96045');

      expect(result).toBe('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
    });

    it('exits with error for wrong length address', () => {
      expect(() => parseAndValidateSafeAddress('0x123')).toThrow('process.exit');
      expect(stderrSpy).toHaveBeenCalledWith(
        chalk.red('Invalid Safe address "0x123": expected 0x-prefixed 40-character hex string')
      );
    });

    it('exits with error for missing 0x prefix', () => {
      expect(() => parseAndValidateSafeAddress('d8da6bf26964af9d7eed9e03e53415d37aa96045')).toThrow(
        'process.exit'
      );
    });

    it('exits with error for non-hex characters', () => {
      expect(() =>
        parseAndValidateSafeAddress('0xZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ')
      ).toThrow('process.exit');
    });
  });

  describe('validateSafeNetworkSupport', () => {
    let stderrSpy: ReturnType<typeof spyOn>;
    let exitSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
      stderrSpy = spyOn(console, 'error').mockImplementation(() => {});
      exitSpy = spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit');
      });
    });

    afterEach(() => {
      stderrSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('passes for hoodi with --safe', () => {
      expect(() =>
        validateSafeNetworkSupport('hoodi', '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')
      ).not.toThrow();
    });

    it('passes for mainnet with --safe', () => {
      expect(() =>
        validateSafeNetworkSupport('mainnet', '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')
      ).not.toThrow();
    });

    it('passes when --safe is not provided', () => {
      expect(() => validateSafeNetworkSupport('kurtosis_devnet')).not.toThrow();
    });

    it('passes for kurtosis_devnet with --safe', () => {
      expect(() =>
        validateSafeNetworkSupport('kurtosis_devnet', '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')
      ).not.toThrow();
    });
  });

  describe('validateSafeAddress', () => {
    let stderrSpy: ReturnType<typeof spyOn>;
    let exitSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
      stderrSpy = spyOn(console, 'error').mockImplementation(() => {});
      exitSpy = spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit');
      });
    });

    afterEach(() => {
      stderrSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('returns safe address when --safe option is present', () => {
      const options = { safe: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' } as GlobalCliOptions;

      const result = validateSafeAddress(options);

      expect(result).toBe('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
    });

    it('exits with code 1 when --safe option is missing', () => {
      const options = {} as GlobalCliOptions;

      expect(() => validateSafeAddress(options)).toThrow('process.exit');
      expect(stderrSpy).toHaveBeenCalledWith(chalk.red(SAFE_OPTION_REQUIRED_ERROR));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('parseAndValidateMaxNumberOfRequestsPerBlock', () => {
    it('returns parsed number for valid input', () => {
      const result = parseAndValidateMaxNumberOfRequestsPerBlock('50');

      expect(result).toBe(50);
    });

    it('returns parsed number at maximum allowed value', () => {
      const result = parseAndValidateMaxNumberOfRequestsPerBlock(
        MAX_NUMBER_OF_REQUESTS_PER_BLOCK.toString()
      );

      expect(result).toBe(MAX_NUMBER_OF_REQUESTS_PER_BLOCK);
    });

    it('returns parsed number for minimum value', () => {
      const result = parseAndValidateMaxNumberOfRequestsPerBlock('1');

      expect(result).toBe(1);
    });
  });
});
