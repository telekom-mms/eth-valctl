import { TRANSACTION_GAS_LIMIT, VALIDATOR_PUBKEY_HEX_LENGTH } from '../../../../constants/application';
import type {
  BroadcastResult,
  ExecutionLayerRequestTransaction,
  PendingTransactionInfo
} from '../../../../model/ethereum';

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
 * Create a failed broadcast result
 *
 * @param requestData - The request data that failed to broadcast
 * @param error - The error that caused the failure
 * @returns Failed broadcast result with validator pubkey
 */
export function createFailedBroadcastResult(requestData: string, error: unknown): BroadcastResult {
  return {
    status: 'failed',
    validatorPubkey: extractValidatorPubkey(requestData),
    error
  };
}

/**
 * Create a successful broadcast result
 *
 * @param response - Transaction response with hash and nonce
 * @param requestData - Original request data
 * @param contractAddress - Target system contract address
 * @param blockNumber - Block number when transaction was broadcast
 * @returns Success broadcast result with pending transaction info
 */
export function createSuccessBroadcastResult(
  response: { hash: string; nonce: number },
  requestData: string,
  contractAddress: string,
  blockNumber: number
): BroadcastResult {
  return {
    status: 'success',
    transaction: createPendingTransactionInfo(response, requestData, contractAddress, blockNumber)
  };
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

/**
 * Create an execution layer request transaction object
 *
 * @param systemContractAddress - Target system contract address
 * @param encodedRequestData - Encoded request data for the transaction
 * @param fee - Contract fee amount (transaction value)
 * @param maxFeePerGas - Optional maximum fee per gas for transaction replacement
 * @param maxPriorityFeePerGas - Optional maximum priority fee per gas
 * @returns Transaction object ready for signing
 */
export function createElTransaction(
  systemContractAddress: string,
  encodedRequestData: string,
  fee: bigint,
  maxFeePerGas?: bigint,
  maxPriorityFeePerGas?: bigint
): ExecutionLayerRequestTransaction {
  return {
    to: systemContractAddress,
    data: encodedRequestData,
    value: fee,
    gasLimit: TRANSACTION_GAS_LIMIT,
    ...(maxFeePerGas && { maxFeePerGas }),
    ...(maxPriorityFeePerGas && { maxPriorityFeePerGas })
  };
}
