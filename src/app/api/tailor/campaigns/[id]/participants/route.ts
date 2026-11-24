import { NextRequest } from "next/server";
import {
  ok,
  created,
  badRequest,
  notFound,
  serverError,
  authErrorToResponse,
  authAudit,
} from "@/lib/response";
import { requireAuthFresh } from "@/lib/middleware/requireAuth";
import { isPlainObject } from "@/lib/catalogWrite";
import { assertActiveTailorProviderAccess } from "@/lib/tailors";
import {
  allocateScansToParticipants,
  inviteCampaignParticipants,
  listCampaignParticipants,
  listCampaignParticipantsTree,
  sendCampaignReminders,
} from "@/lib/measurementCampaigns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireAuthFresh(req);
    const tailor = await assertActiveTailorProviderAccess(actor);
    const { id } = await ctx.params;
    const view = req.nextUrl.searchParams.get("view")?.trim().toLowerCase();
    if (view === "tree") {
      const tree = await listCampaignParticipantsTree(tailor._id, id);
      return ok(tree);
    }
    const participants = await listCampaignParticipants(tailor._id, id);
    return ok({ participants });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "GET /api/tailor/campaigns/[id]/participants")
    );
    if (authRes) return authRes;
    const message = err instanceof Error ? err.message : "";
    if (message.includes("not found")) return notFound(message);
    console.error("List participants error:", err);
    return serverError("Failed to list participants");
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireAuthFresh(req);
    const tailor = await assertActiveTailorProviderAccess(actor);
    const { id } = await ctx.params;
    const body = await req.json();
    if (!isPlainObject(body)) return badRequest("Invalid body");

    if (body.action === "remind") {
      const result = await sendCampaignReminders(tailor._id, id);
      return ok(result);
    }

    if (body.action === "allocate-scans") {
      const rawScans = Number(body.scansEach);
      const scansEach = Number.isFinite(rawScans)
        ? Math.min(100, Math.max(1, Math.trunc(rawScans)))
        : 1;
      const result = await allocateScansToParticipants(tailor._id, id, {
        participantIds: Array.isArray(body.participantIds)
          ? body.participantIds.map(String).slice(0, 200)
          : undefined,
        scansEach,
        everyone: Boolean(body.everyone),
      });
      return ok(result);
    }

    if (body.action === "invite") {
      const invitePayload: Record<string, unknown> = {
        participants: Array.isArray(body.participants) ? body.participants : [],
      };
      if (typeof body.expiresAt === "string") {
        invitePayload.expiresAt = body.expiresAt;
      }
      if (typeof body.defaultRole === "string") {
        invitePayload.defaultRole = body.defaultRole;
      }
      if (typeof body.tailorClientId === "string" && body.tailorClientId.trim()) {
        invitePayload.tailorClientId = body.tailorClientId.trim();
      }
      const result = await inviteCampaignParticipants(
        tailor._id,
        actor.sub,
        id,
        invitePayload
      );
      return created(result);
    }

    return badRequest("Unknown action");
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "POST /api/tailor/campaigns/[id]/participants")
    );
    if (authRes) return authRes;
    const message = err instanceof Error ? err.message : "Request failed";
    if (message.includes("not found")) return notFound(message);
    if (
      message.includes("required") ||
      message.includes("Invalid") ||
      message.includes("enough") ||
      message.includes("archived") ||
      message.includes("expired") ||
      message.includes("past") ||
      message.includes("Duplicate") ||
      message.includes("Already invited") ||
      message.includes("Can only") ||
      message.includes("No participants") ||
      message.includes("Scans must") ||
      message.includes("reminders") ||
      message.includes("not started") ||
      message.includes("unless the campaign is active")
    ) {
      return badRequest(message);
    }
    console.error("Campaign participants action error:", err);
    return serverError("Failed to process request");
  }
}
