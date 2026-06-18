import chalk from 'chalk';
import { Command } from 'commander';
import { formatEther, formatUnits } from 'ethers';

import * as application from '../constants/application';
import * as logging from '../constants/logging';
import type { FeesOptions, GlobalCliOptions } from '../model/commander';
import type { RequestFeeBatchProjection } from '../model/ethereum';
import { networkConfig } from '../network-config';
import { createValidatedProvider } from '../service/domain/ethereum';
import { EthereumStateService } from '../service/domain/request/ethereum-state-service';
import {
  parseAndValidateMaxNumberOfRequestsPerBlock,
  parseAndValidateMaxRequestFee,
  parseAndValidateTotalRequestCount,
  resolveMaxRequestFee
} from './validation/cli';

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
  .option(
    '-m, --max-requests-per-block <number>',
    'Maximum requests per idealized batch/block for fee projection',
    parseAndValidateMaxNumberOfRequestsPerBlock
  )
  .option(
    '-x, --max-request-fee <amount>',
    'Maximum request fee per execution layer request, for example 1wei, 0.5gwei, or 0.01eth',
    parseAndValidateMaxRequestFee
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
  const stateService = new EthereumStateService(provider, contractAddress);
  const maxRequestFee = resolveMaxRequestFee(options.maxRequestFee ?? globalOptions.maxRequestFee);
  const maxRequestsPerBlock = options.maxRequestsPerBlock ?? globalOptions.maxRequestsPerBlock;
  const estimate = await stateService.estimateRequestFees({
    totalRequestCount: options.totalRequestCount,
    maxRequestsPerBlock,
    maxRequestFee
  });

  console.log(logging.FEES_ESTIMATE_HEADER(operation, globalOptions.network));
  console.log(logging.FEES_CURRENT_REQUEST_FEE_INFO(formatRequestFee(estimate.currentRequestFee)));
  console.log(logging.FEES_CURRENT_EXCESS_INFO(estimate.currentExcess));
  console.log(
    logging.FEES_MAX_FEE_PER_GAS_INFO(
      formatUnits(estimate.maxNetworkFees.maxFeePerGas, application.GWEI_UNIT)
    )
  );
  console.log(logging.FEES_GAS_COST_INFO(formatEther(estimate.gasCost)));
  console.log(logging.FEES_TOTAL_PER_REQUEST_INFO(formatEther(estimate.totalPerRequest)));
  console.log('');
  console.log(
    logging.FEES_BATCH_HEADER(
      options.totalRequestCount,
      estimate.batches.length,
      maxRequestsPerBlock
    )
  );
  for (const batch of estimate.batches) {
    console.log(formatBatchLine(batch));
  }

  if (estimate.batches.some((batch) => batch.capExceeded)) {
    console.error(chalk.yellow(logging.FEES_CAP_WARNING));
  }

  console.log(
    logging.FEES_OPTIMAL_RATE_INFO(
      application.TARGET_PER_BLOCK_BY_CONTRACT[contractAddress.toLowerCase()] ??
        application.CONSOLIDATION_TARGET_PER_BLOCK
    )
  );
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
    case 'consolidate':
    case 'switch':
      return config.consolidationContractAddress;
    case 'withdraw':
    case 'exit':
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
