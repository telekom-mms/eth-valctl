import type { ServiceInfoResponse } from '../types';

/**
 * GET /api/v1/about/
 *
 * Returns service info. The `name` field must be "Safe Transaction Service"
 * to pass eth-valctl's health check in safe-preflight.ts.
 */
export function handleAbout(): Response {
  const body: ServiceInfoResponse = {
    name: 'Safe Transaction Service',
    version: 'mock-1.0.0',
    api_version: 'v1',
    secure: false,
    settings: {
      AWS_CONFIGURED: false,
      AWS_S3_CUSTOM_DOMAIN: '',
      ETHEREUM_NODE_URL: '',
      ETHEREUM_TRACING_NODE_URL: '',
      ETH_INTERNAL_TXS_BLOCK_PROCESS_LIMIT: 0,
      ETH_INTERNAL_NO_FILTER: false,
      ETH_REORG_BLOCKS: 0,
      TOKENS_LOGO_BASE_URI: '',
      TOKENS_LOGO_EXTENSION: ''
    }
  };

  return Response.json(body);
}
