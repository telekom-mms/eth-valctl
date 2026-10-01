import { afterEach, beforeEach, describe, expect, it, mock, setSystemTime, spyOn } from 'bun:test';
import * as undici from 'undici';

import {
  DEPOSIT_CONTRACT_BEACON_API_ENDPOINT,
  GENESIS_BEACON_API_ENDPOINT,
  OWNER_LABEL_SAFE,
  OWNER_LABEL_SIGNER,
  PENDING_CONSOLIDATIONS_BEACON_API_ENDPOINT,
  PENDING_PARTIAL_WITHDRAWALS_BEACON_API_ENDPOINT,
  SPEC_BEACON_API_ENDPOINT,
  VALIDATOR_STATUS_ACTIVE_ONGOING,
  VALIDATORS_BEACON_API_ENDPOINT,
  WITHDRAWAL_CREDENTIALS_0x00,
  WITHDRAWAL_CREDENTIALS_0x01,
  WITHDRAWAL_CREDENTIALS_0x02
} from '../../constants/application';
import {
  BEACON_API_ERROR,
  BEACON_NETWORK_MISMATCH_ERROR,
  CONSOLIDATION_SOURCE_EQUALS_TARGET_ERROR,
  EXIT_VALIDATOR_0x00_CREDENTIALS_ERROR,
  PENDING_CONSOLIDATIONS_QUEUE_FULL_ERROR,
  PENDING_PARTIAL_WITHDRAWALS_QUEUE_FULL_ERROR,
  SANITY_CHECK_FAILED_HEADER,
  SOURCE_VALIDATOR_0x00_CREDENTIALS_ERROR,
  SWITCH_SOURCE_VALIDATOR_0x00_CREDENTIALS_ERROR,
  SWITCH_SOURCE_VALIDATOR_ALREADY_0x02_WARNING,
  UNEXPECTED_BEACON_API_ERROR,
  VALIDATOR_BALANCE_TOO_LOW_ERROR,
  VALIDATOR_HAS_PENDING_WITHDRAWAL_ERROR,
  VALIDATOR_NOT_ACTIVE_ERROR,
  VALIDATOR_NOT_COMPOUNDING_ERROR,
  VALIDATOR_NOT_FOUND_ERROR,
  VALIDATOR_NOT_OLD_ENOUGH_ERROR,
  VALIDATOR_SUBJECT,
  WITHDRAWAL_ADDRESS_MISMATCH_ERROR,
  WITHDRAWAL_ADDRESS_TARGET_MISMATCH_HINT,
  WITHDRAWAL_AMOUNT_CAPPED_WARNING,
  WRONG_WITHDRAWAL_CREDENTIALS_0X01_ERROR
} from '../../constants/logging';
import type {
  BeaconValidator,
  PendingPartialWithdrawal,
  ValidatorCheckRequest
} from '../../model/ethereum';
import { networkConfig } from '../../network-config';
import {
  filterSwitchableValidators,
  validateConsolidationRequests,
  validateSwitchRequests,
  validateWithdrawalRequests
} from './pre-request-validation';

const OWNER_ADDRESS = '0xaabbccddeeff00112233445566778899aabbccdd';
const OWNER_ADDRESS_MIXED_CASE = '0xAabbCCddEEff00112233445566778899aabBccDd';
const OTHER_ADDRESS = '0x1111111111111111111111111111111111111111';
const BEACON_URL = 'http://localhost:5052';
const NETWORK = 'kurtosis_devnet';

const PUBKEY_A = `0x${'a'.repeat(96)}`;
const PUBKEY_B = `0x${'b'.repeat(96)}`;
const PUBKEY_C = `0x${'c'.repeat(96)}`;
const TARGET_PUBKEY = `0x${'d'.repeat(96)}`;

const NOW_SECONDS = 1_800_000_000;
const SECONDS_PER_SLOT = 12;
const SLOTS_PER_EPOCH = 32;
const CURRENT_EPOCH = 1000;
const SHARD_COMMITTEE_PERIOD = 256;
const MIN_ACTIVATION_BALANCE = 32_000_000_000n;
const PENDING_PARTIAL_WITHDRAWALS_LIMIT = 10;
const PENDING_CONSOLIDATIONS_LIMIT = 5;
const GENESIS_TIME = NOW_SECONDS - CURRENT_EPOCH * SLOTS_PER_EPOCH * SECONDS_PER_SLOT - 1;

