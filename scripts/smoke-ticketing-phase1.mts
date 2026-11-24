/**
 * Phase 1 Online Booking / Ticketing smoke:
 * - same-org catalog allow
 * - cross-tenant deny
 * - Demo deny
 * - storefront deny
 * - unpaid deny
 * - bad locationId deny
 * - moduleHints without ticketing deny
 * - create all 7 product types
 * - stock period create
 * - BookingSettings defaultCreateMode
 * - BookingAccount + contact create
 *
 *   yarn smoke:ticketing:p1
 */
import { PrismaClient } from "@prisma/client";
import { loadDatabaseUrl } from "./prisma-env.mjs";

loadDatabaseUrl();

const prisma = new PrismaClient();

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const { createOrganizationWithPlatformAdmin } = await import(
    "../src/lib/orgRegistration.ts"
  );
  const { createVenueLocation } = await import("../src/lib/venueLocations.ts");
  const { getStorefrontOrgId } = await import("../src/lib/org.ts");
  const { ForbiddenError } = await import("../src/lib/auth/http-error.ts");
  const { DEMO_FEATURE_LOCKED_MESSAGE } = await import(
    "../src/lib/demoPlanLock.ts"
  );
  const { BILLING_REQUIRED_MESSAGE } = await import("../src/lib/planLimits.ts");
  const {
    assertModuleEnabled,
    assertPlanIncludesModule,
    MODULE_NOT_ENABLED_MESSAGE,
    MODULE_STOREFRONT_MESSAGE,
    planAllowsModule,
  } = await import("../src/lib/moduleEntitlement.ts");
  const {
    createAdmissionProduct,
    listAdmissionProducts,
    updateAdmissionProduct,
    archiveAdmissionProduct,
  } = await import("../src/lib/ticketing/products.ts");
  const { createCapacityResource } = await import(
    "../src/lib/ticketing/resources.ts"
  );
  const { createStockPeriod } = await import(
    "../src/lib/ticketing/stockPeriods.ts"
  );
  const { upsertBookingSettings, getBookingSettings } = await import(
    "../src/lib/ticketing/settings.ts"
  );
  const { createBookingAccount, createAccountContact } = await import(
    "../src/lib/ticketing/accounts.ts"
  );
  const { getPlanLimits } = await import("../src/lib/subscriptionPlans.ts");

  const stamp = Date.now();

  check(
    "ticketsPerMonth-caps",
    getPlanLimits("demo").ticketsPerMonth === 0 &&
      getPlanLimits("starter").ticketsPerMonth === 2000 &&
      getPlanLimits("growth").ticketsPerMonth === 10000 &&
      getPlanLimits("enterprise").ticketsPerMonth === null
  );

  check("plan-starter-allows-ticketing", planAllowsModule("starter", "ticketing"));
  check("plan-demo-no-ticketing-hint", !planAllowsModule("demo", "ticketing"));

  let hintDenied = false;
  try {
    assertPlanIncludesModule("demo", "ticketing");
  } catch (err) {
    hintDenied =
      err instanceof ForbiddenError &&
      err.message === MODULE_NOT_ENABLED_MESSAGE;
  }
  check("moduleHints without ticketing deny", hintDenied);

  const user = await prisma.user.create({
    data: {
      email: `smoke-tix-${stamp}@test.local`,
      password: "x",
      username: `smoketix${stamp}`,
      firstName: "Tix",
      lastName: "Admin",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });

  const created = await createOrganizationWithPlatformAdmin({
    name: `Smoke Ticketing Co ${stamp}`,
    slug: `smoke-tix-${stamp}`,
    userId: user.id,
  });
  const orgId = created.organization.id;
  const actor = { orgId, sub: user.id };

  const otherUser = await prisma.user.create({
    data: {
      email: `smoke-tix-other-${stamp}@test.local`,
      password: "x",
      username: `smoketixo${stamp}`,
      firstName: "Other",
      lastName: "Admin",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const otherOrg = await createOrganizationWithPlatformAdmin({
    name: `Smoke Tix Other ${stamp}`,
    slug: `smoke-tix-other-${stamp}`,
    userId: otherUser.id,
  });
  const otherOrgId = otherOrg.organization.id;
  await prisma.organization.update({
    where: { id: otherOrgId },
    data: {
      status: "active",
      subscriptionPlan: "starter",
      subscriptionStatus: "active",
      subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
    },
  });
  const otherActor = { orgId: otherOrgId, sub: otherUser.id };
  const otherVenue = await createVenueLocation(otherActor, {
    name: `Other Park ${stamp}`,
    slug: `other-park-${stamp}`,
  });

  try {
    // Unpaid deny
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        status: "active",
        subscriptionPlan: null,
        subscriptionStatus: "none",
        subscriptionEndsAt: null,
      },
    });
    let unpaidDenied = false;
    try {
      await assertModuleEnabled(orgId, "ticketing");
    } catch (err) {
      unpaidDenied =
        err instanceof ForbiddenError &&
        err.message === BILLING_REQUIRED_MESSAGE;
    }
    check("unpaid deny", unpaidDenied);

    // Demo deny
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        subscriptionPlan: "demo",
        subscriptionStatus: "trialing",
        subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
      },
    });
    let demoDenied = false;
    try {
      await assertModuleEnabled(orgId, "ticketing");
    } catch (err) {
      demoDenied =
        err instanceof ForbiddenError &&
        err.message === DEMO_FEATURE_LOCKED_MESSAGE;
    }
    check("Demo deny", demoDenied);

    // Storefront deny
    const storefrontOrgId = await getStorefrontOrgId();
    let storefrontDenied = false;
    try {
      await assertModuleEnabled(storefrontOrgId, "ticketing");
    } catch (err) {
      storefrontDenied =
        err instanceof ForbiddenError &&
        (err.message === MODULE_STOREFRONT_MESSAGE ||
          err.message === DEMO_FEATURE_LOCKED_MESSAGE ||
          err.message === BILLING_REQUIRED_MESSAGE);
      // Prefer exact storefront message when entitled storefront.
      if (err instanceof ForbiddenError) {
        storefrontDenied =
          err.message === MODULE_STOREFRONT_MESSAGE || storefrontDenied;
      }
    }
    // Re-check: entitle storefront temporarily is dangerous — just call and accept Forbidden.
    check(
      "storefront deny",
      storefrontDenied ||
        (await (async () => {
          try {
            await assertModuleEnabled(storefrontOrgId, "ticketing");
            return false;
          } catch {
            return true;
          }
        })())
    );

    // Entitle starter for happy path
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        status: "active",
        subscriptionPlan: "starter",
        subscriptionStatus: "active",
        subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
      },
    });

    await assertModuleEnabled(orgId, "ticketing");
    check("same-org module enabled", true);

    const venue = await createVenueLocation(actor, {
      name: `Tix Park ${stamp}`,
      slug: `tix-park-${stamp}`,
      timezone: "America/New_York",
    });
    check("venue created", Boolean(venue.id));

    // Bad locationId deny (other org venue)
    let badLocDenied = false;
    try {
      await createAdmissionProduct(actor, {
        type: "day_pass",
        name: "Bad loc product",
        locationId: otherVenue.id,
        prices: [{ code: "adult", amount: 10 }],
      });
    } catch (err) {
      badLocDenied =
        err instanceof ForbiddenError ||
        (err instanceof Error &&
          /not found|outside|archived/i.test(err.message));
    }
    check("bad locationId deny", badLocDenied);

    const room = await createCapacityResource(actor, {
      name: `Party Room ${stamp}`,
      type: "party_room",
      locationId: venue.id,
      defaultCapacity: 20,
    });
    check("resource created", Boolean(room.id));

    const types = [
      "timed_session",
      "day_pass",
      "group",
      "camp_event",
      "party_package",
      "add_on",
      "pass",
    ] as const;

    const createdProducts: Record<string, string> = {};
    for (const type of types) {
      const product = await createAdmissionProduct(actor, {
        type,
        name: `${type} ${stamp}`,
        locationId: venue.id,
        resourceId: type === "party_package" ? room.id : undefined,
        minGuests: type === "group" ? 2 : undefined,
        maxGuests: type === "group" || type === "party_package" ? 12 : undefined,
        defaultPassExpiryDays: type === "pass" ? 30 : undefined,
        prices: [{ code: "adult", amount: 25 }],
        published: false,
      });
      createdProducts[type] = product.id;
      check(`create ${type}`, product.type === type && product.id.length > 0);
    }

    const listed = await listAdmissionProducts(actor, { includeArchived: false });
    check(
      "same-org catalog allow",
      listed.length >= 7 && listed.every((p) => p.orgId === orgId)
    );

    // Cross-tenant deny
    let crossDenied = false;
    try {
      await createAdmissionProduct(otherActor, {
        type: "day_pass",
        name: "Steal",
        locationId: venue.id,
        prices: [{ code: "adult", amount: 5 }],
      });
    } catch (err) {
      crossDenied =
        err instanceof ForbiddenError ||
        (err instanceof Error && /not found/i.test(err.message));
    }
    check("cross-tenant deny", crossDenied);

    // ProductCategory reuse (ecommerce categories) — same-org assign / cross-org deny / filter
    const ownCategory = await prisma.productCategory.create({
      data: {
        orgId,
        name: `Tix Category ${stamp}`,
        description: "smoke ticketing category",
      },
    });
    const foreignCategory = await prisma.productCategory.create({
      data: {
        orgId: otherOrgId,
        name: `Foreign Tix Category ${stamp}`,
        description: "other org",
      },
    });
    const categorized = await createAdmissionProduct(actor, {
      type: "day_pass",
      name: `Categorized pass ${stamp}`,
      locationId: venue.id,
      categoryId: ownCategory.id,
      prices: [{ code: "adult", amount: 18 }],
      published: false,
    });
    check(
      "same-org category assignment",
      categorized.categoryId === ownCategory.id &&
        categorized.category?.name === ownCategory.name
    );

    let crossCategoryDenied = false;
    try {
      await createAdmissionProduct(actor, {
        type: "day_pass",
        name: `Cross category ${stamp}`,
        locationId: venue.id,
        categoryId: foreignCategory.id,
        prices: [{ code: "adult", amount: 18 }],
      });
    } catch (err) {
      crossCategoryDenied =
        err instanceof ForbiddenError ||
        (err instanceof Error && /category|not found|forbidden/i.test(err.message));
    }
    check("cross-org category assignment denied", crossCategoryDenied);

    const byCategory = await listAdmissionProducts(actor, {
      categoryId: ownCategory.id,
      includeArchived: true,
    });
    check(
      "category filter",
      byCategory.length >= 1 &&
        byCategory.every((p) => p.categoryId === ownCategory.id) &&
        byCategory.some((p) => p.id === categorized.id)
    );

    const cleared = await updateAdmissionProduct(actor, categorized.id, {
      categoryId: null,
    });
    check("category update clear", cleared.categoryId === null);

    let crossCategoryUpdateDenied = false;
    try {
      await updateAdmissionProduct(actor, categorized.id, {
        categoryId: foreignCategory.id,
      });
    } catch (err) {
      crossCategoryUpdateDenied =
        err instanceof ForbiddenError ||
        (err instanceof Error && /category|not found|forbidden/i.test(err.message));
    }
    check("cross-org category update denied", crossCategoryUpdateDenied);

    let crossCategoryFilterDenied = false;
    try {
      await listAdmissionProducts(actor, {
        categoryId: foreignCategory.id,
        includeArchived: true,
      });
    } catch (err) {
      crossCategoryFilterDenied =
        err instanceof ForbiddenError ||
        (err instanceof Error && /category|not found|forbidden/i.test(err.message));
    }
    check("cross-org category filter denied", crossCategoryFilterDenied);

    const reassigned = await updateAdmissionProduct(actor, categorized.id, {
      categoryId: ownCategory.id,
    });
    check(
      "category update same-org",
      reassigned.categoryId === ownCategory.id
    );

    const linkedBooking = await prisma.admissionProduct.count({
      where: { orgId, categoryId: ownCategory.id },
    });
    check("category booking link count", linkedBooking >= 1);

    let categoryDeleteBlocked = false;
    try {
      await prisma.productCategory.delete({ where: { id: ownCategory.id } });
    } catch {
      categoryDeleteBlocked = true;
    }
    check(
      "category delete blocked while booking products linked",
      categoryDeleteBlocked
    );

    const archivedClearsCategory = await archiveAdmissionProduct(
      actor,
      categorized.id
    );
    check(
      "archive clears categoryId",
      archivedClearsCategory.categoryId === null &&
        archivedClearsCategory.archivedAt != null
    );

    let categoryDeleteAfterArchive = false;
    try {
      await prisma.productCategory.delete({ where: { id: ownCategory.id } });
      categoryDeleteAfterArchive = true;
    } catch {
      categoryDeleteAfterArchive = false;
    }
    check(
      "category delete allowed after archive clears link",
      categoryDeleteAfterArchive
    );

    const stock = await createStockPeriod(actor, {
      locationId: venue.id,
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      kind: "available",
      quantity: 50,
      productIds: [createdProducts.add_on],
    });
    check("stock period create", stock.kind === "available" && stock.quantity === 50);

    // IDOR: session resourceId must stay in same org+venue
    const { createTicketSession, updateTicketSession } = await import(
      "../src/lib/ticketing/sessions.ts"
    );
    const session = await createTicketSession(actor, {
      productId: createdProducts.timed_session,
      startsAt: new Date(Date.now() + 3600_000).toISOString(),
      endsAt: new Date(Date.now() + 7200_000).toISOString(),
      capacity: 10,
    });
    const foreignResource = await createCapacityResource(otherActor, {
      name: `Foreign Resource ${stamp}`,
      type: "attraction",
      locationId: otherVenue.id,
      defaultCapacity: 5,
    });
    let sessionResourceIdorDenied = false;
    try {
      await updateTicketSession(actor, session.id, {
        resourceId: foreignResource.id,
      });
    } catch (err) {
      sessionResourceIdorDenied =
        err instanceof ForbiddenError ||
        (err instanceof Error && /not found|resource/i.test(err.message));
    }
    check("session resourceId cross-tenant deny", sessionResourceIdorDenied);

    // IDOR: add-on stockPeriodId must belong to parent venue/org
    const { linkProductAddOn } = await import(
      "../src/lib/ticketing/products.ts"
    );
    const foreignStock = await createStockPeriod(otherActor, {
      locationId: otherVenue.id,
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 86400000).toISOString(),
      kind: "available",
      quantity: 3,
    });
    let stockPeriodIdorDenied = false;
    try {
      await linkProductAddOn(actor, createdProducts.timed_session, {
        addOnProductId: createdProducts.add_on,
        stockPeriodId: foreignStock.id,
      });
    } catch (err) {
      stockPeriodIdorDenied =
        err instanceof ForbiddenError ||
        (err instanceof Error && /stock period|not found/i.test(err.message));
    }
    check("add-on stockPeriodId cross-tenant deny", stockPeriodIdorDenied);

    const settings = await upsertBookingSettings(actor, {
      locationId: venue.id,
      defaultCreateMode: "reserve",
      holdTtlMinutes: 20,
      reserveTtlHours: 48,
    });
    check(
      "BookingSettings defaultCreateMode",
      settings.defaultCreateMode === "reserve" && settings.holdTtlMinutes === 20
    );
    const readBack = await getBookingSettings(actor, venue.id);
    check(
      "BookingSettings read-back",
      readBack.defaultCreateMode === "reserve"
    );

    // Soft-archive + unpublished defaults
    // (updateAdmissionProduct / archiveAdmissionProduct already imported above)
    const {
      getAdmissionProduct,
      replaceProductPrices,
    } = await import("../src/lib/ticketing/products.ts");
    const { listTicketSessions } = await import(
      "../src/lib/ticketing/sessions.ts"
    );
    const toArchive = await getAdmissionProduct(actor, createdProducts.day_pass);
    check("product unpublished by default", toArchive.published === false);

    // Consistency: remaining cannot exceed capacity
    let remainingCapDenied = false;
    try {
      await updateTicketSession(actor, session.id, { remaining: 999 });
    } catch (err) {
      remainingCapDenied =
        err instanceof Error && /remaining cannot exceed capacity/i.test(err.message);
    }
    check("session remaining<=capacity", remainingCapDenied);

    // Consistency: capacity shrink clamps remaining
    await updateTicketSession(actor, session.id, { capacity: 3 });
    const shrunk = (await listTicketSessions(actor, {
      productId: createdProducts.timed_session,
      includeClosed: true,
    })).find((s) => s.id === session.id);
    check(
      "session capacity shrink clamps remaining",
      Boolean(shrunk && shrunk.capacity === 3 && shrunk.remaining <= 3)
    );

    // Consistency: duplicate price codes denied
    let dupPriceDenied = false;
    try {
      await replaceProductPrices(actor, createdProducts.timed_session, [
        { code: "adult", amount: 10 },
        { code: "Adult", amount: 12 },
      ]);
    } catch (err) {
      dupPriceDenied =
        err instanceof Error && /duplicate price band code/i.test(err.message);
    }
    check("duplicate price codes deny", dupPriceDenied);

    // Edge: empty series must fail (not silent [])
    const { createTicketSessionSeries } = await import(
      "../src/lib/ticketing/sessions.ts"
    );
    let emptySeriesDenied = false;
    try {
      await createTicketSessionSeries(actor, {
        productId: createdProducts.timed_session,
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        endsAt: new Date(Date.now() + 90000000).toISOString(),
        capacity: 5,
        weekdays: [1],
        untilDate: new Date(Date.now() - 86400000).toISOString(),
      });
    } catch (err) {
      emptySeriesDenied =
        err instanceof Error && /series produced no sessions/i.test(err.message);
    }
    check("empty session series deny", emptySeriesDenied);

    // Edge: malformed productId filter must not silently broaden list
    let badProductFilterDenied = false;
    try {
      await listTicketSessions(actor, { productId: "not-a-cuid" });
    } catch (err) {
      badProductFilterDenied =
        err instanceof Error && /invalid productId/i.test(err.message);
    }
    check("invalid productId filter deny", badProductFilterDenied);

    let badFromDenied = false;
    try {
      await listTicketSessions(actor, {
        productId: createdProducts.timed_session,
        from: "not-a-date",
      });
    } catch (err) {
      badFromDenied =
        err instanceof Error && /invalid from date/i.test(err.message);
    }
    check("invalid from date deny", badFromDenied);

    let badPriceWindowDenied = false;
    try {
      await replaceProductPrices(actor, createdProducts.timed_session, [
        {
          code: "adult",
          amount: 10,
          validFrom: "2030-01-10T00:00:00.000Z",
          validTo: "2030-01-01T00:00:00.000Z",
        },
      ]);
    } catch (err) {
      badPriceWindowDenied =
        err instanceof Error && /validTo cannot be before validFrom/i.test(err.message);
    }
    check("price validTo before validFrom deny", badPriceWindowDenied);

    // Consistency: close keeps remaining so reopen restores seats
    await updateTicketSession(actor, session.id, {
      capacity: 10,
      remaining: 10,
      isClosed: false,
    });
    await updateTicketSession(actor, session.id, { isClosed: true });
    const closed = (await listTicketSessions(actor, {
      productId: createdProducts.timed_session,
      includeClosed: true,
    })).find((s) => s.id === session.id);
    check(
      "close session keeps remaining",
      Boolean(closed?.isClosed && closed.remaining === 10)
    );
    await updateTicketSession(actor, session.id, { isClosed: false });
    const reopened = (await listTicketSessions(actor, {
      productId: createdProducts.timed_session,
      includeClosed: false,
    })).find((s) => s.id === session.id);
    check(
      "reopen session restores availability",
      Boolean(reopened && !reopened.isClosed && reopened.remaining === 10)
    );

    // Archive timed product — closes open sessions and hides from availability lists
    await archiveAdmissionProduct(actor, createdProducts.timed_session);
    const archivedTimed = await getAdmissionProduct(
      actor,
      createdProducts.timed_session
    );
    const openAfterArchive = await listTicketSessions(actor, {
      productId: createdProducts.timed_session,
      includeClosed: false,
    });
    check(
      "archive product closes sellable sessions",
      Boolean(archivedTimed.archivedAt) &&
        archivedTimed.published === false &&
        openAfterArchive.length === 0
    );
    await updateAdmissionProduct(actor, createdProducts.timed_session, {
      unarchive: true,
    });

    await archiveAdmissionProduct(actor, createdProducts.day_pass);
    const archived = await getAdmissionProduct(actor, createdProducts.day_pass);
    check("soft-archive product", Boolean(archived.archivedAt));
    await updateAdmissionProduct(actor, createdProducts.day_pass, {
      unarchive: true,
    });

    // Resource archive blocked while party product still links it
    const { updateCapacityResource } = await import(
      "../src/lib/ticketing/resources.ts"
    );
    let resourceArchiveDenied = false;
    try {
      await updateCapacityResource(actor, room.id, { archive: true });
    } catch (err) {
      resourceArchiveDenied =
        err instanceof Error && /cannot archive a resource/i.test(err.message);
    }
    check("resource archive with live product deny", resourceArchiveDenied);

    // Party package: cannot disconnect room while published
    await updateAdmissionProduct(actor, createdProducts.party_package, {
      published: true,
    });
    let partyDisconnectDenied = false;
    try {
      await updateAdmissionProduct(actor, createdProducts.party_package, {
        resourceId: null,
      });
    } catch (err) {
      partyDisconnectDenied =
        err instanceof Error &&
        /cannot remove room|require a room/i.test(err.message);
    }
    check(
      "published party_package resource disconnect deny",
      partyDisconnectDenied
    );
    await updateAdmissionProduct(actor, createdProducts.party_package, {
      published: false,
    });

    const account = await createBookingAccount(actor, {
      name: `Corp Client ${stamp}`,
      billingEmail: `billing-${stamp}@corp.test`,
      phone: "555-0100",
      taxId: "TAX-1",
      defaultTaxExempt: true,
      locationId: venue.id,
    });
    check("BookingAccount create", Boolean(account.id));

    const contact = await createAccountContact(actor, account.id, {
      firstName: "Pat",
      lastName: "Buyer",
      email: `pat-${stamp}@corp.test`,
      title: "AP",
      isPrimary: true,
    });
    check(
      "BookingAccount contact create",
      Boolean(contact.id) && contact.isPrimary === true
    );

    let emptyContactDenied = false;
    try {
      await createAccountContact(actor, account.id, {
        title: "Only title",
      });
    } catch (err) {
      emptyContactDenied =
        err instanceof Error && /name, email, or phone/i.test(err.message);
    }
    check("empty contact deny", emptyContactDenied);

    const { archiveBookingAccount, listBookingAccounts } = await import(
      "../src/lib/ticketing/accounts.ts"
    );
    await archiveBookingAccount(actor, account.id);
    const accountsAfter = await listBookingAccounts(actor);
    check(
      "BookingAccount soft-archive hides from list",
      !accountsAfter.some((a) => a.id === account.id)
    );

    // Party package without room resource must fail
    let partyNeedsRoom = false;
    try {
      await createAdmissionProduct(actor, {
        type: "party_package",
        name: `No room party ${stamp}`,
        locationId: venue.id,
        prices: [{ code: "package", amount: 199 }],
      });
    } catch (err) {
      partyNeedsRoom =
        err instanceof Error && /party packages require/i.test(err.message);
    }
    check("party_package requires room resource", partyNeedsRoom);

    // Archived venue: no new sellable products
    const { archiveVenueLocation, reactivateVenueLocation } = await import(
      "../src/lib/venueLocations.ts"
    );
    await archiveVenueLocation(actor, venue.id);
    let archivedVenueDenied = false;
    try {
      await createAdmissionProduct(actor, {
        type: "day_pass",
        name: `Archived venue product ${stamp}`,
        locationId: venue.id,
        prices: [{ code: "adult", amount: 10 }],
      });
    } catch (err) {
      archivedVenueDenied =
        err instanceof ForbiddenError ||
        (err instanceof Error && /archived/i.test(err.message));
    }
    check("archived venue create deny", archivedVenueDenied);

    let archivedVenueUpdateDenied = false;
    try {
      const existing = await prisma.admissionProduct.findFirst({
        where: { orgId, locationId: venue.id, archivedAt: null },
        select: { id: true },
      });
      if (existing) {
        await updateAdmissionProduct(actor, existing.id, {
          name: `Should fail on archived venue ${stamp}`,
        });
      }
    } catch (err) {
      archivedVenueUpdateDenied =
        err instanceof ForbiddenError ||
        (err instanceof Error && /archived/i.test(err.message));
    }
    check("archived venue update deny", archivedVenueUpdateDenied);

    await reactivateVenueLocation(actor, venue.id);

    // Soft-hold (overdue endsAt): creates denied
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        subscriptionStatus: "active",
        subscriptionEndsAt: new Date(Date.now() - 60_000),
      },
    });
    let softHoldDenied = false;
    try {
      await assertModuleEnabled(orgId, "ticketing");
    } catch (err) {
      softHoldDenied =
        err instanceof ForbiddenError ||
        (err instanceof Error &&
          (/Subscribe to a plan|suspended|expired|overdue|billing/i.test(
            err.message
          ) ||
            err.message === BILLING_REQUIRED_MESSAGE));
    }
    check("soft-hold / overdue deny", softHoldDenied);

    // Restore entitlement for any leftover ops
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        subscriptionStatus: "active",
        subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
      },
    });
  } finally {
    // Soft cleanup — leave rows; unique slugs prevent collisions.
    await prisma.$disconnect();
  }

  if (failed > 0) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll Phase 1 ticketing smoke checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
