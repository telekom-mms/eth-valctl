import { parseArgs } from 'util';

import {
  MOCK_API_KEY,
  MOCK_TX_SERVICE_PORT,
  RATE_LIMIT_AUTHENTICATED,
  RATE_LIMIT_UNAUTHENTICATED,
  RATE_LIMIT_WINDOW_MS,
  RPC_URL
} from '../constants';
import { extractBearerToken, RateLimiter } from './rate-limiter';
import { TransactionStore } from './store';
import { handleAbout } from './routes/about';
import { handleAddConfirmation } from './routes/confirmations';
import { handleGetSafeInfo } from './routes/safes';
import {
  handleGetMultisigTransactions,
  handleGetTransaction,
  handleProposeTransaction
} from './routes/transactions';

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    port: { type: 'string', default: String(MOCK_TX_SERVICE_PORT) },
    'rpc-url': { type: 'string', default: RPC_URL },
    'api-key': { type: 'string', default: MOCK_API_KEY }
  },
  strict: false
});

const port = Number(values.port);
const rpcUrl = values['rpc-url'] as string;
const apiKey = values['api-key'] as string;
const store = new TransactionStore(rpcUrl);
const rateLimiter = new RateLimiter(
  apiKey,
  RATE_LIMIT_AUTHENTICATED,
  RATE_LIMIT_UNAUTHENTICATED,
  RATE_LIMIT_WINDOW_MS
);

/**
 * URL pattern matchers for the mock Safe Transaction Service.
 *
 * SafeApiKit constructs URLs as `${txServiceUrl}/v1/...` or `${txServiceUrl}/v2/...`.
 * With txServiceUrl = "http://localhost:5555/api", paths start with /api/v1/ or /api/v2/.
 */
const ROUTES: Array<{
  method: string;
  pattern: RegExp;
  handler: (match: RegExpMatchArray, request: Request, url: URL) => Promise<Response> | Response;
}> = [
  {
    method: 'GET',
    pattern: /^\/api\/v1\/about\/?$/,
    handler: () => handleAbout()
  },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/safes\/(0x[a-fA-F0-9]{40})\/?$/,
    handler: (match) => handleGetSafeInfo(store, match[1])
  },
  {
    method: 'POST',
    pattern: /^\/api\/v2\/safes\/(0x[a-fA-F0-9]{40})\/multisig-transactions\/?$/,
    handler: (match, request) => handleProposeTransaction(store, match[1], request)
  },
  {
    method: 'GET',
    pattern: /^\/api\/v2\/safes\/(0x[a-fA-F0-9]{40})\/multisig-transactions\/?$/,
    handler: (match, _request, url) => handleGetMultisigTransactions(store, match[1], url)
  },
  {
    method: 'GET',
    pattern: /^\/api\/v2\/multisig-transactions\/(0x[a-fA-F0-9]{64})\/?$/,
    handler: (match) => handleGetTransaction(store, match[1])
  },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/multisig-transactions\/(0x[a-fA-F0-9]{64})\/confirmations\/?$/,
    handler: (match) => {
      const tx = store.getTransaction(match[1]);
      if (!tx) return Response.json({ detail: 'Not found.' }, { status: 404 });
      return Response.json({
        count: tx.confirmations.length,
        next: null,
        previous: null,
        results: tx.confirmations
      });
    }
  },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/multisig-transactions\/(0x[a-fA-F0-9]{64})\/confirmations\/?$/,
    handler: (match, request) => handleAddConfirmation(store, match[1], request)
  }
];

/**
 * Handle /_admin/ routes for test control (bypasses rate limiting)
 */
async function handleAdminRoute(
  method: string,
  path: string,
  request: Request
): Promise<Response | null> {
  if (!path.startsWith('/_admin/')) return null;

  if (method === 'POST' && path === '/_admin/rate-limit') {
    const body = (await request.json()) as { unauthenticatedLimit: number };
    rateLimiter.updateUnauthenticatedLimit(body.unauthenticatedLimit);
    console.error(`[admin] Updated unauthenticated rate limit to ${body.unauthenticatedLimit}`);
    return Response.json({ ok: true });
  }

  if (method === 'POST' && path === '/_admin/rate-limit/reset') {
    rateLimiter.resetBuckets();
    console.error('[admin] Reset all rate limit buckets');
    return Response.json({ ok: true });
  }

  if (method === 'POST' && path === '/_admin/fail-after') {
    const body = (await request.json()) as { count: number };
    store.setFailAfterCount(body.count);
    console.error(`[admin] Set fail-after count to ${body.count}`);
    return Response.json({ ok: true });
  }

  if (method === 'POST' && path === '/_admin/fail-after/reset') {
    store.resetFailAfter();
    console.error('[admin] Reset fail-after');
    return Response.json({ ok: true });
  }

  if (method === 'POST' && path === '/_admin/clear-pending') {
    store.clearPendingTransactions();
    console.error('[admin] Cleared all pending transactions');
    return Response.json({ ok: true });
  }

  if (method === 'POST' && path === '/_admin/hide-pending') {
    store.setHidePending(true);
    console.error('[admin] Hiding pending transactions from queries');
    return Response.json({ ok: true });
  }

  if (method === 'POST' && path === '/_admin/hide-pending/reset') {
    store.setHidePending(false);
    console.error('[admin] Reset hide-pending (pending transactions visible again)');
    return Response.json({ ok: true });
  }

  return Response.json({ detail: 'Unknown admin route' }, { status: 404 });
}

const server = Bun.serve({
  port,
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;

    const adminResponse = await handleAdminRoute(method, path, request);
    if (adminResponse) return adminResponse;

    const clientToken = extractBearerToken(request.headers.get('Authorization'));
    const rateResult = rateLimiter.check(clientToken);
    const authTag = rateResult.isAuthenticated ? 'auth' : 'anon';

    console.error(
      `[${method}] ${path}${url.search} (${authTag}, ${rateResult.remaining}/${rateResult.limit} remaining)`
    );

    if (!rateResult.allowed) {
      console.error(`[429] Rate limited (${authTag})`);
      return Response.json({ detail: 'Request was throttled.' }, { status: 429 });
    }

    for (const route of ROUTES) {
      if (method !== route.method) continue;
      const match = path.match(route.pattern);
      if (match) {
        try {
          return await route.handler(match, request, url);
        } catch (error) {
          console.error(`[error] ${method} ${path}:`, error);
          return Response.json(
            { detail: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
          );
        }
      }
    }

    console.error(`[404] No route for ${method} ${path}`);
    return Response.json({ detail: 'Not found.' }, { status: 404 });
  }
});

console.error(`Mock Safe Transaction Service running on http://localhost:${server.port}/api`);
console.error(`  RPC URL:    ${rpcUrl}`);
console.error(`  API Key:    ${apiKey}`);
console.error(
  `  Rate Limit: ${RATE_LIMIT_AUTHENTICATED} req/min (authenticated), ${RATE_LIMIT_UNAUTHENTICATED} req/min (unauthenticated)`
);
console.error(`  Endpoints:`);
console.error(`    GET  /api/v1/about`);
console.error(`    GET  /api/v1/safes/{address}/`);
console.error(`    POST /api/v2/safes/{address}/multisig-transactions/`);
console.error(`    GET  /api/v2/safes/{address}/multisig-transactions/`);
console.error(`    GET  /api/v2/multisig-transactions/{safeTxHash}/`);
console.error(`    GET  /api/v1/multisig-transactions/{safeTxHash}/confirmations/`);
console.error(`    POST /api/v1/multisig-transactions/{safeTxHash}/confirmations/`);
