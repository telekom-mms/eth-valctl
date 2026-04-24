import { createCustomCommon, Mainnet } from '@ethereumjs/common';
import type { FeeMarket1559Tx } from '@ethereumjs/tx';
import { createFeeMarket1559Tx } from '@ethereumjs/tx';
import type { PrefixedHexString } from '@ethereumjs/util';
import type Eth from '@ledgerhq/hw-app-eth';
import type Transport from '@ledgerhq/hw-transport';
import type { JsonRpcProvider } from 'ethers';
import { TypedDataEncoder } from 'ethers';

import {
  EIP_712_DOMAIN_TYPE,
  EIP_1193_DISCONNECTED,
  EIP_1193_INTERNAL_ERROR,
  EIP_1193_INVALID_PARAMS,
  EIP_1193_METHOD_ETH_ACCOUNTS,
  EIP_1193_METHOD_ETH_REQUEST_ACCOUNTS,
  EIP_1193_METHOD_ETH_SEND_TRANSACTION,
  EIP_1193_METHOD_ETH_SIGN,
  EIP_1193_METHOD_ETH_SIGN_TRANSACTION,
  EIP_1193_METHOD_ETH_SIGN_TYPED_DATA_V4,
  EIP_1193_METHOD_PERSONAL_SIGN,
  EIP_1193_USER_REJECTED,
  LEDGER_GAS_BUFFER_DENOMINATOR,
  LEDGER_GAS_BUFFER_NUMERATOR,
  PENDING_BLOCK_TAG,
  PREFIX_0x
} from '../../../constants/application';
import { EIP_1193_INVALID_PARAM_TYPE_ERROR } from '../../../constants/logging';
import { fetchMaxNetworkFees } from '../request/ethereum-state-service';
import { classifyLedgerError, isLedgerError } from './ledger-error-handler';

interface Eip1193RequestArgs {
  readonly method: string;
  readonly params?: readonly unknown[] | object;
}

interface Eip1193TransactionParams {
  readonly to?: string;
  readonly gas?: string;
  readonly maxFeePerGas?: string;
  readonly maxPriorityFeePerGas?: string;
  readonly value?: string;
  readonly data?: string;
  readonly nonce?: string;
}

interface Eip712TypedData {
  readonly types: Record<string, Array<{ name: string; type: string }>>;
  readonly primaryType: string;
  readonly domain: Record<string, unknown>;
  readonly message: Record<string, unknown>;
}

interface ResolvedTransactionParams {
  readonly chainId: number;
  readonly nonce: bigint;
  readonly maxFeePerGas: bigint;
  readonly maxPriorityFeePerGas: bigint;
  readonly gasLimit: bigint;
  readonly to: PrefixedHexString;
  readonly value: bigint;
  readonly data: PrefixedHexString;
}

const LEDGER_ERROR_TYPE_TO_EIP1193_CODE: Readonly<Record<string, number>> = {
  USER_REJECTED: EIP_1193_USER_REJECTED,
  DISCONNECTED: EIP_1193_DISCONNECTED,
  DISCONNECTED_DURING_OPERATION: EIP_1193_DISCONNECTED,
  CONNECTION_TIMEOUT: EIP_1193_DISCONNECTED,
  LOCKED_DEVICE: EIP_1193_DISCONNECTED,
  ETH_APP_NOT_OPEN: EIP_1193_DISCONNECTED
};

/**
 * EIP-1193 provider error with numeric error code
 *
 * Maps Ledger hardware wallet errors to standard EIP-1193 error codes
 * for compatibility with Protocol Kit and other EIP-1193 consumers.
 */
export class Eip1193ProviderError extends Error {
  readonly code: number;

  /**
   * @param code - EIP-1193 error code (4001, 4900, -32603, etc.)
   * @param message - Human-readable error description
   */
  constructor(code: number, message: string) {
    super(message);
    this.name = 'Eip1193ProviderError';
    this.code = code;
  }
}

