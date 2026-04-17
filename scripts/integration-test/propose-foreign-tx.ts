import SafeApiKit from '@safe-global/api-kit';
import Safe from '@safe-global/protocol-kit';
import type { ContractNetworksConfig } from '@safe-global/protocol-kit';
import { parseArgs } from 'util';

import {
  CHAIN_ID,
  MOCK_API_KEY,
  MOCK_TX_SERVICE_PORT,
  RPC_URL,
  SAFE_CONTRACT_ADDRESSES
} from '../safe/constants';

const SAFE_ADDRESS = process.env.SAFE_ADDRESS ?? '';

const OWNER_0_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const OWNER_1_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

const RANDOM_RECIPIENT = '0x1111111111111111111111111111111111111111';

/**
 * Build contract network configuration for the Kurtosis devnet chain ID
 */
function buildContractNetworks(): ContractNetworksConfig {
  return {
    [CHAIN_ID.toString()]: {
      safeSingletonAddress: SAFE_CONTRACT_ADDRESSES.safeSingletonL2Address,
      safeProxyFactoryAddress: SAFE_CONTRACT_ADDRESSES.safeProxyFactoryAddress,
      multiSendAddress: SAFE_CONTRACT_ADDRESSES.multiSendAddress,
      multiSendCallOnlyAddress: SAFE_CONTRACT_ADDRESSES.multiSendCallOnlyAddress,
      fallbackHandlerAddress: SAFE_CONTRACT_ADDRESSES.fallbackHandlerAddress,
      signMessageLibAddress: SAFE_CONTRACT_ADDRESSES.signMessageLibAddress,
      createCallAddress: SAFE_CONTRACT_ADDRESSES.createCallAddress,
      simulateTxAccessorAddress: SAFE_CONTRACT_ADDRESSES.simulateTxAccessorAddress
    }
  };
}

/**
 * Check if an error is a "already exists" duplicate from the mock TX service.
 */
function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && /already exists/i.test(error.message);
}

/**
 * Propose a non-eth-valctl transaction to the mock TX Service.
 *
 * Creates a 0-value ETH transfer to a random address with origin 'foreign-app'.
 * Optionally signs with Owner 1 to reach threshold for filtering tests.
 * Prints the assigned nonce and safeTxHash to stdout for test verification.
 *
 * @param signWithOwner1 - Whether to add a second confirmation from Owner 1
 */
async function proposeForeignTx(signWithOwner1: boolean): Promise<void> {
  const contractNetworks = buildContractNetworks();
  const txServiceUrl = `http://localhost:${MOCK_TX_SERVICE_PORT}/api`;

  console.error('Proposing foreign (non-eth-valctl) transaction...');
  console.error(`Safe: ${SAFE_ADDRESS}`);

  const protocolKit0 = await Safe.init({
    provider: RPC_URL,
    signer: OWNER_0_KEY,
    safeAddress: SAFE_ADDRESS,
    contractNetworks
  });

  const apiKit = new SafeApiKit({ chainId: CHAIN_ID, txServiceUrl, apiKey: MOCK_API_KEY });

  const nextNonce = await apiKit.getNextNonce(SAFE_ADDRESS);
  console.error(`Next nonce: ${nextNonce}`);

  const safeTransaction = await protocolKit0.createTransaction({
    transactions: [
      {
        to: RANDOM_RECIPIENT,
        data: '0x',
        value: '0'
      }
    ],
    options: { nonce: Number(nextNonce) }
  });

  const safeTxHash = await protocolKit0.getTransactionHash(safeTransaction);
  const sig0 = await protocolKit0.signHash(safeTxHash);

  console.error(`Proposing foreign TX (safeTxHash: ${safeTxHash})...`);

  try {
    await apiKit.proposeTransaction({
      safeAddress: SAFE_ADDRESS,
      safeTransactionData: safeTransaction.data,
      safeTxHash,
      senderAddress: await protocolKit0.getAddress(),
      senderSignature: sig0.data,
      origin: 'foreign-app'
    });
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      console.error('Transaction already proposed (re-run), continuing...');
    } else {
      throw error;
    }
  }

  if (signWithOwner1) {
    const protocolKit1 = await Safe.init({
      provider: RPC_URL,
      signer: OWNER_1_KEY,
      safeAddress: SAFE_ADDRESS,
      contractNetworks
    });

    const sig1 = await protocolKit1.signHash(safeTxHash);
    console.error('Adding confirmation from owner 1...');

    try {
      await apiKit.confirmTransaction(safeTxHash, sig1.data);
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        console.error('Owner 1 already confirmed (re-run), continuing...');
      } else {
        throw error;
      }
    }
  }

  console.log(`nonce=${nextNonce}`);
  console.log(`safeTxHash=${safeTxHash}`);
  console.error('Foreign transaction proposed successfully.');
}

/**
 * Execute a previously proposed transaction by its safeTxHash.
 *
 * Fetches the transaction from the mock TX Service and executes it on-chain.
 *
 * @param safeTxHash - The safeTxHash of the transaction to execute
 */
async function executeForeignTx(safeTxHash: string): Promise<void> {
  const contractNetworks = buildContractNetworks();
  const txServiceUrl = `http://localhost:${MOCK_TX_SERVICE_PORT}/api`;

  console.error(`Executing foreign TX (safeTxHash: ${safeTxHash})...`);

  const apiKit = new SafeApiKit({ chainId: CHAIN_ID, txServiceUrl, apiKey: MOCK_API_KEY });
  const pendingTx = await apiKit.getTransaction(safeTxHash);

  const protocolKit = await Safe.init({
    provider: RPC_URL,
    signer: OWNER_0_KEY,
    safeAddress: SAFE_ADDRESS,
    contractNetworks
  });

  const execResult = await protocolKit.executeTransaction(pendingTx);

  if (execResult.transactionResponse) {
    const receipt = await (
      execResult.transactionResponse as { wait: () => Promise<unknown> }
    ).wait();
    console.error(
      `Foreign TX executed (block: ${(receipt as { blockNumber: number }).blockNumber})`
    );
  }
}

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    'sign-with-owner1': { type: 'boolean', default: false },
    'execute-hash': { type: 'string' }
  }
});

if (values['execute-hash']) {
  executeForeignTx(values['execute-hash']).catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
} else {
  proposeForeignTx(values['sign-with-owner1'] ?? false).catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
