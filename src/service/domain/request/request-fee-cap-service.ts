import chalk from 'chalk';
import prompts from 'prompts';

import { FEE_WAIT_POLL_INTERVAL_MS } from '../../../constants/application';
import * as logging from '../../../constants/logging';
import type {
  FeeCapDecision,
  RequestFeeCapCheckContext,
  RequestFeeCapPolicy
} from '../../../model/ethereum';
import {
  RequestFeeCapExceededError,
  RequestFeeOperationCancelledError
} from '../../../model/ethereum';

interface RequestFeeReader {
  fetchContractFee(): Promise<bigint>;
}

/**
 * Enforces the user-configured execution-layer request fee cap before sending work.
 */
export class RequestFeeCapService {
  constructor(private readonly requestFeeReader: RequestFeeReader) {}

  /**
   * Resolve the fee to use after enforcing the configured cap.
   *
   * If the current request fee is at or below the cap, it is returned silently.
   * If it is above the cap, the method waits, prompts, or throws according to the policy.
   *
   * @param policy - Configured cap policy
   * @param context - Current operation boundary
   * @returns Request fee approved for this boundary
   */
  async resolveRequestFee(
    policy: RequestFeeCapPolicy,
    context: RequestFeeCapCheckContext
  ): Promise<bigint> {
    const currentFee = await this.requestFeeReader.fetchContractFee();

    if (currentFee <= policy.maxRequestFee) {
      return currentFee;
    }

    return this.handleExceededFee(currentFee, policy, context);
  }

  private async handleExceededFee(
    currentFee: bigint,
    policy: RequestFeeCapPolicy,
    context: RequestFeeCapCheckContext
  ): Promise<bigint> {
    this.logCapExceeded(currentFee, policy.maxRequestFee, context);

    const decision = policy.skipConfirmation ? 'wait' : await this.promptForDecision();

    if (decision === 'continue') {
      return currentFee;
    }

    if (decision === 'abort') {
      throw new RequestFeeOperationCancelledError(logging.REQUEST_FEE_CAP_ABORTED_INFO);
    }

    return this.waitForFeeBelowCap(currentFee, policy);
  }

  private async waitForFeeBelowCap(
    initialFee: bigint,
    policy: RequestFeeCapPolicy
  ): Promise<bigint> {
    let currentFee = initialFee;
    let blocksWaited = 0n;

    while (blocksWaited < policy.maxWaitBlocks) {
      await new Promise((resolve) => setTimeout(resolve, FEE_WAIT_POLL_INTERVAL_MS));
      blocksWaited++;
      currentFee = await this.requestFeeReader.fetchContractFee();

      if (currentFee <= policy.maxRequestFee) {
        return currentFee;
      }

      console.error(
        chalk.yellow(
          logging.REQUEST_FEE_CAP_WAIT_PROGRESS_INFO(
            currentFee,
            policy.maxRequestFee,
            blocksWaited,
            policy.maxWaitBlocks
          )
        )
      );
    }

    throw new RequestFeeCapExceededError(
      logging.REQUEST_FEE_CAP_WAIT_EXCEEDED_ERROR(
        currentFee,
        policy.maxRequestFee,
        policy.maxWaitBlocks
      )
    );
  }

  private async promptForDecision(): Promise<FeeCapDecision> {
    const { action } = await prompts({
      type: 'select',
      name: 'action',
      message: logging.REQUEST_FEE_CAP_PROMPT,
      choices: [
        { title: logging.REQUEST_FEE_CAP_WAIT_ACTION, value: 'wait' },
        { title: logging.REQUEST_FEE_CAP_CONTINUE_ACTION, value: 'continue' },
        { title: logging.REQUEST_FEE_CAP_ABORT_ACTION, value: 'abort' }
      ],
      initial: 0
    });

    if (action === undefined) {
      return 'abort';
    }

    return action as FeeCapDecision;
  }

  private logCapExceeded(
    currentFee: bigint,
    maxFee: bigint,
    context: RequestFeeCapCheckContext
  ): void {
    console.error(
      chalk.yellow(
        logging.REQUEST_FEE_CAP_EXCEEDED_WARNING(
          currentFee,
          maxFee,
          context.operation,
          context.requestCount
        )
      )
    );
  }
}