/**
 * EIP-1193 compatible provider adapter bridging Ledger hardware wallet
 * to Safe's Protocol Kit
 *
 * Dispatches signing RPC methods (`eth_sign`, `personal_sign`,
 * `eth_signTypedData_v4`, `eth_signTransaction`, `eth_sendTransaction`)
 * to the Ledger device and delegates all other methods to the underlying
 * JSON-RPC provider.
 *
 * Must be fully initialized (transport open, address known) before
 * being passed to `Safe.init()`.
 *
 * @example
 * ```typescript
 * const transport = await connectWithTimeout();
 * const eth = new Eth(transport);
 * const { address } = await eth.getAddress(derivationPath);
 * const provider = new LedgerEip1193Provider(transport, eth, derivationPath, address, jsonRpcProvider);
 * const protocolKit = await Safe.init({ provider, signer: address, safeAddress });
 * ```
 */
export class LedgerEip1193Provider {
  readonly address: string;

  /**
   * @param transport - Connected Ledger USB transport for lifecycle management
   * @param eth - Initialized Ledger Ethereum app instance for signing operations
   * @param derivationPath - BIP-44 HD derivation path for the selected address
   * @param address - Pre-derived Ethereum address from the Ledger device
   * @param jsonRpcProvider - ethers.js JSON-RPC provider for non-signing RPC delegation
   */
  constructor(
    private readonly transport: Transport,
    private readonly eth: Eth,
    private readonly derivationPath: string,
    address: string,
    private readonly jsonRpcProvider: JsonRpcProvider
  ) {
    this.address = address;
  }

  /**
   * Handle an EIP-1193 JSON-RPC request
   *
   * @param args - RPC method name and parameters
   * @returns RPC method result
   * @throws Eip1193ProviderError with appropriate error code for Ledger failures
   */
  async request(args: Eip1193RequestArgs): Promise<unknown> {
    const params = Array.isArray(args.params) ? args.params : [];

    switch (args.method) {
      case EIP_1193_METHOD_ETH_ACCOUNTS:
      case EIP_1193_METHOD_ETH_REQUEST_ACCOUNTS:
        return [this.address];
      case EIP_1193_METHOD_ETH_SIGN:
        return this.signPersonalMessage(this.extractStringParam(params, 1, args.method));
      case EIP_1193_METHOD_PERSONAL_SIGN:
        return this.signPersonalMessage(this.extractStringParam(params, 0, args.method));
      case EIP_1193_METHOD_ETH_SIGN_TYPED_DATA_V4:
        return this.handleSignTypedDataV4(params, args.method);
      case EIP_1193_METHOD_ETH_SIGN_TRANSACTION:
        return this.buildSignAndSerializeTransaction(
          this.extractObjectParam<Eip1193TransactionParams>(params, 0, args.method)
        );
      case EIP_1193_METHOD_ETH_SEND_TRANSACTION:
        return this.handleSendTransaction(params, args.method);
      default:
        return this.jsonRpcProvider.send(args.method, [...params]);
    }
  }

  /**
   * Release USB transport resources
   *
   * Closes the Ledger HID transport connection. Must be called when the
   * adapter is no longer needed, consistent with the `ISigner.dispose()` pattern.
   */
  async dispose(): Promise<void> {
    await this.transport.close();
  }

  /**
   * @param params - RPC parameters array
   * @param index - Parameter index to extract
   * @param method - RPC method name for error messages
   * @returns Validated string parameter
   * @throws Eip1193ProviderError if parameter is not a string
   */
  private extractStringParam(params: readonly unknown[], index: number, method: string): string {
    const value = params[index];
    if (typeof value !== 'string') {
      throw new Eip1193ProviderError(
        EIP_1193_INVALID_PARAMS,
        EIP_1193_INVALID_PARAM_TYPE_ERROR(method, index, 'string', typeof value)
      );
    }
    return value;
  }

  /**
   * @param params - RPC parameters array
   * @param index - Parameter index to extract
   * @param method - RPC method name for error messages
   * @returns Validated object parameter narrowed to T
   * @throws Eip1193ProviderError if parameter is not a non-null object
   */
  private extractObjectParam<T extends object>(
    params: readonly unknown[],
    index: number,
    method: string
  ): T {
    const value = params[index];
    if (typeof value !== 'object' || value === null) {
      throw new Eip1193ProviderError(
        EIP_1193_INVALID_PARAMS,
        EIP_1193_INVALID_PARAM_TYPE_ERROR(method, index, 'object', typeof value)
      );
    }
    return value as T;
  }

