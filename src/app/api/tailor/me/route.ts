import { NextRequest } from "next/server";
import {
  ok,
  badRequest,
  notFound,
  conflict,
  forbidden,
  serverError,
  authErrorToResponse,
  authAudit,
} from "@/lib/response";
import { requireAuthFresh } from "@/lib/middleware/requireAuth";
import { isPlainObject } from "@/lib/catalogWrite";
import { stampUpdate } from "@/lib/audit/recordAudit";
import {
  assertActiveTailorProviderAccess,
  updateOwnTailorProfile,
} from "@/lib/tailors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/tailor/me — own TailorProfile (active tailor membership or staff owner) */
export async function GET(req: NextRequest) {
  let actor;
  try {
    actor = await requireAuthFresh(req);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "GET /api/tailor/me")
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    void req.nextUrl.searchParams;
    const tailor = await assertActiveTailorProviderAccess(actor);
    return ok({ tailor });
  } catch (err) {
    const authRes = authErrorToResponse(err);
    if (authRes) return authRes;
    const message = err instanceof Error ? err.message : "";
    if (message.includes("not found")) return notFound(message);
    console.error("Error fetching own tailor profile:", err);
    return serverError("Failed to fetch tailor profile");
  }
}

/** PUT /api/tailor/me — edit own profile (not status) */
export async function PUT(req: NextRequest) {
  let actor;
  try {
    actor = await requireAuthFresh(req);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "PUT /api/tailor/me")
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const body = await req.json();
    if (!isPlainObject(body)) {
      return badRequest("Invalid body");
    }
    void body.userId;
    void body.user;
    void body.orgId;
    void body.status;
    void body.createdBy;
    void body.updatedBy;

    const existing = await assertActiveTailorProviderAccess(actor);
    if (existing.status === "suspended") {
      return forbidden("Your tailor profile is suspended");
    }
    if (existing.status !== "approved") {
      return forbidden(
        "Your tailor profile must be approved before you can edit it"
      );
    }

    const audit = await stampUpdate(actor.sub);
    const tailor = await updateOwnTailorProfile(actor.sub, body, audit);
    return ok({ tailor, message: "Profile updated" });
  } catch (err) {
    const authRes = authErrorToResponse(err);
    if (authRes) return authRes;
    const message =
      err instanceof Error ? err.message : "Failed to update profile";
    if (message.includes("not found")) return notFound(message);
    if (
      message.includes("suspended") ||
      message.includes("must be approved")
    ) {
      return forbidden(message);
    }
    if (message.includes("unique") || message.includes("Slug")) {
      return conflict(message);
    }
    if (
      message.includes("required") ||
      message.includes("Invalid") ||
      message.includes("must")
    ) {
      return badRequest(message);
    }
    console.error("Error updating own tailor profile:", err);
    return serverError("Failed to update profile");
  }
}
