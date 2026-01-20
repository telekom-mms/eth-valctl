// User related input errors
export const NO_PRIVATE_KEY_ERROR = 'Please provide a valid private key';
export const INVALID_PRIVATE_KEY_ERROR =
  'The provided private key does not have the correct format and/or length! Please double-check!';
export const INVALID_URL_FORMAT_ERROR = 'The provided url should start with http:// or https://';
export const INVALID_AMOUNT_ERROR = 'Amount should be a number';
export const AMOUNT_TOO_LOW_ERROR = 'Amount too low. Minimum withdrawable amount is 0.000001 ETH.';
export const INVALID_VALIDATOR_PUBKEY_ERROR = 'Supplied validator pubkey is not valid';
export const INVALID_VALIDATORS_PUBKEY_ERROR =
  'One or many of the supplied validator pubkeys are not valid';
export const WRONG_CONNECTED_NETWORK_ERROR =
  'Provided json rpc url is not connected to network %s! Url points to %s with chainid %d';
export const GENERAL_JSON_RPC_ERROR =
  'Error while trying to open connection for provided json rpc url:';
export const INVALID_REQUESTS_PER_BLOCK_ERROR =
  'Number of max. requests per block should be a number';
export const TOO_MANY_REQUESTS_PER_BLOCK_ERROR = `Provided maximal number of requests per block is too high.
The estimated max. per block is 220-230 requests. If this is exceeded the probability increases
that request transactions will be reverted due to an insufficiently calculated fee.`;

// Fetching errors
export const FETCHING_LOGS_ERROR =
  'Error fetching logs for median contract queue length calculation:';
export const BEACON_API_ERROR = 'Error while calling beacon API endpoint:';
export const UNEXPECTED_BEACON_API_ERROR = 'Unexpected error:';
export const RESPONSE_ERROR = 'Response error:';

// Sending errors
export const SENDING_TRANSACTION_ERROR = 'Error Sending Transaction:';

// Info logs
export const BROADCASTING_EL_REQUEST_INFO = 'Broadcasting execution layer request:';
export const MINED_EL_REQUEST_INFO = 'Mined execution layer request:';
export const PROMPT_PRIVATE_KEY_INFO = 'Private key for 0x01 or 0x02 withdrawal credentials:';
export const DISCLAIMER_INFO =
  'The eth-valctl is in active development and currently missing most pre-transaction checks (see here: https://github.com/TobiWo/eth-valctl/issues/14). Please double-check your inputs before executing a command.';

// Warnings
export const WITHDRAWAL_CREDENTIAL_WARNING =
  'Attention: You can only consolidate validators with the same withdrawal credentials!';
export const EXIT_WARNING =
  'Attention: Your validators need to have withdrawal credentials of type 0x01 or 0x02 in order to be able to exit via an execution layer request.';

// Other errors
export const GENERAL_WRONG_WITHDRAWAL_CREDENTIALS_ERROR = `Your target validator has withdrawal credentials of type: %s.
It needs to have 0x02 credentials. Please update your withdrawal credentials.`;
export const WRONG_WITHDRAWAL_CREDENTIALS_0x00_ERROR = `You cannot directly change the withdrawal credentials to type 0x02. You need to change to type 0x01 first.
Please follow the instructions here: https://github.com/ethereum/staking-deposit-cli?tab=readme-ov-file#generate-bls-to-execution-change-arguments or other respective documentation.`;
export const WRONG_WITHDRAWAL_CREDENTIALS_0X01_ERROR =
  "You can change the withdrawal credential type from 0x01 to 0x02 while using the 'switch' subcommand.";
