import Safe from '@safe-global/protocol-kit';
import type { ContractNetworksConfig } from '@safe-global/protocol-kit';
import { ethers } from 'ethers';
import { parseArgs } from 'util';

import {
  CHAIN_ID,
  DEPLOYER_PRIVATE_KEY,
  RPC_URL,
  SAFE_CONTRACT_ADDRESSES,
  SAFE_FUNDING_AMOUNT_ETH
} from './constants';

const ETH_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

/**
 * Kurtosis devnet HD wallet mnemonic (standard test mnemonic).
 * Override via KURTOSIS_MNEMONIC env var if different.
 */
const MNEMONIC =
  process.env.KURTOSIS_MNEMONIC ?? 'test test test test test test test test test test test junk';

const DEFAULT_THRESHOLD = 2;
const DEFAULT_HD_OWNER_COUNT = 3;
const DEFAULT_FUND_OWNERS_ETH = '1';

interface CliOptions {
  threshold: number;
  hdOwnerCount: number;
  extraOwners: string[];
  saltNonce?: string;
  fundSafeEth: string;
  fundOwnersEth: string;
}

/**
 * Parse CLI arguments for Safe creation configuration
 */
function parseCliOptions(): CliOptions {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      threshold: { type: 'string', short: 't' },
      'hd-owners': { type: 'string' },
      'extra-owners': { type: 'string' },
      'salt-nonce': { type: 'string' },
      fund: { type: 'string' },
      'fund-owners': { type: 'string' }
    }
  });

  const extraOwners = values['extra-owners']
    ? values['extra-owners'].split(',').map((a) => a.trim())
    : [];

  for (const addr of extraOwners) {
    if (!ETH_ADDRESS_PATTERN.test(addr)) {
      console.error(`ERROR: Invalid Ethereum address in --extra-owners: ${addr}`);
      process.exit(2);
    }
  }

  const hdOwnerCount = values['hd-owners'] ? Number(values['hd-owners']) : DEFAULT_HD_OWNER_COUNT;
  const threshold = values.threshold ? Number(values.threshold) : DEFAULT_THRESHOLD;
  const totalOwners = hdOwnerCount + extraOwners.length;

  if (threshold > totalOwners) {
    console.error(`ERROR: Threshold (${threshold}) exceeds total owner count (${totalOwners})`);
    process.exit(2);
  }

  if (threshold < 1) {
    console.error('ERROR: Threshold must be at least 1');
    process.exit(2);
  }

  return {
    threshold,
    hdOwnerCount,
    extraOwners,
    saltNonce: values['salt-nonce'],
    fundSafeEth: values.fund ?? SAFE_FUNDING_AMOUNT_ETH,
    fundOwnersEth: values['fund-owners'] ?? DEFAULT_FUND_OWNERS_ETH
  };
}

/**
 * Contract network configuration for chain 3151908.
 *
 * Required because @safe-global/safe-deployments doesn't include the Kurtosis
 * devnet chain ID. These are canonical addresses from the singleton factory
 * deployment — update if your deployment produced different addresses.
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
 * Derive owner addresses and private keys from HD wallet mnemonic
 */
