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
const OWNER_2_KEY = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';

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

const ADDITIONAL_OWNER_KEYS = [OWNER_2_KEY];

/**
 * Check if an error is a "already exists" duplicate from the mock TX service.
 */
function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && /already exists/i.test(error.message);
}

/**
 * Change the Safe threshold by creating, signing, and executing a threshold change transaction.
 *
 * Dynamically collects the required number of confirmations based on the current on-chain
 * threshold. Supports up to 3 owners (owner 0 as proposer/executor, owners 1-2 as co-signers).
 *
 * @param newThreshold - The new threshold value to set
 */
async function changeThreshold(newThreshold: number): Promise<void> {
  const contractNetworks = buildContractNetworks();
  const txServiceUrl = `http://localhost:${MOCK_TX_SERVICE_PORT}/api`;

  console.error(`Changing Safe threshold to ${newThreshold}...`);
  console.error(`Safe: ${SAFE_ADDRESS}`);

  const protocolKit0 = await Safe.init({
    provider: RPC_URL,
    signer: OWNER_0_KEY,
    safeAddress: SAFE_ADDRESS,
    contractNetworks
  });

  const currentThreshold = await protocolKit0.getThreshold();
  console.error(`Current threshold: ${currentThreshold}`);

  if (currentThreshold === newThreshold) {
    console.error(`Threshold is already ${newThreshold}, nothing to do.`);
    return;
  }

  const thresholdTx = await protocolKit0.createChangeThresholdTx(newThreshold);
  const safeTxHash = await protocolKit0.getTransactionHash(thresholdTx);
  const sig0 = await protocolKit0.signHash(safeTxHash);

  console.error(`Proposing threshold change (safeTxHash: ${safeTxHash})...`);

  const apiKit = new SafeApiKit({ chainId: CHAIN_ID, txServiceUrl, apiKey: MOCK_API_KEY });

  try {
    await apiKit.proposeTransaction({
      safeAddress: SAFE_ADDRESS,
      safeTransactionData: thresholdTx.data,
      safeTxHash,
      senderAddress: await protocolKit0.getAddress(),
      senderSignature: sig0.data
    });
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      console.error('Transaction already proposed (re-run), continuing...');
    } else {
      throw error;
    }
  }

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

  const additionalConfirmationsNeeded = currentThreshold - 2;
  for (let i = 0; i < additionalConfirmationsNeeded; i++) {
    const ownerKey = ADDITIONAL_OWNER_KEYS[i];
    if (!ownerKey) {
      throw new Error(
        `Threshold is ${currentThreshold} but only ${i + 2} owner keys are configured`
      );
    }

    const kit = await Safe.init({
      provider: RPC_URL,
      signer: ownerKey,
      safeAddress: SAFE_ADDRESS,
      contractNetworks
    });

    const sig = await kit.signHash(safeTxHash);
    console.error(`Adding confirmation from owner ${i + 2}...`);
    try {
      await apiKit.confirmTransaction(safeTxHash, sig.data);
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        console.error(`Owner ${i + 2} already confirmed (re-run), continuing...`);
      } else {
        throw error;
      }
    }
  }

  const pendingTx = await apiKit.getTransaction(safeTxHash);
  const executableKit = await protocolKit0.connect({
    provider: RPC_URL,
    signer: OWNER_0_KEY,
    safeAddress: SAFE_ADDRESS,
    contractNetworks
  });

  console.error('Executing threshold change on-chain...');
  const execResult = await executableKit.executeTransaction(pendingTx);

  if (execResult.transactionResponse) {
    const receipt = await (
      execResult.transactionResponse as { wait: () => Promise<unknown> }
    ).wait();
    console.error(
      `Threshold changed to ${newThreshold} (block: ${(receipt as { blockNumber: number }).blockNumber})`
    );
  }

  const verifiedThreshold = await executableKit.getThreshold();
  console.error(`Verified on-chain threshold: ${verifiedThreshold}`);
}

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    threshold: { type: 'string', short: 't' }
  }
});

if (!values.threshold) {
  console.error('Usage: change-threshold.ts --threshold <number>');
  process.exit(2);
}

changeThreshold(Number(values.threshold)).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
