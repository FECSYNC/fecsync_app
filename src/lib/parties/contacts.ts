/**
 * Contact lookup for the staff create wizard: previous booking contacts in the
 * actor's org + location scope. Reports whether an account exists for the email
 * (the engine links it on create) — never creates a user.
 */
import prisma from "@/lib/prisma";
import { partyStaffContext, type PartyActor } from "@/lib/parties/gate";
import { partyLocationWhere } from "@/lib/parties/scope";

/** Staff who can host a party: active Membership on the actor's org only. */
export async function listPartyHostCandidates(actor: PartyActor) {
  const ctx = await partyStaffContext(actor);
  const rows = await prisma.membership.findMany({
    where: { orgId: ctx.orgId, status: "active" },
    select: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    orderBy: { createdAt: "asc" },
    take: 500,
  });
  return rows
    .filter((r) => r.user)
    .map((r) => ({
      userId: r.user.id,
      name: [r.user.firstName, r.user.lastName].filter(Boolean).join(" ").trim() || r.user.email,
      email: r.user.email,
    }));
}

export async function searchPartyContacts(actor: PartyActor, raw: string | null | undefined) {
  const ctx = await partyStaffContext(actor);
  const q = (raw ?? "").trim().slice(0, 120);
  if (q.length < 2) return [];
  const rows = await prisma.booking.findMany({
    where: {
      orgId: ctx.orgId,
      ...partyLocationWhere(ctx.scope),
      OR: [
        { primaryContactEmail: { contains: q, mode: "insensitive" } },
        { primaryContactPhone: { contains: q } },
        { primaryContactName: { contains: q, mode: "insensitive" } },
      ],
    },
    select: { primaryContactName: true, primaryContactEmail: true, primaryContactPhone: true, createdAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 40,
  });
  const seen = new Set<string>();
  const contacts: Array<{ name: string | null; email: string | null; phone: string | null; hasAccount: boolean }> = [];
  for (const r of rows) {
    const key = `${r.primaryContactEmail?.toLowerCase() ?? ""}|${r.primaryContactPhone ?? ""}`;
    if (key === "|" || seen.has(key)) continue;
    seen.add(key);
    contacts.push({
      name: r.primaryContactName,
      email: r.primaryContactEmail?.toLowerCase() ?? null,
      phone: r.primaryContactPhone,
      hasAccount: false,
    });
    if (contacts.length >= 10) break;
  }
  const emails = contacts.map((c) => c.email).filter((e): e is string => Boolean(e));
  if (emails.length) {
    const users = await prisma.user.findMany({
      where: { email: { in: emails, mode: "insensitive" } },
      select: { email: true },
    });
    const withAccount = new Set(users.map((u) => u.email.toLowerCase()));
    for (const c of contacts) c.hasAccount = Boolean(c.email && withAccount.has(c.email));
  }
  return contacts;
}
