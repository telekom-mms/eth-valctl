import { describe, expect, it } from 'bun:test';
import { id, Interface } from 'ethers';

import * as application from '../../constants/application';
import type { DepositData, DepositDataFileEntry } from '../../model/ethereum';
import {
  computeDepositDataRoot,
  computeDepositMessageRoot,
  encodeDepositCalldata,
  verifyDepositSignature
} from './deposit-contract';
import { extractValidatorPubkey } from './request/broadcast-strategy/broadcast-utils';

/** ethstaker-deposit-cli output used by the Lighthouse validator_manager test vectors */
const MAINNET_ENTRY: DepositDataFileEntry = {
  pubkey:
    '88b6b3a9b391fa5593e8bce8d06102df1a56248368086929709fbb4a8570dc6a560febeef8159b19789e9c1fd13572f0',
  withdrawal_credentials: '0100000000000000000000000f51bb10119727a7e5ea3538074fb341f56b09ad',
  amount: 32000000000,
  signature:
    'a8461b58a5a5a0573c4af37da6ee4ba63e35894cffad6797d4a2c80f8f2c79d2c30c0de0299d8edde76e0c3f3e6d4f1e03cc377969f56d8760717d6e86f9316da9375573ce7bb87a8520daedb13c49284377f7a4f64a70aa2ca44b1581d47e20',
  deposit_message_root: '62967565d11471da4af7769911926cd1826124048036b25616216f99bc320f13',
  deposit_data_root: 'd26d642a880ff8a109260fe69681840f6e1868c8c1cd2163a1db5a094e8db03a',
  fork_version: '00000000'
};

const HOLESKY_ENTRY: DepositDataFileEntry = {
  pubkey:
    '88b6b3a9b391fa5593e8bce8d06102df1a56248368086929709fbb4a8570dc6a560febeef8159b19789e9c1fd13572f0',
  withdrawal_credentials: '0049b6188ed20314309f617dd4030b8ddfac3c6e65759a03c226a13b2fe4cc72',
  amount: 32000000000,
  signature:
    '846c83b1ec80038974ded0ef5b89d86c862a7bd4559c10528cd4bb6a48e71987f17a963bc6165a6f51c8b87474e64b450b549ce2d14a25bea3c86c241f3740f3d3edc3dc36fddbeadb1ec8969d7193da602270fea8dd31d3e64674aa2090b73d',
  deposit_message_root: 'a9bc1d21cc009d9b10782a07213e37592c0d235463ed0117dec755758da90d51',
  deposit_data_root: 'cdfe14518026e99b9dfa8a029054349e37d4632ee2bbed7c2f5af19a01912368',
  fork_version: '01017000'
};

const HOODI_ENTRY: DepositDataFileEntry = {
  pubkey:
    '88b6b3a9b391fa5593e8bce8d06102df1a56248368086929709fbb4a8570dc6a560febeef8159b19789e9c1fd13572f0',
  withdrawal_credentials: '0100000000000000000000000f51bb10119727a7e5ea3538074fb341f56b09ad',
  amount: 32000000000,
  signature:
    '95db3dcba68c61c0a934e1cb36bb093867d92fc5c62f2c9f45fbacef290bb491fa0589cf356680f61a7b0ba06b7e776311eb0e96841f053c05f7ee41d32731001f9def95078b2e8d293e1b6d38d1d231245def298c480861beee891a3b314743',
  deposit_message_root: '62967565d11471da4af7769911926cd1826124048036b25616216f99bc320f13',
  deposit_data_root: '8224b6bcce0d2c0b34cca87ecb0bb0ff1e2c865ac6c5d6c0c3e5cd17affe45ad',
  fork_version: '10000910'
};

/**
 * Convert a deposit-cli file entry into deposit data
 *
 * @param entry - Deposit data file entry
 * @returns Deposit data with 0x-prefixed hex fields
 */
