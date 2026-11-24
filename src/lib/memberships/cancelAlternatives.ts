/**
 * Cancel alternatives (beta) — Feature 08 Phase 4.
 * Offers shown before final click-to-cancel; accept runs billingEngine paths.
 */
import type { MembershipCancelAlternative } from "@prisma/client";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isValidId, requireId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import {
  assertMembershipsStaff,
  rejectClientOrgFields,
  type MembershipsActor,
} from "@/lib/memberships/common";
import {
  MembershipBillingError,
  MembershipErrorCodes,
} from "@/lib/memberships/errors";
import {
  pauseMembership,
  downgradeMembership,
  applyCredit,
} from "@/lib/memberships/billingEngine";

export type CancelAlternativeDto = {
  id: string;
  orgId: string;
  locationId: string | null;
  name: string;
  kind: string;
  config: Record<string, unknown>;
  active: boolean;
  sortOrder: number;
};

function toDto(row: MembershipCancelAlternative): CancelAlternativeDto {
  const config =
    row.config && typeof row.config === "object" && !Array.isArray(row.config)
      ? (row.config as Record<string, unknown>)
      : {};
  return {
    id: row.id,
    orgId: row.orgId,
    locationId: row.locationId,
    name: row.name,
    kind: row.kind,
    config,
    active: row.active,
    sortOrder: row.sortOrder,
  };
}

export async function listActiveCancelAlternatives(
  orgId: string,
  locationId?: string | null
): Promise<CancelAlternativeDto[]> {
  const id = requireId(orgId, "orgId");
  const rows = await prisma.membershipCancelAlternative.findMany({
    where: {
      orgId: id,
      active: true,
      OR: locationId
        ? [{ locationId: null }, { locationId }]
        : [{ locationId: null }],
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    take: 20,
  });
  return rows.map(toDto);
}

export async function listCancelAlternativesAdmin(
  actor: MembershipsActor,
  locationId?: string | null
): Promise<CancelAlternativeDto[]> {
  const orgId = await assertMembershipsStaff(actor);
  const where: Prisma.MembershipCancelAlternativeWhereInput = { orgId };
  if (locationId) {
    if (!isValidId(locationId)) throw new Error("locationId is invalid");
    where.OR = [{ locationId: null }, { locationId }];
  }
  const rows = await prisma.membershipCancelAlternative.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    take: 50,
  });
  return rows.map(toDto);
}

export async function upsertCancelAlternative(
  actor: MembershipsActor,
  body: unknown
): Promise<CancelAlternativeDto> {
  const orgId = await assertMembershipsStaff(actor);
  rejectClientOrgFields(body);
  const rec =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const name = String(rec.name || "").trim().slice(0, 120);
  if (!name) throw new Error("name is required");
  const kind = String(rec.kind || "").trim();
  const allowed = new Set(["pause_offer", "discount", "downgrade", "message"]);
  if (!allowed.has(kind)) {
    throw new MembershipBillingError(
      MembershipErrorCodes.ALTERNATIVE_INVALID,
      "kind must be pause_offer | discount | downgrade | message"
    );
  }
  const locationId =
    rec.locationId === null || rec.locationId === undefined
      ? null
      : String(rec.locationId);
  if (locationId && !isValidId(locationId)) {
    throw new Error("locationId is invalid");
  }
  const config =
    rec.config && typeof rec.config === "object" && !Array.isArray(rec.config)
      ? (rec.config as Record<string, unknown>)
      : {};
  const sortOrder =
    typeof rec.sortOrder === "number" && Number.isFinite(rec.sortOrder)
      ? Math.floor(rec.sortOrder)
      : 0;
  const active = rec.active !== false;

  const existingId =
    typeof rec.id === "string" && isValidId(rec.id) ? rec.id : null;

  // Fail closed BEFORE update — never mutate another tenant's row then check.
  if (existingId) {
    const owned = await prisma.membershipCancelAlternative.findFirst({
      where: { id: existingId, orgId },
      select: { id: true },
    });
    if (!owned) {
      throw new ForbiddenError("Cancel alternative not found");
    }
  }

  const row = existingId
    ? await prisma.membershipCancelAlternative.update({
        where: { id: existingId },
        data: {
          name,
          kind: kind as MembershipCancelAlternative["kind"],
          locationId,
          config: config as Prisma.InputJsonValue,
          sortOrder,
          active,
        },
      })
    : await prisma.membershipCancelAlternative.create({
        data: {
          orgId,
          name,
          kind: kind as MembershipCancelAlternative["kind"],
          locationId,
          config: config as Prisma.InputJsonValue,
          sortOrder,
          active,
        },
      });

  logStaffActivityEntry(actor, {
    action: existingId
      ? "memberships.cancel_alternative.update"
      : "memberships.cancel_alternative.create",
    // ActivityEntityType has no MembershipCancelAlternative value; audit under settings.
    entityType: "MembershipSettings",
    entityId: row.id,
    description: `${existingId ? "Updated" : "Created"} cancel alternative ${name} (beta)`,
  });

  return toDto(row);
}

