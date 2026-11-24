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
import {
  uploadSingleFile,
  isUploadFile,
} from "@/lib/upload";
import {
  CompanyProfileValidationError,
  isOwnedCompanyLogoPublicId,
  upsertCompanyProfile,
} from "@/lib/companyProfile";
import { CompanyProfileCryptoError } from "@/lib/companyProfileCrypto";
import { detectImageMime } from "@/lib/imageMime";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import cloudinary from "@/lib/cloudinary";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);
const MAX_BYTES = 5 * 1024 * 1024;

async function destroyOwnedLogo(orgId: string, publicId: string | null | undefined) {
  if (!publicId || !isOwnedCompanyLogoPublicId(orgId, publicId)) {
    if (publicId) {
      console.warn(
        "[company-profile] refusing to destroy logo outside org folder:",
        publicId
      );
    }
    return;
  }
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (destroyErr) {
    console.error("[company-profile] Cloudinary logo destroy failed:", destroyErr);
    throw new Error("Failed to destroy company logo in Cloudinary");
  }
}

/*
 * POST /api/admin/company-profile/logo
 * Fresh + settings:manage + active org → Cloudinary company-profiles/{orgId}.
 */

export async function POST(req: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.CompanyProfileWrite, { allowOnDemo: true });
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "POST /api/admin/company-profile/logo", {
          permission: P.CompanyProfileWrite,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const orgId = requireActorOrgId(actor);
    await assertOrganizationActive(orgId);

    const { resolveEffectiveParkScope } = await import("@/lib/parkAdminScope");
    const { ForbiddenError } = await import("@/lib/auth/http-error");
    const parkScope = await resolveEffectiveParkScope(actor);
    if (parkScope.parkLocked) {
      throw new ForbiddenError(
        "Park-locked admins cannot edit company profile"
      );
    }

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
      return badRequest("Logo must be 5MB or smaller");
    }
    const rawMime = (file.type || "").toLowerCase();
    // Some browsers omit Content-Type (or send octet-stream); rely on magic-byte sniff below.
    const mime = rawMime === "application/octet-stream" ? "" : rawMime;
    if (mime && !ALLOWED_MIME.has(mime)) {
      return badRequest("Logo must be JPEG, PNG, or WebP");
    }

    const previous = await prisma.companyProfile.findUnique({
      where: { orgId },
      select: { logoPublicId: true },
    });

    const buffer = Buffer.from(await file.arrayBuffer());
    const sniffed = detectImageMime(buffer);
    if (!sniffed || !ALLOWED_MIME.has(sniffed)) {
      return badRequest("Logo must be a valid JPEG, PNG, or WebP image");
    }
    // Prefer sniffed MIME over client Content-Type when client sent a type.
    if (
      mime &&
      mime !== sniffed &&
      !(mime === "image/jpg" && sniffed === "image/jpeg")
    ) {
      return badRequest("Logo Content-Type does not match file contents");
    }

    // Stable public_id so concurrent uploads overwrite the same asset (no orphans).
    const filename = "logo";
    const folder = `company-profiles/${orgId}`;
    const expectedPublicId = `${folder}/${filename}`;

    let logoUrl = "";
    let logoPublicId = "";
    try {
      const uploadResult = await uploadSingleFile(
        buffer,
        filename,
        folder,
        "image",
        { overwrite: true, invalidate: true }
      );

      logoUrl =
        typeof uploadResult === "object" &&
        uploadResult &&
        "secure_url" in uploadResult
          ? String(
              (uploadResult as { secure_url?: string }).secure_url ||
                (uploadResult as { url?: string }).url ||
                ""
            )
          : typeof uploadResult === "string"
            ? uploadResult
            : "";
      logoPublicId =
        typeof uploadResult === "object" &&
        uploadResult &&
        "public_id" in uploadResult
          ? String((uploadResult as { public_id?: string }).public_id || "")
          : "";
    } catch (uploadErr) {
      console.error("Company logo Cloudinary upload failed:", uploadErr);
      return serverError("Logo upload failed");
    }

    if (!logoUrl || !logoPublicId) {
      if (logoPublicId) await destroyOwnedLogo(orgId, logoPublicId);
      return serverError("Logo upload failed");
    }
    if (!isOwnedCompanyLogoPublicId(orgId, logoPublicId)) {
      await destroyOwnedLogo(orgId, logoPublicId);
      return serverError("Logo upload returned unexpected public id");
    }

    let profile;
    try {
      const result = await upsertCompanyProfile(actor, {
        logoUrl,
        logoPublicId,
      });
      profile = result.profile;
    } catch (upsertErr) {
      // Do not leave a new random asset if upsert fails. Stable id overwrite
      // may have replaced the prior logo — best-effort note only.
      if (logoPublicId !== previous?.logoPublicId) {
        await destroyOwnedLogo(orgId, logoPublicId);
      }
      throw upsertErr;
    }

    // Legacy timestamped public ids from older uploads — best-effort cleanup.
    // Do not fail the response after a successful DB write.
    if (
      previous?.logoPublicId &&
      previous.logoPublicId !== logoPublicId &&
      previous.logoPublicId !== expectedPublicId
    ) {
      try {
        await destroyOwnedLogo(orgId, previous.logoPublicId);
      } catch (err) {
        console.warn(
          "[company-profile] legacy logo Cloudinary destroy after upload failed:",
          err
        );
      }
    }

    logStaffActivityEntry(actor, {
      action: "Company Logo Updated",
      entityType: "Settings",
      entityId: orgId,
      description: "Updated company profile logo",
      metadata: { hasLogo: true },
      request: req,
    });

    return ok({
      message: "Company logo updated",
      profile,
      logoUrl,
      logoPublicId,
    });
  } catch (err) {
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
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "POST /api/admin/company-profile/logo", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.CompanyProfileWrite,
      })
    );
    if (authRes) return authRes;
    console.error("Company logo upload error:", err);
    return serverError("Failed to upload company logo");
  }
}

