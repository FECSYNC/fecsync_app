import { NextRequest } from "next/server";
import {
  ok,
  badRequest,
  serverError,
  authErrorToResponse,
  authAudit,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { PAYMENT_POLICY } from "@/lib/auth/permissions";
import { isPlainObject } from "@/lib/catalogWrite";
import {
  afterTaxSettingsSaved,
  getOrCreateTaxSettings,
  toStaffTaxSettings,
} from "@/lib/taxSettings";
import prisma from "@/lib/prisma";
import { normalizeTaxRate } from "@/utils/tax";
import { requireActorOrgId } from "@/lib/staffOrg";
import { stampCreate, stampUpdate } from "@/lib/audit/recordAudit";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/*
 * Step 5.3 — GET/PUT /api/admin/tax-settings → tax:manage on actor.orgId.
 * Public checkout copy is GET /api/tax-settings (storefront org).
 */

export async function GET(req: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, PAYMENT_POLICY.tax.staffManage);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "GET /api/admin/tax-settings", {
          permission: PAYMENT_POLICY.tax.staffManage,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const orgId = requireActorOrgId(actor);
    const { assertNotParkLockedCompanyHq } = await import(
      "@/lib/assertNotParkLockedCompanyHq"
    );
    await assertNotParkLockedCompanyHq(actor);
    const settings = await getOrCreateTaxSettings(orgId);
    return ok({ settings: toStaffTaxSettings(settings) });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "GET /api/admin/tax-settings", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: PAYMENT_POLICY.tax.staffManage,
      })
    );
    if (authRes) return authRes;
    console.error("Error fetching tax settings:", err);
    return serverError("Failed to fetch tax settings");
  }
}

export async function PUT(req: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, PAYMENT_POLICY.tax.staffManage);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "PUT /api/admin/tax-settings", {
          permission: PAYMENT_POLICY.tax.staffManage,
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
    const orgId = requireActorOrgId(actor);
    const { assertNotParkLockedCompanyHq } = await import(
      "@/lib/assertNotParkLockedCompanyHq"
    );
    await assertNotParkLockedCompanyHq(actor);

    const enabled =
      typeof body.enabled === "boolean" ? body.enabled : undefined;
    let rate: number | undefined;
    if (body.rate !== undefined && body.rate !== null) {
      if (
        typeof body.rate === "boolean" ||
        typeof body.rate === "object"
      ) {
        return badRequest("rate must be a number between 0 and 100");
      }
      const parsed = Number(body.rate);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        return badRequest("rate must be a number between 0 and 100");
      }
      rate = normalizeTaxRate(parsed);
    }
    const label =
      typeof body.label === "string" ? body.label.trim() || "Tax" : undefined;

    if (enabled === undefined && rate === undefined && label === undefined) {
      return badRequest("Provide enabled, rate, and/or label to update");
    }

    // Never trust client audit fields.
    void body.createdBy;
    void body.createdByName;
    void body.updatedBy;
    void body.updatedByName;

    const settings = await prisma.$transaction(async (tx) => {
      let row = await tx.taxSettings.findUnique({
        where: { orgId: String(orgId) },
      });

      if (!row) {
        const audit = await stampCreate(actor.sub);
        row = await tx.taxSettings.create({
          data: {
            orgId: String(orgId),
            enabled: enabled ?? false,
            rate: rate ?? 0,
            label: label ?? "Tax",
            createdById: audit.createdBy,
            createdByName: audit.createdByName,
            updatedById: audit.updatedBy,
            updatedByName: audit.updatedByName,
          },
        });
      } else {
        const data: {
          enabled?: boolean;
          rate?: number;
          label?: string;
          createdById?: string;
          createdByName?: string;
          updatedById?: string;
          updatedByName?: string;
        } = {};
        if (enabled !== undefined) data.enabled = enabled;
        if (rate !== undefined) data.rate = rate;
        if (label !== undefined) data.label = label;
        if (!row.createdById) {
          const audit = await stampCreate(actor.sub);
          data.createdById = audit.createdBy;
          data.createdByName = audit.createdByName;
          data.updatedById = audit.updatedBy;
          data.updatedByName = audit.updatedByName;
        } else {
          const audit = await stampUpdate(actor.sub);
          data.updatedById = audit.updatedBy;
          data.updatedByName = audit.updatedByName;
        }
        row = await tx.taxSettings.update({
          where: { id: row.id },
          data,
        });
      }

      // S1-G11: TaxCode sync in the same transaction as the TaxSettings write.
      await afterTaxSettingsSaved(String(orgId), tx);
      return row;
    });

    logStaffActivityEntry(actor, {
      action: "Tax Settings Updated",
      entityType: "Settings",
      entityId: settings.id,
      description: "Updated tax settings",
      request: req,
    });

    return ok({
      message: "Tax settings updated successfully",
      settings: toStaffTaxSettings({
        enabled: Boolean(settings.enabled),
        rate: normalizeTaxRate(settings.rate),
        label: settings.label?.trim() || "Tax",
        createdByName: settings.createdByName,
        updatedByName: settings.updatedByName,
        createdAt: settings.createdAt,
        updatedAt: settings.updatedAt,
      }),
    });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "PUT /api/admin/tax-settings", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: PAYMENT_POLICY.tax.staffManage,
      })
    );
    if (authRes) return authRes;
    console.error("Error updating tax settings:", err);
    return serverError("Failed to update tax settings");
  }
}
