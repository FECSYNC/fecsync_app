/**
 * Step 2 company category site: grid scoping, foreign 404s, no cart on menu,
 * no payment from membership cards, embedded company Checkout vs hosted /book,
 * idempotent settle visible on the admin booking lists.
 *   npx tsx scripts/smoke-public-category-step2.mts
 * Needs the dev server on SMOKE_BASE_URL (default http://localhost:3000) for HTTP checks.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
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

// Same interactive transaction window as src/lib/prisma.ts (remote Supabase RTT).
const prisma = new PrismaClient({ transactionOptions: { maxWait: 10_000, timeout: 20_000 } });
const BASE = (process.env.SMOKE_BASE_URL || "http://localhost:3000").replace(/\/$/, "");

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function http(pathname: string) {
  const res = await fetch(`${BASE}${pathname}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(180_000),
  });
  return { status: res.status, text: await res.text() };
}

function titleOf(html: string): string {
  return html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
}

function decodeHtml(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function main() {
  const { createOrganizationWithPlatformAdmin } = await import("../src/lib/orgRegistration.ts");
  const { createVenueLocation } = await import("../src/lib/venueLocations.ts");
  const { createAdmissionProduct, linkProductAddOn } = await import("../src/lib/ticketing/products.ts");
  const { createTicketSession } = await import("../src/lib/ticketing/sessions.ts");
  const { createBookingCategory } = await import("../src/lib/ticketing/categories.ts");
  const { createMembershipCategory } = await import("../src/lib/memberships/categories.ts");
  const { insertPublicCategoryPage } = await import("../src/lib/publicCategory/pages.ts");
  const { upsertCompanyProfile } = await import("../src/lib/companyProfile.ts");
  const { createPublicHold, publicCheckout, beginPublicCardPayment } = await import(
    "../src/lib/ticketing/publicBooking.ts"
  );
  const { settleVenueBookingStripePayment, listBookingPayments } = await import(
    "../src/lib/ticketing/payments.ts"
  );
  const { listBookings } = await import("../src/lib/ticketing/bookingEngine.ts");
  const {
    resolveCompanyCategory,
    listCompanyBookingCards,
    findCompanyBookingProduct,
    listCompanyMenuItems,
    listCompanyMembershipCards,
  } = await import("../src/lib/publicCategory/resolve.ts");
  const { companyCategoryCheckout, confirmCompanyCheckoutSession } = await import(
    "../src/lib/publicCategory/companyCheckout.ts"
  );
  const { isCompanySitePath } = await import("../src/lib/publicCategory/sitePaths.ts");
  const { buildCheckoutSessionParams, getStripe } = await import("../src/lib/stripe.ts");

  const stamp = Date.now();
  const mkUser = (tag: string) =>
    prisma.user.create({
      data: {
        email: `smoke-pubcat2-${tag}-${stamp}@test.local`,
        password: "x",
        username: `smokepc2${tag}${stamp}`,
        firstName: "Step2",
        lastName: tag,
        role: "client",
        isVerified: true,
        joinedAt: new Date(),
      },
    });
  const [userA, userB] = await Promise.all([mkUser("a"), mkUser("b")]);
  const mkOrg = async (tag: string, userId: string) => {
    const reg = await createOrganizationWithPlatformAdmin({
      name: `Step2 ${tag} ${stamp}`,
      slug: `step2-${tag}-${stamp}`,
      userId,
    });
    await prisma.organization.update({
      where: { id: reg.organization.id },
      data: {
        status: "active",
        subscriptionPlan: "growth",
        subscriptionStatus: "active",
        subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
      },
    });
    return reg.organization;
  };
  const [orgA, orgB] = await Promise.all([mkOrg("a", userA.id), mkOrg("b", userB.id)]);
  const actorA = { sub: userA.id, orgId: orgA.id, rolePreset: "platform_admin" as const };
  const actorB = { sub: userB.id, orgId: orgB.id, rolePreset: "platform_admin" as const };

  const enablePublic = (id: string) =>
    prisma.$executeRaw`UPDATE venue_locations SET "publicBookingEnabled" = true WHERE id = ${id}`;
  const parkA1 = await createVenueLocation(actorA, { name: `North ${stamp}`, slug: `north-${stamp}` });
  const parkA2 = await createVenueLocation(actorA, { name: `South ${stamp}`, slug: `south-${stamp}` });
  const parkB = await createVenueLocation(actorB, { name: `Other ${stamp}`, slug: `other-${stamp}` });
  const parkOff = await createVenueLocation(actorA, { name: `Closed ${stamp}`, slug: `closed-${stamp}` });
  await Promise.all([enablePublic(parkA1.id), enablePublic(parkA2.id), enablePublic(parkB.id)]);

  const logoFile = `skyline-${stamp}.png`;
  await upsertCompanyProfile(actorA, {
    tradingName: "Skyline Fun Co",
    phone: "555-0142",
    supportEmail: `support-${stamp}@skyline.test`,
    billingEmail: `billing-${stamp}@skyline.test`,
    website: `https://skyline-${stamp}.test`,
    logoUrl: `https://res.cloudinary.com/demo/image/upload/${logoFile}`,
    addressLine1: `${stamp} Ride Way`,
    city: "Funville",
    taxId: `TAX-${stamp}`,
    bankName: `Bank${stamp}`,
    bankAccountName: `Acct Holder ${stamp}`,
    bankAccountNumber: `8${stamp}`,
    bankRoutingOrIban: `7${stamp}`,
    publicPhone: true,
    publicSupportEmail: false,
    publicLogo: true,
    publicWebsite: true,
    publicAddress: true,
  } as never);

  const catA = await createBookingCategory(actorA, { name: "Birthday Parties" });
  const emptyCat = await createBookingCategory(actorA, { name: "Coming Soon" });
  const catB = await createBookingCategory(actorB, { name: "Birthday Parties" });
  const slugA = catA.publicPage!.slug;
  const emptySlug = emptyCat.publicPage!.slug;

  const { createCapacityResource } = await import("../src/lib/ticketing/resources.ts");
  const room = await createCapacityResource(actorA, {
    name: `Room ${stamp}`,
    type: "party_room",
    locationId: parkA1.id,
    defaultCapacity: 20,
  });
  const product = (actor: typeof actorA, body: Record<string, unknown>) =>
    createAdmissionProduct(actor, { published: true, ...body } as never);
  const [timed, dayPass, party, unpublished, uncategorized, addOn, foreign, closedPark] = await Promise.all([
    product(actorA, { type: "timed_session", name: `Timed ${stamp}`, locationId: parkA1.id, categoryId: catA.id, prices: [{ code: "adult", amount: 20 }] }),
    product(actorA, { type: "day_pass", name: `Day ${stamp}`, locationId: parkA2.id, categoryId: catA.id, prices: [{ code: "adult", amount: 30 }] }),
    product(actorA, { type: "party_package", name: `Party ${stamp}`, locationId: parkA1.id, categoryId: catA.id, resourceId: room.id, minGuests: 1, maxGuests: 20, prices: [{ code: "package", amount: 150 }] }),
    product(actorA, { type: "day_pass", name: `Hidden ${stamp}`, locationId: parkA1.id, categoryId: catA.id, published: false, prices: [{ code: "adult", amount: 10 }] }),
    product(actorA, { type: "day_pass", name: `Loose ${stamp}`, locationId: parkA1.id, prices: [{ code: "adult", amount: 10 }] }),
    product(actorA, { type: "add_on", name: `Socks ${stamp}`, locationId: parkA1.id, categoryId: catA.id, prices: [{ code: "std", amount: 5 }] }),
    product(actorB, { type: "day_pass", name: `Foreign ${stamp}`, locationId: parkB.id, categoryId: catB.id, prices: [{ code: "adult", amount: 12 }] }),
    product(actorA, { type: "day_pass", name: `ClosedPark ${stamp}`, locationId: parkOff.id, categoryId: catA.id, prices: [{ code: "adult", amount: 9 }] }),
  ]);
  await linkProductAddOn(actorA, timed.id, { addOnProductId: addOn.id, required: false, maxQty: 4 });
  const starts = new Date(Date.now() + 3 * 3600_000);
  const session = await createTicketSession(actorA, {
    productId: timed.id,
    startsAt: starts.toISOString(),
    endsAt: new Date(starts.getTime() + 3600_000).toISOString(),
    capacity: 10,
  });

  // ── Booking grid scoping ──
  const siteA = await resolveCompanyCategory(orgA.slug, slugA);
  check("company category resolves by org slug + page slug", siteA?.page.kind === "booking");
  const cards = siteA ? await listCompanyBookingCards(siteA) : [];
  const cardIds = new Set(cards.map((c) => c.id));
  check(
    "booking grid = published category products only",
    cardIds.size === 3 && cardIds.has(timed.id) && cardIds.has(dayPass.id) && cardIds.has(party.id),
    [...cardIds].join(",")
  );
  check(
    "grid excludes unpublished, uncategorized, add-on, other company, park without public booking",
    ![unpublished.id, uncategorized.id, addOn.id, foreign.id, closedPark.id].some((id) => cardIds.has(id))
  );
  check(
    "product on a park without public booking is not bookable here",
    siteA != null && (await findCompanyBookingProduct(siteA, closedPark.id)) == null
  );
  check(
    "multi-park cards show park name",
    cards.find((c) => c.id === dayPass.id)?.parkName === parkA2.name &&
      cards.find((c) => c.id === timed.id)?.parkName === parkA1.name
  );
  check("party card flagged for /party/ link", cards.find((c) => c.id === party.id)?.party === true);
  check(
    "foreign product is not in this company category",
    siteA != null && (await findCompanyBookingProduct(siteA, foreign.id)) == null
  );
  check(
    "foreign org slug cannot read this category",
    (await resolveCompanyCategory(orgB.slug, `${slugA}-x`)) == null
  );

  // ── Menu (no cart) ──
  const fabric = await prisma.fabric.create({
    data: { name: `Cotton ${stamp}`, image: "", type: "cotton", color: "white", orgId: orgA.id },
  });
  const menuCat = await prisma.$transaction(async (tx) => {
    const row = await tx.productCategory.create({ data: { orgId: orgA.id, name: `Snacks ${stamp}` } });
    await insertPublicCategoryPage(tx, { orgId: orgA.id, kind: "menu", name: "Snacks", productCategoryId: row.id });
    return row;
  });
  await prisma.product.create({
    data: {
      name: `Nachos ${stamp}`,
      description: "Cheesy",
      location: "",
      price: 8,
      quantity: 10,
      gender: "unisex",
      categoryId: menuCat.id,
      fabricTypeId: fabric.id,
      orgId: orgA.id,
    },
  });
  const menuPage = await prisma.publicCategoryPage.findFirst({ where: { productCategoryId: menuCat.id } });
  const menuSite = await resolveCompanyCategory(orgA.slug, menuPage!.slug);
  const menuItems = menuSite ? await listCompanyMenuItems(menuSite) : [];
  check("menu grid lists category products", menuItems.length === 1 && menuItems[0].name === `Nachos ${stamp}`);
  const cartPattern = /services\/cart|useCart|cartStore|cart-hydration|\/api\/cart|\/checkout['"`]/;
  const menuSources = [
    "src/components/Public_C/companySite/CompanyCategoryGrids.tsx",
    "src/components/Public_C/companySite/CompanySiteHeader.tsx",
    "src/app/(company-site)/[orgSlug]/layout.tsx",
    "src/app/(company-site)/[orgSlug]/[categorySlug]/layout.tsx",
    "src/app/(company-site)/[orgSlug]/[categorySlug]/page.tsx",
    "src/lib/publicCategory/resolve.ts",
    "src/lib/publicCategory/publicDto.ts",
  ];
  const cartRefs = menuSources.filter((f) =>
    cartPattern.test(fs.readFileSync(path.join(process.cwd(), f), "utf8"))
  );
  check("menu page modules never reference the shop cart", cartRefs.length === 0, cartRefs.join(","));

  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(tsx?|mts)$/.test(e.name) ? [path.join(dir, e.name)] : []
    );
  const companyRouteDir = path.join(process.cwd(), "src/app/(company-site)");
  const chromeImport = /from\s+["'][^"']*(publiclayout|PublicLayout|venueflow|VenueFlow|Layout\/header|Layout\/footer|chatbot|ChatBot)[^"']*["']/;
  const siteFiles = [
    ...walk(companyRouteDir),
    ...walk(path.join(process.cwd(), "src/components/Public_C/companySite")),
    path.join(process.cwd(), "src/app/layout.tsx"),
  ];
  const chromeRefs = siteFiles.filter((f) => chromeImport.test(fs.readFileSync(f, "utf8")));
  check(
    "company routes sit outside (public) and import no site chrome",
    fs.existsSync(companyRouteDir) &&
      !fs.existsSync(path.join(process.cwd(), "src/app/(public)/[orgSlug]")) &&
      chromeRefs.length === 0,
    chromeRefs.map((f) => path.relative(process.cwd(), f)).join(",")
  );
  check(
    "root cart hydration skips company site paths",
    isCompanySitePath(`/${orgA.slug}/${menuPage!.slug}`) &&
      isCompanySitePath(`/${orgA.slug}/${slugA}/p/${timed.id}`) &&
      !isCompanySitePath("/shop/abc") &&
      !isCompanySitePath("/book/park") &&
      !isCompanySitePath("/cart")
  );

  // ── Membership (no payment) ──
  const memCat = await createMembershipCategory(actorA, { name: "Annual Passes" });
  const planBase = {
    orgId: orgA.id,
    categoryId: memCat.id,
    billing: "recurring" as const,
    intervalCount: 1,
    intervalUnit: "month" as const,
    price: 25,
  };
  await prisma.membershipPlan.createMany({
    data: [
      { ...planBase, name: `Visible ${stamp}` },
      { ...planBase, name: `Hidden ${stamp}`, hideFromOnlineSales: true },
      { ...planBase, name: `Archived ${stamp}`, archivedAt: new Date() },
    ],
  });
  const memSite = await resolveCompanyCategory(orgA.slug, memCat.publicPage!.slug);
  const countPayments = async () => {
    const [bp, mpa, gm] = await Promise.all([
      prisma.bookingPayment.count({ where: { orgId: orgA.id } }),
      prisma.membershipPaymentAttempt.count({ where: { orgId: orgA.id } }),
      prisma.guestMembership.count({ where: { orgId: orgA.id } }),
    ]);
    return bp + mpa + gm;
  };
  const paymentsBefore = await countPayments();
  const memCards = memSite ? await listCompanyMembershipCards(memSite) : [];
  check(
    "membership grid = non-archived, online-visible plans",
    memCards.length === 1 && memCards[0].name === `Visible ${stamp}`,
    memCards.map((c) => c.name).join(",")
  );

  // ── HTTP: pages, metadata, 404s ──
  let httpOk = true;
  try {
    await http("/");
  } catch {
    httpOk = false;
  }
  check("dev server reachable for HTTP checks", httpOk, BASE);
  if (httpOk) {
    const home = await http(`/${orgA.slug}/${slugA}`);
    const homeText = decodeHtml(home.text);
    check("company booking page 200", home.status === 200, String(home.status));
    check(
      "title = trading name + category",
      decodeHtml(titleOf(home.text)) === `Skyline Fun Co — ${catA.name}`,
      titleOf(home.text)
    );
    check("page has no platform name", !home.text.includes("FECSYNC"));
    const chromeMarkers = [
      "FECSYNC home",
      "Dismiss announcement",
      "drawer-nav",
      "Toggle navigation",
      "footer-grid",
      "footer-brand",
      "All rights reserved",
      "fixed bottom-4 right-4 z-50",
    ];
    const leaked = chromeMarkers.filter((m) => home.text.includes(m));
    check("no VenueFlow header/footer, shop header, or chatbot markup", leaked.length === 0, leaked.join(","));
    const control = await http("/");
    check(
      "chrome markers are real (present on the storefront home)",
      chromeMarkers.some((m) => control.text.includes(m)),
      chromeMarkers.filter((m) => control.text.includes(m)).join(",")
    );
    check(
      "header shows switched-on phone, logo, website, address",
      homeText.includes("555-0142") &&
        homeText.includes(logoFile) &&
        homeText.includes(`https://skyline-${stamp}.test`) &&
        homeText.includes(`${stamp} Ride Way`) &&
        homeText.includes("Funville")
    );
    const privateValues = [
      `support-${stamp}@skyline.test`,
      `billing-${stamp}@skyline.test`,
      `TAX-${stamp}`,
      `Bank${stamp}`,
      `Acct Holder ${stamp}`,
      `8${stamp}`,
      `7${stamp}`,
    ];
    const privateLeaks = privateValues.filter((v) => homeText.includes(v));
    check(
      "switched-off support email + bank, tax, billing email never render",
      privateLeaks.length === 0,
      privateLeaks.join(",")
    );
    const closedParkPage = await http(`/${orgA.slug}/${slugA}/p/${closedPark.id}`);
    check(
      "park without public booking: product page 404 and not on grid",
      closedParkPage.status === 404 && !homeText.includes(`ClosedPark ${stamp}`),
      String(closedParkPage.status)
    );
    check(
      "grid links stay on company path",
      homeText.includes(`/${orgA.slug}/${slugA}/p/${timed.id}`) &&
        homeText.includes(`/${orgA.slug}/${slugA}/party/${party.id}`)
    );
    check("page has no viewToken", !home.text.includes("viewToken"));

    const embedded = await http(`/${orgA.slug}/${slugA}?embed=1`);
    check("page accepts a later embed query", embedded.status === 200, String(embedded.status));

    const empty = await http(`/${orgA.slug}/${emptySlug}`);
    check(
      "empty category shows header + empty state",
      empty.status === 200 &&
        decodeHtml(empty.text).includes("Skyline Fun Co") &&
        empty.text.includes("Nothing is available to book here right now.")
    );

    const foreignPage = await http(`/${orgA.slug}/${slugA}/p/${foreign.id}`);
    check("foreign product page 404", foreignPage.status === 404, String(foreignPage.status));
    check("404 body has no platform name", !foreignPage.text.includes("FECSYNC"));
    const ownProduct = await http(`/${orgA.slug}/${slugA}/p/${timed.id}`);
    check("own product page 200", ownProduct.status === 200, String(ownProduct.status));
    const ownParty = await http(`/${orgA.slug}/${slugA}/party/${party.id}`);
    const ownCheckout = await http(`/${orgA.slug}/${slugA}/checkout?productId=${timed.id}`);
    check(
      "own party + checkout pages 200",
      ownParty.status === 200 && ownCheckout.status === 200 && !ownCheckout.text.includes("viewToken"),
      `${ownParty.status} ${ownCheckout.status}`
    );
    const cancelPage = await http(`/${orgA.slug}/${slugA}/payment/cancel`);
    const successNoSession = await http(`/${orgA.slug}/${slugA}/payment/success`);
    check(
      "cancel + success pages render on the company path",
      cancelPage.status === 200 &&
        successNoSession.status === 200 &&
        successNoSession.text.includes("Payment not found") &&
        !successNoSession.text.includes("FECSYNC")
    );
    const foreignCheckout = await http(`/${orgA.slug}/${slugA}/checkout?productId=${foreign.id}`);
    check("foreign product checkout 404", foreignCheckout.status === 404, String(foreignCheckout.status));
    const missing = await http(`/${orgA.slug}/no-such-${stamp}`);
    check("missing category slug 404", missing.status === 404, String(missing.status));
    const missingOrg = await http(`/no-org-${stamp}/${slugA}`);
    check("missing org slug 404", missingOrg.status === 404 && !missingOrg.text.includes("FECSYNC"));

    const menuHttp = await http(`/${orgA.slug}/${menuPage!.slug}`);
    check(
      "menu page renders without cart calls",
      menuHttp.status === 200 &&
        decodeHtml(menuHttp.text).includes(`Nachos ${stamp}`) &&
        !menuHttp.text.includes("/api/cart")
    );

    const memHttp = await http(`/${orgA.slug}/${memCat.publicPage!.slug}`);
    check(
      "membership page renders cards with no buy action",
      memHttp.status === 200 &&
        decodeHtml(memHttp.text).includes(`Visible ${stamp}`) &&
        !decodeHtml(memHttp.text).includes(`Hidden ${stamp}`) &&
        !/<form|<button/i.test(memHttp.text.split("<main")[1] ?? "")
    );

    const bookHttp = await http(`/book/${parkA1.slug}`);
    check(
      "static /book route still wins over the org segment",
      bookHttp.status === 200 && !bookHttp.text.includes("This link is not available"),
      String(bookHttp.status)
    );
    const adminHttp = await http("/admin");
    check("static /admin still wins", adminHttp.status !== 404, String(adminHttp.status));

    await upsertCompanyProfile(actorA, { publicPhone: false, publicSupportEmail: true } as never);
    const flipped = decodeHtml((await http(`/${orgA.slug}/${emptySlug}`)).text);
    check(
      "profile switches apply: phone off hides it, support email on shows it",
      !flipped.includes("555-0142") && flipped.includes(`support-${stamp}@skyline.test`)
    );

    await prisma.publicCategoryPage.updateMany({ where: { bookingCategoryId: catA.id }, data: { active: false } });
    const inactive = await http(`/${orgA.slug}/${slugA}`);
    check("inactive page 404", inactive.status === 404, String(inactive.status));
    await prisma.publicCategoryPage.updateMany({ where: { bookingCategoryId: catA.id }, data: { active: true } });
  }
  check("membership cards created no payment", (await countPayments()) === paymentsBefore);

  // ── Default storefront org never resolves ──
  const storefront = await prisma.organization.findFirst({ where: { isDefault: true }, select: { id: true, slug: true } });
  if (storefront) {
    const storeCat = await prisma.productCategory.create({
      data: { orgId: storefront.id, name: `Step2 Store ${stamp}` },
    });
    const storePage = await prisma.publicCategoryPage.create({
      data: { orgId: storefront.id, kind: "menu", productCategoryId: storeCat.id, slug: `step2-store-${stamp}` },
    });
    check("default storefront org never resolves", (await resolveCompanyCategory(storefront.slug, storePage.slug)) == null);
    if (httpOk) {
      const storeHttp = await http(`/${storefront.slug}/${storePage.slug}`);
      check("default storefront org page 404", storeHttp.status === 404, String(storeHttp.status));
    }
    await prisma.publicCategoryPage.delete({ where: { id: storePage.id } });
    await prisma.productCategory.delete({ where: { id: storeCat.id } });
  }

  // ── Checkout: embedded company session vs hosted /book session ──
  const embeddedParams = buildCheckoutSessionParams({
    amount: 10,
    email: "a@test.local",
    metadata: { type: "venue_booking", amount: 10, uuid: "payment_link" },
    uiMode: "embedded",
    returnUrl: "https://x.test/r?session_id={CHECKOUT_SESSION_ID}",
  });
  const hostedParams = buildCheckoutSessionParams({
    amount: 10,
    email: "a@test.local",
    metadata: { type: "venue_booking", amount: 10, uuid: "payment_link" },
    successUrl: "https://x.test/s",
    cancelUrl: "https://x.test/c",
  });
  check(
    "createCheckoutSession defaults to hosted; embedded is opt-in",
    embeddedParams.ui_mode === "embedded" &&
      !embeddedParams.success_url &&
      !embeddedParams.cancel_url &&
      hostedParams.ui_mode === undefined &&
      hostedParams.success_url === "https://x.test/s"
  );

  const stripeReady = Boolean(process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_"));
  check("Stripe test key available", stripeReady);
  if (stripeReady && siteA) {
    const stripe = getStripe();
    const hold = await createPublicHold({
      orgSlug: orgA.slug,
      venueSlug: parkA1.slug,
      productId: timed.id,
      sessionId: session.id,
      qty: 2,
    });
    let foreignHoldRejected = false;
    try {
      await companyCategoryCheckout({
        orgSlug: orgA.slug,
        categorySlug: slugA,
        productId: foreign.id,
        holdToken: hold.token,
        primaryContactEmail: `x-${stamp}@test.local`,
      });
    } catch {
      foreignHoldRejected = true;
    }
    check("company checkout rejects a foreign product", foreignHoldRejected);

    const result = await companyCategoryCheckout({
      orgSlug: orgA.slug,
      categorySlug: slugA,
      productId: timed.id,
      holdId: hold.holdId,
      holdToken: hold.token,
      lines: [{ productId: timed.id, qty: 2, priceBandCode: "adult", sessionId: session.id }, { productId: addOn.id, qty: 1 }],
      primaryContactName: "Ada Guest",
      primaryContactEmail: `ada-${stamp}@test.local`,
    });
    check("company checkout returns an embedded client secret", Boolean(result.payment?.clientSecret));
    check("company checkout response has no viewToken", !JSON.stringify(result).includes("viewToken"));
    const booking = await prisma.booking.findFirstOrThrow({ where: { publicId: result.booking.publicId } });
    check(
      "company booking uses the product's park",
      booking.orgId === orgA.id && booking.locationId === parkA1.id
    );
    const payment = await prisma.bookingPayment.findFirstOrThrow({
      where: { id: result.payment!.cancel.paymentId },
    });
    const checkoutSessionId = result.payment!.clientSecret.split("_secret_")[0];
    const companySession = await stripe.checkout.sessions.retrieve(checkoutSessionId);
    check(
      "company Checkout session is embedded with the company return URL",
      companySession.ui_mode === "embedded" &&
        companySession.url == null &&
        (companySession.return_url ?? "").startsWith(
          `${(process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/$/, "")}/${orgA.slug}/${slugA}/payment/success?session_id=`
        ),
      `${companySession.ui_mode} ${companySession.return_url}`
    );
    check(
      "company session metadata settles as venue_booking",
      companySession.metadata?.type === "venue_booking" &&
        companySession.metadata?.orgId === orgA.id &&
        companySession.metadata?.paymentId === payment.id &&
        !(companySession.return_url ?? "").includes(booking.viewToken ?? "__none__")
    );

    // /book path: same engine, hosted Checkout url.
    const bookHold = await createPublicHold({
      orgSlug: orgA.slug,
      venueSlug: parkA1.slug,
      productId: timed.id,
      sessionId: session.id,
      qty: 1,
    });
    const bookBooking = await publicCheckout({
      orgSlug: orgA.slug,
      venueSlug: parkA1.slug,
      holdId: bookHold.holdId,
      holdToken: bookHold.token,
      lines: [{ productId: timed.id, qty: 1, priceBandCode: "adult" }],
      primaryContactName: "Book Guest",
      primaryContactEmail: `book-${stamp}@test.local`,
    });
    const hosted = await beginPublicCardPayment({
      bookingPublicId: bookBooking.publicId,
      viewToken: bookBooking.viewToken!,
    });
    const hostedUrl = "checkoutUrl" in hosted ? hosted.checkoutUrl : null;
    check("/book checkout still gets a hosted session url", typeof hostedUrl === "string" && hostedUrl.startsWith("https://"));
    check("/book result has no embedded client secret", !("clientSecret" in hosted));

    // Success page confirm: foreign org ignored, then idempotent settle.
    const paidSession = { ...companySession, payment_status: "paid", payment_intent: null } as typeof companySession;
    const retrieveSession = async () => paidSession;
    const foreignConfirm = await confirmCompanyCheckoutSession({
      orgId: orgB.id,
      sessionId: companySession.id,
      retrieveSession,
    });
    const afterForeign = await prisma.bookingPayment.findFirstOrThrow({ where: { id: payment.id } });
    check(
      "success page ignores a session from another company",
      foreignConfirm.status === "missing" && afterForeign.status === "pending"
    );
    const first = await confirmCompanyCheckoutSession({ orgId: orgA.id, sessionId: companySession.id, retrieveSession });
    const settledBooking = await prisma.booking.findFirstOrThrow({ where: { id: booking.id } });
    const second = await confirmCompanyCheckoutSession({ orgId: orgA.id, sessionId: companySession.id, retrieveSession });
    const webhookReplay = await settleVenueBookingStripePayment({
      paymentId: payment.id,
      bookingId: booking.id,
      stripePaymentIntentId: null,
    });
    const afterDouble = await prisma.booking.findFirstOrThrow({ where: { id: booking.id } });
    const completed = await prisma.bookingPayment.count({ where: { bookingId: booking.id, status: "completed" } });
    check("company success confirms the booking", first.status === "ok" && settledBooking.status === "confirmed", first.status);
    check(
      "double confirm + webhook replay do not double-settle",
      second.status === "ok" &&
        "idempotent" in webhookReplay &&
        webhookReplay.idempotent === true &&
        completed === 1 &&
        afterDouble.amountPaid.toString() === settledBooking.amountPaid.toString()
    );

    const adminBookings = await listBookings(actorA, { take: 100 });
    const listed = adminBookings.bookings.find((b: { id: string }) => b.id === booking.id);
    check("settled booking is the same row on /admin/bookings", Boolean(listed));
    const adminPayments = await listBookingPayments(actorA, {});
    const listedPayment = adminPayments.find((p) => p.id === payment.id);
    check(
      "settled payment is on /admin/booking-payments for that booking",
      listedPayment?.bookingId === booking.id && listedPayment.status === "completed"
    );
    const otherPayments = await listBookingPayments(actorB, {});
    check("other company admin list does not see it", !otherPayments.some((p) => p.id === payment.id));

    // Second park: day pass checkout lands on that product's park.
    const south = await companyCategoryCheckout({
      orgSlug: orgA.slug,
      categorySlug: slugA,
      productId: dayPass.id,
      lines: [{ productId: dayPass.id, qty: 1, priceBandCode: "adult" }],
      primaryContactName: "South Guest",
      primaryContactEmail: `south-${stamp}@test.local`,
    });
    const southBooking = await prisma.booking.findFirstOrThrow({ where: { publicId: south.booking.publicId } });
    check(
      "multi-park checkout uses the product's locationId",
      southBooking.orgId === orgA.id && southBooking.locationId === parkA2.id && southBooking.locationId !== parkA1.id,
      `${southBooking.locationId}`
    );

    // Signed checkout.session.completed through the real webhook route.
    const southSessionId = south.payment!.clientSecret.split("_secret_")[0];
    const southSession = await stripe.checkout.sessions.retrieve(southSessionId);
    const southPaid = { ...southSession, payment_status: "paid", payment_intent: null } as typeof southSession;
    const sessionsApi = stripe.checkout.sessions as unknown as { retrieve: (id: string) => Promise<unknown> };
    const realRetrieve = sessionsApi.retrieve.bind(sessionsApi);
    sessionsApi.retrieve = async (id: string) => (id === southSessionId ? southPaid : realRetrieve(id));
    const webhookSecret = `whsec_smoke_${stamp}`;
    const prevSecret = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    const { workAsyncStorage } = await import("next/dist/server/app-render/work-async-storage.external.js");
    const { workUnitAsyncStorage } = await import("next/dist/server/app-render/work-unit-async-storage.external.js");
    const { HeadersAdapter } = await import("next/dist/server/web/spec-extension/adapters/headers.js");
    const { POST: webhookPost } = await import("../src/app/api/webhooks/stripe/route.ts");
    const event = {
      id: `evt_smoke_${stamp}`,
      object: "event",
      type: "checkout.session.completed",
      created: Math.floor(Date.now() / 1000),
      data: { object: southPaid },
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
    const southPayment = await prisma.bookingPayment.findFirstOrThrow({ where: { id: south.payment!.cancel.paymentId } });
    const hook1 = await deliver();
    const afterHook = await prisma.booking.findFirstOrThrow({ where: { id: southBooking.id } });
    const credsAfterHook = await prisma.ticketCredential.count({ where: { bookingId: southBooking.id } });
    const hook2 = await deliver();
    const confirmAfterHook = await confirmCompanyCheckoutSession({
      orgId: orgA.id,
      sessionId: southSessionId,
      retrieveSession: async () => southPaid,
    });
    const afterReplay = await prisma.booking.findFirstOrThrow({ where: { id: southBooking.id } });
    const southCompleted = await prisma.bookingPayment.count({ where: { bookingId: southBooking.id, status: "completed" } });
    sessionsApi.retrieve = realRetrieve;
    if (prevSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = prevSecret;
    check(
      "signed webhook settles the embedded company session as venue_booking",
      hook1.data?.kind === "venue_booking" &&
        hook1.data?.settled === true &&
        afterHook.status === "confirmed" &&
        southPayment.status === "pending",
      JSON.stringify(hook1)
    );
    check(
      "webhook replay + later success page do not double-confirm",
      hook2.data?.idempotent === true &&
        confirmAfterHook.status === "ok" &&
        southCompleted === 1 &&
        afterReplay.amountPaid.toString() === afterHook.amountPaid.toString() &&
        afterReplay.status === "confirmed" &&
        (await prisma.ticketCredential.count({ where: { bookingId: southBooking.id } })) === credsAfterHook,
      JSON.stringify(hook2)
    );

    // Staff payment link still uses hosted Checkout.
    const { createPaymentLink } = await import("../src/lib/ticketing/paymentLinks.ts");
    const { settlePublicPaymentLink } = await import("../src/lib/ticketing/publicBooking.ts");
    const linkBooking = await publicCheckout({
      orgSlug: orgA.slug,
      venueSlug: parkA2.slug,
      lines: [{ productId: dayPass.id, qty: 1, priceBandCode: "adult" }],
      primaryContactName: "Link Guest",
      primaryContactEmail: `link-${stamp}@test.local`,
    } as never);
    const linkRow = await prisma.booking.findFirstOrThrow({ where: { publicId: linkBooking.publicId } });
    const link = await createPaymentLink(actorA, linkRow.id);
    const linkPay = await settlePublicPaymentLink(link.token);
    check(
      "payment link still gets a hosted session url, no client secret",
      "checkoutUrl" in linkPay &&
        typeof linkPay.checkoutUrl === "string" &&
        linkPay.checkoutUrl.startsWith("https://") &&
        !("clientSecret" in linkPay)
    );
  }

  // Cleanup (best effort; bookings may keep the orgs).
  await prisma.publicCategoryPage.deleteMany({ where: { orgId: { in: [orgA.id, orgB.id] } } }).catch(() => undefined);
  await prisma.companyProfile.deleteMany({ where: { orgId: { in: [orgA.id, orgB.id] } } }).catch(() => undefined);

  if (failed) {
    console.error(`\n${failed} public category step 2 check(s) failed`);
    process.exit(1);
  }
  console.log("\nPublic category step 2 smoke OK");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
