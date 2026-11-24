import prisma from "@/lib/prisma";
import { ForbiddenError } from "@/lib/auth/http-error";
import { requireId, isValidId } from "@/lib/ids";
import { requireActorOrgId } from "@/lib/staffOrg";
import { assertPosEnabled } from "@/lib/pos/assertPosEnabled";
import {
  actorLocationScope,
  type ActorLocationScopeActor,
} from "@/lib/actorLocationScope";
import {
  assertActorCanAccessLocation,
  venueStampedResourceFilter,
} from "@/lib/parkAdminScope";
import { rejectClientOrgFields } from "@/lib/memberships/common";

export type PosActor = ActorLocationScopeActor & {
  orgId?: string | null;
  sub?: string | null;
};

export async function assertPosStaff(actor: PosActor): Promise<string> {
  const orgId = requireActorOrgId(actor);
  await assertPosEnabled(orgId);
  return orgId;
}

export function rejectPosClientOrg(body: unknown): void {
  rejectClientOrgFields(body);
}

export async function requirePosVenue(actor: PosActor, locationId: string) {
  const orgId = await assertPosStaff(actor);
  if (!isValidId(locationId)) {
    throw new ForbiddenError("Venue location is required");
  }
  const venue = await prisma.venueLocation.findFirst({
    where: { id: locationId, orgId, status: "active" },
  });
  if (!venue) throw new ForbiddenError("Venue location not found");
  await assertActorCanAccessLocation(actor, locationId);
  return { orgId, venue };
}

export async function posListLocationWhere(actor: PosActor) {
  const orgId = await assertPosStaff(actor);
  const scope = await actorLocationScope(actor);
  return {
    orgId,
    ...venueStampedResourceFilter(scope, "locationId"),
  };
}

export function actorUserId(actor: PosActor): string {
  const id = actor.sub ? String(actor.sub) : "";
  if (!isValidId(id)) throw new ForbiddenError("Staff user is required");
  return requireId(id, "userId");
}
