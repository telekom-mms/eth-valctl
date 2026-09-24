import chalk from 'chalk';
import prompts from 'prompts';

import * as application from '../../../constants/application';
import * as logging from '../../../constants/logging';
import type {
  FeeCapDecision,
  RequestFeeCapCheckContext,
  RequestFeeCapPolicy,
  RequestFeeCapResolver,
  RequestFeeReader
} from '../../../model/ethereum';
import {
  RequestFeeCapExceededError,
  RequestFeeOperationCancelledError
} from '../../../model/ethereum';

/**
 * Enforces the user-configured execution-layer request fee cap before sending work.
 */
export class RequestFeeCapService implements RequestFeeCapResolver {
  private approvedAboveCapRequestFee?: bigint;

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
      this.approvedAboveCapRequestFee = undefined;
      return currentFee;
    }

    if (
      this.approvedAboveCapRequestFee !== undefined &&
      currentFee <= this.approvedAboveCapRequestFee
    ) {
      return currentFee;
    }

    return this.handleExceededFee(currentFee, policy, context);
  }

  /**
   * Handle a request fee that exceeds both the configured cap and prior approvals.
   *
   * @param currentFee - Current request fee in wei
   * @param policy - Configured cap policy
   * @param context - Current operation boundary
   * @returns Approved request fee
   */
  private async handleExceededFee(
    currentFee: bigint,
    policy: RequestFeeCapPolicy,
    context: RequestFeeCapCheckContext
  ): Promise<bigint> {
    this.logCapExceeded(currentFee, policy.maxRequestFee, context);

    const decision = policy.skipConfirmation
      ? application.FEE_ACTION_WAIT
      : await this.promptForDecision();

    if (decision === application.FEE_ACTION_CONTINUE) {
      this.approvedAboveCapRequestFee = currentFee;
      return currentFee;
    }

    if (decision === application.FEE_ACTION_ABORT) {
      throw new RequestFeeOperationCancelledError(logging.REQUEST_FEE_CAP_ABORTED_INFO);
    }

    return this.waitForFeeBelowCap(currentFee, policy);
  }

  /**
   * Wait until actual execution-layer block advancement lowers the request fee below the cap.
   *
   * @param initialFee - Fee that exceeded the cap before waiting
   * @param policy - Configured cap policy
   * @returns Fee at or below the configured cap
   */
  private async waitForFeeBelowCap(
    initialFee: bigint,
    policy: RequestFeeCapPolicy
  ): Promise<bigint> {
    let currentFee = initialFee;
    let blocksWaited = 0n;

    if (policy.maxWaitBlocks === 0n) {
      throw this.createWaitExceededError(currentFee, policy);
    }

    let lastBlockNumber = await this.requestFeeReader.fetchBlockNumber();

    while (blocksWaited < policy.maxWaitBlocks) {
      await this.waitForNextFeePoll();
      const nextBlockNumber = await this.requestFeeReader.fetchBlockNumber();

      if (nextBlockNumber <= lastBlockNumber) {
        continue;
      }

      blocksWaited += BigInt(nextBlockNumber - lastBlockNumber);
      lastBlockNumber = nextBlockNumber;

      if (blocksWaited > policy.maxWaitBlocks) {
        throw this.createWaitExceededError(currentFee, policy);
      }

      currentFee = await this.requestFeeReader.fetchContractFee();

      if (currentFee <= policy.maxRequestFee) {
        this.approvedAboveCapRequestFee = undefined;
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

    throw this.createWaitExceededError(currentFee, policy);
  }

  /**
   * Create a wait-budget exceeded error for the current cap policy.
   *
   * @param currentFee - Last known request fee in wei
   * @param policy - Configured cap policy
   * @returns Error describing the exhausted wait budget
   */
  private createWaitExceededError(
    currentFee: bigint,
    policy: RequestFeeCapPolicy
  ): RequestFeeCapExceededError {
    return new RequestFeeCapExceededError(
      logging.REQUEST_FEE_CAP_WAIT_EXCEEDED_ERROR(
        currentFee,
        policy.maxRequestFee,
        policy.maxWaitBlocks
      )
    );
  }

  /**
   * Prompt the user for a cap handling decision.
   *
   * @returns Selected cap handling decision
   */
  private async promptForDecision(): Promise<FeeCapDecision> {
    const { action } = await prompts({
      type: 'select',
      name: 'action',
      message: logging.REQUEST_FEE_CAP_PROMPT,
      choices: [
        { title: logging.REQUEST_FEE_CAP_WAIT_ACTION, value: application.FEE_ACTION_WAIT },
        {
          title: logging.REQUEST_FEE_CAP_CONTINUE_ACTION,
          value: application.FEE_ACTION_CONTINUE
        },
        { title: logging.REQUEST_FEE_CAP_ABORT_ACTION, value: application.FEE_ACTION_ABORT }
      ],
      initial: 0
    });

    if (action === undefined) {
      return application.FEE_ACTION_ABORT;
    }

    return this.isFeeCapDecision(action) ? action : application.FEE_ACTION_ABORT;
  }

  /**
   * Log that the current request fee exceeded the configured cap.
   *
   * @param currentFee - Current request fee in wei
   * @param maxFee - Configured max request fee in wei
   * @param context - Current operation boundary
   */
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

  /**
   * Wait until the next request-fee poll interval.
   */
  private async waitForNextFeePoll(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, application.FEE_WAIT_POLL_INTERVAL_MS));
  }

  /**
   * Check whether a prompt value is a supported cap decision.
   *
   * @param action - Prompt value
   * @returns True when the prompt value is a fee cap decision
   */
  private isFeeCapDecision(action: unknown): action is FeeCapDecision {
    return (
      action === application.FEE_ACTION_WAIT ||
      action === application.FEE_ACTION_CONTINUE ||
      action === application.FEE_ACTION_ABORT
    );
  }
}
