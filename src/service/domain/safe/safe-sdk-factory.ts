import SafeApiKit from '@safe-global/api-kit';

import { SAFE_API_KEY_ENV } from '../../../constants/application';
import { SAFE_API_KEY_REQUIRED_ERROR } from '../../../constants/logging';
import type { SafeConnectionConfig } from '../../../model/safe';
import { networkConfig } from '../../../network-config';

/**
 * Create an initialized SafeApiKit instance from connection config
 *
 * @param config - Safe connection configuration
 * @param requiresApiKey - Whether the network requires an API key
 * @returns Initialized SafeApiKit instance
 * @throws Error if API key is required but missing
 */
export function createSafeApiKit(
  config: SafeConnectionConfig,
  requiresApiKey: boolean
): SafeApiKit {
  const apiKey = process.env[SAFE_API_KEY_ENV]?.trim() || undefined;

  if (requiresApiKey && !apiKey) {
    throw new Error(SAFE_API_KEY_REQUIRED_ERROR(networkNameFromChainId(config.chainId)));
  }

  return new SafeApiKit({
    chainId: config.chainId,
    txServiceUrl: config.txServiceUrl,
    ...(apiKey ? { apiKey } : {})
  });
}

/**
 * Resolve network name from chain ID for error messages
 *
 * @param chainId - The chain ID
 * @returns Human-readable network name
 */
function networkNameFromChainId(chainId: bigint): string {
  const entry = Object.entries(networkConfig).find(([, config]) => config.chainId === chainId);
  return entry?.[0] ?? `chain ${chainId}`;
}
