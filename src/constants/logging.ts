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
export const INVALID_PUBKEY_OR_FILE_ERROR = (value: string): string =>
  `'${value}' is neither a valid validator pubkey nor an existing file`;
export const INVALID_PUBKEY_IN_FILE_ERROR = (lineNumber: number, filePath: string): string =>
  `Invalid validator pubkey on line ${lineNumber} of ${filePath}`;
export const EMPTY_PUBKEY_FILE_ERROR = (filePath: string): string =>
  `File '${filePath}' contains no valid validator pubkeys`;
export const READ_PUBKEYS_FROM_FILE_INFO = (count: number, filePath: string): string =>
  `Read ${count} validator pubkeys from ${filePath}`;
export const INVALID_NETWORK_ERROR = (network: string): string => `Invalid network: ${network}.`;
export const WRONG_CONNECTED_NETWORK_ERROR = (
  network: string,
  connectedName: string,
  chainId: bigint
): string =>
  `Provided json rpc url is not connected to network ${network}! Url points to ${connectedName} with chainid ${chainId}`;
export const GENERAL_JSON_RPC_ERROR = (url: string): string =>
  `Error while trying to open connection for provided json rpc url ${url}:`;
export const INVALID_REQUESTS_PER_BLOCK_ERROR =
  'Number of max. requests per block should be a number';
export const TOO_MANY_REQUESTS_PER_BLOCK_ERROR = `Provided maximal number of requests per block is too high. To minimize the risk of transaction reverts/replacements due to underpriced fees, the number should not exceed ${MAX_NUMBER_OF_REQUESTS_PER_BLOCK}.`;

/** Fetching errors */
export const BEACON_API_ERROR = 'Error while calling beacon API endpoint:';
export const UNEXPECTED_BEACON_API_ERROR = (url: string): string =>
  `Unexpected beacon API error for url ${url}:`;
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
export const NONCE_CONSUMED_INFO = (nonce: number): string =>
  `Nonce ${nonce} consumed - execution layer request fulfilled by original or competing transaction`;
export const MINED_EL_REQUEST_WITH_BLOCK_INFO = (hash: string, blockNumber: number): string =>
  `Mined execution layer request: ${hash} in block ${blockNumber}`;
export const BROADCAST_START_SEQUENTIAL_INFO = (count: number, maxFeePerGasGwei: string): string =>
  `📤 Broadcasting ${count} execution layer request${count > 1 ? 's' : ''} sequentially (max fee per gas: ${maxFeePerGasGwei} Gwei)...`;
export const SLOT_BOUNDARY_WAIT_INFO = (secondsUntilNextSlot: number): string =>
  `⏳ Near slot boundary, waiting ${secondsUntilNextSlot}s for next slot...`;
export const PROMPT_PRIVATE_KEY_INFO = 'Private key for 0x01 or 0x02 withdrawal credentials:';
export const DISCLAIMER_INFO =
  'The eth-valctl is in active development and still missing some pre-transaction checks (see here: https://github.com/telekom-mms/eth-valctl/issues/14). Please double-check your inputs before executing a command.';
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
export const REJECTED_VALIDATORS_HEADER =
  '⚠️ Rejected validator pubkeys (skipped by user on Ledger device):';

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
export const REPLACEMENT_USER_REJECTED_INFO = (rejected: number, total: number): string =>
  `⚠️ ${rejected} of ${total} replacement execution layer requests rejected by user on Ledger device`;

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
export const WITHDRAWAL_ADDRESS_OWNERSHIP_HEADER = (ownerLabel: string): string =>
  `Withdrawal address ownership check failed. The following validators are not owned by the connected ${ownerLabel}:`;
export const WITHDRAWAL_ADDRESS_MISMATCH_ERROR = (
  validatorPubkey: string,
  withdrawalAddress: string,
  ownerAddress: string,
  ownerLabel: string,
  role?: string
): string => {
  const prefix = role ? `${role.charAt(0).toUpperCase()}${role.slice(1)} ` : '';
  const validator = role ? 'validator' : 'Validator';
  return `${prefix}${validator} ${validatorPubkey} has withdrawal address ${withdrawalAddress} which does not match ${ownerLabel} address ${ownerAddress}`;
};
export const WITHDRAWAL_ADDRESS_TARGET_MISMATCH_HINT =
  'Hint: Use --skip-target-ownership-check to bypass the ownership check for the target validator.';
