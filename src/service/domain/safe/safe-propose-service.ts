import type SafeApiKit from '@safe-global/api-kit';
import type Safe from '@safe-global/protocol-kit';
import { OperationType } from '@safe-global/types-kit';
import chalk from 'chalk';

import { SAFE_ORIGIN } from '../../../constants/application';
import * as logging from '../../../constants/logging';
import { splitToBatches } from '../batch-utils';
import { isDuplicateProposal } from '../error-utils';
import { withRateRetry } from './safe-api-retry';

/**
 * Configuration for proposing Safe transactions
 */
export interface SafeProposeConfig {
  apiKit: SafeApiKit;
  protocolKit: Safe;
  safeAddress: string;
  senderAddress: string;
  contractAddress: string;
  requestData: string[];
  contractFee: bigint;
  maxRequestsPerBatch: number;
  validatorPubkeys: string[];
  threshold?: number;
}

/**
 * Propose execution layer requests as Safe MultiSend transactions
 *
 * Groups operations into MultiSend batches, signs off-chain, and proposes
 * to the Safe Transaction Service. Each batch gets a unique incrementing
 * Safe nonce. Duplicate proposals are detected and skipped with a warning.
 *
 * @param config - Configuration with SDK instances, addresses, and request data
 * @throws Error if a non-duplicate proposal fails (remaining pubkeys printed to stderr)
 */
export async function proposeSafeTransactions(config: SafeProposeConfig): Promise<void> {
  const batches = splitToBatches(config.requestData, config.maxRequestsPerBatch);
  const pubkeyBatches = splitToBatches(config.validatorPubkeys, config.maxRequestsPerBatch);
  const startingNonce = Number(
    await withRateRetry(() => config.apiKit.getNextNonce(config.safeAddress))
  );
  const feeString = config.contractFee.toString();

  console.error(
    chalk.blue(logging.SAFE_PROPOSING_BATCHES_INFO(batches.length, batches[0]!.length))
  );

  let proposedCount = 0;

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    try {
      const signed = await createAndSignBatch(
        config.protocolKit,
        batches[batchIndex]!,
        config.contractAddress,
        feeString,
        startingNonce + batchIndex
      );

      await proposeBatch(
        config.apiKit,
        config.safeAddress,
        config.senderAddress,
        signed,
        batchIndex + 1,
        batches.length
      );
      proposedCount++;
    } catch (error) {
      printRemainingPubkeys(pubkeyBatches, batchIndex);
      throw error;
    }
  }

  printProposalCompletion(proposedCount, config.safeAddress, config.threshold);
}

/**
 * Create a MultiSend Safe transaction from a batch of request data and sign it
 *
 * @param protocolKit - Safe Protocol Kit instance
 * @param batch - Array of encoded calldata for this batch
 * @param contractAddress - Target system contract address
 * @param feeString - Contract fee as string (for transaction value)
 * @param nonce - Safe nonce for this batch
 * @returns Signed batch with transaction data, hash, and signature
 */
async function createAndSignBatch(
  protocolKit: Safe,
  batch: string[],
  contractAddress: string,
  feeString: string,
  nonce: number
) {
  const transactions = batch.map((data) => ({
    to: contractAddress,
    data,
    value: feeString,
    operation: OperationType.Call
  }));

  const safeTransaction = await protocolKit.createTransaction({
    transactions,
    options: { nonce }
  });

  const safeTxHash = await protocolKit.getTransactionHash(safeTransaction);
  const signature = await protocolKit.signHash(safeTxHash);

  return { safeTransaction, safeTxHash, signatureData: signature.data };
}

/**
 * Propose a signed batch to the Safe Transaction Service
 *
 * Submits the signed transaction as a proposal. Duplicate proposals
 * are detected and logged as warnings without throwing.
 *
 * @param apiKit - Safe API Kit instance
 * @param safeAddress - Safe multisig address
 * @param senderAddress - Address of the proposer
 * @param signed - Signed batch from createAndSignBatch
 * @param batchNumber - 1-based batch number for progress logging
 * @param totalBatches - Total number of batches
 */
async function proposeBatch(
  apiKit: SafeApiKit,
  safeAddress: string,
  senderAddress: string,
  signed: Awaited<ReturnType<typeof createAndSignBatch>>,
  batchNumber: number,
  totalBatches: number
): Promise<void> {
  try {
    await withRateRetry(() =>
      apiKit.proposeTransaction({
        safeAddress,
        safeTransactionData: signed.safeTransaction.data,
        safeTxHash: signed.safeTxHash,
        senderAddress,
        senderSignature: signed.signatureData,
        origin: SAFE_ORIGIN
      })
    );
    console.error(
      chalk.green(logging.SAFE_PROPOSED_BATCH_INFO(batchNumber, totalBatches, signed.safeTxHash))
    );
  } catch (error) {
    if (isDuplicateProposal(error)) {
      console.error(chalk.yellow(logging.SAFE_DUPLICATE_PROPOSAL_WARNING(signed.safeTxHash)));
      return;
    }
    throw error;
  }
}

/**
 * Print proposal completion summary with next-step guidance
 *
 * @param proposedCount - Number of successfully proposed batches
 * @param safeAddress - Safe multisig address
 * @param threshold - Optional confirmation threshold for signature status
 */
function printProposalCompletion(
  proposedCount: number,
  safeAddress: string,
  threshold?: number
): void {
  console.error(chalk.green(logging.SAFE_PROPOSAL_COMPLETE_INFO(proposedCount, safeAddress)));
  if (threshold !== undefined) {
    console.error(chalk.blue(logging.SAFE_PENDING_SIGNATURES_INFO(1, threshold)));
  }
  console.error(chalk.blue(logging.SAFE_SIGN_NEXT_STEP_INFO(safeAddress)));
}

/**
 * Print remaining validator pubkeys that were not proposed to stderr
 *
 * @param pubkeyBatches - All pubkey batches
 * @param failedBatchIndex - Index of the batch that failed
 */
function printRemainingPubkeys(pubkeyBatches: string[][], failedBatchIndex: number): void {
  const remaining = pubkeyBatches.slice(failedBatchIndex).flat();
  if (remaining.length === 0) return;

  console.error(chalk.red(logging.SAFE_REMAINING_PUBKEYS_HEADER));
  for (const pubkey of remaining) {
    console.error(pubkey);
  }
}
