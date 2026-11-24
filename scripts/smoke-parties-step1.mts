/**
 * Party Management Step 1 smoke (gates, catalog, party engine, money sync,
 * guests, invitations, food + kitchen, public, host, POS).
 *   yarn smoke:parties:step1
 */
import { PrismaClient } from "@prisma/client";
import { loadDatabaseUrl } from "./prisma-env.mjs";
import { teardownSmokeData } from "./party-smoke-teardown.mts";

// POS_SMOKE also keeps the Prisma pool tiny (shared Supabase pooler) — set before loading the URL.
process.env.POS_SMOKE = "1";
loadDatabaseUrl();
const prisma = new PrismaClient();

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function errInfo(err: unknown) {
  const e = err as { code?: string; status?: number; message?: string };
  return {
    code: typeof e?.code === "string" ? e.code : e?.message ?? String(err),
    status: typeof e?.status === "number" ? e.status : 0,
    message: e?.message ?? String(err),
  };
}

async function expectErr(
  name: string,
  fn: () => Promise<unknown>,
  ok: (info: ReturnType<typeof errInfo>) => boolean
) {
  try {
    await fn();
    check(name, false, "call succeeded");
  } catch (err) {
    const info = errInfo(err);
    check(name, ok(info), `${info.status} ${info.code}`);
  }
}

const is404 = (i: ReturnType<typeof errInfo>) => i.status === 404;
const code = (c: string) => (i: ReturnType<typeof errInfo>) => i.code === c;

