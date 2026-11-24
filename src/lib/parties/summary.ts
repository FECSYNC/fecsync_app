/**
 * Party summary (JSON, CSV, printable HTML). Payments list tender, amount,
 * status only — no card numbers, no Stripe secrets, no raw Stripe ids.
 */
import moment from "moment-timezone";
import prisma from "@/lib/prisma";
import { partyStaffContext, type PartyActor } from "@/lib/parties/gate";
import { loadStaffParty } from "@/lib/parties/load";
import { toCents } from "@/lib/parties/deposits";
import { toFoodOrderDto } from "@/lib/parties/food";

export async function getPartySummary(actor: PartyActor, bookingId: string) {
  const ctx = await partyStaffContext(actor);
  const party = await loadStaffParty(ctx, bookingId);
  const d = party.partyDetail;
  const activityCount = await prisma.bookingActivity.count({ where: { bookingId: party.id } });
  const host = d.hostStaff;
  const hostName = host
    ? [host.firstName, host.lastName].filter(Boolean).join(" ").trim() || host.email
    : null;
  return {
    bookingId: party.id,
    publicId: party.publicId,
    status: party.status,
    opsStatus: d.opsStatus,
    visitStartsAt: party.visitStartsAt?.toISOString() ?? null,
    visitEndsAt: party.visitEndsAt?.toISOString() ?? null,
    timezone: party.location?.timezone ?? null,
    location: party.location ? { id: party.location.id, name: party.location.name } : null,
    partyName: d.partyName,
    honoreeName: d.honoreeName,
    honoreeAge: d.honoreeAge,
    package: d.packageProduct ? { id: d.packageProduct.id, name: d.packageProduct.name } : null,
    room: d.roomResourceId
      ? { id: d.roomResourceId, name: d.roomResource?.name ?? d.roomNameSnapshot ?? "" }
      : null,
    kidCount: d.kidCount,
    adultCount: d.adultCount,
    guestCount: d.guests.length,
    invitationCount: d.invitations.length,
    guests: d.guests.map((g) => ({
      id: g.id,
      kind: g.kind,
      name: g.name,
      age: g.age,
      rsvpStatus: g.rsvpStatus,
      waiverStatus: g.waiverStatus,
    })),
    invitations: d.invitations.map((inv) => ({
      id: inv.id,
      channel: inv.channel,
      sentTo: inv.sentTo,
      status: inv.status,
      sentAt: inv.sentAt?.toISOString() ?? null,
      respondedAt: inv.respondedAt?.toISOString() ?? null,
      createdAt: inv.createdAt.toISOString(),
    })),
    addOns: party.lines
      .filter((l) => l.productType === "add_on" && l.productId)
      .map((l) => ({ name: l.productName, qty: l.qty, lineTotalCents: toCents(l.lineTotal) })),
    food: d.foodOrders.filter((o) => o.status !== "cancelled").map(toFoodOrderDto),
    payments: party.payments.map((p) => ({
      tender: p.tender,
      amountCents: toCents(p.amount),
      status: p.status,
    })),
    totalCents: toCents(party.total),
    amountPaidCents: toCents(party.amountPaid),
    amountDueCents: toCents(party.amountDue),
    amountDue: toCents(party.amountDue) / 100,
    deposit: {
      requiredCents: d.depositRequiredCents,
      paidCents: d.depositPaidCents,
      dueAt: d.depositDueAt?.toISOString() ?? null,
    },
    balanceDueAt: d.balanceDueAt?.toISOString() ?? null,
    hostStaffUserId: d.hostStaffUserId,
    hostName: hostName ?? party.primaryContactName,
    primaryContactName: party.primaryContactName,
    activityCount,
  };
}

export type PartySummary = Awaited<ReturnType<typeof getPartySummary>>;

const dollars = (cents: number) => (Math.round(cents) / 100).toFixed(2);

function when(iso: string | null, tz: string | null) {
  return iso ? moment(iso).tz(tz || "UTC").format("YYYY-MM-DD HH:mm z") : "";
}