/*
 * DELETE /api/admin/company-profile/logo
 * Clears logoUrl/logoPublicId and destroys Cloudinary asset when present.
 */
export async function DELETE(req: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.CompanyProfileWrite, { allowOnDemo: true });
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "DELETE /api/admin/company-profile/logo", {
          permission: P.CompanyProfileWrite,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const orgId = requireActorOrgId(actor);
    await assertOrganizationActive(orgId);

    const { resolveEffectiveParkScope } = await import("@/lib/parkAdminScope");
    const { ForbiddenError } = await import("@/lib/auth/http-error");
    const parkScope = await resolveEffectiveParkScope(actor);
    if (parkScope.parkLocked) {
      throw new ForbiddenError(
        "Park-locked admins cannot edit company profile"
      );
    }

    const previous = await prisma.companyProfile.findUnique({
      where: { orgId },
      select: { logoPublicId: true, orgId: true },
    });

    // No profile row yet — nothing to clear; do not create a blank row.
    if (!previous) {
      const { getOrEmptyCompanyProfile } = await import("@/lib/companyProfile");
      const profile = await getOrEmptyCompanyProfile(orgId);
      return ok({
        message: "Company logo cleared",
        profile,
      });
    }

    // Clear DB first so mailer/invoice/print never keep a dead logo URL.
    // Cloudinary destroy is best-effort after; orphans are recoverable ops work.
    const { profile } = await upsertCompanyProfile(
      { sub: actor.sub, orgId },
      { logoUrl: null, logoPublicId: null }
    );

    try {
      await destroyOwnedLogo(orgId, previous.logoPublicId);
    } catch (err) {
      console.warn(
        "[company-profile] Cloudinary logo destroy after DB clear failed:",
        err
      );
    }

    logStaffActivityEntry(actor, {
      action: "Company Logo Cleared",
      entityType: "Settings",
      entityId: orgId,
      description: "Cleared company profile logo",
      metadata: { hasLogo: false },
      request: req,
    });

    return ok({
      message: "Company logo cleared",
      profile,
    });
  } catch (err) {
    if (
      err instanceof CompanyProfileValidationError ||
      (typeof err === "object" &&
        err !== null &&
        (err as { name?: string }).name === "CompanyProfileValidationError")
    ) {
      return badRequest((err as Error).message);
    }
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "DELETE /api/admin/company-profile/logo", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.CompanyProfileWrite,
      })
    );
    if (authRes) return authRes;
    console.error("Company logo clear error:", err);
    return serverError("Failed to clear company logo");
  }
}
