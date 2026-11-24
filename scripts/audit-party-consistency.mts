/**
 * Read-only Party Management data consistency audit (no writes).
 *   npx tsx scripts/audit-party-consistency.mts
 */
import { PrismaClient } from "@prisma/client";
import { loadDatabaseUrl } from "./prisma-env.mjs";

process.env.POS_SMOKE = "1";
loadDatabaseUrl();
const prisma = new PrismaClient();

const OPS_FOR: Record<string, string[]> = {
  draft: ["inquiry"],
  hold: ["held"],
  reserved: ["held"],
  pending_payment: ["held"],
  confirmed: ["confirmed", "checked_in", "in_progress", "completed", "no_show"],
  cancelled: ["cancelled"],
  expired: ["cancelled"],
  refunded: ["cancelled", "checked_in", "in_progress", "completed"],
};
const cents = (v: { toString(): string }) => Math.round(Number(v.toString()) * 100);

try {
  const rows = await prisma.partyBookingDetail.findMany({
    include: {
      guests: { select: { kind: true, orgId: true, locationId: true } },
      booking: {
        select: {
          publicId: true,
          orgId: true,
          locationId: true,
          status: true,
          total: true,
          amountPaid: true,
          amountDue: true,
          credentials: { select: { status: true } },
        },
      },
    },
  });
  const issues: string[] = [];
  for (const d of rows) {
    const b = d.booking;
    const id = b.publicId;
    const total = cents(b.total);
    const paid = cents(b.amountPaid);
    const due = cents(b.amountDue);
    const live = !["cancelled", "expired", "refunded"].includes(b.status);
    if (live && due !== Math.max(0, total - paid)) issues.push(`${id} amountDue ${due} != total ${total} − paid ${paid}`);
    if (d.depositPaidCents !== Math.min(paid, d.depositRequiredCents)) {
      issues.push(`${id} depositPaid ${d.depositPaidCents} != min(${paid}, ${d.depositRequiredCents})`);
    }
    if (!(OPS_FOR[b.status] ?? []).includes(d.opsStatus)) issues.push(`${id} opsStatus ${d.opsStatus} vs booking ${b.status}`);
    if (b.status === "confirmed") {
      const redeemed = b.credentials.filter((c) => c.status === "redeemed").length;
      const live = b.credentials.filter((c) => c.status === "unused" || c.status === "redeemed").length;
      if (redeemed === 0 && live !== d.kidCount + d.adultCount) {
        issues.push(`${id} credentials ${live} != heads ${d.kidCount + d.adultCount}`);
      }
    }
    const kids = d.guests.filter((g) => g.kind === "kid" || g.kind === "honoree").length;
    const adults = d.guests.filter((g) => g.kind === "adult" || g.kind === "chaperone").length;
    if (kids > d.kidCount || adults > d.adultCount) issues.push(`${id} named guests ${kids}/${adults} exceed ${d.kidCount}/${d.adultCount}`);
    if (d.orgId !== b.orgId || d.locationId !== b.locationId) issues.push(`${id} detail org/location != booking`);
    if (d.guests.some((g) => g.orgId !== d.orgId || g.locationId !== d.locationId)) issues.push(`${id} guest org/location mismatch`);
  }
  const [inv, food, rem, run] = await Promise.all([
    prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) n FROM party_invitations i JOIN party_booking_details d ON d.id = i."partyDetailId" WHERE i."orgId" <> d."orgId" OR i."locationId" <> d."locationId"`,
    prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) n FROM party_food_orders f JOIN party_booking_details d ON d.id = f."partyDetailId" WHERE f."orgId" <> d."orgId" OR f."locationId" <> d."locationId"`,
    prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) n FROM party_balance_reminders r JOIN party_booking_details d ON d.id = r."partyDetailId" WHERE r."orgId" <> d."orgId" OR r."locationId" <> d."locationId"`,
    prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) n FROM party_run_sheet_items s JOIN party_booking_details d ON d.id = s."partyDetailId" WHERE s."orgId" <> d."orgId" OR s."locationId" <> d."locationId"`,
  ]);
  const childMismatch = Number(inv[0].n) + Number(food[0].n) + Number(rem[0].n) + Number(run[0].n);
  if (childMismatch) issues.push(`${childMismatch} invitation/food/reminder/run-sheet rows with org/location != party`);
  console.log(`parties checked: ${rows.length}`);
  console.log(issues.length ? issues.map((i) => `ISSUE ${i}`).join("\n") : "no consistency issues");
} finally {
  await prisma.$disconnect();
}
