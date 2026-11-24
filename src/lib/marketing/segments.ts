import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";
import { MARKETING_BATCH_CAP } from "@/lib/marketing/types";

const optedInWhere = (orgId: string): Prisma.GuestProfileWhereInput => ({
  orgId,
  marketingEmailOptIn: true,
  bannedAt: null,
  email: { not: null },
});

export function daysUntilNextBirthday(
  dateOfBirth: Date,
  now = new Date()
): number {
  const month = dateOfBirth.getUTCMonth();
  const day = dateOfBirth.getUTCDate();
  let next = new Date(Date.UTC(now.getUTCFullYear(), month, day));
  if (next.getTime() < now.getTime()) {
    next = new Date(Date.UTC(now.getUTCFullYear() + 1, month, day));
  }
  return Math.ceil((next.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

export function birthdayWindowKey(now = new Date()): string {
  return String(now.getUTCFullYear());
}

export async function countBirthdayUpcoming(
  orgId: string,
  daysAhead: number,
  now = new Date()
): Promise<number> {
  const id = requireId(orgId, "orgId");
  const rows = await prisma.guestProfile.findMany({
    where: {
      ...optedInWhere(id),
      dateOfBirth: { not: null },
    },
    select: { dateOfBirth: true },
    take: 5000,
  });
  return rows.filter(
    (r) =>
      r.dateOfBirth &&
      daysUntilNextBirthday(r.dateOfBirth, now) <= daysAhead
  ).length;
}

export async function listBirthdayCandidates(
  orgId: string,
  daysAhead: number,
  opts?: { limit?: number; now?: Date }
): Promise<
  Array<{
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    locationId: string | null;
    dateOfBirth: Date;
  }>
> {
  const id = requireId(orgId, "orgId");
  const now = opts?.now ?? new Date();
  const limit = Math.min(opts?.limit ?? MARKETING_BATCH_CAP, MARKETING_BATCH_CAP);

  const rows = await prisma.guestProfile.findMany({
    where: {
      ...optedInWhere(id),
      dateOfBirth: { not: null },
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      locationId: true,
      dateOfBirth: true,
    },
    take: 5000,
  });

  return rows
    .filter(
      (r): r is typeof r & { dateOfBirth: Date; email: string } =>
        Boolean(r.dateOfBirth && r.email?.trim()) &&
        daysUntilNextBirthday(r.dateOfBirth, now) <= daysAhead
    )
    .slice(0, limit);
}

export async function countLapsed(
  orgId: string,
  inactiveDays: number,
  now = new Date()
): Promise<number> {
  const id = requireId(orgId, "orgId");
  const cutoff = new Date(now.getTime() - inactiveDays * 24 * 60 * 60 * 1000);
  return prisma.guestProfile.count({
    where: {
      ...optedInWhere(id),
      lastVisitAt: { lt: cutoff },
    },
  });
}

export async function listLapsedCandidates(
  orgId: string,
  inactiveDays: number,
  opts?: { limit?: number; now?: Date }
): Promise<
  Array<{
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    locationId: string | null;
    lastVisitAt: Date | null;
  }>
> {
  const id = requireId(orgId, "orgId");
  const now = opts?.now ?? new Date();
  const cutoff = new Date(now.getTime() - inactiveDays * 24 * 60 * 60 * 1000);
  const limit = Math.min(opts?.limit ?? MARKETING_BATCH_CAP, MARKETING_BATCH_CAP);

  return prisma.guestProfile.findMany({
    where: {
      ...optedInWhere(id),
      lastVisitAt: { lt: cutoff },
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      locationId: true,
      lastVisitAt: true,
    },
    orderBy: { lastVisitAt: "asc" },
    take: limit,
  });
}

export async function countOptedInLeads(orgId: string): Promise<number> {
  const id = requireId(orgId, "orgId");
  return prisma.guestProfile.count({
    where: optedInWhere(id),
  });
}

export type MarketingLeadRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  marketingEmailOptIn: boolean;
  newsletterSubscribedAt: string | null;
  firstVisitAt: string | null;
  lastVisitAt: string | null;
  welcomeEmailSentAt: string | null;
  dateOfBirth: string | null;
  locationId: string | null;
  createdAt: string;
};

export async function listMarketingLeads(
  orgId: string,
  opts?: { q?: string; take?: number }
): Promise<MarketingLeadRow[]> {
  const id = requireId(orgId, "orgId");
  const take = Math.min(Math.max(opts?.take ?? 200, 1), 500);
  const q = opts?.q?.trim();

  const rows = await prisma.guestProfile.findMany({
    where: {
      orgId: id,
      ...(q
        ? {
            OR: [
              { email: { contains: q, mode: "insensitive" } },
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      marketingEmailOptIn: true,
      newsletterSubscribedAt: true,
      firstVisitAt: true,
      lastVisitAt: true,
      welcomeEmailSentAt: true,
      dateOfBirth: true,
      locationId: true,
      createdAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take,
  });

  return rows.map((r) => ({
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    email: r.email,
    phone: r.phone,
    marketingEmailOptIn: r.marketingEmailOptIn,
    newsletterSubscribedAt: r.newsletterSubscribedAt?.toISOString() ?? null,
    firstVisitAt: r.firstVisitAt?.toISOString() ?? null,
    lastVisitAt: r.lastVisitAt?.toISOString() ?? null,
    welcomeEmailSentAt: r.welcomeEmailSentAt?.toISOString() ?? null,
    dateOfBirth: r.dateOfBirth?.toISOString() ?? null,
    locationId: r.locationId,
    createdAt: r.createdAt.toISOString(),
  }));
}
