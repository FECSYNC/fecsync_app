/**
 * Server-only fashion chat security enforcement (rate-limit strikes + HTTP responses).
 * Import this from API routes only — never from client components.
 */
import { NextResponse } from "next/server";
import {
  clientIpFromHeaders,
  incrementRateLimit,
  isRateLimitExceeded,
} from "@/lib/rateLimit";
import {
  FASHION_CHAT_SECURITY_BAN_MESSAGE,
  FASHION_CHAT_SECURITY_RATE_CODE,
  scanFashionChatMessage,
  type FashionChatSecurityScanResult,
} from "@/lib/fashionChatSecurity";

const SECURITY_STRIKE_LIMIT = 5;
const SECURITY_STRIKE_WINDOW_MS = 15 * 60 * 1000;

function securityStrikeKey(req: Request): string {
  const ip = clientIpFromHeaders(req.headers);
  return `fashion-chat-sec-strikes:${ip}`;
}

/** Gate user chat input; tracks strike count per IP for repeat offenders. */
export function enforceFashionChatMessageSecurity(
  req: Request,
  input: { content: string; image?: string }
): FashionChatSecurityScanResult {
  const strikeKey = securityStrikeKey(req);
  if (
    isRateLimitExceeded(
      strikeKey,
      SECURITY_STRIKE_LIMIT,
      SECURITY_STRIKE_WINDOW_MS
    )
  ) {
    return {
      allowed: false,
      reason: FASHION_CHAT_SECURITY_BAN_MESSAGE,
      code: FASHION_CHAT_SECURITY_RATE_CODE,
    };
  }

  const scan = scanFashionChatMessage(input);
  if (!scan.allowed) {
    incrementRateLimit(strikeKey, SECURITY_STRIKE_WINDOW_MS);
  }
  return scan;
}

export function securityBlockedResponse(
  result: Extract<FashionChatSecurityScanResult, { allowed: false }>,
  status = 403
): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: result.reason,
      code: result.code,
    },
    { status, headers: { "Content-Type": "application/json" } }
  );
}
