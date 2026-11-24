import { NextRequest } from "next/server";
import {
  ok,
  badRequest,
  serverError,
  authErrorToResponse,
  authAudit,
  errorResponse,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { assertOrganizationActive } from "@/lib/org";
import { uploadSingleFile, isUploadFile } from "@/lib/upload";
import {
  CompanyProfileValidationError,
  isOwnedCompanyLogoPublicId,
  upsertCompanyProfile,
} from "@/lib/companyProfile";
import { CompanyProfileCryptoError } from "@/lib/companyProfileCrypto";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import { detectImageMime } from "@/lib/imageMime";
import type { NormalizedAccessToken as AuthActor } from "@/lib/auth/claims";
import cloudinary from "@/lib/cloudinary";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ROUTE = "/api/admin/company-profile/signin-background";
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);
const MAX_BYTES = 8 * 1024 * 1024;
const FILENAME = "signin-background";

async function destroyOwnedBackground(
  orgId: string,
  publicId: string | null | undefined
) {
  if (!publicId || !isOwnedCompanyLogoPublicId(orgId, publicId)) {
    if (publicId) {
      console.warn(
        "[company-profile] refusing to destroy sign-in background outside org folder:",
        publicId
      );
    }
    return;
  }
  try {
    await cloudinary.uploader.destroy(publicId, { invalidate: true });
  } catch (destroyErr) {
    console.error(
      "[company-profile] Cloudinary sign-in background destroy failed:",
      destroyErr
    );
    throw new Error("Failed to destroy sign-in background in Cloudinary");
  }
}

async function assertCanEditProfile(actor: AuthActor): Promise<string> {
  const orgId = requireActorOrgId(actor);
  await assertOrganizationActive(orgId);
  const { resolveEffectiveParkScope } = await import("@/lib/parkAdminScope");
  const { ForbiddenError } = await import("@/lib/auth/http-error");
  const parkScope = await resolveEffectiveParkScope(actor);
  if (parkScope.parkLocked) {
    throw new ForbiddenError("Park-locked admins cannot edit company profile");
  }
  return orgId;
}

function mapError(
  err: unknown,
  req: NextRequest,
  method: "POST" | "DELETE",
  actor: AuthActor
) {
  if (
    err instanceof CompanyProfileValidationError ||
    (typeof err === "object" &&
      err !== null &&
      (err as { name?: string }).name === "CompanyProfileValidationError")
  ) {
    return badRequest((err as Error).message);
  }
  if (
    err instanceof CompanyProfileCryptoError ||
    (typeof err === "object" &&
      err !== null &&
      (err as { name?: string }).name === "CompanyProfileCryptoError")
  ) {
    return errorResponse((err as Error).message, 503);
  }
  return authErrorToResponse(
    err,
    authAudit(req, `${method} ${ROUTE}`, {
      actorSub: actor.sub,
      orgId: actor.orgId ?? null,
      permission: P.CompanyProfileWrite,
    })
  );
}

/*
 * POST /api/admin/company-profile/signin-background
 * Fresh + company_profile:write + active org → Cloudinary
 * company-profiles/{orgId}/signin-background (stable id, overwrite).
 */