interface ValidatorFixture {
  pubkey: string;
  index?: string;
  balance?: bigint;
  status?: string;
  credentialsPrefix?: string;
  withdrawalAddress?: string;
  effectiveBalance?: bigint;
  activationEpoch?: number;
}

interface BeaconStateFixture {
  validators: BeaconValidator[];
  pendingWithdrawals?: PendingPartialWithdrawal[];
  pendingConsolidationCount?: number;
  chainId?: string;
  failingEndpoint?: string;
}

/**
 * Build a full withdrawal credentials hex string (32 bytes) for a given prefix and address
 *
 * @param prefix - The credentials type prefix (e.g. '0x00', '0x01', '0x02')
 * @param address - The embedded Ethereum address
 * @returns 32-byte withdrawal credentials hex string
 */
function buildCredentials(prefix: string, address: string): string {
  return `0x${prefix.slice(2)}${'00'.repeat(11)}${address.slice(2).toLowerCase()}`;
}

/**
 * Build a beacon API validator entry; defaults describe an eligible, owned 0x02 validator
 *
 * @param fixture - Validator overrides
 * @returns Beacon validator entry
 */
function buildValidator(fixture: ValidatorFixture): BeaconValidator {
  const {
    pubkey,
    index = '1',
    balance = MIN_ACTIVATION_BALANCE + 2_000_000_000n,
    status = VALIDATOR_STATUS_ACTIVE_ONGOING,
    credentialsPrefix = WITHDRAWAL_CREDENTIALS_0x02,
    withdrawalAddress = OWNER_ADDRESS,
    effectiveBalance = MIN_ACTIVATION_BALANCE,
    activationEpoch = 0
  } = fixture;
  return {
    index,
    balance: balance.toString(),
    status,
    validator: {
      pubkey,
      withdrawal_credentials: buildCredentials(credentialsPrefix, withdrawalAddress),
      effective_balance: effectiveBalance.toString(),
      activation_epoch: activationEpoch.toString(),
      exit_epoch: '18446744073709551615'
    }
  };
}

/**
 * Build a minimal undici response
 *
 * @param body - JSON body
 * @param ok - Whether the response is successful
 * @returns Response-like object
 */
function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? 'OK' : 'Internal Server Error',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve('error body')
  };
}

/**
 * Install a URL-routing fetch mock serving the given beacon state
 *
 * @param state - Beacon state served by the mock
 */
function serveBeaconState(state: BeaconStateFixture): void {
  const spec = {
    SECONDS_PER_SLOT: SECONDS_PER_SLOT.toString(),
    SLOTS_PER_EPOCH: SLOTS_PER_EPOCH.toString(),
    SHARD_COMMITTEE_PERIOD: SHARD_COMMITTEE_PERIOD.toString(),
    MIN_ACTIVATION_BALANCE: MIN_ACTIVATION_BALANCE.toString(),
    PENDING_PARTIAL_WITHDRAWALS_LIMIT: PENDING_PARTIAL_WITHDRAWALS_LIMIT.toString(),
    PENDING_CONSOLIDATIONS_LIMIT: PENDING_CONSOLIDATIONS_LIMIT.toString()
  };
  mockFetch.mockImplementation((url: string, init?: { body?: string }) => {
    const path = url.replace(BEACON_URL, '');
    if (path === state.failingEndpoint) {
      return Promise.resolve(jsonResponse({}, false));
    }
    switch (path) {
      case VALIDATORS_BEACON_API_ENDPOINT: {
        const ids = (JSON.parse(init!.body!) as { ids: string[] }).ids;
        return Promise.resolve(
          jsonResponse({ data: state.validators.filter((v) => ids.includes(v.validator.pubkey)) })
        );
      }
      case PENDING_PARTIAL_WITHDRAWALS_BEACON_API_ENDPOINT:
        return Promise.resolve(jsonResponse({ data: state.pendingWithdrawals ?? [] }));
      case PENDING_CONSOLIDATIONS_BEACON_API_ENDPOINT:
        return Promise.resolve(
          jsonResponse({ data: Array.from({ length: state.pendingConsolidationCount ?? 0 }) })
        );
      case DEPOSIT_CONTRACT_BEACON_API_ENDPOINT:
        return Promise.resolve(
          jsonResponse({
            data: { chain_id: state.chainId ?? networkConfig[NETWORK]!.chainId.toString() }
          })
        );
      case GENESIS_BEACON_API_ENDPOINT:
        return Promise.resolve(jsonResponse({ data: { genesis_time: GENESIS_TIME.toString() } }));
      case SPEC_BEACON_API_ENDPOINT:
        return Promise.resolve(jsonResponse({ data: spec }));
      default:
        return Promise.reject(new Error(`unexpected url ${url}`));
    }
  });
}

