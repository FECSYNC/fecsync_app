/**
 * Capacity resources CRUD.
 */
import type { CapacityResourceType, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isValidId, requireId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import {
  assertTicketingStaffMutate,
  assertTicketingStaffRead,
  assertLocationInHqScope,
  assertVenueActiveForTicketingMutate,
  locationScopeFilter,
  applyTicketingLocationScope,
  rejectClientOrgFields,
  requireActorVenue,
  RESOURCE_NOT_FOUND,
  LOCATION_REQUIRED,
  type TicketingActor,
} from "@/lib/ticketing/common";

const RESOURCE_TYPES = new Set<string>([
  "attraction",
  "session",
  "room",
  "lane",
  "party_room",
  "other",
]);

export type CreateResourceInput = {
  name: string;
  type: CapacityResourceType;
  locationId: string;
  defaultCapacity: number;
};

function requireName(raw: unknown): string {
  if (typeof raw !== "string") throw new Error("Name is required");
  const name = raw.trim();
  if (name.length < 2) throw new Error("Name is required");
  if (name.length > 160) throw new Error("Name is too long");
  return name;
}

function requireCapacity(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 2_147_483_647) {
    throw new Error("defaultCapacity must be a non-negative integer");
  }
  return n;
}

function requireType(raw: unknown): CapacityResourceType {
  if (typeof raw !== "string" || !RESOURCE_TYPES.has(raw)) {
    throw new Error("Invalid resource type");
  }
  return raw as CapacityResourceType;
}

export function toResourceDto(row: {
  id: string;
  orgId: string;
  locationId: string;
  name: string;
  type: CapacityResourceType;
  defaultCapacity: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  location?: { id: string; name: string; slug: string } | null;
}) {
  return {
    id: row.id,
    orgId: row.orgId,
    locationId: row.locationId,
    name: row.name,
    type: row.type,
    defaultCapacity: row.defaultCapacity,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    location: row.location ?? null,
  };
}

export async function listCapacityResources(
  actor: TicketingActor,
  opts: { includeArchived?: boolean; locationId?: string } = {}
) {
  await assertTicketingStaffRead(actor);
  const scope = await locationScopeFilter(actor);
  const where: Prisma.CapacityResourceWhereInput = { orgId: scope.orgId };
  applyTicketingLocationScope(scope, where);
  if (
    !scope.parkLocked &&
    !scope.locationId &&
    opts.locationId !== undefined &&
    opts.locationId !== ""
  ) {
    if (!isValidId(opts.locationId)) {
      throw new Error("Invalid locationId");
    }
    where.locationId = opts.locationId;
  }
  if (!opts.includeArchived) where.archivedAt = null;

  const rows = await prisma.capacityResource.findMany({
    where,
    include: { location: { select: { id: true, name: true, slug: true } } },
    orderBy: { name: "asc" },
  });
  return rows.map(toResourceDto);
}

export async function createCapacityResource(
  actor: TicketingActor,
  input: CreateResourceInput
) {
  const orgId = await assertTicketingStaffMutate(actor);
  if (!input.locationId || !isValidId(input.locationId)) {
    throw new Error(LOCATION_REQUIRED);
  }
  const venue = await requireActorVenue(orgId, input.locationId);
  await assertLocationInHqScope(actor, venue.id);

  const row = await prisma.capacityResource.create({
    data: {
      orgId,
      locationId: venue.id,
      name: requireName(input.name),
      type: requireType(input.type),
      defaultCapacity: requireCapacity(input.defaultCapacity),
    },
    include: { location: { select: { id: true, name: true, slug: true } } },
  });
  return toResourceDto(row);
}

export async function updateCapacityResource(
  actor: TicketingActor,
  resourceId: string,
  patch: Partial<CreateResourceInput> & { archive?: boolean; unarchive?: boolean }
) {
  const orgId = await assertTicketingStaffMutate(actor);
  const existing = await prisma.capacityResource.findFirst({
    where: { id: requireId(resourceId, "resourceId"), orgId },
  });
  if (!existing) throw new ForbiddenError(RESOURCE_NOT_FOUND);
  await assertLocationInHqScope(actor, existing.locationId);
  await assertVenueActiveForTicketingMutate(orgId, existing.locationId, {
    allowArchived: Boolean(patch.archive) || Boolean(existing.archivedAt),
  });

  const data: Prisma.CapacityResourceUpdateInput = {};
  if (patch.name !== undefined) data.name = requireName(patch.name);
  if (patch.type !== undefined) {
    const nextType = requireType(patch.type);
    if (nextType !== existing.type) {
      const partyRefs = await prisma.admissionProduct.count({
        where: {
          orgId,
          resourceId: existing.id,
          type: "party_package",
          archivedAt: null,
        },
      });
      if (partyRefs > 0 && nextType !== "room" && nextType !== "party_room") {
        throw new Error(
          "Cannot change type — linked party packages require a room / party_room resource"
        );
      }
    }
    data.type = nextType;
  }
  if (patch.defaultCapacity !== undefined) {
    data.defaultCapacity = requireCapacity(patch.defaultCapacity);
  }
  if (patch.archive) {
    const [productRefs, openSessions] = await Promise.all([
      prisma.admissionProduct.count({
        where: {
          orgId,
          resourceId: existing.id,
          archivedAt: null,
        },
      }),
      prisma.ticketSession.count({
        where: {
          orgId,
          resourceId: existing.id,
          isClosed: false,
        },
      }),
    ]);
    if (productRefs > 0 || openSessions > 0) {
      throw new Error(
        "Cannot archive a resource still linked to active products or open sessions"
      );
    }
    data.archivedAt = new Date();
  } else if (patch.unarchive) {
    data.archivedAt = null;
  }

  const row = await prisma.capacityResource.update({
    where: { id: existing.id },
    data,
    include: { location: { select: { id: true, name: true, slug: true } } },
  });
  return toResourceDto(row);
}

export function parseCreateResourceBody(body: unknown): CreateResourceInput {
  if (!body || typeof body !== "object") throw new Error("Invalid JSON");
  const b = body as Record<string, unknown>;
  rejectClientOrgFields(b);
  return {
    name: requireName(b.name),
    type: requireType(b.type ?? "other"),
    locationId: String(b.locationId ?? ""),
    defaultCapacity: requireCapacity(b.defaultCapacity ?? 0),
  };
}
