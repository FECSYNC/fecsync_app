export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import prisma from "@/lib/prisma";
import { hashWaiverToken, WaiverLinkError } from "@/lib/waivers/signToken";
import { revokeWalkinPass } from "@/lib/waivers/walkinPass";
import { assertWaiversEnabled } from "@/lib/waivers/assert";
import {
  assertPublicJson,
  publicWaiverError,
  publicWaiverExtractRateLimit,
} from "@/lib/waivers/publicHttp";

type Ctx = { params: Promise<{ deviceToken: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const limited = publicWaiverExtractRateLimit(request);
  if (limited) return limited;
  const csrf = assertPublicJson(request);
  if (csrf) return csrf;
  try {
    await connectDB();
    const { deviceToken } = await ctx.params;
    const raw = deviceToken.trim().toLowerCase();
    if (!/^[a-f0-9]{32,128}$/.test(raw)) throw new WaiverLinkError("This kiosk is not available.", 404);
    const device = await prisma.waiverKioskDevice.findFirst({
      where: { deviceTokenHash: hashWaiverToken(raw) },
    });
    if (!device || device.status !== "active") {
      throw new WaiverLinkError("This kiosk is not available.", 404);
    }
    try {
      await assertWaiversEnabled(device.orgId);
    } catch {
      throw new WaiverLinkError("This kiosk is not available.", 403);
    }
    const venue = await prisma.venueLocation.findFirst({
      where: { id: device.locationId, orgId: device.orgId },
      select: { status: true },
    });
    if (!venue || venue.status !== "active") {
      throw new WaiverLinkError("This kiosk is not available.", 403);
    }
    const body = await request.json().catch(() => null);
    const passId =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as { passId?: unknown }).passId
        : "";
    if (typeof passId !== "string" || !passId) throw new Error("A walk-in pass is required");
    const revoked = await revokeWalkinPass({
      orgId: device.orgId,
      locationId: device.locationId,
      passId,
    });
    if (!revoked) throw new WaiverLinkError("This walk-in pass is not for this park.", 403);
    return ok({ revoked: true });
  } catch (err) {
    return publicWaiverError(err);
  }
}