function toDepositData(entry: DepositDataFileEntry): DepositData {
  return {
    pubkey: `0x${entry.pubkey}`,
    withdrawalCredentials: `0x${entry.withdrawal_credentials}`,
    amountGwei: BigInt(entry.amount),
    signature: `0x${entry.signature}`
  };
}

describe('deposit-contract', () => {
  describe('roots', () => {
    it.each([
      ['mainnet', MAINNET_ENTRY],
      ['holesky', HOLESKY_ENTRY],
      ['hoodi', HOODI_ENTRY]
    ])('match the deposit-cli roots of the %s vector', (_name, entry) => {
      const data = toDepositData(entry);

      expect(computeDepositMessageRoot(data)).toBe(`0x${entry.deposit_message_root}`);
      expect(computeDepositDataRoot(data)).toBe(`0x${entry.deposit_data_root}`);
    });

    it('changes when amount or withdrawal credentials are tampered', () => {
      const data = toDepositData(MAINNET_ENTRY);

      expect(computeDepositDataRoot({ ...data, amountGwei: 31000000000n })).not.toBe(
        `0x${MAINNET_ENTRY.deposit_data_root}`
      );
      expect(
        computeDepositMessageRoot({ ...data, withdrawalCredentials: `0x02${'0'.repeat(62)}` })
      ).not.toBe(`0x${MAINNET_ENTRY.deposit_message_root}`);
    });
  });

  describe('verifyDepositSignature', () => {
    it.each([
      ['mainnet', MAINNET_ENTRY, application.MAINNET_GENESIS_FORK_VERSION],
      ['holesky', HOLESKY_ENTRY, '0x01017000'],
      ['hoodi', HOODI_ENTRY, application.HOODI_GENESIS_FORK_VERSION]
    ])('accepts the %s vector signature for its own network', (_name, entry, forkVersion) => {
      expect(verifyDepositSignature(toDepositData(entry), forkVersion)).toBe(true);
    });

    it('rejects a signature made for another network', () => {
      expect(
        verifyDepositSignature(toDepositData(HOODI_ENTRY), application.MAINNET_GENESIS_FORK_VERSION)
      ).toBe(false);
      expect(
        verifyDepositSignature(toDepositData(MAINNET_ENTRY), application.HOODI_GENESIS_FORK_VERSION)
      ).toBe(false);
    });

    it('rejects tampered deposit data', () => {
      const data = toDepositData(MAINNET_ENTRY);
      const tampered = {
        ...data,
        withdrawalCredentials: data.withdrawalCredentials.replace('0f51', '1f51')
      };

      expect(verifyDepositSignature(tampered, application.MAINNET_GENESIS_FORK_VERSION)).toBe(
        false
      );
    });

    it('returns false instead of throwing for a malformed signature', () => {
      const data = { ...toDepositData(MAINNET_ENTRY), signature: `0x${'ff'.repeat(96)}` };

      expect(verifyDepositSignature(data, application.MAINNET_GENESIS_FORK_VERSION)).toBe(false);
    });
  });

  describe('encodeDepositCalldata', () => {
    it('encodes the deposit call with the recomputed data root', () => {
      const data = toDepositData(MAINNET_ENTRY);

      const calldata = encodeDepositCalldata(data);

      const decoded = new Interface(application.DEPOSIT_CONTRACT_ABI).decodeFunctionData(
        application.DEPOSIT_FUNCTION_NAME,
        calldata
      );
      expect(decoded.toArray()).toEqual([
        data.pubkey,
        data.withdrawalCredentials,
        data.signature,
        `0x${MAINNET_ENTRY.deposit_data_root}`
      ]);
      expect(calldata).toHaveLength(842);
      expect(calldata.startsWith(application.DEPOSIT_FUNCTION_SELECTOR)).toBe(true);
      expect(extractValidatorPubkey(calldata)).toBe(data.pubkey);
    });

    it('uses the selector of deposit(bytes,bytes,bytes,bytes32)', () => {
      expect(id('deposit(bytes,bytes,bytes,bytes32)').slice(0, 10)).toBe(
        application.DEPOSIT_FUNCTION_SELECTOR
      );
    });
  });
});
