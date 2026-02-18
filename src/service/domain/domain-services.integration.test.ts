import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { JsonRpcProvider } from 'ethers';

import {
  CONSOLIDATION_CONTRACT_ADDRESS,
  WITHDRAWAL_CONTRACT_ADDRESS
} from '../../constants/application';
import type { GlobalCliOptions } from '../../model/commander';
import type { ISigner } from './signer';

const mockProvider = {} as JsonRpcProvider;
const mockSigner = {
  capabilities: {
    supportsParallelSigning: true,
    requiresUserInteraction: false,
    signerType: 'wallet'
  },
  address: '0xMockAddress',
  sendTransaction: mock(() => Promise.resolve({ hash: '0xhash', nonce: 1 })),
  sendTransactionWithNonce: mock(() => Promise.resolve({ hash: '0xhash', nonce: 1 })),
  getCurrentNonce: mock(() => Promise.resolve(0)),
  incrementNonce: mock(),
  dispose: mock(() => Promise.resolve())
} as unknown as ISigner;

const mockCreateEthereumConnection = mock(() =>
  Promise.resolve({ provider: mockProvider, signer: mockSigner })
);

const mockSendExecutionLayerRequests = mock(() => Promise.resolve());
const mockCheckCompoundingCredentials = mock(() => Promise.resolve());
const mockCheckHasExecutionCredentials = mock(() => Promise.resolve());
const mockCheckWithdrawalAddressOwnership = mock(() => Promise.resolve());
const mockFilterSwitchableValidators = mock((_beaconApiUrl: string, validatorPubkeys: string[]) =>
  Promise.resolve(validatorPubkeys)
);

mock.module('./ethereum', () => ({
  createEthereumConnection: mockCreateEthereumConnection
}));

mock.module('./request/send-request', () => ({
  sendExecutionLayerRequests: mockSendExecutionLayerRequests
}));

