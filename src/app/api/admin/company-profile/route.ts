import { NextRequest } from "next/server";
import {
  ok,
  badRequest,
  serverError,
  authErrorToResponse,
  authAudit,
  errorResponse,
} from "@/lib/response";
import {
  requireAuthFresh,
  requirePermissionFresh,
} from "@/lib/middleware/requireAuth";
import { P, hasAnyPermission, hasPermission } from "@/lib/auth/permissions";
import { isPlainObject } from "@/lib/catalogWrite";
import { requireActorOrgId } from "@/lib/staffOrg";
import {
  assertOrganizationActive,
  assertOrganizationAllowsWorkspaceLifecycle,
  updateOrganizationSlug,
} from "@/lib/org";
import {
  CompanyProfileValidationError,
  getOrEmptyCompanyProfile,
  toPrintSafeCompanyProfile,
  upsertCompanyProfile,
  type UpsertCompanyProfileInput,
} from "@/lib/companyProfile";
import { CompanyProfileCryptoError } from "@/lib/companyProfileCrypto";
import {
  assertAllowedPublicProfileKeys,
  parseEmbedOriginList,
} from "@/lib/publicCategory/origins";
import { assertNotDemoPlanLocked } from "@/lib/demoPlanAssert";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import prisma from "@/lib/prisma";
import { ForbiddenError } from "@/lib/auth/http-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/*
 * Company Profile — GET|PUT /api/admin/company-profile
 * GET: company_profile:read (soft-hold OK; settings:manage implies) OR orders:read|manage Active-only
 *      (print/invoice brand; bank last4 only).
 * PUT: company_profile:write. Never accept body.orgId as authority.
 * Bank ciphertext never returned; last4 + hasBankAccount + hasBankRoutingOrIban
 * (routing/IBAN write-only — never plaintext on GET).
 */

function isValidationError(err: unknown): err is CompanyProfileValidationError {
  return (
    err instanceof CompanyProfileValidationError ||
    (typeof err === "object" &&
      err !== null &&
      (err as { name?: string }).name === "CompanyProfileValidationError")
  );
}

function pickString(
  body: Record<string, unknown>,
  key: string
): string | null | undefined {
  if (!(key in body)) return undefined;
  const v = body[key];
  if (v === null) return null;
  if (typeof v === "string") return v;
  throw new CompanyProfileValidationError(`${key} must be a string or null`);
}

function pickBool(
  body: Record<string, unknown>,
  key: string
): boolean | undefined {
  if (!(key in body)) return undefined;
  const v = body[key];
  if (typeof v !== "boolean") {
    throw new CompanyProfileValidationError(`${key} must be a boolean`);
  }
  return v;
}

/** Orders staff may read print-safe brand; soft-hold does not unlock this path. */
const COMPANY_PROFILE_ORDERS_READ = [P.OrdersRead, P.OrdersManage] as const;

export async function GET(req: NextRequest) {
  let actor;
  let canManageSettings = false;
  try {
    // Soft-hold exception is only for settings:manage (export/offboard UI).
    // Orders print brand stays on Active Fresh — no soft-hold bypass.
    // Single authz pass so hard-suspend settings admins keep the org error
    // (not a misleading "missing orders permission" from a fallback).
    actor = await requireAuthFresh(req, { allowSuspendedOrg: true });
    canManageSettings = hasPermission(
      actor.permissions,
      P.CompanyProfileRead
    );
    const canOrders = hasAnyPermission(
      actor.permissions,
      COMPANY_PROFILE_ORDERS_READ
    );
    if (!canManageSettings && !canOrders) {
      throw new ForbiddenError("Missing required permission");
    }
    if (actor.orgId) {
      if (canManageSettings) {
        await assertOrganizationAllowsWorkspaceLifecycle(actor.orgId);
      } else {
        await assertOrganizationActive(actor.orgId);
      }
    }
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "GET /api/admin/company-profile", {
          permission: P.CompanyProfileRead,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const orgId = requireActorOrgId(actor);
    // Full company profile (bank, lifecycle) is HQ-only. Orders print brand
    // still uses toPrintSafeCompanyProfile for non-settings actors.
    if (canManageSettings) {
      const { assertNotParkLockedCompanyHq } = await import(
        "@/lib/assertNotParkLockedCompanyHq"
      );
      await assertNotParkLockedCompanyHq(
        actor,
        "Park-locked admins cannot access company profile HQ data"
      );
    }
    const profile = await getOrEmptyCompanyProfile(orgId);
    let workspaceLifecycle: {
      offboardRequestedAt: string | null;
      offboardedAt: string | null;
    } | null = null;
    if (canManageSettings) {
      const orgRow = await prisma.organization.findUnique({
        where: { id: orgId },
        select: {
          isDefault: true,
          offboardRequestedAt: true,
          offboardedAt: true,
        },
      });
      if (orgRow && !orgRow.isDefault) {
        workspaceLifecycle = {
          offboardRequestedAt:
            orgRow.offboardRequestedAt?.toISOString() ?? null,
          offboardedAt: orgRow.offboardedAt?.toISOString() ?? null,
        };
      }
    }
    return ok({
      profile: canManageSettings
        ? profile
        : toPrintSafeCompanyProfile(profile),
      ...(workspaceLifecycle ? { workspaceLifecycle } : {}),
    });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "GET /api/admin/company-profile", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.CompanyProfileRead,
      })
    );
    if (authRes) return authRes;
    if (
      err instanceof CompanyProfileCryptoError ||
      (typeof err === "object" &&
        err !== null &&
        (err as { name?: string }).name === "CompanyProfileCryptoError")
    ) {
      return errorResponse((err as Error).message, 503);
    }
    console.error("Error fetching company profile:", err);
    return serverError("Failed to fetch company profile");
  }
}