function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  // Neutralise spreadsheet formulas and quote everything.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** One section per block: header row, then rows. */
export function partySummaryCsv(s: PartySummary): string {
  const rows: unknown[][] = [
    ["section", "field", "value", "detail", "amount"],
    ["party", "publicId", s.publicId],
    ["party", "name", s.partyName],
    ["party", "honoree", s.honoreeName ?? "", s.honoreeAge ?? ""],
    ["party", "package", s.package?.name ?? ""],
    ["party", "venue", s.location?.name ?? ""],
    ["party", "room", s.room?.name ?? ""],
    ["party", "starts", when(s.visitStartsAt, s.timezone)],
    ["party", "status", s.status, s.opsStatus],
    ["party", "kids", s.kidCount],
    ["party", "adults", s.adultCount],
    ["party", "host", s.hostName ?? ""],
    ["money", "total", "", "", dollars(s.totalCents)],
    ["money", "paid", "", "", dollars(s.amountPaidCents)],
    ["money", "due", "", "", dollars(s.amountDueCents)],
    ["money", "depositRequired", "", when(s.deposit.dueAt, s.timezone), dollars(s.deposit.requiredCents)],
    ["money", "depositPaid", "", "", dollars(s.deposit.paidCents)],
    ...s.payments.map((p) => ["payment", p.tender, p.status, "", dollars(p.amountCents)]),
    ...s.addOns.map((a) => ["addOn", a.name, a.qty, "", dollars(a.lineTotalCents)]),
    ...s.food.flatMap((o) =>
      o.lines.map((l) => ["food", l.nameSnapshot, l.qty, o.status, dollars(l.unitPriceCents * l.qty)])
    ),
    ...s.guests.map((g) => ["guest", g.name ?? "", g.kind, `${g.rsvpStatus} / waiver ${g.waiverStatus}`, g.age ?? ""]),
  ];
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function h(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function partySummaryHtml(s: PartySummary): string {
  const table = (head: string[], body: unknown[][]) =>
    body.length
      ? `<table><thead><tr>${head.map((c) => `<th>${h(c)}</th>`).join("")}</tr></thead><tbody>${body
          .map((r) => `<tr>${r.map((c) => `<td>${h(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`
      : "<p class=\"muted\">None</p>";
  return `<!doctype html><html><head><meta charset="utf-8"><title>Party ${h(s.publicId)}</title>
<style>body{font-family:system-ui,sans-serif;color:#1c1917;padding:24px;max-width:860px;margin:auto}
h1{font-size:22px;margin:0}h2{font-size:15px;margin:20px 0 6px;border-bottom:2px solid #D4AF37;padding-bottom:4px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:4px 6px;border-bottom:1px solid #e7e5e4}
.muted{color:#78716c;font-size:13px}@media print{button{display:none}}</style></head><body>
<button onclick="window.print()">Print</button>
<h1>${h(s.partyName)} <span class="muted">${h(s.publicId)}</span></h1>
<p class="muted">${h(when(s.visitStartsAt, s.timezone))} · ${h(s.location?.name)} · Room ${h(s.room?.name || "unassigned")} · ${h(s.status)} / ${h(s.opsStatus)}</p>
<p>${h(s.package?.name)} · ${s.kidCount} kids, ${s.adultCount} adults${s.honoreeName ? ` · Honoree ${h(s.honoreeName)}${s.honoreeAge != null ? ` (${s.honoreeAge})` : ""}` : ""} · Host ${h(s.hostName || "—")}</p>
<h2>Money</h2>
<p>Total $${dollars(s.totalCents)} · Paid $${dollars(s.amountPaidCents)} · Due <strong>$${dollars(s.amountDueCents)}</strong> · Deposit $${dollars(s.deposit.requiredCents)} (paid $${dollars(s.deposit.paidCents)})</p>
${table(["Tender", "Status", "Amount"], s.payments.map((p) => [p.tender, p.status, `$${dollars(p.amountCents)}`]))}
<h2>Add-ons</h2>
${table(["Item", "Qty", "Total"], s.addOns.map((a) => [a.name, a.qty, `$${dollars(a.lineTotalCents)}`]))}
<h2>Food</h2>
${table(["Item", "Qty", "Order", "Total"], s.food.flatMap((o) => o.lines.map((l) => [l.nameSnapshot, l.qty, o.status, `$${dollars(l.unitPriceCents * l.qty)}`])))}
<h2>Guests</h2>
${table(["Name", "Kind", "Age", "RSVP", "Waiver"], s.guests.map((g) => [g.name, g.kind, g.age ?? "", g.rsvpStatus, g.waiverStatus]))}
</body></html>`;
}
