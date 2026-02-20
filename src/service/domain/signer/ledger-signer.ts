import { createCustomCommon, Mainnet } from '@ethereumjs/common';
import { createFeeMarket1559Tx } from '@ethereumjs/tx';
import type { PrefixedHexString } from '@ethereumjs/util';
import Eth, { ledgerService } from '@ledgerhq/hw-app-eth';
import type Transport from '@ledgerhq/hw-transport';
import type { JsonRpcProvider, TransactionResponse } from 'ethers';

import type { ExecutionLayerRequestTransaction, SigningContext } from '../../../model/ethereum';
import type { ISigner, SignerCapabilities } from '../../../ports/signer.interface';
import type { TransactionProgressLogger } from '../request/transaction-progress-logger';
import { classifyLedgerError, isLedgerError } from './ledger-error-handler';
import { connectWithTimeout } from './ledger-transport';

const DEFAULT_DERIVATION_PATH = "44'/60'/0'/0/0";

/**
 * Ledger hardware wallet signer
 *
 * Requires user interaction for each transaction signing.
 * Does not support parallel signing due to single-threaded device communication.
 */
export class LedgerSigner implements ISigner {
  readonly capabilities: SignerCapabilities = {
    supportsParallelSigning: false
  };

  readonly address: string;
  private nonce: number;

  private constructor(
    private readonly transport: Transport,
    private readonly eth: Eth,
    private readonly provider: JsonRpcProvider,
    private readonly chainId: bigint,
    address: string,
    initialNonce: number,
    private readonly derivationPath: string,
    private readonly logger: TransactionProgressLogger
  ) {
    this.address = address;
    this.nonce = initialNonce;
  }

  /**
   * Create a Ledger signer by connecting to the device
   *
   * @param provider - JSON-RPC provider for nonce fetching and transaction broadcasting
   * @param logger - Logger for Ledger connection and signing progress
   * @param derivationPath - HD derivation path (default: "44'/60'/0'/0/0")
   * @returns Connected Ledger signer instance
   * @throws Error if Ledger device is not connected or Ethereum app is not open
   */
  static async create(
    provider: JsonRpcProvider,
    logger: TransactionProgressLogger,
    derivationPath: string = DEFAULT_DERIVATION_PATH
  ): Promise<LedgerSigner> {
    logger.logLedgerConnecting();

    let transport: Transport;
    try {
      transport = await connectWithTimeout();
    } catch (error) {
      const errorInfo = classifyLedgerError(error);
      logger.logLedgerError(errorInfo.message);
      throw error;
    }

    const eth = new Eth(transport);

    try {
      const { address } = await eth.getAddress(derivationPath);
      logger.logLedgerConnected(address);

      const network = await provider.getNetwork();
      const chainId = network.chainId;

      const nonce = await provider.getTransactionCount(address, 'pending');

      return new LedgerSigner(transport, eth, provider, chainId, address, nonce, derivationPath, logger);
    } catch (error) {
      await transport.close();
      const errorInfo = classifyLedgerError(error);
      logger.logLedgerError(errorInfo.message);
      throw error;
    }
  }

  async sendTransaction(
    tx: ExecutionLayerRequestTransaction,
    context?: SigningContext
  ): Promise<TransactionResponse> {
    return this.signAndSend(tx, this.nonce++, context);
  }

  async sendTransactionWithNonce(
    tx: ExecutionLayerRequestTransaction,
    nonce: number,
    context?: SigningContext
  ): Promise<TransactionResponse> {
    return this.signAndSend(tx, nonce, context);
  }

  async dispose(): Promise<void> {
    await this.transport.close();
    this.logger.logLedgerDisconnected();
  }

  /**
   * Sign and broadcast a transaction
   *
   * @param tx - Transaction parameters
   * @param nonce - Nonce to use
   * @param context - Optional signing context for user prompts
   * @returns Transaction response from the network
   */
  private async signAndSend(
    tx: ExecutionLayerRequestTransaction,
    nonce: number,
    context?: SigningContext
  ): Promise<TransactionResponse> {
    this.logger.logLedgerSigningPrompt(context);

    try {
      const { txData, common } = await this.buildUnsignedTransaction(tx, nonce);
      const serializedTx = await this.signWithLedger(txData, common);
      return await this.provider.broadcastTransaction(serializedTx);
    } catch (error) {
      if (isLedgerError(error)) {
        const errorInfo = classifyLedgerError(error, { duringSigning: true });
        this.logger.logLedgerError(errorInfo.message);
      }
      throw error;
    }
  }

  /**
   * Build unsigned EIP-1559 transaction with current network fees
   *
   * @param tx - Transaction parameters (to, data, value, gasLimit)
   * @param nonce - Transaction nonce
   * @returns Transaction data and chain configuration for signing
   */
  private async buildUnsignedTransaction(
    tx: ExecutionLayerRequestTransaction,
    nonce: number
  ): Promise<{
    txData: {
      nonce: bigint;
      maxFeePerGas: bigint;
      maxPriorityFeePerGas: bigint;
      gasLimit: bigint;
      to: PrefixedHexString;
      value: bigint;
      data: PrefixedHexString;
    };
    common: ReturnType<typeof createCustomCommon>;
  }> {
    const feeData = await this.provider.getFeeData();
    const maxFeePerGas = tx.maxFeePerGas ?? feeData.maxFeePerGas ?? 0n;
    const maxPriorityFeePerGas = tx.maxPriorityFeePerGas ?? feeData.maxPriorityFeePerGas ?? 0n;

    const common = createCustomCommon({ chainId: Number(this.chainId) }, Mainnet);

    const txData = {
      nonce: BigInt(nonce),
      maxFeePerGas,
      maxPriorityFeePerGas,
      gasLimit: tx.gasLimit,
      to: tx.to as PrefixedHexString,
      value: tx.value,
      data: tx.data as PrefixedHexString
    };

    return { txData, common };
  }

  /**
   * Sign transaction using Ledger device and serialize result
   *
   * Uses Ledger's transaction resolution service for ERC-20/NFT context.
   *
   * @param txData - Unsigned transaction data
   * @param common - EthereumJS common chain configuration
   * @returns Serialized signed transaction as hex string
   */
  private async signWithLedger(
    txData: {
      nonce: bigint;
      maxFeePerGas: bigint;
      maxPriorityFeePerGas: bigint;
      gasLimit: bigint;
      to: PrefixedHexString;
      value: bigint;
      data: PrefixedHexString;
    },
    common: ReturnType<typeof createCustomCommon>
  ): Promise<string> {
    const unsignedTx = createFeeMarket1559Tx(txData, { common });
    const unsignedTxBytes = unsignedTx.getMessageToSign();
    const unsignedTxHex = Buffer.from(unsignedTxBytes).toString('hex');

    const resolution = await ledgerService.resolveTransaction(
      unsignedTxHex,
      {},
      { externalPlugins: true, erc20: true, nft: true }
    );

    const signature = await this.eth.signTransaction(
      this.derivationPath,
      unsignedTxHex,
      resolution
    );

    const signedTxData = {
      ...txData,
      v: BigInt('0x' + signature.v),
      r: BigInt('0x' + signature.r),
      s: BigInt('0x' + signature.s)
    };

    const signedTx = createFeeMarket1559Tx(signedTxData, { common });
    return '0x' + Buffer.from(signedTx.serialize()).toString('hex');
  }
}
