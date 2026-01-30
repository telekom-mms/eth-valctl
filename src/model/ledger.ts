/**
 * Derived address from Ledger HD wallet
 */
export interface LedgerDerivedAddress {
  derivationPath: string;
  address: string;
  index: number;
  balance: bigint;
}

/**
 * Result of address selection from Ledger device
 */
export interface AddressSelectionResult {
  derivationPath: string;
  address: string;
  index: number;
}

/**
 * State for paginated address display
 */
export interface AddressPageState {
  currentPage: number;
  addresses: LedgerDerivedAddress[];
  hasMorePages: boolean;
}
