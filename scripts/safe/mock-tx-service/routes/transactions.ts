import type { TransactionStore } from '../store';
import type { PaginatedResponse, ProposeTransactionBody, TransactionRecord } from '../types';

/**
 * POST /api/v2/safes/{address}/multisig-transactions/
 *
 * Stores a proposed transaction with its initial confirmation.
 * SafeApiKit sends the proposal body with `contractTransactionHash` as the safeTxHash.
 */
export async function handleProposeTransaction(
  store: TransactionStore,
  safeAddress: string,
  request: Request
): Promise<Response> {
  const body = (await request.json()) as ProposeTransactionBody;

  const safeTxHash = body.contractTransactionHash;
  if (store.hasTransaction(safeTxHash)) {
    return Response.json(
      { nonFieldErrors: ['Transaction with this hash already exists'] },
      { status: 422 }
    );
  }

  const safeInfo = await store.getSafeInfo(safeAddress);
  if (!safeInfo) {
    return Response.json({ detail: `Safe ${safeAddress} not found` }, { status: 404 });
  }

  const now = new Date().toISOString();

  const tx: TransactionRecord = {
    safe: safeInfo.address,
    to: body.to,
    value: body.value,
    data: body.data || null,
    operation: body.operation,
    gasToken: body.gasToken,
    safeTxGas: body.safeTxGas,
    baseGas: body.baseGas,
    gasPrice: body.gasPrice,
    refundReceiver: body.refundReceiver,
    nonce: String(body.nonce),
    safeTxHash,
    submissionDate: now,
    modified: now,
    origin: body.origin ?? '',
    confirmationsRequired: safeInfo.threshold,
    confirmations: [
      {
        owner: body.sender,
        submissionDate: now,
        signature: body.signature,
        signatureType: 'EOA'
      }
    ],
    isExecuted: false,
    isSuccessful: null,
    executionDate: null,
    blockNumber: null,
    transactionHash: null,
    executor: null,
    proposer: body.sender,
    trusted: true,
    signatures: null
  };

  store.addTransaction(tx);
  console.error(
    `[tx] Proposed safeTxHash=${safeTxHash.slice(0, 10)}... nonce=${tx.nonce} from=${body.sender.slice(0, 10)}...`
  );

  return new Response(null, { status: 201 });
}

/**
 * GET /api/v2/safes/{address}/multisig-transactions/
 *
 * Returns transactions for a Safe with optional query filters.
 * SafeApiKit's getPendingTransactions() calls this with `executed=false&nonce__gte=N`.
 */
export async function handleGetMultisigTransactions(
  store: TransactionStore,
  safeAddress: string,
  url: URL
): Promise<Response> {
  const executedParam = url.searchParams.get('executed');
  const nonceGte = url.searchParams.get('nonce__gte');
  const nonceParam = url.searchParams.get('nonce');
  const limit = Number(url.searchParams.get('limit') ?? '100');
  const offset = Number(url.searchParams.get('offset') ?? '0');

  if (executedParam === 'false' && nonceGte !== null) {
    const { results, count } = await store.getPendingTransactions(
      safeAddress,
      Number(nonceGte),
      limit,
      offset
    );
    return paginatedResponse(results, count);
  }

  const { results, count } = store.getMultisigTransactions(safeAddress, {
    executed: executedParam !== null ? executedParam === 'true' : undefined,
    nonce: nonceParam ?? undefined,
    limit,
    offset
  });

  return paginatedResponse(results, count);
}

/**
 * GET /api/v2/multisig-transactions/{safeTxHash}/
 *
 * Returns a single transaction with all confirmations.
 */
export function handleGetTransaction(store: TransactionStore, safeTxHash: string): Response {
  const tx = store.getTransaction(safeTxHash);
  if (!tx) {
    return Response.json({ detail: 'Not found.' }, { status: 404 });
  }

  return Response.json(tx);
}

function paginatedResponse(results: TransactionRecord[], count: number): Response {
  const body: PaginatedResponse<TransactionRecord> = {
    count,
    next: null,
    previous: null,
    results
  };
  return Response.json(body);
}
