import type SafeApiKit from '@safe-global/api-kit';
import type Safe from '@safe-global/protocol-kit';
import chalk from 'chalk';
import prompts from 'prompts';

import * as application from '../../../constants/application';
import * as logging from '../../../constants/logging';
import type {
  ExecutionFeeAction,
  FeeValidationAction,
  FeeValidationResult,
  StaleFeeAction,
  TransactionFeeValidation
} from '../../../model/safe';
import { FeeStatus } from '../../../model/safe';
import { withRateRetry } from './safe-api-retry';

/**
 * Configuration for the fee validation prompt handler
 */
interface FeePromptConfig {
  feeValidationResult: FeeValidationResult;
  protocolKit: Safe;
  apiKit: SafeApiKit;
  safeAddress: string;
  signerAddress: string;
  skipConfirmation?: boolean;
  staleFeeAction?: StaleFeeAction;
}

/**
 * Configuration for the per-transaction execution fee prompt
 */
interface ExecutionFeePromptConfig {
  validation: TransactionFeeValidation;
  txIndex: number;
  totalTxs: number;
  maxFeeWaitBlocks: bigint;
  skipConfirmation?: boolean;
  staleFeeAction?: StaleFeeAction;
}

/**
 * Handle fee validation results by printing status and prompting user when needed
 *
 * - Empty validations (rejection-only batch): returns 'proceed' silently
 * - All SUFFICIENT: prints success, returns 'proceed'
 * - Has STALE: prints warnings with block estimates, prompts Wait/Reject
 * - Has UNVALIDATED: prints warning, prompts Execute anyway/Abort
 * - OVERPAID info is printed in all scenarios but does not block execution
 *
 * @param config - Fee prompt configuration with validation result and SDK instances
 * @returns Action chosen by the user
 */
export async function handleFeeValidationResult(
  config: FeePromptConfig
): Promise<FeeValidationAction> {
  const total = config.feeValidationResult.validations.length;

  printValidationDetails(config.feeValidationResult.validations, total);

  if (config.feeValidationResult.hasStale) {
    return handleStaleTransactions(config, config.feeValidationResult.validations, total);
  }

  if (config.feeValidationResult.hasUnvalidated) {
    return handleUnvalidatedTransactions(config.skipConfirmation);
  }

  if (total > 0) {
    console.error(chalk.green(logging.SAFE_FEE_ALL_SUFFICIENT_INFO(total)));
  }
  return application.FEE_ACTION_PROCEED;
}

/**
 * Print detailed per-transaction validation status
 */
function printValidationDetails(validations: TransactionFeeValidation[], total: number): void {
  for (let i = 0; i < validations.length; i++) {
    const v = validations[i]!;
    const batch = i + 1;
    const hash = v.transaction.safeTxHash;

    switch (v.status) {
      case FeeStatus.STALE:
        console.error(
          chalk.yellow(
            logging.SAFE_FEE_STALE_WARNING(batch, total, hash, v.proposedFee, v.currentFee)
          )
        );
        console.error(chalk.yellow(logging.SAFE_FEE_BLOCK_ESTIMATE_INFO(v.estimatedBlocks)));
        break;

      case FeeStatus.OVERPAID:
        console.error(
          chalk.yellow(
            logging.SAFE_FEE_OVERPAYMENT_INFO(
              batch,
              total,
              hash,
              v.proposedFee,
              v.currentFee,
              v.overpaymentAmount
            )
          )
        );
        break;

      case FeeStatus.UNVALIDATED:
        console.error(chalk.yellow(logging.SAFE_FEE_READ_FAILED_WARNING(v.contractAddress)));
        break;
    }
  }
}

/**
 * Handle scenario where stale fees are detected
 *
 * Prints summary and prompts user to Wait or Reject.
 * On Reject, creates rejection transactions for stale nonces.
 *
 * @param config - Fee prompt configuration
 * @param validations - Per-transaction validation results
 * @param total - Total number of transactions
 * @returns 'wait' if user chose to wait, 'reject' after rejection proposals
 */
async function handleStaleTransactions(
  config: FeePromptConfig,
  validations: TransactionFeeValidation[],
  total: number
): Promise<FeeValidationAction> {
  const staleValidations = validations.filter((v) => v.status === FeeStatus.STALE);
  console.error(chalk.red(`\n${logging.SAFE_FEE_STALE_SUMMARY(staleValidations.length, total)}`));

  if (config.staleFeeAction) {
    if (config.staleFeeAction === application.FEE_ACTION_REJECT) {
      await rejectStaleTransactions(config, staleValidations);
      return application.FEE_ACTION_REJECT;
    }
    return application.FEE_ACTION_WAIT;
  }

  if (config.skipConfirmation) {
    return application.FEE_ACTION_WAIT;
  }

  const { action } = await prompts({
    type: 'select',
    name: 'action',
    message: logging.SAFE_FEE_STALE_PROMPT,
    choices: [
      { title: logging.SAFE_FEE_WAIT_ACTION, value: application.FEE_ACTION_WAIT },
      { title: logging.SAFE_FEE_REJECT_ACTION, value: application.FEE_ACTION_REJECT }
    ]
  });

  if (action === undefined || action === application.FEE_ACTION_WAIT) {
    return application.FEE_ACTION_WAIT;
  }

  await rejectStaleTransactions(config, staleValidations);
  return application.FEE_ACTION_REJECT;
}

/**
 * Handle scenario where fee reads failed (UNVALIDATED)
 *
 * Prompts user to execute anyway or abort.
 *
 * @returns 'proceed' if user chose to execute, 'wait' on abort
 */
