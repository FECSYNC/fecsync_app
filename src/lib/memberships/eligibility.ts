/**
 * MembershipVenueEligibility matrix helpers (Feature 08 Phase 1).
 * Park-locked actors may only replace rows for assigned parks; other parks
 * are preserved so a scoped PUT cannot wipe company-wide eligibility.
 */
import type { Prisma } from "@prisma/client";
import { Prisma as PrismaNS } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isValidId, requireId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import {
  assertMembershipsStaff,
  locationScopeFilter,
  rejectClientOrgFields,
  requireActorVenueInScope,
  assertLocationInMembershipScope,
  LOCATION_OUT_OF_SCOPE,
  PLAN_NOT_FOUND,
  type MembershipsActor,
} from "@/lib/memberships/common";
import { assertCanMutateMembershipPlan } from "@/lib/memberships/plans";
import type { MembershipVenueEligibilityDto } from "@/lib/memberships/types";

function sanitizeLocalPerks(
  raw: unknown,
  field: string
): Prisma.InputJsonValue | undefined {
  if (raw == null) return undefined;
  if (Array.isArray(raw)) {
    const flags = raw
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 50);
    return flags as Prisma.InputJsonValue;
  }
  if (typeof raw === "object") {
    const json = JSON.stringify(raw);
    if (json.length > 4_000) {
      throw new Error(`${field} payload is too large`);
    }
    return raw as Prisma.InputJsonValue;
  }
  throw new Error(`${field} must be an array or object`);
}