  /**
   * Sign a personal message using the Ledger device
   *
   * @param data - Message to sign (hex-encoded, with or without 0x prefix)
   * @returns Concatenated signature as 0x-prefixed hex string
   * @throws Eip1193ProviderError if Ledger signing fails
   */
  private async signPersonalMessage(data: string): Promise<string> {
    const messageHex = data.startsWith(PREFIX_0x) ? data.slice(2) : data;

    try {
      const sig = await this.eth.signPersonalMessage(this.derivationPath, messageHex);
      return formatSignature(sig);
    } catch (error) {
      throw mapToEip1193Error(error);
    }
  }

  /**
   * Parse and sign EIP-712 typed data via Ledger
   *
   * @param params - RPC parameters containing address and typed data (string or object)
   * @param method - RPC method name for error messages
   * @returns Concatenated signature as 0x-prefixed hex string
   * @throws Eip1193ProviderError if Ledger signing fails or params are invalid
   */
  private async handleSignTypedDataV4(params: readonly unknown[], method: string): Promise<string> {
    const raw = params[1];
    const typedData: Eip712TypedData =
      typeof raw === 'string'
        ? JSON.parse(raw)
        : this.extractObjectParam<Eip712TypedData>(params, 1, method);

    const filteredTypes = Object.fromEntries(
      Object.entries(typedData.types).filter(([key]) => key !== EIP_712_DOMAIN_TYPE)
    ) as Record<string, Array<{ name: string; type: string }>>;

    const domainSeparator = TypedDataEncoder.hashDomain(typedData.domain);
    const structHash = TypedDataEncoder.from(filteredTypes).hash(typedData.message);

    try {
      const sig = await this.eth.signEIP712HashedMessage(
        this.derivationPath,
        domainSeparator.slice(2),
        structHash.slice(2)
      );
      return formatSignature(sig);
    } catch (error) {
      throw mapToEip1193Error(error);
    }
  }

  /**
   * Sign a transaction on the Ledger and broadcast it to the network
   *
   * @param params - RPC parameters containing the transaction object
   * @param method - RPC method name for error messages
   * @returns Transaction hash from the broadcast
   * @throws Eip1193ProviderError if signing or broadcasting fails
   */
  private async handleSendTransaction(params: readonly unknown[], method: string): Promise<string> {
    const txParams = this.extractObjectParam<Eip1193TransactionParams>(params, 0, method);
    const signedTxHex = await this.buildSignAndSerializeTransaction(txParams);
    const response = await this.jsonRpcProvider.broadcastTransaction(signedTxHex);
    return response.hash;
  }

  /**
   * Resolve missing fields, build an unsigned EIP-1559 transaction, sign on Ledger, and serialize
   *
   * @param txParams - Partial transaction parameters from the RPC caller
   * @returns Serialized signed transaction as 0x-prefixed hex
   * @throws Eip1193ProviderError if signing fails
   * @throws BlockchainStateError if network fees cannot be fetched
   */
  private async buildSignAndSerializeTransaction(
    txParams: Eip1193TransactionParams
  ): Promise<string> {
    const resolved = await this.resolveTransactionParams(txParams);
    const unsignedTx = buildUnsignedTransaction(resolved);
    return this.signAndSerializeTransaction(unsignedTx, resolved);
  }

  /**
   * Fill in missing transaction fields from the network
   *
   * Uses caller-provided values when available, otherwise queries the network
   * for chain ID, nonce, fees, and gas estimate.
   *
   * @param txParams - Partial transaction parameters from the RPC caller
   * @returns Fully resolved transaction parameters ready for signing
   * @throws BlockchainStateError if network fees cannot be fetched after retries
   */
  private async resolveTransactionParams(
    txParams: Eip1193TransactionParams
  ): Promise<ResolvedTransactionParams> {
    const network = await this.jsonRpcProvider.getNetwork();
    const chainId = Number(network.chainId);

    const nonce =
      txParams.nonce !== undefined
        ? Number(txParams.nonce)
        : await this.jsonRpcProvider.getTransactionCount(this.address, PENDING_BLOCK_TAG);

    const fees =
      txParams.maxFeePerGas && txParams.maxPriorityFeePerGas
        ? {
            maxFeePerGas: BigInt(txParams.maxFeePerGas),
            maxPriorityFeePerGas: BigInt(txParams.maxPriorityFeePerGas)
          }
        : await fetchMaxNetworkFees(this.jsonRpcProvider);

    const gasEstimate =
      txParams.gas !== undefined
        ? BigInt(txParams.gas)
        : await this.jsonRpcProvider.estimateGas({
            from: this.address,
            to: txParams.to,
            data: txParams.data,
            value: txParams.value ? BigInt(txParams.value) : 0n
          });
    const gasLimit = (gasEstimate * LEDGER_GAS_BUFFER_NUMERATOR) / LEDGER_GAS_BUFFER_DENOMINATOR;

    return {
      chainId,
      nonce: BigInt(nonce),
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      gasLimit,
      to: (txParams.to ?? PREFIX_0x) as PrefixedHexString,
      value: txParams.value ? BigInt(txParams.value) : 0n,
      data: (txParams.data ?? PREFIX_0x) as PrefixedHexString
    };
  }

