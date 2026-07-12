export interface RateLimiterOptions {
  maxRequests?: number;
  windowMs?: number;
  now?: () => number;
  maxEntries?: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly maxEntries: number;

  constructor(options: RateLimiterOptions = {}) {
    this.maxRequests = options.maxRequests ?? 10;
    this.windowMs = options.windowMs ?? 60_000;
    this.now = options.now ?? Date.now;
    this.maxEntries = options.maxEntries ?? 10_000;
  }

  allow(clientKey: string): boolean {
    const now = this.now();
    for (const [key, entry] of this.buckets) {
      if (entry.resetAt <= now) this.buckets.delete(key);
    }
    if (!this.buckets.has(clientKey) && this.buckets.size >= this.maxEntries) {
      const oldestKey = this.buckets.keys().next().value as string | undefined;
      if (oldestKey) this.buckets.delete(oldestKey);
    }
    const bucket = this.buckets.get(clientKey);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(clientKey, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (bucket.count >= this.maxRequests) {
      return false;
    }
    bucket.count += 1;
    return true;
  }
}
