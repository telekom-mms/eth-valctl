import chalk from 'chalk';
import { formatUnits, parseUnits } from 'ethers';
import ora from 'ora';
import { fetch } from 'undici';

import * as application from '../../constants/application';
import * as logging from '../../constants/logging';
import type {
  BeaconListResponse,
  BeaconValidator,
  DepositContractResponse,
  PendingPartialWithdrawal,
  RequestCheck,
  ValidationContext,
  ValidatorCheck,
  ValidatorCheckGroup,
  ValidatorCheckRequest
} from '../../model/ethereum';
import { networkConfig } from '../../network-config';
import { BeaconService } from '../infrastructure/beacon-service';
import { splitToBatches } from './batch-utils';

const ROLE_SOURCE = 'source';
const ROLE_TARGET = 'target';

/**
 * Run the sanity checks for consolidation requests
 *
 * Mirrors `process_consolidation_request` of the consensus specs so that requests which would be
 * silently dropped by the beacon chain are rejected before any fee is paid.
 *
 * @param request - Common check input; `validatorPubkeys` are the source validators
 * @param targetValidatorPubkey - The target validator pubkey
 * @param skipTargetOwnershipCheck - Skip ownership validation for the target validator
 */
export async function validateConsolidationRequests(
  request: ValidatorCheckRequest,
  targetValidatorPubkey: string,
  skipTargetOwnershipCheck: boolean = false
): Promise<void> {
  const targetChecks = [hasCompoundingCredentials(ROLE_TARGET), isActiveOngoing(ROLE_TARGET)];
  if (!skipTargetOwnershipCheck) {
    targetChecks.push(isOwnedBy(request, ROLE_TARGET));
  }

  await runSanityChecks(
    request,
    [
      {
        validatorPubkeys: request.validatorPubkeys,
        role: ROLE_SOURCE,
        checks: [
          isNotEqualTo(targetValidatorPubkey),
          hasExecutionCredentials(logging.SOURCE_VALIDATOR_0x00_CREDENTIALS_ERROR),
          isOwnedBy(request, ROLE_SOURCE),
          isActiveOngoing(ROLE_SOURCE),
          isOldEnough(ROLE_SOURCE),
          hasNoPendingWithdrawal(ROLE_SOURCE)
        ]
      },
      { validatorPubkeys: [targetValidatorPubkey], role: ROLE_TARGET, checks: targetChecks }
    ],
    [hasPendingConsolidationsCapacity(request.validatorPubkeys.length)]
  );
}

/**
 * Run the sanity checks for switch (0x01 to 0x02) requests
 *
 * @param request - Common check input
 */
export async function validateSwitchRequests(request: ValidatorCheckRequest): Promise<void> {
  await runSanityChecks(request, [
    { validatorPubkeys: request.validatorPubkeys, checks: [isOwnedBy(request), isActiveOngoing()] }
  ]);
}

/**
 * Run the sanity checks for partial withdrawal requests (amount above 0) or exit requests (amount 0)
 *
 * Mirrors `process_withdrawal_request` of the consensus specs. For partial withdrawals a warning is
 * printed when the requested amount exceeds the withdrawable balance, because the beacon chain caps
 * the amount instead of dropping the request.
 *
 * @param request - Common check input
 * @param amount - The amount in ETH to withdraw (0 for exit)
 */
export async function validateWithdrawalRequests(
  request: ValidatorCheckRequest,
  amount: number
): Promise<void> {
  const isExit = amount === 0;
  const commonChecks = [isOwnedBy(request), isActiveOngoing(), isOldEnough()];
  const checks = isExit
    ? [
        hasExecutionCredentials(logging.EXIT_VALIDATOR_0x00_CREDENTIALS_ERROR),
        ...commonChecks,
        hasNoPendingWithdrawal()
      ]
    : [hasCompoundingCredentials(), ...commonChecks, hasExcessBalance];
  const requestChecks = isExit
    ? []
    : [hasPendingPartialWithdrawalsCapacity(request.validatorPubkeys.length)];

  const context = await runSanityChecks(
    request,
    [{ validatorPubkeys: request.validatorPubkeys, checks }],
    requestChecks
  );

  if (!isExit) {
    warnAboutCappedWithdrawals(
      request.validatorPubkeys,
      parseUnits(amount.toString(), 'gwei'),
      context
    );
  }
}

