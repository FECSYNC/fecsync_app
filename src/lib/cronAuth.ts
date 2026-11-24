/**
 * Shared Bearer CRON_SECRET gate for Step 3 cron routes.
 */

import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { unauthorized, errorResponse } from "@/lib/response";

function bearerMatches(authHeader: string, secret: string): boolean {
  const expected = `Bearer ${secret}`;
  const provided = authHeader.trim();
  try {
    const a = Buffer.from(provided, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function assertCronBearer(
  req: NextRequest
): NextResponse | null {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return errorResponse("CRON_SECRET is not configured", 503);
  }
  const auth = req.headers.get("authorization") ?? "";
  if (!bearerMatches(auth, secret)) {
    return unauthorized("Invalid cron secret");
  }
  return null;
}
