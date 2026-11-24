/**
 * Party Management Step 2 smoke: real route handlers with signed sessions
 * (staff roles, host, public), webhook / success-URL idempotency, maintenance,
 * export redaction, IDOR, rate limits, summary CSV.
 *   yarn smoke:parties:step2
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { envValue, loadDatabaseUrl, readEnvFile } from "./prisma-env.mjs";
import { teardownSmokeData } from "./party-smoke-teardown.mts";

// POS_SMOKE keeps the Prisma pool tiny (shared Supabase pooler) — set before loading the URL.
process.env.POS_SMOKE = "1";
loadDatabaseUrl();
process.env.JWT_SECRET = process.env.JWT_SECRET || envValue(readEnvFile(), "JWT_SECRET") || "";
const prisma = new PrismaClient();

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

type Res = { status: number; json: Record<string, unknown> | null; text: string; contentType: string };
type Handler = (req: unknown, ctx?: unknown) => Promise<Response>;

async function main() {
  process.env.TICKETING_PAYMENT_LINK_STUB = "1";
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.NOTIFICATION_EMAIL_USER;
  delete process.env.TEAM_EMAIL_USER;
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET missing from .env.local");

  const { NextRequest } = await import("next/server");
  const { signAccessToken } = await import("../src/lib/jwt.ts");
  const { createOrganizationWithPlatformAdmin } = await import("../src/lib/orgRegistration.ts");
  const { createVenueLocation } = await import("../src/lib/venueLocations.ts");
  const { replaceMembershipVenueAssignments } = await import("../src/lib/parkAdminScope.ts");
  const { clearCachedStaffGatesForOrg } = await import("../src/lib/ticketing/staffGateCache.ts");
  const { ADMIN_ROUTE_PERMISSIONS, adminPathRequiresRegisteredCompanyOrg, permissionForAdminPath, ROLE_PRESETS } =
    await import("../src/lib/auth/permissions.ts");
  const { isDemoAllowedAdminPath } = await import("../src/lib/demoPlanLock.ts");
  const rooms = await import("../src/lib/parties/rooms.ts");
  const packages = await import("../src/lib/parties/packages.ts");
  const settingsLib = await import("../src/lib/parties/settings.ts");
  const engine = await import("../src/lib/parties/partyEngine.ts");
  const invitations = await import("../src/lib/parties/invitations.ts");
  const { runPartyMaintenance } = await import("../src/lib/parties/maintenance.ts");
  const { createPartyFromPos } = await import("../src/lib/parties/posAdapter.ts");
  const { buildCompanyWorkspaceExport } = await import("../src/lib/companyExport.ts");
  const { takeBookingPayments, createPendingCardPaymentLocked, settleVenueBookingStripePayment, failVenueBookingStripePayment } =
    await import("../src/lib/ticketing/payments.ts");
  const { POST: signupPost } = await import("../src/app/api/auth/signup/route.ts");

  const R = {
    parties: await import("../src/app/api/admin/parties/route.ts"),
    party: await import("../src/app/api/admin/parties/[bookingId]/route.ts"),
    confirm: await import("../src/app/api/admin/parties/[bookingId]/confirm/route.ts"),
    cancel: await import("../src/app/api/admin/parties/[bookingId]/cancel/route.ts"),
    reactivate: await import("../src/app/api/admin/parties/[bookingId]/reactivate/route.ts"),
    guests: await import("../src/app/api/admin/parties/[bookingId]/guests/route.ts"),
    guest: await import("../src/app/api/admin/parties/[bookingId]/guests/[guestId]/route.ts"),
    invites: await import("../src/app/api/admin/parties/[bookingId]/invitations/route.ts"),
    inviteCancel: await import("../src/app/api/admin/parties/[bookingId]/invitations/[id]/cancel/route.ts"),
    inviteBounced: await import("../src/app/api/admin/parties/[bookingId]/invitations/[id]/bounced/route.ts"),
    food: await import("../src/app/api/admin/parties/[bookingId]/food/route.ts"),
    foodSubmit: await import("../src/app/api/admin/parties/[bookingId]/food/submit/route.ts"),
    foodCancel: await import("../src/app/api/admin/parties/[bookingId]/food/cancel/route.ts"),
    room: await import("../src/app/api/admin/parties/[bookingId]/room/route.ts"),
    host: await import("../src/app/api/admin/parties/[bookingId]/host/route.ts"),
    runSheet: await import("../src/app/api/admin/parties/[bookingId]/run-sheet/route.ts"),
    summary: await import("../src/app/api/admin/parties/[bookingId]/summary/route.ts"),
    quote: await import("../src/app/api/admin/parties/quote/route.ts"),
    hosts: await import("../src/app/api/admin/parties/hosts/route.ts"),
    contacts: await import("../src/app/api/admin/parties/contacts/route.ts"),
    balances: await import("../src/app/api/admin/parties/balances/route.ts"),
    refunds: await import("../src/app/api/admin/bookings/[id]/refunds/route.ts"),
    meParty: await import("../src/app/api/me/parties/[id]/route.ts"),
    meGuests: await import("../src/app/api/me/parties/[id]/guests/route.ts"),
    meFood: await import("../src/app/api/me/parties/[id]/food/route.ts"),
    meCancel: await import("../src/app/api/me/parties/[id]/cancel/route.ts"),
    meInvites: await import("../src/app/api/me/parties/[id]/invitations/route.ts"),
    mePay: await import("../src/app/api/me/parties/[id]/pay/route.ts"),
    pubPackages: await import("../src/app/api/public/parties/packages/route.ts"),
    pubHolds: await import("../src/app/api/public/parties/holds/route.ts"),
    pubCheckout: await import("../src/app/api/public/parties/checkout/route.ts"),
    pubConfirmation: await import("../src/app/api/public/parties/confirmation/[bookingPublicId]/route.ts"),
    pubInvite: await import("../src/app/api/public/parties/invite/[token]/route.ts"),
    pubRsvp: await import("../src/app/api/public/parties/invite/[token]/rsvp/route.ts"),
  };

  let ipSeq = 1;
  async function call(
    handler: Handler,
    opts: { method?: string; url: string; token?: string | null; body?: unknown; params?: Record<string, string>; ip?: string }
  ): Promise<Res> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-forwarded-for": opts.ip ?? `10.9.${Math.floor(ipSeq / 250)}.${ipSeq++ % 250}`,
    };
    if (opts.token) headers.cookie = `access-token=${opts.token}`;
    const req = new NextRequest(`http://localhost${opts.url}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json, text, contentType: res.headers.get("content-type") ?? "" };
  }
  const data = (r: Res) => ((r.json?.data ?? r.json) ?? {}) as Record<string, any>;
  const errCode = (r: Res) => String(r.json?.error ?? r.json?.message ?? "");

  const stamp = Date.now();
  const createdOrgIds: string[] = [];
  const createdUserIds: string[] = [];

  async function user(tag: string, role = "client") {
    const row = await prisma.user.create({
      data: {
        email: `smoke-party2-${tag}-${stamp}@test.local`,
        password: "x",
        username: `smokeparty2${tag}${stamp}`.slice(0, 40),
        firstName: "Party2",
        lastName: tag,
        role,
        isVerified: true,
        joinedAt: new Date(),
      },
    });
    createdUserIds.push(row.id);
    return row;
  }
  async function tokenFor(u: { id: string; email: string }, orgId: string | null, preset: string | null) {
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { authzVersion: true, role: true } });
    return signAccessToken({
      id: u.id,
      email: u.email,
      role: fresh.role,
      orgId,
      membershipRole: preset,
      preset,
      permissions: preset ? [...(ROLE_PRESETS as Record<string, readonly string[]>)[preset]!] : null,
      companyWideView: true,
      authzVersion: fresh.authzVersion,
    });
  }
  async function org(tag: string, plan = "growth") {
    const owner = await user(tag);
    const reg = await createOrganizationWithPlatformAdmin({ name: `Party ${tag} ${stamp}`, slug: `party-${tag}-${stamp}`, userId: owner.id });
    const orgId = reg.organization.id;
    createdOrgIds.push(orgId);
    await prisma.organization.update({
      where: { id: orgId },
      data: { status: "active", subscriptionPlan: plan, subscriptionStatus: "active", subscriptionEndsAt: new Date(Date.now() + 30 * 86400000) },
    });
    await prisma.taxSettings.upsert({ where: { orgId }, create: { orgId, enabled: false, rate: 0 }, update: { enabled: false, rate: 0 } });
    clearCachedStaffGatesForOrg(orgId);
    const actor = { orgId, sub: owner.id, rolePreset: "platform_admin", preset: "platform_admin", membershipRole: "platform_admin", companyWideView: true };
    return { orgId, owner, actor, slug: reg.organization.slug, token: await tokenFor(owner, orgId, "platform_admin") };
  }
  async function staff(orgId: string, tag: string, preset: string, locationIds?: string[]) {
    const u = await user(tag);
    const m = await prisma.membership.create({
      data: { userId: u.id, orgId, rolePreset: preset, status: "active", companyWideView: true, permissionsOverride: [] },
    });
    if (locationIds) await replaceMembershipVenueAssignments({ membershipId: m.id, orgId, locationIds });
    return { user: u, token: await tokenFor(u, orgId, preset) };
  }

  // ── Admin page routes (S2-G1) ─────────────────────────────────────────────
  const pagePaths = [
    ["/admin/parties", "page.tsx"],
    ["/admin/parties/new", "new/page.tsx"],
    ["/admin/parties/balances", "balances/page.tsx"],
    ["/admin/parties/run-sheets", "run-sheets/page.tsx"],
    ["/admin/parties/packages", "packages/page.tsx"],
    ["/admin/parties/packages/new", "packages/new/page.tsx"],
    ["/admin/parties/packages/abc", "packages/[productId]/page.tsx"],
    ["/admin/parties/rooms", "rooms/page.tsx"],
    ["/admin/parties/menu", "menu/page.tsx"],
    ["/admin/parties/settings", "settings/page.tsx"],
    ["/admin/parties/abc", "[bookingId]/page.tsx"],
  ] as const;
  const pageBase = path.join(process.cwd(), "src", "app", "(admin)", "admin", "parties");
  const badPages = pagePaths.filter(
    ([p, file]) =>
      !existsSync(path.join(pageBase, file)) ||
      !permissionForAdminPath(p) ||
      !adminPathRequiresRegisteredCompanyOrg(p) ||
      isDemoAllowedAdminPath(p)
  );
  check("admin party pages exist, registered, registered-company only, Demo-locked", badPages.length === 0, badPages.map((b) => b[0]).join(","));
  check("run-sheets page in ADMIN_ROUTE_PERMISSIONS", Boolean((ADMIN_ROUTE_PERMISSIONS as Record<string, string>)["/admin/parties/run-sheets"]));

  // ── Tenants, staff, catalog ───────────────────────────────────────────────
  const A = await org("s2a");
  const B = await org("s2b");
  const v1 = await createVenueLocation(A.actor, { name: `S2 Park One ${stamp}`, slug: `s2p1-${stamp}`, timezone: "America/New_York" });
  const v2 = await createVenueLocation(A.actor, { name: `S2 Park Two ${stamp}`, slug: `s2p2-${stamp}` });
  await prisma.venueLocation.update({ where: { id: v1.id }, data: { publicBookingEnabled: true } });
  const bVenue = await createVenueLocation(B.actor, { name: `S2 B ${stamp}`, slug: `s2b-${stamp}` });
  const ops = await staff(A.orgId, "ops", "ops_manager");
  const fin = await staff(A.orgId, "fin", "finance");
  const parkOps = await staff(A.orgId, "park", "ops_manager", [v2.id]);
  const host = await user("host");
  const hostToken = await tokenFor(host, null, null);
  const other = await user("other");
  const otherToken = await tokenFor(other, null, null);

  const room1 = await rooms.createPartyRoom(A.actor, { locationId: v1.id, name: "Room A", defaultCapacity: 40 });
  const room2 = await rooms.createPartyRoom(A.actor, { locationId: v1.id, name: "Room B", defaultCapacity: 40 });
  const roomV2 = await rooms.createPartyRoom(A.actor, { locationId: v2.id, name: "V2 Room", defaultCapacity: 40 });
  await settingsLib.patchPartySettings(A.actor, {
    values: { defaultDepositPercent: 50, requireDepositToConfirm: true, allowConfirmWithoutDeposit: false, invitationExpiresHours: 48, balanceReminderDaysBefore: [3, 1] },
  });
  const pkg = await packages.createPartyPackage(A.actor, {
    locationId: v1.id,
    name: `S2 Bash ${stamp}`,
    minGuests: 1,
    maxGuests: 40,
    durationMinutes: 120,
    includedKids: 10,
    includedAdults: 2,
    extraKidPriceCents: 1500,
    extraAdultPriceCents: 1000,
    packagePriceCents: 30000,
    roomResourceId: room1.id,
    published: true,
  });
  const pkgV2 = await packages.createPartyPackage(A.actor, {
    locationId: v2.id,
    name: `S2 V2 ${stamp}`,
    maxGuests: 40,
    durationMinutes: 90,
    includedKids: 8,
    includedAdults: 2,
    packagePriceCents: 20000,
    roomResourceId: roomV2.id,
    published: true,
  });
  const at = (days: number, hourUtc: number) => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + days);
    d.setUTCHours(hourUtc, 0, 0, 0);
    return d.toISOString();
  };
  const sess = async (p: { id: string }, days: number, hour: number) =>
    (await packages.createPartyPackageSessions(A.actor, p.id, { startsAt: at(days, hour), capacity: 5 }))[0]!;
  const sPub = await sess(pkg, 8, 15);
  const sA = await sess(pkg, 9, 15);
  const sB = await sess(pkg, 9, 18);
  const sC = await sess(pkg, 10, 15);
  const sD = await sess(pkg, 11, 15);
  const sE = await sess(pkg, 12, 15);
  const sF = await sess(pkg, 13, 15);
  const sV2 = await sess(pkgV2, 9, 15);

  const createBody = (sessionId: string, extra: Record<string, unknown> = {}) => ({
    channel: "phone",
    locationId: v1.id,
    productId: pkg.id,
    sessionId,
    kidCount: 10,
    adultCount: 2,
    partyName: `S2 party ${sessionId.slice(-4)}`,
    contact: { name: "Hana Host", email: host.email },
    ...extra,
  });

  // ── Quote: extra-kid pricing (route) ──────────────────────────────────────
  const quote = await call(R.quote.POST as Handler, { method: "POST", url: "/api/admin/parties/quote", token: A.token, body: { ...createBody(sA.id), kidCount: 12 } });
  const q = data(quote).quote ?? {};
  check("quote: extra kid pricing correct", quote.status === 200 && q.extraKids === 2 && q.subtotalCents === 30000 + 2 * 1500, `${quote.status} ${q.extraKids} ${q.subtotalCents}`);
  check("quote: deposit + due dates in venue TZ", q.depositRequiredCents === Math.round(q.totalCents / 2) && Boolean(q.depositDueAt) && q.timezone === "America/New_York");

  // ── Staff create (route) + room conflict 409 ─────────────────────────────
  const c1 = await call(R.parties.POST as Handler, { method: "POST", url: "/api/admin/parties", token: A.token, body: createBody(sA.id) });
  const p1 = data(c1).party ?? {};
  check("staff create via route (phone)", c1.status === 201 && Boolean(p1.bookingId), String(c1.status));
  const p1Id = String(p1.bookingId);
  const sAend = new Date(new Date(at(9, 15)).getTime() + 3600_000).toISOString();
  const adhoc = await call(R.parties.POST as Handler, {
    method: "POST",
    url: "/api/admin/parties",
    token: A.token,
    body: { ...createBody(""), sessionId: undefined, startsAt: sAend, roomResourceId: room1.id },
  });
  check("room conflict 409 (overlapping room)", adhoc.status === 409 && errCode(adhoc) === "PARTY_ROOM_CONFLICT", `${adhoc.status} ${errCode(adhoc)}`);
  const ovOps = await call(R.parties.POST as Handler, {
    method: "POST",
    url: "/api/admin/parties",
    token: ops.token,
    body: { ...createBody(""), sessionId: undefined, startsAt: sAend, roomResourceId: room1.id, overbook: true, overbookReason: "x" },
  });
  check("ops_manager overbook 403", ovOps.status === 403, String(ovOps.status));
  const qOrg = await call(R.parties.GET as Handler, { url: `/api/admin/parties?orgId=${B.orgId}`, token: A.token });
  check("query orgId rejected 400 (route)", qOrg.status === 400, String(qOrg.status));
  const bOrg = await call(R.parties.POST as Handler, { method: "POST", url: "/api/admin/parties", token: A.token, body: { ...createBody(sB.id), orgId: B.orgId } });
  check("body orgId rejected 400 (route)", bOrg.status === 400, String(bOrg.status));

  // ── Detail + capabilities, hosts, contacts ───────────────────────────────
  const det = await call(R.party.GET as Handler, { url: `/api/admin/parties/${p1Id}`, token: A.token, params: { bookingId: p1Id } });
  const d1 = data(det).party ?? {};
  check("detail has capabilities + no tokens", det.status === 200 && typeof d1.capabilities?.smsAvailable === "boolean" && !/"token"/.test(det.text) && !/viewToken/.test(det.text));
  check("contact email links existing user (host)", d1.userId === host.id);
  const hostsRes = await call(R.hosts.GET as Handler, { url: "/api/admin/parties/hosts", token: ops.token });
  check("hosts list same-org staff only", hostsRes.status === 200 && (data(hostsRes).hosts ?? []).some((h: any) => h.userId === ops.user.id) && !(data(hostsRes).hosts ?? []).some((h: any) => h.userId === B.owner.id));
  const contactsRes = await call(R.contacts.GET as Handler, { url: `/api/admin/parties/contacts?q=${encodeURIComponent(host.email.slice(0, 18))}`, token: A.token });
  check("contact search finds prior contact with account flag", contactsRes.status === 200 && (data(contactsRes).contacts ?? []).some((c: any) => c.email === host.email && c.hasAccount));

  // ── Deposit then balance → PAID ──────────────────────────────────────────
  await takeBookingPayments(A.actor, p1Id, [{ type: "cash", amount: Number(d1.depositRequiredCents) / 100 }], { confirmIfPaid: false });
  const conf = await call(R.confirm.POST as Handler, { method: "POST", url: `/api/admin/parties/${p1Id}/confirm`, token: A.token, params: { bookingId: p1Id }, body: {} });
  check("confirm after deposit (route)", conf.status === 200 && data(conf).party?.status === "confirmed", String(conf.status));
  await new Promise((r) => setTimeout(r, 1500));
  const confNotice = await prisma.notification.count({ where: { userId: host.id, type: "party" } });
  check("in-app party notification to host on confirm", confNotice >= 1, String(confNotice));
  const afterDep = await prisma.booking.findUniqueOrThrow({ where: { id: p1Id } });
  await takeBookingPayments(A.actor, p1Id, [{ type: "cash", amount: Number(afterDep.amountDue) }], { confirmIfPaid: false });
  const list = await call(R.parties.GET as Handler, { url: `/api/admin/parties?date=${at(9, 15).slice(0, 10)}&locationId=${v1.id}`, token: A.token });
  const row = (data(list).parties ?? []).find((p: any) => p.bookingId === p1Id);
  check("deposit then balance to zero shows PAID", row?.amountDueCents === 0 && row?.status === "confirmed", JSON.stringify(row?.amountDueCents));

  // ── Summary CSV / HTML: no secrets ───────────────────────────────────────
  await prisma.bookingPayment.updateMany({ where: { bookingId: p1Id }, data: { stripePaymentIntentId: `pi_secret_${stamp}`, stripeChargeId: `ch_secret_${stamp}` } });
  const csv = await call(R.summary.GET as Handler, { url: `/api/admin/parties/${p1Id}/summary?format=csv`, token: A.token, params: { bookingId: p1Id } });
  const viewToken = (await prisma.booking.findUniqueOrThrow({ where: { id: p1Id }, select: { viewToken: true } })).viewToken;
  check(
    "summary CSV has no secrets",
    csv.status === 200 && csv.contentType.includes("text/csv") && csv.text.includes(String(p1.publicId)) && !/pi_|ch_|cs_|sk_|whsec/.test(csv.text) && !csv.text.includes(viewToken)
  );
  const html = await call(R.summary.GET as Handler, { url: `/api/admin/parties/${p1Id}/summary?format=html`, token: A.token, params: { bookingId: p1Id } });
  check("summary printable HTML", html.status === 200 && html.contentType.includes("text/html") && !/pi_secret|ch_secret/.test(html.text));

  // ── Host (me) APIs ───────────────────────────────────────────────────────
  const meOwn = await call(R.meParty.GET as Handler, { url: `/api/me/parties/${p1Id}`, token: hostToken, params: { id: p1Id } });
  check("profile own party allowed", meOwn.status === 200 && data(meOwn).party?.bookingId === p1Id, String(meOwn.status));
  check("host DTO has no staff/POS notes or host staff", !/posNotes|hostStaffUserId|hostNotes|"notes"/.test(meOwn.text));
  const meOther = await call(R.meParty.GET as Handler, { url: `/api/me/parties/${p1Id}`, token: otherToken, params: { id: p1Id } });
  check("other user's party 404", meOther.status === 404, String(meOther.status));
  const otherRoutes: Array<[Handler, string, unknown]> = [
    [R.meGuests.PATCH as Handler, "PATCH", { guests: [] }],
    [R.meFood.PUT as Handler, "PUT", { lines: [] }],
    [R.meCancel.POST as Handler, "POST", { reason: "x" }],
    [R.meInvites.POST as Handler, "POST", { channel: "link" }],
    [R.mePay.POST as Handler, "POST", {}],
  ];
  let meIdor = 0;
  for (const [h, method, body] of otherRoutes) {
    const r = await call(h, { method, url: `/api/me/parties/${p1Id}/x`, token: otherToken, params: { id: p1Id }, body });
    if (r.status === 404) meIdor += 1;
  }
  check("other user's party 404 on every /api/me/parties/[id]* route", meIdor === otherRoutes.length, `${meIdor}/${otherRoutes.length}`);
  const hostPatch = await call(R.party.PATCH as Handler, { method: "PATCH", url: `/api/admin/parties/${p1Id}`, token: hostToken, params: { bookingId: p1Id }, body: { hostStaffUserId: ops.user.id } });
  const hostOverbook = await call(R.parties.POST as Handler, { method: "POST", url: "/api/admin/parties", token: hostToken, body: { ...createBody(sB.id), overbook: true, overbookReason: "x" } });
  await call(R.meGuests.PATCH as Handler, { method: "PATCH", url: `/api/me/parties/${p1Id}/guests`, token: hostToken, params: { id: p1Id }, body: { hostStaffUserId: ops.user.id, overbook: true, guests: [] } });
  const stillNoHost = await prisma.partyBookingDetail.findUniqueOrThrow({ where: { bookingId: p1Id }, select: { hostStaffUserId: true } });
  check("host cannot assign host staff or overbook", [401, 403].includes(hostPatch.status) && [401, 403].includes(hostOverbook.status) && stillNoHost.hostStaffUserId === null, `${hostPatch.status} ${hostOverbook.status}`);

  // ── Invitations: invalid token, RSVP after cancel, maintenance expiry, bounced ─
  const badInvite = await call(R.pubInvite.GET as Handler, { url: "/api/public/parties/invite/not-a-real-token-xyz123", params: { token: "not-a-real-token-xyz123" } });
  check("invalid invite token 404", badInvite.status === 404, String(badInvite.status));
  const c2 = await call(R.parties.POST as Handler, { method: "POST", url: "/api/admin/parties", token: A.token, body: createBody(sB.id, { roomResourceId: room2.id }) });
  const p2Id = String(data(c2).party?.bookingId);
  const invLink = await call(R.invites.POST as Handler, { method: "POST", url: `/api/admin/parties/${p2Id}/invitations`, token: ops.token, params: { bookingId: p2Id }, body: { channel: "link" } });
  const inv2 = data(invLink).invitation ?? {};
  check("ops_manager creates invitation; canonical /party/invite link", invLink.status === 201 || invLink.status === 200 ? String(inv2.rsvpPath ?? "").startsWith("/party/invite/") : false, `${invLink.status} ${inv2.rsvpPath}`);
  const invEmail = await call(R.invites.POST as Handler, { method: "POST", url: `/api/admin/parties/${p2Id}/invitations`, token: ops.token, params: { bookingId: p2Id }, body: { channel: "email", toEmail: "guest@example.com", send: true } });
  const invEmailId = String(data(invEmail).invitation?.id);
  const bounced = await call(R.inviteBounced.POST as Handler, { method: "POST", url: "/x", token: ops.token, params: { bookingId: p2Id, id: invEmailId } });
  check("mark invitation bounced", bounced.status === 200 && data(bounced).invitation?.status === "bounced", String(bounced.status));
  const invExpire = await invitations.createPartyInvitationForStaff(A.actor, p2Id, { channel: "link" });
  await prisma.partyInvitation.update({ where: { id: invExpire.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
  await runPartyMaintenance(new Date());
  const expired = await prisma.partyInvitation.findUniqueOrThrow({ where: { id: invExpire.id } });
  check("expired invitation moved to cancelled by maintenance", expired.status === "cancelled", expired.status);
  const cancelP2 = await call(R.cancel.POST as Handler, { method: "POST", url: `/api/admin/parties/${p2Id}/cancel`, token: A.token, params: { bookingId: p2Id }, body: { reason: "Family emergency" } });
  check("cancel via route", cancelP2.status === 200, String(cancelP2.status));
  const rsvpAfter = await call(R.pubRsvp.POST as Handler, { method: "POST", url: "/x", params: { token: String(inv2.token) }, body: { accept: true, name: "Late Kid" } });
  check("RSVP after cancel rejected", rsvpAfter.status === 410, `${rsvpAfter.status} ${errCode(rsvpAfter)}`);

  // ── Public flood → 429 ───────────────────────────────────────────────────
  let lastStatus = 0;
  for (let i = 0; i < 62; i++) {
    const r = await call(R.pubInvite.GET as Handler, { url: "/x", params: { token: String(inv2.token) }, ip: `10.250.0.${stamp % 200}` });
    lastStatus = r.status;
    if (r.status === 429) break;
  }
  check("public flood returns 429", lastStatus === 429, String(lastStatus));

  // ── Public: unpublished venue 404; hold → checkout deposit → confirmation ─
  const pubV2 = await call(R.pubPackages.GET as Handler, { url: `/api/public/parties/packages?orgSlug=${A.slug}&venueSlug=${v2.slug}` });
  check("public packages of unpublished venue 404", pubV2.status === 404, String(pubV2.status));
  const hold = await call(R.pubHolds.POST as Handler, { method: "POST", url: "/x", body: { orgSlug: A.slug, venueSlug: v1.slug, productId: pkg.id, sessionId: sPub.id } });
  const h = data(hold).hold ?? {};
  const checkout = await call(R.pubCheckout.POST as Handler, {
    method: "POST",
    url: "/x",
    body: {
      orgSlug: A.slug,
      venueSlug: v1.slug,
      holdId: h.holdId,
      holdToken: h.token,
      kidCount: 11,
      adultCount: 2,
      partyName: "Online party",
      honoreeName: "Zoe",
      contact: { name: "Olive Online", email: `olive-${stamp}@example.com` },
    },
  });
  const co = data(checkout);
  const confirmation = await call(R.pubConfirmation.GET as Handler, {
    url: `/x?viewToken=${encodeURIComponent(String(co.viewToken))}`,
    params: { bookingPublicId: String(co.bookingPublicId) },
  });
  const pubParty = data(confirmation).party ?? {};
  check(
    "public hold → checkout deposit → confirmation",
    hold.status < 300 && checkout.status === 201 && confirmation.status === 200 && pubParty.depositPaidCents >= pubParty.depositRequiredCents && pubParty.depositRequiredCents > 0,
    `${hold.status} ${checkout.status} ${confirmation.status} ${pubParty.depositPaidCents}/${pubParty.depositRequiredCents} ${pubParty.status}`
  );
  check("public confirmation has no guest contacts / tokens", !/email|phone|"token"/i.test(JSON.stringify(pubParty)));
  const pubWrongToken = await call(R.pubConfirmation.GET as Handler, { url: "/x?viewToken=wrongwrongwrongwrong", params: { bookingPublicId: String(co.bookingPublicId) } });
  check("public confirmation needs the view token", pubWrongToken.status === 404 || pubWrongToken.status === 403, String(pubWrongToken.status));

  // ── Webhook replay / success URL / failed checkout ───────────────────────
  const c3 = await engine.createParty(A.actor, engine.parseCreatePartyBody(createBody(sC.id)));
  const pending = await createPendingCardPaymentLocked({ bookingId: c3.bookingId, orgId: A.orgId, locationId: v1.id, amount: 50, tender: "card" });
  const before = Number((await prisma.booking.findUniqueOrThrow({ where: { id: c3.bookingId } })).amountPaid);
  const mismatch = await settleVenueBookingStripePayment({ paymentId: pending.id, bookingId: c3.bookingId, expectedOrgId: B.orgId });
  check("webhook metadata org mismatch is ignored (consistency check)", mismatch.ok === false && (mismatch as { reason?: string }).reason === "org_mismatch");
  const s1 = await settleVenueBookingStripePayment({ paymentId: pending.id, bookingId: c3.bookingId, stripePaymentIntentId: `pi_s2_${stamp}`, expectedOrgId: A.orgId });
  const s2 = await settleVenueBookingStripePayment({ paymentId: pending.id, bookingId: c3.bookingId, stripePaymentIntentId: `pi_s2_${stamp}`, expectedOrgId: A.orgId });
  const s3 = await settleVenueBookingStripePayment({ paymentId: pending.id, bookingId: c3.bookingId, stripePaymentIntentId: `pi_s2_${stamp}` });
  const after = await prisma.booking.findUniqueOrThrow({ where: { id: c3.bookingId }, include: { partyDetail: true } });
  check("webhook replay does not double-pay", s1.ok && s2.ok && Number(after.amountPaid) === before + 50, `${before} → ${after.amountPaid}`);
  check("success-URL confirm after webhook does not double-apply", s3.ok && "idempotent" in s3 && Boolean((s3 as { idempotent?: boolean }).idempotent));
  check("webhook settle syncs depositPaidCents", after.partyDetail!.depositPaidCents === Math.min(5000, after.partyDetail!.depositRequiredCents));
  const c4 = await engine.createParty(A.actor, engine.parseCreatePartyBody(createBody(sD.id)));
  const pend4 = await createPendingCardPaymentLocked({ bookingId: c4.bookingId, orgId: A.orgId, locationId: v1.id, amount: 100, tender: "card" });
  const f4 = await failVenueBookingStripePayment({ paymentId: pend4.id, bookingId: c4.bookingId, trustedSource: true, reason: "expired" });
  const after4 = await prisma.booking.findUniqueOrThrow({ where: { id: c4.bookingId } });
  const pay4 = await prisma.bookingPayment.findUniqueOrThrow({ where: { id: pend4.id } });
  check("failed checkout does not confirm", f4.ok && after4.status !== "confirmed" && pay4.status !== "completed", `${after4.status} ${pay4.status}`);

  // ── Maintenance: expired hold releases room; reminders ───────────────────
  const c5 = await engine.createParty(A.actor, engine.parseCreatePartyBody(createBody(sE.id, { createMode: "hold" })));
  await prisma.booking.update({ where: { id: c5.bookingId }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });
  await runPartyMaintenance(new Date());
  const b5 = await prisma.booking.findUniqueOrThrow({ where: { id: c5.bookingId }, include: { partyDetail: true } });
  const sEsess = await prisma.ticketSession.findUniqueOrThrow({ where: { id: sE.id } });
  const conflicts5 = await rooms.findRoomConflicts({ orgId: A.orgId, roomId: room1.id, startsAt: sEsess.startsAt, endsAt: sEsess.endsAt });
  check("maintenance releases expired hold room", b5.status === "expired" && b5.partyDetail!.opsStatus === "cancelled" && conflicts5.length === 0, `${b5.status} ${b5.partyDetail!.opsStatus} ${conflicts5.length}`);

  const paidDetail = await prisma.partyBookingDetail.findUniqueOrThrow({ where: { bookingId: p1Id } });
  const due = new Date(Date.now() - 60_000);
  await prisma.partyBalanceReminder.create({ data: { orgId: A.orgId, locationId: v1.id, partyDetailId: paidDetail.id, kind: "balance", scheduledFor: due } });
  const c6 = await engine.createParty(A.actor, engine.parseCreatePartyBody(createBody(sF.id)));
  const d6 = await prisma.partyBookingDetail.findUniqueOrThrow({ where: { bookingId: c6.bookingId } });
  const rem6 = await prisma.partyBalanceReminder.create({ data: { orgId: A.orgId, locationId: v1.id, partyDetailId: d6.id, kind: "balance", scheduledFor: new Date(Date.now() - 30_000) } });
  const noticeBefore = await prisma.notification.count({ where: { userId: host.id, type: "party", metadata: { path: ["event"], equals: "balance_due" } } });
  await runPartyMaintenance(new Date());
  await runPartyMaintenance(new Date());
  const paidRem = await prisma.partyBalanceReminder.findFirstOrThrow({ where: { partyDetailId: paidDetail.id, scheduledFor: due } });
  const sentRem = await prisma.partyBalanceReminder.findUniqueOrThrow({ where: { id: rem6.id } });
  const noticeAfter = await prisma.notification.count({ where: { userId: host.id, type: "party", metadata: { path: ["event"], equals: "balance_due" } } });
  check("balance reminder skipped when paid", paidRem.skippedReason === "paid" && paidRem.sentAt === null, `${paidRem.skippedReason}`);
  check("balance reminder sent once when due", sentRem.sentAt !== null && sentRem.skippedReason === null && noticeAfter - noticeBefore === 1, `${sentRem.sentAt} ${sentRem.skippedReason} ${noticeAfter - noticeBefore}`);

  // ── finance can refund, ops_manager cannot ───────────────────────────────
  const refOps = await call(R.refunds.POST as Handler, { method: "POST", url: `/api/admin/bookings/${p1Id}/refunds`, token: ops.token, params: { id: p1Id }, body: { amount: 1, reason: "x" } });
  check("ops_manager refund 403", refOps.status === 403, String(refOps.status));
  const refFin = await call(R.refunds.POST as Handler, { method: "POST", url: `/api/admin/bookings/${p1Id}/refunds`, token: fin.token, params: { id: p1Id }, body: { amount: 1, reason: "goodwill" } });
  check("finance can refund", refFin.status >= 200 && refFin.status < 300, `${refFin.status} ${errCode(refFin)}`);
  const afterRefund = await prisma.booking.findUniqueOrThrow({ where: { id: p1Id }, include: { partyDetail: true } });
  check("refund syncs party money (amountDue only balance)", Number(afterRefund.amountDue) === 1 && afterRefund.partyDetail!.depositPaidCents === Math.min(Math.round(Number(afterRefund.amountPaid) * 100), afterRefund.partyDetail!.depositRequiredCents));

  // ── Location scope (route) ───────────────────────────────────────────────
  const pV2 = await engine.createParty(A.actor, engine.parseCreatePartyBody({ ...createBody(sV2.id), locationId: v2.id, productId: pkgV2.id, kidCount: 8 }));
  const scoped = await call(R.parties.GET as Handler, { url: "/api/admin/parties", token: parkOps.token });
  const scopedRows = (data(scoped).parties ?? []) as Array<{ locationId: string; bookingId: string }>;
  check("location-scoped actor sees only its venue", scoped.status === 200 && scopedRows.length > 0 && scopedRows.every((r) => r.locationId === v2.id) && scopedRows.some((r) => r.bookingId === pV2.bookingId), `${scoped.status} ${scopedRows.length}`);
  const scopedOther = await call(R.party.GET as Handler, { url: `/api/admin/parties/${p1Id}`, token: parkOps.token, params: { bookingId: p1Id } });
  check("location-scoped actor 404 on other venue party", scopedOther.status === 404, String(scopedOther.status));

  // ── POS proxy through posAdapter → partyEngine ───────────────────────────
  const posActor = { ...A.actor, permissions: [...ROLE_PRESETS.platform_admin] };
  const sPos = await sess(pkg, 14, 15);
  const posParty = await createPartyFromPos(posActor as never, {
    locationId: v1.id,
    admissionProductId: pkg.id,
    sessionId: sPos.id,
    modifiers: { partyKidCount: 10, partyAdultCount: 2, partyName: "POS party" },
    guestName: "Pat Pos",
  });
  const posRow = await prisma.booking.findUniqueOrThrow({ where: { id: posParty.bookingId }, include: { partyDetail: true } });
  check("posAdapter + partyEngine importable; POS party proxy creates a party", posRow.channel === "pos" && Boolean(posRow.partyDetail));

  // ── Export: same-org only, no Stripe ids ─────────────────────────────────
  const bParty = await engine.createParty(B.actor, engine.parseCreatePartyBody({
    channel: "phone",
    locationId: bVenue.id,
    productId: (await packages.createPartyPackage(B.actor, { locationId: bVenue.id, name: "B pkg", maxGuests: 20, durationMinutes: 60, includedKids: 5, includedAdults: 1, packagePriceCents: 1000, roomAssignedAtBooking: true, published: true })).id,
    startsAt: at(9, 16),
    kidCount: 5,
    adultCount: 1,
    partyName: "B party",
    contact: { name: "Bea" },
  }));
  const exp = await buildCompanyWorkspaceExport(A.orgId);
  const expJson = JSON.stringify(exp.parties);
  check(
    "export contains only same-org parties and no Stripe ids",
    exp.parties.bookings.some((p) => p.publicId === p1.publicId) && !exp.parties.bookings.some((p) => p.publicId === bParty.publicId) && !/pi_|ch_|cs_|whsec|"token"|viewToken/.test(expJson),
    `${exp.parties.bookings.length} parties`
  );

  // ── IDOR: org B staff on org A party routes → 404 ────────────────────────
  const anyGuest = await prisma.partyGuest.findFirst({ where: { partyDetail: { bookingId: p1Id } }, select: { id: true } });
  const anyInvite = await prisma.partyInvitation.findFirst({ where: { partyDetail: { bookingId: p2Id } }, select: { id: true } });
  const idParams = { bookingId: p1Id, guestId: anyGuest?.id ?? "cmx0000000000000000000000", id: anyInvite?.id ?? "cmx0000000000000000000000" };
  const idor: Array<[string, Handler, string, unknown]> = [
    ["GET detail", R.party.GET as Handler, "GET", undefined],
    ["PATCH detail", R.party.PATCH as Handler, "PATCH", { partyName: "x" }],
    ["confirm", R.confirm.POST as Handler, "POST", {}],
    ["cancel", R.cancel.POST as Handler, "POST", { reason: "x" }],
    ["reactivate", R.reactivate.POST as Handler, "POST", {}],
    ["GET guests", R.guests.GET as Handler, "GET", undefined],
    ["POST guests", R.guests.POST as Handler, "POST", { name: "x" }],
    ["PATCH guests", R.guests.PATCH as Handler, "PATCH", { guests: [] }],
    ["PATCH guest", R.guest.PATCH as Handler, "PATCH", { name: "x" }],
    ["DELETE guest", R.guest.DELETE as Handler, "DELETE", undefined],
    ["GET invitations", R.invites.GET as Handler, "GET", undefined],
    ["POST invitations", R.invites.POST as Handler, "POST", { channel: "link" }],
    ["cancel invitation", R.inviteCancel.POST as Handler, "POST", {}],
    ["bounced invitation", R.inviteBounced.POST as Handler, "POST", {}],
    ["GET food", R.food.GET as Handler, "GET", undefined],
    ["PUT food", R.food.PUT as Handler, "PUT", { lines: [] }],
    ["food submit", R.foodSubmit.POST as Handler, "POST", {}],
    ["food cancel", R.foodCancel.POST as Handler, "POST", {}],
    ["room", R.room.POST as Handler, "POST", { roomResourceId: null }],
    ["host", R.host.PATCH as Handler, "PATCH", { hostStaffUserId: null }],
    ["GET run-sheet", R.runSheet.GET as Handler, "GET", undefined],
    ["PUT run-sheet", R.runSheet.PUT as Handler, "PUT", { items: [] }],
    ["summary", R.summary.GET as Handler, "GET", undefined],
    ["summary csv", R.summary.GET as Handler, "GET", undefined],
  ];
  const leaks: string[] = [];
  for (const [label, h, method, body] of idor) {
    const r = await call(h, { method, url: label === "summary csv" ? "/x?format=csv" : "/x", token: B.token, params: idParams, body });
    if (r.status !== 404) leaks.push(`${label}:${r.status}`);
  }
  check(`IDOR cross-tenant 404 on every party id route (${idor.length})`, leaks.length === 0, leaks.join(" "));

  // ── Balances route + signup ──────────────────────────────────────────────
  const bal = await call(R.balances.GET as Handler, { url: "/api/admin/parties/balances?status=due", token: fin.token });
  check("finance can read balances", bal.status === 200 && typeof data(bal).outstandingCents === "number");
  const signup = await signupPost(new Request("http://localhost/api/auth/signup", { method: "POST", body: "{}" }));
  check("/api/auth/signup still 410", signup.status === 410);

  await teardownSmokeData(prisma, createdOrgIds, createdUserIds);

  if (failed) {
    console.error(`\n${failed} party Step 2 check(s) failed`);
    process.exitCode = 1;
    return;
  }
  console.log("\nAll Party Management Step 2 smoke checks passed");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    try {
      const appPrisma = (await import("../src/lib/prisma.ts")).default;
      await appPrisma.$disconnect();
    } catch {
      /* ignore */
    }
  });
