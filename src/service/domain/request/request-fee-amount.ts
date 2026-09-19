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
  const inputUnit = match[2]!.toLowerCase() as application.RequestFeeInputUnit;

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