mock.module('./pre-request-validation', () => ({
  checkCompoundingCredentials: mockCheckCompoundingCredentials,
  checkHasExecutionCredentials: mockCheckHasExecutionCredentials,
  checkWithdrawalAddressOwnership: mockCheckWithdrawalAddressOwnership,
  filterSwitchableValidators: mockFilterSwitchableValidators
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
  ledger: false,
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
    mockCheckCompoundingCredentials.mockClear();
    mockCheckHasExecutionCredentials.mockClear();
    mockCheckWithdrawalAddressOwnership.mockClear();
    mockFilterSwitchableValidators.mockClear();
    mockFilterSwitchableValidators.mockImplementation(
      (_beaconApiUrl: string, validatorPubkeys: string[]) => Promise.resolve(validatorPubkeys)
    );
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('consolidate', () => {
    it('creates ethereum connection with json rpc url', async () => {
      const options = createGlobalOptions({ jsonRpcUrl: 'http://custom:8545' });

      await consolidate(options, [VALID_PUBKEY], VALID_TARGET_PUBKEY);

      expect(mockCreateEthereumConnection).toHaveBeenCalledWith('http://custom:8545', 'wallet');
    });

    it('checks compounding credentials for target validator', async () => {
      const options = createGlobalOptions();

      await consolidate(options, [VALID_PUBKEY], VALID_TARGET_PUBKEY);

      expect(mockCheckCompoundingCredentials).toHaveBeenCalledWith(options.beaconApiUrl, [
        VALID_TARGET_PUBKEY
      ]);
    });

    it('checks execution credentials for source validators', async () => {
      const options = createGlobalOptions();

      await consolidate(options, [VALID_PUBKEY], VALID_TARGET_PUBKEY);

      expect(mockCheckHasExecutionCredentials).toHaveBeenCalledWith(
        options.beaconApiUrl,
        [VALID_PUBKEY],
        expect.any(Function)
      );
    });

    it('sends requests to consolidation contract address', async () => {
      const options = createGlobalOptions();

      await consolidate(options, [VALID_PUBKEY], VALID_TARGET_PUBKEY);

      expect(mockSendExecutionLayerRequests).toHaveBeenCalledWith(
        CONSOLIDATION_CONTRACT_ADDRESS,
        mockProvider,
        mockSigner,
        expect.any(Array),
        options.maxRequestsPerBlock,
        options.beaconApiUrl
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
        expect.any(Number),
        expect.any(String)
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
        expect.any(Number),
        expect.any(String)
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
        5,
        expect.any(String)
      );
    });

    it('checks withdrawal address ownership for source and target validators', async () => {
      const options = createGlobalOptions();

      await consolidate(options, [VALID_PUBKEY], VALID_TARGET_PUBKEY);

      expect(mockCheckWithdrawalAddressOwnership).toHaveBeenCalledWith(
        options.beaconApiUrl,
        '0xMockAddress',
        [VALID_TARGET_PUBKEY, VALID_PUBKEY]
      );
    });

    it('skips target ownership check when flag is true', async () => {
      const options = createGlobalOptions();

      await consolidate(options, [VALID_PUBKEY], VALID_TARGET_PUBKEY, true);

      expect(mockCheckWithdrawalAddressOwnership).toHaveBeenCalledWith(
        options.beaconApiUrl,
        '0xMockAddress',
        [VALID_PUBKEY]
      );
    });
  });

  describe('withdraw', () => {
    it('creates ethereum connection with json rpc url', async () => {
      const options = createGlobalOptions({ jsonRpcUrl: 'http://custom:8545' });

      await withdraw(options, [VALID_PUBKEY], 1);

      expect(mockCreateEthereumConnection).toHaveBeenCalledWith('http://custom:8545', 'wallet');
    });

    it('checks compounding credentials when amount is positive', async () => {
      const options = createGlobalOptions();

      await withdraw(options, [VALID_PUBKEY], 1);

      expect(mockCheckCompoundingCredentials).toHaveBeenCalledWith(options.beaconApiUrl, [
        VALID_PUBKEY
      ]);
    });

    it('does not check withdrawal credentials when amount is 0 (exit)', async () => {
      const options = createGlobalOptions();

      await withdraw(options, [VALID_PUBKEY], 0);

      expect(mockCheckCompoundingCredentials).not.toHaveBeenCalled();
    });

    it('sends requests to withdrawal contract address', async () => {
      const options = createGlobalOptions();

      await withdraw(options, [VALID_PUBKEY], 1);

      expect(mockSendExecutionLayerRequests).toHaveBeenCalledWith(
        WITHDRAWAL_CONTRACT_ADDRESS,
        mockProvider,
        mockSigner,
        expect.any(Array),
        options.maxRequestsPerBlock,
        options.beaconApiUrl
      );
    });

    it('creates correct request data with amount in gwei hex format', async () => {
      const options = createGlobalOptions();

      await withdraw(options, [VALID_PUBKEY], 1);

      const amountGweiHex = 1_000_000_000n.toString(16).padStart(16, '0');
      const expectedData = '0x' + 'ab'.repeat(48) + amountGweiHex;
      expect(mockSendExecutionLayerRequests).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        expect.anything(),
        [expectedData],
        expect.any(Number),
        expect.any(String)
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
        expect.any(Number),
        expect.any(String)
      );
    });

    it('creates correct request data for fractional ETH amounts', async () => {
      const options = createGlobalOptions();

      await withdraw(options, [VALID_PUBKEY], 0.001);

      const amountGweiHex = 1_000_000n.toString(16).padStart(16, '0');
      const expectedData = '0x' + 'ab'.repeat(48) + amountGweiHex;
      expect(mockSendExecutionLayerRequests).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        expect.anything(),
        [expectedData],
        expect.any(Number),
        expect.any(String)
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
        expect.arrayContaining([
          expect.stringContaining('ab'.repeat(48)),
          expect.stringContaining('ef'.repeat(48))
        ]),
        expect.any(Number),
        expect.any(String)
      );
    });

    it('checks withdrawal address ownership for validators', async () => {
      const options = createGlobalOptions();

      await withdraw(options, [VALID_PUBKEY], 1);

      expect(mockCheckWithdrawalAddressOwnership).toHaveBeenCalledWith(
        options.beaconApiUrl,
        '0xMockAddress',
        [VALID_PUBKEY]
      );
    });
  });

  describe('exit', () => {
    it('delegates to withdraw with amount 0', async () => {
      const options = createGlobalOptions();

      await exit(options, [VALID_PUBKEY]);

      const expectedData = '0x' + 'ab'.repeat(48) + '0'.repeat(16);
      expect(mockSendExecutionLayerRequests).toHaveBeenCalledWith(
        WITHDRAWAL_CONTRACT_ADDRESS,
        expect.anything(),
        expect.anything(),
        [expectedData],
        expect.any(Number),
        expect.any(String)
      );
    });

    it('checks exit credentials before delegating to withdraw', async () => {
      const options = createGlobalOptions();

      await exit(options, [VALID_PUBKEY]);

      expect(mockCheckHasExecutionCredentials).toHaveBeenCalledWith(
        options.beaconApiUrl,
        [VALID_PUBKEY],
        expect.any(Function)
      );
      expect(mockCheckCompoundingCredentials).not.toHaveBeenCalled();
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
        expect.any(Number),
        expect.any(String)
      );
    });

    it('checks withdrawal address ownership for validators', async () => {
      const options = createGlobalOptions();

      await exit(options, [VALID_PUBKEY]);

      expect(mockCheckWithdrawalAddressOwnership).toHaveBeenCalledWith(
        options.beaconApiUrl,
        '0xMockAddress',
        [VALID_PUBKEY]
      );
    });
  });

  describe('switchWithdrawalCredentialType', () => {
    it('calls filterSwitchableValidators before pipeline', async () => {
      const options = createGlobalOptions();

      await switchWithdrawalCredentialType(options, [VALID_PUBKEY]);

      expect(mockFilterSwitchableValidators).toHaveBeenCalledWith(options.beaconApiUrl, [
        VALID_PUBKEY
      ]);
    });

    it('sends requests to consolidation contract address', async () => {
      const options = createGlobalOptions();

      await switchWithdrawalCredentialType(options, [VALID_PUBKEY]);

      const expectedData = '0x' + 'ab'.repeat(48) + 'ab'.repeat(48);
      expect(mockSendExecutionLayerRequests).toHaveBeenCalledWith(
        CONSOLIDATION_CONTRACT_ADDRESS,
        expect.anything(),
        expect.anything(),
        [expectedData],
        expect.any(Number),
        expect.any(String)
      );
    });

    it('filters out validators that already have 0x02 credentials', async () => {
      const options = createGlobalOptions();
      const pubkey2 = '0x' + 'ef'.repeat(48);
      mockFilterSwitchableValidators.mockImplementation(() => Promise.resolve([VALID_PUBKEY]));

      await switchWithdrawalCredentialType(options, [VALID_PUBKEY, pubkey2]);

      const expectedData = '0x' + 'ab'.repeat(48) + 'ab'.repeat(48);
      expect(mockSendExecutionLayerRequests).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        expect.anything(),
        [expectedData],
        expect.any(Number),
        expect.any(String)
      );
    });

    it('returns early without establishing connection when all validators already have 0x02', async () => {
      const options = createGlobalOptions();
      mockFilterSwitchableValidators.mockImplementation(() => Promise.resolve([]));

      await switchWithdrawalCredentialType(options, [VALID_PUBKEY]);

      expect(mockCreateEthereumConnection).not.toHaveBeenCalled();
      expect(mockSendExecutionLayerRequests).not.toHaveBeenCalled();
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
        expect.any(Number),
        expect.any(String)
      );
    });

    it('checks withdrawal address ownership for switchable validators', async () => {
      const options = createGlobalOptions();

      await switchWithdrawalCredentialType(options, [VALID_PUBKEY]);

      expect(mockCheckWithdrawalAddressOwnership).toHaveBeenCalledWith(
        options.beaconApiUrl,
        '0xMockAddress',
        [VALID_PUBKEY]
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
          expect.any(Number),
          expect.any(String)
        );
      });
    }
  });
});
