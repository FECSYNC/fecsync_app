/**
 * Encrypt/decrypt company bank account numbers for CompanyProfile.
 * Prefer COMPANY_PROFILE_ENCRYPTION_KEY; fall back to JWT_SECRET in local/dev.
 * Never return ciphertext to API clients.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";

const ALG = "aes-256-gcm";

export class CompanyProfileCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanyProfileCryptoError";
  }
}

function encryptionKey(): Buffer {
  const dedicated = process.env.COMPANY_PROFILE_ENCRYPTION_KEY?.trim();
  const jwt = process.env.JWT_SECRET?.trim();
  if (process.env.NODE_ENV === "production" && !dedicated) {
    throw new CompanyProfileCryptoError(
      "COMPANY_PROFILE_ENCRYPTION_KEY is required in production"
    );
  }
  const secret = dedicated || jwt;
  if (!secret) {
    throw new CompanyProfileCryptoError(
      "COMPANY_PROFILE_ENCRYPTION_KEY (or JWT_SECRET) is not configured"
    );
  }
  return createHash("sha256").update(`company-profile:${secret}`).digest();
}

/** AES-256-GCM payload: v1:iv:tag:ciphertext (base64url). */
export function encryptBankAccount(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptBankAccount(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Invalid encrypted bank payload");
  }
  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  const data = Buffer.from(parts[3], "base64url");
  const decipher = createDecipheriv(ALG, encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8"
  );
}

export function bankAccountLast4(plain: string): string {
  const digits = plain.replace(/\s+/g, "").trim();
  if (!digits) return "";
  return digits.slice(-4);
}

/** Encrypt routing/IBAN at rest (same AES envelope as account numbers). */
export function encryptBankRoutingOrIban(plain: string): string {
  return encryptBankAccount(plain);
}

/**
 * Decrypt routing/IBAN for internal ops only (never return plaintext on GET).
 * Legacy rows may still hold plaintext until the next profile write.
 * Currently unused by API responses — keep for migrations / support tools.
 */
export function decryptBankRoutingOrIban(
  stored: string | null | undefined
): string | null {
  if (stored == null) return null;
  const value = String(stored).trim();
  if (!value) return null;
  if (!value.startsWith("v1:")) return value;
  try {
    return decryptBankAccount(value);
  } catch {
    throw new CompanyProfileCryptoError("Failed to decrypt bank routing/IBAN");
  }
}
