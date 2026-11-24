/**
 * Party keys for subledgers: guest:{id} | account:{id} | user:{id} |
 * supplier:{id} | employee:{userId}. Customers never create a User.
 */
import type { AccountingPartyType, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { acctError, ACCT } from "@/lib/accounting/errors";
import type { Db, PartyRef } from "@/lib/accounting/types";

export function formatPartyKey(p: PartyRef | null | undefined): string | null {
  return p ? `${p.type}:${p.id}` : null;
}

export function parsePartyKeyShape(key: string): PartyRef | null {
  const [type, id] = String(key).split(":");
  if (!id || !isValidId(id)) return null;
  if (type === "guest" || type === "account" || type === "user" || type === "supplier" || type === "employee") {
    return { type, id } as PartyRef;
  }
  return null;
}

/** Validate shape and same-org existence (404 otherwise). */
export async function parsePartyKey(orgId: string, key: string, db: Db = prisma): Promise<PartyRef> {
  const p = parsePartyKeyShape(key);
  if (!p) throw acctError(ACCT.NOT_FOUND);
  let exists = false;
  switch (p.type) {
    case "guest":
      exists = Boolean(await db.guestProfile.findFirst({ where: { id: p.id, orgId }, select: { id: true } }));
      break;
    case "account":
      exists = Boolean(await db.bookingAccount.findFirst({ where: { id: p.id, orgId }, select: { id: true } }));
      break;
    case "supplier":
      exists = Boolean(await db.supplier.findFirst({ where: { id: p.id, orgId }, select: { id: true } }));
      break;
    case "employee":
      exists = Boolean(
        await db.membership.findFirst({ where: { userId: p.id, orgId }, select: { id: true } })
      );
      break;
    case "user": {
      const [booking, order, invoice] = await Promise.all([
        db.booking.findFirst({ where: { orgId, userId: p.id }, select: { id: true } }),
        db.order.findFirst({ where: { orgId, userId: p.id }, select: { id: true } }),
        db.bookingInvoice.findFirst({ where: { orgId, customerUserId: p.id }, select: { id: true } }),
      ]);
      exists = Boolean(booking || order || invoice);
      break;
    }
  }
  if (!exists) throw acctError(ACCT.NOT_FOUND);
  return p;
}

export function partyColumns(p: PartyRef | null): {
  partyType: AccountingPartyType | null;
  guestProfileId: string | null;
  bookingAccountId: string | null;
  customerUserId: string | null;
  supplierId: string | null;
  employeeUserId: string | null;
} {
  const base = {
    partyType: null as AccountingPartyType | null,
    guestProfileId: null as string | null,
    bookingAccountId: null as string | null,
    customerUserId: null as string | null,
    supplierId: null as string | null,
    employeeUserId: null as string | null,
  };
  if (!p) return base;
  switch (p.type) {
    case "guest":
      return { ...base, partyType: "customer", guestProfileId: p.id };
    case "account":
      return { ...base, partyType: "customer", bookingAccountId: p.id };
    case "user":
      return { ...base, partyType: "customer", customerUserId: p.id };
    case "supplier":
      return { ...base, partyType: "supplier", supplierId: p.id };
    case "employee":
      return { ...base, partyType: "employee", employeeUserId: p.id };
  }
}

export function partyKeyFromLine(l: {
  guestProfileId?: string | null;
  bookingAccountId?: string | null;
  customerUserId?: string | null;
  supplierId?: string | null;
  employeeUserId?: string | null;
}): PartyRef | null {
  if (l.bookingAccountId) return { type: "account", id: l.bookingAccountId };
  if (l.guestProfileId) return { type: "guest", id: l.guestProfileId };
  if (l.customerUserId) return { type: "user", id: l.customerUserId };
  if (l.supplierId) return { type: "supplier", id: l.supplierId };
  if (l.employeeUserId) return { type: "employee", id: l.employeeUserId };
  return null;
}

export function partyLineWhere(p: PartyRef): Prisma.JournalLineWhereInput {
  switch (p.type) {
    case "guest":
      return { guestProfileId: p.id };
    case "account":
      return { bookingAccountId: p.id };
    case "user":
      return { customerUserId: p.id };
    case "supplier":
      return { supplierId: p.id };
    case "employee":
      return { employeeUserId: p.id };
  }
}

/**
 * Booking customer for AR: booking company account, else the CRM guest
 * (matched by user/email/phone; never creates a User), else the signed-in user.
 */
export async function resolveBookingCustomer(
  db: Db,
  booking: {
    orgId: string;
    accountId: string | null;
    userId: string | null;
    primaryContactEmail: string | null;
    primaryContactPhone: string | null;
  }
): Promise<PartyRef | null> {
  if (booking.accountId) return { type: "account", id: booking.accountId };
  const email = booking.primaryContactEmail?.trim().toLowerCase() || null;
  const or: Prisma.GuestProfileWhereInput[] = [];
  if (booking.userId) or.push({ userId: booking.userId });
  if (email) or.push({ email });
  if (booking.primaryContactPhone) or.push({ phone: booking.primaryContactPhone.trim() });
  if (or.length) {
    const guest = await db.guestProfile.findFirst({
      where: { orgId: booking.orgId, OR: or },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    if (guest) return { type: "guest", id: guest.id };
  }
  if (booking.userId) return { type: "user", id: booking.userId };
  return null;
}

export type PartyDisplay = { key: string; type: PartyRef["type"]; name: string; email: string | null; phone: string | null };

/** Batch display names for party keys (no N+1). */
export async function partyDisplayNames(orgId: string, refs: PartyRef[]): Promise<Map<string, PartyDisplay>> {
  const out = new Map<string, PartyDisplay>();
  const ids = (t: PartyRef["type"]) => [...new Set(refs.filter((r) => r.type === t).map((r) => r.id))];
  const [guests, accounts, users, suppliers, employees] = await Promise.all([
    ids("guest").length
      ? prisma.guestProfile.findMany({
          where: { orgId, id: { in: ids("guest") } },
          select: { id: true, firstName: true, lastName: true, email: true, phone: true },
        })
      : [],
    ids("account").length
      ? prisma.bookingAccount.findMany({
          where: { orgId, id: { in: ids("account") } },
          select: { id: true, name: true, billingEmail: true, phone: true },
        })
      : [],
    ids("user").length
      ? prisma.user.findMany({
          where: { id: { in: ids("user") } },
          select: { id: true, firstName: true, lastName: true, email: true, phoneNumber: true },
        })
      : [],
    ids("supplier").length
      ? prisma.supplier.findMany({
          where: { orgId, id: { in: ids("supplier") } },
          select: { id: true, name: true, email: true, phone: true },
        })
      : [],
    ids("employee").length
      ? prisma.user.findMany({
          where: { id: { in: ids("employee") } },
          select: { id: true, firstName: true, lastName: true, email: true, phoneNumber: true },
        })
      : [],
  ]);
  for (const g of guests) {
    out.set(`guest:${g.id}`, { key: `guest:${g.id}`, type: "guest", name: `${g.firstName} ${g.lastName}`.trim(), email: g.email, phone: g.phone });
  }
  for (const a of accounts) {
    out.set(`account:${a.id}`, { key: `account:${a.id}`, type: "account", name: a.name, email: a.billingEmail, phone: a.phone });
  }
  for (const u of users) {
    out.set(`user:${u.id}`, {
      key: `user:${u.id}`,
      type: "user",
      name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || "Customer",
      email: u.email,
      phone: u.phoneNumber ?? null,
    });
  }
  for (const s of suppliers) {
    out.set(`supplier:${s.id}`, { key: `supplier:${s.id}`, type: "supplier", name: s.name, email: s.email, phone: s.phone });
  }
  for (const u of employees) {
    out.set(`employee:${u.id}`, {
      key: `employee:${u.id}`,
      type: "employee",
      name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || "Staff",
      email: u.email,
      phone: u.phoneNumber ?? null,
    });
  }
  return out;
}
