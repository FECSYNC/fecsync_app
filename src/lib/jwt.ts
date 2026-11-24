// lib/jwt.ts

import jwt from "jsonwebtoken";
import { JwtAccessTokenPayload, JwtPasswordResetTokenPayload, JwtRefreshTokenPayload, JwtValidatorTokenPayload } from "./types/auth";
import {
  buildAccessTokenPayload,
  normalizeAccessTokenPayload,
  type AccessTokenSubject,
  type NormalizedAccessToken,
} from "@/lib/auth/claims";

const JWT_SECRET = process.env.JWT_SECRET!;

/** Short-lived access JWT. Override with ACCESS_TOKEN_TTL (e.g. "15m", "2h"). */
const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL?.trim() || "2h";

export function signAccessToken(user: AccessTokenSubject) {
  const payload: JwtAccessTokenPayload = buildAccessTokenPayload(user);

  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}

export function signRefreshToken(userId: string) {
  const jti = crypto.randomUUID();
  const payload: JwtRefreshTokenPayload = {
    sub: userId,
    jti,
    type: "refresh",
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });

  return { token, jti };
}

export function verifyAccessToken(token: string): NormalizedAccessToken {
  const decoded = jwt.verify(token, JWT_SECRET);

  if (typeof decoded !== "object" || !decoded || decoded.type !== "access") {
    throw new Error("Invalid access token");
  }

  const payload = decoded as JwtAccessTokenPayload;
  // Session JWTs always carry a role. Reset tokens use type "password_reset".
  if (!payload.role || !payload.sub) {
    throw new Error("Invalid access token");
  }

  return normalizeAccessTokenPayload(payload);
}

/**
 * Read orgId from an access JWT without requiring it to still be valid.
 * Used only as sticky preferOrgId on refresh — membership is re-checked in DB.
 */
export function peekAccessTokenOrgId(
  token: string | null | undefined
): string | null {
  if (!token || !token.trim()) return null;
  try {
    const decoded = jwt.decode(token);
    if (!decoded || typeof decoded !== "object") return null;
    const orgId = (decoded as { orgId?: unknown }).orgId;
    if (
      typeof orgId === "string" &&
      orgId.trim() &&
      orgId.trim() !== "undefined" &&
      orgId.trim() !== "null"
    ) {
      return orgId.trim();
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function verifyRefreshToken(token: string): JwtRefreshTokenPayload {
  const decoded = jwt.verify(token, JWT_SECRET);

  if (typeof decoded !== "object" || !decoded || decoded.type !== "refresh") {
    throw new Error("Invalid refresh token");
  }

  return decoded as JwtRefreshTokenPayload;
}


export function signResetToken(user: { id: string; email: string; }) {
  const payload: JwtPasswordResetTokenPayload = {
    sub: user.id,
    email: user.email,
    type: "password_reset",
  };

  // Must match sendResetEmail notice (expires in 1 hour → request a new link).
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "1h" });
}

export function verifyResetToken(token: string): JwtPasswordResetTokenPayload {
  const decoded = jwt.verify(token, JWT_SECRET);

  if (
    typeof decoded !== "object" ||
    !decoded ||
    decoded.type !== "password_reset" ||
    typeof decoded.sub !== "string" ||
    !decoded.sub
  ) {
    throw new Error("Invalid or expired token");
  }

  return decoded as JwtPasswordResetTokenPayload;
}

/** Legacy validator cookie (type access). Not a password-reset token. */
export function verifyValidatorToken(token: string): JwtValidatorTokenPayload {
  const decoded = jwt.verify(token, JWT_SECRET);

  if (typeof decoded !== "object" || !decoded || decoded.type !== "access") {
    throw new Error("Invalid access token");
  }

  return decoded as JwtValidatorTokenPayload;
}
