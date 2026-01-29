import { VALIDATOR_PUBKEY_HEX_LENGTH } from '../../../../constants/application';
import type { PendingTransactionInfo } from '../../../../model/ethereum';

/**
 * Extract source validator pubkey from encoded request data
 *
 * Request data starts with the validator pubkey (48 bytes = 96 hex chars + 0x prefix).
 *
 * @param encodedRequestData - Encoded request data starting with validator pubkey
 * @returns 48-byte validator pubkey as hex string (with 0x prefix)
 */
export function extractValidatorPubkey(encodedRequestData: string): string {
  return encodedRequestData.slice(0, VALIDATOR_PUBKEY_HEX_LENGTH);
}

/**
 * Create pending transaction info from broadcast response
 *
 * @param response - Transaction response with hash and nonce
 * @param data - Original request data
 * @param systemContractAddress - Target system contract address
 * @param blockNumber - Block number when transaction was broadcast
 * @returns Pending transaction info for monitoring
 */
export function createPendingTransactionInfo(
  response: { hash: string; nonce: number },
  data: string,
  systemContractAddress: string,
  blockNumber: number
): PendingTransactionInfo {
  return {
    response: response as PendingTransactionInfo['response'],
    nonce: response.nonce,
    data,
    systemContractAddress,
    blockNumber
  };
}
