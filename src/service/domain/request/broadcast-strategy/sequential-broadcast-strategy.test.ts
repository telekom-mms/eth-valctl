import { describe, expect, it, mock } from 'bun:test';
import type { TransactionResponse } from 'ethers';

import type { RequestFeeCapCheckContext, RequestFeeCapPolicy } from '../../../../model/ethereum';
import { RequestFeeOperationCancelledError } from '../../../../model/ethereum';
import type { ISlotTimingService } from '../../../../ports/slot-timing.interface';
import type { ISigner } from '../../signer';
import type { EthereumStateService } from '../ethereum-state-service';
import type { TransactionProgressLogger } from '../transaction-progress-logger';
import { SequentialBroadcastStrategy } from './sequential-broadcast-strategy';

const REQUEST_DATA = `0x${'11'.repeat(48)}`;

const createMockSlotTimingService = (): ISlotTimingService & {
  dispose: ReturnType<typeof mock>;
} => ({
  calculateSlotPosition: mock(() => ({
    currentSlot: 1,
    secondInSlot: 0,
    secondsUntilNextSlot: 12
  })),
  waitForOptimalBroadcastWindow: mock(() => Promise.resolve()),
  dispose: mock(() => Promise.resolve())
});

const createMockLogger = (): TransactionProgressLogger => {
  return {
    logBroadcastingTransaction: mock(),
    logBroadcastFailure: mock()
  } as unknown as TransactionProgressLogger;
};

const createMockSigner = (sendTransaction: ReturnType<typeof mock>): ISigner => {
  return {
    capabilities: {
      supportsParallelSigning: false
    },
    address: '0xWalletAddress',
    sendTransaction,
    sendTransactionWithNonce: mock(),
    dispose: mock(() => Promise.resolve())
  } as unknown as ISigner;
};

describe('SequentialBroadcastStrategy', () => {
  describe('dispose', () => {
    it('delegates dispose to slotTimingService', async () => {
      const slotTimingService = createMockSlotTimingService();
      const strategy = new SequentialBroadcastStrategy(
        {} as ConstructorParameters<typeof SequentialBroadcastStrategy>[0],
        '0xcontract',
        slotTimingService,
        {} as ConstructorParameters<typeof SequentialBroadcastStrategy>[3]
      );

      await strategy.dispose();

      expect(slotTimingService.dispose).toHaveBeenCalledTimes(1);
    });
  });

  describe('broadcast', () => {
    it('aborts the whole Ledger broadcast when a fresh fee cap check is cancelled', async () => {
      const policy: RequestFeeCapPolicy = {
        maxRequestFee: 10n,
        maxWaitBlocks: 50n,
        skipConfirmation: true
      };
      const resolveRequestFee = mock(
        (_policy: RequestFeeCapPolicy, _context: RequestFeeCapCheckContext) => {
          if (resolveRequestFee.mock.calls.length === 1) {
            return Promise.resolve(1n);
          }

          return Promise.reject(new RequestFeeOperationCancelledError('cancelled'));
        }
      );
      const sendTransaction = mock(() =>
        Promise.resolve({ hash: '0xhash', nonce: 1 } as TransactionResponse)
      );
      const strategy = new SequentialBroadcastStrategy(
        {} as EthereumStateService,
        '0xcontract',
        createMockSlotTimingService(),
        createMockLogger(),
        {
          policy,
          resolver: { resolveRequestFee }
        }
      );

      await expect(
        strategy.broadcast(
          createMockSigner(sendTransaction),
          [
            { transaction: {} as never, requestData: REQUEST_DATA },
            { transaction: {} as never, requestData: REQUEST_DATA },
            { transaction: {} as never, requestData: REQUEST_DATA }
          ],
          100
        )
      ).rejects.toThrow(RequestFeeOperationCancelledError);

      expect(sendTransaction).toHaveBeenCalledTimes(1);
      expect(resolveRequestFee).toHaveBeenCalledTimes(2);
    });
  });
});
