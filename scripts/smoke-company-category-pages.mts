/**
 * Company category pages, white-label links, and the iframe embed (Steps 1–4).
 *   npx tsx scripts/smoke-company-category-pages.mts
 * Needs the dev server on SMOKE_BASE_URL (default http://localhost:3000) and a local
 * Chrome/Edge (SMOKE_CHROME_PATH) for the headless frame, layout, and cancel checks.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { envValue, loadDatabaseUrl, readEnvFile } from "./prisma-env.mjs";

// Next request storage must be real before any src module loads next/headers (webhook route check).
(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= AsyncLocalStorage;

loadDatabaseUrl();
const envFile = readEnvFile();
for (const key of [
  "STRIPE_SECRET_KEY",
  "STRIPE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_BASE_URL",
  "NEXT_PUBLIC_URL",
  "COMPANY_PROFILE_ENCRYPTION_KEY",
  "JWT_SECRET",
]) {
  const v = envValue(envFile, key);
  if (v) process.env[key] = v;
}
delete process.env.NOTIFICATION_EMAIL_USER;
delete process.env.BOOKING_SMS_PROVIDER;
delete process.env.TICKETING_PAYMENT_LINK_STUB;

const prisma = new PrismaClient();
const BASE = (process.env.SMOKE_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const APP_BASE = (process.env.NEXT_PUBLIC_BASE_URL || BASE).replace(/\/$/, "");

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// The public resolve limiter is per client IP (60/min); give each request its own.
let ipSeq = 0;
function testIp() {
  ipSeq += 1;
  return `10.77.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`;
}

async function http(pathname: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${pathname}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(180_000),
    ...init,
    headers: { "x-forwarded-for": testIp(), ...(init?.headers as Record<string, string>) },
  });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

function decodeHtml(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function titleOf(html: string): string {
  return decodeHtml(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "");
}

function chromePath(): string | null {
  const candidates = [
    process.env.SMOKE_CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  return candidates.find((p) => p && fs.existsSync(p)) ?? null;
}

const CHROME_MARKERS = [
  "FECSYNC",
  "Dismiss announcement",
  "drawer-nav",
  "Toggle navigation",
  "footer-grid",
  "footer-brand",
  "All rights reserved",
  "fixed bottom-4 right-4 z-50",
];

async function main() {
  const { createOrganizationWithPlatformAdmin } = await import("../src/lib/orgRegistration.ts");
  const { createVenueLocation } = await import("../src/lib/venueLocations.ts");
  const { createAdmissionProduct, updateAdmissionProduct } = await import("../src/lib/ticketing/products.ts");
  const { createCapacityResource } = await import("../src/lib/ticketing/resources.ts");
  const { createTicketSession } = await import("../src/lib/ticketing/sessions.ts");
  const { createBookingCategory, updateBookingCategory, archiveBookingCategory } = await import(
    "../src/lib/ticketing/categories.ts"
  );
  const { createMembershipCategory } = await import("../src/lib/memberships/categories.ts");
  const { upsertCompanyProfile } = await import("../src/lib/companyProfile.ts");
  const { createPublicHold, publicCheckout, beginPublicCardPayment, settlePublicPaymentLink } = await import(
    "../src/lib/ticketing/publicBooking.ts"
  );
  const { createPaymentLink } = await import("../src/lib/ticketing/paymentLinks.ts");
  const { listBookingPayments } = await import("../src/lib/ticketing/payments.ts");
  const { listBookings } = await import("../src/lib/ticketing/bookingEngine.ts");
  const { resolveCompanyCategory, listCompanyBookingCards, toCompanySiteDto } = await import(
    "../src/lib/publicCategory/resolve.ts"
  );
  const {
    companyCategoryCheckout,
    confirmCompanyCheckoutSession,
    assertCompanyReturnUrl,
    assertEmbedCheckoutOrigin,
    companyCheckoutReturnUrl,
  } = await import("../src/lib/publicCategory/companyCheckout.ts");
  const { publicCategoryEmbedSnippet, publicUrlPayloadHasPrivateFields } = await import(
    "../src/lib/publicCategory/snippet.ts"
  );
  const { companyFrameOrigins, websiteFrameOrigin } = await import("../src/lib/publicCategory/frameOrigins.ts");
  const { getStripe } = await import("../src/lib/stripe.ts");

  const stamp = Date.now();
  const mkUser = (tag: string) =>
    prisma.user.create({
      data: {
        email: `smoke-ccp-${tag}-${stamp}@test.local`,
        password: "x",
        username: `smokeccp${tag}${stamp}`,
        firstName: "Company",
        lastName: tag,
        role: "client",
        isVerified: true,
        joinedAt: new Date(),
      },
    });
  const mkOrg = async (tag: string, plan: string) => {
    const user = await mkUser(tag);
    const reg = await createOrganizationWithPlatformAdmin({
      name: `CCP ${tag} ${stamp}`,
      slug: `ccp-${tag}-${stamp}`,
      userId: user.id,
    });
    await prisma.organization.update({
      where: { id: reg.organization.id },
      data: {
        status: "active",
        subscriptionPlan: plan,
        subscriptionStatus: "active",
        subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
      },
    });
    return {
      org: reg.organization,
      actor: { sub: user.id, orgId: reg.organization.id, rolePreset: "platform_admin" as const },
    };
  };

  // A growth (everything on), B starter (ticketing, no memberships), C billing lapsed,
  // D demo, P pending, S suspended.
  const A = await mkOrg("a", "growth");
  const B = await mkOrg("b", "growth");
  const C = await mkOrg("c", "growth");
  const D = await mkOrg("d", "growth");
  const P = await mkOrg("p", "growth");
  const S = await mkOrg("s", "growth");

  const enablePublic = (id: string, on = true) =>
    prisma.$executeRaw`UPDATE venue_locations SET "publicBookingEnabled" = ${on} WHERE id = ${id}`;
  const park = (o: typeof A, tag: string) =>
    createVenueLocation(o.actor, { name: `${tag} ${stamp}`, slug: `${tag.toLowerCase()}-${o.org.slug}` });
  const north = await park(A, "North");
  const south = await park(A, "South");
  const closed = await park(A, "Closed");
  const parkB = await park(B, "Bpark");
  const parkC = await park(C, "Cpark");
  const parkD = await park(D, "Dpark");
  await Promise.all([north, south, parkB, parkC, parkD].map((p) => enablePublic(p.id)));

  const partnerOrigin = `https://partner-${stamp}.test`;
  const evilOrigin = `https://evil-${stamp}.test`;
  const websiteOrigin = `https://www.skyline-${stamp}.test`;
  const logoFile = `ccp-logo-${stamp}.png`;
  await upsertCompanyProfile(A.actor, {
    tradingName: "Skyline Fun Co",
    phone: "555-0199",
    supportEmail: `support-${stamp}@skyline.test`,
    billingEmail: `billing-${stamp}@skyline.test`,
    website: `${websiteOrigin}/about-us`,
    logoUrl: `https://res.cloudinary.com/demo/image/upload/${logoFile}`,
    addressLine1: `${stamp} Coaster Rd`,
    city: "Funville",
    taxId: `TAX-${stamp}`,
    bankName: `Bank${stamp}`,
    bankAccountName: `Holder ${stamp}`,
    bankAccountNumber: `8${stamp}`,
    bankRoutingOrIban: `7${stamp}`,
    publicLogo: true,
    publicPhone: true,
    publicSupportEmail: false,
    publicWebsite: true,
    publicAddress: true,
    embedOrigins: [partnerOrigin],
  } as never);
  await upsertCompanyProfile(B.actor, { tradingName: "Other Fun Co", website: "http://insecure.test" } as never);

  const catA = await createBookingCategory(A.actor, { name: "Birthday Parties" });
  const catB = await createBookingCategory(B.actor, { name: "Birthday Parties" });
  const catC = await createBookingCategory(C.actor, { name: "Birthday Parties" });
  const catD = await createBookingCategory(D.actor, { name: "Birthday Parties" });
  const catP = await createBookingCategory(P.actor, { name: "Birthday Parties" });
  const catS = await createBookingCategory(S.actor, { name: "Birthday Parties" });
  const catArch = await createBookingCategory(A.actor, { name: "Retired Packages" });
  const memA = await createMembershipCategory(A.actor, { name: "Annual Passes" });
  const memB = await createMembershipCategory(B.actor, { name: "Annual Passes" });
  const slugA = catA.publicPage!.slug;

  const room = await createCapacityResource(A.actor, {
    name: `Room ${stamp}`,
    type: "party_room",
    locationId: north.id,
    defaultCapacity: 20,
  });
  const product = (o: typeof A, body: Record<string, unknown>) =>
    createAdmissionProduct(o.actor, { published: true, ...body } as never);
  const [timed, dayPass, party, closedPass, foreign] = await Promise.all([
    product(A, { type: "timed_session", name: `Timed ${stamp}`, locationId: north.id, categoryId: catA.id, prices: [{ code: "adult", amount: 20 }] }),
    product(A, { type: "day_pass", name: `Day ${stamp}`, locationId: south.id, categoryId: catA.id, prices: [{ code: "adult", amount: 30 }] }),
    product(A, { type: "party_package", name: `Party ${stamp}`, locationId: north.id, categoryId: catA.id, resourceId: room.id, minGuests: 1, maxGuests: 20, prices: [{ code: "package", amount: 150 }] }),
    product(A, { type: "day_pass", name: `ClosedPass ${stamp}`, locationId: closed.id, categoryId: catA.id, prices: [{ code: "adult", amount: 9 }] }),
    product(B, { type: "day_pass", name: `Foreign ${stamp}`, locationId: parkB.id, categoryId: catB.id, prices: [{ code: "adult", amount: 12 }] }),
  ]);
  await Promise.all([
    product(C, { type: "day_pass", name: `Cpass ${stamp}`, locationId: parkC.id, categoryId: catC.id, prices: [{ code: "adult", amount: 5 }] }),
    product(D, { type: "day_pass", name: `Dpass ${stamp}`, locationId: parkD.id, categoryId: catD.id, prices: [{ code: "adult", amount: 5 }] }),
  ]);
  const starts = new Date(Date.now() + 4 * 3600_000);
  const session = await createTicketSession(A.actor, {
    productId: timed.id,
    startsAt: starts.toISOString(),
    endsAt: new Date(starts.getTime() + 3600_000).toISOString(),
    capacity: 20,
  });
  await prisma.membershipPlan.create({
    data: { orgId: A.org.id, categoryId: memA.id, name: `Gold ${stamp}`, billing: "recurring", intervalCount: 1, intervalUnit: "month", price: 25 },
  });

  // Gate states after categories exist (Demo, lapsed, and Starter orgs cannot create them).
  await prisma.organization.update({ where: { id: B.org.id }, data: { subscriptionPlan: "starter" } });
  await prisma.organization.update({ where: { id: C.org.id }, data: { subscriptionStatus: "canceled", subscriptionEndsAt: new Date(Date.now() - 86400000) } });
  await prisma.organization.update({ where: { id: D.org.id }, data: { subscriptionPlan: "demo" } });
  await prisma.organization.update({ where: { id: P.org.id }, data: { status: "pending" } });
  await prisma.organization.update({ where: { id: S.org.id }, data: { status: "suspended" } });
  const { clearCachedStaffGatesForOrg } = await import("../src/lib/ticketing/staffGateCache.ts");
  for (const o of [B, C, D, P, S]) clearCachedStaffGatesForOrg(o.org.id);

  // ── Step 1 regressions ──
  check(
    "two companies share a category name, slug, and differ only by org path",
    slugA === "birthday-parties" && catB.publicPage!.slug === slugA && A.org.slug !== B.org.slug
  );
  const renamed = await updateBookingCategory(A.actor, catA.id, { name: "Birthday Bash" });
  check("rename keeps the public slug", renamed.publicPage?.slug === slugA, renamed.publicPage?.slug);
  await archiveBookingCategory(A.actor, catArch.id);
  const archPage = await prisma.publicCategoryPage.findFirst({ where: { bookingCategoryId: catArch.id } });
  check("archiving a category deactivates its public page", archPage?.active === false);
  const pagesPerCategory = await prisma.publicCategoryPage.groupBy({
    by: ["bookingCategoryId"],
    where: { orgId: A.org.id, bookingCategoryId: { not: null } },
    _count: true,
  });
  check("one public page per booking category", pagesPerCategory.every((g) => g._count === 1));
  const storefront = await prisma.organization.findFirst({ where: { isDefault: true }, select: { id: true, slug: true } });
  if (storefront) {
    check(
      "default storefront has no public category page",
      (await prisma.publicCategoryPage.count({ where: { orgId: storefront.id } })) === 0
    );
  }

  // ── First URL segments: app routes and public/ folders are never /{orgSlug} ──
  const { RESERVED_FIRST_SEGMENTS } = await import("../src/lib/publicCategory/slug.ts");
  const { isCompanySitePath } = await import("../src/lib/publicCategory/sitePaths.ts");
  const { allocateUniqueOrgSlug, updateOrganizationSlug, ORG_SLUG_RESERVED_MESSAGE } = await import("../src/lib/org.ts");
  const appDir = path.join(process.cwd(), "src/app");
  const firstSegments = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
      if (!d.isDirectory() || d.name.startsWith("[") || d.name.startsWith("_")) return [];
      return /^\(.+\)$/.test(d.name) ? firstSegments(path.join(dir, d.name)) : [d.name];
    });
  const publicDirs = fs
    .readdirSync(path.join(process.cwd(), "public"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const unreserved = [...new Set([...firstSegments(appDir), ...publicDirs])].filter(
    (s) => !(RESERVED_FIRST_SEGMENTS as readonly string[]).includes(s)
  );
  check("every src/app first segment and public/ folder is reserved", unreserved.length === 0, unreserved.join(","));
  check(
    "public asset paths are not company pages",
    publicDirs.every((d) => !isCompanySitePath(`/${d}/file.png`)) && isCompanySitePath(`/${A.org.slug}/${slugA}`)
  );
  const { PROXY_MATCHER } = await import("../src/lib/auth/routePolicy.ts");
  const gatedFirst = [...new Set(PROXY_MATCHER.map((m) => m.split("/").filter(Boolean)[0]).filter(Boolean))];
  const ungated = gatedFirst.filter(
    (s) => !(RESERVED_FIRST_SEGMENTS as readonly string[]).includes(s) || isCompanySitePath(`/${s}/x/y`)
  );
  check(
    "auth-gated proxy paths (incl. /user/profile, /settings, /dashboard) never bypass the gate as company pages",
    ungated.length === 0 && !isCompanySitePath("/user/profile") && !isCompanySitePath("/settings/billing"),
    ungated.join(",")
  );
  const reservedOrgSlug = await allocateUniqueOrgSlug("Shop");
  let renameMsgs: string[] = [];
  for (const s of ["admin", "brand", "embed"]) {
    try {
      await updateOrganizationSlug(A.org.id, s);
      renameMsgs.push(`${s}:accepted`);
    } catch (err) {
      renameMsgs.push((err as Error).message);
    }
  }
  check(
    "org slugs never claim an app route or public folder (allocate + rename)",
    reservedOrgSlug !== "shop" && renameMsgs.every((m) => m === ORG_SLUG_RESERVED_MESSAGE),
    `${reservedOrgSlug} ${renameMsgs.join("|")}`
  );
  let registerReserved = "";
  try {
    const u = await mkUser("rsv");
    await createOrganizationWithPlatformAdmin({ name: `CCP Rsv ${stamp}`, slug: "checkout", userId: u.id });
    registerReserved = "accepted";
  } catch (err) {
    registerReserved = (err as Error).message;
  }
  check("company registration rejects a reserved slug", registerReserved === ORG_SLUG_RESERVED_MESSAGE, registerReserved);
  renameMsgs = [];

  const { buildCompanyWorkspaceExport } = await import("../src/lib/companyExport.ts");
  const exportA = await buildCompanyWorkspaceExport(A.org.id);
  const exportedMemCats = exportA.membershipCategoriesExport as Array<{ id: string; publicSlug: string | null; publicActive: boolean | null }>;
  check(
    "company export adds public slug + active only to the categories it already exports",
    exportedMemCats.some((c) => c.id === memA.id && c.publicSlug === memA.publicPage!.slug && c.publicActive === true) &&
      !exportedMemCats.some((c) => c.id === memB.id) &&
      !("publicCategoryPages" in exportA)
  );

  // ── Resolve gates ──
  const siteA = await resolveCompanyCategory(A.org.slug, slugA);
  check("company A booking page resolves", siteA?.page.kind === "booking");
  check("Demo company does not resolve", (await resolveCompanyCategory(D.org.slug, catD.publicPage!.slug)) == null);
  check("pending company does not resolve", (await resolveCompanyCategory(P.org.slug, catP.publicPage!.slug)) == null);
  check("suspended company does not resolve", (await resolveCompanyCategory(S.org.slug, catS.publicPage!.slug)) == null);
  check(
    "booking page 404s when ticketing is not enabled (billing lapsed)",
    (await resolveCompanyCategory(C.org.slug, catC.publicPage!.slug)) == null
  );
  check(
    "membership page 404s when Memberships is not in the plan",
    (await resolveCompanyCategory(B.org.slug, memB.publicPage!.slug)) == null
  );
  check(
    "membership page resolves when Memberships is enabled",
    (await resolveCompanyCategory(A.org.slug, memA.publicPage!.slug))?.page.kind === "membership"
  );
  check("public DTO has no bank, tax, or billing email", siteA != null && !publicUrlPayloadHasPrivateFields(toCompanySiteDto(siteA)));

  // ── Cards: unpublish / park off remove only the affected card ──
  const cardIds = async () => new Set((siteA ? await listCompanyBookingCards(siteA) : []).map((c) => c.id));
  const before = await cardIds();
  check(
    "grid = published products on public-booking parks",
    before.has(timed.id) && before.has(dayPass.id) && before.has(party.id) && !before.has(closedPass.id) && !before.has(foreign.id),
    [...before].join(",")
  );
  await updateAdmissionProduct(A.actor, timed.id, { published: false } as never);
  const afterUnpublish = await cardIds();
  check(
    "unpublishing a product removes only that card",
    !afterUnpublish.has(timed.id) && afterUnpublish.has(dayPass.id) && afterUnpublish.has(party.id)
  );
  await updateAdmissionProduct(A.actor, timed.id, { published: true } as never);
  await enablePublic(south.id, false);
  const afterParkOff = await cardIds();
  check(
    "publicBookingEnabled=false removes only that park's cards",
    !afterParkOff.has(dayPass.id) && afterParkOff.has(timed.id) && afterParkOff.has(party.id)
  );
  await enablePublic(south.id, true);
  const restored = await cardIds();
  check("cards return when re-enabled", restored.has(timed.id) && restored.has(dayPass.id));
  const lockedSource = fs.readFileSync(path.join(process.cwd(), "src/lib/publicCategory/resolve.ts"), "utf8");
  check(
    "public listing is company-wide, not tied to a staff park assignment",
    !/actorLocationScope|MembershipVenueAssignment|parkAdminScope/.test(lockedSource) &&
      new Set((await listCompanyBookingCards(siteA!)).map((c) => c.parkName)).size >= 2
  );

  // ── Frame origins + return URL guards ──
  const allowedA = await companyFrameOrigins(A.org.id);
  check(
    "frame origins = saved embed origins + https website origin",
    allowedA.includes(partnerOrigin) && allowedA.includes(websiteOrigin) && allowedA.length === 2,
    allowedA.join(" ")
  );
  check("http website is never a frame origin", websiteFrameOrigin("http://insecure.test") === null && (await companyFrameOrigins(B.org.id)).length === 0);
  const guard = async (fn: () => Promise<unknown> | unknown) => {
    try {
      await fn();
      return true;
    } catch {
      return false;
    }
  };
  check(
    "embed checkout origin check: partner ok, unknown parent or request origin rejected",
    (await guard(() => assertEmbedCheckoutOrigin(A.org.id, { parentOrigin: partnerOrigin, requestOrigin: APP_BASE }))) &&
      (await guard(() => assertEmbedCheckoutOrigin(A.org.id, { parentOrigin: websiteOrigin, requestOrigin: `${APP_BASE}/x` }))) &&
      !(await guard(() => assertEmbedCheckoutOrigin(A.org.id, { parentOrigin: evilOrigin, requestOrigin: APP_BASE }))) &&
      !(await guard(() => assertEmbedCheckoutOrigin(A.org.id, { parentOrigin: partnerOrigin, requestOrigin: evilOrigin }))) &&
      !(await guard(() => assertEmbedCheckoutOrigin(A.org.id, { parentOrigin: null, requestOrigin: APP_BASE }))) &&
      !(await guard(() => assertEmbedCheckoutOrigin(B.org.id, { parentOrigin: partnerOrigin, requestOrigin: APP_BASE })))
  );
  const embedReturn = companyCheckoutReturnUrl(A.org.slug, slugA, { embed: true });
  check(
    "embedded return URL stays on the company path and keeps embed=1",
    embedReturn === `${APP_BASE}/${A.org.slug}/${slugA}/payment/success?embed=1&session_id={CHECKOUT_SESSION_ID}` &&
      (await guard(() => assertCompanyReturnUrl(embedReturn, A.org.slug, slugA))) &&
      !(await guard(() => assertCompanyReturnUrl(`${APP_BASE}/${B.org.slug}/${slugA}/payment/success`, A.org.slug, slugA))) &&
      !(await guard(() => assertCompanyReturnUrl(`https://evil.test/${A.org.slug}/${slugA}/payment/success`, A.org.slug, slugA))) &&
      !(await guard(() => assertCompanyReturnUrl(`${APP_BASE}/${A.org.slug}/${slugA}/payment/../../admin`, A.org.slug, slugA)))
  );

  // ── Snippet + loader ──
  const snippet = publicCategoryEmbedSnippet(A.org.slug, slugA);
  check(
    "snippet: marked container, iframe ?embed=1 at width 100% with no border, loader script",
    snippet.includes(`data-company-category-embed data-org="${A.org.slug}" data-category="${slugA}"`) &&
      snippet.includes(`src="${APP_BASE}/${A.org.slug}/${slugA}?embed=1"`) &&
      snippet.includes('width="100%"') &&
      snippet.includes("border:0") &&
      snippet.includes(`src="${APP_BASE}/embed/category.js"`) &&
      !snippet.includes("layout")
  );
  check(
    "snippet escapes slugs and is unique per category",
    !publicCategoryEmbedSnippet('a"><script>', "x").includes('"><script>') &&
      publicCategoryEmbedSnippet(A.org.slug, slugA) !== publicCategoryEmbedSnippet(B.org.slug, slugA)
  );
  {
    const { embedParentOrigin } = await import("../src/lib/publicCategory/embedParent.ts");
    const g = globalThis as unknown as { window?: unknown; document?: unknown };
    const store = new Map<string, string>();
    const frameWindow = {
      parent: {},
      location: { origin: APP_BASE, ancestorOrigins: undefined },
      sessionStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    };
    const withReferrer = (referrer: string) => {
      g.window = frameWindow;
      g.document = { referrer };
      try {
        return embedParentOrigin();
      } finally {
        delete g.window;
        delete g.document;
      }
    };
    const unknownParent = withReferrer(`${APP_BASE}/x`);
    const firstLoad = withReferrer(`${partnerOrigin}/book`);
    const afterInFrameNav = withReferrer(`${APP_BASE}/${A.org.slug}/${slugA}?embed=1`);
    check(
      "embed parent origin: partner from first load, kept after in-frame navigation, never guessed as the app",
      unknownParent === null && firstLoad === partnerOrigin && afterInFrameNav === partnerOrigin,
      `${unknownParent} ${firstLoad} ${afterInFrameNav}`
    );
  }
  const shareSource = fs.readFileSync(
    path.join(process.cwd(), "src/components/Protected/admin/pages/public-category/PublicCategoryShareControls.tsx"),
    "utf8"
  );
  check("Copy embed is disabled while embedding is off", shareSource.includes("disabled={!page.embedEnabled}"));
  const copyMenuSource = fs.readFileSync(
    path.join(process.cwd(), "src/components/Protected/admin/pages/public-category/PublicCategoryCopyMenu.tsx"),
    "utf8"
  );
  const categoryTables = [
    "src/components/Protected/admin/pages/ticketing/BookingCategoriesPage.tsx",
    "src/components/Protected/admin/pages/memberships/MembershipCategoriesPage.tsx",
    "src/components/Protected/admin/pages/categories/CategoriesTable.tsx",
  ].map((file) => fs.readFileSync(path.join(process.cwd(), file), "utf8"));
  check(
    "Actions Copy menu: link + iframe on booking, membership and menu tables; iframe off while embedding is off, inactive pages greyed out",
    copyMenuSource.includes("copy(page.url, 'link')") &&
      copyMenuSource.includes("copy(page.embedSnippet, 'embed')") &&
      copyMenuSource.includes("disabled={!page.embedEnabled}") &&
      copyMenuSource.includes("disabled={!page.active}") &&
      categoryTables.every((src) => src.includes("<PublicCategoryCopyMenu page="))
  );
  const loaderSource = fs.readFileSync(path.join(process.cwd(), "public/embed/category.js"), "utf8");
  check(
    "loader has no secrets and does not claim to read the parent DOM from the frame",
    !/sk_(test|live)_|whsec_|pk_(test|live)_|secret|password|token/i.test(loaderSource.replace(/no secrets/i, ""))
  );

  // ── HTTP ──
  let httpOk = true;
  try {
    await http("/");
  } catch {
    httpOk = false;
  }
  check("dev server reachable", httpOk, BASE);
  if (!httpOk) return finish();

  const home = await http(`/${A.org.slug}/${slugA}`);
  const homeText = decodeHtml(home.text);
  check("direct company link 200", home.status === 200, String(home.status));
  check("title = company + category, no FECSYNC", titleOf(home.text) === "Skyline Fun Co — Birthday Bash", titleOf(home.text));
  check("company page has no platform chrome", CHROME_MARKERS.every((m) => !home.text.includes(m)));
  check(
    "allowed profile fields render, private ones never do",
    homeText.includes("555-0199") &&
      homeText.includes(logoFile) &&
      homeText.includes(websiteOrigin) &&
      homeText.includes(`${stamp} Coaster Rd`) &&
      ![`support-${stamp}@`, `billing-${stamp}@`, `TAX-${stamp}`, `Bank${stamp}`, `Holder ${stamp}`, `8${stamp}`, `7${stamp}`].some((v) =>
        homeText.includes(v)
      )
  );
  const homeB = await http(`/${B.org.slug}/${slugA}`);
  check(
    "same category name, different company paths, each grid only its own products",
    homeB.status === 200 &&
      decodeHtml(homeB.text).includes(`Foreign ${stamp}`) &&
      !decodeHtml(homeB.text).includes(`Day ${stamp}`) &&
      !homeText.includes(`Foreign ${stamp}`) &&
      homeText.includes(`Day ${stamp}`)
  );

  const csp = home.headers.get("content-security-policy") || "";
  check(
    "company page: no X-Frame-Options, frame-ancestors = self + saved + website origins",
    !home.headers.get("x-frame-options") &&
      csp === `frame-ancestors 'self' ${partnerOrigin} ${websiteOrigin}`,
    csp
  );
  const cspB = (await http(`/${B.org.slug}/${slugA}?embed=1`)).headers.get("content-security-policy");
  check("company without https origins can only be framed by the app", cspB === "frame-ancestors 'self'", String(cspB));
  const sameOrigin: string[] = [];
  for (const p of [
    "/",
    "/admin",
    `/book/${north.slug}`,
    "/shop",
    "/cart",
    "/checkout",
    "/api/public/booking/venues",
    "/payment/success",
    "/embed/category.js",
    "/signin",
    "/brand/fecsync-mark.svg",
    "/fast/h1.webp",
  ]) {
    const r = await http(p);
    if (r.headers.get("x-frame-options") !== "SAMEORIGIN" || r.headers.get("content-security-policy")) sameOrigin.push(`${p}:${r.status}`);
  }
  check("every other route keeps SAMEORIGIN and gets no company CSP", sameOrigin.length === 0, sameOrigin.join(" "));

  const embedHome = await http(`/${A.org.slug}/${slugA}?embed=1`);
  check(
    "embed=1 renders company content without chrome, with document scrolling",
    embedHome.status === 200 &&
      embedHome.text.includes('data-company-embed="1"') &&
      embedHome.text.includes("html{overflow:auto!important") &&
      decodeHtml(embedHome.text).includes(`Day ${stamp}`) &&
      CHROME_MARKERS.every((m) => !embedHome.text.includes(m)),
    String(embedHome.status)
  );
  check(
    "embed links keep embed=1",
    decodeHtml(embedHome.text).includes(`/${A.org.slug}/${slugA}/p/${timed.id}?embed=1`) &&
      decodeHtml(embedHome.text).includes(`/${A.org.slug}/${slugA}/party/${party.id}?embed=1`)
  );
  check("saved layout auto is rendered", embedHome.text.includes('data-company-layout="auto"'));
  await updateBookingCategory(A.actor, catA.id, { layout: "stack" });
  check(
    "layout change reaches the same embed URL on the next load",
    (await http(`/${A.org.slug}/${slugA}?embed=1`)).text.includes('data-company-layout="stack"')
  );
  await updateBookingCategory(A.actor, catA.id, { layout: "auto" });

  const embedPages = await Promise.all(
    [`/p/${timed.id}`, `/party/${party.id}`, `/checkout?productId=${dayPass.id}`, "/payment/success", "/payment/cancel"].map((s) =>
      http(`/${A.org.slug}/${slugA}${s}${s.includes("?") ? "&" : "?"}embed=1`)
    )
  );
  check(
    "package, party, checkout, success, cancel all render in embed mode",
    embedPages.every((r) => r.status === 200 && r.text.includes('data-company-embed="1"')),
    embedPages.map((r) => r.status).join(",")
  );
  const cancelEmbed = decodeHtml(embedPages[4].text);
  check("embed cancel page links back with embed=1", cancelEmbed.includes(`href="/${A.org.slug}/${slugA}?embed=1"`));

  await updateBookingCategory(A.actor, catA.id, { embedEnabled: false });
  const disabledEmbed = await http(`/${A.org.slug}/${slugA}?embed=1`);
  const disabledDirect = await http(`/${A.org.slug}/${slugA}`);
  check(
    "embedEnabled=false: embed 404, direct link still 200",
    disabledEmbed.status === 404 && disabledDirect.status === 200,
    `${disabledEmbed.status} ${disabledDirect.status}`
  );
  const disabledCheckout = await http(`/api/public/category/${A.org.slug}/${slugA}/checkout`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: APP_BASE },
    body: JSON.stringify({
      productId: dayPass.id,
      lines: [{ productId: dayPass.id, qty: 1, priceBandCode: "adult" }],
      primaryContactName: "Off",
      primaryContactEmail: `off-${stamp}@test.local`,
      embed: true,
      embedOrigin: partnerOrigin,
    }),
  });
  check("embed checkout refused while embedding is off", disabledCheckout.status === 404, String(disabledCheckout.status));
  await updateBookingCategory(A.actor, catA.id, { embedEnabled: true });

  const safe404 = async (p: string) => {
    const r = await http(p);
    // The storefront case requests /fecsync/…; the echoed request path is not a leak.
    const body = r.text.toLowerCase().split(p.toLowerCase()).join("").split(p.split("/")[1].toLowerCase()).join("");
    return (
      r.status === 404 &&
      !/FECSYNC|Fecsync/.test(r.text) &&
      !body.includes("fecsync") &&
      ![`bank${stamp}`, `tax-${stamp}`, `billing-${stamp}@`, `holder ${stamp}`].some((v) => body.includes(v))
    );
  };
  check("cross-tenant product id 404 with a safe body", await safe404(`/${A.org.slug}/${slugA}/p/${foreign.id}`));
  check("Demo company 404", await safe404(`/${D.org.slug}/${catD.publicPage!.slug}`));
  check("pending company 404", await safe404(`/${P.org.slug}/${catP.publicPage!.slug}`));
  check("suspended company 404", await safe404(`/${S.org.slug}/${catS.publicPage!.slug}`));
  check("ticketing-off booking page 404", await safe404(`/${C.org.slug}/${catC.publicPage!.slug}`));
  check("memberships-off membership page 404", await safe404(`/${B.org.slug}/${memB.publicPage!.slug}`));
  check("archived category page 404", await safe404(`/${A.org.slug}/${catArch.publicPage!.slug}`));
  check("unknown slug 404", await safe404(`/${A.org.slug}/nope-${stamp}`));
  check("park without public booking: product 404", await safe404(`/${A.org.slug}/${slugA}/p/${closedPass.id}`));
  if (storefront) {
    const storeCat = await prisma.productCategory.create({ data: { orgId: storefront.id, name: `CCP Store ${stamp}` } });
    const storePage = await prisma.publicCategoryPage.create({
      data: { orgId: storefront.id, kind: "menu", productCategoryId: storeCat.id, slug: `ccp-store-${stamp}` },
    });
    check("default storefront 404", await safe404(`/${storefront.slug}/${storePage.slug}`));
    await prisma.publicCategoryPage.delete({ where: { id: storePage.id } });
    await prisma.productCategory.delete({ where: { id: storeCat.id } });
  }
  const memHttp = await http(`/${A.org.slug}/${memA.publicPage!.slug}`);
  check(
    "membership cards render with no buy action",
    memHttp.status === 200 && decodeHtml(memHttp.text).includes(`Gold ${stamp}`) && !/<form|<button/i.test(memHttp.text.split("<main")[1] ?? "")
  );

  // ── Checkout API: embed origins, return URLs, hosted split ──
  const stripeReady = Boolean(process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_"));
  check("Stripe test key available", stripeReady);
  const stripe = getStripe();
  const checkoutBody = (tag: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      productId: dayPass.id,
      lines: [{ productId: dayPass.id, qty: 1, priceBandCode: "adult" }],
      primaryContactName: `Guest ${tag}`,
      primaryContactEmail: `${tag}-${stamp}@test.local`,
      ...extra,
    });
  const postCheckout = (body: string, origin: string) =>
    http(`/api/public/category/${A.org.slug}/${slugA}/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body,
    });
  const bookingCount = () => prisma.booking.count({ where: { orgId: A.org.id } });
  const countBeforeBad = await bookingCount();
  const evilParent = await postCheckout(checkoutBody("evilparent", { embed: true, embedOrigin: evilOrigin }), APP_BASE);
  const evilRequest = await postCheckout(checkoutBody("evilrequest", { embed: true, embedOrigin: partnerOrigin }), evilOrigin);
  check(
    "embed checkout from an unauthorized origin is rejected before any booking",
    evilParent.status === 403 && evilRequest.status === 403 && (await bookingCount()) === countBeforeBad,
    `${evilParent.status} ${evilRequest.status}`
  );
  const okEmbed = await postCheckout(checkoutBody("embed", { embed: true, embedOrigin: partnerOrigin }), APP_BASE);
  const okEmbedJson = JSON.parse(okEmbed.text) as { data?: { booking: { publicId: string }; payment: { clientSecret: string; cancel: { paymentId: string } } | null } };
  const embedResult = okEmbedJson.data;
  check("authorized embed checkout succeeds", okEmbed.status === 201 && Boolean(embedResult?.payment?.clientSecret), String(okEmbed.status));
  check("embed checkout response has no viewToken", !okEmbed.text.includes("viewToken"));
  const direct = await postCheckout(checkoutBody("direct"), APP_BASE);
  const directResult = (JSON.parse(direct.text) as { data?: typeof embedResult }).data;
  check("direct (non-embed) company checkout still allowed", direct.status === 201 && Boolean(directResult?.payment?.clientSecret));

  if (embedResult?.payment && directResult?.payment) {
    const embedSessionId = embedResult.payment.clientSecret.split("_secret_")[0];
    const embedSession = await stripe.checkout.sessions.retrieve(embedSessionId);
    const directSession = await stripe.checkout.sessions.retrieve(directResult.payment.clientSecret.split("_secret_")[0]);
    check(
      "embed session: embedded ui, return URL on company path with embed=1",
      embedSession.ui_mode === "embedded" &&
        embedSession.url == null &&
        embedSession.return_url === `${APP_BASE}/${A.org.slug}/${slugA}/payment/success?embed=1&session_id={CHECKOUT_SESSION_ID}`,
      `${embedSession.ui_mode} ${embedSession.return_url}`
    );
    check(
      "direct session: embedded ui, return URL on company path without embed",
      directSession.ui_mode === "embedded" &&
        directSession.return_url === `${APP_BASE}/${A.org.slug}/${slugA}/payment/success?session_id={CHECKOUT_SESSION_ID}`
    );
    const embedBooking = await prisma.booking.findFirstOrThrow({ where: { publicId: embedResult.booking.publicId } });
    check(
      "embed booking is a normal Booking on the product's park",
      embedBooking.orgId === A.org.id && embedBooking.locationId === south.id && embedSession.metadata?.type === "venue_booking"
    );
    const success = await http(`/${A.org.slug}/${slugA}/payment/success?embed=1&session_id=${embedSessionId}`);
    check(
      "embed success page stays in the frame and links back with embed=1",
      success.status === 200 &&
        success.text.includes('data-company-embed="1"') &&
        decodeHtml(success.text).includes(`href="/${A.org.slug}/${slugA}?embed=1"`) &&
        decodeHtml(success.text).includes(embedBooking.publicId)
    );
    const foreignConfirm = await confirmCompanyCheckoutSession({
      orgId: B.org.id,
      sessionId: embedSessionId,
      retrieveSession: async () => ({ ...embedSession, payment_status: "paid" }) as typeof embedSession,
    });
    check("another company's slug cannot confirm this session", foreignConfirm.status === "missing");

    // Signed webhook through the real route, then a replay.
    const paid = { ...embedSession, payment_status: "paid", payment_intent: null } as typeof embedSession;
    const sessionsApi = stripe.checkout.sessions as unknown as { retrieve: (id: string) => Promise<unknown> };
    const realRetrieve = sessionsApi.retrieve.bind(sessionsApi);
    sessionsApi.retrieve = async (id: string) => (id === embedSessionId ? paid : realRetrieve(id));
    const webhookSecret = `whsec_smoke_${stamp}`;
    const prevSecret = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    const { workAsyncStorage } = await import("next/dist/server/app-render/work-async-storage.external.js");
    const { workUnitAsyncStorage } = await import("next/dist/server/app-render/work-unit-async-storage.external.js");
    const { HeadersAdapter } = await import("next/dist/server/web/spec-extension/adapters/headers.js");
    const { POST: webhookPost } = await import("../src/app/api/webhooks/stripe/route.ts");
    const event = {
      id: `evt_ccp_${stamp}`,
      object: "event",
      type: "checkout.session.completed",
      created: Math.floor(Date.now() / 1000),
      data: { object: paid },
    };
    const deliver = async () => {
      const payload = JSON.stringify(event);
      const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
      const reqHeaders = new Headers({ "stripe-signature": sig, "content-type": "application/json" });
      const req = new Request(`${BASE}/api/webhooks/stripe`, { method: "POST", body: payload, headers: reqHeaders });
      const res = await workAsyncStorage.run(
        { route: "/api/webhooks/stripe", forceStatic: false, dynamicShouldError: false } as never,
        () =>
          workUnitAsyncStorage.run(
            { type: "request", phase: "action", headers: HeadersAdapter.seal(reqHeaders) } as never,
            () => webhookPost(req as never)
          )
      );
      return (await res.json()) as { data?: { settled?: boolean; kind?: string; idempotent?: boolean } };
    };
    const hook1 = await deliver();
    const afterHook = await prisma.booking.findFirstOrThrow({ where: { id: embedBooking.id } });
    const creds = await prisma.ticketCredential.count({ where: { bookingId: embedBooking.id } });
    const hook2 = await deliver();
    const afterReplay = await prisma.booking.findFirstOrThrow({ where: { id: embedBooking.id } });
    sessionsApi.retrieve = realRetrieve;
    if (prevSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = prevSecret;
    check(
      "webhook settles the embed booking as venue_booking",
      hook1.data?.kind === "venue_booking" && hook1.data?.settled === true && afterHook.status === "confirmed",
      JSON.stringify(hook1.data)
    );
    check(
      "webhook replay does not settle twice",
      hook2.data?.idempotent === true &&
        (await prisma.bookingPayment.count({ where: { bookingId: embedBooking.id, status: "completed" } })) === 1 &&
        afterReplay.amountPaid.toString() === afterHook.amountPaid.toString() &&
        (await prisma.ticketCredential.count({ where: { bookingId: embedBooking.id } })) === creds
    );
    const adminBookings = await listBookings(A.actor, { take: 200 });
    const adminPayments = await listBookingPayments(A.actor, {});
    check(
      "embed booking + payment appear on the company's existing admin lists",
      adminBookings.bookings.some((b: { id: string }) => b.id === embedBooking.id) &&
        adminPayments.some((p) => p.bookingId === embedBooking.id && p.status === "completed")
    );
    check(
      "other company cannot see it",
      !(await listBookingPayments(B.actor, {})).some((p) => p.bookingId === embedBooking.id)
    );
  }

  const bookHold = await createPublicHold({ orgSlug: A.org.slug, venueSlug: north.slug, productId: timed.id, sessionId: session.id, qty: 1 });
  const bookBooking = await publicCheckout({
    orgSlug: A.org.slug,
    venueSlug: north.slug,
    holdId: bookHold.holdId,
    holdToken: bookHold.token,
    lines: [{ productId: timed.id, qty: 1, priceBandCode: "adult" }],
    primaryContactName: "Book Guest",
    primaryContactEmail: `book-${stamp}@test.local`,
  });
  const hosted = await beginPublicCardPayment({ bookingPublicId: bookBooking.publicId, viewToken: bookBooking.viewToken! });
  check(
    "/book still uses hosted Checkout (session url, no client secret)",
    "checkoutUrl" in hosted && typeof hosted.checkoutUrl === "string" && hosted.checkoutUrl.startsWith("https://") && !("clientSecret" in hosted)
  );
  const linkBooking = await publicCheckout({
    orgSlug: A.org.slug,
    venueSlug: south.slug,
    lines: [{ productId: dayPass.id, qty: 1, priceBandCode: "adult" }],
    primaryContactName: "Link Guest",
    primaryContactEmail: `link-${stamp}@test.local`,
  } as never);
  const linkRow = await prisma.booking.findFirstOrThrow({ where: { publicId: linkBooking.publicId } });
  const link = await createPaymentLink(A.actor, linkRow.id);
  const linkPay = await settlePublicPaymentLink(link.token);
  check(
    "payment links still use hosted Checkout",
    "checkoutUrl" in linkPay && typeof linkPay.checkoutUrl === "string" && linkPay.checkoutUrl.startsWith("https://") && !("clientSecret" in linkPay)
  );

  // ── Static: routes outside PublicLayout, menu off the cart, membership billing untouched ──
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(tsx?|css)$/.test(e.name) ? [path.join(dir, e.name)] : []
    );
  const siteFiles = [...walk(path.join(process.cwd(), "src/app/(company-site)")), ...walk(path.join(process.cwd(), "src/components/Public_C/companySite"))];
  const chromeImports = siteFiles.filter((f) =>
    /from\s+["'][^"']*(publiclayout|PublicLayout|venueflow|VenueFlow|Layout\/header|Layout\/footer|chatbot|ChatBot)[^"']*["']/.test(fs.readFileSync(f, "utf8"))
  );
  const cartRefs = siteFiles.filter((f) => /services\/cart|useCart|cartStore|\/api\/cart/.test(fs.readFileSync(f, "utf8")));
  check("company routes are outside PublicLayout and never import site chrome", chromeImports.length === 0, chromeImports.join(","));
  check("company pages never touch the shop cart", cartRefs.length === 0, cartRefs.join(","));
  const membershipApi = walk(path.join(process.cwd(), "src/app/api")).filter((f) => /memberships/.test(f));
  check(
    "membership sell/redeem/billing APIs do not depend on company pages",
    membershipApi.length > 0 && membershipApi.every((f) => !/publicCategory/.test(fs.readFileSync(f, "utf8")))
  );
  const rateSource = fs.readFileSync(path.join(process.cwd(), "src/lib/publicCategory/companySitePage.ts"), "utf8");
  const routeSource = fs.readFileSync(path.join(process.cwd(), "src/app/api/public/category/[orgSlug]/[categorySlug]/checkout/route.ts"), "utf8");
  check(
    "public resolve and checkout rate limits remain",
    /consumeRateLimit\(`public-category-resolve:/.test(rateSource) && /apiRateLimited\(request, "public-category-checkout"/.test(routeSource)
  );

  // ── Headless Chrome: frames, layouts, scroll, loader, CSP, cancel ──
  const exe = chromePath();
  check("local Chrome/Edge available for browser checks", Boolean(exe), exe ?? "set SMOKE_CHROME_PATH");
  if (exe) await browserChecks(exe);

  async function browserChecks(executablePath: string) {
    const puppeteer = (await import("puppeteer-core")).default;
    const browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: [
        "--allow-running-insecure-content",
        "--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests",
        "--no-first-run",
      ],
    });
    const shotDir = path.join(os.tmpdir(), "smoke-company-category");
    fs.mkdirSync(shotDir, { recursive: true });
    try {
      const harness = (scriptTwice: boolean) => `<!doctype html><html><head><title>Partner site</title></head><body style="margin:0;font-family:sans-serif">
<h2>Wide</h2><div id="wide" data-company-category-embed data-org="${A.org.slug}" data-category="${slugA}" style="width:1000px;height:900px"></div>
<h2>Narrow</h2><div id="narrow" data-company-category-embed data-org="${A.org.slug}" data-category="${slugA}" style="width:340px;height:900px"></div>
<h2>Short</h2><div id="short" data-company-category-embed data-org="${A.org.slug}" data-category="${slugA}" style="width:1000px;height:220px"></div>
<h2>Tiny</h2><div id="tiny" data-company-category-embed data-org="${A.org.slug}" data-category="${slugA}" style="width:200px;height:600px"></div>
<script src="${BASE}/embed/category.js"></script>
${scriptTwice ? `<script src="${BASE}/embed/category.js"></script>` : ""}
</body></html>`;
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 1000 });
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const url = req.url();
        if (url.startsWith(partnerOrigin) || url.startsWith(evilOrigin)) {
          void req.respond({ status: 200, contentType: "text/html", body: harness(true) });
        } else {
          void req.continue({ headers: { ...req.headers(), "x-forwarded-for": testIp() } });
        }
      });

      const loadFrames = async (origin: string) => {
        await page.goto(`${origin}/`, { waitUntil: "load", timeout: 180_000 });
        await page.waitForFunction(() => document.querySelectorAll("iframe[data-company-category-frame]").length >= 4, { timeout: 60_000 });
        const byId: Record<string, import("puppeteer-core").Frame | null> = {};
        for (const id of ["wide", "narrow", "short", "tiny"]) {
          const handle = await page.$(`#${id} iframe`);
          byId[id] = handle ? await handle.contentFrame() : null;
        }
        return byId;
      };
      const waitGrid = async (f: import("puppeteer-core").Frame | null) => {
        if (!f) return false;
        try {
          await f.waitForSelector("[data-company-layout]", { timeout: 120_000 });
          return true;
        } catch {
          return false;
        }
      };
      const columns = (f: import("puppeteer-core").Frame) =>
        f.evaluate(() => {
          const el = document.querySelector("[data-company-layout]");
          return el ? getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length : 0;
        });
      const layoutColumns = async (f: import("puppeteer-core").Frame | null, mode: string) => {
        if (!f) return { mode: "missing", cols: 0 };
        try {
          await f.waitForFunction(
            (m) => document.querySelector("[data-company-layout]")?.getAttribute("data-company-layout") === m,
            { timeout: 120_000 },
            mode
          );
          return { mode, cols: await columns(f) };
        } catch (err) {
          return { mode: `not ${mode}: ${(err as Error).message.slice(0, 80)}`, cols: 0 };
        }
      };

      let frames = await loadFrames(partnerOrigin);
      const allReady = (await Promise.all(Object.values(frames).map(waitGrid))).every(Boolean);
      check("allowed partner origin can frame the company page (CSP)", allReady);
      const iframeCount = await page.evaluate(() => {
        (window as unknown as { __companyCategoryEmbed?: { scan: () => void } }).__companyCategoryEmbed?.scan();
        const s = document.createElement("script");
        s.src = document.querySelector('script[src*="/embed/category.js"]')!.getAttribute("src")!;
        document.body.appendChild(s);
        return new Promise<number[]>((resolve) =>
          s.addEventListener("load", () =>
            resolve(["wide", "narrow", "short", "tiny"].map((id) => document.querySelectorAll(`#${id} iframe`).length))
          )
        );
      });
      check("loader loaded 3x + rescanned never duplicates an iframe", iframeCount.every((n) => n === 1), iframeCount.join(","));
      const sizes = await page.evaluate(() =>
        ["wide", "narrow", "short"].map((id) => {
          const f = document.querySelector(`#${id} iframe`) as HTMLIFrameElement;
          return { w: f.offsetWidth, h: f.offsetHeight, border: getComputedStyle(f).borderTopWidth };
        })
      );
      check(
        "loader sizes each iframe to its marked container, width 100%, no border",
        sizes[0].w === 1000 && sizes[0].h === 900 && sizes[1].w === 340 && sizes[2].h === 220 && sizes.every((s) => s.border === "0px"),
        JSON.stringify(sizes)
      );
      if (allReady) {
        const wideCols = await columns(frames.wide!);
        const narrowCols = await columns(frames.narrow!);
        check("auto: wide frame is a grid, narrow frame is one card", wideCols >= 2 && narrowCols === 1, `wide=${wideCols} narrow=${narrowCols}`);
        const shortScroll = await frames.short!.evaluate(() => {
          window.scrollTo(0, 150);
          return { y: window.scrollY, sh: document.documentElement.scrollHeight, ih: window.innerHeight };
        });
        check("short frame scrolls vertically", shortScroll.sh > shortScroll.ih && shortScroll.y > 0, JSON.stringify(shortScroll));
        const tinyScroll = await frames.tiny!.evaluate(() => {
          window.scrollTo(80, 0);
          return { x: window.scrollX, sw: document.documentElement.scrollWidth, iw: window.innerWidth };
        });
        check("frame narrower than a card scrolls horizontally", tinyScroll.sw > tinyScroll.iw && tinyScroll.x > 0, JSON.stringify(tinyScroll));
        const frameText = await frames.wide!.evaluate(() => document.documentElement.outerHTML);
        check("framed document has no platform chrome", CHROME_MARKERS.every((m) => !frameText.includes(m)));
        await page.screenshot({ path: path.join(shotDir, "embed-auto.png"), fullPage: true });

        await updateBookingCategory(A.actor, catA.id, { layout: "stack" });
        frames = await loadFrames(partnerOrigin);
        const stacked = await layoutColumns(frames.wide, "stack");
        check("stack: wide frame stays one column", stacked.cols === 1, JSON.stringify(stacked));
        await updateBookingCategory(A.actor, catA.id, { layout: "grid" });
        frames = await loadFrames(partnerOrigin);
        const gridded = await layoutColumns(frames.narrow, "grid");
        check("grid: narrow frame is still a grid", gridded.cols >= 2, JSON.stringify(gridded));
        await updateBookingCategory(A.actor, catA.id, { layout: "auto" });

        // Embedded checkout inside the partner frame, then cancel back into the frame.
        frames = await loadFrames(partnerOrigin);
        const frame = frames.wide!;
        await frame.goto(
          `${BASE}/${A.org.slug}/${slugA}/checkout?productId=${dayPass.id}&qty=1&priceBandCode=adult&embed=1`,
          { waitUntil: "load", timeout: 180_000 }
        );
        await frame.waitForSelector('input[placeholder="Full name"]', { timeout: 120_000 });
        await frame.type('input[placeholder="Full name"]', "Frame Guest");
        await frame.type('input[placeholder="Email"]', `frame-${stamp}@test.local`);
        await frame.click('button[type="submit"]');
        let cancelOk = false;
        let cancelUrl = "";
        try {
          await frame.waitForFunction(
            () => [...document.querySelectorAll("button")].some((b) => b.textContent?.includes("Cancel payment")),
            { timeout: 120_000 }
          );
          await page.screenshot({ path: path.join(shotDir, "embed-checkout.png"), fullPage: true });
          await frame.evaluate(() => {
            [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Cancel payment"))?.click();
          });
          await frame.waitForFunction(() => document.body.innerText.includes("Payment cancelled"), { timeout: 120_000 });
          cancelUrl = frame.url();
          cancelOk = cancelUrl.startsWith(`${BASE}/${A.org.slug}/${slugA}/payment/cancel?embed=1`);
        } catch (err) {
          cancelUrl = `${frame.url()} ${(err as Error).message}`;
        }
        check("embed checkout opens Stripe embedded and cancels back into the frame", cancelOk, cancelUrl);
        const frameBooking = await prisma.booking.findFirst({ where: { orgId: A.org.id, primaryContactEmail: `frame-${stamp}@test.local` } });
        check(
          "framed checkout created a normal booking visible to the company",
          Boolean(frameBooking) &&
            frameBooking!.locationId === south.id &&
            (await listBookings(A.actor, { take: 200 })).bookings.some((b: { id: string }) => b.id === frameBooking!.id)
        );
      }

      // Unauthorized origin: the browser must refuse to render the company frame.
      await page.goto(`${evilOrigin}/`, { waitUntil: "load", timeout: 180_000 });
      await new Promise((r) => setTimeout(r, 8000));
      const evilFrames = page.frames().filter((f) => f !== page.mainFrame());
      let rendered = false;
      for (const f of evilFrames) {
        try {
          if (await f.$("[data-company-layout]")) rendered = true;
        } catch {
          /* blocked frame */
        }
      }
      check("unauthorized origin cannot frame the company page", evilFrames.length > 0 && !rendered, `${evilFrames.length} frames`);

      // Direct link in a normal tab: title, logo, allowed details, cancel back to the company page.
      const tab = await browser.newPage();
      await tab.setExtraHTTPHeaders({ "x-forwarded-for": testIp() });
      await tab.goto(`${BASE}/${A.org.slug}/${slugA}`, { waitUntil: "load", timeout: 180_000 });
      await tab.waitForSelector("[data-company-layout]", { timeout: 120_000 });
      const direct = await tab.evaluate(() => ({
        title: document.title,
        text: document.body.innerText,
        logo: Boolean(document.querySelector("img[src*='ccp-logo-']")),
        html: document.documentElement.outerHTML,
      }));
      check(
        "browser: direct link shows company title, logo, allowed details, no marketing chrome",
        direct.title === "Skyline Fun Co — Birthday Bash" &&
          direct.logo &&
          direct.text.includes("555-0199") &&
          !direct.text.includes(`support-${stamp}@`) &&
          CHROME_MARKERS.every((m) => !direct.html.includes(m)),
        direct.title
      );
      await tab.screenshot({ path: path.join(shotDir, "direct.png"), fullPage: true });
      await tab.goto(`${BASE}/${A.org.slug}/${slugA}/checkout?productId=${dayPass.id}&qty=1&priceBandCode=adult`, {
        waitUntil: "load",
        timeout: 180_000,
      });
      await tab.waitForSelector('input[placeholder="Full name"]', { timeout: 120_000 });
      await tab.type('input[placeholder="Full name"]', "Direct Guest");
      await tab.type('input[placeholder="Email"]', `directtab-${stamp}@test.local`);
      await tab.click('button[type="submit"]');
      let directCancel = "";
      try {
        await tab.waitForFunction(
          () => [...document.querySelectorAll("button")].some((b) => b.textContent?.includes("Cancel payment")),
          { timeout: 120_000 }
        );
        await tab.evaluate(() => {
          [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Cancel payment"))?.click();
        });
        await tab.waitForFunction(() => document.body.innerText.includes("Payment cancelled"), { timeout: 120_000 });
        directCancel = tab.url();
      } catch (err) {
        directCancel = `${tab.url()} ${(err as Error).message}`;
      }
      check(
        "browser: direct checkout cancels to the company cancel page",
        directCancel === `${BASE}/${A.org.slug}/${slugA}/payment/cancel`,
        directCancel
      );
      const directBooking = await prisma.booking.findFirst({ where: { orgId: A.org.id, primaryContactEmail: `directtab-${stamp}@test.local` } });
      check(
        "browser: cancelled direct booking is on the company bookings list",
        Boolean(directBooking) && (await listBookings(A.actor, { take: 200 })).bookings.some((b: { id: string }) => b.id === directBooking!.id)
      );
    } finally {
      await browser.close();
    }
  }

  return finish();

  async function finish() {
    await prisma.companyEmbedOrigin.deleteMany({ where: { orgId: A.org.id } }).catch(() => undefined);
    if (failed) {
      console.error(`\n${failed} company category page check(s) failed`);
      process.exit(1);
    }
    console.log("\nCompany category pages smoke OK");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
