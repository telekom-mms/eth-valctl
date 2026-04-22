import * as ethereumjsTxReal from '@ethereumjs/tx';
import { DisconnectedDeviceDuringOperation, UserRefusedOnDevice } from '@ledgerhq/errors';
import * as hwAppEthReal from '@ledgerhq/hw-app-eth';
import type Transport from '@ledgerhq/hw-transport';
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { JsonRpcProvider, TransactionResponse } from 'ethers';

import { PENDING_BLOCK_TAG } from '../../../constants/application';
import {
  LEDGER_CONNECTED_INFO,
  LEDGER_CONNECTING_INFO,
  LEDGER_CONNECTION_TIMEOUT_ERROR,
  LEDGER_DEVICE_DISCONNECTED_DURING_OPERATION_ERROR,
  LEDGER_DISCONNECTED_INFO,
  LEDGER_SIGN_GENERIC_PROMPT,
  LEDGER_SIGN_PROMPT,
  LEDGER_USER_REJECTED_ERROR
} from '../../../constants/logging';
import type { ExecutionLayerRequestTransaction, SigningContext } from '../../../model/ethereum';
import { TransactionProgressLogger } from '../request/transaction-progress-logger';

const TEST_DERIVATION_PATH = "44'/60'/0'/0/0";
const TEST_ADDRESS = '0x1234567890123456789012345678901234567890';
const TEST_CHAIN_ID = 1n;
const TEST_INITIAL_NONCE = 7;

const MOCK_ETH_SIGNATURE = {
  v: '01',
  r: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
  s: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
};

const mockTransportCreate = mock(() => Promise.resolve({} as Transport));

mock.module('@ledgerhq/hw-transport-node-hid', () => ({
  default: { create: mockTransportCreate }
}));

const mockEthGetAddress = mock(() => Promise.resolve({ address: TEST_ADDRESS, publicKey: '0x00' }));
const mockEthSignTransaction = mock(() => Promise.resolve(MOCK_ETH_SIGNATURE));
const mockResolveTransaction = mock(() => Promise.resolve({}));

class MockEth {
  constructor(public readonly transport: Transport) {}
  getAddress = mockEthGetAddress;
  signTransaction = mockEthSignTransaction;
}

mock.module('@ledgerhq/hw-app-eth', () => ({
  ...hwAppEthReal,
  default: MockEth,
  ledgerService: { resolveTransaction: mockResolveTransaction }
}));