  /**
   * Sign an unsigned transaction on the Ledger and return serialized signed hex
   *
   * @param unsignedTx - Unsigned EIP-1559 transaction to sign
   * @param resolved - Resolved transaction parameters for reconstructing the signed transaction
   * @returns Serialized signed transaction as 0x-prefixed hex
   * @throws Eip1193ProviderError if Ledger signing fails
   */
  private async signAndSerializeTransaction(
    unsignedTx: FeeMarket1559Tx,
    resolved: ResolvedTransactionParams
  ): Promise<string> {
    const unsignedTxHex = Buffer.from(unsignedTx.getMessageToSign()).toString('hex');
    const common = createCustomCommon({ chainId: resolved.chainId }, Mainnet);

    try {
      const sig = await this.eth.signTransaction(this.derivationPath, unsignedTxHex, null);

      const signedTxData = {
        nonce: resolved.nonce,
        maxFeePerGas: resolved.maxFeePerGas,
        maxPriorityFeePerGas: resolved.maxPriorityFeePerGas,
        gasLimit: resolved.gasLimit,
        to: resolved.to,
        value: resolved.value,
        data: resolved.data,
        v: BigInt(PREFIX_0x + sig.v),
        r: BigInt(PREFIX_0x + sig.r),
        s: BigInt(PREFIX_0x + sig.s)
      };

      const signedTx = createFeeMarket1559Tx(signedTxData, { common });
      return PREFIX_0x + Buffer.from(signedTx.serialize()).toString('hex');
    } catch (error) {
      throw mapToEip1193Error(error);
    }
  }
}

/**
 * Build an unsigned EIP-1559 transaction from resolved parameters
 *
 * @param resolved - Fully resolved transaction parameters with chain ID, nonce, fees, and gas
 * @returns Unsigned FeeMarket1559Tx ready for signing
 */
function buildUnsignedTransaction(resolved: ResolvedTransactionParams): FeeMarket1559Tx {
  const common = createCustomCommon({ chainId: resolved.chainId }, Mainnet);

  return createFeeMarket1559Tx(
    {
      nonce: resolved.nonce,
      maxFeePerGas: resolved.maxFeePerGas,
      maxPriorityFeePerGas: resolved.maxPriorityFeePerGas,
      gasLimit: resolved.gasLimit,
      to: resolved.to,
      value: resolved.value,
      data: resolved.data
    },
    { common }
  );
}

/**
 * Format Ledger signature components into a hex signature string
 *
 * @param sig - Ledger signature with numeric v, hex r and s (no 0x prefix)
 * @returns Concatenated signature as 0x-prefixed hex (65 bytes: r + s + v)
 */
function formatSignature(sig: { v: number; r: string; s: string }): string {
  return `0x${sig.r}${sig.s}${sig.v.toString(16).padStart(2, '0')}`;
}

/**
 * Map a Ledger error to an EIP-1193 provider error
 *
 * @param error - Original error from Ledger operations
 * @returns Eip1193ProviderError for known Ledger errors, original error otherwise
 */
function mapToEip1193Error(error: unknown): Error {
  if (!isLedgerError(error)) {
    return error instanceof Error ? error : new Error(String(error));
  }

  const errorInfo = classifyLedgerError(error);
  const code = LEDGER_ERROR_TYPE_TO_EIP1193_CODE[errorInfo.type] ?? EIP_1193_INTERNAL_ERROR;
  return new Eip1193ProviderError(code, errorInfo.message);
}