/**
 * Filter validators that can be switched from 0x01 to 0x02
 *
 * - not found / 0x00: hard error (cannot switch)
 * - 0x01: included in returned list (valid for switch)
 * - 0x02: excluded with yellow warning (already compounding)
 *
 * @param beaconApiUrl - The beacon api url
 * @param validatorPubkeys - The validator public keys to check
 * @returns Filtered list of pubkeys that need switching
 */
export async function filterSwitchableValidators(
  beaconApiUrl: string,
  validatorPubkeys: string[]
): Promise<string[]> {
  const validators = await withBeaconErrorHandling(beaconApiUrl, () =>
    fetchValidators(beaconApiUrl, validatorPubkeys)
  );
  const switchable: string[] = [];
  const failures: string[] = [];

  for (const validatorPubkey of validatorPubkeys) {
    const validator = validators.get(validatorPubkey.toLowerCase());
    const credentialsType = validator && getCredentialsType(validator);

    if (!validator) {
      failures.push(logging.VALIDATOR_NOT_FOUND_ERROR(logging.VALIDATOR_SUBJECT(validatorPubkey)));
    } else if (credentialsType === application.WITHDRAWAL_CREDENTIALS_0x00) {
      failures.push(logging.SWITCH_SOURCE_VALIDATOR_0x00_CREDENTIALS_ERROR(validatorPubkey));
    } else if (credentialsType === application.WITHDRAWAL_CREDENTIALS_0x02) {
      console.log(
        chalk.yellow(logging.SWITCH_SOURCE_VALIDATOR_ALREADY_0x02_WARNING(validatorPubkey))
      );
    } else {
      switchable.push(validatorPubkey);
    }
  }

  if (failures.length > 0) {
    reportFailures(failures);
  }

  return switchable;
}

/**
 * Load the beacon chain state, run all checks and terminate the process if any check fails
 *
 * All failures are collected and reported together so that the user can fix every issue at once.
 *
 * @param request - Common check input
 * @param groups - Validators with their per-validator checks
 * @param requestChecks - Checks on the whole request set
 * @returns The loaded validation context
 */
async function runSanityChecks(
  request: ValidatorCheckRequest,
  groups: ValidatorCheckGroup[],
  requestChecks: RequestCheck[] = []
): Promise<ValidationContext> {
  const pubkeys = [...new Set(groups.flatMap((group) => group.validatorPubkeys))];
  const fetchSpinner = ora(logging.SANITY_CHECK_FETCH_INFO).start();
  let context: ValidationContext;
  try {
    context = await loadValidationContext(request.beaconApiUrl, pubkeys);
    fetchSpinner.succeed();
  } catch (error) {
    fetchSpinner.fail();
    return exitWithBeaconError(request.beaconApiUrl, error);
  }

  const checkSpinner = ora(logging.SANITY_CHECK_RUN_INFO).start();
  const failures = [
    ...[isSameNetwork(request.network), ...requestChecks].map((check) => check(context)),
    ...groups.flatMap((group) => runValidatorChecks(group, context))
  ].filter((failure): failure is string => failure !== undefined);

  if (failures.length > 0) {
    checkSpinner.fail();
    reportFailures(failures);
  }

  checkSpinner.succeed(logging.SANITY_CHECK_PASSED_INFO);
  return context;
}

/**
 * Run the checks of one group against every validator of the group
 *
 * Validators which are not found on the beacon chain only report the missing validator.
 *
 * @param group - Validators with their checks
 * @param context - The loaded validation context
 * @returns Error messages of all failed checks
 */
function runValidatorChecks(
  group: ValidatorCheckGroup,
  context: ValidationContext
): (string | undefined)[] {
  return group.validatorPubkeys.flatMap((validatorPubkey) => {
    const validator = context.validators.get(validatorPubkey.toLowerCase());
    if (!validator) {
      return [
        logging.VALIDATOR_NOT_FOUND_ERROR(logging.VALIDATOR_SUBJECT(validatorPubkey, group.role))
      ];
    }
    return group.checks.map((check) => check(validatorPubkey, validator, context));
  });
}

/**
 * Fetch all beacon chain data required by the sanity checks
 *
 * @param beaconApiUrl - The beacon api url
 * @param validatorPubkeys - The validator pubkeys to fetch
 * @returns The validation context
 */
