import chalk from 'chalk';
import { Command } from 'commander';
import { formatEther, formatUnits } from 'ethers';

import * as application from '../constants/application';
import * as logging from '../constants/logging';
import type { FeeEstimateRenderConfig, FeesOptions, GlobalCliOptions } from '../model/commander';
import type { RequestFeeBatchProjection } from '../model/ethereum';
import { networkConfig } from '../network-config';
import { createValidatedProvider } from '../service/domain/ethereum';
import { EthereumStateService } from '../service/domain/request/ethereum-state-service';
import { RequestFeeEstimationService } from '../service/domain/request/request-fee-estimation-service';
import { parseAndValidateTotalRequestCount } from './validation/cli';

const feesCommand = new Command('fees');

feesCommand
  .description('Show current and projected execution layer request fees')
  .argument('<operation>', 'Request type: consolidate, switch, withdraw, or exit')
  .option(
    '-c, --total-request-count <count>',
    'Total number of execution layer requests to estimate',
    parseAndValidateTotalRequestCount,
    application.DEFAULT_TOTAL_REQUEST_COUNT
  )
  .action(async (operation: string, options: FeesOptions, command) => {
    const globalOptions: GlobalCliOptions = command.parent.opts();
    await showFees(operation, options, globalOptions);
  });

/**
 * Show current and projected request fees for an operation.
 *
 * @param operation - Request operation name
 * @param options - Fees command options
 * @param globalOptions - Global CLI options
 */
async function showFees(
  operation: string,
  options: FeesOptions,
  globalOptions: GlobalCliOptions
): Promise<void> {
  const contractAddress = resolveFeesContractAddress(operation, globalOptions.network);
  const provider = await createValidatedProvider(globalOptions.jsonRpcUrl);
  const estimationService = new RequestFeeEstimationService(
    new EthereumStateService(provider, contractAddress),
    contractAddress
  );
  const maxRequestsPerBlock = globalOptions.maxRequestsPerBlock;
  const estimate = await estimationService.estimateRequestFees({
    totalRequestCount: options.totalRequestCount,
    maxRequestsPerBlock,
    maxRequestFee: globalOptions.maxRequestFee ?? application.DEFAULT_MAX_REQUEST_FEE
  });

  for (const line of renderFeeEstimate({
    operation,
    network: globalOptions.network,
    estimate,
    totalRequestCount: options.totalRequestCount,
    maxRequestsPerBlock,
    contractAddress
  })) {
    console.log(line);
  }

  if (estimate.batches.some((batch) => batch.capExceeded)) {
    console.error(chalk.yellow(logging.FEES_CAP_WARNING));
  }
}

/**
 * Render user-facing fee estimate lines.
 *
 * @param config - Fee estimate and display metadata
 * @returns Ordered stdout lines for the fees command
 */
export function renderFeeEstimate(config: FeeEstimateRenderConfig): string[] {
  return [
    chalk.blue(logging.FEES_ESTIMATE_HEADER(config.operation, config.network)),
    logging.FEES_CURRENT_REQUEST_FEE_INFO(formatRequestFee(config.estimate.currentRequestFee)),
    ...renderBlocksUntilCapLine(config.estimate.estimatedBlocksUntilCap),
    logging.FEES_MAX_TRANSACTION_GAS_BUDGET_INFO(
      formatEther(config.estimate.gasCost),
      formatUnits(config.estimate.maxNetworkFees.maxFeePerGas, application.GWEI_UNIT)
    ),
    '',
    logging.FEES_BATCH_HEADER(
      config.totalRequestCount,
      config.estimate.batches.length,
      config.maxRequestsPerBlock
    ),
    ...config.estimate.batches.map(formatBatchLine),
    logging.FEES_OPTIMAL_RATE_INFO(
      application.TARGET_PER_BLOCK_BY_CONTRACT[config.contractAddress.toLowerCase()] ??
        application.CONSOLIDATION_TARGET_PER_BLOCK
    )
  ];
}

/**
 * Render the "blocks until below cap" line when the current fee exceeds the cap.
 *
 * @param estimatedBlocksUntilCap - Estimated blocks until the fee drops below the cap
 * @returns Zero or one output line, only shown while the cap is currently exceeded
 */
function renderBlocksUntilCapLine(estimatedBlocksUntilCap: bigint): string[] {
  if (estimatedBlocksUntilCap <= 0n) {
    return [];
  }

  return [chalk.yellow(logging.FEES_BLOCKS_UNTIL_CAP_INFO(estimatedBlocksUntilCap))];
}

/**
 * Resolve the request contract address for a fees operation.
 *
 * @param operation - Request operation name
 * @param network - Selected network
 * @returns System contract address for the operation
 */
function resolveFeesContractAddress(operation: string, network: string): string {
  const config = networkConfig[network];
  if (!config) {
    console.error(chalk.red(logging.INVALID_NETWORK_ERROR(network)));
    process.exit(1);
  }

  switch (operation) {
    case application.FEES_OPERATION_CONSOLIDATE:
    case application.FEES_OPERATION_SWITCH:
      return config.consolidationContractAddress;
    case application.FEES_OPERATION_WITHDRAW:
    case application.FEES_OPERATION_EXIT:
      return config.withdrawalContractAddress;
    default:
      console.error(chalk.red(logging.UNKNOWN_FEES_OPERATION_ERROR(operation)));
      process.exit(1);
  }
}

/**
 * Format a projected batch line for CLI output.
 *
 * @param batch - Projected batch fee state
 * @returns User-facing batch line
 */
function formatBatchLine(batch: RequestFeeBatchProjection): string {
  return logging.FEES_BATCH_LINE(
    batch.batchNumber,
    batch.requestCount,
    formatRequestFee(batch.requestFee),
    batch.capExceeded
  );
}

/**
 * Format a request fee using the most compact Ethereum unit for display.
 *
 * @param fee - Request fee in wei
 * @returns Formatted request fee and display unit
 */
function formatRequestFee(fee: bigint): string {
  const unit = resolveRequestFeeDisplayUnit(fee);
  const unitLabel = unit === application.ETHER_UNIT ? application.ETH_SYMBOL : unit;

  return `${formatUnits(fee, unit)} ${unitLabel}`;
}

/**
 * Resolve the display unit for a request fee amount.
 *
 * @param fee - Request fee in wei
 * @returns Ethers-compatible display unit
 */
function resolveRequestFeeDisplayUnit(fee: bigint): application.RequestFeeEthersUnit {
  if (fee < application.WEI_PER_GWEI) {
    return application.WEI_UNIT;
  }

  if (fee < application.WEI_PER_ETHER) {
    return application.GWEI_UNIT;
  }

  return application.ETHER_UNIT;
}

export { feesCommand };
