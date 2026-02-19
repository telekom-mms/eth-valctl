import { MAX_NUMBER_OF_REQUESTS_PER_BLOCK } from './application';

/** User related input errors */
export const NO_PRIVATE_KEY_ERROR = 'Please provide a valid private key';
export const INVALID_PRIVATE_KEY_ERROR =
  'The provided private key does not have the correct format and/or length! Please double-check!';
export const INVALID_URL_FORMAT_ERROR = 'The provided url should start with http:// or https://';
export const INVALID_AMOUNT_ERROR = 'Amount should be a number';
export const AMOUNT_TOO_LOW_ERROR = 'Amount too low. Minimum withdrawable amount is 0.000001 ETH.';
export const INVALID_VALIDATOR_PUBKEY_ERROR = 'Supplied validator pubkey is not valid';
export const INVALID_VALIDATORS_PUBKEY_ERROR =
  'One or many of the supplied validator pubkeys are not valid';
export const WRONG_CONNECTED_NETWORK_ERROR = (
  network: string,
  connectedName: string,
  chainId: bigint
): string =>
  `Provided json rpc url is not connected to network ${network}! Url points to ${connectedName} with chainid ${chainId}`;
export const GENERAL_JSON_RPC_ERROR =
  'Error while trying to open connection for provided json rpc url:';
export const INVALID_REQUESTS_PER_BLOCK_ERROR =
  'Number of max. requests per block should be a number';
export const TOO_MANY_REQUESTS_PER_BLOCK_ERROR = `Provided maximal number of requests per block is too high. To minimize the risk of transaction reverts/replacements due to underpriced fees, the number should not exceed ${MAX_NUMBER_OF_REQUESTS_PER_BLOCK}.`;

/** Fetching errors */
export const BEACON_API_ERROR = 'Error while calling beacon API endpoint:';
export const UNEXPECTED_BEACON_API_ERROR = 'Unexpected error:';
export const RESPONSE_ERROR = 'Response error:';

/** Sending errors */
export const BATCH_PROCESSING_ERROR = (batchIndex: number): string =>
  `Error processing batch ${batchIndex + 1} - marking all transactions in batch as failed`;
export const FAILED_TO_BROADCAST_TRANSACTION_ERROR = 'Failed to broadcast execution layer request';
export const INSUFFICIENT_FUNDS_ERROR =
  'Insufficient ETH balance for transaction cost (gas fees + contract fee). Fund the wallet and retry.';
export const FAILED_TO_FETCH_REQUIRED_FEE_ERROR = (contractAddress: string): string =>
  `Failed to fetch required fee from system contract: ${contractAddress}`;
export const BATCH_INITIALIZATION_ERROR = (batchIndex: number): string =>
  `Failed to initialize batch ${batchIndex + 1} - skipping batch:`;
export const FAILED_TO_FETCH_NETWORK_FEES_ERROR = (transactionCount: number): string =>
  `Failed to fetch network fees for transaction replacement - marking ${transactionCount} transactions as failed`;
export const FAILED_TO_REPLACE_TRANSACTION_ERROR = (transactionHash: string): string =>
  `Failed to replace execution layer request ${transactionHash}:`;
export const FAILED_TO_FETCH_NETWORK_FEES_FOR_LOG_ERROR =
  'Failed to fetch network fees for broadcast log. Continue without logging fees.';
export const NONCE_EXPIRED_BROADCAST_ERROR =
  'Nonce already used (stale pending transactions from a previous run were mined). Affected validators will appear in the retry list.';

/** Info logs */
export const BROADCASTING_EL_REQUEST_INFO = 'Broadcasting execution layer request:';
export const MINED_EL_REQUEST_INFO = 'Mined execution layer request:';
export const MINED_EL_REQUEST_WITH_BLOCK_INFO = (hash: string, blockNumber: number): string =>
  `Mined execution layer request: ${hash} in block ${blockNumber}`;
export const BROADCAST_START_SEQUENTIAL_INFO = (count: number, maxFeePerGasGwei: string): string =>
  `📤 Broadcasting ${count} execution layer request${count > 1 ? 's' : ''} sequentially (max fee per gas: ${maxFeePerGasGwei} Gwei)...`;