async function handleUnvalidatedTransactions(
  skipConfirmation?: boolean
): Promise<FeeValidationAction> {
  if (skipConfirmation) {
    return application.FEE_ACTION_WAIT;
  }

  const { action } = await prompts({
    type: 'select',
    name: 'action',
    message: logging.SAFE_FEE_UNVALIDATED_PROMPT,
    choices: [
      { title: logging.SAFE_FEE_EXECUTE_ANYWAY_ACTION, value: application.FEE_ACTION_PROCEED },
      { title: logging.SAFE_FEE_ABORT_ACTION, value: application.FEE_ACTION_ABORT }
    ]
  });

  return action === application.FEE_ACTION_PROCEED
    ? application.FEE_ACTION_PROCEED
    : application.FEE_ACTION_WAIT;
}

/**
 * Handle a stale fee detected before executing a single transaction
 *
 * Follows the same decision flow as `handleStaleTransactions` but with
 * Wait/Abort choices instead of Wait/Reject (rejection transactions are
 * not appropriate mid-execution).
 *
 * Decision order:
 * 1. If estimated blocks exceeds max wait → abort
 * 2. If `--stale-fee-action reject` → abort (reject maps to abort mid-execution)
 * 3. If `--stale-fee-action wait` → wait
 * 4. If `--yes` → wait
 * 5. Interactive prompt: Wait / Abort
 *
 * @param config - Per-transaction fee prompt configuration
 * @returns Action chosen: wait to poll for fee drop, abort to stop execution
 */
export async function handleStaleFeeBeforeExecution(
  config: ExecutionFeePromptConfig
): Promise<ExecutionFeeAction> {
  if (config.validation.status !== FeeStatus.STALE) {
    return application.FEE_ACTION_WAIT as ExecutionFeeAction;
  }

  console.error(
    chalk.yellow(
      logging.SAFE_FEE_STALE_DURING_EXECUTION_WARNING(
        config.txIndex,
        config.totalTxs,
        config.validation.transaction.safeTxHash,
        config.validation.proposedFee,
        config.validation.currentFee
      )
    )
  );
  console.error(
    chalk.yellow(
      logging.SAFE_FEE_EXECUTION_BLOCK_ESTIMATE_INFO(
        config.validation.estimatedBlocks,
        config.maxFeeWaitBlocks
      )
    )
  );

  if (config.validation.estimatedBlocks > config.maxFeeWaitBlocks) {
    console.error(
      chalk.red(
        logging.SAFE_FEE_EXECUTION_EXCEEDS_MAX_WAIT_ERROR(
          config.validation.estimatedBlocks,
          config.maxFeeWaitBlocks
        )
      )
    );
    return application.FEE_ACTION_ABORT as ExecutionFeeAction;
  }

  if (config.staleFeeAction === application.FEE_ACTION_REJECT) {
    return application.FEE_ACTION_ABORT as ExecutionFeeAction;
  }

  if (config.staleFeeAction === application.FEE_ACTION_WAIT) {
    return application.FEE_ACTION_WAIT as ExecutionFeeAction;
  }

  if (config.skipConfirmation) {
    return application.FEE_ACTION_WAIT as ExecutionFeeAction;
  }

  const { action } = await prompts({
    type: 'select',
    name: 'action',
    message: logging.SAFE_FEE_EXECUTION_WAIT_PROMPT(config.validation.estimatedBlocks),
    choices: [
      { title: logging.SAFE_FEE_EXECUTION_WAIT_ACTION, value: application.FEE_ACTION_WAIT },
      { title: logging.SAFE_FEE_EXECUTION_ABORT_ACTION, value: application.FEE_ACTION_ABORT }
    ]
  });

  if (action === undefined || action === application.FEE_ACTION_WAIT) {
    return application.FEE_ACTION_WAIT as ExecutionFeeAction;
  }

  return application.FEE_ACTION_ABORT as ExecutionFeeAction;
}

/**
 * Propose rejection transactions for all stale nonces
 *
 * Creates a zero-value rejection transaction for each unique stale nonce,
 * signs it, and proposes to the Safe Transaction Service.
 *
 * @param config - Fee prompt configuration with SDK instances
 * @param staleValidations - Validations with STALE status
 */
async function rejectStaleTransactions(
  config: FeePromptConfig,
  staleValidations: TransactionFeeValidation[]
): Promise<void> {
  const { protocolKit, apiKit, safeAddress, signerAddress } = config;
  const uniqueNonces = [...new Set(staleValidations.map((v) => Number(v.transaction.nonce)))];
  console.error(chalk.blue(logging.SAFE_FEE_REJECTING_INFO(uniqueNonces.length)));

  for (let i = 0; i < uniqueNonces.length; i++) {
    const nonce = uniqueNonces[i]!;
    const rejectionTx = await protocolKit.createRejectionTransaction(nonce);
    const safeTxHash = await protocolKit.getTransactionHash(rejectionTx);
    const signature = await protocolKit.signHash(safeTxHash);

    await withRateRetry(() =>
      apiKit.proposeTransaction({
        safeAddress,
        safeTransactionData: rejectionTx.data,
        safeTxHash,
        senderAddress: signerAddress,
        senderSignature: signature.data,
        origin: application.SAFE_ORIGIN
      })
    );

    console.error(chalk.green(logging.SAFE_FEE_REJECTED_INFO(i + 1, nonce, safeTxHash)));
  }

  console.error(chalk.green(logging.SAFE_FEE_REJECTION_COMPLETE_INFO(uniqueNonces.length)));
}
