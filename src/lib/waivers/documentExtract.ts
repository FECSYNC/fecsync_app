import prisma from "@/lib/prisma";
import { assertWaiversEnabled } from "@/lib/waivers/assert";
import { hashWaiverToken, WaiverLinkError } from "@/lib/waivers/signToken";
import { loadPublicSign } from "@/lib/waivers/capture";

const MANUAL = {
  fallback: "manual" as const,
  fields: null,
};

const KIOSK_UNAVAILABLE = "This kiosk is not available.";

function cloudEndpoint(): string | null {
  const raw = process.env.WAIVER_EXTRACT_ENDPOINT?.trim();
  const key = process.env.WAIVER_EXTRACT_API_KEY?.trim();
  if (!raw || !key) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "0.0.0.0" ||
    host === "::1"
  ) {
    return null;
  }
  if (
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.|100\.64\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    /^f[cd][0-9a-f]{2}:/i.test(host) ||
    host.startsWith("fe80:")
  ) {
    return null;
  }
  return url.toString();
}

function cloudConfigured(): boolean {
  return cloudEndpoint() != null;
}

function stripImage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  if (text.length > 8_000_000) return null;
  if (!/^data:image\/(?:jpeg|jpg|png);base64,/i.test(text)) return null;
  return text;
}

async function cloudFields(image: string | null): Promise<Record<string, string> | null> {
  const endpoint = cloudEndpoint();
  const key = process.env.WAIVER_EXTRACT_API_KEY?.trim();
  if (!endpoint || !key || !image) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ image }),
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { fields?: Record<string, unknown> };
    if (!json.fields || typeof json.fields !== "object") return null;
    const fields: Record<string, string> = {};
    for (const [name, value] of Object.entries(json.fields)) {
      if (typeof value === "string" && value && !value.startsWith("data:")) {
        fields[name.slice(0, 40)] = value.slice(0, 300);
      }
    }
    return fields;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function extractForSignToken(
  token: string,
  body: unknown,
  opts?: { orgSlug?: string | null; venueSlug?: string | null; locale?: string | null }
) {
  const session = await loadPublicSign(token, opts);
  if (session.state !== "form") {
    throw new WaiverLinkError("This waiver link was already used.", 409);
  }
  if (!session.template.allowDocumentExtract) {
    throw new WaiverLinkError("Document reading is turned off for this agreement.", 403);
  }
  if (!cloudConfigured()) return MANUAL;
  const image =
    body && typeof body === "object" && !Array.isArray(body)
      ? stripImage((body as { image?: unknown }).image)
      : null;
  const fields = await cloudFields(image);
  if (!fields) return MANUAL;
  return { fallback: null, fields };
}

export async function extractForKiosk(deviceToken: string, body: unknown) {
  const raw = deviceToken.trim().toLowerCase();
  if (!/^[a-f0-9]{32,128}$/.test(raw)) throw new WaiverLinkError("This kiosk is not available.", 404);
  const device = await prisma.waiverKioskDevice.findFirst({
    where: { deviceTokenHash: hashWaiverToken(raw) },
  });
  if (!device || device.status !== "active") throw new WaiverLinkError(KIOSK_UNAVAILABLE, 404);
  await assertKioskOrg(device.orgId);
  const venue = await prisma.venueLocation.findFirst({
    where: { id: device.locationId, orgId: device.orgId },
    select: { status: true },
  });
  if (!venue || venue.status !== "active") throw new WaiverLinkError(KIOSK_UNAVAILABLE, 403);
  const templateId =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as { templateId?: unknown }).templateId
      : "";
  if (typeof templateId !== "string" || !templateId) {
    throw new Error("Choose an agreement");
  }
  const allowed = Array.isArray(device.templateIds)
    ? device.templateIds.filter((id): id is string => typeof id === "string")
    : [];
  if (!allowed.includes(templateId)) throw new Error("That agreement is not on this kiosk");
  const template = await prisma.waiverTemplate.findFirst({
    where: { id: templateId, orgId: device.orgId, status: "published", archivedAt: null },
    select: { currentPublishedVersion: { select: { allowDocumentExtract: true } } },
  });
  if (!template?.currentPublishedVersion?.allowDocumentExtract) {
    throw new WaiverLinkError("Document reading is turned off for this agreement.", 403);
  }
  if (!cloudConfigured()) return MANUAL;
  const image =
    body && typeof body === "object" && !Array.isArray(body)
      ? stripImage((body as { image?: unknown }).image)
      : null;
  const fields = await cloudFields(image);
  if (!fields) return MANUAL;
  return { fallback: null, fields };
}

async function assertKioskOrg(orgId: string): Promise<void> {
  try {
    await assertWaiversEnabled(orgId);
  } catch {
    throw new WaiverLinkError(KIOSK_UNAVAILABLE, 403);
  }
}
