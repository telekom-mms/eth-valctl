import type Transport from '@ledgerhq/hw-transport';
import TransportNodeHid from '@ledgerhq/hw-transport-node-hid';

import { LEDGER_CONNECTION_TIMEOUT_MS } from '../../../constants/application';

/**
 * Connect to a Ledger device with a timeout
 *
 * @returns Connected HID transport
 * @throws Error if connection times out or device is unavailable
 */
export async function connectWithTimeout(): Promise<Transport> {
  return Promise.race([
    TransportNodeHid.create(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), LEDGER_CONNECTION_TIMEOUT_MS)
    )
  ]);
}