function toDto(row: {
  id: string;
  orgId: string;
  planId: string;
  locationId: string;
  eligible: boolean;
  localPerksAdd: unknown;
  localPerksRemove: unknown;
  createdAt: Date;
  updatedAt: Date;
}): MembershipVenueEligibilityDto {
  return {
    id: row.id,
    orgId: row.orgId,
    planId: row.planId,
    locationId: row.locationId,
    eligible: row.eligible,
    localPerksAdd: row.localPerksAdd ?? null,
    localPerksRemove: row.localPerksRemove ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listMembershipEligibility(
  actor: MembershipsActor,
  opts?: { planId?: string }
): Promise<MembershipVenueEligibilityDto[]> {
  const orgId = await assertMembershipsStaff(actor);
  const scope = await locationScopeFilter(actor);
  const where: Prisma.MembershipVenueEligibilityWhereInput = { orgId };
  if (opts?.planId) {
    const planId = requireId(opts.planId, "planId");
    const plan = await prisma.membershipPlan.findFirst({
      where: { id: planId, orgId },
      select: { id: true, locationId: true },
    });
    if (!plan) throw new ForbiddenError(PLAN_NOT_FOUND);
    // Park-stamped plans outside assignment are not readable as a matrix target.
    if (plan.locationId) {
      await assertLocationInMembershipScope(actor, plan.locationId);
    }
    where.planId = planId;
  }
  if (scope.parkLocked) {
    if (scope.locationIds?.length) {
      where.locationId = { in: scope.locationIds };
    } else if (scope.locationId) {
      where.locationId = scope.locationId;
    } else {
      where.id = "__none__";
    }
  } else if (scope.locationId) {
    where.locationId = scope.locationId;
  }
  const rows = await prisma.membershipVenueEligibility.findMany({
    where,
    orderBy: [{ planId: "asc" }, { locationId: "asc" }],
  });
  return rows.map(toDto);
}

/**
 * Replace eligibility rows for a plan.
 * Body: { planId, rows: [{ locationId, eligible, localPerksAdd?, localPerksRemove? }] }
 * Company-wide: full replace for the plan.
 * Park-locked / HQ-scoped: replace only in-scope parks; preserve out-of-scope rows.
 */
export async function putMembershipEligibility(
  actor: MembershipsActor,
  body: unknown
): Promise<MembershipVenueEligibilityDto[]> {
  const orgId = await assertMembershipsStaff(actor);
  const scope = await locationScopeFilter(actor);
  rejectClientOrgFields(body);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid body");
  }
  const b = body as Record<string, unknown>;
  if (typeof b.planId !== "string" || !isValidId(b.planId)) {
    throw new Error("planId is required");
  }
  const planId = b.planId;
  const plan = await prisma.membershipPlan.findFirst({
    where: { id: planId, orgId },
  });
  if (!plan) throw new ForbiddenError(PLAN_NOT_FOUND);
  await assertCanMutateMembershipPlan(actor, plan);
  if (plan.archivedAt) {
    throw new Error("Cannot edit eligibility for an archived plan");
  }

  if (!Array.isArray(b.rows)) throw new Error("rows must be an array");
  if (b.rows.length > 200) {
    throw new Error("rows cannot exceed 200 venues per save");
  }

  type RowIn = {
    locationId: string;
    eligible: boolean;
    localPerksAdd: Prisma.InputJsonValue | undefined;
    localPerksRemove: Prisma.InputJsonValue | undefined;
  };
  const parsed: RowIn[] = [];
  const seen = new Set<string>();

  for (const raw of b.rows) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("each row must be an object");
    }
    const r = raw as Record<string, unknown>;
    if (typeof r.locationId !== "string" || !isValidId(r.locationId)) {
      throw new Error("locationId is required on each row");
    }
    if (seen.has(r.locationId)) {
      throw new Error("duplicate locationId in rows");
    }
    seen.add(r.locationId);
    // Active venues only — soft-archive already clears eligibility for closed parks.
    await requireActorVenueInScope(actor, r.locationId);
    parsed.push({
      locationId: r.locationId,
      eligible: r.eligible === undefined ? true : Boolean(r.eligible),
      localPerksAdd: sanitizeLocalPerks(r.localPerksAdd, "localPerksAdd"),
      localPerksRemove: sanitizeLocalPerks(
        r.localPerksRemove,
        "localPerksRemove"
      ),
    });
  }

  // Park-locked with an empty assignment set must fail closed — never fall
  // through to a company-wide delete/replace (would wipe sibling parks).
  let replaceMode: "park" | "hq" | "company" = "company";
  let replaceLocationIds: string[] = [];
  if (scope.parkLocked) {
    replaceLocationIds =
      scope.locationIds?.length
        ? scope.locationIds
        : scope.locationId
          ? [scope.locationId]
          : [];
    if (replaceLocationIds.length === 0) {
      throw new ForbiddenError(LOCATION_OUT_OF_SCOPE);
    }
    replaceMode = "park";
  } else if (scope.locationId) {
    replaceLocationIds = [scope.locationId];
    replaceMode = "hq";
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        if (replaceMode === "company") {
          await tx.membershipVenueEligibility.deleteMany({
            where: { orgId, planId },
          });
        } else {
          await tx.membershipVenueEligibility.deleteMany({
            where: {
              orgId,
              planId,
              locationId: { in: replaceLocationIds },
            },
          });
        }
        if (parsed.length === 0) return;
        await tx.membershipVenueEligibility.createMany({
          data: parsed.map((r) => ({
            orgId,
            planId,
            locationId: r.locationId,
            eligible: r.eligible,
            localPerksAdd: r.localPerksAdd ?? undefined,
            localPerksRemove: r.localPerksRemove ?? undefined,
          })),
        });
      },
      { maxWait: 10_000, timeout: 15_000 }
    );
  } catch (err) {
    if (
      err instanceof PrismaNS.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw new Error("Eligibility update conflict — retry");
    }
    throw err;
  }

  logStaffActivityEntry(actor, {
    action: "membership_eligibility.put",
    entityType: "MembershipVenueEligibility",
    entityId: planId,
    description: `Updated membership eligibility for plan (${parsed.length} venues)`,
    metadata: {
      planId,
      rowCount: parsed.length,
      replaceMode,
    },
  });

  return listMembershipEligibility(actor, { planId });
}
