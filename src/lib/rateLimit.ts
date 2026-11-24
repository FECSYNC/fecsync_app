import { NextResponse } from "next/server";
import { tooManyRequests } from "@/lib/response";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim() || "unknown";
  return headers.get("x-real-ip")?.trim() || "127.0.0.1";
}

export function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number
): { allowed: true } | { allowed: false; retryAfterSec: number } {
  const now = Date.now();
  sweep(now);
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }
  if (existing.count >= limit) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }
  existing.count += 1;
  return { allowed: true };
}

/** Read strike count without incrementing (for pre-check bans). */
export function isRateLimitExceeded(
  key: string,
  limit: number,
  windowMs: number
): boolean {
  const now = Date.now();
  sweep(now);
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) return false;
  return existing.count >= limit;
}

/** Increment an existing strike bucket (or start at 1). */
export function incrementRateLimit(key: string, windowMs: number): number {
  const now = Date.now();
  sweep(now);
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return 1;
  }
  existing.count += 1;
  return existing.count;
}

/** JSON `{ message }` shape used by auth routes. */
export function authRateLimited(
  req: Request,
  bucket: string,
  limit: number,
  windowMs: number,
  extraKey = ""
): NextResponse | null {
  // Local matrix / smoke re-runs only — never honor in production.
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.DISABLE_AUTH_RATE_LIMIT === "1"
  ) {
    return null;
  }
  const ip = clientIpFromHeaders(req.headers);
  const result = consumeRateLimit(
    `${bucket}:${ip}:${extraKey}`,
    limit,
    windowMs
  );
  if (result.allowed) return null;
  return NextResponse.json(
    { message: "Too many attempts. Please try again shortly." },
    {
      status: 429,
      headers: { "Retry-After": String(result.retryAfterSec) },
    }
  );
}

/** Wrapped `{ success, error }` shape used by most APIs. */
export function apiRateLimited(
  req: Request,
  bucket: string,
  limit: number,
  windowMs: number,
  extraKey = ""
): NextResponse | null {
  const ip = clientIpFromHeaders(req.headers);
  const result = consumeRateLimit(
    `${bucket}:${ip}:${extraKey}`,
    limit,
    windowMs
  );
  if (result.allowed) return null;
  const res = tooManyRequests(
    "Too many requests. Please try again shortly.",
    result.retryAfterSec
  );
  return res;
}
