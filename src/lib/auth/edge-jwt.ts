/**
 * Access-token verify for the Edge proxy.
 * Uses `jose` (Edge-safe). Node API routes keep `src/lib/jwt.ts` (jsonwebtoken).
 *
 * No DB: expired/invalid tokens fail closed. Honors JWT orgId / membershipRole /
 * permissions via normalizeAccessTokenPayload (Step 5.2).
 */

import { jwtVerify } from "jose";
import { normalizeAccessTokenPayload } from "@/lib/auth/claims";
import type { JwtAccessTokenPayload } from "@/lib/types/auth";
import type { NormalizedAccessToken } from "@/lib/auth/claims";

export class EdgeTokenError extends Error {
  readonly expired: boolean;

  constructor(message: string, expired = false) {
    super(message);
    this.name = "EdgeTokenError";
    this.expired = expired;
  }
}

function getSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new EdgeTokenError("Invalid token");
  }
  return new TextEncoder().encode(secret);
}

function isExpiredJwtError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; name?: unknown; message?: unknown };
  if (candidate.code === "ERR_JWT_EXPIRED") return true;
  if (candidate.name === "JWTExpired") return true;
  return (
    typeof candidate.message === "string" &&
    candidate.message.toLowerCase().includes("expir")
  );
}

export async function verifyAccessTokenEdge(
  token: string
): Promise<NormalizedAccessToken> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      algorithms: ["HS256"],
    });

    if (payload.type !== "access" || !payload.role || !payload.sub) {
      throw new EdgeTokenError("Invalid token");
    }

    return normalizeAccessTokenPayload(payload as unknown as JwtAccessTokenPayload);
  } catch (error) {
    if (error instanceof EdgeTokenError) throw error;
    throw new EdgeTokenError("Invalid token", isExpiredJwtError(error));
  }
}
