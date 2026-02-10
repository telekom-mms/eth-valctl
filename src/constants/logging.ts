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
export const TOO_MANY_REQUESTS_PER_BLOCK_ERROR = `Provided maximal number of requests per block is too high.
The estimated max. per block is 220-230 requests. If this is exceeded the probability increases
that request transactions will be reverted due to an insufficiently calculated fee.`;

/** Fetching errors */
export const BEACON_API_ERROR = 'Error while calling beacon API endpoint:';
export const UNEXPECTED_BEACON_API_ERROR = 'Unexpected error:';
export const RESPONSE_ERROR = 'Response error:';

/** Sending errors */
export const BATCH_PROCESSING_ERROR = (batchIndex: number): string =>
  `Error processing batch ${batchIndex + 1} - marking all transactions in batch as failed`;
export const FAILED_TO_BROADCAST_TRANSACTION_ERROR = 'Failed to broadcast execution layer request';
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

/** Info logs */
export const BROADCASTING_EL_REQUEST_INFO = 'Broadcasting execution layer request:';
export const MINED_EL_REQUEST_INFO = 'Mined execution layer request:';
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
export const WITHDRAWAL_CREDENTIAL_WARNING =
  'Attention: You can only consolidate validators with the same withdrawal credentials!';
export const EXIT_WARNING =
  'Attention: Your validators need to have withdrawal credentials of type 0x01 or 0x02 in order to be able to exit via an execution layer request.';
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
