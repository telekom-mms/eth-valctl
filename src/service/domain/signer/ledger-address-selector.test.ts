import { describe, expect, it, mock } from 'bun:test';

import type {
  IBalanceProvider,
  IEthAddressProvider,
  ITransportProvider
} from './ledger-address-selector';
import { LedgerAddressSelector } from './ledger-address-selector';

const createMockTransport = (): ITransportProvider => ({
  close: mock(() => Promise.resolve())
});

const createMockEth = (
  addresses: Record<number, string> = {}
): IEthAddressProvider => ({
  getAddress: mock((path: string) => {
    const index = parseInt(path.split('/').pop() ?? '0');
    const address = addresses[index] ?? `0x${index.toString().padStart(40, '0')}`;
    return Promise.resolve({ address });
  })
});

const createMockBalanceProvider = (
  balances: Record<string, bigint> = {}
): IBalanceProvider => ({
  getBalance: mock((address: string) => {
    const balance = balances[address] ?? 0n;
    return Promise.resolve(balance);
  })
});

describe('LedgerAddressSelector', () => {
  describe('getAddressPage', () => {
    it('returns 5 addresses for page 0', async () => {
      const selector = LedgerAddressSelector.createWithDependencies(
        createMockTransport(),
        createMockEth(),
        createMockBalanceProvider()
      );

      const page = await selector.getAddressPage(0);

      expect(page.addresses).toHaveLength(5);
      expect(page.currentPage).toBe(0);
      expect(page.hasMorePages).toBe(true);
    });

    it('returns addresses with correct indices for page 0', async () => {
      const selector = LedgerAddressSelector.createWithDependencies(
        createMockTransport(),
        createMockEth(),
        createMockBalanceProvider()
      );

      const page = await selector.getAddressPage(0);

      expect(page.addresses[0]!.index).toBe(0);
      expect(page.addresses[1]!.index).toBe(1);
      expect(page.addresses[2]!.index).toBe(2);
      expect(page.addresses[3]!.index).toBe(3);
      expect(page.addresses[4]!.index).toBe(4);
    });

    it('returns addresses with correct indices for page 1', async () => {
      const selector = LedgerAddressSelector.createWithDependencies(
        createMockTransport(),
        createMockEth(),
        createMockBalanceProvider()
      );

      const page = await selector.getAddressPage(1);

      expect(page.addresses[0]!.index).toBe(5);
      expect(page.addresses[1]!.index).toBe(6);
      expect(page.addresses[2]!.index).toBe(7);
      expect(page.addresses[3]!.index).toBe(8);
      expect(page.addresses[4]!.index).toBe(9);
    });

    it('returns correct derivation paths', async () => {
      const selector = LedgerAddressSelector.createWithDependencies(
        createMockTransport(),
        createMockEth(),
        createMockBalanceProvider()
      );

      const page = await selector.getAddressPage(0);

      expect(page.addresses[0]!.derivationPath).toBe("44'/60'/0'/0/0");
      expect(page.addresses[1]!.derivationPath).toBe("44'/60'/0'/0/1");
      expect(page.addresses[4]!.derivationPath).toBe("44'/60'/0'/0/4");
    });

    it('includes addresses from eth provider', async () => {
      const mockAddresses: Record<number, string> = {
        0: '0xAddress0',
        1: '0xAddress1',
        2: '0xAddress2',
        3: '0xAddress3',
        4: '0xAddress4'
      };
      const selector = LedgerAddressSelector.createWithDependencies(
        createMockTransport(),
        createMockEth(mockAddresses),
        createMockBalanceProvider()
      );

      const page = await selector.getAddressPage(0);

      expect(page.addresses[0]!.address).toBe('0xAddress0');
      expect(page.addresses[1]!.address).toBe('0xAddress1');
      expect(page.addresses[4]!.address).toBe('0xAddress4');
    });

    it('includes balances from balance provider', async () => {
      const mockAddresses: Record<number, string> = {
        0: '0xAddr0',
        1: '0xAddr1'
      };
      const mockBalances: Record<string, bigint> = {
        '0xAddr0': 1000000000000000000n,
        '0xAddr1': 500000000000000000n
      };
      const selector = LedgerAddressSelector.createWithDependencies(
        createMockTransport(),
        createMockEth(mockAddresses),
        createMockBalanceProvider(mockBalances)
      );

      const page = await selector.getAddressPage(0);

      expect(page.addresses[0]!.balance).toBe(1000000000000000000n);
      expect(page.addresses[1]!.balance).toBe(500000000000000000n);
    });

    it('returns 0n balance when balance fetch fails', async () => {
      const failingBalanceProvider: IBalanceProvider = {
        getBalance: mock(() => Promise.reject(new Error('RPC error')))
      };
      const selector = LedgerAddressSelector.createWithDependencies(
        createMockTransport(),
        createMockEth(),
        failingBalanceProvider
      );

      const page = await selector.getAddressPage(0);

      expect(page.addresses[0]!.balance).toBe(0n);
      expect(page.addresses[4]!.balance).toBe(0n);
    });
  });

  describe('address caching', () => {
    it('caches addresses between page requests', async () => {
      const mockEth = createMockEth();
      const selector = LedgerAddressSelector.createWithDependencies(
        createMockTransport(),
        mockEth,
        createMockBalanceProvider()
      );

      await selector.getAddressPage(0);
      await selector.getAddressPage(0);

      expect(mockEth.getAddress).toHaveBeenCalledTimes(5);
    });

    it('derives new addresses when navigating to new page', async () => {
      const mockEth = createMockEth();
      const selector = LedgerAddressSelector.createWithDependencies(
        createMockTransport(),
        mockEth,
        createMockBalanceProvider()
      );

      await selector.getAddressPage(0);
      await selector.getAddressPage(1);

      expect(mockEth.getAddress).toHaveBeenCalledTimes(10);
    });

    it('uses cached addresses when navigating back', async () => {
      const mockEth = createMockEth();
      const selector = LedgerAddressSelector.createWithDependencies(
        createMockTransport(),
        mockEth,
        createMockBalanceProvider()
      );

      await selector.getAddressPage(0);
      await selector.getAddressPage(1);
      await selector.getAddressPage(0);

      expect(mockEth.getAddress).toHaveBeenCalledTimes(10);
    });

    it('refreshes balances even for cached addresses', async () => {
      const mockBalanceProvider = createMockBalanceProvider();
      const selector = LedgerAddressSelector.createWithDependencies(
        createMockTransport(),
        createMockEth(),
        mockBalanceProvider
      );

      await selector.getAddressPage(0);
      await selector.getAddressPage(0);

      expect(mockBalanceProvider.getBalance).toHaveBeenCalledTimes(10);
    });
  });

  describe('dispose', () => {
    it('closes transport on dispose', async () => {
      const mockTransport = createMockTransport();
      const selector = LedgerAddressSelector.createWithDependencies(
        mockTransport,
        createMockEth(),
        createMockBalanceProvider()
      );

      await selector.dispose();

      expect(mockTransport.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('derivation path format', () => {
    it('uses BIP-44 Ethereum path format', async () => {
      const mockEth = createMockEth();
      const selector = LedgerAddressSelector.createWithDependencies(
        createMockTransport(),
        mockEth,
        createMockBalanceProvider()
      );

      await selector.getAddressPage(2);

      expect(mockEth.getAddress).toHaveBeenCalledWith("44'/60'/0'/0/10");
      expect(mockEth.getAddress).toHaveBeenCalledWith("44'/60'/0'/0/11");
      expect(mockEth.getAddress).toHaveBeenCalledWith("44'/60'/0'/0/14");
    });
  });

  describe('error handling', () => {
    it('throws descriptive error when address derivation fails', async () => {
      const failingEth: IEthAddressProvider = {
        getAddress: mock(() => Promise.reject(new Error('Device error')))
      };
      const selector = LedgerAddressSelector.createWithDependencies(
        createMockTransport(),
        failingEth,
        createMockBalanceProvider()
      );

      await expect(selector.getAddressPage(0)).rejects.toThrow(
        'Failed to derive address at index 0'
      );
    });
  });
});
