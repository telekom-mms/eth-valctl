import chalk from 'chalk';
import { fetch } from 'undici';

import {
  GENESIS_BEACON_API_ENDPOINT,
  MS_PER_SECOND,
  SECONDS_PER_SLOT,
  SLOT_BOUNDARY_BUFFER_MS,
  SLOT_BOUNDARY_THRESHOLD
} from '../../constants/application';
import * as logging from '../../constants/logging';
import type { GenesisResponse, SlotPosition } from '../../model/ethereum';
import { BlockchainStateError } from '../../model/ethereum';
import type { ISlotTimingService } from '../domain/slot-timing.interface';

/**
 * Service for beacon chain timing operations.
 *
 * Fetches genesis time and calculates current slot position to enable
 * slot-aware transaction broadcasting for hardware wallets.
 */
export class BeaconService implements ISlotTimingService {
  private genesisTime: number | null = null;

  /**
   * Creates a beacon service
   *
   * @param beaconApiUrl - Base URL of the beacon API
   */
  constructor(private readonly beaconApiUrl: string) {}

  /**
   * Initialize the service by fetching genesis time from beacon API
   *
   * @throws BlockchainStateError if genesis fetch fails or returns invalid data
   */
  async initialize(): Promise<void> {
    try {
      const url = `${this.beaconApiUrl}${GENESIS_BEACON_API_ENDPOINT}`;
      const response = await fetch(url);

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

      this.genesisTime = parsed;
    } catch (error) {
      if (error instanceof BlockchainStateError) {
        throw error;
      }
      throw new BlockchainStateError('Unable to initialize beacon service', error);
    }
  }

  /**
   * Calculate the current slot position within the beacon chain
   *
   * @returns Current slot, position within slot, and time until next slot
   * @throws Error if service not initialized
   */
  calculateSlotPosition(): SlotPosition {
    if (this.genesisTime === null) {
      throw new Error('BeaconService not initialized - call initialize() first');
    }
    const now = Math.floor(Date.now() / MS_PER_SECOND);
    const secondsSinceGenesis = now - this.genesisTime;
    const currentSlot = Math.floor(secondsSinceGenesis / SECONDS_PER_SLOT);
    const secondInSlot = secondsSinceGenesis % SECONDS_PER_SLOT;
    return {
      currentSlot,
      secondInSlot,
      secondsUntilNextSlot: SECONDS_PER_SLOT - secondInSlot
    };
  }

  /**
   * Wait for optimal broadcast window if near slot boundary
   *
   * If within the last portion of a slot (at or past SLOT_BOUNDARY_THRESHOLD seconds),
   * waits until the next slot starts plus a small buffer. This prevents
   * transactions from being broadcast right before a fee change.
   */
  async waitForOptimalBroadcastWindow(): Promise<void> {
    const position = this.calculateSlotPosition();
    if (position.secondInSlot >= SLOT_BOUNDARY_THRESHOLD) {
      const waitMs = position.secondsUntilNextSlot * 1000 + SLOT_BOUNDARY_BUFFER_MS;
      console.log(chalk.yellow(logging.SLOT_BOUNDARY_WAIT_INFO(position.secondsUntilNextSlot)));
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}
