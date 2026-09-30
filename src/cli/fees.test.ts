import { describe, expect, it } from 'bun:test';
import chalk from 'chalk';

import * as application from '../constants/application';
import * as logging from '../constants/logging';
import type { RequestFeeEstimate } from '../model/ethereum';
import { renderFeeEstimate } from './fees';

const ESTIMATE: RequestFeeEstimate = {
  currentExcess: 42n,
  currentRequestFee: 1n,
  maxNetworkFees: {
    maxFeePerGas: 20_000_000_000n,
    maxPriorityFeePerGas: 2_000_000_000n
  },
  gasLimit: application.TRANSACTION_GAS_LIMIT,
  gasCost: application.TRANSACTION_GAS_LIMIT * 20_000_000_000n,
  exceedsCap: false,
  estimatedBlocksUntilCap: 0n,
  batches: [
    {
      batchNumber: 1,
      requestCount: 20,
      requestFee: 1n,
      capExceeded: false
    },
    {
      batchNumber: 2,
      requestCount: 20,
      requestFee: 2n,
      capExceeded: true
    }
  ]
};

describe('renderFeeEstimate', () => {
  it('shows gas budget and batch fees without raw excess or combined totals', () => {
    const lines = renderFeeEstimate({
      operation: 'consolidate',
      network: 'hoodi',
      estimate: ESTIMATE,
      totalRequestCount: 40,
      maxRequestsPerBlock: 20,
      contractAddress: application.CONSOLIDATION_CONTRACT_ADDRESS
    });
    const output = lines.join('\n');

    expect(lines[0]).toBe(chalk.blue(logging.FEES_ESTIMATE_HEADER('consolidate', 'hoodi')));
    expect(output).toContain('Current request fee: 1 wei');
    expect(output).toContain('Max transaction gas budget: 0.004 ETH at 20.0 Gwei max fee per gas');
    expect(output).toContain('Batch 1: 20 requests, request fee 1 wei');
    expect(output).toContain('Batch 2: 20 requests, request fee 2 wei (above cap)');
    expect(output).not.toContain('Current excess');
    expect(output).not.toContain('Estimated total per request');
    expect(output).not.toContain('until the fee drops below --max-request-fee');
  });

  it('shows the blocks-until-cap line when the current fee currently exceeds the cap', () => {
    const lines = renderFeeEstimate({
      operation: 'consolidate',
      network: 'hoodi',
      estimate: { ...ESTIMATE, exceedsCap: true, estimatedBlocksUntilCap: 28n },
      totalRequestCount: 40,
      maxRequestsPerBlock: 20,
      contractAddress: application.CONSOLIDATION_CONTRACT_ADDRESS
    });
    const output = lines.join('\n');

    expect(output).toContain(
      chalk.yellow(
        '~28 blocks until the fee drops below --max-request-fee (assuming no new requests)'
      )
    );
  });
});
