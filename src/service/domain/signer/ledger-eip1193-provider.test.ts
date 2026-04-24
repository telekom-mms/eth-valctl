import {
  DisconnectedDevice,
  DisconnectedDeviceDuringOperation,
  LockedDeviceError,
  TransportStatusError,
  UserRefusedOnDevice
} from '@ledgerhq/errors';
import type Eth from '@ledgerhq/hw-app-eth';
import type Transport from '@ledgerhq/hw-transport';
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { JsonRpcProvider } from 'ethers';

import {
  EIP_1193_METHOD_ETH_ACCOUNTS,
  EIP_1193_METHOD_ETH_REQUEST_ACCOUNTS,
  EIP_1193_METHOD_ETH_SEND_TRANSACTION,
  EIP_1193_METHOD_ETH_SIGN,
  EIP_1193_METHOD_ETH_SIGN_TRANSACTION,
  EIP_1193_METHOD_ETH_SIGN_TYPED_DATA_V4,
  EIP_1193_METHOD_PERSONAL_SIGN
} from '../../../constants/application';
import { Eip1193ProviderError, LedgerEip1193Provider } from './ledger-eip1193-provider';

const TEST_ADDRESS = '0x1234567890123456789012345678901234567890';
const TEST_DERIVATION_PATH = "44'/60'/0'/0/0";
const TEST_MESSAGE_HEX = '0x48656c6c6f';

const MOCK_PERSONAL_SIGNATURE = {
  v: 27,
  r: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
  s: 'f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5'
};

const MOCK_TX_SIGNATURE = {
  v: '01',
  r: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
  s: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
};

type MockFn = ReturnType<typeof mock>;

function createMocks() {
  const transportClose = mock(() => Promise.resolve());
  const signPersonalMessage = mock(() => Promise.resolve(MOCK_PERSONAL_SIGNATURE));
  const signEIP712HashedMessage = mock(() => Promise.resolve(MOCK_PERSONAL_SIGNATURE));
  const signTransaction = mock(() => Promise.resolve(MOCK_TX_SIGNATURE));
  const providerSend = mock(() => Promise.resolve('0x1'));
  const getNetwork = mock(() => Promise.resolve({ chainId: 1n }));
  const getFeeData = mock(() =>
    Promise.resolve({ maxFeePerGas: 30000000000n, maxPriorityFeePerGas: 1000000000n })
  );
  const getTransactionCount = mock(() => Promise.resolve(5));
  const estimateGas = mock(() => Promise.resolve(21000n));
  const broadcastTransaction = mock(() => Promise.resolve({ hash: '0xdeadbeef' }));

  return {
    transportClose,
    signPersonalMessage,
    signEIP712HashedMessage,
    signTransaction,
    providerSend,
    getNetwork,
    getFeeData,
    getTransactionCount,
    estimateGas,
    broadcastTransaction,
    transport: { close: transportClose } as unknown as Transport,
    eth: { signPersonalMessage, signEIP712HashedMessage, signTransaction } as unknown as Eth,
    jsonRpcProvider: {
      send: providerSend,
      getNetwork,
      getFeeData,
      getTransactionCount,
      estimateGas,
      broadcastTransaction
    } as unknown as JsonRpcProvider
  };
}

