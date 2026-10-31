import { PublicKey } from '@chainsafe/blst';
import chalk from 'chalk';
import { formatUnits } from 'ethers';
import { readFileSync } from 'fs';

import * as application from '../../constants/application';
import * as logging from '../../constants/logging';
import type { GlobalCliOptions } from '../../model/commander';
import type {
  DepositData,
  DepositDataFileEntry,
  DepositDataHexField,
  ParsedDepositEntry
} from '../../model/ethereum';
import { networkConfig } from '../../network-config';
import {
  computeDepositDataRoot,
  computeDepositMessageRoot,
  verifyDepositSignature
} from './deposit-contract';
import { executeDepositPipeline } from './execution-layer-request-pipeline';
import {
  filterDepositRequests,
  getCredentialsTypePrefix,
  reportFailures
} from './pre-request-validation';

/**
 * Deposit new validators from a deposit_data-*.json file of ethstaker-deposit-cli
 *
 * Local file checks and beacon chain checks (which skip already deposited validators) run before
 * the private key or Ledger is requested; the signer balance check runs once the signer is known.
 *
 * @param globalOptions - The global cli options
 * @param depositDataPath - Path to the deposit data file
 */
export async function deposit(
  globalOptions: GlobalCliOptions,
  depositDataPath: string
): Promise<void> {
  const deposits = loadDepositData(depositDataPath, globalOptions.network);
  const depositsToSend = await filterDepositRequests(
    globalOptions.beaconApiUrl,
    globalOptions.network,
    deposits
  );
  if (depositsToSend.length === 0) {
    console.log(chalk.green(logging.DEPOSIT_NOTHING_TO_SEND_INFO));
    return;
  }

  await executeDepositPipeline(globalOptions, depositsToSend);
}

/**
 * Read a deposit data file and run all local checks against the selected network
 *
 * All failures are collected and reported together; the process exits on any failure.
 *
 * @param depositDataPath - Path to the deposit data file
 * @param network - The selected network (must have a deposit config)
 * @returns Validated deposits
 */
export function loadDepositData(depositDataPath: string, network: string): DepositData[] {
  const parsedEntries = readDepositDataFile(depositDataPath).map((entry, index) =>
    parseDepositEntry(entry, index + 1, network)
  );
  const failures = parsedEntries.flatMap((parsed) => parsed.failures);
  const deposits = parsedEntries.flatMap((parsed) => (parsed.data ? [parsed.data] : []));

  const seen = new Set<string>();
  for (const { pubkey } of deposits) {
    if (seen.has(pubkey)) {
      failures.push(logging.DEPOSIT_DUPLICATE_PUBKEY_ERROR(pubkey));
    }
    seen.add(pubkey);
  }
  if (new Set(deposits.map((data) => data.amountGwei)).size > 1) {
    failures.push(logging.DEPOSIT_MIXED_AMOUNTS_ERROR);
  }

  if (failures.length > 0) {
    reportFailures(failures);
  }

  const amountGwei = deposits[0]!.amountGwei;
  if (amountGwei < application.MIN_ACTIVATION_BALANCE_GWEI) {
    console.log(
      chalk.yellow(
        logging.DEPOSIT_AMOUNT_BELOW_ACTIVATION_WARNING(
          formatGweiAsEth(amountGwei),
          formatGweiAsEth(application.MIN_ACTIVATION_BALANCE_GWEI)
        )
      )
    );
  }
  return deposits;
}

/**
 * Read the deposit data file and check that it holds a non-empty JSON array
 *
 * @param depositDataPath - Path to the deposit data file
 * @returns Raw file entries (not yet validated)
 */
function readDepositDataFile(depositDataPath: string): unknown[] {
  let content: string;
  try {
    content = readFileSync(depositDataPath, 'utf8');
  } catch (error) {
    return reportFailures([
      logging.DEPOSIT_FILE_READ_ERROR(depositDataPath, (error as Error).message)
    ]);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return reportFailures([logging.DEPOSIT_FILE_NOT_JSON_ERROR(depositDataPath)]);
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return reportFailures([logging.DEPOSIT_FILE_EMPTY_ERROR(depositDataPath)]);
  }
  return parsed;
}

/**
 * Validate one deposit data entry against the selected network
 *
 * The BLS signature is only checked when the fork version matches, so a file for another network
 * reports the fork mismatch once instead of an additional signature failure.
 *
 * @param entry - Raw file entry
 * @param entryNumber - 1-based entry number for error messages
 * @param network - The selected network
 * @returns The parsed deposit, or the failures of the entry
 */
function parseDepositEntry(
  entry: unknown,
  entryNumber: number,
  network: string
): ParsedDepositEntry {
  const subject = logging.DEPOSIT_ENTRY_SUBJECT(entryNumber);
  const raw = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
  const failures: string[] = [];

  const hex = {} as Record<DepositDataHexField, string>;
  for (const [field, bytes] of Object.entries(application.DEPOSIT_DATA_HEX_FIELD_BYTES) as [
    DepositDataHexField,
    number
  ][]) {
    const value = raw[field];
    if (typeof value !== 'string') {
      failures.push(logging.DEPOSIT_FIELD_INVALID_ERROR(subject, field));
    } else if (!application.HEX_PATTERN.test(value) || stripHexPrefix(value).length !== bytes * 2) {
      failures.push(logging.DEPOSIT_FIELD_HEX_ERROR(subject, field, bytes));
    } else {
      hex[field] = application.PREFIX_0x + stripHexPrefix(value).toLowerCase();
    }
  }
  const amount = (raw as Partial<DepositDataFileEntry>).amount;
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) {
    failures.push(logging.DEPOSIT_FIELD_INVALID_ERROR(subject, 'amount'));
  }
  if (failures.length > 0) {
    return { failures };
  }

  const data: DepositData = {
    pubkey: hex.pubkey,
    withdrawalCredentials: hex.withdrawal_credentials,
    amountGwei: BigInt(amount!),
    signature: hex.signature
  };
  const forkVersionFailure = checkForkVersion(subject, hex.fork_version, network);
  const checkFailures = [
    checkPubkey(subject, data),
    checkWithdrawalCredentials(subject, data),
    checkAmount(subject, data),
    forkVersionFailure,
    ...checkRoots(subject, data, hex),
    forkVersionFailure ? undefined : checkSignature(subject, data, network)
  ].filter((failure): failure is string => failure !== undefined);

  return checkFailures.length > 0 ? { failures: checkFailures } : { data, failures: [] };
}

