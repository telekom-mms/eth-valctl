import { parseUnits } from 'ethers';

import * as application from '../../../constants/application';
import * as logging from '../../../constants/logging';

/**
 * Parse a request fee amount with an explicit unit into wei.
 *
 * @param value - Request fee amount using wei, gwei, or eth suffix
 * @returns Request fee amount in wei
 */
export function parseRequestFeeAmount(value: string): bigint {
  const match = application.REQUEST_FEE_AMOUNT_PATTERN.exec(value);
  if (!match) {
    throw new Error(logging.INVALID_MAX_REQUEST_FEE_FORMAT_ERROR);
  }

  const amount = match[1]!;
  const inputUnit = normalizeRequestFeeInputUnit(match[2]!);

  try {
    return parseUnits(amount, toEthersRequestFeeUnit(inputUnit));
  } catch {
    throw new Error(logging.REQUEST_FEE_PRECISION_ERROR(amount, inputUnit));
  }
}

/**
 * Convert a CLI request fee input unit to the equivalent ethers.js unit.
 *
 * @param inputUnit - Request fee input unit
 * @returns Unit accepted by ethers.js
 */
export function toEthersRequestFeeUnit(
  inputUnit: application.RequestFeeInputUnit
): application.RequestFeeEthersUnit {
  return inputUnit === application.ETH_UNIT ? application.ETHER_UNIT : inputUnit;
}

/**
 * Normalize a request fee input unit after regex validation.
 *
 * @param unit - Unit suffix from user input
 * @returns Lowercase request fee input unit
 */
function normalizeRequestFeeInputUnit(unit: string): application.RequestFeeInputUnit {
  const normalizedUnit = unit.toLowerCase();

  if (
    normalizedUnit === application.WEI_UNIT ||
    normalizedUnit === application.GWEI_UNIT ||
    normalizedUnit === application.ETH_UNIT
  ) {
    return normalizedUnit;
  }

  throw new Error(logging.INVALID_MAX_REQUEST_FEE_FORMAT_ERROR);
}