describe('LedgerEip1193Provider', () => {
  let adapter: LedgerEip1193Provider;
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    mocks = createMocks();
    adapter = new LedgerEip1193Provider(
      mocks.transport,
      mocks.eth,
      TEST_DERIVATION_PATH,
      TEST_ADDRESS,
      mocks.jsonRpcProvider
    );
  });

  describe('eth_accounts', () => {
    it('returns array containing the Ledger-derived address', async () => {
      const result = await adapter.request({ method: EIP_1193_METHOD_ETH_ACCOUNTS });

      expect(result).toEqual([TEST_ADDRESS]);
    });
  });

  describe('eth_requestAccounts', () => {
    it('returns array containing the Ledger-derived address', async () => {
      const result = await adapter.request({ method: EIP_1193_METHOD_ETH_REQUEST_ACCOUNTS });

      expect(result).toEqual([TEST_ADDRESS]);
    });
  });

  describe('eth_sign', () => {
    it('signs raw hash via Ledger signPersonalMessage', async () => {
      const hash = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

      const result = await adapter.request({
        method: EIP_1193_METHOD_ETH_SIGN,
        params: [TEST_ADDRESS, hash]
      });

      expect(mocks.signPersonalMessage).toHaveBeenCalledWith(TEST_DERIVATION_PATH, hash.slice(2));
      expect(result).toMatch(/^0x[a-f0-9]{130}$/);
    });
  });

  describe('personal_sign', () => {
    it('signs personal message via Ledger signPersonalMessage', async () => {
      const result = await adapter.request({
        method: EIP_1193_METHOD_PERSONAL_SIGN,
        params: [TEST_MESSAGE_HEX, TEST_ADDRESS]
      });

      expect(mocks.signPersonalMessage).toHaveBeenCalledWith(
        TEST_DERIVATION_PATH,
        TEST_MESSAGE_HEX.slice(2)
      );
      expect(result).toMatch(/^0x[a-f0-9]{130}$/);
    });
  });

  describe('eth_signTypedData_v4', () => {
    const typedData = {
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'chainId', type: 'uint256' }
        ],
        SafeTx: [
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' }
        ]
      },
      primaryType: 'SafeTx',
      domain: { name: 'Test', chainId: 1 },
      message: {
        to: '0x0000000000000000000000000000000000000001',
        value: 0
      }
    };

    it('signs EIP-712 typed data via Ledger signEIP712HashedMessage', async () => {
      const result = await adapter.request({
        method: EIP_1193_METHOD_ETH_SIGN_TYPED_DATA_V4,
        params: [TEST_ADDRESS, typedData]
      });

      expect(mocks.signEIP712HashedMessage).toHaveBeenCalledWith(
        TEST_DERIVATION_PATH,
        expect.any(String),
        expect.any(String)
      );
      expect(result).toMatch(/^0x[a-f0-9]{130}$/);
    });

    it('parses typed data from JSON string', async () => {
      const result = await adapter.request({
        method: EIP_1193_METHOD_ETH_SIGN_TYPED_DATA_V4,
        params: [TEST_ADDRESS, JSON.stringify(typedData)]
      });

      expect(mocks.signEIP712HashedMessage).toHaveBeenCalled();
      expect(result).toMatch(/^0x[a-f0-9]{130}$/);
    });
  });

  describe('eth_signTransaction', () => {
    it('signs transaction via Ledger and returns signed tx hex', async () => {
      const txRequest = {
        to: '0x0000000000000000000000000000000000000001',
        value: '0x0',
        data: '0x',
        gas: '0x5208',
        maxFeePerGas: '0x6fc23ac00',
        maxPriorityFeePerGas: '0x3b9aca00',
        nonce: '0x5'
      };

      const result = await adapter.request({
        method: EIP_1193_METHOD_ETH_SIGN_TRANSACTION,
        params: [txRequest]
      });

      expect(mocks.signTransaction).toHaveBeenCalledWith(
        TEST_DERIVATION_PATH,
        expect.any(String),
        null
      );
      expect(typeof result).toBe('string');
      expect((result as string).startsWith('0x')).toBe(true);
    });
  });

  describe('eth_sendTransaction', () => {
    const txRequest = {
      to: '0x0000000000000000000000000000000000000001',
      value: '0x0',
      data: '0x'
    };

    it('signs and broadcasts transaction, returns tx hash', async () => {
      const result = await adapter.request({
        method: EIP_1193_METHOD_ETH_SEND_TRANSACTION,
        params: [txRequest]
      });

      expect(mocks.signTransaction).toHaveBeenCalled();
      expect(mocks.broadcastTransaction).toHaveBeenCalled();
      expect(result).toBe('0xdeadbeef');
    });

    it('estimates gas when not provided', async () => {
      await adapter.request({
        method: EIP_1193_METHOD_ETH_SEND_TRANSACTION,
        params: [txRequest]
      });

      expect(mocks.estimateGas).toHaveBeenCalled();
    });

    it('fetches nonce when not provided', async () => {
      await adapter.request({
        method: EIP_1193_METHOD_ETH_SEND_TRANSACTION,
        params: [txRequest]
      });

      expect(mocks.getTransactionCount).toHaveBeenCalledWith(TEST_ADDRESS, 'pending');
    });
  });

  describe('delegation', () => {
    it('delegates eth_chainId to JSON-RPC provider', async () => {
      const result = await adapter.request({ method: 'eth_chainId' });

      expect(mocks.providerSend).toHaveBeenCalledWith('eth_chainId', []);
      expect(result).toBe('0x1');
    });

    it('delegates unknown methods to JSON-RPC provider', async () => {
      await adapter.request({
        method: 'eth_getBalance',
        params: [TEST_ADDRESS, 'latest']
      });

      expect(mocks.providerSend).toHaveBeenCalledWith('eth_getBalance', [TEST_ADDRESS, 'latest']);
    });
  });

  describe('error mapping', () => {
    function createAdapterWithFailingSign(error: Error): LedgerEip1193Provider {
      const failingMocks = createMocks();
      (failingMocks.signPersonalMessage as MockFn).mockImplementation(() => {
        throw error;
      });
      return new LedgerEip1193Provider(
        failingMocks.transport,
        failingMocks.eth,
        TEST_DERIVATION_PATH,
        TEST_ADDRESS,
        failingMocks.jsonRpcProvider
      );
    }

    async function requestAndCatchError(failingAdapter: LedgerEip1193Provider): Promise<unknown> {
      return failingAdapter
        .request({
          method: EIP_1193_METHOD_PERSONAL_SIGN,
          params: [TEST_MESSAGE_HEX, TEST_ADDRESS]
        })
        .catch((e: unknown) => e);
    }

    const ledgerErrorMappings: Array<[string, Error, number]> = [
      ['user rejection', new UserRefusedOnDevice(), 4001],
      ['disconnected device', new DisconnectedDevice(), 4900],
      ['disconnected during operation', new DisconnectedDeviceDuringOperation(), 4900],
      ['connection timeout', new Error('Connection timeout'), 4900],
      ['locked device', new LockedDeviceError(), 4900],
      ['ETH app not open', new TransportStatusError(0x6d02), 4900],
      ['unknown Ledger error', new TransportStatusError(0xffff), -32603]
    ];

    it.each(ledgerErrorMappings)(
      'maps %s to EIP-1193 code %i',
      async (_label, ledgerError, expectedCode) => {
        const failingAdapter = createAdapterWithFailingSign(ledgerError);

        const error = await requestAndCatchError(failingAdapter);

        expect(error).toBeInstanceOf(Eip1193ProviderError);
        expect((error as Eip1193ProviderError).code).toBe(expectedCode);
      }
    );

    it('re-throws non-Ledger errors without wrapping', async () => {
      const failingAdapter = createAdapterWithFailingSign(new Error('Network failure'));

      const error = await requestAndCatchError(failingAdapter);

      expect(error).not.toBeInstanceOf(Eip1193ProviderError);
      expect((error as Error).message).toBe('Network failure');
    });
  });

  describe('dispose', () => {
    it('closes USB transport', async () => {
      await adapter.dispose();

      expect(mocks.transportClose).toHaveBeenCalledTimes(1);
    });
  });
});
