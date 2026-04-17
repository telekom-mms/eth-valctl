import chalk from 'chalk';
import { fetch } from 'undici';

import * as application from '../../constants/application';
import { SLOT_BOUNDARY_WAIT_INFO } from '../../constants/logging';
import type { GenesisResponse, SlotPosition } from '../../model/ethereum';
import { BlockchainStateError } from '../../model/ethereum';
import type { ISlotTimingService } from '../../ports/slot-timing.interface';

/**
 * Service for beacon chain timing operations.
 *
 * Fetches genesis time and calculates current slot position to enable
 * slot-aware transaction broadcasting for hardware wallets.
 */
export class BeaconService implements ISlotTimingService {
  private constructor(private readonly genesisTime: number) {}

  /**
   * Create a beacon service by fetching genesis time from the beacon API
   *
   * @param beaconApiUrl - Base URL of the beacon API
   * @returns Initialized beacon service instance
   * @throws BlockchainStateError if genesis fetch fails or returns invalid data
   */
  static async create(beaconApiUrl: string): Promise<BeaconService> {
    try {
      const url = `${beaconApiUrl}${application.GENESIS_BEACON_API_ENDPOINT}`;
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

      return new BeaconService(parsed);
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
    const now = Math.floor(Date.now() / application.MS_PER_SECOND);
    const secondsSinceGenesis = now - this.genesisTime;
    const currentSlot = Math.floor(secondsSinceGenesis / application.SECONDS_PER_SLOT);
    const secondInSlot = secondsSinceGenesis % application.SECONDS_PER_SLOT;
    return {
      currentSlot,
      secondInSlot,
      secondsUntilNextSlot: application.SECONDS_PER_SLOT - secondInSlot
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
    if (position.secondInSlot >= application.SLOT_BOUNDARY_THRESHOLD) {
      const waitMs = position.secondsUntilNextSlot * 1000 + application.SLOT_BOUNDARY_BUFFER_MS;
      console.log(chalk.yellow(SLOT_BOUNDARY_WAIT_INFO(position.secondsUntilNextSlot)));
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}
