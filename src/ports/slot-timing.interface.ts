import type { SlotPosition } from '../model/ethereum';

/**
 * Service interface for beacon chain slot timing operations
 *
 * Provides slot position calculations and timing-aware broadcasting
 * to prevent transactions from being affected by slot boundary fee changes.
 */
export interface ISlotTimingService {
  /**
   * Initialize the service by fetching required timing data
   *
   * @throws BlockchainStateError if initialization fails
   */
  initialize(): Promise<void>;

  /**
   * Calculate the current slot position within the beacon chain
   *
   * @returns Current slot, position within slot, and time until next slot
   * @throws Error if service not initialized
   */
  calculateSlotPosition(): SlotPosition;

  /**
   * Wait for optimal broadcast window if near slot boundary
   *
   * If within the last portion of a slot, waits until the next slot starts
   * plus a small buffer. This prevents transactions from being broadcast
   * right before a fee change.
   */
  waitForOptimalBroadcastWindow(): Promise<void>;
}
