import { describe, expect, it } from 'bun:test';

import { ParallelBroadcastStrategy } from './parallel-broadcast-strategy';

describe('ParallelBroadcastStrategy', () => {
  describe('dispose', () => {
    it('resolves without error', async () => {
      const strategy = new ParallelBroadcastStrategy(
        {} as ConstructorParameters<typeof ParallelBroadcastStrategy>[0]
      );

      await expect(strategy.dispose()).resolves.toBeUndefined();
    });
  });
});