export const SWITCH_SOURCE_VALIDATOR_ALREADY_0x02_WARNING = (validatorPubkey: string): string =>
  `Validator ${validatorPubkey} already has 0x02 credentials — skipping.`;

/** Safe multisig messages */
export const PROMPT_SAFE_SIGNER_PRIVATE_KEY_INFO = 'Private key for Safe owner:';
export const INVALID_SAFE_ADDRESS_ERROR = (address: string): string =>
  `Invalid Safe address "${address}": expected 0x-prefixed 40-character hex string`;
export const SAFE_NOT_SUPPORTED_ON_NETWORK_ERROR = (network: string): string =>
  `Safe is not supported on ${network}`;
export const SAFE_TX_SERVICE_UNREACHABLE_ERROR = (url: string): string =>
  `Safe Transaction Service at ${url} is unreachable`;
export const SAFE_TX_SERVICE_UNKNOWN_ERROR = (url: string): string =>
  `Unexpected error connecting to Safe Transaction Service at ${url}`;
export const SAFE_TX_SERVICE_UNEXPECTED_RESPONSE_ERROR = (url: string, name: string): string =>
  `Safe Transaction Service at ${url} returned unexpected response: name="${name}"`;
export const SAFE_NOT_FOUND_ERROR = (address: string, network: string): string =>
  `No Safe found at ${address} on ${network}`;
export const SAFE_SIGNER_NOT_OWNER_ERROR = (signer: string, safe: string): string =>
  `Address ${signer} is not an owner of Safe ${safe}`;
export const SAFE_API_KEY_REQUIRED_ERROR = (network: string): string =>
  `SAFE_API_KEY environment variable is required for Safe on ${network}`;
export const SAFE_VERIFYING_INFO = (address: string, network: string): string =>
  `Verifying Safe ${address} on ${network}...`;
export const SAFE_FOUND_INFO = (threshold: number, owners: number, signer: string): string =>
  `Safe found: ${threshold}/${owners} threshold, signer ${signer} is owner [OK]`;
export const SAFE_PROPOSING_BATCHES_INFO = (
  batchCount: number,
  requestsPerBatch: number
): string => {
  const txType =
    batchCount === 1 && requestsPerBatch === 1 ? 'Safe transaction' : 'Safe MultiSend transaction';
  return `Proposing ${batchCount} ${txType}${batchCount === 1 ? '' : 's'} (${requestsPerBatch} request${requestsPerBatch === 1 ? '' : 's'} each)...`;
};
export const SAFE_PROPOSED_BATCH_INFO = (
  current: number,
  total: number,
  safeTxHash: string
): string => `Proposed ${current}/${total}: safeTxHash=${safeTxHash.slice(0, 10)}...`;
export const SAFE_PROPOSAL_COMPLETE_INFO = (count: number, safeAddress: string): string =>
  `${count} transaction${count === 1 ? '' : 's'} proposed to Safe ${safeAddress}.`;
export const SAFE_PENDING_SIGNATURES_INFO = (current: number, threshold: number): string =>
  `Pending signatures: ${current}/${threshold} (${current >= threshold ? 'threshold met' : 'threshold not met'})`;
export const SAFE_DUPLICATE_PROPOSAL_WARNING = (safeTxHash: string): string =>
  `Proposal ${safeTxHash.slice(0, 10)}... already exists — skipped`;
export const SAFE_PROPOSAL_FAILED_ERROR = (safeTxHash: string, message: string): string =>
  `Failed to propose ${safeTxHash.slice(0, 10)}...: ${message}`;
export const SAFE_REMAINING_PUBKEYS_HEADER = '📋 Remaining validator pubkeys not yet proposed:';
export const SAFE_SIGN_NEXT_STEP_INFO = (safeAddress: string): string =>
  `Next step: Other owners run 'eth-valctl --safe ${safeAddress} safe sign'`;
