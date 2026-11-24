export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest, notFound, forbidden } from "@/lib/response";
import { apiRateLimited } from "@/lib/rateLimit";
import { resolvePublicMarketingOrgId } from "@/lib/marketing/publicOrg";
import { upsertNewsletterLead } from "@/lib/marketing/upsertLead";
import { getOrCreateMarketingSettings } from "@/lib/marketing/settings";
import { routeErrorResponse } from "@/lib/response";

function consentIsTrue(raw: unknown): boolean {
  return raw === true || raw === "true" || raw === 1 || raw === "1";
}

export async function POST(request: NextRequest) {
  const limited = apiRateLimited(request, "public-marketing-newsletter", 15, 60_000);
  if (limited) return limited;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return badRequest("Invalid JSON");
  }

  const orgSlug = String(body.orgSlug ?? "").trim();
  const email = String(body.email ?? "").trim();
  if (!orgSlug || !email) {
    return badRequest("orgSlug and email are required");
  }
  if (!consentIsTrue(body.consent)) {
    return badRequest("Explicit marketing consent is required (consent: true)");
  }

  try {
    await connectDB();
    const orgId = await resolvePublicMarketingOrgId(orgSlug);
    const settings = await getOrCreateMarketingSettings(orgId);
    if (!settings.newsletterEnabled) {
      return forbidden("Newsletter signup is disabled for this company");
    }
    const result = await upsertNewsletterLead({
      orgId,
      email,
      firstName: body.firstName ? String(body.firstName) : null,
      lastName: body.lastName ? String(body.lastName) : null,
      phone: body.phone ? String(body.phone) : null,
      locationId: body.locationId ? String(body.locationId) : null,
      source: "public_newsletter",
    });
    return ok({ success: true, guestProfileId: result.guestProfileId, created: result.created });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed";
    if (msg === "Company not found") return notFound(msg);
    return routeErrorResponse(err, "Failed to subscribe", {});
  }
}