async function main() {
  process.env.TICKETING_PAYMENT_LINK_STUB = "1";
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.NOTIFICATION_EMAIL_USER;

  const { createOrganizationWithPlatformAdmin } = await import("../src/lib/orgRegistration.ts");
  const { createVenueLocation, archiveVenueLocation } = await import("../src/lib/venueLocations.ts");
  const { replaceMembershipVenueAssignments } = await import("../src/lib/parkAdminScope.ts");
  const { getStorefrontOrgId } = await import("../src/lib/org.ts");
  const { clearCachedStaffGatesForOrg } = await import("../src/lib/ticketing/staffGateCache.ts");
  const { ROLE_PRESETS, P, API_PERMISSIONS, ADMIN_ROUTE_PERMISSIONS, adminPathRequiresRegisteredCompanyOrg } =
    await import("../src/lib/auth/permissions.ts");
  const { isDemoAllowedAdminPath } = await import("../src/lib/demoPlanLock.ts");
  const { partyStaffContext } = await import("../src/lib/parties/gate.ts");
  const rooms = await import("../src/lib/parties/rooms.ts");
  const menu = await import("../src/lib/parties/menu.ts");
  const settingsLib = await import("../src/lib/parties/settings.ts");
  const packages = await import("../src/lib/parties/packages.ts");
  const engine = await import("../src/lib/parties/partyEngine.ts");
  const guests = await import("../src/lib/parties/guests.ts");
  const invitations = await import("../src/lib/parties/invitations.ts");
  const food = await import("../src/lib/parties/food.ts");
  const runSheet = await import("../src/lib/parties/runSheet.ts");
  const { getPartySummary } = await import("../src/lib/parties/summary.ts");
  const { listPartyBalances } = await import("../src/lib/parties/balances.ts");
  const { getTodayParties } = await import("../src/lib/parties/frontDesk.ts");
  const owner = await import("../src/lib/parties/owner.ts");
  const publicParties = await import("../src/lib/parties/publicParties.ts");
  const { computePartyDueDates } = await import("../src/lib/parties/deposits.ts");
  const { recomputePartyWaiverStatus } = await import("../src/lib/parties/waivers.ts");
  const { listPartyWaiverGaps } = await import("../src/lib/waivers/desk.ts");
  const { takeBookingPayments, createPendingCardPaymentLocked, settleVenueBookingStripePayment } =
    await import("../src/lib/ticketing/payments.ts");
  const { createPaymentLink, payViaPaymentLink } = await import("../src/lib/ticketing/paymentLinks.ts");
  const { refundBooking } = await import("../src/lib/ticketing/refunds.ts");
  const { createPosProduct } = await import("../src/lib/pos/catalog.ts");
  const { createPosDevice } = await import("../src/lib/pos/devices.ts");
  const { openTill } = await import("../src/lib/pos/tills.ts");
  const { openCart, addCartLine, checkoutCart } = await import("../src/lib/pos/saleEngine.ts");
  const { POST: signupPost } = await import("../src/app/api/auth/signup/route.ts");

  const stamp = Date.now();
  const createdOrgIds: string[] = [];
  const createdUserIds: string[] = [];

  async function user(tag: string, email?: string) {
    const row = await prisma.user.create({
      data: {
        email: email ?? `smoke-party-${tag}-${stamp}@test.local`,
        password: "x",
        username: `smokeparty${tag}${stamp}`.slice(0, 40),
        firstName: "Party",
        lastName: tag,
        role: "client",
        isVerified: true,
        joinedAt: new Date(),
      },
    });
    createdUserIds.push(row.id);
    return row;
  }

  async function org(
    tag: string,
    data: { plan?: string; status?: string; subStatus?: string; endsAt?: Date }
  ) {
    const owner = await user(tag);
    const reg = await createOrganizationWithPlatformAdmin({
      name: `Party ${tag} ${stamp}`,
      slug: `party-${tag}-${stamp}`,
      userId: owner.id,
    });
    const orgId = reg.organization.id;
    createdOrgIds.push(orgId);
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        status: (data.status ?? "active") as never,
        subscriptionPlan: data.plan ?? "growth",
        subscriptionStatus: data.subStatus ?? "active",
        subscriptionEndsAt: data.endsAt ?? new Date(Date.now() + 30 * 86400000),
      },
    });
    await prisma.taxSettings.upsert({
      where: { orgId },
      create: { orgId, enabled: false, rate: 0 },
      update: { enabled: false, rate: 0 },
    });
    clearCachedStaffGatesForOrg(orgId);
    const actor = {
      orgId,
      sub: owner.id,
      rolePreset: "platform_admin",
      preset: "platform_admin",
      membershipRole: "platform_admin",
      companyWideView: true,
    };
    return { orgId, owner, actor, slug: reg.organization.slug };
  }

  // ── Orgs ────────────────────────────────────────────────────────────────
  const A = await org("a", { plan: "growth" });
  const B = await org("b", { plan: "growth" });
  const S = await org("s", { plan: "starter" });
  const D = await org("d", { plan: "demo" });
  const PE = await org("pe", { plan: "starter" });
  const SU = await org("su", { plan: "starter" });
  const SH = await org("sh", { plan: "starter", subStatus: "past_due", endsAt: new Date(Date.now() - 86400000) });
  const PD = await org("pd", { plan: "starter", subStatus: "past_due", endsAt: new Date(Date.now() + 5 * 86400000) });
  await prisma.organization.update({ where: { id: PE.orgId }, data: { status: "pending" as never } });
  await prisma.organization.update({ where: { id: SU.orgId }, data: { status: "suspended" as never } });
  for (const o of [PE, SU]) clearCachedStaffGatesForOrg(o.orgId);
  const admin = A.actor;
  const ops = { ...A.actor, rolePreset: "ops_manager", preset: "ops_manager", permissions: [...ROLE_PRESETS.ops_manager] };

  // ── Gates ───────────────────────────────────────────────────────────────
  await expectErr("demo denied", () => partyStaffContext(D.actor), (i) => i.status === 403);
  const storefrontOrgId = await getStorefrontOrgId();
  if (storefrontOrgId) {
    await expectErr(
      "storefront denied",
      () => partyStaffContext({ ...A.actor, orgId: storefrontOrgId }),
      (i) => i.status === 403
    );
  } else {
    check("storefront denied", false, "no storefront org configured");
  }
  await expectErr("pending denied", () => partyStaffContext(PE.actor), (i) => i.status === 403);
  await expectErr("suspended denied", () => partyStaffContext(SU.actor), (i) => i.status === 403);
  const shVenue = await prisma.venueLocation.create({
    data: { orgId: SH.orgId, name: "SH park", slug: `sh-${stamp}`, status: "active" },
  });
  await expectErr(
    "soft-hold create denied",
    () => rooms.createPartyRoom(SH.actor, { locationId: shVenue.id, name: "Room", defaultCapacity: 10 }),
    (i) => i.status === 403
  );
  const pdVenue = await createVenueLocation(PD.actor, { name: `PD ${stamp}`, slug: `pd-${stamp}` });
  const pdRoom = await rooms.createPartyRoom(PD.actor, { locationId: pdVenue.id, name: "PD Room", defaultCapacity: 10 });
  check("past_due entitled allowed", Boolean(pdRoom.id));
  const sVenue = await createVenueLocation(S.actor, { name: `S ${stamp}`, slug: `s-${stamp}` });
  const sRoom = await rooms.createPartyRoom(S.actor, { locationId: sVenue.id, name: "S Room", defaultCapacity: 0 });
  check("starter allowed", Boolean(sRoom.id));

  // ── Venues + catalog ────────────────────────────────────────────────────
  const v1 = await createVenueLocation(admin, { name: `Park One ${stamp}`, slug: `p1-${stamp}` });
  const v2 = await createVenueLocation(admin, { name: `Park Two ${stamp}`, slug: `p2-${stamp}` });
  const v3 = await createVenueLocation(admin, { name: `Park Three ${stamp}`, slug: `p3-${stamp}` });
  await prisma.venueLocation.update({ where: { id: v1.id }, data: { publicBookingEnabled: true } });
  const bVenue = await createVenueLocation(B.actor, { name: `B Park ${stamp}`, slug: `bp-${stamp}` });

  await expectErr(
    "body orgId rejected",
    () => rooms.createPartyRoom(admin, { orgId: B.orgId, locationId: v1.id, name: "X", defaultCapacity: 1 }),
    (i) => /orgId cannot be set/.test(i.message)
  );
  await expectErr(
    "body orgId rejected on party create",
    async () => engine.parseCreatePartyBody({ orgId: B.orgId, partyName: "x", productId: "x" }),
    (i) => /orgId cannot be set/.test(i.message)
  );

  const room1 = await rooms.createPartyRoom(admin, { locationId: v1.id, name: "Room One", defaultCapacity: 30 });
  const room2 = await rooms.createPartyRoom(admin, { locationId: v1.id, name: "Room Two", defaultCapacity: 30 });
  const room3 = await rooms.createPartyRoom(admin, { locationId: v1.id, name: "Room Three", defaultCapacity: 30 });
  const roomV2 = await rooms.createPartyRoom(admin, { locationId: v2.id, name: "Room Two-A", defaultCapacity: 20 });
  await expectErr(
    "room name unique case-insensitive",
    () => rooms.createPartyRoom(admin, { locationId: v1.id, name: "room one", defaultCapacity: 5 }),
    code("PARTY_NAME_TAKEN")
  );
  const tmpRoom = await rooms.createPartyRoom(admin, { locationId: v1.id, name: "Temp Room", defaultCapacity: 5 });
  const archivedRoom = await rooms.updatePartyRoom(admin, tmpRoom.id, { archive: true });
  check("room CRUD archive", Boolean(archivedRoom.archivedAt));
  const renamed = await rooms.updatePartyRoom(admin, room3.id, { name: "Room Three B", defaultCapacity: 25 });
  check("room CRUD update", renamed.name === "Room Three B" && renamed.defaultCapacity === 25);

  await archiveVenueLocation(admin, v3.id);
  await expectErr(
    "archived venue cannot create room",
    () => rooms.createPartyRoom(admin, { locationId: v3.id, name: "Nope", defaultCapacity: 5 }),
    (i) => i.status === 403
  );
  await expectErr(
    "archived venue cannot create package",
    () => packages.createPartyPackage(admin, { locationId: v3.id, name: "Nope pkg" }),
    (i) => i.status === 403
  );

  const posActor = { ...admin, permissions: [...ROLE_PRESETS.platform_admin] };
  const posPizza = await createPosProduct(posActor, { locationId: v1.id, kind: "food", name: "POS Pizza", price: 12 });
  const posV2 = await createPosProduct(posActor, { locationId: v2.id, kind: "food", name: "V2 Pizza", price: 9 });
  const pizza = await menu.createPartyMenuItem(admin, {
    locationId: v1.id,
    name: "Pizza",
    kind: "food",
    priceCents: 1500,
    posProductId: posPizza.id,
  });
  const cake = await menu.createPartyMenuItem(admin, { locationId: v1.id, name: "Cake", kind: "cake", priceCents: 2500 });
  const v2Item = await menu.createPartyMenuItem(admin, { locationId: v2.id, name: "V2 Fries", kind: "food", priceCents: 500 });
  await expectErr(
    "menu POS product from another venue rejected",
    () => menu.createPartyMenuItem(admin, { locationId: v1.id, name: "Bad link", priceCents: 100, posProductId: posV2.id }),
    code("PARTY_MENU_ITEM_INVALID")
  );
  const toggled = await menu.updatePartyMenuItem(admin, cake.id, { available: false });
  await menu.updatePartyMenuItem(admin, cake.id, { available: true });
  check("menu CRUD toggle", toggled.available === false);

  await settingsLib.patchPartySettings(admin, {
    values: { defaultDepositPercent: 50, foodOrderCutoffMinutes: 60, requireDepositToConfirm: true },
  });
  await settingsLib.patchPartySettings(admin, { locationId: v1.id, values: { invitationExpiresHours: 48 } });
  const sv = await settingsLib.getPartySettingsForStaff(admin, v1.id);
  check(
    "settings org default vs venue override",
    sv.sources.invitationExpiresHours === "venue_override" &&
      sv.sources.defaultDepositPercent === "org_default" &&
      sv.values.invitationExpiresHours === 48 &&
      sv.values.defaultDepositPercent === 50
  );
  await settingsLib.patchPartySettings(admin, { locationId: v1.id, values: { hostCancelCutoffHours: 2 } });
  const reset = await settingsLib.patchPartySettings(admin, { locationId: v1.id, resetFields: ["hostCancelCutoffHours"] });
  check("settings reset-to-default", reset.sources.hostCancelCutoffHours === "org_default");

  await expectErr(
    "invalid publish (no duration, no max guests) 400",
    () =>
      packages.createPartyPackage(admin, {
        locationId: v1.id,
        name: "Bad pkg",
        durationMinutes: null,
        maxGuests: null,
        published: true,
      }),
    (i) => i.code === "PARTY_PACKAGE_INVALID" && i.status === 400
  );
  try {
    await packages.createPartyPackage(admin, { locationId: v1.id, name: "Bad pkg 2", published: true });
  } catch (err) {
    const fields = (err as { fields?: Record<string, string> }).fields ?? {};
    check("publish field errors", Boolean(fields.maxGuests && fields.packagePriceCents && fields.roomResourceId));
  }

  const pkg = await packages.createPartyPackage(admin, {
    locationId: v1.id,
    name: `Birthday Blast ${stamp}`,
    minGuests: 1,
    maxGuests: 30,
    durationMinutes: 120,
    includedKids: 10,
    includedAdults: 2,
    extraKidPriceCents: 1500,
    extraAdultPriceCents: 1000,
    packagePriceCents: 30000,
    roomResourceId: room1.id,
    published: true,
    newAddOns: [{ name: "Goody bags", priceCents: 500 }],
  });
  check("package CRUD create + publish", pkg.published && pkg.config.includedKids === 10 && pkg.addOns.length === 1);
  const goody = pkg.addOns[0]!;
  const draftPkg = await packages.createPartyPackage(admin, { locationId: v1.id, name: `Draft ${stamp}` });
  const archivedPkg = await packages.createPartyPackage(admin, {
    locationId: v1.id,
    name: `Old ${stamp}`,
    maxGuests: 10,
    includedKids: 5,
    includedAdults: 1,
    packagePriceCents: 1000,
    roomAssignedAtBooking: true,
    published: true,
  });
  await packages.archivePartyPackage(admin, archivedPkg.id);
  const edited = await packages.updatePartyPackage(admin, draftPkg.id, { description: "Edited" });
  check("package CRUD edit", edited.description === "Edited");

  const day = (n: number, hourUtc: number) => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + n);
    d.setUTCHours(hourUtc, 0, 0, 0);
    return d;
  };
  const [s1] = await packages.createPartyPackageSessions(admin, pkg.id, { startsAt: day(3, 15).toISOString(), capacity: 5 });
  const [s2] = await packages.createPartyPackageSessions(admin, pkg.id, { startsAt: day(3, 16).toISOString(), capacity: 5 });
  const [s3] = await packages.createPartyPackageSessions(admin, pkg.id, { startsAt: day(4, 15).toISOString(), capacity: 5 });
  const [s4] = await packages.createPartyPackageSessions(admin, pkg.id, { startsAt: day(5, 15).toISOString(), capacity: 5 });
  const [s5] = await packages.createPartyPackageSessions(admin, pkg.id, { startsAt: day(6, 15).toISOString(), capacity: 5 });
  const [s6] = await packages.createPartyPackageSessions(admin, pkg.id, { startsAt: day(7, 15).toISOString(), capacity: 5 });
  const [s7] = await packages.createPartyPackageSessions(admin, pkg.id, { startsAt: day(8, 15).toISOString(), capacity: 5 });
  const series = await packages.createPartyPackageSessions(admin, pkg.id, {
    startsAt: day(10, 17).toISOString(),
    capacity: 2,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    untilDate: day(12, 23).toISOString(),
  });
  check("package sessions single + weekday series", Boolean(s1?.id) && series.length >= 2);

  // Cross-tenant catalog ids → 404
  await expectErr("cross-tenant package 404", () => packages.getPartyPackage(B.actor, pkg.id), is404);
  await expectErr("cross-tenant package patch 404", () => packages.updatePartyPackage(B.actor, pkg.id, { name: "x" }), is404);
  await expectErr("cross-tenant package archive 404", () => packages.archivePartyPackage(B.actor, pkg.id), is404);
  await expectErr("cross-tenant package sessions 404", () => packages.listPartyPackageSessions(B.actor, pkg.id), is404);
  await expectErr("cross-tenant room 404", () => rooms.updatePartyRoom(B.actor, room1.id, { name: "x" }), is404);
  await expectErr("cross-tenant menu 404", () => menu.updatePartyMenuItem(B.actor, pizza.id, { name: "x" }), is404);

  // ── Public catalog ──────────────────────────────────────────────────────
  const pub = await publicParties.listPublicPartyPackages(A.slug, v1.slug);
  const pubIds = pub.packages.map((p) => p.id);
  check(
    "public lists published only (not draft / archived)",
    pubIds.includes(pkg.id) && !pubIds.includes(draftPkg.id) && !pubIds.includes(archivedPkg.id)
  );
  await expectErr("public unpublished venue 404", () => publicParties.listPublicPartyPackages(A.slug, v2.slug), is404);

  // ── DST due dates ───────────────────────────────────────────────────────
  const due = computePartyDueDates({
    visitStartsAt: new Date("2026-03-09T14:00:00Z"),
    timezone: "America/New_York",
    settings: { depositDueMode: "days_before_event", depositDaysBefore: 1, balanceDueMode: "on_arrival", balanceDaysBefore: 0 },
    depositRequiredCents: 100,
    now: new Date("2026-01-01T00:00:00Z"),
  });
  check(
    "due dates venue TZ across DST",
    due.depositDueAt?.toISOString() === "2026-03-08T05:00:00.000Z" &&
      due.balanceDueAt?.toISOString() === "2026-03-09T14:00:00.000Z",
    `${due.depositDueAt?.toISOString()}`
  );

  // ── Create (phone) ──────────────────────────────────────────────────────
  const hostEmail = `smoke-party-host-${stamp}@test.local`;
  const hostUser = await user("host", hostEmail);
  const otherClient = await user("other");
  const s1Before = (await prisma.ticketSession.findUniqueOrThrow({ where: { id: s1.id } })).remaining;
  const party1 = await engine.createParty(
    admin,
    engine.parseCreatePartyBody({
      channel: "phone",
      locationId: v1.id,
      productId: pkg.id,
      sessionId: s1.id,
      kidCount: 12,
      adultCount: 3,
      partyName: "Mia's 7th",
      honoreeName: "Mia",
      honoreeAge: 7,
      contact: { name: "Pat Parent", email: hostEmail, phone: "555-0101" },
      addOns: [{ productId: goody.productId, qty: 1 }],
    })
  );
  const p1Row = await prisma.booking.findUniqueOrThrow({ where: { id: party1.bookingId }, include: { partyDetail: true } });
  check(
    "phone create → Booking + PartyBookingDetail",
    p1Row.channel === "phone" && Boolean(p1Row.partyDetail) && p1Row.partyDetail!.locationId === v1.id
  );
  check("party held + ops held", p1Row.status === "hold" && p1Row.partyDetail!.opsStatus === "held");
  check(
    "extra-head pricing (2 kids × 15 + 1 adult × 10 + goody 5)",
    party1.totalCents === 30000 + 3000 + 1000 + 500,
    String(party1.totalCents)
  );
  check("deposit 50% of total", party1.depositRequiredCents === Math.round(party1.totalCents / 2));
  check("contact email links existing user", p1Row.userId === hostUser.id);
  const s1After = (await prisma.ticketSession.findUniqueOrThrow({ where: { id: s1.id } })).remaining;
  check("hold takes one party slot", s1After === s1Before - 1);
  const reminders = await prisma.partyBalanceReminder.count({ where: { partyDetailId: p1Row.partyDetail!.id } });
  check("reminders scheduled", reminders >= 1, String(reminders));

  await expectErr(
    "counts above package cap",
    () =>
      engine.createParty(
        admin,
        engine.parseCreatePartyBody({ channel: "phone", locationId: v1.id, productId: pkg.id, sessionId: s3.id, kidCount: 40, adultCount: 0, partyName: "Too big", contact: { name: "X" } })
      ),
    code("PARTY_COUNTS_INVALID")
  );
  await expectErr(
    "unpublished package cannot be booked",
    () =>
      engine.createParty(
        admin,
        engine.parseCreatePartyBody({ channel: "phone", locationId: v1.id, productId: draftPkg.id, startsAt: day(3, 18).toISOString(), kidCount: 5, adultCount: 1, partyName: "Draft", contact: { name: "X" } })
      ),
    code("PARTY_PACKAGE_INVALID")
  );
  await expectErr(
    "archived room cannot be assigned",
    () =>
      engine.createParty(
        admin,
        engine.parseCreatePartyBody({ channel: "phone", locationId: v1.id, productId: pkg.id, sessionId: s3.id, roomResourceId: tmpRoom.id, kidCount: 5, adultCount: 1, partyName: "Archived room", contact: { name: "X" } })
      ),
    code("PARTY_ROOM_ARCHIVED")
  );

  // ── Room conflicts ──────────────────────────────────────────────────────
  const conflictBody = { channel: "phone", locationId: v1.id, productId: pkg.id, sessionId: s2.id, kidCount: 5, adultCount: 1, partyName: "Overlap", contact: { name: "Olive" } };
  await expectErr("overlapping room 409", () => engine.createParty(admin, engine.parseCreatePartyBody(conflictBody)), (i) => i.code === "PARTY_ROOM_CONFLICT" && i.status === 409);
  await expectErr(
    "overbook without permission 403",
    () => engine.createParty(ops, engine.parseCreatePartyBody({ ...conflictBody, overbook: true, overbookReason: "VIP" })),
    (i) => i.code === "OVERBOOK_FORBIDDEN" && i.status === 403
  );
  const overbooked = await engine.createParty(admin, engine.parseCreatePartyBody({ ...conflictBody, overbook: true, overbookReason: "Owner approved" }));
  const obAct = await prisma.bookingActivity.findMany({ where: { bookingId: overbooked.bookingId } });
  check(
    "overbook with permission succeeds + reason logged",
    overbooked.status === "hold" && JSON.stringify(obAct.map((a) => a.payload)).includes("Owner approved")
  );

  // Concurrent last-room race: two creates on the same room + window.
  const raceBody = { channel: "phone", locationId: v1.id, productId: pkg.id, sessionId: s3.id, kidCount: 5, adultCount: 1, partyName: "Race", contact: { name: "Rae" } };
  const race = await Promise.allSettled([
    engine.createParty(admin, engine.parseCreatePartyBody(raceBody)),
    engine.createParty(admin, engine.parseCreatePartyBody(raceBody)),
  ]);
  const winners = race.filter((r) => r.status === "fulfilled").length;
  const loser = race.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
  check("last-room race: exactly one wins", winners === 1 && errInfo(loser?.reason).code === "PARTY_ROOM_CONFLICT", `${winners} ${errInfo(loser?.reason).code}`);
  const raceDetails = await prisma.partyBookingDetail.count({ where: { orgId: A.orgId, partyName: "Race" } });
  check("race loser leaves no party row", raceDetails === 1, String(raceDetails));

  // ── Guests ──────────────────────────────────────────────────────────────
  await guests.addPartyGuest(admin, party1.bookingId, { kind: "honoree", name: "Mia", age: 7 });
  await expectErr("one honoree only", () => guests.addPartyGuest(admin, party1.bookingId, { kind: "honoree", name: "Mia 2" }), code("PARTY_HONOREE_EXISTS"));
  for (let i = 0; i < 11; i++) await guests.addPartyGuest(admin, party1.bookingId, { kind: "kid", name: `Kid ${i}` });
  await expectErr("guest cap rejected", () => guests.addPartyGuest(admin, party1.bookingId, { kind: "kid", name: "Kid 13" }), code("PARTY_GUEST_CAP"));
  await guests.addPartyGuest(admin, party1.bookingId, { kind: "adult", name: "Aunt", email: `aunt-${stamp}@ex.com` });
  await expectErr(
    "duplicate guest email rejected",
    () => guests.addPartyGuest(admin, party1.bookingId, { kind: "chaperone", name: "Aunt 2", email: `AUNT-${stamp}@ex.com` }),
    code("PARTY_GUEST_DUPLICATE_EMAIL")
  );
  const detailAfterGuests = await prisma.partyBookingDetail.findUniqueOrThrow({ where: { bookingId: party1.bookingId }, include: { guests: true } });
  check("waiverMissingCount recomputed from waivers lib", detailAfterGuests.waiverMissingCount === detailAfterGuests.guests.length, `${detailAfterGuests.waiverMissingCount}/${detailAfterGuests.guests.length}`);
  const gaps = await listPartyWaiverGaps(admin, party1.bookingId);
  check("waiver party-chase gaps still work", gaps.available === true && gaps.guests.length === detailAfterGuests.guests.length);

  // ── Deposit gate ────────────────────────────────────────────────────────
  await expectErr("deposit required blocks confirm", () => engine.confirmParty(admin, party1.bookingId), code("PARTY_DEPOSIT_REQUIRED"));
  await expectErr(
    "deposit override needs the setting",
    () => engine.confirmParty(admin, party1.bookingId, { overrideReason: "VIP" }),
    code("PARTY_DEPOSIT_REQUIRED")
  );
  const party2 = await engine.createParty(admin, engine.parseCreatePartyBody({ channel: "walk_in", locationId: v1.id, productId: pkg.id, sessionId: s4.id, roomResourceId: room1.id, kidCount: 8, adultCount: 2, partyName: "Override party", contact: { name: "Owen" } }));
  await settingsLib.patchPartySettings(admin, { locationId: v1.id, values: { allowConfirmWithoutDeposit: true } });
  await expectErr("deposit override needs a reason", () => engine.confirmParty(admin, party2.bookingId, { overrideReason: "" }), code("PARTY_REASON_REQUIRED"));
  const p2c = await engine.confirmParty(admin, party2.bookingId, { overrideReason: "Regular customer" });
  const p2Act = await prisma.bookingActivity.findMany({ where: { bookingId: party2.bookingId } });
  check(
    "deposit override with setting + reason (logged)",
    p2c.status === "confirmed" && JSON.stringify(p2Act.map((a) => a.payload)).includes("Regular customer")
  );
  await settingsLib.patchPartySettings(admin, { locationId: v1.id, resetFields: ["allowConfirmWithoutDeposit"] });

  // ── Money ───────────────────────────────────────────────────────────────
  await takeBookingPayments(admin, party1.bookingId, [{ type: "cash", amount: party1.depositRequiredCents / 100 }], { confirmIfPaid: false });
  const p1Paid = await prisma.booking.findUniqueOrThrow({ where: { id: party1.bookingId }, include: { partyDetail: true } });
  check(
    "cash payment reduces amountDue + sets depositPaidCents",
    Math.round(Number(p1Paid.amountDue) * 100) === party1.totalCents - party1.depositRequiredCents &&
      p1Paid.partyDetail!.depositPaidCents === party1.depositRequiredCents
  );
  const p1Confirmed = await engine.confirmParty(admin, party1.bookingId);
  const creds = await prisma.ticketCredential.count({ where: { bookingId: party1.bookingId, status: "unused" } });
  check("confirm after deposit", p1Confirmed.status === "confirmed" && p1Confirmed.opsStatus === "confirmed");
  check("credentials issued for kidCount + adultCount", creds === 15, String(creds));

  const party3 = await engine.createParty(admin, engine.parseCreatePartyBody({ channel: "phone", locationId: v1.id, productId: pkg.id, sessionId: s4.id, roomResourceId: room2.id, kidCount: 10, adultCount: 2, partyName: "Link pay", contact: { name: "Lin", email: `lin-${stamp}@ex.com` } }));
  const link = await createPaymentLink(admin, party3.bookingId, { amount: party3.depositRequiredCents / 100 });
  await payViaPaymentLink(link.token, { amount: party3.depositRequiredCents / 100 });
  const p3 = await prisma.booking.findUniqueOrThrow({ where: { id: party3.bookingId }, include: { partyDetail: true } });
  check(
    "payment link syncs depositPaidCents (+ deposit confirms)",
    p3.partyDetail!.depositPaidCents === party3.depositRequiredCents && p3.status === "confirmed",
    `${p3.partyDetail!.depositPaidCents} ${p3.status}`
  );
  const party4 = await engine.createParty(admin, engine.parseCreatePartyBody({ channel: "phone", locationId: v1.id, productId: pkg.id, sessionId: s4.id, roomResourceId: room3.id, kidCount: 10, adultCount: 2, partyName: "Webhook pay", contact: { name: "Wes" } }));
  const pending = await createPendingCardPaymentLocked({ bookingId: party4.bookingId, orgId: A.orgId, locationId: v1.id, amount: party4.depositRequiredCents / 100, tender: "card" });
  await settleVenueBookingStripePayment({ paymentId: pending.id, bookingId: party4.bookingId, stripePaymentIntentId: `pi_smoke_party_${stamp}` });
  const p4 = await prisma.partyBookingDetail.findUniqueOrThrow({ where: { bookingId: party4.bookingId } });
  check("webhook settle syncs depositPaidCents", p4.depositPaidCents === party4.depositRequiredCents);

  // ── Ops status ──────────────────────────────────────────────────────────
  const party5 = await engine.createParty(admin, engine.parseCreatePartyBody({ channel: "phone", locationId: v1.id, productId: pkg.id, sessionId: s5.id, kidCount: 5, adultCount: 1, partyName: "Expire me", contact: { name: "Ed" } }));
  await expectErr("ops check-in needs confirmed booking", () => engine.setPartyOpsStatus(admin, party5.bookingId, "checked_in"), code("PARTY_OPS_TRANSITION"));
  const checkedIn = await engine.setPartyOpsStatus(admin, party2.bookingId, "checked_in");
  check("ops status on confirmed booking", checkedIn.opsStatus === "checked_in");

  // ── Hold expiry releases room + session ─────────────────────────────────
  const s5Held = (await prisma.ticketSession.findUniqueOrThrow({ where: { id: s5.id } })).remaining;
  await prisma.booking.update({ where: { id: party5.bookingId }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });
  await engine.expirePartyHolds({ orgId: A.orgId });
  const p5 = await prisma.booking.findUniqueOrThrow({ where: { id: party5.bookingId }, include: { partyDetail: true } });
  const s5After = (await prisma.ticketSession.findUniqueOrThrow({ where: { id: s5.id } })).remaining;
  const s5Conflicts = await rooms.findRoomConflicts({ orgId: A.orgId, roomId: room1.id, startsAt: s5.startsAt ? new Date(s5.startsAt) : day(6, 15), endsAt: new Date(new Date(s5.startsAt).getTime() + 3600_000) });
  check(
    "hold expiry releases room + session",
    p5.status === "expired" && p5.partyDetail!.opsStatus === "cancelled" && s5After === s5Held + 1 && s5Conflicts.length === 0,
    `${p5.status} ${p5.partyDetail!.opsStatus} ${s5Held}->${s5After} ${s5Conflicts.length}`
  );

  // ── Food + kitchen ──────────────────────────────────────────────────────
  const beforeFood = await prisma.booking.findUniqueOrThrow({ where: { id: party1.bookingId } });
  await food.putPartyFoodDraft(admin, party1.bookingId, { lines: [{ menuItemId: pizza.id, qty: 2 }, { menuItemId: cake.id, qty: 1 }] });
  const afterFood = await prisma.booking.findUniqueOrThrow({ where: { id: party1.bookingId } });
  check(
    "food totals flow into booking (POS price snapshot 12.00)",
    Math.round(Number(afterFood.total) * 100) === Math.round(Number(beforeFood.total) * 100) + 2 * 1200 + 2500 &&
      Math.round(Number(afterFood.amountDue) * 100) === Math.round(Number(afterFood.total) * 100) - Math.round(Number(afterFood.amountPaid) * 100),
    `${beforeFood.total} → ${afterFood.total}`
  );
  const credsAfterFood = await prisma.ticketCredential.count({ where: { bookingId: party1.bookingId, status: "unused" } });
  check("food lines do not add ticket heads", credsAfterFood === 15, String(credsAfterFood));
  await expectErr(
    "menu item from another location rejected",
    () => food.putPartyFoodDraft(admin, party1.bookingId, { lines: [{ menuItemId: v2Item.id, qty: 1 }] }),
    code("PARTY_MENU_ITEM_INVALID")
  );
  const submitted = await food.submitPartyFood(admin, party1.bookingId, {});
  const sentOrder = submitted.find((o) => o.status === "sent_to_kitchen");
  const ticket = sentOrder?.kitchenTicketId
    ? await prisma.kitchenTicket.findUnique({ where: { id: sentOrder.kitchenTicketId } })
    : null;
  check("food submit creates a KitchenTicket", Boolean(ticket) && ticket!.status === "queued" && ticket!.saleId === null);

  const [soon] = await packages.createPartyPackageSessions(admin, pkg.id, { startsAt: new Date(Date.now() + 30 * 60_000).toISOString(), capacity: 2 });
  const party6 = await engine.createParty(admin, engine.parseCreatePartyBody({ channel: "phone", locationId: v1.id, productId: pkg.id, sessionId: soon.id, roomResourceId: room2.id, kidCount: 5, adultCount: 1, partyName: "Soon", contact: { name: "Sue" } }));
  await food.putPartyFoodDraft(admin, party6.bookingId, { lines: [{ menuItemId: cake.id, qty: 1 }] });
  await expectErr("food submit after cutoff rejected", () => food.submitPartyFood(admin, party6.bookingId, {}), code("PARTY_FOOD_CUTOFF"));
  await food.submitPartyFood(ops, party6.bookingId, { overrideReason: "Kitchen agreed" });
  const p6Act = await prisma.bookingActivity.findMany({ where: { bookingId: party6.bookingId } });
  check("food cutoff override logged", JSON.stringify(p6Act.map((a) => a.payload)).includes("Kitchen agreed"));
  await prisma.booking.update({ where: { id: party6.bookingId }, data: { visitStartsAt: new Date(Date.now() - 3 * 3600_000), visitEndsAt: new Date(Date.now() - 3600_000) } });
  await expectErr("edit after start is past-locked", () => engine.editParty(admin, party6.bookingId, { kidCount: 6 }), code("PARTY_PAST_LOCKED"));

  // ── Edit resizes credentials ────────────────────────────────────────────
  const editedParty = await engine.editParty(admin, party1.bookingId, { kidCount: 13, hostNotes: "Balloons" });
  const credsAfterEdit = await prisma.ticketCredential.count({ where: { bookingId: party1.bookingId, status: "unused" } });
  check("edit reprices + resizes credentials", editedParty.kidCount === 13 && credsAfterEdit === 16, `${credsAfterEdit}`);

  // ── Run sheet + summary + balances + front desk ─────────────────────────
  await runSheet.putPartyRunSheet(admin, party1.bookingId, [{ title: "Cake time", startsAt: day(3, 16).toISOString() }]);
  const rs = await runSheet.getPartyRunSheet(admin, party1.bookingId);
  check("run sheet put/get", rs.items.length === 1 && rs.items[0]!.title === "Cake time");
  const summary = await getPartySummary(admin, party4.bookingId);
  const summaryJson = JSON.stringify(summary);
  check("summary has no Stripe ids", !summaryJson.includes("pi_smoke") && !/stripe/i.test(summaryJson));
  const balances = await listPartyBalances(admin, {});
  check("balances list amountDue > 0", balances.balances.every((b) => b.amountDueCents > 0) && balances.balances.some((b) => b.bookingId === party1.bookingId));

  // ── ticketsPerMonth ─────────────────────────────────────────────────────
  const bigPkg = await packages.createPartyPackage(S.actor, {
    locationId: sVenue.id,
    name: `Huge ${stamp}`,
    maxGuests: 3000,
    durationMinutes: 60,
    includedKids: 3000,
    includedAdults: 0,
    packagePriceCents: 1000,
    roomAssignedAtBooking: true,
    published: true,
  });
  const [bigSession] = await packages.createPartyPackageSessions(S.actor, bigPkg.id, { startsAt: new Date(Date.now() + 2 * 3600_000).toISOString(), capacity: 1 });
  const bigParty = await engine.createParty(S.actor, engine.parseCreatePartyBody({ channel: "phone", locationId: sVenue.id, productId: bigPkg.id, sessionId: bigSession.id, kidCount: 2001, adultCount: 0, partyName: "Huge", contact: { name: "Hugo" } }));
  await expectErr("ticketsPerMonth blocks confirm when exhausted", () => engine.confirmParty(S.actor, bigParty.bookingId), (i) => /plan limit|ticketsPerMonth/i.test(i.message));

  // ── Invitations + RSVP ──────────────────────────────────────────────────
  const invite = await invitations.createPartyInvitationForStaff(admin, party3.bookingId, { channel: "link" });
  const stored = await prisma.partyInvitation.findUniqueOrThrow({ where: { id: invite.id } });
  check("invitation token persists (crypto base64url)", stored.token === invite.token && /^[A-Za-z0-9_-]{32}$/.test(stored.token) && Boolean(stored.expiresAt));
  const view = await invitations.getPublicInvitation(invite.token);
  check("public invite view is minimal", view.partyName === "Link pay" && !("primaryContactEmail" in view) && view.open);
  await invitations.applyPartyRsvp(invite.token, { accept: true, name: "Zoe", age: 6 });
  await invitations.applyPartyRsvp(invite.token, { accept: true, name: "Zoe again", age: 6 });
  const zoe = await prisma.partyGuest.findMany({ where: { invitationId: invite.id } });
  check("RSVP accept creates PartyGuest; double RSVP idempotent", zoe.length === 1 && zoe[0]!.rsvpStatus === "accepted" && zoe[0]!.kind === "kid");
  const expiredInvite = await invitations.createPartyInvitationForStaff(admin, party3.bookingId, { channel: "link" });
  await prisma.partyInvitation.update({ where: { id: expiredInvite.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await expectErr("RSVP after expiry rejected", () => invitations.applyPartyRsvp(expiredInvite.token, { accept: true, name: "Late" }), (i) => i.code === "PARTY_INVITE_EXPIRED" && i.status === 410);
  const cancelInvite = await invitations.createPartyInvitationForStaff(admin, overbooked.bookingId, { channel: "link" });
  await engine.cancelParty(admin, overbooked.bookingId, { reason: "Duplicate" });
  await expectErr("RSVP after cancel rejected", () => invitations.applyPartyRsvp(cancelInvite.token, { accept: true, name: "Nope" }), (i) => i.status === 410);
  await expectErr("invitation after cancel rejected", () => invitations.createPartyInvitationForStaff(admin, overbooked.bookingId, { channel: "link" }), (i) => i.status === 410);
  await expectErr("invalid invite token 404", () => invitations.getPublicInvitation("x".repeat(32)), is404);
  await expectErr("cancel requires a reason", () => engine.cancelParty(admin, party3.bookingId, { reason: "" }), code("PARTY_REASON_REQUIRED"));

  // ── Cancel releases capacity for unused heads only ──────────────────────
  const s4Before = (await prisma.ticketSession.findUniqueOrThrow({ where: { id: s4.id } })).remaining;
  await engine.cancelParty(admin, party4.bookingId, { reason: "Changed plans" });
  const s4AfterCancel = (await prisma.ticketSession.findUniqueOrThrow({ where: { id: s4.id } })).remaining;
  check("cancel (no heads redeemed) releases the slot", s4AfterCancel === s4Before + 1, `${s4Before}->${s4AfterCancel}`);
  const p1Cred = await prisma.ticketCredential.findFirstOrThrow({ where: { bookingId: party1.bookingId, status: "unused" } });
  await prisma.ticketCredential.update({ where: { id: p1Cred.id }, data: { status: "redeemed", redeemedAt: new Date() } });
  const s1BeforeCancel = (await prisma.ticketSession.findUniqueOrThrow({ where: { id: s1.id } })).remaining;
  await engine.cancelParty(admin, party1.bookingId, { reason: "Weather" });
  const s1AfterCancel = (await prisma.ticketSession.findUniqueOrThrow({ where: { id: s1.id } })).remaining;
  const credStates = await prisma.ticketCredential.groupBy({ by: ["status"], where: { bookingId: party1.bookingId }, _count: true });
  const redeemedLeft = credStates.find((c) => c.status === "redeemed")?._count ?? 0;
  const unusedLeft = credStates.find((c) => c.status === "unused")?._count ?? 0;
  const p1Food = await prisma.partyFoodOrder.findMany({ where: { partyDetail: { bookingId: party1.bookingId } } });
  check(
    "cancel after a redeemed head keeps the slot; voids unused only",
    s1AfterCancel === s1BeforeCancel && redeemedLeft === 1 && unusedLeft === 0,
    `${s1BeforeCancel}->${s1AfterCancel} redeemed=${redeemedLeft} unused=${unusedLeft}`
  );
  check("cancel cancels open food orders", p1Food.every((o) => o.status === "cancelled"));
  const p1Reminders = await prisma.partyBalanceReminder.count({ where: { partyDetail: { bookingId: party1.bookingId }, sentAt: null, skippedReason: null } });
  check("cancel skips unsent reminders", p1Reminders === 0);
  const p1Pay = await prisma.bookingPayment.count({ where: { bookingId: party1.bookingId, status: "refunded" } });
  check("cancel never auto-refunds", p1Pay === 0);

  // ── Refund ──────────────────────────────────────────────────────────────
  const refundRule = API_PERMISSIONS["POST /api/admin/bookings/[id]/refunds"];
  check(
    "refund requires bookings:refund (ops_manager lacks it)",
    Boolean(refundRule?.permissions.includes(P.BookingsRefund)) &&
      !ROLE_PRESETS.ops_manager.includes(P.BookingsRefund) &&
      ROLE_PRESETS.finance.includes(P.BookingsRefund)
  );
  await engine.setPartyOpsStatus(admin, party3.bookingId, "in_progress");
  await refundBooking(admin, party3.bookingId, { amount: party3.depositRequiredCents / 100, method: "gift_card", reason: "Goodwill" });
  const p3After = await prisma.booking.findUniqueOrThrow({ where: { id: party3.bookingId }, include: { partyDetail: true } });
  const roomStillHeld = await rooms.findRoomConflicts({ orgId: A.orgId, roomId: room2.id, startsAt: new Date(p3After.visitStartsAt!), endsAt: new Date(p3After.visitEndsAt!) });
  check(
    "refund after start keeps room occupied (in progress)",
    p3After.status === "refunded" && p3After.partyDetail!.opsStatus === "in_progress" && roomStillHeld.some((c) => c.bookingId === party3.bookingId),
    `${p3After.status} ${p3After.partyDetail!.opsStatus}`
  );
  check("refund syncs depositPaidCents", p3After.partyDetail!.depositPaidCents === 0);

  // ── Reactivate ──────────────────────────────────────────────────────────
  const reactivated = await engine.reactivateParty(admin, party4.bookingId, { target: "held" });
  check("reactivate cancelled → held", reactivated.status === "hold" && reactivated.opsStatus === "held");

  // ── Cross-tenant party ids → 404 ────────────────────────────────────────
  const id = party2.bookingId;
  const xt: Array<[string, () => Promise<unknown>]> = [
    ["detail", () => engine.getPartyForStaff(B.actor, id)],
    ["edit", () => engine.editParty(B.actor, id, { hostNotes: "x" })],
    ["confirm", () => engine.confirmParty(B.actor, id)],
    ["cancel", () => engine.cancelParty(B.actor, id, { reason: "x" })],
    ["reactivate", () => engine.reactivateParty(B.actor, id, {})],
    ["room", () => engine.movePartyRoom(B.actor, id, { roomResourceId: room1.id })],
    ["host", () => engine.assignPartyHostStaff(B.actor, id, null)],
    ["guests", () => guests.listPartyGuests(B.actor, id)],
    ["guest add", () => guests.addPartyGuest(B.actor, id, { name: "x" })],
    ["guest patch", () => guests.updatePartyGuest(B.actor, id, zoe[0]!.id, { name: "x" })],
    ["guest delete", () => guests.removePartyGuest(B.actor, id, zoe[0]!.id)],
    ["invitations", () => invitations.listPartyInvitations(B.actor, id)],
    ["invite create", () => invitations.createPartyInvitationForStaff(B.actor, id, { channel: "link" })],
    ["invite cancel", () => invitations.cancelPartyInvitation(B.actor, id, invite.id)],
    ["food", () => food.getPartyFood(B.actor, id)],
    ["food put", () => food.putPartyFoodDraft(B.actor, id, { lines: [] })],
    ["food submit", () => food.submitPartyFood(B.actor, id, {})],
    ["food cancel", () => food.cancelPartyFood(B.actor, id, {})],
    ["run sheet", () => runSheet.getPartyRunSheet(B.actor, id)],
    ["run sheet put", () => runSheet.putPartyRunSheet(B.actor, id, [])],
    ["summary", () => getPartySummary(B.actor, id)],
  ];
  let xtOk = 0;
  for (const [name, fn] of xt) {
    try {
      await fn();
      console.error(`  cross-tenant ${name} succeeded`);
    } catch (err) {
      if (errInfo(err).status === 404) xtOk += 1;
      else console.error(`  cross-tenant ${name} → ${errInfo(err).status} ${errInfo(err).code}`);
    }
  }
  check("cross-tenant ids 404 on every party route lib", xtOk === xt.length, `${xtOk}/${xt.length}`);

  // ── Location-scoped actor ───────────────────────────────────────────────
  const parkUser = await user("park");
  const parkMembership = await prisma.membership.create({
    data: { userId: parkUser.id, orgId: A.orgId, rolePreset: "ops_manager", status: "active", companyWideView: true, permissionsOverride: [] },
  });
  await replaceMembershipVenueAssignments({ membershipId: parkMembership.id, orgId: A.orgId, locationIds: [v2.id] });
  const parkActor = { orgId: A.orgId, sub: parkUser.id, preset: "ops_manager", membershipRole: "ops_manager", companyWideView: true };
  const parkRooms = await rooms.listPartyRooms(parkActor);
  const parkMenu = await menu.listPartyMenuItems(parkActor);
  const parkParties = await engine.listParties(parkActor, {});
  check(
    "location-scoped actor sees only its venue",
    parkRooms.length > 0 && parkRooms.every((r) => r.locationId === v2.id) && parkMenu.every((m) => m.locationId === v2.id) && parkParties.parties.every((p) => p.locationId === v2.id),
    `${parkRooms.map((r) => r.name).join(",")}`
  );
  await expectErr("location-scoped actor 404 on other venue party", () => engine.getPartyForStaff(parkActor, party2.bookingId), is404);
  void roomV2;

  // ── Host (me) ───────────────────────────────────────────────────────────
  const mine = await owner.listMyParties(hostUser.id);
  check("host sees own party only", mine.length === 1 && mine[0]!.bookingId === party1.bookingId);
  await expectErr("other user's party 404", () => owner.getMyParty(otherClient.id, party1.bookingId), is404);
  const myDetail = await owner.getMyParty(hostUser.id, party1.bookingId);
  const myJson = JSON.stringify(myDetail);
  check("host DTO has no POS / staff notes / host staff", !myJson.includes("posNotes") && !myJson.includes("hostNotes") && !myJson.includes("hostStaffUserId"));
  check(
    "host cannot assign host or overbook",
    !ROLE_PRESETS.client.includes(P.PartiesWrite) &&
      !ROLE_PRESETS.client.includes(P.BookingsOverbook) &&
      API_PERMISSIONS["PATCH /api/admin/parties/[bookingId]/host"]?.permissions.includes(P.PartiesWrite) === true &&
      ROLE_PRESETS.client.includes(P.PartiesReadOwn) &&
      !ROLE_PRESETS.tailor.some((p) => String(p).startsWith("parties:") || String(p).startsWith("bookings:"))
  );

  // ── POS party_package_proxy → party engine ──────────────────────────────
  const device = await createPosDevice(posActor, { locationId: v1.id, name: "Front", code: `party-front-${stamp}` });
  await openTill(posActor, { locationId: v1.id, deviceId: device.id, openingFloat: 50 });
  const proxy = await createPosProduct(posActor, { locationId: v1.id, kind: "party_package_proxy", name: "Party (POS)", price: 300, admissionProductId: pkg.id });
  const [posSession] = await packages.createPartyPackageSessions(admin, pkg.id, { startsAt: new Date(Date.now() + 5 * 60_000).toISOString(), capacity: 3 });
  const cart = await openCart(posActor, { locationId: v1.id, deviceId: device.id });
  await addCartLine(posActor, cart.id, { productId: proxy.id, sessionId: posSession.id, qty: 1 });
  const sale = await checkoutCart(posActor, cart.id, { idempotencyKey: `party-pos-${stamp}`, guestName: "Till Guest", tenders: [{ tender: "cash", amount: 300 }] });
  const saleLinks = await prisma.posSaleBooking.findMany({ where: { saleId: (sale as { id: string }).id } });
  const posParty = saleLinks.length
    ? await prisma.booking.findUnique({ where: { id: saleLinks[0]!.bookingId }, include: { partyDetail: true, activities: true } })
    : null;
  check(
    "POS party_package_proxy goes through partyEngine",
    Boolean(posParty?.partyDetail) &&
      posParty!.channel === "pos" &&
      posParty!.status === "confirmed" &&
      JSON.stringify(posParty!.activities.map((a) => a.payload)).includes("party_created"),
    `${posParty?.status} ${posParty?.channel}`
  );
  const today = await getTodayParties(admin, { locationId: v1.id });
  const listToday = await engine.listParties(admin, { date: "today", locationId: v1.id });
  check(
    "getTodayParties matches GET /api/admin/parties?date=today",
    today.parties.some((p) => p.bookingId === posParty?.id) && listToday.total === today.total
  );

  // ── Routes + nav registration ───────────────────────────────────────────
  const adminPaths = ["/admin/parties", "/admin/parties/new", "/admin/parties/packages", "/admin/parties/rooms", "/admin/parties/menu", "/admin/parties/balances", "/admin/parties/settings"];
  check(
    "admin party paths registered + registered-company only + not Demo-allowed",
    adminPaths.every((p) => Boolean(ADMIN_ROUTE_PERMISSIONS[p]) && adminPathRequiresRegisteredCompanyOrg(p) && !isDemoAllowedAdminPath(p))
  );
  check(
    "presets match S1-D2",
    !ROLE_PRESETS.ops_manager.includes(P.PartiesManage) &&
      !ROLE_PRESETS.ops_manager.includes(P.BookingsOverbook) &&
      !ROLE_PRESETS.ops_manager.includes(P.BookingsExport) &&
      !ROLE_PRESETS.ops_manager.includes(P.BookingsChargeStored) &&
      ROLE_PRESETS.ops_manager.includes(P.PartiesInvitations) &&
      ROLE_PRESETS.ops_manager.includes(P.PartiesFood) &&
      ROLE_PRESETS.catalog_editor.includes(P.PartiesRead) &&
      !ROLE_PRESETS.catalog_editor.includes(P.PartiesManage) &&
      ROLE_PRESETS.finance.includes(P.PartiesRead)
  );

  // ── Signup still closed ─────────────────────────────────────────────────
  const signup = await signupPost(new Request("http://localhost/api/auth/signup", { method: "POST", body: "{}" }));
  check("/api/auth/signup still 410", signup.status === 410);

  void recomputePartyWaiverStatus;

  // ── Teardown ────────────────────────────────────────────────────────────
  await teardownSmokeData(prisma, createdOrgIds, createdUserIds);

  if (failed) {
    console.error(`\n${failed} party Step 1 check(s) failed`);
    process.exitCode = 1;
    return;
  }
  console.log("\nAll Party Management Step 1 smoke checks passed");
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
