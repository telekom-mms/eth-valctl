/**
 * Shared configuration for Safe devnet scripts
 *
 * All values can be overridden via environment variables.
 */

export const RPC_URL = process.env.KURTOSIS_RPC_URL ?? 'http://127.0.0.1:8545';

export const DEPLOYER_PRIVATE_KEY =
  process.env.DEPLOYER_PRIVATE_KEY ??
  '0xbcdf20249abf0ed6d944c0288fad489e33f66b3960d9e6229c1cd214ed3bbe31';

export const CHAIN_ID = 3151908n;

export const MOCK_TX_SERVICE_PORT = Number(process.env.MOCK_TX_SERVICE_PORT ?? '5555');

export const SAFE_FUNDING_AMOUNT_ETH = '100';

export const MOCK_API_KEY = process.env.MOCK_SAFE_API_KEY ?? 'test-api-key';
export const RATE_LIMIT_AUTHENTICATED = Number(process.env.RATE_LIMIT_AUTHENTICATED ?? '1000');
export const RATE_LIMIT_UNAUTHENTICATED = Number(process.env.RATE_LIMIT_UNAUTHENTICATED ?? '5');
export const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? '3000');

/**
 * Canonical Safe v1.4.1 contract addresses (deterministic CREATE2 via singleton factory)
 *
 * These are the expected addresses when deployed via `safe-smart-account` repo
 * using the official singleton factory. Actual addresses may differ if the
 * singleton factory deployment uses EIP-155 replay protection.
 */
export const SAFE_CONTRACT_ADDRESSES = {
  safeSingletonAddress: '',
  safeSingletonL2Address: '',
  safeProxyFactoryAddress: '',
  multiSendAddress: '',
  multiSendCallOnlyAddress: '',
  fallbackHandlerAddress: '',
  signMessageLibAddress: '',
  createCallAddress: '',
  simulateTxAccessorAddress: ''
} as const;
