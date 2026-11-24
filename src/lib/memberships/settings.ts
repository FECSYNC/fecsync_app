/**
 * MembershipSettings — org default + per-location overrides.
 */
import type { Prisma } from "@prisma/client";
import { Prisma as PrismaNS } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import {
  assertMembershipsStaff,
  locationScopeFilter,
  rejectClientOrgFields,
  requireActorVenueInScope,
  LOCATION_OUT_OF_SCOPE,
  type MembershipsActor,
} from "@/lib/memberships/common";
import type { MembershipSettingsDto } from "@/lib/memberships/types";

export { MEMBERSHIP_GRACE_DAYS_WHEN_UNSET } from "@/lib/memberships/types";

function toDto(row: {
  id: string;
  orgId: string;
  locationId: string | null;
  requirePhotoOnRedeem: boolean;
  requireAgreementBeforeActive: boolean;
  dunningEnabled: boolean;
  clickToCancelEnabled: boolean;
  cancelAlternativesEnabled: boolean;
  graceDays: number | null;
  allowPause: boolean;
  walletPassEnabled: boolean;
  defaultHomeLocationId: string | null;
  other: unknown;
  createdAt: Date;
  updatedAt: Date;
}, flags?: { persisted?: boolean; inherited?: boolean }): MembershipSettingsDto {
  return {
    id: row.id,
    orgId: row.orgId,
    locationId: row.locationId,
    requirePhotoOnRedeem: row.requirePhotoOnRedeem,
    requireAgreementBeforeActive: row.requireAgreementBeforeActive,
    dunningEnabled: row.dunningEnabled,
    clickToCancelEnabled: row.clickToCancelEnabled,
    cancelAlternativesEnabled: row.cancelAlternativesEnabled,
    graceDays: row.graceDays,
    allowPause: row.allowPause,
    walletPassEnabled: row.walletPassEnabled,
    defaultHomeLocationId: row.defaultHomeLocationId,
    other:
      row.other && typeof row.other === "object" && !Array.isArray(row.other)
        ? (row.other as Record<string, unknown>)
        : null,
    persisted: flags?.persisted ?? true,
    inherited: flags?.inherited ?? false,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const DEFAULTS = {
  requirePhotoOnRedeem: false,
  requireAgreementBeforeActive: false,
  dunningEnabled: true,
  clickToCancelEnabled: true,
  cancelAlternativesEnabled: true,
  graceDays: null as number | null,
  allowPause: true,
  walletPassEnabled: false,
  defaultHomeLocationId: null as string | null,
  other: null as Record<string, unknown> | null,
};

/** Soft pointer heal: if defaultHome points at an archived/missing venue, clear it. */
async function healDefaultHome(
  orgId: string,
  defaultHomeLocationId: string | null
): Promise<string | null> {
  if (!defaultHomeLocationId) return null;
  const venue = await prisma.venueLocation.findFirst({
    where: { id: defaultHomeLocationId, orgId },
    select: { id: true, status: true },
  });
  if (!venue || venue.status === "archived") return null;
  return venue.id;
}

type SettingsDbRow = NonNullable<
  Awaited<ReturnType<typeof prisma.membershipSettings.findFirst>>
>;

function unsavedSettings(
  orgId: string,
  locationId: string | null,
  inherited: boolean
): MembershipSettingsDto {
  return {
    id: "",
    orgId,
    locationId,
    ...DEFAULTS,
    persisted: false,
    inherited,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

async function loadSettingsRow(
  orgId: string,
  locationId: string | null
): Promise<SettingsDbRow | null> {
  return prisma.membershipSettings.findFirst({
    where: { orgId, locationId },
  });
}

/**
 * Park row when one is saved, otherwise the org-default row.
 * Same rule redeem, billing, dunning, wallet, agreements, and guest cancel use.
 */
export async function loadEffectiveMembershipSettingsRow(
  orgId: string,
  locationId?: string | null,
  tx?: Prisma.TransactionClient
) {
  const db = tx ?? prisma;
  const loc = locationId?.trim() || null;
  if (loc) {
    const venue = await db.membershipSettings.findFirst({
      where: { orgId, locationId: loc },
    });
    if (venue) return venue;
  }
  return db.membershipSettings.findFirst({
    where: { orgId, locationId: null },
  });
}

/**
 * Home park suggested at sell. A saved park row wins even when its home is
 * empty; otherwise the org default is used. Archived pointers heal to null.
 */
export async function resolveDefaultHomeLocationId(
  orgId: string,
  locationId?: string | null
): Promise<string | null> {
  const source = await loadEffectiveMembershipSettingsRow(orgId, locationId);
  return healDefaultHome(orgId, source?.defaultHomeLocationId ?? null);
}

function sanitizeOther(raw: unknown): Prisma.InputJsonValue | null {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("other must be an object or null");
  }
  // Cap nested pollution — Phase 1 stores only small opaque flags.
  let json: string;
  try {
    json = JSON.stringify(raw);
  } catch {
    throw new Error("other must be JSON-serializable");
  }
  if (json.length > 8_000) {
    throw new Error("other payload is too large");
  }
  return raw as Prisma.InputJsonValue;
}

export async function getMembershipSettings(
  actor: MembershipsActor,
  locationId?: string | null
): Promise<MembershipSettingsDto> {
  const orgId = await assertMembershipsStaff(actor);
  let loc: string | null = null;
  if (locationId && locationId.trim()) {
    await requireActorVenueInScope(actor, locationId.trim(), {
      allowArchived: true,
    });
    loc = locationId.trim();
  }

  const venueRow = loc ? await loadSettingsRow(orgId, loc) : null;
  const orgRow = await loadSettingsRow(orgId, null);

  // Park scope with no saved row uses the same loc ?? org resolution as
  // redeem, billing, dunning, wallet, and guest cancel.
  if (loc && !venueRow) {
    if (!orgRow) return unsavedSettings(orgId, loc, true);
    const healedHome = await healDefaultHome(
      orgId,
      orgRow.defaultHomeLocationId
    );
    return toDto(
      {
        ...orgRow,
        id: "",
        locationId: loc,
        defaultHomeLocationId: healedHome,
      },
      { persisted: false, inherited: true }
    );
  }

  const row = loc ? venueRow : orgRow;
  if (!row) return unsavedSettings(orgId, loc, false);

  const healedHome = await healDefaultHome(orgId, row.defaultHomeLocationId);
  // Soft pointer heal is response-only — GET must not mutate (read perm path).
  if (healedHome !== row.defaultHomeLocationId) {
    return toDto(
      { ...row, defaultHomeLocationId: healedHome },
      { persisted: true, inherited: false }
    );
  }
  return toDto(row, { persisted: true, inherited: false });
}

export async function upsertMembershipSettings(
  actor: MembershipsActor,
  body: unknown
): Promise<MembershipSettingsDto> {
  const orgId = await assertMembershipsStaff(actor);
  rejectClientOrgFields(body);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid body");
  }
  const b = body as Record<string, unknown>;

  let locationId: string | null = null;
  if (b.locationId != null && b.locationId !== "") {
    if (typeof b.locationId !== "string" || !isValidId(b.locationId)) {
      throw new Error("locationId is invalid");
    }
    await requireActorVenueInScope(actor, b.locationId);
    locationId = b.locationId;
  }

  // Park-locked: org-default settings are company-wide — require a venue override.
  const scope = await locationScopeFilter(actor);
  if (scope.parkLocked && locationId == null) {
    if (scope.locationId) {
      locationId = scope.locationId;
      await requireActorVenueInScope(actor, locationId);
    } else {
      throw new ForbiddenError(LOCATION_OUT_OF_SCOPE);
    }
  }

  let defaultHomeLocationId: string | null | undefined = undefined;
  if ("defaultHomeLocationId" in b) {
    if (b.defaultHomeLocationId == null || b.defaultHomeLocationId === "") {
      defaultHomeLocationId = null;
    } else if (
      typeof b.defaultHomeLocationId === "string" &&
      isValidId(b.defaultHomeLocationId)
    ) {
      // Active venues only — refuse archived as default home.
      await requireActorVenueInScope(actor, b.defaultHomeLocationId);
      defaultHomeLocationId = b.defaultHomeLocationId;
    } else {
      throw new Error("defaultHomeLocationId is invalid");
    }
  }

  let graceDays: number | null | undefined = undefined;
  if ("graceDays" in b) {
    if (b.graceDays == null || b.graceDays === "") {
      graceDays = null;
    } else {
      const n = Number(b.graceDays);
      if (!Number.isInteger(n) || n < 0 || n > 90) {
        throw new Error("graceDays must be an integer from 0 to 90");
      }
      graceDays = n;
    }
  }

  let otherPatch: Prisma.InputJsonValue | null | undefined = undefined;
  if ("other" in b) {
    otherPatch = sanitizeOther(b.other);
  }

  const row = await prisma.$transaction(async (tx) => {
    const existing = await tx.membershipSettings.findFirst({
      where: { orgId, locationId },
    });

    let resolvedDefaultHome =
      defaultHomeLocationId !== undefined
        ? defaultHomeLocationId
        : (existing?.defaultHomeLocationId ?? null);
    // Drop stale soft pointers that still point at archived/missing venues.
    if (resolvedDefaultHome) {
      const homeVenue = await tx.venueLocation.findFirst({
        where: { id: resolvedDefaultHome, orgId },
        select: { id: true, status: true },
      });
      if (!homeVenue || homeVenue.status === "archived") {
        resolvedDefaultHome = null;
      }
    }

    const data: Prisma.MembershipSettingsUpdateInput = {
      requirePhotoOnRedeem:
        "requirePhotoOnRedeem" in b
          ? Boolean(b.requirePhotoOnRedeem)
          : (existing?.requirePhotoOnRedeem ?? DEFAULTS.requirePhotoOnRedeem),
      requireAgreementBeforeActive:
        "requireAgreementBeforeActive" in b
          ? Boolean(b.requireAgreementBeforeActive)
          : (existing?.requireAgreementBeforeActive ??
            DEFAULTS.requireAgreementBeforeActive),
      dunningEnabled:
        "dunningEnabled" in b
          ? Boolean(b.dunningEnabled)
          : (existing?.dunningEnabled ?? DEFAULTS.dunningEnabled),
      clickToCancelEnabled:
        "clickToCancelEnabled" in b
          ? Boolean(b.clickToCancelEnabled)
          : (existing?.clickToCancelEnabled ?? DEFAULTS.clickToCancelEnabled),
      cancelAlternativesEnabled:
        "cancelAlternativesEnabled" in b
          ? Boolean(b.cancelAlternativesEnabled)
          : (existing?.cancelAlternativesEnabled ??
            DEFAULTS.cancelAlternativesEnabled),
      allowPause:
        "allowPause" in b
          ? Boolean(b.allowPause)
          : (existing?.allowPause ?? DEFAULTS.allowPause),
      walletPassEnabled:
        "walletPassEnabled" in b
          ? Boolean(b.walletPassEnabled)
          : (existing?.walletPassEnabled ?? DEFAULTS.walletPassEnabled),
      graceDays:
        graceDays !== undefined ? graceDays : (existing?.graceDays ?? null),
      defaultHomeLocationId: resolvedDefaultHome,
    };

    if (otherPatch !== undefined) {
      data.other = otherPatch === null ? PrismaNS.DbNull : otherPatch;
    } else if (existing?.other != null) {
      data.other = existing.other as Prisma.InputJsonValue;
    }

    if (existing) {
      return tx.membershipSettings.update({
        where: { id: existing.id },
        data,
      });
    }
    try {
      return await tx.membershipSettings.create({
        data: {
          orgId,
          locationId,
          requirePhotoOnRedeem: data.requirePhotoOnRedeem as boolean,
          requireAgreementBeforeActive:
            data.requireAgreementBeforeActive as boolean,
          dunningEnabled: data.dunningEnabled as boolean,
          clickToCancelEnabled: data.clickToCancelEnabled as boolean,
          cancelAlternativesEnabled:
            data.cancelAlternativesEnabled as boolean,
          allowPause: data.allowPause as boolean,
          walletPassEnabled: data.walletPassEnabled as boolean,
          graceDays: (data.graceDays as number | null) ?? null,
          defaultHomeLocationId:
            (data.defaultHomeLocationId as string | null) ?? null,
          other:
            otherPatch === null
              ? undefined
              : ((otherPatch ?? undefined) as
                  | Prisma.InputJsonValue
                  | undefined),
        },
      });
    } catch (err) {
      // Concurrent org-default create races the partial unique index — retry update.
      if (
        err instanceof PrismaNS.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        const raced = await tx.membershipSettings.findFirst({
          where: { orgId, locationId },
        });
        if (!raced) throw err;
        return tx.membershipSettings.update({
          where: { id: raced.id },
          data,
        });
      }
      throw err;
    }
  });

  logStaffActivityEntry(actor, {
    action: "membership_settings.upsert",
    entityType: "MembershipSettings",
    entityId: row.id,
    description: `Updated membership settings${locationId ? " (venue)" : " (org default)"}`,
    metadata: { locationId },
  });

  return toDto(row);
}
