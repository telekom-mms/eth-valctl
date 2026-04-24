import { describe, expect, it, mock } from 'bun:test';

import type { ISlotTimingService } from '../../../../ports/slot-timing.interface';
import { SequentialBroadcastStrategy } from './sequential-broadcast-strategy';

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
});
