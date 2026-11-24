/**
 * Read-only mirror of Digital Waivers coverage onto party rows. The waivers
 * lib is the source of truth; when waivers are not on the org's plan the
 * status stays "n/a" and the missing count is 0.
 */
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { assertModuleEnabled } from "@/lib/moduleEntitlement";
import { computePartyWaiverGaps } from "@/lib/waivers/desk";

/**
 * assertModuleEnabled caches success only, so an org without Waivers re-ran
 * ~4 sequential plan queries on every party list / detail poll. Remember "off"
 * briefly here. Display-only — recompute paths below stay uncached.
 */
const WAIVERS_OFF_TTL_MS = 60_000;
const waiversOffUntil = new Map<string, number>();

export async function partyWaiversEnabled(orgId: string): Promise<boolean> {
  const offUntil = waiversOffUntil.get(orgId);
  if (offUntil && offUntil > Date.now()) return false;
  const enabled = await waiversEnabled(orgId);
  if (enabled) waiversOffUntil.delete(orgId);
  else waiversOffUntil.set(orgId, Date.now() + WAIVERS_OFF_TTL_MS);
  return enabled;
}

async function waiversEnabled(orgId: string): Promise<boolean> {
  try {
    await assertModuleEnabled(orgId, "waivers");
    return true;
  } catch {
    return false;
  }
}

export async function recomputePartyWaiverStatus(bookingId: string): Promise<{
  available: boolean;
  waiverMissingCount: number;
}> {
  const detail = await prisma.partyBookingDetail.findUnique({
    where: { bookingId },
    select: { id: true, orgId: true },
  });
  if (!detail) return { available: false, waiverMissingCount: 0 };

  if (!(await waiversEnabled(detail.orgId))) {
    await prisma.$transaction([
      prisma.partyGuest.updateMany({
        where: { partyDetailId: detail.id, waiverStatus: { not: "n/a" } },
        data: { waiverStatus: "n/a" },
      }),
      prisma.partyBookingDetail.update({
        where: { id: detail.id },
        data: { waiverMissingCount: 0 },
      }),
    ]);
    return { available: false, waiverMissingCount: 0 };
  }

  const gaps = await computePartyWaiverGaps(detail.orgId, bookingId);
  if (!gaps.available) return { available: false, waiverMissingCount: 0 };
  await prisma.$transaction([
    ...gaps.guests.map((g) =>
      prisma.partyGuest.update({
        where: { id: g.partyGuestId },
        data: { waiverStatus: g.waiverStatus },
      })
    ),
    prisma.partyBookingDetail.update({
      where: { id: detail.id },
      data: { waiverMissingCount: gaps.waiverMissingCount },
    }),
  ]);
  return { available: true, waiverMissingCount: gaps.waiverMissingCount };
}

/** Best-effort recompute (guest edits must not fail on a waiver read). */
export async function recomputePartyWaiverStatusSafe(bookingId: string) {
  try {
    return await recomputePartyWaiverStatus(bookingId);
  } catch (err) {
    console.error("[parties] waiver recompute failed", bookingId, err);
    return { available: false, waiverMissingCount: 0 };
  }
}

export async function partyBookingIdForWaiverRef(ref: {
  partyGuestId?: string | null;
  bookingId?: string | null;
}): Promise<string | null> {
  if (ref.partyGuestId && isValidId(ref.partyGuestId)) {
    const guest = await prisma.partyGuest.findUnique({
      where: { id: ref.partyGuestId },
      select: { partyDetail: { select: { bookingId: true } } },
    });
    if (guest) return guest.partyDetail.bookingId;
  }
  if (ref.bookingId && isValidId(ref.bookingId)) {
    const detail = await prisma.partyBookingDetail.findUnique({
      where: { bookingId: ref.bookingId },
      select: { bookingId: true },
    });
    if (detail) return detail.bookingId;
  }
  return null;
}
