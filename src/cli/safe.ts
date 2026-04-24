import { Command } from 'commander';

import * as application from '../constants/application';
import type { GlobalCliOptions } from '../model/commander';
import type { StaleFeeAction } from '../model/safe';
import { networkConfig } from '../network-config';
import { executeReadyTransactions } from '../service/domain/safe/safe-execute-service';
import { initializeSafe } from '../service/domain/safe/safe-init';
import { signPendingTransactions } from '../service/domain/safe/safe-sign-service';
import { validateSafeAddress } from './validation/cli';

const SYSTEM_CONTRACT_ADDRESSES = [
  application.CONSOLIDATION_CONTRACT_ADDRESS,
  application.WITHDRAWAL_CONTRACT_ADDRESS
];

/**
 * Safe command group with sign and execute subcommands
 */
export const safeCommand = new Command('safe').description(
  'Safe multisig operations (sign, execute)'
);

safeCommand
  .command('sign')
  .description('Sign pending eth-valctl Safe transactions')
  .option('-y, --yes', 'Skip confirmation prompts', false)
  .action(async (options, cmd) => {
    const globalOptions: GlobalCliOptions = cmd.parent!.parent!.opts();
    await handleSafeSign(globalOptions, options.yes);
  });

safeCommand
  .command('execute')
  .description('Execute fully-signed eth-valctl Safe transactions on-chain')
  .option(
    '-o, --fee-overpayment-threshold <wei>',
    'Wei threshold above which fee overpayment is flagged',
    String(application.DEFAULT_FEE_OVERPAYMENT_THRESHOLD)
  )
  .option(
    '-y, --yes',
    'Skip confirmation prompts. On stale fees, poll until fees drop, bounded by --max-fee-wait-blocks (use --stale-fee-action reject to propose rejections instead)',
    false
  )
  .option(
    '-a, --stale-fee-action <action>',
    'Non-interactive action for stale fees: wait (poll until fee drops, bounded by --max-fee-wait-blocks) or reject (propose rejection transactions)'
  )
  .option(
    '-w, --max-fee-wait-blocks <blocks>',
    'Max blocks to wait for fee to drop (default: 50, 0 aborts immediately on stale fees)',
    String(application.DEFAULT_MAX_FEE_WAIT_BLOCKS)
  )
  .action(async (options, cmd) => {
    const globalOptions: GlobalCliOptions = cmd.parent!.parent!.opts();
    const overpaymentThreshold = BigInt(options.feeOverpaymentThreshold);
    const staleFeeAction = options.staleFeeAction as StaleFeeAction | undefined;
    const skipConfirmation = options.yes || staleFeeAction !== undefined;
    const maxFeeWaitBlocks = BigInt(options.maxFeeWaitBlocks);
    await handleSafeExecute(
      globalOptions,
      overpaymentThreshold,
      skipConfirmation,
      staleFeeAction,
      maxFeeWaitBlocks
    );
  });

/**
 * Handle the safe sign subcommand
 *
 * @param globalOptions - Global CLI options including safe address and network
 * @param skipConfirmation - Whether to skip confirmation prompts
 */
async function handleSafeSign(
  globalOptions: GlobalCliOptions,
  skipConfirmation: boolean
): Promise<void> {
  const safeAddress = validateSafeAddress(globalOptions);
  const netConfig = networkConfig[globalOptions.network]!;
  const initResult = await initializeSafe(globalOptions, netConfig, safeAddress);

  try {
    await signPendingTransactions({
      apiKit: initResult.apiKit,
      protocolKit: initResult.protocolKit,
      safeAddress,
      signerAddress: initResult.signerAddress,
      systemContractAddresses: SYSTEM_CONTRACT_ADDRESSES,
      threshold: initResult.safeInfo.threshold,
      skipConfirmation
    });
  } finally {
    await initResult.dispose();
  }
}

/**
 * Handle the safe execute subcommand
 *
 * @param globalOptions - Global CLI options including safe address and network
 * @param overpaymentThreshold - Wei threshold above which fee overpayment is flagged
 * @param skipConfirmation - Whether to skip confirmation prompts
 * @param staleFeeAction - Non-interactive action for stale fees
 * @param maxFeeWaitBlocks - Maximum blocks to wait for fee to drop during execution
 */
async function handleSafeExecute(
  globalOptions: GlobalCliOptions,
  overpaymentThreshold: bigint,
  skipConfirmation: boolean,
  staleFeeAction?: StaleFeeAction,
  maxFeeWaitBlocks?: bigint
): Promise<void> {
  const safeAddress = validateSafeAddress(globalOptions);
  const netConfig = networkConfig[globalOptions.network]!;
  const initResult = await initializeSafe(globalOptions, netConfig, safeAddress);

  try {
    await executeReadyTransactions({
      apiKit: initResult.apiKit,
      protocolKit: initResult.protocolKit,
      provider: initResult.provider,
      safeAddress,
      signerAddress: initResult.signerAddress,
      systemContractAddresses: SYSTEM_CONTRACT_ADDRESSES,
      overpaymentThreshold,
      skipConfirmation,
      staleFeeAction,
      maxFeeWaitBlocks
    });
  } finally {
    await initResult.dispose();
  }
}
