import { ethers } from 'ethers';

import type { TransactionStore } from '../store';
import type { ConfirmTransactionBody } from '../types';

/**
 * POST /api/v1/multisig-transactions/{safeTxHash}/confirmations/
 *
 * Adds a confirmation (signature) to a pending transaction.
 * SafeApiKit sends `{ signature }` in the body. The owner address is
 * recovered from the signature using ecrecover, matching the real TX Service.
 */
export async function handleAddConfirmation(
  store: TransactionStore,
  safeTxHash: string,
  request: Request
): Promise<Response> {
  const body = (await request.json()) as ConfirmTransactionBody;

  const tx = store.getTransaction(safeTxHash);
  if (!tx) {
    return Response.json({ detail: 'Not found.' }, { status: 404 });
  }

  const owner = recoverSignerAddress(safeTxHash, body.signature);
  const now = new Date().toISOString();

  const added = store.addConfirmation(safeTxHash, {
    owner,
    submissionDate: now,
    signature: body.signature,
    signatureType: 'EOA'
  });

  if (!added) {
    return Response.json({ nonFieldErrors: ['Signature already exists'] }, { status: 422 });
  }

  console.error(
    `[confirm] safeTxHash=${safeTxHash.slice(0, 10)}... owner=${owner.slice(0, 10)}... (${tx.confirmations.length}/${tx.confirmationsRequired})`
  );

  return Response.json({ signature: body.signature }, { status: 201 });
}

/**
 * Recover the signer address from a Safe confirmation signature.
 *
 * Protocol Kit's signHash() uses eth_sign which:
 * 1. Hashes the safeTxHash with EIP-191 prefix (\x19Ethereum Signed Message:\n32)
 * 2. Adjusts v by +4 to signal eth_sign type to the Safe contract
 *
 * To ecrecover, we reverse the v adjustment and verify against the
 * EIP-191 prefixed message hash.
 */
function recoverSignerAddress(safeTxHash: string, signature: string): string {
  const sigBytes = ethers.getBytes(signature);
  const v = sigBytes[64]!;

  if (v > 30) {
    sigBytes[64] = v - 4;
    const adjusted = ethers.hexlify(sigBytes);
    const messageHash = ethers.hashMessage(ethers.getBytes(safeTxHash));
    return ethers.recoverAddress(messageHash, adjusted);
  }

  return ethers.recoverAddress(safeTxHash, signature);
}