async function loadValidationContext(
  beaconApiUrl: string,
  validatorPubkeys: string[]
): Promise<ValidationContext> {
  const [beaconService, validators, pendingWithdrawals, pendingConsolidations, depositContract] =
    await Promise.all([
      BeaconService.create(beaconApiUrl),
      fetchValidators(beaconApiUrl, validatorPubkeys),
      fetchBeaconJson<BeaconListResponse<PendingPartialWithdrawal>>(
        `${beaconApiUrl}${application.PENDING_PARTIAL_WITHDRAWALS_BEACON_API_ENDPOINT}`
      ),
      fetchBeaconJson<BeaconListResponse<unknown>>(
        `${beaconApiUrl}${application.PENDING_CONSOLIDATIONS_BEACON_API_ENDPOINT}`
      ),
      fetchBeaconJson<DepositContractResponse>(
        `${beaconApiUrl}${application.DEPOSIT_CONTRACT_BEACON_API_ENDPOINT}`
      )
    ]);

  const pendingWithdrawalAmounts = new Map<string, bigint>();
  for (const { validator_index, amount } of pendingWithdrawals.data) {
    pendingWithdrawalAmounts.set(
      validator_index,
      (pendingWithdrawalAmounts.get(validator_index) ?? 0n) + BigInt(amount)
    );
  }

  return {
    spec: beaconService.spec,
    currentEpoch: beaconService.calculateCurrentEpoch(),
    beaconChainId: depositContract.data.chain_id,
    validators,
    pendingWithdrawalAmounts,
    pendingPartialWithdrawalCount: pendingWithdrawals.data.length,
    pendingConsolidationCount: pendingConsolidations.data.length
  };
}

/**
 * Fetch validators in bulk from the head state
 *
 * Unknown pubkeys are omitted by the beacon API and are therefore missing from the result.
 *
 * @param beaconApiUrl - The beacon api url
 * @param validatorPubkeys - The validator pubkeys to fetch
 * @returns Validators keyed by lower-case pubkey
 */
async function fetchValidators(
  beaconApiUrl: string,
  validatorPubkeys: string[]
): Promise<Map<string, BeaconValidator>> {
  const url = `${beaconApiUrl}${application.VALIDATORS_BEACON_API_ENDPOINT}`;
  const responses = await Promise.all(
    splitToBatches(validatorPubkeys, application.VALIDATORS_REQUEST_CHUNK_SIZE).map((ids) =>
      fetchBeaconJson<BeaconListResponse<BeaconValidator>>(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids })
      })
    )
  );
  return new Map(
    responses
      .flatMap((response) => response.data)
      .map((validator) => [validator.validator.pubkey.toLowerCase(), validator])
  );
}

/**
 * Fetch and parse a JSON response from the beacon API
 *
 * @param url - The full endpoint url
 * @param init - Optional request options
 * @returns The parsed response body
 * @throws Error if the response status is not ok
 */
async function fetchBeaconJson<T>(url: string, init?: Parameters<typeof fetch>[1]): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(logging.BEACON_API_REQUEST_ERROR(url, response.status, await response.text()));
  }
  return (await response.json()) as T;
}

/**
 * Run a beacon API call and terminate the process on failure
 *
 * @param beaconApiUrl - The beacon api url
 * @param call - The beacon API call
 * @returns The result of the call
 */
async function withBeaconErrorHandling<T>(
  beaconApiUrl: string,
  call: () => Promise<T>
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    return exitWithBeaconError(beaconApiUrl, error);
  }
}

/**
 * Print a beacon API error and terminate the process
 *
 * @param beaconApiUrl - The beacon api url
 * @param error - The caught error
 */
function exitWithBeaconError(beaconApiUrl: string, error: unknown): never {
  if (error instanceof TypeError) {
    console.error(chalk.red(logging.BEACON_API_ERROR, error.cause));
  } else {
    console.error(chalk.red(logging.UNEXPECTED_BEACON_API_ERROR(beaconApiUrl), error));
  }
  process.exit(1);
}

/**
 * Print all sanity check failures and terminate the process
 *
 * @param failures - Error messages of all failed checks
 */
function reportFailures(failures: string[]): never {
  console.error(chalk.red(logging.SANITY_CHECK_FAILED_HEADER(failures.length)));
  for (const failure of failures) {
    console.error(chalk.red(`  - ${failure}`));
  }
  process.exit(1);
}

/**
 * Print a warning for every validator whose withdrawable balance is below the requested amount
 *
 * @param validatorPubkeys - The validator pubkeys
 * @param amountGwei - The requested amount in gwei
 * @param context - The loaded validation context
 */
