import { PublicKey, Signature, verify } from '@chainsafe/blst';
import { concat, dataSlice, getBytes, Interface, sha256, toBeHex, zeroPadBytes } from 'ethers';

import * as application from '../../constants/application';
import type { DepositData } from '../../model/ethereum';

const depositContractInterface = new Interface(application.DEPOSIT_CONTRACT_ABI);

/**
 * Compute the SSZ hash tree root of the DepositMessage (pubkey, withdrawal credentials, amount)
 *
 * This is the message the validator key signs.
 *
 * @param data - Deposit data
 * @returns 32-byte root as hex string
 */
export function computeDepositMessageRoot(data: DepositData): string {
  return sha256(
    concat([hashPubkeyAndCredentials(data), sha256(zeroPadBytes(amountLittleEndian(data), 64))])
  );
}

/**
 * Compute the SSZ hash tree root of the DepositData (DepositMessage fields plus signature)
 *
 * The deposit contract rebuilds this root and reverts if it differs from the passed root.
 *
 * @param data - Deposit data
 * @returns 32-byte root as hex string
 */
export function computeDepositDataRoot(data: DepositData): string {
  const signatureRoot = sha256(
    concat([
      sha256(dataSlice(data.signature, 0, 64)),
      sha256(zeroPadBytes(dataSlice(data.signature, 64), 64))
    ])
  );
  return sha256(
    concat([
      hashPubkeyAndCredentials(data),
      sha256(concat([zeroPadBytes(amountLittleEndian(data), 32), signatureRoot]))
    ])
  );
}

/**
 * Compute the signing root of a deposit: the message root bound to the network's deposit domain
 *
 * Deposits use the genesis fork version with a zero genesis validators root, so they stay valid
 * across forks.
 *
 * @param data - Deposit data
 * @param genesisForkVersion - Genesis fork version of the target network
 * @returns 32-byte signing root as hex string
 */
export function computeDepositSigningRoot(data: DepositData, genesisForkVersion: string): string {
  const domain = concat([
    application.DOMAIN_DEPOSIT,
    dataSlice(sha256(zeroPadBytes(genesisForkVersion, 64)), 0, 28)
  ]);
  return sha256(concat([computeDepositMessageRoot(data), domain]));
}

/**
 * Verify the BLS proof of possession of a deposit for the given network
 *
 * The deposit contract does not verify the signature. A new validator with an invalid signature
 * is dropped by the consensus layer and the deposited ETH is lost.
 *
 * @param data - Deposit data
 * @param genesisForkVersion - Genesis fork version of the target network
 * @returns True if the signature is valid for the network
 */
export function verifyDepositSignature(data: DepositData, genesisForkVersion: string): boolean {
  try {
    return verify(
      getBytes(computeDepositSigningRoot(data, genesisForkVersion)),
      PublicKey.fromHex(data.pubkey, true),
      Signature.fromHex(data.signature, true),
      true,
      true
    );
  } catch {
    return false;
  }
}

/**
 * Encode the deposit contract call for one deposit
 *
 * @param data - Deposit data
 * @returns ABI encoded calldata of `deposit(pubkey, withdrawal_credentials, signature, deposit_data_root)`
 */
export function encodeDepositCalldata(data: DepositData): string {
  return depositContractInterface.encodeFunctionData(application.DEPOSIT_FUNCTION_NAME, [
    data.pubkey,
    data.withdrawalCredentials,
    data.signature,
    computeDepositDataRoot(data)
  ]);
}

/**
 * Hash the first SSZ node pair shared by DepositMessage and DepositData
 *
 * @param data - Deposit data
 * @returns hash(hash_tree_root(pubkey) ‖ withdrawal_credentials)
 */
function hashPubkeyAndCredentials(data: DepositData): string {
  return sha256(concat([sha256(zeroPadBytes(data.pubkey, 64)), data.withdrawalCredentials]));
}

/**
 * Serialize the amount as SSZ uint64 (8 bytes little endian)
 *
 * @param data - Deposit data
 * @returns Little endian amount bytes
 */
function amountLittleEndian(data: DepositData): Uint8Array {
  return getBytes(toBeHex(data.amountGwei, 8)).reverse();
}
