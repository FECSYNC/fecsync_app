export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest, errorResponse } from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { listWaiverRecords } from "@/lib/waivers/records";
import { waiverAuthFail, waiverFail } from "@/lib/waivers/http";
import {
  WaiverLinkError,
  assertWaiverRequestRate,
  createWaiverRequest,
} from "@/lib/waivers/signToken";

export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.WaiversRead);
  } catch (err) {
    return waiverAuthFail(err, request, "GET /api/admin/waivers/records", P.WaiversRead);
  }
  try {
    await connectDB();
    requireActorOrgId(actor);
    if (
      request.nextUrl.searchParams.has("orgId") ||
      request.nextUrl.searchParams.has("organizationId")
    ) {
      return badRequest("Unsupported selector in query");
    }
    const status = request.nextUrl.searchParams.get("status") ?? undefined;
    const q = request.nextUrl.searchParams.get("q") ?? undefined;
    const email = request.nextUrl.searchParams.get("email") ?? undefined;
    const phone = request.nextUrl.searchParams.get("phone") ?? undefined;
    const templateId = request.nextUrl.searchParams.get("templateId") ?? undefined;
    const locationId = request.nextUrl.searchParams.get("locationId") ?? undefined;
    const channel = request.nextUrl.searchParams.get("channel") ?? undefined;
    const from = request.nextUrl.searchParams.get("from") ?? undefined;
    const to = request.nextUrl.searchParams.get("to") ?? undefined;
    const expiringRaw = request.nextUrl.searchParams.get("expiringWithin");
    const expiringWithinDays = expiringRaw ? Number(expiringRaw) : undefined;
    const records = await listWaiverRecords(actor, {
      status,
      q,
      email,
      phone,
      templateId,
      locationId,
      channel,
      from,
      to,
      expiringWithinDays,
    });
    return ok({ records });
  } catch (err) {
    return waiverFail(err, request, "GET /api/admin/waivers/records", "Failed to list signed waivers", actor);
  }
}

/** Staff-assisted: create an on-site signing link. The guest still signs. */
export async function POST(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.WaiversWrite);
  } catch (err) {
    return waiverAuthFail(err, request, "POST /api/admin/waivers/records", P.WaiversWrite);
  }
  try {
    await connectDB();
    const orgId = requireActorOrgId(actor);
    await assertWaiverRequestRate(orgId);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return badRequest("A signing request is required");
    const created = await createWaiverRequest(actor, {
      templateId: String(body.templateId ?? ""),
      locationId: String(body.locationId ?? ""),
      toEmail: typeof body.toEmail === "string" ? body.toEmail : null,
      guestProfileId: typeof body.guestProfileId === "string" ? body.guestProfileId : null,
      locale: typeof body.locale === "string" ? body.locale : null,
      channel: "onsite",
    });
    return ok(created);
  } catch (err) {
    if (err instanceof WaiverLinkError) return errorResponse(err.message, err.status);
    return waiverFail(err, request, "POST /api/admin/waivers/records", "Failed to open on-site signing", actor);
  }
}
