import { createCustomCommon, Mainnet } from '@ethereumjs/common';
import { createFeeMarket1559Tx } from '@ethereumjs/tx';
import type { PrefixedHexString } from '@ethereumjs/util';
import Eth, { ledgerService } from '@ledgerhq/hw-app-eth';
import type Transport from '@ledgerhq/hw-transport';
import TransportNodeHid from '@ledgerhq/hw-transport-node-hid';
import chalk from 'chalk';
import type { JsonRpcProvider, TransactionResponse } from 'ethers';

import * as logging from '../../../constants/logging';
import type { ExecutionLayerRequestTransaction, SigningContext } from '../../../model/ethereum';
import type { ISigner, SignerCapabilities } from './signer.interface';

const DEFAULT_DERIVATION_PATH = "44'/60'/0'/0/0";

/**
 * Ledger hardware wallet signer
 *
 * Requires user interaction for each transaction signing.
 * Does not support parallel signing due to single-threaded device communication.
 */
export class LedgerSigner implements ISigner {
  readonly capabilities: SignerCapabilities = {
    supportsParallelSigning: false,
    requiresUserInteraction: true,
    signerType: 'ledger'
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
    private readonly derivationPath: string
  ) {
    this.address = address;
    this.nonce = initialNonce;
  }

  /**
   * Create a Ledger signer by connecting to the device
   *
   * @param provider - JSON-RPC provider for nonce fetching and transaction broadcasting
   * @param derivationPath - HD derivation path (default: "44'/60'/0'/0/0")
   * @returns Connected Ledger signer instance
   * @throws Error if Ledger device is not connected or Ethereum app is not open
   */
  static async create(
    provider: JsonRpcProvider,
    derivationPath: string = DEFAULT_DERIVATION_PATH
  ): Promise<LedgerSigner> {
    console.log(chalk.cyan(logging.LEDGER_CONNECTING_INFO));

    const transport = await TransportNodeHid.create();
    const eth = new Eth(transport);

    const { address } = await eth.getAddress(derivationPath);
    console.log(chalk.cyan(logging.LEDGER_CONNECTED_INFO(address)));

    const network = await provider.getNetwork();
    const chainId = network.chainId;

    const nonce = await provider.getTransactionCount(address, 'pending');

    return new LedgerSigner(transport, eth, provider, chainId, address, nonce, derivationPath);
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

  async getCurrentNonce(): Promise<number> {
    return this.nonce;
  }

  incrementNonce(): void {
    this.nonce++;
  }

  async dispose(): Promise<void> {
    await this.transport.close();
    console.log(chalk.cyan(logging.LEDGER_DISCONNECTED_INFO));
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
    if (context) {
      console.log(
        chalk.cyan(
          logging.LEDGER_SIGN_PROMPT(
            context.currentIndex,
            context.totalCount,
            context.validatorPubkey
          )
        )
      );
    } else {
      console.log(chalk.cyan(logging.LEDGER_SIGN_GENERIC_PROMPT));
    }

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
    const serializedTx = '0x' + Buffer.from(signedTx.serialize()).toString('hex');

    const response = await this.provider.broadcastTransaction(serializedTx);

    return response;
  }
}