export const SLOT_BOUNDARY_WAIT_INFO = (secondsUntilNextSlot: number): string =>
  `⏳ Near slot boundary, waiting ${secondsUntilNextSlot}s for next slot...`;
export const PROMPT_PRIVATE_KEY_INFO = 'Private key for 0x01 or 0x02 withdrawal credentials:';
export const DISCLAIMER_INFO =
  'The eth-valctl is in active development and currently missing most pre-transaction checks (see here: https://github.com/TobiWo/eth-valctl/issues/14). Please double-check your inputs before executing a command.';
export const EL_REQUEST_REVERTED_INFO = (transactionHash: string): string =>
  `Execution layer request ${transactionHash} was mined but REVERTED (likely due to incorrect fee)`;
export const EL_REQUEST_REVERTED_SENDING_NEW_INFO = (transactionHash: string): string =>
  `Execution layer request ${transactionHash} was mined but REVERTED -> Sending new request`;
export const BLOCK_CHANGE_INFO = (newBlock: number, pendingCount: number): string =>
  `Replacing ${pendingCount} pending execution layer requests with updated fees for block ${newBlock}...`;
export const BROADCAST_START_INFO = (
  count: number,
  blockNumber: number,
  maxFeePerGasGwei: string
): string =>
  `📤 Broadcasting ${count} execution layer requests targeting block ${blockNumber} (max fee per gas: ${maxFeePerGasGwei} Gwei)...`;
export const BATCH_PROGRESS_CONFIRMED = (mined: number): string =>
  `✅ ${mined} execution layer requests confirmed`;
export const BATCH_PROGRESS_PENDING = (pending: number): string =>
  `⏳ ${pending} pending for next block`;
export const TRANSACTION_REPLACED_INFO = (oldHash: string, newHash: string): string =>
  `Replaced pending execution layer request ${oldHash.slice(0, 6)}...${oldHash.slice(-5)} with ${newHash}`;
export const FAILED_VALIDATORS_FOR_RETRY_HEADER =
  '📋 Failed validator pubkeys to retry in next eth-valctl call:';

/** Warnings */
export const MAX_RETRIES_EXCEEDED_WARNING = (
  failedCount: number,
  maxRetries: number,
  pluralSuffix: string
): string =>
  `❌ Failed to process ${failedCount} execution layer request${pluralSuffix} after ${maxRetries} retries`;
export const REPLACEMENT_UNDERPRICED_WARNING = (underpriced: number, total: number): string =>
  `⏳ ${underpriced} of ${total} execution layer requests couldn't be replaced yet - retry on next block`;
export const REPLACEMENT_FAILED_WARNING = (failed: number, total: number): string =>
  `❌ ${failed} of ${total} execution layer requests failed to replace (unexpected error)`;

/** Other errors */
export const SYSTEM_CONTRACT_NOT_ACTIVATED_ERROR = (contractAddress: string): string =>
  `System contract ${contractAddress} not yet activated (excess inhibitor still active)`;
export const GENERAL_WRONG_WITHDRAWAL_CREDENTIALS_ERROR = (credentialsType: string): string =>
  `Your target validator has withdrawal credentials of type: ${credentialsType}. It needs to have 0x02 credentials. Please update your withdrawal credentials.`;
export const WRONG_WITHDRAWAL_CREDENTIALS_0x00_ERROR = `You cannot directly change the withdrawal credentials to type 0x02. You need to change to type 0x01 first.
Please follow the instructions here: https://github.com/ethereum/staking-deposit-cli?tab=readme-ov-file#generate-bls-to-execution-change-arguments or other respective documentation.`;
export const WRONG_WITHDRAWAL_CREDENTIALS_0X01_ERROR =
  "You can change the withdrawal credential type from 0x01 to 0x02 while using the 'switch' subcommand.";
export const SOURCE_VALIDATOR_0x00_CREDENTIALS_ERROR = (validatorPubkey: string): string =>
  `Source validator ${validatorPubkey} has 0x00 withdrawal credentials. Consolidation requires at least 0x01 credentials. Please update to 0x01 first.`;
