import { describe, expect, it } from 'bun:test';

import { MAX_NUMBER_OF_REQUESTS_PER_BLOCK } from '../../constants/application';
import {
  parseAndValidateMaxNumberOfRequestsPerBlock,
  parseAndValidateNodeUrl,
  parseAndValidateValidatorPubKey,
  parseAndValidateValidatorPubKeys,
  parseAndValidateWithdrawAmount
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
