import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { JsonRpcProvider, NonceManager } from 'ethers';

import { CONSOLIDATION_CONTRACT_ADDRESS, WITHDRAWAL_CONTRACT_ADDRESS } from '../../constants/application';
import type { GlobalCliOptions } from '../../model/commander';

const mockProvider = {} as JsonRpcProvider;
const mockWallet = {} as NonceManager;

const mockCreateEthereumConnection = mock(() =>
  Promise.resolve({ provider: mockProvider, wallet: mockWallet })
);

const mockSendExecutionLayerRequests = mock(() => Promise.resolve());
const mockCheckWithdrawalCredentialType = mock(() => Promise.resolve());

mock.module('./ethereum', () => ({
  createEthereumConnection: mockCreateEthereumConnection
}));

mock.module('./request/send-request', () => ({
  sendExecutionLayerRequests: mockSendExecutionLayerRequests
}));

mock.module('../validation/pre-request', () => ({
  checkWithdrawalCredentialType: mockCheckWithdrawalCredentialType
}));

const { consolidate } = await import('./consolidate');
const { withdraw } = await import('./withdraw');
const { exit } = await import('./exit');
const { switchWithdrawalCredentialType } = await import('./switch');

const createGlobalOptions = (overrides?: Partial<GlobalCliOptions>): GlobalCliOptions => ({
  network: 'hoodi',
  jsonRpcUrl: 'http://localhost:8545',
  beaconApiUrl: 'http://localhost:5052',
  maxRequestsPerBlock: 10,
  ...overrides
});

const VALID_PUBKEY = '0x' + 'ab'.repeat(48);
const VALID_TARGET_PUBKEY = '0x' + 'cd'.repeat(48);