function warnAboutCappedWithdrawals(
  validatorPubkeys: string[],
  amountGwei: bigint,
  context: ValidationContext
): void {
  for (const validatorPubkey of validatorPubkeys) {
    const withdrawable = getWithdrawableBalance(
      context.validators.get(validatorPubkey.toLowerCase())!,
      context
    );
    if (amountGwei > withdrawable) {
      console.log(
        chalk.yellow(
          logging.WITHDRAWAL_AMOUNT_CAPPED_WARNING(
            validatorPubkey,
            formatUnits(withdrawable, 'gwei')
          )
        )
      );
    }
  }
}

/**
 * Calculate the balance above the minimum activation balance which is not yet pending for withdrawal
 *
 * @param validator - The validator
 * @param context - The loaded validation context
 * @returns Withdrawable balance in gwei
 */
function getWithdrawableBalance(validator: BeaconValidator, context: ValidationContext): bigint {
  const pending = context.pendingWithdrawalAmounts.get(validator.index) ?? 0n;
  return BigInt(validator.balance) - context.spec.minActivationBalance - pending;
}

/**
 * Get the withdrawal credentials type prefix of a validator
 *
 * @param validator - The validator
 * @returns The credentials type prefix (e.g. '0x00', '0x01', '0x02')
 */
function getCredentialsType(validator: BeaconValidator): string {
  return validator.validator.withdrawal_credentials.substring(0, 4);
}

/**
 * Extract the Ethereum address from withdrawal credentials
 *
 * @param credentials - The full withdrawal credentials hex string
 * @returns The embedded Ethereum address (last 20 bytes)
 */
function extractAddressFromCredentials(credentials: string): string {
  return '0x' + credentials.substring(26);
}

/**
 * Check that the beacon node is connected to the chosen network
 *
 * @param network - The user provided network
 * @returns The request check
 */
function isSameNetwork(network: string): RequestCheck {
  return (context) => {
    const expectedChainId = networkConfig[network]!.chainId;
    return BigInt(context.beaconChainId) === expectedChainId
      ? undefined
      : logging.BEACON_NETWORK_MISMATCH_ERROR(network, expectedChainId, context.beaconChainId);
  };
}

/**
 * Check that the pending consolidations queue can take all requests
 *
 * @param requestCount - Number of requests to send
 * @returns The request check
 */
function hasPendingConsolidationsCapacity(requestCount: number): RequestCheck {
  return (context) =>
    context.pendingConsolidationCount + requestCount <= context.spec.pendingConsolidationsLimit
      ? undefined
      : logging.PENDING_CONSOLIDATIONS_QUEUE_FULL_ERROR(
          context.pendingConsolidationCount,
          context.spec.pendingConsolidationsLimit
        );
}

/**
 * Check that the pending partial withdrawals queue can take all requests
 *
 * @param requestCount - Number of requests to send
 * @returns The request check
 */
function hasPendingPartialWithdrawalsCapacity(requestCount: number): RequestCheck {
  return (context) =>
    context.pendingPartialWithdrawalCount + requestCount <=
    context.spec.pendingPartialWithdrawalsLimit
      ? undefined
      : logging.PENDING_PARTIAL_WITHDRAWALS_QUEUE_FULL_ERROR(
          context.pendingPartialWithdrawalCount,
          context.spec.pendingPartialWithdrawalsLimit
        );
}

/**
 * Check that a source validator is not the consolidation target
 *
 * @param targetValidatorPubkey - The target validator pubkey
 * @returns The validator check
 */
function isNotEqualTo(targetValidatorPubkey: string): ValidatorCheck {
  return (validatorPubkey) =>
    validatorPubkey.toLowerCase() === targetValidatorPubkey.toLowerCase()
      ? logging.CONSOLIDATION_SOURCE_EQUALS_TARGET_ERROR(validatorPubkey)
      : undefined;
}

/**
 * Check that a validator has at least execution credentials (0x01 or 0x02)
 *
 * @param formatError - Formats the error message for a validator with 0x00 credentials
 * @returns The validator check
 */
function hasExecutionCredentials(formatError: (validatorPubkey: string) => string): ValidatorCheck {
  return (validatorPubkey, validator) =>
    getCredentialsType(validator) === application.WITHDRAWAL_CREDENTIALS_0x00
      ? formatError(validatorPubkey)
      : undefined;
}

/**
 * Check that a validator has compounding (0x02) credentials
 *
 * @param role - Optional role ('source' / 'target') used in the error message
 * @returns The validator check
 */
