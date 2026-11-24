import prisma from "@/lib/prisma";

export const WALKIN_PASS_MS = 90 * 60 * 1000;

export type WalkinPassView = {
  id: string;
  locationId: string;
  guestProfileId: string;
  expiresAt: string;
  ids?: string[];
};

export async function createWalkinPasses(input: {
  orgId: string;
  locationId: string;
  guestProfileIds: string[];
  now?: Date;
}): Promise<WalkinPassView | null> {
  const ids = [...new Set(input.guestProfileIds.filter(Boolean))];
  if (!ids.length) return null;
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + WALKIN_PASS_MS);
  const created = await prisma.$transaction(
    ids.map((guestProfileId) =>
      prisma.waiverWalkinPass.create({
        data: {
          orgId: input.orgId,
          locationId: input.locationId,
          guestProfileId,
          expiresAt,
        },
        select: { id: true, locationId: true, guestProfileId: true, expiresAt: true },
      })
    )
  );
  const first = created[0];
  return {
    id: first.id,
    locationId: first.locationId,
    guestProfileId: first.guestProfileId,
    expiresAt: first.expiresAt.toISOString(),
    ids: created.map((row) => row.id),
  };
}

export function walkinPassIsActive(
  row: { locationId: string; expiresAt: Date; revokedAt: Date | null },
  locationId: string,
  now = new Date()
): boolean {
  if (row.locationId !== locationId) return false;
  if (row.revokedAt) return false;
  return row.expiresAt.getTime() > now.getTime();
}

export async function readActiveWalkinPass(input: {
  orgId: string;
  locationId: string;
  passId: string;
  now?: Date;
}): Promise<WalkinPassView | null> {
  const row = await prisma.waiverWalkinPass.findFirst({
    where: { id: input.passId, orgId: input.orgId },
  });
  if (!row || !walkinPassIsActive(row, input.locationId, input.now)) return null;
  return {
    id: row.id,
    locationId: row.locationId,
    guestProfileId: row.guestProfileId,
    expiresAt: row.expiresAt.toISOString(),
  };
}

export async function revokeWalkinPass(input: {
  orgId: string;
  locationId: string;
  passId: string;
}): Promise<boolean> {
  const row = await prisma.waiverWalkinPass.findFirst({
    where: { id: input.passId, orgId: input.orgId, locationId: input.locationId },
    select: { id: true, revokedAt: true, createdAt: true, expiresAt: true },
  });
  if (!row) return false;
  const windowStart = new Date(row.createdAt.getTime() - 5000);
  const windowEnd = new Date(row.createdAt.getTime() + 5000);
  await prisma.waiverWalkinPass.updateMany({
    where: {
      orgId: input.orgId,
      locationId: input.locationId,
      revokedAt: null,
      OR: [
        { id: row.id },
        {
          expiresAt: row.expiresAt,
          createdAt: { gte: windowStart, lte: windowEnd },
        },
      ],
    },
    data: { revokedAt: new Date() },
  });
  return true;
}

/** Active passes from the latest kiosk or on-site signing for these guests at one park. */
export async function readReplayWalkinPass(input: {
  orgId: string;
  locationId: string;
  guestProfileIds: string[];
  now?: Date;
}): Promise<WalkinPassView | null> {
  const guestProfileIds = [...new Set(input.guestProfileIds.filter(Boolean))];
  if (!guestProfileIds.length) return null;
  const now = input.now ?? new Date();
  const rows = await prisma.waiverWalkinPass.findMany({
    where: {
      orgId: input.orgId,
      locationId: input.locationId,
      guestProfileId: { in: guestProfileIds },
      revokedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!rows.length) return null;
  const newest = rows[0].expiresAt.getTime();
  const batch = rows.filter((row) => row.expiresAt.getTime() === newest);
  const first = batch[0];
  return {
    id: first.id,
    locationId: first.locationId,
    guestProfileId: first.guestProfileId,
    expiresAt: first.expiresAt.toISOString(),
    ids: batch.map((row) => row.id),
  };
}

/** Create the 90-minute pass only when this signing never saved one. A revoked or expired pass is not replaced. */
export async function healMissingWalkinPass(input: {
  orgId: string;
  locationId: string;
  guestProfileIds: string[];
  signedAt: Date;
}): Promise<WalkinPassView | null> {
  if (Date.now() - input.signedAt.getTime() > WALKIN_PASS_MS) return null;
  const guestProfileIds = [...new Set(input.guestProfileIds.filter(Boolean))];
  if (!guestProfileIds.length) return null;
  const existing = await prisma.waiverWalkinPass.findFirst({
    where: {
      orgId: input.orgId,
      locationId: input.locationId,
      guestProfileId: { in: guestProfileIds },
      createdAt: { gte: new Date(input.signedAt.getTime() - 60_000) },
    },
    select: { id: true },
  });
  if (existing) {
    return readReplayWalkinPass({
      orgId: input.orgId,
      locationId: input.locationId,
      guestProfileIds,
    });
  }
  return createWalkinPasses({
    orgId: input.orgId,
    locationId: input.locationId,
    guestProfileIds,
    now: input.signedAt,
  });
}