export const SAFE_NO_PENDING_TXS_INFO = 'No pending eth-valctl transactions found';
export const SAFE_ALL_ALREADY_SIGNED_INFO = (count: number): string =>
  `All ${count} transactions already signed by you`;
export const SAFE_FETCHING_PENDING_INFO = (safeAddress: string): string =>
  `Fetching pending transactions for Safe ${safeAddress}...`;
export const SAFE_FOUND_PENDING_INFO = (count: number, rejectionCount?: number): string => {
  const suffix = rejectionCount
    ? ` (${rejectionCount} rejection${rejectionCount === 1 ? '' : 's'})`
    : '';
  return `Found ${count} pending eth-valctl transaction${count === 1 ? '' : 's'}${suffix}`;
};
export const SAFE_SIGNING_PROGRESS_INFO = (
  current: number,
  total: number,
  safeTxHash: string
): string => `Signing ${current}/${total}: safeTxHash=${safeTxHash.slice(0, 10)}... confirmed`;
export const SAFE_SIGNING_COMPLETE_INFO = (
  count: number,
  current: number,
  threshold: number
): string =>
  `${count} transaction${count === 1 ? '' : 's'} signed. Threshold ${current >= threshold ? 'reached' : 'not reached'} (${current}/${threshold}).`;
export const SAFE_EXECUTE_NEXT_STEP_INFO = (safeAddress: string): string =>
  `Next step: Run 'eth-valctl --safe ${safeAddress} safe execute' to execute on-chain.`;
export const SAFE_SIGN_FAILED_ERROR = (safeTxHash: string, message: string): string =>
  `Failed to sign ${safeTxHash.slice(0, 10)}...: ${message}`;
export const SAFE_NO_EXECUTABLE_TXS_INFO = 'No executable eth-valctl transactions found';
export const SAFE_FETCHING_EXECUTABLE_INFO = (safeAddress: string): string =>
  `Fetching executable transactions for Safe ${safeAddress}...`;
export const SAFE_FOUND_EXECUTABLE_INFO = (count: number, rejectionCount?: number): string => {
  const suffix = rejectionCount
    ? ` (${rejectionCount} rejection${rejectionCount === 1 ? '' : 's'})`
    : '';
  return `Found ${count} executable eth-valctl transaction${count === 1 ? '' : 's'}${suffix}`;
};
export const SAFE_REJECTION_DEDUP_INFO = (droppedCount: number): string =>
  `Skipping ${droppedCount} original transaction${droppedCount === 1 ? '' : 's'} replaced by rejection${droppedCount === 1 ? '' : 's'}`;
export const SAFE_NONCE_GAP_ERROR = (
  gapCount: number,
  lowNonce: number,
  highNonce: number
): string =>
  `Safe has ${gapCount} pending transaction${gapCount === 1 ? '' : 's'} with lower nonces (${lowNonce}-${highNonce}) that must be executed first`;
export const SAFE_EXECUTING_PROGRESS_INFO = (
  current: number,
  total: number,
  safeTxHash: string,
  txHash: string,
  blockNumber: number
): string =>
  `Executing ${current}/${total}: safeTxHash=${safeTxHash.slice(0, 10)}... txHash=${txHash} confirmed (block ${blockNumber})`;
export const SAFE_EXECUTION_COMPLETE_INFO = (count: number): string =>
  `${count} transaction${count === 1 ? '' : 's'} executed successfully.`;
export const SAFE_EXECUTE_FAILED_ERROR = (safeTxHash: string, message: string): string =>
  `Failed to execute ${safeTxHash.slice(0, 10)}...: ${message}`;
export const SAFE_EXECUTE_REVERTED_ERROR = (
  safeTxHash: string,
  txHash: string,
  reason?: string
): string => {
  const base = `Transaction ${safeTxHash.slice(0, 10)}... reverted on-chain (txHash=${txHash})`;
  return reason ? `${base}: ${reason}` : base;
};
export const SAFE_EXECUTE_REMAINING_HASHES_HEADER = '📋 Remaining Safe TX hashes not yet executed:';
export const SAFE_UNAUTHORIZED_ERROR =
  'Safe TX Service rejected the API key. Verify SAFE_API_KEY is valid. See https://docs.safe.global';