/**
 * Build a check request for the given validators
 *
 * @param validatorPubkeys - The validator pubkeys
 * @param overrides - Request overrides
 * @returns Validator check request
 */
function buildRequest(
  validatorPubkeys: string[],
  overrides: Partial<ValidatorCheckRequest> = {}
): ValidatorCheckRequest {
  return {
    beaconApiUrl: BEACON_URL,
    network: NETWORK,
    ownerAddress: OWNER_ADDRESS,
    validatorPubkeys,
    ...overrides
  };
}

const mockFetch = mock((_url: string, _init?: { body?: string }) =>
  Promise.resolve(jsonResponse({}))
);

// eslint-disable-next-line no-control-regex -- Matches ANSI escape sequences emitted by chalk
const ANSI_ESCAPE_PATTERN = /\u001B\[[0-9;]*m/g;

/**
 * Collect all calls of a console spy, join them with newlines and strip ANSI color codes
 *
 * @param spy - The spyOn handle over console.error or console.log
 * @returns Concatenated output with ANSI codes removed
 */
function collectOutput(spy: ReturnType<typeof spyOn>): string {
  return spy.mock.calls.flat().join('\n').replace(ANSI_ESCAPE_PATTERN, '');
}

describe('pre-request-validation', () => {
  let stderrSpy: ReturnType<typeof spyOn>;
  let stdoutSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    setSystemTime(new Date(NOW_SECONDS * 1000));
    mockFetch.mockReset();
    spyOn(undici, 'fetch').mockImplementation(mockFetch as never);
    exitSpy = spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    stderrSpy = spyOn(console, 'error').mockImplementation(() => {});
    stdoutSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    setSystemTime();
    mock.restore();
  });

  describe('validateConsolidationRequests', () => {
    const source = (fixture: Partial<ValidatorFixture> = {}) =>
      buildValidator({
        pubkey: PUBKEY_A,
        index: '1',
        credentialsPrefix: WITHDRAWAL_CREDENTIALS_0x01,
        ...fixture
      });
    const target = (fixture: Partial<ValidatorFixture> = {}) =>
      buildValidator({ pubkey: TARGET_PUBKEY, index: '9', ...fixture });

    it('passes for an eligible owned source and compounding target', async () => {
      serveBeaconState({ validators: [source(), target()] });

      await validateConsolidationRequests(buildRequest([PUBKEY_A]), TARGET_PUBKEY);

      expect(exitSpy).not.toHaveBeenCalled();
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('reports a source validator which is not found on the beacon chain', async () => {
      serveBeaconState({ validators: [target()] });

      await validateConsolidationRequests(buildRequest([PUBKEY_A]), TARGET_PUBKEY);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(collectOutput(stderrSpy)).toContain(
        VALIDATOR_NOT_FOUND_ERROR(VALIDATOR_SUBJECT(PUBKEY_A, 'source'))
      );
    });

    it('reports a source validator with 0x00 credentials without an ownership mismatch', async () => {
      serveBeaconState({
        validators: [
          source({
            credentialsPrefix: WITHDRAWAL_CREDENTIALS_0x00,
            withdrawalAddress: OTHER_ADDRESS
          }),
          target()
        ]
      });

      await validateConsolidationRequests(buildRequest([PUBKEY_A]), TARGET_PUBKEY);

      expect(exitSpy).toHaveBeenCalledWith(1);
      const stderr = collectOutput(stderrSpy);
      expect(stderr).toContain(SOURCE_VALIDATOR_0x00_CREDENTIALS_ERROR(PUBKEY_A));
      expect(stderr).toContain(SANITY_CHECK_FAILED_HEADER(1));
    });

    it('reports a target validator without compounding credentials', async () => {
      serveBeaconState({
        validators: [source(), target({ credentialsPrefix: WITHDRAWAL_CREDENTIALS_0x01 })]
      });

      await validateConsolidationRequests(buildRequest([PUBKEY_A]), TARGET_PUBKEY);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(collectOutput(stderrSpy)).toContain(
        `${VALIDATOR_NOT_COMPOUNDING_ERROR(VALIDATOR_SUBJECT(TARGET_PUBKEY, 'target'), WITHDRAWAL_CREDENTIALS_0x01)} ${WRONG_WITHDRAWAL_CREDENTIALS_0X01_ERROR}`
      );
    });

    it('labels a target validator which is not found with the target role', async () => {
      serveBeaconState({ validators: [source()] });

      await validateConsolidationRequests(buildRequest([PUBKEY_A]), TARGET_PUBKEY);

      expect(collectOutput(stderrSpy)).toContain(
        `Target validator ${TARGET_PUBKEY} was not found on the beacon chain.`
      );
    });

    it('labels a target validator which is not active_ongoing with the target role', async () => {
      serveBeaconState({ validators: [source(), target({ status: 'active_exiting' })] });

      await validateConsolidationRequests(buildRequest([PUBKEY_A]), TARGET_PUBKEY);

      expect(collectOutput(stderrSpy)).toContain(
        `Target validator ${TARGET_PUBKEY} has status active_exiting`
      );
    });

    it('labels source-only checks with the source role', async () => {
      serveBeaconState({ validators: [source({ status: 'active_exiting' }), target()] });

      await validateConsolidationRequests(buildRequest([PUBKEY_A]), TARGET_PUBKEY);

      expect(collectOutput(stderrSpy)).toContain(`Source validator ${PUBKEY_A} has status`);
    });

    it('reports a source ownership mismatch with the source role', async () => {
      serveBeaconState({ validators: [source({ withdrawalAddress: OTHER_ADDRESS }), target()] });

      await validateConsolidationRequests(buildRequest([PUBKEY_A]), TARGET_PUBKEY);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(collectOutput(stderrSpy)).toContain(
        WITHDRAWAL_ADDRESS_MISMATCH_ERROR(
          PUBKEY_A,
          OTHER_ADDRESS,
          OWNER_ADDRESS,
          OWNER_LABEL_SIGNER,
          'source'
        )
      );
    });

    it('reports a target ownership mismatch with the skip hint', async () => {
      serveBeaconState({ validators: [source(), target({ withdrawalAddress: OTHER_ADDRESS })] });

      await validateConsolidationRequests(buildRequest([PUBKEY_A]), TARGET_PUBKEY);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(collectOutput(stderrSpy)).toContain(
        `${WITHDRAWAL_ADDRESS_MISMATCH_ERROR(TARGET_PUBKEY, OTHER_ADDRESS, OWNER_ADDRESS, OWNER_LABEL_SIGNER, 'target')}. ${WITHDRAWAL_ADDRESS_TARGET_MISMATCH_HINT}`
      );
    });

    it('skips the target ownership check when requested', async () => {
      serveBeaconState({ validators: [source(), target({ withdrawalAddress: OTHER_ADDRESS })] });

      await validateConsolidationRequests(buildRequest([PUBKEY_A]), TARGET_PUBKEY, true);

      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('uses the Safe owner label in ownership mismatches', async () => {
      serveBeaconState({ validators: [source({ withdrawalAddress: OTHER_ADDRESS }), target()] });

      await validateConsolidationRequests(
        buildRequest([PUBKEY_A], { ownerLabel: OWNER_LABEL_SAFE }),
        TARGET_PUBKEY,
        true
      );

      expect(collectOutput(stderrSpy)).toContain(
        WITHDRAWAL_ADDRESS_MISMATCH_ERROR(
          PUBKEY_A,
          OTHER_ADDRESS,
          OWNER_ADDRESS,
          OWNER_LABEL_SAFE,
          'source'
        )
      );
    });

    it('matches the owner address case-insensitively', async () => {
      serveBeaconState({ validators: [source(), target()] });

      await validateConsolidationRequests(
        buildRequest([PUBKEY_A], { ownerAddress: OWNER_ADDRESS_MIXED_CASE }),
        TARGET_PUBKEY
      );

      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('reports a source validator which is not active_ongoing', async () => {
      serveBeaconState({ validators: [source({ status: 'active_exiting' }), target()] });

      await validateConsolidationRequests(buildRequest([PUBKEY_A]), TARGET_PUBKEY);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(collectOutput(stderrSpy)).toContain(
        VALIDATOR_NOT_ACTIVE_ERROR(VALIDATOR_SUBJECT(PUBKEY_A, 'source'), 'active_exiting')
      );
    });

    it('reports a source validator which has not been active for the shard committee period', async () => {
      const activationEpoch = CURRENT_EPOCH - SHARD_COMMITTEE_PERIOD + 1;
      serveBeaconState({ validators: [source({ activationEpoch }), target()] });

      await validateConsolidationRequests(buildRequest([PUBKEY_A]), TARGET_PUBKEY);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(collectOutput(stderrSpy)).toContain(
        VALIDATOR_NOT_OLD_ENOUGH_ERROR(
          VALIDATOR_SUBJECT(PUBKEY_A, 'source'),
          CURRENT_EPOCH + 1,
          CURRENT_EPOCH
        )
      );
    });

    it('passes for a source validator activated exactly the shard committee period ago', async () => {
      const activationEpoch = CURRENT_EPOCH - SHARD_COMMITTEE_PERIOD;
      serveBeaconState({ validators: [source({ activationEpoch }), target()] });

      await validateConsolidationRequests(buildRequest([PUBKEY_A]), TARGET_PUBKEY);

      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('reports a source validator with a pending partial withdrawal', async () => {
      serveBeaconState({
        validators: [source(), target()],
        pendingWithdrawals: [{ validator_index: '1', amount: '1' }]
      });

      await validateConsolidationRequests(buildRequest([PUBKEY_A]), TARGET_PUBKEY);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(collectOutput(stderrSpy)).toContain(
        VALIDATOR_HAS_PENDING_WITHDRAWAL_ERROR(VALIDATOR_SUBJECT(PUBKEY_A, 'source'))
      );
    });

    it('reports a source validator which equals the target', async () => {
      serveBeaconState({ validators: [target()] });

      await validateConsolidationRequests(
        buildRequest([TARGET_PUBKEY]),
        TARGET_PUBKEY.toUpperCase()
      );

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(collectOutput(stderrSpy)).toContain(
        CONSOLIDATION_SOURCE_EQUALS_TARGET_ERROR(TARGET_PUBKEY)
      );
    });

    it('reports a full pending consolidations queue', async () => {
      serveBeaconState({
        validators: [source(), source({ pubkey: PUBKEY_B, index: '2' }), target()],
        pendingConsolidationCount: PENDING_CONSOLIDATIONS_LIMIT - 1
      });

      await validateConsolidationRequests(buildRequest([PUBKEY_A, PUBKEY_B]), TARGET_PUBKEY);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(collectOutput(stderrSpy)).toContain(
        PENDING_CONSOLIDATIONS_QUEUE_FULL_ERROR(
          PENDING_CONSOLIDATIONS_LIMIT - 1,
          PENDING_CONSOLIDATIONS_LIMIT
        )
      );
    });

    it('passes when the pending consolidations queue has exactly enough capacity', async () => {
      serveBeaconState({
        validators: [source(), target()],
        pendingConsolidationCount: PENDING_CONSOLIDATIONS_LIMIT - 1
      });

      await validateConsolidationRequests(buildRequest([PUBKEY_A]), TARGET_PUBKEY);

      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('reports every failure together with the failure count and exits once', async () => {
      serveBeaconState({
        validators: [
          source({ status: 'pending_queued' }),
          source({ pubkey: PUBKEY_B, index: '2', withdrawalAddress: OTHER_ADDRESS }),
          target({ credentialsPrefix: WITHDRAWAL_CREDENTIALS_0x01 })
        ]
      });

      await validateConsolidationRequests(
        buildRequest([PUBKEY_A, PUBKEY_B, PUBKEY_C]),
        TARGET_PUBKEY
      );

      expect(exitSpy).toHaveBeenCalledTimes(1);
      const stderr = collectOutput(stderrSpy);
      expect(stderr).toContain(SANITY_CHECK_FAILED_HEADER(4));
      expect(stderr).toContain(
        VALIDATOR_NOT_ACTIVE_ERROR(VALIDATOR_SUBJECT(PUBKEY_A, 'source'), 'pending_queued')
      );
      expect(stderr).toContain(
        WITHDRAWAL_ADDRESS_MISMATCH_ERROR(
          PUBKEY_B,
          OTHER_ADDRESS,
          OWNER_ADDRESS,
          OWNER_LABEL_SIGNER,
          'source'
        )
      );
      expect(stderr).toContain(VALIDATOR_NOT_FOUND_ERROR(VALIDATOR_SUBJECT(PUBKEY_C, 'source')));
      expect(stderr).toContain(
        VALIDATOR_NOT_COMPOUNDING_ERROR(
          VALIDATOR_SUBJECT(TARGET_PUBKEY, 'target'),
          WITHDRAWAL_CREDENTIALS_0x01
        )
      );
    });
  });

  describe('validateSwitchRequests', () => {
    it('passes for an owned active validator', async () => {
      serveBeaconState({
        validators: [
          buildValidator({ pubkey: PUBKEY_A, credentialsPrefix: WITHDRAWAL_CREDENTIALS_0x01 })
        ]
      });

      await validateSwitchRequests(buildRequest([PUBKEY_A]));

      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('reports an ownership mismatch without a role', async () => {
      serveBeaconState({
        validators: [
          buildValidator({
            pubkey: PUBKEY_A,
            credentialsPrefix: WITHDRAWAL_CREDENTIALS_0x01,
            withdrawalAddress: OTHER_ADDRESS
          })
        ]
      });

      await validateSwitchRequests(buildRequest([PUBKEY_A]));

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(collectOutput(stderrSpy)).toContain(
        WITHDRAWAL_ADDRESS_MISMATCH_ERROR(
          PUBKEY_A,
          OTHER_ADDRESS,
          OWNER_ADDRESS,
          OWNER_LABEL_SIGNER
        )
      );
    });

    it('reports a beacon node connected to another chain', async () => {
      serveBeaconState({ validators: [buildValidator({ pubkey: PUBKEY_A })], chainId: '1' });

      await validateSwitchRequests(buildRequest([PUBKEY_A]));

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(collectOutput(stderrSpy)).toContain(
        BEACON_NETWORK_MISMATCH_ERROR(NETWORK, networkConfig[NETWORK]!.chainId, '1')
      );
    });
  });

  describe('validateWithdrawalRequests', () => {
    describe('exit (amount 0)', () => {
      it('passes for an eligible 0x01 validator', async () => {
        serveBeaconState({
          validators: [
            buildValidator({ pubkey: PUBKEY_A, credentialsPrefix: WITHDRAWAL_CREDENTIALS_0x01 })
          ]
        });

        await validateWithdrawalRequests(buildRequest([PUBKEY_A]), 0);

        expect(exitSpy).not.toHaveBeenCalled();
      });

      it('reports a validator with 0x00 credentials without an ownership mismatch', async () => {
        serveBeaconState({
          validators: [
            buildValidator({
              pubkey: PUBKEY_A,
              credentialsPrefix: WITHDRAWAL_CREDENTIALS_0x00,
              withdrawalAddress: OTHER_ADDRESS
            })
          ]
        });

        await validateWithdrawalRequests(buildRequest([PUBKEY_A]), 0);

        expect(exitSpy).toHaveBeenCalledWith(1);
        const stderr = collectOutput(stderrSpy);
        expect(stderr).toContain(EXIT_VALIDATOR_0x00_CREDENTIALS_ERROR(PUBKEY_A));
        expect(stderr).toContain(SANITY_CHECK_FAILED_HEADER(1));
      });

      it('reports a validator with a pending partial withdrawal', async () => {
        serveBeaconState({
          validators: [buildValidator({ pubkey: PUBKEY_A, index: '7' })],
          pendingWithdrawals: [{ validator_index: '7', amount: '1000' }]
        });

        await validateWithdrawalRequests(buildRequest([PUBKEY_A]), 0);

        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(collectOutput(stderrSpy)).toContain(
          VALIDATOR_HAS_PENDING_WITHDRAWAL_ERROR(VALIDATOR_SUBJECT(PUBKEY_A))
        );
      });

      it('ignores a full partial withdrawals queue', async () => {
        serveBeaconState({
          validators: [buildValidator({ pubkey: PUBKEY_A, index: '1' })],
          pendingWithdrawals: Array.from({ length: PENDING_PARTIAL_WITHDRAWALS_LIMIT }, () => ({
            validator_index: '99',
            amount: '1'
          }))
        });

        await validateWithdrawalRequests(buildRequest([PUBKEY_A]), 0);

        expect(exitSpy).not.toHaveBeenCalled();
      });
    });

    describe('partial withdrawal (amount > 0)', () => {
      it('passes for a compounding validator with excess balance', async () => {
        serveBeaconState({ validators: [buildValidator({ pubkey: PUBKEY_A })] });

        await validateWithdrawalRequests(buildRequest([PUBKEY_A]), 1);

        expect(exitSpy).not.toHaveBeenCalled();
        expect(stdoutSpy).not.toHaveBeenCalled();
      });

      it('reports a validator without compounding credentials', async () => {
        serveBeaconState({
          validators: [
            buildValidator({ pubkey: PUBKEY_A, credentialsPrefix: WITHDRAWAL_CREDENTIALS_0x01 })
          ]
        });

        await validateWithdrawalRequests(buildRequest([PUBKEY_A]), 1);

        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(collectOutput(stderrSpy)).toContain(
          VALIDATOR_NOT_COMPOUNDING_ERROR(VALIDATOR_SUBJECT(PUBKEY_A), WITHDRAWAL_CREDENTIALS_0x01)
        );
      });

      it('reports an effective balance below the minimum activation balance', async () => {
        serveBeaconState({
          validators: [
            buildValidator({ pubkey: PUBKEY_A, effectiveBalance: MIN_ACTIVATION_BALANCE - 1n })
          ]
        });

        await validateWithdrawalRequests(buildRequest([PUBKEY_A]), 1);

        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(collectOutput(stderrSpy)).toContain(VALIDATOR_BALANCE_TOO_LOW_ERROR(PUBKEY_A));
      });

      it('reports a balance fully covered by pending partial withdrawals', async () => {
        serveBeaconState({
          validators: [
            buildValidator({ pubkey: PUBKEY_A, index: '3', balance: MIN_ACTIVATION_BALANCE + 10n })
          ],
          pendingWithdrawals: [
            { validator_index: '3', amount: '4' },
            { validator_index: '3', amount: '6' }
          ]
        });

        await validateWithdrawalRequests(buildRequest([PUBKEY_A]), 1);

        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(collectOutput(stderrSpy)).toContain(VALIDATOR_BALANCE_TOO_LOW_ERROR(PUBKEY_A));
      });

      it('warns without exiting when the amount exceeds the withdrawable balance', async () => {
        serveBeaconState({
          validators: [
            buildValidator({ pubkey: PUBKEY_A, balance: MIN_ACTIVATION_BALANCE + 500_000_000n })
          ]
        });

        await validateWithdrawalRequests(buildRequest([PUBKEY_A]), 1);

        expect(exitSpy).not.toHaveBeenCalled();
        expect(collectOutput(stdoutSpy)).toContain(
          WITHDRAWAL_AMOUNT_CAPPED_WARNING(PUBKEY_A, '0.5')
        );
      });

      it('reports a partial withdrawals queue without capacity for all requests', async () => {
        serveBeaconState({
          validators: [buildValidator({ pubkey: PUBKEY_A })],
          pendingWithdrawals: Array.from({ length: PENDING_PARTIAL_WITHDRAWALS_LIMIT }, () => ({
            validator_index: '99',
            amount: '1'
          }))
        });

        await validateWithdrawalRequests(buildRequest([PUBKEY_A]), 1);

        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(collectOutput(stderrSpy)).toContain(
          PENDING_PARTIAL_WITHDRAWALS_QUEUE_FULL_ERROR(
            PENDING_PARTIAL_WITHDRAWALS_LIMIT,
            PENDING_PARTIAL_WITHDRAWALS_LIMIT
          )
        );
      });
    });
  });

  describe('beacon API error handling', () => {
    it('exits with UNEXPECTED_BEACON_API_ERROR when an endpoint returns a non-ok response', async () => {
      serveBeaconState({
        validators: [buildValidator({ pubkey: PUBKEY_A })],
        failingEndpoint: PENDING_CONSOLIDATIONS_BEACON_API_ENDPOINT
      });

      await validateSwitchRequests(buildRequest([PUBKEY_A]));

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(collectOutput(stderrSpy)).toContain(UNEXPECTED_BEACON_API_ERROR(BEACON_URL));
    });

    it('exits with BEACON_API_ERROR when fetch throws a TypeError', async () => {
      mockFetch.mockRejectedValue(new TypeError('fetch failed', { cause: 'ECONNREFUSED' }));

      await validateSwitchRequests(buildRequest([PUBKEY_A]));

      expect(exitSpy).toHaveBeenCalledWith(1);
      const stderr = collectOutput(stderrSpy);
      expect(stderr).toContain(BEACON_API_ERROR);
      expect(stderr).toContain('ECONNREFUSED');
    });
  });

  describe('filterSwitchableValidators', () => {
    it('returns 0x01 validators and warns about skipped 0x02 validators', async () => {
      serveBeaconState({
        validators: [
          buildValidator({ pubkey: PUBKEY_A, credentialsPrefix: WITHDRAWAL_CREDENTIALS_0x01 }),
          buildValidator({ pubkey: PUBKEY_B, credentialsPrefix: WITHDRAWAL_CREDENTIALS_0x02 })
        ]
      });

      const switchable = await filterSwitchableValidators(BEACON_URL, [PUBKEY_A, PUBKEY_B]);

      expect(switchable).toEqual([PUBKEY_A]);
      expect(exitSpy).not.toHaveBeenCalled();
      expect(collectOutput(stdoutSpy)).toContain(
        SWITCH_SOURCE_VALIDATOR_ALREADY_0x02_WARNING(PUBKEY_B)
      );
    });

    it('exits once reporting 0x00 and not found validators', async () => {
      serveBeaconState({
        validators: [
          buildValidator({ pubkey: PUBKEY_A, credentialsPrefix: WITHDRAWAL_CREDENTIALS_0x00 })
        ]
      });

      await filterSwitchableValidators(BEACON_URL, [PUBKEY_A, PUBKEY_B]);

      expect(exitSpy).toHaveBeenCalledTimes(1);
      const stderr = collectOutput(stderrSpy);
      expect(stderr).toContain(SANITY_CHECK_FAILED_HEADER(2));
      expect(stderr).toContain(SWITCH_SOURCE_VALIDATOR_0x00_CREDENTIALS_ERROR(PUBKEY_A));
      expect(stderr).toContain(VALIDATOR_NOT_FOUND_ERROR(VALIDATOR_SUBJECT(PUBKEY_B)));
    });

    it('exits with UNEXPECTED_BEACON_API_ERROR when the validators endpoint fails', async () => {
      serveBeaconState({ validators: [], failingEndpoint: VALIDATORS_BEACON_API_ENDPOINT });
      exitSpy.mockImplementation((() => {
        throw new Error('process.exit');
      }) as never);

      await expect(filterSwitchableValidators(BEACON_URL, [PUBKEY_A])).rejects.toThrow(
        'process.exit'
      );

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(collectOutput(stderrSpy)).toContain(UNEXPECTED_BEACON_API_ERROR(BEACON_URL));
    });
  });
});
