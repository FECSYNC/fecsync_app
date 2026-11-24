import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";

const ALG = "aes-256-gcm";

function encryptionKey(): Buffer {
  const secret =
    process.env.AI_KEY_ENCRYPTION_SECRET?.trim() ||
    process.env.JWT_SECRET?.trim();
  if (!secret) {
    throw new Error("Server encryption secret is not configured");
  }
  return createHash("sha256").update(secret).digest();
}

/** AES-256-GCM payload: v1:iv:tag:ciphertext (base64url). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Invalid encrypted payload");
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

export function tryDecryptSecret(payload?: string | null): string | null {
  if (!payload || typeof payload !== "string" || !payload.trim()) {
    return null;
  }
  try {
    const plain = decryptSecret(payload).trim();
    return plain || null;
  } catch {
    console.error(
      "Failed to decrypt stored AI API key; falling back to environment key"
    );
    return null;
  }
}

export function secretLast4(plain: string): string {
  const trimmed = plain.trim();
  if (!trimmed) return "";
  return trimmed.slice(-4);
}