export const SAFE_RATE_LIMITED_RETRY_WARNING = (attempt: number, maxRetries: number): string =>
  `Rate limited by Safe TX Service, retrying in 2s (${attempt}/${maxRetries})...`;
export const SAFE_RATE_LIMIT_EXHAUSTED_ERROR =
  'Safe TX Service rate limit exceeded after 3 retries — monthly quota may be exhausted. See https://docs.safe.global';
export const SAFE_OPTION_REQUIRED_ERROR = '--safe option is required for safe commands';
export const SAFE_SIGN_SUMMARY_ALREADY_SIGNED = (count: number): string =>
  `Already signed by you: ${count}`;
export const SAFE_SIGN_CONFIRM_PROMPT = (count: number): string =>
  `Sign ${count} transaction${count === 1 ? '' : 's'}?`;
export const SAFE_EXECUTE_CONFIRM_PROMPT = (count: number): string =>
  `Execute ${count} transaction${count === 1 ? '' : 's'} on-chain?`;

/** Safe fee validation messages */
export const SAFE_FEE_VALIDATING_INFO = 'Validating contract fees...';
export const SAFE_FEE_STALE_WARNING = (
  batch: number,
  total: number,
  safeTxHash: string,
  proposed: bigint,
  current: bigint
): string =>
  `  ⚠ Batch ${batch}/${total} (${safeTxHash.slice(0, 10)}...): proposed fee ${proposed} wei < current fee ${current} wei`;
export const SAFE_FEE_BLOCK_ESTIMATE_INFO = (blocks: bigint): string =>
  `    ~${blocks} blocks until fee drops to proposed level (assuming no new requests)`;
export const SAFE_FEE_OVERPAYMENT_INFO = (
  batch: number,
  total: number,
  safeTxHash: string,
  proposed: bigint,
  current: bigint,
  overpaymentAmount: bigint
): string =>
  `  ℹ Batch ${batch}/${total} (${safeTxHash.slice(0, 10)}...): proposed fee ${proposed} wei > current fee ${current} wei (overpayment: ${overpaymentAmount} wei above threshold)`;
export const SAFE_FEE_ALL_SUFFICIENT_INFO = (count: number): string =>
  `  ✅ All ${count} transaction${count === 1 ? '' : 's'}: contract fees sufficient`;
export const SAFE_FEE_STALE_SUMMARY = (staleCount: number, total: number): string =>
  `Stale fees detected — executing now will revert ${staleCount} of ${total} transaction${total === 1 ? '' : 's'}.`;
export const SAFE_FEE_STALE_PROMPT = 'Choose an action:';
export const SAFE_FEE_WAIT_ACTION = 'Wait (exit and retry later when fees decrease)';
export const SAFE_FEE_REJECT_ACTION =
  'Reject (propose rejection transactions to cancel stale batches)';
export const SAFE_FEE_REJECTING_INFO = (count: number): string =>
  `Proposing ${count} rejection transaction${count === 1 ? '' : 's'}...`;
export const SAFE_FEE_REJECTED_INFO = (batch: number, nonce: number, safeTxHash: string): string =>
  `  ✅ Rejected ${batch}: nonce=${nonce} safeTxHash=${safeTxHash.slice(0, 10)}...`;
export const SAFE_FEE_REJECTION_COMPLETE_INFO = (count: number): string =>
  `${count} rejection transaction${count === 1 ? '' : 's'} proposed. Other owners must sign before the stale transactions are cancelled.`;
export const SAFE_FEE_READ_FAILED_WARNING = (contractAddress: string): string =>
  `  ⚠ Unable to read contract fee for ${contractAddress} — fee validation skipped`;
export const SAFE_FEE_UNVALIDATED_PROMPT = 'Contract fee could not be validated. Choose an action:';
export const SAFE_FEE_EXECUTE_ANYWAY_ACTION = 'Execute anyway (proceed without fee validation)';
export const SAFE_FEE_ABORT_ACTION = 'Abort (exit and retry later)';