function hasCompoundingCredentials(role?: string): ValidatorCheck {
  return (validatorPubkey, validator) => {
    const credentialsType = getCredentialsType(validator);
    if (credentialsType === application.WITHDRAWAL_CREDENTIALS_0x02) {
      return undefined;
    }
    const hint =
      credentialsType === application.WITHDRAWAL_CREDENTIALS_0x00
        ? logging.WRONG_WITHDRAWAL_CREDENTIALS_0x00_ERROR
        : logging.WRONG_WITHDRAWAL_CREDENTIALS_0X01_ERROR;
    const error = logging.VALIDATOR_NOT_COMPOUNDING_ERROR(
      logging.VALIDATOR_SUBJECT(validatorPubkey, role),
      credentialsType
    );
    return `${error} ${hint}`;
  };
}

/**
 * Check that the owner address matches the withdrawal address of a validator
 *
 * Skipped for 0x00 credentials which embed no address; those are reported by the credentials checks.
 *
 * @param request - Common check input with owner address and label
 * @param role - Optional role ('source' / 'target') used in the error message
 * @returns The validator check
 */
function isOwnedBy(request: ValidatorCheckRequest, role?: string): ValidatorCheck {
  const ownerLabel = request.ownerLabel ?? application.OWNER_LABEL_SIGNER;
  return (validatorPubkey, validator) => {
    if (getCredentialsType(validator) === application.WITHDRAWAL_CREDENTIALS_0x00) {
      return undefined;
    }
    const withdrawalAddress = extractAddressFromCredentials(
      validator.validator.withdrawal_credentials
    );
    if (withdrawalAddress.toLowerCase() === request.ownerAddress.toLowerCase()) {
      return undefined;
    }
    const mismatch = logging.WITHDRAWAL_ADDRESS_MISMATCH_ERROR(
      validatorPubkey,
      withdrawalAddress,
      request.ownerAddress,
      ownerLabel,
      role
    );
    return role === ROLE_TARGET
      ? `${mismatch}. ${logging.WITHDRAWAL_ADDRESS_TARGET_MISMATCH_HINT}`
      : mismatch;
  };
}

/**
 * Check that a validator is active and not exiting or slashed
 *
 * @param role - Optional role ('source' / 'target') used in the error message
 * @returns The validator check
 */
function isActiveOngoing(role?: string): ValidatorCheck {
  return (validatorPubkey, validator) =>
    validator.status === application.VALIDATOR_STATUS_ACTIVE_ONGOING
      ? undefined
      : logging.VALIDATOR_NOT_ACTIVE_ERROR(
          logging.VALIDATOR_SUBJECT(validatorPubkey, role),
          validator.status
        );
}

/**
 * Check that a validator has been active for at least SHARD_COMMITTEE_PERIOD epochs
 *
 * @param role - Optional role ('source' / 'target') used in the error message
 * @returns The validator check
 */
function isOldEnough(role?: string): ValidatorCheck {
  return (validatorPubkey, validator, context) => {
    const eligibleEpoch =
      Number(validator.validator.activation_epoch) + context.spec.shardCommitteePeriod;
    return context.currentEpoch >= eligibleEpoch
      ? undefined
      : logging.VALIDATOR_NOT_OLD_ENOUGH_ERROR(
          logging.VALIDATOR_SUBJECT(validatorPubkey, role),
          eligibleEpoch,
          context.currentEpoch
        );
  };
}

/**
 * Check that a validator has no pending partial withdrawal
 *
 * @param role - Optional role ('source' / 'target') used in the error message
 * @returns The validator check
 */
function hasNoPendingWithdrawal(role?: string): ValidatorCheck {
  return (validatorPubkey, validator, context) =>
    context.pendingWithdrawalAmounts.has(validator.index)
      ? logging.VALIDATOR_HAS_PENDING_WITHDRAWAL_ERROR(
          logging.VALIDATOR_SUBJECT(validatorPubkey, role)
        )
      : undefined;
}

/**
 * Check that a validator has balance above the minimum activation balance which is not yet pending
 *
 * @param validatorPubkey - The validator pubkey
 * @param validator - The validator
 * @param context - The loaded validation context
 * @returns Error message on failure
 */
function hasExcessBalance(
  validatorPubkey: string,
  validator: BeaconValidator,
  context: ValidationContext
): string | undefined {
  const hasMinEffectiveBalance =
    BigInt(validator.validator.effective_balance) >= context.spec.minActivationBalance;
  return hasMinEffectiveBalance && getWithdrawableBalance(validator, context) > 0n
    ? undefined
    : logging.VALIDATOR_BALANCE_TOO_LOW_ERROR(validatorPubkey);
}