describe('Domain Services Integration Tests', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let consoleErrorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
    mockCreateEthereumConnection.mockClear();
    mockSendExecutionLayerRequests.mockClear();
    mockCheckWithdrawalCredentialType.mockClear();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('consolidate', () => {
    it('creates ethereum connection with json rpc url', async () => {
      const options = createGlobalOptions({ jsonRpcUrl: 'http://custom:8545' });

      await consolidate(options, [VALID_PUBKEY], VALID_TARGET_PUBKEY);

      expect(mockCreateEthereumConnection).toHaveBeenCalledWith('http://custom:8545');
    });

    it('checks withdrawal credential type for target validator when provided', async () => {
      const options = createGlobalOptions();

      await consolidate(options, [VALID_PUBKEY], VALID_TARGET_PUBKEY);

      expect(mockCheckWithdrawalCredentialType).toHaveBeenCalledWith(
        options.beaconApiUrl,
        [VALID_TARGET_PUBKEY]
      );
    });

    it('does not check withdrawal credentials when no target provided (switch mode)', async () => {
      const options = createGlobalOptions();

      await consolidate(options, [VALID_PUBKEY]);

      expect(mockCheckWithdrawalCredentialType).not.toHaveBeenCalled();
    });

    it('sends requests to consolidation contract address', async () => {
      const options = createGlobalOptions();

      await consolidate(options, [VALID_PUBKEY], VALID_TARGET_PUBKEY);

      expect(mockSendExecutionLayerRequests).toHaveBeenCalledWith(
        CONSOLIDATION_CONTRACT_ADDRESS,
        mockProvider,
        mockWallet,
        expect.any(Array),
        options.maxRequestsPerBlock
      );
    });

    it('creates correct request data for consolidation (source + target)', async () => {
      const options = createGlobalOptions();

      await consolidate(options, [VALID_PUBKEY], VALID_TARGET_PUBKEY);

      const expectedData = '0x' + 'ab'.repeat(48) + 'cd'.repeat(48);
      expect(mockSendExecutionLayerRequests).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        expect.anything(),
        [expectedData],
        expect.any(Number)
      );
    });

    it('creates correct request data for switch (source duplicated as target)', async () => {
      const options = createGlobalOptions();

      await consolidate(options, [VALID_PUBKEY]);

      const expectedData = '0x' + 'ab'.repeat(48) + 'ab'.repeat(48);
      expect(mockSendExecutionLayerRequests).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        expect.anything(),
        [expectedData],
        expect.any(Number)
      );
    });

    it('creates multiple request data entries for multiple source validators', async () => {
      const options = createGlobalOptions();
      const pubkey2 = '0x' + 'ef'.repeat(48);

      await consolidate(options, [VALID_PUBKEY, pubkey2], VALID_TARGET_PUBKEY);

      const expectedData1 = '0x' + 'ab'.repeat(48) + 'cd'.repeat(48);
      const expectedData2 = '0x' + 'ef'.repeat(48) + 'cd'.repeat(48);
      expect(mockSendExecutionLayerRequests).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        expect.anything(),
        [expectedData1, expectedData2],
        expect.any(Number)
      );
    });

    it('respects maxRequestsPerBlock from options', async () => {
      const options = createGlobalOptions({ maxRequestsPerBlock: 5 });

      await consolidate(options, [VALID_PUBKEY], VALID_TARGET_PUBKEY);

      expect(mockSendExecutionLayerRequests).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        expect.anything(),
        expect.any(Array),
        5
      );
    });
  });

  describe('withdraw', () => {
    it('creates ethereum connection with json rpc url', async () => {
      const options = createGlobalOptions({ jsonRpcUrl: 'http://custom:8545' });

      await withdraw(options, [VALID_PUBKEY], 1);

      expect(mockCreateEthereumConnection).toHaveBeenCalledWith('http://custom:8545');
    });

    it('checks withdrawal credential type when amount is positive', async () => {
      const options = createGlobalOptions();

      await withdraw(options, [VALID_PUBKEY], 1);

      expect(mockCheckWithdrawalCredentialType).toHaveBeenCalledWith(
        options.beaconApiUrl,
        [VALID_PUBKEY]
      );
    });

    it('does not check withdrawal credentials when amount is 0 (exit)', async () => {
      const options = createGlobalOptions();

      await withdraw(options, [VALID_PUBKEY], 0);

      expect(mockCheckWithdrawalCredentialType).not.toHaveBeenCalled();
    });

    it('sends requests to withdrawal contract address', async () => {
      const options = createGlobalOptions();

      await withdraw(options, [VALID_PUBKEY], 1);

      expect(mockSendExecutionLayerRequests).toHaveBeenCalledWith(
        WITHDRAWAL_CONTRACT_ADDRESS,
        mockProvider,
        mockWallet,
        expect.any(Array),
        options.maxRequestsPerBlock
      );
    });

    it('creates correct request data with amount in gwei hex format', async () => {
      const options = createGlobalOptions();

      await withdraw(options, [VALID_PUBKEY], 1);

      const amountGweiHex = (1_000_000_000n).toString(16).padStart(16, '0');
      const expectedData = '0x' + 'ab'.repeat(48) + amountGweiHex;
      expect(mockSendExecutionLayerRequests).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        expect.anything(),
        [expectedData],
        expect.any(Number)
      );
    });

    it('creates correct request data for exit (amount 0)', async () => {
      const options = createGlobalOptions();

      await withdraw(options, [VALID_PUBKEY], 0);

      const expectedData = '0x' + 'ab'.repeat(48) + '0'.repeat(16);
      expect(mockSendExecutionLayerRequests).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        expect.anything(),
        [expectedData],
        expect.any(Number)
      );
    });

    it('creates correct request data for fractional ETH amounts', async () => {
      const options = createGlobalOptions();

      await withdraw(options, [VALID_PUBKEY], 0.001);

      const amountGweiHex = (1_000_000n).toString(16).padStart(16, '0');
      const expectedData = '0x' + 'ab'.repeat(48) + amountGweiHex;
      expect(mockSendExecutionLayerRequests).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        expect.anything(),
        [expectedData],
        expect.any(Number)
      );
    });

    it('creates multiple request data entries for multiple validators', async () => {
      const options = createGlobalOptions();
      const pubkey2 = '0x' + 'ef'.repeat(48);

      await withdraw(options, [VALID_PUBKEY, pubkey2], 1);

      expect(mockSendExecutionLayerRequests).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        expect.anything(),
        expect.arrayContaining([expect.stringContaining('ab'.repeat(48)), expect.stringContaining('ef'.repeat(48))]),
        expect.any(Number)
      );
    });
  });

  describe('exit', () => {
    it('logs exit warning', async () => {
      const options = createGlobalOptions();

      await exit(options, [VALID_PUBKEY]);

      expect(consoleSpy).toHaveBeenCalled();
    });

    it('delegates to withdraw with amount 0', async () => {
      const options = createGlobalOptions();

      await exit(options, [VALID_PUBKEY]);

      const expectedData = '0x' + 'ab'.repeat(48) + '0'.repeat(16);
      expect(mockSendExecutionLayerRequests).toHaveBeenCalledWith(
        WITHDRAWAL_CONTRACT_ADDRESS,
        expect.anything(),
        expect.anything(),
        [expectedData],
        expect.any(Number)
      );
    });

    it('does not check withdrawal credentials (exit bypasses check)', async () => {
      const options = createGlobalOptions();

      await exit(options, [VALID_PUBKEY]);

      expect(mockCheckWithdrawalCredentialType).not.toHaveBeenCalled();
    });

    it('processes multiple validators', async () => {
      const options = createGlobalOptions();
      const pubkey2 = '0x' + 'ef'.repeat(48);

      await exit(options, [VALID_PUBKEY, pubkey2]);

      expect(mockSendExecutionLayerRequests).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        expect.anything(),
        expect.arrayContaining([
          expect.stringContaining('ab'.repeat(48)),
          expect.stringContaining('ef'.repeat(48))
        ]),
        expect.any(Number)
      );
    });
  });

  describe('switchWithdrawalCredentialType', () => {
    it('delegates to consolidate without target', async () => {
      const options = createGlobalOptions();

      await switchWithdrawalCredentialType(options, [VALID_PUBKEY]);

      const expectedData = '0x' + 'ab'.repeat(48) + 'ab'.repeat(48);
      expect(mockSendExecutionLayerRequests).toHaveBeenCalledWith(
        CONSOLIDATION_CONTRACT_ADDRESS,
        expect.anything(),
        expect.anything(),
        [expectedData],
        expect.any(Number)
      );
    });

    it('does not check withdrawal credentials', async () => {
      const options = createGlobalOptions();

      await switchWithdrawalCredentialType(options, [VALID_PUBKEY]);

      expect(mockCheckWithdrawalCredentialType).not.toHaveBeenCalled();
    });

    it('processes multiple validators creating self-consolidation for each', async () => {
      const options = createGlobalOptions();
      const pubkey2 = '0x' + 'ef'.repeat(48);

      await switchWithdrawalCredentialType(options, [VALID_PUBKEY, pubkey2]);

      const expectedData1 = '0x' + 'ab'.repeat(48) + 'ab'.repeat(48);
      const expectedData2 = '0x' + 'ef'.repeat(48) + 'ef'.repeat(48);
      expect(mockSendExecutionLayerRequests).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        expect.anything(),
        [expectedData1, expectedData2],
        expect.any(Number)
      );
    });
  });

  describe('network configuration', () => {
    const networks = ['mainnet', 'hoodi', 'sepolia', 'kurtosis_devnet'] as const;

    for (const network of networks) {
      it(`uses correct contract addresses for ${network} network`, async () => {
        const options = createGlobalOptions({ network });

        await consolidate(options, [VALID_PUBKEY], VALID_TARGET_PUBKEY);

        expect(mockSendExecutionLayerRequests).toHaveBeenCalledWith(
          CONSOLIDATION_CONTRACT_ADDRESS,
          expect.anything(),
          expect.anything(),
          expect.any(Array),
          expect.any(Number)
        );
      });
    }
  });
});