export const SWITCH_SOURCE_VALIDATOR_0x00_CREDENTIALS_ERROR = (validatorPubkey: string): string =>
  `Validator ${validatorPubkey} has 0x00 withdrawal credentials and cannot be switched directly to 0x02. Please update to 0x01 first.`;
export const EXIT_VALIDATOR_0x00_CREDENTIALS_ERROR = (validatorPubkey: string): string =>
  `Validator ${validatorPubkey} has 0x00 withdrawal credentials and cannot be exited via an execution layer request. Please update to 0x01 first.`;
export const WITHDRAWAL_ADDRESS_OWNERSHIP_HEADER =
  'Withdrawal address ownership check failed. The following validators are not owned by the connected wallet:';
export const WITHDRAWAL_ADDRESS_MISMATCH_ERROR = (
  validatorPubkey: string,
  withdrawalAddress: string,
  signerAddress: string
): string =>
  `Validator ${validatorPubkey} has withdrawal address ${withdrawalAddress} which does not match signer address ${signerAddress}`;
export const SWITCH_SOURCE_VALIDATOR_ALREADY_0x02_WARNING = (validatorPubkey: string): string =>
  `Validator ${validatorPubkey} already has 0x02 credentials — skipping.`;

/** Ledger hardware wallet messages */
export const LEDGER_CONNECTING_INFO = 'Connecting to Ledger device...';
export const LEDGER_CONNECTED_INFO = (address: string): string =>
  `Ledger connected. Using address: ${address}`;
export const LEDGER_DISCONNECTED_INFO = 'Ledger device disconnected.';
export const LEDGER_CONNECTION_ERROR =
  'Failed to connect to Ledger device. Ensure the device is connected and the Ethereum app is open.';
export const LEDGER_SIGN_PROMPT = (
  currentIndex: number,
  totalCount: number,
  validatorPubkey: string
): string =>
  `[${currentIndex}/${totalCount}] Please confirm transaction on Ledger for validator ${validatorPubkey.slice(0, 10)}...${validatorPubkey.slice(-8)}`;
export const LEDGER_SIGN_GENERIC_PROMPT = 'Please confirm transaction on Ledger device...';

export const LEDGER_DEVICE_LOCKED_ERROR =
  'Ledger device is locked. Please unlock your device with your PIN and try again.';

export const LEDGER_DEVICE_DISCONNECTED_ERROR =
  'Ledger device was disconnected. Please reconnect the device and try again.';

export const LEDGER_DEVICE_DISCONNECTED_DURING_OPERATION_ERROR =
  'Ledger device was disconnected during operation. The transaction was NOT signed. Please reconnect and retry.';

export const LEDGER_ETH_APP_NOT_OPEN_ERROR =
  'Ethereum app is not open on the Ledger device. Please open the Ethereum app and try again.';

export const LEDGER_USER_REJECTED_ERROR = 'Transaction was rejected on the Ledger device.';

export const LEDGER_UNKNOWN_ERROR = (code: number): string =>
  `Unknown Ledger error (0x${code.toString(16)}). Please ensure the Ethereum app is open and try again.`;

export const LEDGER_CONNECTION_TIMEOUT_ERROR =
  'No Ledger device found. Please connect your device and ensure the Ethereum app is open.';

/** Ledger address selection messages */
export const LEDGER_ADDRESS_SELECTION_HEADER = 'Select Ledger address:';
export const LEDGER_ADDRESS_FETCHING_INFO = (page: number): string =>
  `Fetching addresses for page ${page + 1}...`;
export const LEDGER_ADDRESS_SELECTION_CANCELLED = 'Address selection cancelled.';

/** Execution status messages */
export const INSUFFICIENT_FUNDS_SKIPPING_BATCHES_WARNING = (skippedCount: number): string =>
  `⚠️ Skipping ${skippedCount} remaining batch${skippedCount === 1 ? '' : 'es'} due to insufficient funds`;

export const EXECUTION_COMPLETED_SUCCESS_INFO =
  '✅ All execution layer requests processed successfully';

export const EXECUTION_COMPLETED_WITH_FAILURES_ERROR = (
  failedCount: number,
  totalCount: number
): string =>
  `❌ Execution finished with ${failedCount} of ${totalCount} execution layer requests failed`;