export async function POST(req: NextRequest) {
  let actor: AuthActor;
  try {
    actor = await requirePermissionFresh(req, P.CompanyProfileWrite, {
      allowOnDemo: true,
    });
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, `POST ${ROUTE}`, { permission: P.CompanyProfileWrite })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const orgId = await assertCanEditProfile(actor);

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return badRequest("Invalid multipart form data");
    }
    const file = formData.get("file") ?? formData.get("files");
    if (!isUploadFile(file)) {
      return badRequest("No image file provided");
    }
    if (file.size > MAX_BYTES) {
      return badRequest("Background image must be 8MB or smaller");
    }
    const rawMime = (file.type || "").toLowerCase();
    // Blank / octet-stream types (Windows) fall back to the magic-byte sniff.
    const mime = rawMime === "application/octet-stream" ? "" : rawMime;
    if (mime && !ALLOWED_MIME.has(mime)) {
      return badRequest("Background image must be JPEG, PNG, or WebP");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const sniffed = detectImageMime(buffer);
    if (!sniffed || !ALLOWED_MIME.has(sniffed)) {
      return badRequest(
        "Background image must be a valid JPEG, PNG, or WebP image"
      );
    }
    if (
      mime &&
      mime !== sniffed &&
      !(mime === "image/jpg" && sniffed === "image/jpeg")
    ) {
      return badRequest(
        "Background image Content-Type does not match file contents"
      );
    }

    const previous = await prisma.companyProfile.findUnique({
      where: { orgId },
      select: { signinBackgroundPublicId: true },
    });

    const folder = `company-profiles/${orgId}`;
    let url = "";
    let publicId = "";
    try {
      const uploadResult = (await uploadSingleFile(
        buffer,
        FILENAME,
        folder,
        "image",
        { overwrite: true, invalidate: true }
      )) as { secure_url?: string; url?: string; public_id?: string } | null;
      url = String(uploadResult?.secure_url || uploadResult?.url || "");
      publicId = String(uploadResult?.public_id || "");
    } catch (uploadErr) {
      console.error(
        "Company sign-in background Cloudinary upload failed:",
        uploadErr
      );
      return serverError("Background upload failed");
    }

    if (!url || !publicId) {
      if (publicId) await destroyOwnedBackground(orgId, publicId);
      return serverError("Background upload failed");
    }
    if (!isOwnedCompanyLogoPublicId(orgId, publicId)) {
      await destroyOwnedBackground(orgId, publicId);
      return serverError("Background upload returned unexpected public id");
    }

    let profile;
    try {
      const result = await upsertCompanyProfile(actor, {
        signinBackgroundUrl: url,
        signinBackgroundPublicId: publicId,
      });
      profile = result.profile;
    } catch (upsertErr) {
      if (publicId !== previous?.signinBackgroundPublicId) {
        await destroyOwnedBackground(orgId, publicId);
      }
      throw upsertErr;
    }

    logStaffActivityEntry(actor, {
      action: "Company Sign-in Background Updated",
      entityType: "Settings",
      entityId: orgId,
      description: "Updated staff sign-in page background",
      metadata: { hasSigninBackground: true },
      request: req,
    });

    return ok({
      message: "Sign-in background updated",
      profile,
      signinBackgroundUrl: url,
    });
  } catch (err) {
    const res = mapError(err, req, "POST", actor);
    if (res) return res;
    console.error("Company sign-in background upload error:", err);
    return serverError("Failed to upload sign-in background");
  }
}

/*
 * DELETE /api/admin/company-profile/signin-background
 * Clears the DB fields first, then destroys the Cloudinary asset (best effort).
 */
export async function DELETE(req: NextRequest) {
  let actor: AuthActor;
  try {
    actor = await requirePermissionFresh(req, P.CompanyProfileWrite, {
      allowOnDemo: true,
    });
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, `DELETE ${ROUTE}`, { permission: P.CompanyProfileWrite })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const orgId = await assertCanEditProfile(actor);

    const previous = await prisma.companyProfile.findUnique({
      where: { orgId },
      select: { signinBackgroundPublicId: true },
    });
    if (!previous) {
      const { getOrEmptyCompanyProfile } = await import("@/lib/companyProfile");
      const profile = await getOrEmptyCompanyProfile(orgId);
      return ok({ message: "Sign-in background removed", profile });
    }

    const { profile } = await upsertCompanyProfile(
      { sub: actor.sub, orgId },
      { signinBackgroundUrl: null, signinBackgroundPublicId: null }
    );

    try {
      await destroyOwnedBackground(orgId, previous.signinBackgroundPublicId);
    } catch (err) {
      console.warn(
        "[company-profile] Cloudinary sign-in background destroy after DB clear failed:",
        err
      );
    }

    logStaffActivityEntry(actor, {
      action: "Company Sign-in Background Removed",
      entityType: "Settings",
      entityId: orgId,
      description: "Removed staff sign-in page background",
      metadata: { hasSigninBackground: false },
      request: req,
    });

    return ok({ message: "Sign-in background removed", profile });
  } catch (err) {
    const res = mapError(err, req, "DELETE", actor);
    if (res) return res;
    console.error("Company sign-in background clear error:", err);
    return serverError("Failed to remove sign-in background");
  }
}
