/**
 * Sliding-window rate limiter with two tiers based on API key validity.
 *
 * Mirrors the real Safe Transaction Service behavior where API keys
 * don't gate access but increase rate limits.
 *
 * - Valid API key: high limit (effectively unlimited for normal testing)
 * - No key / wrong key: low limit (triggers 429 on rapid operations)
 */
export class RateLimiter {
  private readonly buckets = new Map<string, number[]>();
  private readonly authenticatedLimit: number;
  private unauthenticatedLimit: number;
  private readonly windowMs: number;
  private readonly apiKey: string;

  /**
   * @param apiKey - The valid API key
   * @param authenticatedLimit - Max requests per window with valid key
   * @param unauthenticatedLimit - Max requests per window without valid key
   * @param windowMs - Sliding window duration in milliseconds
   */
  constructor(
    apiKey: string,
    authenticatedLimit: number,
    unauthenticatedLimit: number,
    windowMs: number
  ) {
    this.apiKey = apiKey;
    this.authenticatedLimit = authenticatedLimit;
    this.unauthenticatedLimit = unauthenticatedLimit;
    this.windowMs = windowMs;
  }

  /**
   * Check whether a request is allowed under the current rate limit.
   *
   * @param clientKey - The Bearer token from the Authorization header (or empty string)
   * @returns Rate limit check result with allowed status and metadata
   */
  check(clientKey: string): RateLimitResult {
    const isAuthenticated = clientKey === this.apiKey;
    const limit = isAuthenticated ? this.authenticatedLimit : this.unauthenticatedLimit;
    const bucketKey = clientKey || '__anonymous__';
    const now = Date.now();

    const timestamps = this.getActiveTimestamps(bucketKey, now);
    timestamps.push(now);
    this.buckets.set(bucketKey, timestamps);

    if (timestamps.length > limit) {
      return { allowed: false, limit, remaining: 0, isAuthenticated };
    }

    return { allowed: true, limit, remaining: limit - timestamps.length, isAuthenticated };
  }

  /**
   * Override the unauthenticated rate limit (for admin/test control)
   *
   * @param limit - New max requests per window for unauthenticated clients
   */
  updateUnauthenticatedLimit(limit: number): void {
    this.unauthenticatedLimit = limit;
  }

  /**
   * Clear all rate limit buckets (for admin/test control)
   */
  resetBuckets(): void {
    this.buckets.clear();
  }

  private getActiveTimestamps(bucketKey: string, now: number): number[] {
    const existing = this.buckets.get(bucketKey) ?? [];
    const cutoff = now - this.windowMs;
    return existing.filter((ts) => ts > cutoff);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  isAuthenticated: boolean;
}

/**
 * Extract Bearer token from an Authorization header value
 *
 * @param header - The raw Authorization header (e.g., "Bearer abc123")
 * @returns The token string, or empty string if missing/malformed
 */
export function extractBearerToken(header: string | null): string {
  if (!header?.startsWith('Bearer ')) return '';
  return header.slice(7);
}