export async function acceptCancelAlternative(input: {
  orgId: string;
  guestMembershipId: string;
  alternativeId: string;
  actorUserId: string;
  idempotencyKey: string;
}): Promise<{
  kind: string;
  membershipId: string;
  note?: string;
}> {
  const orgId = requireId(input.orgId, "orgId");
  const alternativeId = requireId(input.alternativeId, "alternativeId");
  const guestMembershipId = requireId(
    input.guestMembershipId,
    "guestMembershipId"
  );

  const alt = await prisma.membershipCancelAlternative.findFirst({
    where: { id: alternativeId, orgId, active: true },
  });
  if (!alt) {
    throw new MembershipBillingError(
      MembershipErrorCodes.ALTERNATIVE_INVALID,
      "Cancel alternative not found or inactive"
    );
  }

  const member = await prisma.guestMembership.findFirst({
    where: { id: guestMembershipId, orgId },
  });
  if (!member) {
    throw new MembershipBillingError(
      MembershipErrorCodes.MEMBER_NOT_FOUND,
      "Guest membership not found"
    );
  }

  // Park-scoped alternatives must match sell/home venue (org-default null OK).
  if (
    alt.locationId != null &&
    alt.locationId !== member.homeLocationId &&
    alt.locationId !== member.locationId
  ) {
    throw new MembershipBillingError(
      MembershipErrorCodes.ALTERNATIVE_INVALID,
      "Cancel alternative is not available for this membership venue"
    );
  }

  const config =
    alt.config && typeof alt.config === "object" && !Array.isArray(alt.config)
      ? (alt.config as Record<string, unknown>)
      : {};

  const key = `${input.idempotencyKey}:alt:${alt.id}`.slice(0, 120);

  if (alt.kind === "pause_offer") {
    if (member.status === "past_due") {
      throw new MembershipBillingError(
        MembershipErrorCodes.INVALID_TRANSITION,
        "Cannot pause a past_due membership — renew or update payment first"
      );
    }
    if (member.status !== "active" && member.status !== "paused") {
      throw new MembershipBillingError(
        MembershipErrorCodes.INVALID_TRANSITION,
        "Pause alternative requires an active membership"
      );
    }
    const result = await pauseMembership({
      orgId,
      membershipId: member.id,
      actorUserId: input.actorUserId,
      reason: `Cancel alternative: ${alt.name}`,
    });
    return {
      kind: alt.kind,
      membershipId: result.membership.id,
      note: "Paused via cancel alternative (beta)",
    };
  }

  if (alt.kind === "downgrade") {
    const newPlanId = String(config.newPlanId || "").trim();
    if (!isValidId(newPlanId)) {
      throw new MembershipBillingError(
        MembershipErrorCodes.ALTERNATIVE_INVALID,
        "downgrade alternative requires config.newPlanId"
      );
    }
    const result = await downgradeMembership({
      orgId,
      membershipId: member.id,
      newPlanId,
      actorUserId: input.actorUserId,
      idempotencyKey: key,
    });
    return {
      kind: alt.kind,
      membershipId: result.membership.id,
      note: result.note ?? "Downgraded via cancel alternative (beta)",
    };
  }

  if (alt.kind === "discount") {
    const creditMajor = Number(config.creditMajor ?? config.amountMajor ?? 0);
    if (!Number.isFinite(creditMajor) || creditMajor <= 0) {
      throw new MembershipBillingError(
        MembershipErrorCodes.ALTERNATIVE_INVALID,
        "discount alternative requires config.creditMajor > 0"
      );
    }
    await applyCredit({
      orgId,
      membershipId: member.id,
      actorUserId: input.actorUserId,
      amountMajor: creditMajor,
      reason: `Cancel alternative discount: ${alt.name}`,
      idempotencyKey: key,
    });
    return {
      kind: alt.kind,
      membershipId: member.id,
      note: `Applied ${creditMajor} credit via cancel alternative (beta)`,
    };
  }

  // message — soft retention only; guest must still cancel if they decline later
  return {
    kind: alt.kind,
    membershipId: member.id,
    note:
      typeof config.message === "string"
        ? config.message.slice(0, 500)
        : alt.name,
  };
}
