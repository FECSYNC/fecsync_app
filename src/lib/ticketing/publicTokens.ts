import { randomBytes } from "crypto";

/** Guest-facing bearer tokens (booking viewToken, payment link, party invite): 24 random bytes, base64url. */
export function newPublicToken(): string {
  return randomBytes(24).toString("base64url");
}