export async function PUT(req: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.CompanyProfileWrite, { allowOnDemo: true });
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "PUT /api/admin/company-profile", {
          permission: P.CompanyProfileWrite,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON");
  }
  if (!isPlainObject(body)) {
    return badRequest("Invalid JSON");
  }

  try {
    // Never trust client orgId / audit / logo / ciphertext fields.
    // Logo / sign-in background URL+publicId are set only via POST/DELETE
    // —/logo and —/signin-background.
    void body.orgId;
    void body.organizationId;
    void body.bankAccountCiphertext;
    assertAllowedPublicProfileKeys(body);
    void body.logoUrl;
    void body.logoPublicId;
    void body.signinBackgroundUrl;
    void body.signinBackgroundPublicId;
    void body.createdBy;
    void body.updatedBy;

    const { resolveEffectiveParkScope } = await import("@/lib/parkAdminScope");
    const parkScope = await resolveEffectiveParkScope(actor);
    if (parkScope.parkLocked) {
      throw new ForbiddenError(
        "Park-locked admins cannot edit company profile"
      );
    }

    const input: UpsertCompanyProfileInput = {
      legalName: pickString(body, "legalName"),
      tradingName: pickString(body, "tradingName"),
      supportEmail: pickString(body, "supportEmail"),
      billingEmail: pickString(body, "billingEmail"),
      replyToEmail: pickString(body, "replyToEmail"),
      phone: pickString(body, "phone"),
      website: pickString(body, "website"),
      addressLine1: pickString(body, "addressLine1"),
      addressLine2: pickString(body, "addressLine2"),
      city: pickString(body, "city"),
      state: pickString(body, "state"),
      country: pickString(body, "country"),
      postalCode: pickString(body, "postalCode"),
      taxId: pickString(body, "taxId"),
      bankName: pickString(body, "bankName"),
      bankAccountName: pickString(body, "bankAccountName"),
      bankAccountNumber: pickString(body, "bankAccountNumber"),
      bankRoutingOrIban: pickString(body, "bankRoutingOrIban"),
      bankCurrency: pickString(body, "bankCurrency"),
      clearBank: pickBool(body, "clearBank"),
      invoiceFooterNote: pickString(body, "invoiceFooterNote"),
      receiptFooterNote: pickString(body, "receiptFooterNote"),
      letterheadColor: pickString(body, "letterheadColor"),
      publicLogo: pickBool(body, "publicLogo"),
      publicPhone: pickBool(body, "publicPhone"),
      publicSupportEmail: pickBool(body, "publicSupportEmail"),
      publicWebsite: pickBool(body, "publicWebsite"),
      publicAddress: pickBool(body, "publicAddress"),
      embedOrigins:
        "embedOrigins" in body ? body.embedOrigins : undefined,
    };

    const orgId = requireActorOrgId(actor);
    const touchesPublicVisibility =
      input.publicLogo !== undefined ||
      input.publicPhone !== undefined ||
      input.publicSupportEmail !== undefined ||
      input.publicWebsite !== undefined ||
      input.publicAddress !== undefined ||
      input.embedOrigins !== undefined;
    // Reject public-field writes before the workspace slug is committed.
    // A later profile failure must not leave the company URL changed.
    if (touchesPublicVisibility) {
      await assertNotDemoPlanLocked(orgId);
    }
    if (input.embedOrigins !== undefined) {
      parseEmbedOriginList(input.embedOrigins);
    }
    const slugInput = pickString(body, "organizationSlug");
    let slugWrote = false;
    if (typeof slugInput === "string" && slugInput.trim()) {
      try {
        const result = await updateOrganizationSlug(orgId, slugInput);
        slugWrote = result.changed;
      } catch (slugErr) {
        const msg =
          slugErr instanceof Error ? slugErr.message : "Invalid organization slug";
        return badRequest(msg);
      }
    }

    const { profile, wrote } = await upsertCompanyProfile(actor, input);

    if (wrote || slugWrote) {
      logStaffActivityEntry(actor, {
        action: "Company Profile Updated",
        entityType: "Settings",
        entityId: profile.orgId,
        description: slugWrote
          ? "Updated company profile / workspace slug"
          : "Updated company profile",
        metadata: {
          completeness: profile.completeness,
          hasLogo: Boolean(profile.logoUrl),
          hasBankAccount: profile.hasBankAccount,
          slugUpdated: slugWrote,
          ...(input.embedOrigins !== undefined
            ? { embedOrigins: profile.embedOrigins }
            : {}),
          publicFields: {
            logo: profile.publicLogo,
            phone: profile.publicPhone,
            supportEmail: profile.publicSupportEmail,
            website: profile.publicWebsite,
            address: profile.publicAddress,
          },
          // Never log bank account numbers / ciphertext.
        },
        request: req,
      });
    }

    return ok({
      message:
        wrote || slugWrote
          ? "Company profile updated successfully"
          : "Company profile unchanged",
      profile,
      wrote: wrote || slugWrote,
    });
  } catch (err) {
    if (isValidationError(err)) {
      return badRequest(err.message);
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
      authAudit(req, "PUT /api/admin/company-profile", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.CompanyProfileWrite,
      })
    );
    if (authRes) return authRes;
    console.error("Error updating company profile:", err);
    return serverError("Failed to update company profile");
  }
}
