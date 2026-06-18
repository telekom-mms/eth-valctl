import {
  DEFAULT_MAX_REQUEST_FEE,
  DEFAULT_MAX_REQUEST_FEE_WAIT_BLOCKS
} from '../../../constants/application';
import * as logging from '../../../constants/logging';
import type { GlobalCliOptions } from '../../../model/commander';
import type { RequestFeeCapPolicy } from '../../../model/ethereum';

/**
 * Build a request-fee cap policy from global CLI options.
 *
 * The cap is undefined only in tests or programmatic callers that omit the option.
 * Commander supplies a default in the real CLI.
 *
 * @param globalOptions - Global CLI options
 * @returns Request-fee cap policy, or undefined when no cap option was provided
 */
export function createRequestFeeCapPolicy(
  globalOptions: GlobalCliOptions
): RequestFeeCapPolicy | undefined {
  if (globalOptions.maxRequestFee === undefined) {
    return undefined;
  }

  return {
    maxRequestFee: resolveRequestFeeAmount(globalOptions.maxRequestFee),
    maxWaitBlocks: resolveWaitBlocks(globalOptions.maxRequestFeeWaitBlocks),
    skipConfirmation: globalOptions.yes ?? false
  };
}

function resolveRequestFeeAmount(value: string | undefined): bigint {
  if (value === undefined) {
    return DEFAULT_MAX_REQUEST_FEE;
  }

  if (/^\d+$/.test(value)) {
    return BigInt(value);
  }

  const match = value.match(/^(\d+(?:\.\d+)?)\s*(wei|gwei|eth)$/i);
  if (!match) {
    throw new Error(logging.INVALID_REQUEST_FEE_AMOUNT_ERROR(value));
  }

  return parseUnitAmountToWei(match[1]!, match[2]!.toLowerCase());
}

function resolveWaitBlocks(value: bigint | string | number | undefined): bigint {
  if (value === undefined) {
    return DEFAULT_MAX_REQUEST_FEE_WAIT_BLOCKS;
  }

  if (typeof value === 'bigint') {
    return value;
  }

  return BigInt(value);
}

function parseUnitAmountToWei(amount: string, unit: string): bigint {
  const [integerPart = '0', fractionalPart = ''] = amount.split('.');
  const decimals = unit === 'eth' ? 18 : unit === 'gwei' ? 9 : 0;
  const excessFraction = fractionalPart.slice(decimals);

  if (excessFraction !== '' && /[1-9]/.test(excessFraction)) {
    throw new Error(logging.REQUEST_FEE_PRECISION_ERROR(amount, unit));
  }

  const paddedFraction = fractionalPart.padEnd(decimals, '0').slice(0, decimals);

  return BigInt(integerPart) * 10n ** BigInt(decimals) + BigInt(paddedFraction || '0');
}