/**
 * Check that the pubkey is a valid BLS public key (G1 point, not infinity)
 *
 * @param subject - Entry subject for the error message
 * @param data - Parsed deposit
 * @returns Error message on failure
 */
function checkPubkey(subject: string, data: DepositData): string | undefined {
  try {
    PublicKey.fromHex(data.pubkey, true);
    return undefined;
  } catch {
    return logging.DEPOSIT_INVALID_PUBKEY_ERROR(subject);
  }
}

/**
 * Check for 0x01/0x02 withdrawal credentials with zero padding
 *
 * @param subject - Entry subject for the error message
 * @param data - Parsed deposit
 * @returns Error message on failure
 */
function checkWithdrawalCredentials(subject: string, data: DepositData): string | undefined {
  if (data.withdrawalCredentials.startsWith(application.WITHDRAWAL_CREDENTIALS_0x00)) {
    return logging.DEPOSIT_0x00_CREDENTIALS_ERROR(subject);
  }
  return application.EXECUTION_WITHDRAWAL_CREDENTIALS_PATTERN.test(data.withdrawalCredentials)
    ? undefined
    : logging.DEPOSIT_INVALID_CREDENTIALS_ERROR(subject, data.withdrawalCredentials);
}

/**
 * Check the amount against the minimum deposit and the max effective balance of the credential type
 *
 * @param subject - Entry subject for the error message
 * @param data - Parsed deposit
 * @returns Error message on failure
 */
function checkAmount(subject: string, data: DepositData): string | undefined {
  if (data.amountGwei < application.MIN_DEPOSIT_AMOUNT_GWEI) {
    return logging.DEPOSIT_AMOUNT_TOO_LOW_ERROR(
      subject,
      formatGweiAsEth(application.MIN_DEPOSIT_AMOUNT_GWEI)
    );
  }
  const credentialsType = getCredentialsTypePrefix(data.withdrawalCredentials);
  const maxGwei =
    credentialsType === application.WITHDRAWAL_CREDENTIALS_0x02
      ? application.MAX_EFFECTIVE_BALANCE_ELECTRA_GWEI
      : application.MIN_ACTIVATION_BALANCE_GWEI;
  return data.amountGwei > maxGwei
    ? logging.DEPOSIT_AMOUNT_TOO_HIGH_ERROR(subject, credentialsType, formatGweiAsEth(maxGwei))
    : undefined;
}

/**
 * Check that the deposit data was generated for the selected network
 *
 * @param subject - Entry subject for the error message
 * @param forkVersion - Normalised fork version of the entry
 * @param network - The selected network
 * @returns Error message on failure
 */
function checkForkVersion(
  subject: string,
  forkVersion: string,
  network: string
): string | undefined {
  const genesisForkVersion = networkConfig[network]!.deposit!.genesisForkVersion;
  return forkVersion === genesisForkVersion
    ? undefined
    : logging.DEPOSIT_FORK_VERSION_MISMATCH_ERROR(
        subject,
        forkVersion,
        network,
        genesisForkVersion
      );
}

/**
 * Check both roots of the entry against the roots recomputed from the deposit
 *
 * @param subject - Entry subject for the error message
 * @param data - Parsed deposit
 * @param hex - Normalised hex fields of the entry
 * @returns Error messages of all failed checks
 */
function checkRoots(
  subject: string,
  data: DepositData,
  hex: Record<DepositDataHexField, string>
): (string | undefined)[] {
  return [
    computeDepositMessageRoot(data) === hex.deposit_message_root
      ? undefined
      : logging.DEPOSIT_MESSAGE_ROOT_MISMATCH_ERROR(subject),
    computeDepositDataRoot(data) === hex.deposit_data_root
      ? undefined
      : logging.DEPOSIT_DATA_ROOT_MISMATCH_ERROR(subject)
  ];
}

/**
 * Check the BLS signature of the deposit for the selected network
 *
 * @param subject - Entry subject for the error message
 * @param data - Parsed deposit
 * @param network - The selected network
 * @returns Error message on failure
 */
function checkSignature(subject: string, data: DepositData, network: string): string | undefined {
  return verifyDepositSignature(data, networkConfig[network]!.deposit!.genesisForkVersion)
    ? undefined
    : logging.DEPOSIT_SIGNATURE_INVALID_ERROR(subject, network);
}

/**
 * Remove an optional 0x prefix
 *
 * @param value - Hex string with or without prefix
 * @returns Hex string without prefix
 */
function stripHexPrefix(value: string): string {
  return value.startsWith(application.PREFIX_0x)
    ? value.slice(application.PREFIX_0x.length)
    : value;
}

/**
 * Format a gwei amount as ETH
 *
 * @param amountGwei - Amount in gwei
 * @returns Amount in ETH
 */
function formatGweiAsEth(amountGwei: bigint): string {
  return formatUnits(amountGwei, application.GWEI_UNIT);
}
