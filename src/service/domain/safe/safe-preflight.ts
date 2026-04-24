import type SafeApiKit from '@safe-global/api-kit';
import type { SafeInfoResponse } from '@safe-global/api-kit';
import chalk from 'chalk';

import {
  CONNECTION_REFUSED_ERROR_CODE,
  SAFE_TRANSACTION_SERVICE_NAME
} from '../../../constants/application';
import * as logging from '../../../constants/logging';
import { hasErrorCode } from '../error-utils';
import { withRateRetry } from './safe-api-retry';

/**
 * Verify that the Safe Transaction Service is reachable and responding correctly
 *
 * @param apiKit - Initialized SafeApiKit instance
 * @param txServiceUrl - Transaction Service URL for error messages
 * @throws Error if service returns unexpected response or unknown connection error
 */
export async function checkTransactionServiceHealth(
  apiKit: SafeApiKit,
  txServiceUrl: string
): Promise<void> {
  let info;
  try {
    info = await withRateRetry(() => apiKit.getServiceInfo());
  } catch (error) {
    if (hasErrorCode(error, CONNECTION_REFUSED_ERROR_CODE)) {
      console.error(chalk.red(logging.SAFE_TX_SERVICE_UNREACHABLE_ERROR(txServiceUrl)));
      process.exit(1);
    }
    throw new Error(logging.SAFE_TX_SERVICE_UNKNOWN_ERROR(txServiceUrl));
  }

  if (info.name !== SAFE_TRANSACTION_SERVICE_NAME) {
    throw new Error(logging.SAFE_TX_SERVICE_UNEXPECTED_RESPONSE_ERROR(txServiceUrl, info.name));
  }
}

/**
 * Validate that a Safe exists at the given address on the selected network
 *
 * @param apiKit - Initialized SafeApiKit instance
 * @param safeAddress - The Safe multisig address to verify
 * @param network - Network name for error messages
 * @returns The Safe info response from the Transaction Service
 * @throws Error if no Safe is found at the address
 */
export async function validateSafeExists(
  apiKit: SafeApiKit,
  safeAddress: string,
  network: string
): Promise<SafeInfoResponse> {
  try {
    return await withRateRetry(() => apiKit.getSafeInfo(safeAddress));
  } catch {
    throw new Error(logging.SAFE_NOT_FOUND_ERROR(safeAddress, network));
  }
}

/**
 * Validate that the signer address is an owner of the Safe
 *
 * @param safeInfo - Safe info response containing the owner list
 * @param signerAddress - The address of the signer to check
 * @param safeAddress - The Safe address for error messages
 * @throws Error if the signer is not an owner
 */
export function validateSignerIsOwner(
  safeInfo: SafeInfoResponse,
  signerAddress: string,
  safeAddress: string
): void {
  const normalizedSigner = signerAddress.toLowerCase();
  const isOwner = safeInfo.owners.some((owner) => owner.toLowerCase() === normalizedSigner);

  if (!isOwner) {
    throw new Error(logging.SAFE_SIGNER_NOT_OWNER_ERROR(signerAddress, safeAddress));
  }
}
