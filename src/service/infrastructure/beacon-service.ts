import chalk from 'chalk';
import { fetch } from 'undici';

import * as application from '../../constants/application';
import {
  BEACON_SPEC_FETCH_ERROR,
  BEACON_SPEC_INVALID_VALUE_ERROR,
  SLOT_BOUNDARY_WAIT_INFO
} from '../../constants/logging';
import type {
  BeaconSpec,
  BeaconSpecResponse,
  GenesisResponse,
  SlotPosition
} from '../../model/ethereum';
import { BlockchainStateError } from '../../model/ethereum';
import type { ISlotTimingService } from '../../ports/slot-timing.interface';

/**
 * Fetch the chain spec values required for slot timing and pre-request sanity checks
 *
 * The slot duration is read from `SLOT_DURATION_MS` and falls back to `SECONDS_PER_SLOT`
 * for beacon nodes which do not expose the newer key yet.
 *
 * @param beaconApiUrl - Base URL of the beacon API
 * @returns Parsed chain spec values
 * @throws BlockchainStateError if the spec cannot be fetched or a required key is missing
 */
export async function fetchBeaconSpec(beaconApiUrl: string): Promise<BeaconSpec> {
  const response = await fetch(`${beaconApiUrl}${application.SPEC_BEACON_API_ENDPOINT}`);
  if (!response.ok) {
    throw new BlockchainStateError(
      BEACON_SPEC_FETCH_ERROR(`${response.status} ${response.statusText}`)
    );
  }
  const spec = ((await response.json()) as BeaconSpecResponse).data;
  const slotDurationMs = spec[application.SPEC_KEY_SLOT_DURATION_MS]
    ? parseSpecNumber(spec, application.SPEC_KEY_SLOT_DURATION_MS)
    : parseSpecNumber(spec, application.SPEC_KEY_SECONDS_PER_SLOT) * application.MS_PER_SECOND;

  return {
    slotDurationMs,
    slotsPerEpoch: parseSpecNumber(spec, application.SPEC_KEY_SLOTS_PER_EPOCH),
    shardCommitteePeriod: parseSpecNumber(spec, application.SPEC_KEY_SHARD_COMMITTEE_PERIOD),
    minActivationBalance: BigInt(
      parseSpecNumber(spec, application.SPEC_KEY_MIN_ACTIVATION_BALANCE)
    ),
    pendingPartialWithdrawalsLimit: parseSpecNumber(
      spec,
      application.SPEC_KEY_PENDING_PARTIAL_WITHDRAWALS_LIMIT
    ),
    pendingConsolidationsLimit: parseSpecNumber(
      spec,
      application.SPEC_KEY_PENDING_CONSOLIDATIONS_LIMIT
    )
  };
}

/**
 * Parse a numeric chain spec value
 *
 * @param spec - Raw chain spec key/value map
 * @param key - Spec key to parse
 * @returns Parsed number
 * @throws BlockchainStateError if the key is missing or not numeric
 */
function parseSpecNumber(spec: Record<string, string>, key: string): number {
  const parsed = Number(spec[key]);
  if (spec[key] === undefined || !Number.isFinite(parsed)) {
    throw new BlockchainStateError(BEACON_SPEC_INVALID_VALUE_ERROR(key, spec[key]));
  }
  return parsed;
}

/**
 * Service for beacon chain timing operations.
 *
 * Fetches genesis time and chain spec and calculates the current slot position to enable
 * slot-aware transaction broadcasting for hardware wallets.
 */
export class BeaconService implements ISlotTimingService {
  private constructor(
    private readonly genesisTime: number,
    readonly spec: BeaconSpec
  ) {}

  /**
   * Create a beacon service by fetching genesis time and chain spec from the beacon API
   *
   * @param beaconApiUrl - Base URL of the beacon API
   * @returns Initialized beacon service instance
   * @throws BlockchainStateError if genesis or spec fetch fails or returns invalid data
   */
  static async create(beaconApiUrl: string): Promise<BeaconService> {
    try {
      const [genesisTime, spec] = await Promise.all([
        fetchGenesisTime(beaconApiUrl),
        fetchBeaconSpec(beaconApiUrl)
      ]);
      return new BeaconService(genesisTime, spec);
    } catch (error) {
      if (error instanceof BlockchainStateError) {
        throw error;
      }
      throw new BlockchainStateError('Unable to initialize beacon service', error);
    }
  }

  /**
   * No-op disposal — beacon service holds no persistent resources
   */
  async dispose(): Promise<void> {}

  /**
   * Calculate the current slot position within the beacon chain
   *
   * @returns Current slot, position within slot, and time until next slot
   */
  calculateSlotPosition(): SlotPosition {
    const msSinceGenesis = Date.now() - this.genesisTime * application.MS_PER_SECOND;
    const msInSlot = msSinceGenesis % this.spec.slotDurationMs;
    return {
      currentSlot: Math.floor(msSinceGenesis / this.spec.slotDurationMs),
      secondInSlot: Math.floor(msInSlot / application.MS_PER_SECOND),
      secondsUntilNextSlot: Math.ceil(
        (this.spec.slotDurationMs - msInSlot) / application.MS_PER_SECOND
      )
    };
  }

  /**
   * Calculate the current epoch based on wall clock time
   *
   * @returns Current epoch
   */
  calculateCurrentEpoch(): number {
    return Math.floor(this.calculateSlotPosition().currentSlot / this.spec.slotsPerEpoch);
  }

  /**
   * Wait for optimal broadcast window if near slot boundary
   *
   * If within the last portion of a slot (at or past SLOT_BOUNDARY_THRESHOLD_RATIO of the slot),
   * waits until the next slot starts plus a small buffer. This prevents
   * transactions from being broadcast right before a fee change.
   */
  async waitForOptimalBroadcastWindow(): Promise<void> {
    const position = this.calculateSlotPosition();
    const slotBoundaryThreshold =
      (this.spec.slotDurationMs / application.MS_PER_SECOND) *
      application.SLOT_BOUNDARY_THRESHOLD_RATIO;
    if (position.secondInSlot >= slotBoundaryThreshold) {
      const waitMs =
        position.secondsUntilNextSlot * application.MS_PER_SECOND +
        application.SLOT_BOUNDARY_BUFFER_MS;
      console.log(chalk.yellow(SLOT_BOUNDARY_WAIT_INFO(position.secondsUntilNextSlot)));
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

/**
 * Fetch the genesis time from the beacon API
 *
 * @param beaconApiUrl - Base URL of the beacon API
 * @returns Genesis time in seconds since unix epoch
 * @throws BlockchainStateError if genesis fetch fails or returns invalid data
 */
async function fetchGenesisTime(beaconApiUrl: string): Promise<number> {
  const response = await fetch(`${beaconApiUrl}${application.GENESIS_BEACON_API_ENDPOINT}`);

  if (!response.ok) {
    throw new BlockchainStateError(
      `Failed to fetch beacon genesis: ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as GenesisResponse;
  const genesisTimeStr = data.data.genesis_time;
  const parsed = parseInt(genesisTimeStr, 10);

  if (isNaN(parsed)) {
    throw new BlockchainStateError(
      `Invalid genesis time received from beacon API: ${genesisTimeStr}`
    );
  }

  return parsed;
}