function deriveOwners(count: number): Array<{ address: string; privateKey: string }> {
  const mnemonic = ethers.Mnemonic.fromPhrase(MNEMONIC);
  const owners: Array<{ address: string; privateKey: string }> = [];

  for (let i = 0; i < count; i++) {
    const wallet = ethers.HDNodeWallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0/${i}`);
    owners.push({ address: wallet.address, privateKey: wallet.privateKey });
  }

  return owners;
}

/**
 * Fund a list of addresses from the deployer wallet
 *
 * @param deployer - Funded deployer wallet instance
 * @param addresses - Addresses to fund
 * @param amountEth - ETH amount to send to each address
 */
async function fundAddresses(
  deployer: ethers.Wallet,
  addresses: string[],
  amountEth: string
): Promise<void> {
  for (const address of addresses) {
    const tx = await deployer.sendTransaction({
      to: address,
      value: ethers.parseEther(amountEth)
    });
    await tx.wait();
    console.error(`  Funded ${address} with ${amountEth} ETH (tx: ${tx.hash})`);
  }
}

async function main(): Promise<void> {
  const options = parseCliOptions();
  const { threshold, hdOwnerCount, extraOwners, saltNonce, fundSafeEth, fundOwnersEth } = options;

  console.error('=== Safe Instance Creation for Kurtosis Devnet ===\n');
  console.error(`RPC URL: ${RPC_URL}`);
  console.error(`Chain ID: ${CHAIN_ID}`);

  const hdOwners = deriveOwners(hdOwnerCount);
  const allOwnerAddresses = [...hdOwners.map((o) => o.address), ...extraOwners];
  const totalOwners = allOwnerAddresses.length;

  console.error(`\nOwners (${totalOwners}):`);
  for (const [i, owner] of hdOwners.entries()) {
    console.error(`  [${i}] ${owner.address} (HD — key: ${owner.privateKey})`);
  }
  for (let i = 0; i < extraOwners.length; i++) {
    console.error(`  [${hdOwnerCount + i}] ${extraOwners[i]} (external)`);
  }
  console.error(`Threshold: ${threshold}`);
  if (saltNonce) {
    console.error(`Salt nonce: ${saltNonce}`);
  }

  const contractNetworks = buildContractNetworks();

  const predictedSafeConfig = {
    safeAccountConfig: {
      owners: allOwnerAddresses,
      threshold
    },
    ...(saltNonce && {
      safeDeploymentConfig: { saltNonce }
    })
  };

  console.error('\nInitializing Protocol Kit with predicted Safe...');
  const protocolKit = await Safe.init({
    provider: RPC_URL,
    signer: DEPLOYER_PRIVATE_KEY,
    predictedSafe: predictedSafeConfig,
    contractNetworks
  });

  const safeAddress = await protocolKit.getAddress();
  console.error(`Predicted Safe address: ${safeAddress}`);

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const existingCode = await provider.getCode(safeAddress);
  if (existingCode !== '0x') {
    console.error('\nSafe already deployed at this address. Skipping deployment.');
    printSummary(safeAddress, hdOwners, extraOwners, threshold, totalOwners, saltNonce);
    return;
  }

  console.error('\nCreating deployment transaction...');
  const deployTx = await protocolKit.createSafeDeploymentTransaction();

  const deployer = new ethers.Wallet(DEPLOYER_PRIVATE_KEY, provider);
  console.error(`Deployer: ${deployer.address}`);

  const balance = await provider.getBalance(deployer.address);
  console.error(`Deployer balance: ${ethers.formatEther(balance)} ETH`);

  console.error('\nBroadcasting deployment transaction...');
  const txResponse = await deployer.sendTransaction({
    to: deployTx.to,
    data: deployTx.data,
    value: BigInt(deployTx.value)
  });

  console.error(`Transaction hash: ${txResponse.hash}`);
  const receipt = await txResponse.wait();
  console.error(`Confirmed in block ${receipt!.blockNumber}`);

  const deployedCode = await provider.getCode(safeAddress);
  if (deployedCode === '0x') {
    console.error('\nERROR: Safe deployment failed — no code at predicted address');
    process.exit(1);
  }

  console.error(`\nSafe deployed successfully at ${safeAddress}`);

  console.error(`\nFunding Safe with ${fundSafeEth} ETH...`);
  const fundTx = await deployer.sendTransaction({
    to: safeAddress,
    value: ethers.parseEther(fundSafeEth)
  });
  await fundTx.wait();
  console.error(`Funded. TX: ${fundTx.hash}`);

  const safeBalance = await provider.getBalance(safeAddress);
  console.error(`Safe balance: ${ethers.formatEther(safeBalance)} ETH`);

  console.error(`\nFunding ${totalOwners} owner(s) with ${fundOwnersEth} ETH each...`);
  await fundAddresses(deployer, allOwnerAddresses, fundOwnersEth);

  printSummary(safeAddress, hdOwners, extraOwners, threshold, totalOwners, saltNonce);
}

/**
 * Print deployment summary with owner details
 */
function printSummary(
  safeAddress: string,
  hdOwners: Array<{ address: string; privateKey: string }>,
  extraOwners: string[],
  threshold: number,
  totalOwners: number,
  saltNonce?: string
): void {
  console.error('\n=== Safe Instance Summary ===');
  console.error(`Address:   ${safeAddress}`);
  console.error(`Threshold: ${threshold}/${totalOwners}`);
  console.error(`Chain ID:  ${CHAIN_ID}`);
  if (saltNonce) {
    console.error(`Salt nonce: ${saltNonce}`);
  }
  console.error('\nOwner details:');
  for (const [i, owner] of hdOwners.entries()) {
    console.error(`  Owner ${i}: ${owner.address} (key: ${owner.privateKey})`);
  }
  for (let i = 0; i < extraOwners.length; i++) {
    console.error(
      `  Owner ${hdOwners.length + i}: ${extraOwners[i]} (external — no key available)`
    );
  }
  console.error(`\nUsage example:`);
  console.error(
    `  bun run start -n kurtosis_devnet -r ${RPC_URL} -b <BEACON_API_URL> --safe ${safeAddress} consolidate -s <source> -t <target>`
  );
  console.error(
    `  bun run start -n kurtosis_devnet -r ${RPC_URL} -b <BEACON_API_URL> --safe ${safeAddress} safe sign`
  );
  console.error(
    `  bun run start -n kurtosis_devnet -r ${RPC_URL} -b <BEACON_API_URL> --safe ${safeAddress} safe execute`
  );
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
