import type { TransactionStore } from '../store';

/**
 * GET /api/v1/safes/{address}/
 *
 * Returns Safe info (owners, threshold, nonce). Reads from chain on first access.
 * SafeApiKit normalizes `masterCopy` to `singleton` internally, but we return
 * `singleton` directly to match the expected type.
 */
export async function handleGetSafeInfo(
  store: TransactionStore,
  safeAddress: string
): Promise<Response> {
  const safeInfo = await store.getSafeInfo(safeAddress);

  if (!safeInfo) {
    return Response.json({ detail: `Safe ${safeAddress} not found` }, { status: 404 });
  }

  return Response.json(safeInfo);
}
