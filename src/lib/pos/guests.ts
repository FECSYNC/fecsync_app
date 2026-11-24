import prisma from "@/lib/prisma";
import { PosError } from "@/lib/pos/errors";
import { actorUserId, posListLocationWhere, requirePosVenue, type PosActor } from "@/lib/pos/scope";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";

function guestDto(row: {
  id: string;
  orgId: string;
  locationId: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  postalCode: string | null;
  photoUrl: string | null;
  bannedAt: Date | null;
  bannedReason: string | null;
}) {
  return {
    id: row.id,
    orgId: row.orgId,
    locationId: row.locationId,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone,
    postalCode: row.postalCode,
    photoUrl: row.photoUrl,
    bannedAt: row.bannedAt?.toISOString() ?? null,
    bannedReason: row.bannedReason,
  };
}

export async function searchPosGuests(actor: PosActor, q: string) {
  const where = await posListLocationWhere(actor);
  const query = q.trim();
  if (!query) return [];
  const rows = await prisma.guestProfile.findMany({
    where: {
      orgId: where.orgId,
      OR: [
        { firstName: { contains: query, mode: "insensitive" } },
        { lastName: { contains: query, mode: "insensitive" } },
        { email: { contains: query, mode: "insensitive" } },
        { phone: { contains: query, mode: "insensitive" } },
      ],
    },
    take: 25,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  return rows.map(guestDto);
}

export async function createPosGuest(actor: PosActor, body: Record<string, unknown>) {
  const locationId =
    body.locationId == null || body.locationId === "" ? null : String(body.locationId);
  const orgId = locationId
    ? (await requirePosVenue(actor, locationId)).orgId
    : (await posListLocationWhere(actor)).orgId;
  const firstName = String(body.firstName || "").trim();
  const lastName = String(body.lastName || "").trim();
  if (!firstName || !lastName) {
    throw new PosError("GUEST_NAME", "firstName and lastName are required");
  }
  const row = await prisma.guestProfile.create({
    data: {
      orgId,
      locationId,
      firstName,
      lastName,
      email: body.email == null ? null : String(body.email),
      phone: body.phone == null ? null : String(body.phone),
      postalCode: body.postalCode == null ? null : String(body.postalCode),
      createdById: actorUserId(actor),
    },
  });
  return guestDto(row);
}

export async function setGuestBan(
  actor: PosActor,
  guestProfileId: string,
  active: boolean,
  reason: string
) {
  const where = await posListLocationWhere(actor);
  const guest = await prisma.guestProfile.findFirst({
    where: { id: guestProfileId, orgId: where.orgId },
  });
  if (!guest) throw new PosError("NOT_FOUND", "Guest not found", 404);
  const userId = actorUserId(actor);
  await prisma.guestProfile.update({
    where: { id: guest.id },
    data: active
      ? { bannedAt: new Date(), bannedReason: reason || "Banned at POS" }
      : { bannedAt: null, bannedReason: null },
  });
  await prisma.guestBan.create({
    data: {
      orgId: guest.orgId,
      guestProfileId: guest.id,
      reason: reason || (active ? "Banned" : "Unbanned"),
      createdById: userId,
      active,
    },
  });
  logStaffActivityEntry(actor, {
    action: active ? "pos.guest.ban" : "pos.guest.unban",
    entityType: "GuestProfile",
    entityId: guest.id,
    description: active ? "Banned guest at POS" : "Cleared guest ban at POS",
  });
  return { id: guest.id, banned: active };
}
