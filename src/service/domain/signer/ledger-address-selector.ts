import Eth from '@ledgerhq/hw-app-eth';
import type { JsonRpcProvider } from 'ethers';

import { LEDGER_ADDRESSES_PER_PAGE } from '../../../constants/application';
import type { AddressPageState, LedgerDerivedAddress } from '../../../model/ledger';
import { classifyLedgerError } from './ledger-error-handler';
import { connectWithTimeout } from './ledger-transport';

/**
 * Interface for Ethereum address derivation
 */
export interface IEthAddressProvider {
  getAddress(path: string): Promise<{ address: string }>;
}

/**
 * Interface for balance fetching
 */
export interface IBalanceProvider {
  getBalance(address: string): Promise<bigint>;
}

/**
 * Interface for transport lifecycle
 */
export interface ITransportProvider {
  close(): Promise<void>;
}

/**
 * Handles Ledger HD wallet address derivation and selection
 */
export class LedgerAddressSelector {
  private readonly addressCache: Map<number, LedgerDerivedAddress> = new Map();

  constructor(
    private readonly transport: ITransportProvider,
    private readonly eth: IEthAddressProvider,
    private readonly balanceProvider: IBalanceProvider
  ) {}

  /**
   * Create a new address selector with connected transport
   *
   * @param provider - JSON-RPC provider for balance fetching
   * @returns Connected address selector instance
   * @throws Error if Ledger device is not connected or Ethereum app is not open
   */
  static async create(provider: JsonRpcProvider): Promise<LedgerAddressSelector> {
    const transport = await connectWithTimeout();

    const eth = new Eth(transport);
    const selector = new LedgerAddressSelector(transport, eth, provider);

    const firstPath = selector.buildDerivationPath(0);
    const { address } = await eth.getAddress(firstPath);
    const balance = await selector.fetchBalance(address);
    selector.addressCache.set(0, { derivationPath: firstPath, address, index: 0, balance });

    return selector;
  }

  /**
   * Get a page of addresses with balances
   *
   * @param page - Page number (0-indexed)
   * @returns Page state with addresses and navigation info
   */
  async getAddressPage(page: number): Promise<AddressPageState> {
    const startIndex = page * LEDGER_ADDRESSES_PER_PAGE;
    const addresses: LedgerDerivedAddress[] = [];

    for (let i = 0; i < LEDGER_ADDRESSES_PER_PAGE; i++) {
      const index = startIndex + i;
      const address = await this.getOrDeriveAddress(index);
      addresses.push(address);
    }

    return {
      currentPage: page,
      addresses,
      hasMorePages: true
    };
  }

  /**
   * Close the transport connection
   */
  async dispose(): Promise<void> {
    await this.transport.close();
  }

  /**
   * Get address from cache or derive from device
   *
   * @param index - Address index in HD path
   * @returns Derived address with balance
   */
  private async getOrDeriveAddress(index: number): Promise<LedgerDerivedAddress> {
    const cached = this.addressCache.get(index);
    if (cached) {
      const balance = await this.fetchBalance(cached.address);
      return { ...cached, balance };
    }

    const derivationPath = this.buildDerivationPath(index);

    try {
      const { address } = await this.eth.getAddress(derivationPath);
      const balance = await this.fetchBalance(address);

      const derived: LedgerDerivedAddress = {
        derivationPath,
        address,
        index,
        balance
      };

      this.addressCache.set(index, derived);
      return derived;
    } catch (error) {
      const errorInfo = classifyLedgerError(error);
      throw new Error(`Failed to derive address at index ${index}: ${errorInfo.message}`, {
        cause: error
      });
    }
  }

  /**
   * Fetch ETH balance for an address
   *
   * @param address - Ethereum address
   * @returns Balance in wei, 0n on failure
   */
  private async fetchBalance(address: string): Promise<bigint> {
    try {
      return await this.balanceProvider.getBalance(address);
    } catch {
      return 0n;
    }
  }

  /**
   * Build BIP-44 derivation path for Ethereum
   *
   * @param index - Address index
   * @returns Derivation path string
   */
  private buildDerivationPath(index: number): string {
    return `44'/60'/0'/0/${index}`;
  }
}