/** Fee tip logging */
export const SAFE_FEE_TIP_INFO = (fee: bigint, tip: bigint, total: bigint): string =>
  `Contract fee: ${fee} wei + ${tip} wei tip = ${total} wei per request`;

/** Per-transaction fee check during execution */
export const SAFE_FEE_STALE_DURING_EXECUTION_WARNING = (
  txIndex: number,
  total: number,
  safeTxHash: string,
  proposedFee: bigint,
  currentFee: bigint
): string =>
  `  ⚠ Transaction ${txIndex}/${total} (${safeTxHash.slice(0, 10)}...): proposed fee ${proposedFee} wei < current fee ${currentFee} wei`;
export const SAFE_FEE_EXECUTION_BLOCK_ESTIMATE_INFO = (
  estimatedBlocks: bigint,
  maxWaitBlocks: bigint
): string =>
  `    ~${estimatedBlocks} blocks until fee drops to proposed level (max wait: ${maxWaitBlocks} blocks)`;
export const SAFE_FEE_EXECUTION_EXCEEDS_MAX_WAIT_ERROR = (
  estimatedBlocks: bigint,
  maxWaitBlocks: bigint
): string =>
  `Estimated ${estimatedBlocks} blocks exceeds max wait of ${maxWaitBlocks} blocks — aborting execution`;
export const SAFE_FEE_EXECUTION_WAIT_PROMPT = (estimatedBlocks: bigint): string =>
  `Fee is stale (~${estimatedBlocks} blocks to resolve). Choose an action:`;
export const SAFE_FEE_EXECUTION_WAIT_ACTION = 'Wait (pause until fee drops to proposed level)';
export const SAFE_FEE_EXECUTION_ABORT_ACTION = 'Abort (stop execution, retry later)';
export const SAFE_FEE_WAIT_PROGRESS_INFO = (
  blocksWaited: number,
  estimatedRemaining: bigint
): string =>
  `    Waiting for fee to drop... ${blocksWaited} blocks elapsed, ~${estimatedRemaining} remaining`;
export const SAFE_FEE_WAIT_SUCCESS_INFO = (txIndex: number, total: number): string =>
  `  ✅ Transaction ${txIndex}/${total}: fee is now sufficient, proceeding with execution`;
export const SAFE_FEE_WAIT_EXCEEDED_ERROR = (
  txIndex: number,
  total: number,
  maxBlocks: bigint
): string =>
  `Transaction ${txIndex}/${total}: fee did not drop within ${maxBlocks} blocks — aborting execution`;

/** EIP-1193 provider errors */
export const EIP_1193_INVALID_PARAM_TYPE_ERROR = (
  method: string,
  index: number,
  expected: string,
  actual: string
): string =>
  `Invalid parameter at index ${index} for ${method}: expected ${expected}, got ${actual}`;

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
export const LEDGER_BLIND_SIGNING_REQUIRED_ERROR =
  'Transaction requires blind signing which is not enabled on your Ledger device. ' +
  'Either enable "Blind signing" in the Ethereum app settings on your Ledger, ' +
  'or upgrade to the latest firmware which natively displays transaction details without requiring blind signing.';
export const LEDGER_UNKNOWN_ERROR = (code: number): string =>
  `Unknown Ledger error (0x${code.toString(16)}). Please ensure the Ethereum app is open and try again.`;
export const LEDGER_CONNECTION_TIMEOUT_ERROR =
  'No Ledger device found. Please connect your device and ensure the Ethereum app is open.';

/** Ledger address selection messages */
export const LEDGER_ADDRESS_SELECTION_HEADER = 'Select Ledger address:';
export const LEDGER_ADDRESS_FETCHING_INFO = (page: number): string =>
  `Fetching addresses for page ${page + 1}...`;
export const LEDGER_ADDRESS_SELECTION_CANCELLED = 'Address selection cancelled.';
export const LEDGER_ADDRESS_NOT_FOUND_ERROR = 'Selected address not found';
export const LEDGER_NAV_PREVIOUS_PAGE = '← Previous Page';
export const LEDGER_NAV_NEXT_PAGE = '→ Next Page';

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
