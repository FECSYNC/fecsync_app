import { createHmac, timingSafeEqual } from "crypto";
import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";
import { publicAppBaseUrl } from "@/lib/publicAppBaseUrl";
import { setEmailOptIn } from "@/lib/marketing/consent";

/**
 * Signing secrets, preferred first. Links already in guests' inboxes may have been
 * signed with either one, so verification accepts any of them.
 */
function marketingSecrets(): string[] {
  const secrets = [process.env.NEXTAUTH_SECRET?.trim(), process.env.CRON_SECRET?.trim()].filter(
    (s): s is string => Boolean(s)
  );
  if (secrets.length === 0) {
    throw new Error("Marketing unsubscribe secret is not configured");
  }
  return [...new Set(secrets)];
}

function signPayload(payload: string, secret = marketingSecrets()[0]!): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function signatureMatches(sig: string, expected: string): boolean {
  try {
    const a = Buffer.from(sig, "utf8");
    const b = Buffer.from(expected, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function buildMarketingUnsubscribeToken(
  orgId: string,
  guestProfileId: string
): string {
  const payload = `${requireId(orgId, "orgId")}:${requireId(guestProfileId, "guestProfileId")}`;
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${signPayload(payload)}`;
}

export function parseMarketingUnsubscribeToken(token: string): {
  orgId: string;
  guestProfileId: string;
} | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  let payload: string;
  try {
    payload = Buffer.from(body!, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const valid = marketingSecrets().some((secret) =>
    signatureMatches(sig!, signPayload(payload, secret))
  );
  if (!valid) return null;
  const [orgId, guestProfileId] = payload.split(":");
  if (!orgId || !guestProfileId) return null;
  return { orgId, guestProfileId };
}

export function buildUnsubscribeUrl(
  orgId: string,
  guestProfileId: string
): string {
  const token = buildMarketingUnsubscribeToken(orgId, guestProfileId);
  return `${publicAppBaseUrl()}/api/public/marketing/unsubscribe?token=${encodeURIComponent(token)}`;
}

export async function applyUnsubscribe(token: string): Promise<boolean> {
  const parsed = parseMarketingUnsubscribeToken(token);
  if (!parsed) return false;

  const guest = await prisma.guestProfile.findFirst({
    where: { id: parsed.guestProfileId, orgId: parsed.orgId },
    select: { id: true },
  });
  if (!guest) return false;

  await setEmailOptIn({
    orgId: parsed.orgId,
    guestProfileId: parsed.guestProfileId,
    optedIn: false,
    source: "unsubscribe",
  });
  return true;
}
