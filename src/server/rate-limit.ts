import { tooManyRequests } from "./errors";

/**
 * Fixed-window in-memory rate limiter.
 *
 * Adequate for a single instance and for demo mode. On Vercel each serverless
 * instance has its own memory, so production deployments should swap this for
 * a shared store (e.g. Upstash Redis or a Firestore counter) — see docs/SECURITY.md.
 *
 * SOS endpoints use deliberately generous limits: blocking a genuine emergency
 * is worse than tolerating a burst of retries.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitRule {
  name: string;
  limit: number;
  windowMs: number;
}

export const RATE_LIMITS = {
  default: { name: "default", limit: 120, windowMs: 60_000 },
  write: { name: "write", limit: 40, windowMs: 60_000 },
  sos: { name: "sos", limit: 20, windowMs: 10 * 60_000 },
  auth: { name: "auth", limit: 10, windowMs: 60_000 },
  invite: { name: "invite", limit: 20, windowMs: 60 * 60_000 },
} satisfies Record<string, RateLimitRule>;

export function checkRateLimit(key: string, rule: RateLimitRule, now = Date.now()): void {
  const k = `${rule.name}:${key}`;
  const b = buckets.get(k);
  if (!b || b.resetAt <= now) {
    buckets.set(k, { count: 1, resetAt: now + rule.windowMs });
    if (buckets.size > 10_000) {
      for (const [key2, v] of buckets) if (v.resetAt <= now) buckets.delete(key2);
    }
    return;
  }
  b.count++;
  if (b.count > rule.limit) throw tooManyRequests(Math.ceil((b.resetAt - now) / 1000));
}

export function __resetRateLimits() {
  buckets.clear();
}
