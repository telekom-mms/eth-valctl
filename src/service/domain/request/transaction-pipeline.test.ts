import { describe, expect, it, mock } from 'bun:test';

import type { Disposable } from '../../../model/ethereum';
import type { TransactionBatchOrchestrator } from './transaction-batch-orchestrator';
import { TransactionPipeline } from './transaction-pipeline';

const createMockOrchestrator = (): TransactionBatchOrchestrator => {
  return {
    sendExecutionLayerRequests: mock(() => Promise.resolve())
  } as unknown as TransactionBatchOrchestrator;
};

const createMockDisposable = (): Disposable & { dispose: ReturnType<typeof mock> } => ({
  dispose: mock(() => Promise.resolve())
});

describe('TransactionPipeline', () => {
  it('delegates sendExecutionLayerRequests to orchestrator', async () => {
    const orchestrator = createMockOrchestrator();
    const pipeline = new TransactionPipeline(orchestrator, []);

    await pipeline.sendExecutionLayerRequests(['0xdata1', '0xdata2'], 10);

    expect(orchestrator.sendExecutionLayerRequests).toHaveBeenCalledWith(
      ['0xdata1', '0xdata2'],
      10
    );
  });

  it('dispose calls dispose on all collected disposables', async () => {
    const orchestrator = createMockOrchestrator();
    const disposable1 = createMockDisposable();
    const disposable2 = createMockDisposable();
    const pipeline = new TransactionPipeline(orchestrator, [disposable1, disposable2]);

    await pipeline.dispose();

    expect(disposable1.dispose).toHaveBeenCalledTimes(1);
    expect(disposable2.dispose).toHaveBeenCalledTimes(1);
  });

  it('dispose resolves without error when no disposables', async () => {
    const orchestrator = createMockOrchestrator();
    const pipeline = new TransactionPipeline(orchestrator, []);

    await expect(pipeline.dispose()).resolves.toBeUndefined();
  });
});
