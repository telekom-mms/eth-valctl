import type { SafeMultisigTransactionResponse } from '@safe-global/types-kit';

import * as application from '../../../constants/application';
import type { TransactionFeeInfo } from '../../../model/safe';

/**
 * Decoded operation from a MultiSend packed data payload
 */
interface DecodedMultiSendOperation {
  to: string;
  value: bigint;
  data: string;
}

/**
 * Extract per-operation fee info from a Safe transaction
 *
 * For direct system contract calls, reads fee from `tx.value`.
 * For MultiSend batches, extracts from `dataDecoded` (primary)
 * or decodes raw packed MultiSend data (fallback).
 *
 * @param tx - Safe multisig transaction response
 * @param systemContractAddresses - Known system contract addresses
 * @returns Extracted fee info or null if the transaction format is unrecognized
 */
export function extractFeeInfo(
  tx: SafeMultisigTransactionResponse,
  systemContractAddresses: string[]
): TransactionFeeInfo | null {
  const knownAddresses = new Set(systemContractAddresses.map((addr) => addr.toLowerCase()));

  if (knownAddresses.has(tx.to.toLowerCase())) {
    return { proposedFee: BigInt(tx.value), contractAddress: tx.to };
  }

  return extractFromMultiSend(tx, knownAddresses);
}

/**
 * Extract fee info from a MultiSend transaction
 *
 * Tries `dataDecoded.parameters[0].valueDecoded` first, then falls back
 * to raw byte decoding of the packed MultiSend data.
 *
 * @param tx - Safe multisig transaction response (MultiSend wrapper)
 * @param knownAddresses - Lowercased system contract addresses
 * @returns Extracted fee info from the first matching inner operation, or null
 */
function extractFromMultiSend(
  tx: SafeMultisigTransactionResponse,
  knownAddresses: Set<string>
): TransactionFeeInfo | null {
  const decoded = tx.dataDecoded;
  if (decoded?.parameters?.[0]?.valueDecoded) {
    for (const op of decoded.parameters[0].valueDecoded) {
      if (knownAddresses.has(op.to.toLowerCase())) {
        return { proposedFee: BigInt(op.value), contractAddress: op.to };
      }
    }
  }

  if (tx.data) {
    return extractFromRawMultiSendData(tx.data, knownAddresses);
  }

  return null;
}

/**
 * Decode raw packed MultiSend data and extract fee info
 *
 * MultiSend data format per operation:
 * `operation(1) | to(20) | value(32) | dataLength(32) | data(variable)`
 *
 * @param data - Raw hex-encoded MultiSend calldata
 * @param knownAddresses - Lowercased system contract addresses
 * @returns Extracted fee info from the first matching operation, or null
 */
function extractFromRawMultiSendData(
  data: string,
  knownAddresses: Set<string>
): TransactionFeeInfo | null {
  const operations = decodeMultiSendOperations(data);

  for (const op of operations) {
    if (knownAddresses.has(op.to.toLowerCase())) {
      return { proposedFee: op.value, contractAddress: op.to };
    }
  }

  return null;
}

/**
 * Decode packed MultiSend transaction data into individual operations
 *
 * Parses the packed format: `operation(1) | to(20) | value(32) | dataLength(32) | data(variable)`
 * Skips the 4-byte method selector and 64-byte ABI offset+length header.
 *
 * @param data - Raw hex-encoded MultiSend calldata (with 0x prefix and selector)
 * @returns Array of decoded operations
 */
export function decodeMultiSendOperations(data: string): DecodedMultiSendOperation[] {
  const hex = data.startsWith(application.PREFIX_0x) ? data.slice(2) : data;

  if (!hex.startsWith(application.MULTISEND_SELECTOR.slice(2))) {
    return [];
  }

  // Skip selector (4 bytes = 8 hex) + ABI offset (32 bytes = 64 hex) + ABI length (32 bytes = 64 hex)
  const ABI_HEADER_HEX_LENGTH = 8 + 64 + 64;
  let cursor = ABI_HEADER_HEX_LENGTH;
  const operations: DecodedMultiSendOperation[] = [];

  const FIXED_FIELDS_HEX_LENGTH =
    application.MULTISEND_OPERATION_BYTE_LENGTH * 2 +
    application.MULTISEND_ADDRESS_BYTE_LENGTH * 2 +
    application.MULTISEND_VALUE_BYTE_LENGTH * 2 +
    application.MULTISEND_DATA_LENGTH_BYTE_LENGTH * 2;

  while (cursor < hex.length) {
    if (cursor + FIXED_FIELDS_HEX_LENGTH > hex.length) {
      break;
    }

    cursor += application.MULTISEND_OPERATION_BYTE_LENGTH * 2;
    const to =
      application.PREFIX_0x +
      hex.slice(cursor, cursor + application.MULTISEND_ADDRESS_BYTE_LENGTH * 2);
    cursor += application.MULTISEND_ADDRESS_BYTE_LENGTH * 2;

    const value = BigInt(
      application.PREFIX_0x +
        hex.slice(cursor, cursor + application.MULTISEND_VALUE_BYTE_LENGTH * 2)
    );
    cursor += application.MULTISEND_VALUE_BYTE_LENGTH * 2;

    const dataLength = Number(
      BigInt(
        application.PREFIX_0x +
          hex.slice(cursor, cursor + application.MULTISEND_DATA_LENGTH_BYTE_LENGTH * 2)
      )
    );
    cursor += application.MULTISEND_DATA_LENGTH_BYTE_LENGTH * 2;

    if (cursor + dataLength * 2 > hex.length) {
      break;
    }

    const opData = application.PREFIX_0x + hex.slice(cursor, cursor + dataLength * 2);
    cursor += dataLength * 2;

    operations.push({ to, value, data: opData });
  }

  return operations;
}
