import { NextRequest } from "next/server";
import {
  ok,
  created,
  badRequest,
  notFound,
  errorResponse,
  routeErrorResponse,
  authorizeGuardResponse,
  authAudit,
} from "@/lib/response";
import {
  requireAuthFresh,
  requirePermissionFresh,
} from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { isPlainObject } from "@/lib/catalogWrite";
import { withDbRetry, isTransientDbError } from "@/lib/db";
import {
  completeCampaignParticipation,
  ensureJoinedForCampaignSubmit,
  getPublicCampaignBySlug,
  joinCampaignBySlug,
} from "@/lib/measurementCampaigns";
import {
  assertNonEmptyMeasurements,
  getMeasurementProfileForUser,
} from "@/lib/measurements";
import { isValidId } from "@/lib/ids";
import { isAuthHttpError } from "@/lib/auth/http-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await ctx.params;
    let userId: string | undefined;
    let userEmail: string | undefined;
    try {
      const actor = await requireAuthFresh(req, { allowSuspendedOrg: true });
      userId = actor.sub;
      userEmail = actor.email?.trim().toLowerCase();
    } catch (err) {
      if (isTransientDbError(err)) {
        return routeErrorResponse(err, "Failed to load campaign");
      }
      // Missing/invalid token → anonymous join landing.
      // Authenticated-but-forbidden (e.g. unexpected 403) must not look anonymous.
      if (isAuthHttpError(err) && err.status === 401) {
        /* anonymous */
      } else if (isAuthHttpError(err)) {
        return authorizeGuardResponse(
          err,
          authAudit(req, "GET /api/campaigns/join/[slug]")
        );
      }
      // Non-auth errors without session → still show public campaign shell.
    }
    const inviteToken = req.nextUrl.searchParams.get("invite")?.trim() || undefined;
    const groupToken = req.nextUrl.searchParams.get("group")?.trim() || undefined;
    const campaign = await withDbRetry(() =>
      getPublicCampaignBySlug(slug, {
        userId,
        userEmail,
        inviteToken,
        groupToken,
      })
    );
    if (!campaign) return notFound("Campaign not found");
    return ok({ campaign });
  } catch (err) {
    return routeErrorResponse(err, "Failed to load campaign");
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> }
) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.MeasurementsWriteOwn);
  } catch (err) {
    return authorizeGuardResponse(
      err,
      authAudit(req, "POST /api/campaigns/join/[slug]")
    );
  }

  try {
    const { slug } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    if (body && !isPlainObject(body)) return badRequest("Invalid body");
    void body.userId;
    void body.user;
    void body.participantId;
    void body.campaignId;

    const wantsComplete =
      body.action === "complete" ||
      (typeof body.measurementProfileId === "string" &&
        body.measurementProfileId.trim().length > 0);
    const profileId = wantsComplete
      ? String(body.measurementProfileId ?? "").trim()
      : "";
    if (wantsComplete && !profileId) {
      return badRequest("Invalid measurement profile");
    }

    if (wantsComplete) {
      if (!isValidId(profileId)) {
        return badRequest("Invalid measurement profile");
      }
      const profile = await withDbRetry(() =>
        getMeasurementProfileForUser(actor.sub, profileId)
      );
      if (!profile) {
        return badRequest("Invalid measurement profile");
      }
      try {
        assertNonEmptyMeasurements(
          profile.measurements,
          "Measurement profile has no usable values for this campaign"
        );
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Measurement profile has no usable values";
        return badRequest(message);
      }
    }

    const inviteToken =
      typeof body.inviteToken === "string" ? body.inviteToken.trim() : "";
    const groupToken =
      typeof body.groupToken === "string" ? body.groupToken.trim() : "";

    const userName =
      (typeof body.fullName === "string" && body.fullName.trim().slice(0, 120)) ||
      actor.email?.split("@")[0] ||
      "Participant";

    const joinFn = wantsComplete ? ensureJoinedForCampaignSubmit : joinCampaignBySlug;
    const result = await withDbRetry(() =>
      joinFn(
        slug,
        actor.sub,
        userName,
        actor.email ?? "",
        inviteToken || undefined,
        groupToken || undefined
      )
    );

    if (wantsComplete) {
      try {
        const completeResult = await withDbRetry(() =>
          completeCampaignParticipation(
            result.campaignId,
            actor.sub,
            profileId,
            {
              userEmail: actor.email ?? undefined,
              inviteToken: inviteToken || undefined,
              participantId: result.participantId,
            }
          )
        );
        return ok({
          ...result,
          completed: true,
          alreadyCompleted: completeResult.alreadyCompleted,
        });
      } catch (completeErr) {
        if (isTransientDbError(completeErr)) {
          return errorResponse(
            "Joined the campaign, but measurements were not submitted: Database temporarily unavailable. Please try again.",
            503
          );
        }
        const message =
          completeErr instanceof Error
            ? completeErr.message
            : "Could not submit measurements";
        // Join already committed — tell the client so a retry can complete only.
        if (
          message.includes("not a participant") ||
          message.includes("Invalid") ||
          message.includes("not found") ||
          message.includes("no longer accepting") ||
          message.includes("expired") ||
          message.includes("Add measurements") ||
          message.includes("email address that received") ||
          message.includes("verified email") ||
          message.includes("Join the campaign before submitting")
        ) {
          return badRequest(
            `Joined the campaign, but measurements were not submitted: ${message}`
          );
        }
        console.error("Complete campaign after join error:", completeErr);
        return badRequest(
          "Joined the campaign, but measurements were not submitted. Try again."
        );
      }
    }

    return created(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to join campaign";
    // Invitation failures are client errors; campaign missing/expired stays 404.
    if (
      message.includes("invitation") ||
      message.includes("Invalid or already used") ||
      message.includes("Invalid or expired group link") ||
      message.includes("This group link is not active yet") ||
      message.includes("your group link") ||
      message.includes("email address that received") ||
      message.includes("verified email") ||
      message.includes("not a participant in this campaign") ||
      message.includes("already participating") ||
      message.includes("already submitted measurements") ||
      message.includes("pending invitation from another group") ||
      message.includes("cannot join another coordinator")
    ) {
      return badRequest(message);
    }
    if (message.includes("not found") || message.includes("expired")) {
      return notFound(message);
    }
    if (message.includes("not started yet")) {
      return badRequest(message);
    }
    if (
      message.includes("not a participant") ||
      message.includes("Invalid") ||
      message.includes("enough") ||
      message.includes("no longer accepting")
    ) {
      return badRequest(message);
    }
    return routeErrorResponse(err, "Failed to join campaign");
  }
}