const mockGetMessageToSign = mock(() => new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
const mockSerialize = mock(() => new Uint8Array([0x01, 0x02, 0x03]));

const mockCreateFeeMarket1559Tx = mock((_txData: unknown, _opts: unknown) => ({
  getMessageToSign: mockGetMessageToSign,
  serialize: mockSerialize
}));

mock.module('@ethereumjs/tx', () => ({
  ...ethereumjsTxReal,
  createFeeMarket1559Tx: mockCreateFeeMarket1559Tx
}));

const { LedgerSigner } = await import('./ledger-signer');

/**
 * Flatten a console spy's recorded calls into a single string per call so
 * callers can assert with `.some()` and `.includes()` without dealing with
 * the variadic any-typed `mock.calls` array shape.
 *
 * @param spy - The spy instance returned by `spyOn(console, 'log' | 'error')`
 * @returns Each recorded call joined as a single whitespace-separated string
 */
function collectConsoleMessages(spy: ReturnType<typeof spyOn>): string[] {
  const calls = spy.mock.calls as unknown[][];
  return calls.map((call) => call.map((arg) => String(arg)).join(' '));
}

/**
 * Build a minimal JsonRpcProvider test double exposing only the methods
 * consumed by LedgerSigner's create and sendTransaction paths.
 *
 * @param overrides - Optional per-test overrides for individual methods
 * @returns Mock provider and references to its individual mock functions
 */
function createMockProvider(
  overrides: Partial<{
    getNetwork: ReturnType<typeof mock>;
    getTransactionCount: ReturnType<typeof mock>;
    getFeeData: ReturnType<typeof mock>;
    broadcastTransaction: ReturnType<typeof mock>;
  }> = {}
) {
  const getNetwork =
    overrides.getNetwork ?? mock(() => Promise.resolve({ chainId: TEST_CHAIN_ID }));
  const getTransactionCount =
    overrides.getTransactionCount ?? mock(() => Promise.resolve(TEST_INITIAL_NONCE));
  const getFeeData =
    overrides.getFeeData ??
    mock(() =>
      Promise.resolve({ maxFeePerGas: 30_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n })
    );
  const broadcastTransaction =
    overrides.broadcastTransaction ??
    mock(() => Promise.resolve({ hash: '0xabc', nonce: 0 } as unknown as TransactionResponse));

  const provider = {
    getNetwork,
    getTransactionCount,
    getFeeData,
    broadcastTransaction
  } as unknown as JsonRpcProvider;

  return { provider, getNetwork, getTransactionCount, getFeeData, broadcastTransaction };
}

/**
 * Build a default valid execution-layer request transaction for signing tests.
 *
 * @returns Transaction payload with placeholder values
 */
function buildTxFixture(
  overrides: Partial<ExecutionLayerRequestTransaction> = {}
): ExecutionLayerRequestTransaction {
  return {
    to: '0x0000000000000000000000000000000000000001',
    data: '0xdeadbeef',
    value: 1n,
    gasLimit: 200_000n,
    ...overrides
  };
}

/**
 * Create a Ledger signer with fully configured mocks and return handles
 * to the underlying doubles for per-test assertion.
 *
 * @param providerOverrides - Optional provider method overrides
 * @returns Initialized signer and references to its collaborators
 */
async function createLedgerSignerForTest(
  providerOverrides: Parameters<typeof createMockProvider>[0] = {}
) {
  const transportClose = mock(() => Promise.resolve());
  const transport = { close: transportClose } as unknown as Transport;
  mockTransportCreate.mockImplementation(() => Promise.resolve(transport));

  const providerDoubles = createMockProvider(providerOverrides);
  const logger = new TransactionProgressLogger();

  const signer = await LedgerSigner.create(providerDoubles.provider, logger, TEST_DERIVATION_PATH);

  return { signer, logger, transport, transportClose, ...providerDoubles };
}

describe('LedgerSigner', () => {
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let consoleErrorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    mockTransportCreate.mockReset();
    mockTransportCreate.mockImplementation(() => Promise.resolve({} as Transport));
    mockEthGetAddress.mockReset();
    mockEthGetAddress.mockImplementation(() =>
      Promise.resolve({ address: TEST_ADDRESS, publicKey: '0x00' })
    );
    mockEthSignTransaction.mockReset();
    mockEthSignTransaction.mockImplementation(() => Promise.resolve(MOCK_ETH_SIGNATURE));
    mockResolveTransaction.mockReset();
    mockResolveTransaction.mockImplementation(() => Promise.resolve({}));
    mockGetMessageToSign.mockReset();
    mockGetMessageToSign.mockImplementation(() => new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    mockSerialize.mockReset();
    mockSerialize.mockImplementation(() => new Uint8Array([0x01, 0x02, 0x03]));
    mockCreateFeeMarket1559Tx.mockClear();

    consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('create', () => {
    it('calls connectWithTimeout exactly once', async () => {
      await createLedgerSignerForTest();

      expect(mockTransportCreate).toHaveBeenCalledTimes(1);
    });

    it('logs connecting and connected messages with the resolved address', async () => {
      await createLedgerSignerForTest();

      const logMessages = collectConsoleMessages(consoleLogSpy);
      expect(logMessages.some((m) => m.includes(LEDGER_CONNECTING_INFO))).toBe(true);
      expect(logMessages.some((m) => m.includes(LEDGER_CONNECTED_INFO(TEST_ADDRESS)))).toBe(true);
    });

    it('fetches the pending nonce via provider.getTransactionCount', async () => {
      const { getTransactionCount } = await createLedgerSignerForTest();

      expect(getTransactionCount).toHaveBeenCalledTimes(1);
      expect(getTransactionCount).toHaveBeenCalledWith(TEST_ADDRESS, PENDING_BLOCK_TAG);
    });

    it('exposes the Ledger-derived address on the signer instance', async () => {
      const { signer } = await createLedgerSignerForTest();

      expect(signer.address).toBe(TEST_ADDRESS);
    });

    it('reports supportsParallelSigning=false so the broadcast strategy selects sequential', async () => {
      const { signer } = await createLedgerSignerForTest();

      expect(signer.capabilities.supportsParallelSigning).toBe(false);
    });
  });

  describe('create failure handling', () => {
    it('re-throws the original transport error, logs the classified message, and does not open Eth when connectWithTimeout rejects', async () => {
      const timeoutError = new Error('Connection timeout');
      mockTransportCreate.mockImplementation(() => Promise.reject(timeoutError));

      const logger = new TransactionProgressLogger();
      const { provider } = createMockProvider();

      await expect(LedgerSigner.create(provider, logger, TEST_DERIVATION_PATH)).rejects.toBe(
        timeoutError
      );

      expect(mockEthGetAddress).not.toHaveBeenCalled();
      const errorMessages = collectConsoleMessages(consoleErrorSpy);
      expect(errorMessages.some((m) => m.includes(LEDGER_CONNECTION_TIMEOUT_ERROR))).toBe(true);
    });

    it('closes the transport and re-throws when eth.getAddress rejects', async () => {
      const transportClose = mock(() => Promise.resolve());
      const transport = { close: transportClose } as unknown as Transport;
      mockTransportCreate.mockImplementation(() => Promise.resolve(transport));

      const addressError = new Error('device locked');
      mockEthGetAddress.mockImplementation(() => Promise.reject(addressError));

      const { provider } = createMockProvider();
      const logger = new TransactionProgressLogger();

      await expect(LedgerSigner.create(provider, logger, TEST_DERIVATION_PATH)).rejects.toBe(
        addressError
      );

      expect(transportClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('sendTransaction (auto-nonce)', () => {
    it('uses the nonce captured at create time for the first call', async () => {
      const { signer, broadcastTransaction } = await createLedgerSignerForTest();
      mockCreateFeeMarket1559Tx.mockClear();

      await signer.sendTransaction(buildTxFixture());

      const firstCallTxData = mockCreateFeeMarket1559Tx.mock.calls[0]?.[0] as
        | { nonce: bigint }
        | undefined;
      expect(firstCallTxData?.nonce).toBe(BigInt(TEST_INITIAL_NONCE));
      expect(broadcastTransaction).toHaveBeenCalledTimes(1);
    });

    it('increments the internal nonce only on success', async () => {
      const { signer } = await createLedgerSignerForTest();
      mockCreateFeeMarket1559Tx.mockClear();

      await signer.sendTransaction(buildTxFixture());
      await signer.sendTransaction(buildTxFixture());

      const firstNonce = (mockCreateFeeMarket1559Tx.mock.calls[0]?.[0] as { nonce: bigint }).nonce;
      const secondNonce = (mockCreateFeeMarket1559Tx.mock.calls[2]?.[0] as { nonce: bigint }).nonce;
      expect(firstNonce).toBe(BigInt(TEST_INITIAL_NONCE));
      expect(secondNonce).toBe(BigInt(TEST_INITIAL_NONCE + 1));
    });

    it('does not advance the nonce when signing rejects (user rejected on device)', async () => {
      const { signer } = await createLedgerSignerForTest();
      const rejection = new UserRefusedOnDevice();
      mockEthSignTransaction.mockImplementationOnce(() => Promise.reject(rejection));

      await expect(signer.sendTransaction(buildTxFixture())).rejects.toBe(rejection);

      mockEthSignTransaction.mockImplementation(() => Promise.resolve(MOCK_ETH_SIGNATURE));
      mockCreateFeeMarket1559Tx.mockClear();

      await signer.sendTransaction(buildTxFixture());

      const retryNonce = (mockCreateFeeMarket1559Tx.mock.calls[0]?.[0] as { nonce: bigint }).nonce;
      expect(retryNonce).toBe(BigInt(TEST_INITIAL_NONCE));
    });

    it('logs the generic Ledger signing prompt when no SigningContext is provided', async () => {
      const { signer } = await createLedgerSignerForTest();
      consoleLogSpy.mockClear();

      await signer.sendTransaction(buildTxFixture());

      const logMessages = collectConsoleMessages(consoleLogSpy);
      expect(logMessages.some((m) => m.includes(LEDGER_SIGN_GENERIC_PROMPT))).toBe(true);
    });

    it('logs the contextual Ledger signing prompt when a SigningContext is provided', async () => {
      const { signer } = await createLedgerSignerForTest();
      consoleLogSpy.mockClear();

      const context: SigningContext = {
        currentIndex: 2,
        totalCount: 5,
        validatorPubkey: '0x' + 'ab'.repeat(48)
      };
      await signer.sendTransaction(buildTxFixture(), context);

      const expected = LEDGER_SIGN_PROMPT(
        context.currentIndex,
        context.totalCount,
        context.validatorPubkey
      );
      const logMessages = collectConsoleMessages(consoleLogSpy);
      expect(logMessages.some((m) => m.includes(expected))).toBe(true);
    });

    it('returns a 0x-prefixed serialized transaction from broadcastTransaction input', async () => {
      const { signer, broadcastTransaction } = await createLedgerSignerForTest();

      await signer.sendTransaction(buildTxFixture());

      const broadcastArg = broadcastTransaction.mock.calls[0]?.[0] as string;
      expect(broadcastArg.startsWith('0x')).toBe(true);
    });
  });

  describe('sendTransactionWithNonce', () => {
    it('uses the explicit nonce without reading internal state', async () => {
      const { signer } = await createLedgerSignerForTest();
      mockCreateFeeMarket1559Tx.mockClear();

      await signer.sendTransactionWithNonce(buildTxFixture(), 42);

      const txData = mockCreateFeeMarket1559Tx.mock.calls[0]?.[0] as { nonce: bigint };
      expect(txData.nonce).toBe(42n);
    });

    it('does not mutate the internal nonce used by subsequent sendTransaction calls', async () => {
      const { signer } = await createLedgerSignerForTest();

      await signer.sendTransactionWithNonce(buildTxFixture(), 999);

      mockCreateFeeMarket1559Tx.mockClear();
      await signer.sendTransaction(buildTxFixture());

      const txData = mockCreateFeeMarket1559Tx.mock.calls[0]?.[0] as { nonce: bigint };
      expect(txData.nonce).toBe(BigInt(TEST_INITIAL_NONCE));
    });
  });

  describe('buildUnsignedTransaction fee fallbacks', () => {
    it('prefers caller-supplied maxFeePerGas and maxPriorityFeePerGas over provider fee data', async () => {
      const { signer, getFeeData } = await createLedgerSignerForTest();
      mockCreateFeeMarket1559Tx.mockClear();

      const callerMaxFeePerGas = 77_777_777_777n;
      const callerMaxPriorityFeePerGas = 3_000_000_000n;

      await signer.sendTransaction(
        buildTxFixture({
          maxFeePerGas: callerMaxFeePerGas,
          maxPriorityFeePerGas: callerMaxPriorityFeePerGas
        })
      );

      const txData = mockCreateFeeMarket1559Tx.mock.calls[0]?.[0] as {
        maxFeePerGas: bigint;
        maxPriorityFeePerGas: bigint;
      };
      expect(txData.maxFeePerGas).toBe(callerMaxFeePerGas);
      expect(txData.maxPriorityFeePerGas).toBe(callerMaxPriorityFeePerGas);
      expect(getFeeData).toHaveBeenCalledTimes(1);
    });

    it('defaults to 0n for both fees when neither caller nor provider supplies them', async () => {
      const zeroFeeData = mock(() =>
        Promise.resolve({ maxFeePerGas: null, maxPriorityFeePerGas: null })
      );
      const { signer } = await createLedgerSignerForTest({ getFeeData: zeroFeeData });
      mockCreateFeeMarket1559Tx.mockClear();

      await signer.sendTransaction(buildTxFixture());

      const txData = mockCreateFeeMarket1559Tx.mock.calls[0]?.[0] as {
        maxFeePerGas: bigint;
        maxPriorityFeePerGas: bigint;
      };
      expect(txData.maxFeePerGas).toBe(0n);
      expect(txData.maxPriorityFeePerGas).toBe(0n);
    });

    it('falls back to provider.getFeeData when the caller omits fee fields', async () => {
      const providerMaxFeePerGas = 50_000_000_000n;
      const providerMaxPriority = 2_000_000_000n;
      const getFeeData = mock(() =>
        Promise.resolve({
          maxFeePerGas: providerMaxFeePerGas,
          maxPriorityFeePerGas: providerMaxPriority
        })
      );

      const { signer } = await createLedgerSignerForTest({ getFeeData });
      mockCreateFeeMarket1559Tx.mockClear();

      await signer.sendTransaction(buildTxFixture());

      const txData = mockCreateFeeMarket1559Tx.mock.calls[0]?.[0] as {
        maxFeePerGas: bigint;
        maxPriorityFeePerGas: bigint;
      };
      expect(txData.maxFeePerGas).toBe(providerMaxFeePerGas);
      expect(txData.maxPriorityFeePerGas).toBe(providerMaxPriority);
    });
  });

  describe('chain ID caching', () => {
    it('reads provider.getNetwork only once across create and multiple sends', async () => {
      const { signer, getNetwork } = await createLedgerSignerForTest();

      await signer.sendTransaction(buildTxFixture());
      await signer.sendTransaction(buildTxFixture());

      expect(getNetwork).toHaveBeenCalledTimes(1);
    });
  });

  describe('signAndSend error handling', () => {
    it('logs the classified Ledger error message (duringSigning branch) when signing throws a known Ledger error', async () => {
      const { signer } = await createLedgerSignerForTest();
      const deviceError = new DisconnectedDeviceDuringOperation();

      mockEthSignTransaction.mockImplementationOnce(() => Promise.reject(deviceError));

      await expect(signer.sendTransaction(buildTxFixture())).rejects.toBe(deviceError);

      const errorMessages = collectConsoleMessages(consoleErrorSpy);
      expect(
        errorMessages.some((m) => m.includes(LEDGER_DEVICE_DISCONNECTED_DURING_OPERATION_ERROR))
      ).toBe(true);
    });

    it('propagates non-Ledger errors without emitting a Ledger-specific error log', async () => {
      const { signer } = await createLedgerSignerForTest();
      const networkError = new Error('RPC exploded');
      mockEthSignTransaction.mockImplementationOnce(() => Promise.reject(networkError));

      consoleErrorSpy.mockClear();

      await expect(signer.sendTransaction(buildTxFixture())).rejects.toBe(networkError);

      const errorMessages = collectConsoleMessages(consoleErrorSpy);
      expect(errorMessages.some((m) => m.includes(LEDGER_USER_REJECTED_ERROR))).toBe(false);
      expect(
        errorMessages.some((m) => m.includes(LEDGER_DEVICE_DISCONNECTED_DURING_OPERATION_ERROR))
      ).toBe(false);
    });
  });

  describe('dispose', () => {
    it('closes the transport and logs disconnected message', async () => {
      const { signer, transportClose } = await createLedgerSignerForTest();
      consoleLogSpy.mockClear();

      await signer.dispose();

      expect(transportClose).toHaveBeenCalledTimes(1);
      const logMessages = collectConsoleMessages(consoleLogSpy);
      expect(logMessages.some((m) => m.includes(LEDGER_DISCONNECTED_INFO))).toBe(true);
    });
  });
});
