/**
 * Dev cleanup: hard-delete non-default (registered) company workspaces.
 * Never touches isDefault=true storefront org.
 *
 * Usage:
 *   node scripts/purge-registered-companies.mjs
 *   node scripts/purge-registered-companies.mjs --keep=city-prints-and-publishing
 * Optional: --dry-run  (repeat --keep=slug as needed)
 */
import { loadDatabaseUrl } from "./prisma-env.mjs";
import { PrismaClient } from "@prisma/client";

loadDatabaseUrl();
// Prefer direct (non-pooler) URL for destructive cleanup — pooler can time out.
if (process.env.DIRECT_URL) {
  process.env.DATABASE_URL = process.env.DIRECT_URL;
}
const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");
const keepSlugs = new Set(
  process.argv
    .filter((a) => a.startsWith("--keep="))
    .map((a) => a.slice("--keep=".length).trim().toLowerCase())
    .filter(Boolean)
);

/**
 * Leaf-first org-scoped deletes. No catch-and-continue inside a Postgres
 * transaction (a failed statement aborts the whole txn).
 */
async function deleteOrgScopedRows(db, orgIds) {
  const ids = Array.isArray(orgIds) ? orgIds : [orgIds];
  const whereOrg = { where: { orgId: { in: ids } } };
  // Actual Prisma client delegates — leaf-first / FK-safe order.
  const steps = [
    "membershipVenueAssignment",
    "membershipVenueEligibility",
    "membershipAgreement",
    "membershipUsageEvent",
    "membershipPaymentAttempt",
    "membershipFamilyLink",
    "membershipCancelAlternative",
    "guestMembership",
    "membershipPlan",
    "membershipSettings",
    "guestProfile",
    "marketplaceRefund",
    "marketplacePaymentEvent",
    "marketplaceBooking",
    "bookingPaymentLink",
    "bookingPayment",
    "bookingInvoice",
    "ticketCredential",
    "bookingHold",
    "bookingGuest",
    "bookingLine",
    "bookingActivity",
    "partyRunSheetItem",
    "partyInvitation",
    "partyGuest",
    "partyBookingDetail",
    "booking",
    "giftCard",
    "storedPaymentMethod",
    "bookingAccountContact",
    "bookingAccount",
    "ticketSession",
    "stockPeriodProduct",
    "stockPeriod",
    "admissionAddOnLink",
    "admissionProductPrice",
    "admissionProduct",
    "capacityResource",
    "bookingPackage",
    "bookingSettings",
    "shipment",
    "order",
    "cartLine",
    "cart",
    "wishlistItem",
    "wishlist",
    "reviewLike",
    "review",
    "customRequest",
    "customization",
    "product",
    "productCategory",
    "fabric",
    "shop",
    "tailoringJob",
    "campaignParticipant",
    "measurementCampaign",
    "tailorClient",
    "tailorReview",
    "tailorProfile",
    "fashionChatMessage",
    "fashionChat",
    "homepageSection",
    "adBanner",
    "adBannerSeedLock",
    "companyProfile",
    "taxSettings",
    "aiSettings",
    "shippingSettings",
    "roleTemplate",
    "userBlacklist",
    "activityLog",
    "organizationMarketplaceAccount",
    "membership",
    "venueLocation",
  ];

  for (const model of steps) {
    const delegate = db[model];
    if (!delegate || typeof delegate.deleteMany !== "function") continue;
    try {
      await delegate.deleteMany(whereOrg);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes("does not exist") ||
        msg.includes("Unknown arg") ||
        msg.includes("Cannot read") ||
        msg.includes("Unknown model") ||
        msg.includes("is not found")
      ) {
        continue;
      }
      if (msg.includes("Foreign key constraint")) {
        console.warn(`  skip/fk ${model}:`, msg.split("\n")[0]);
        continue;
      }
      throw err;
    }
  }

  await db.organization.deleteMany({ where: { id: { in: ids }, isDefault: false } });
}

async function main() {
  const allRegistered = await prisma.organization.findMany({
    where: { isDefault: false },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      subscriptionPlan: true,
      memberships: {
        select: {
          userId: true,
          user: { select: { id: true, email: true, accountDeleted: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const kept = [];
  const orgs = [];
  for (const o of allRegistered) {
    if (keepSlugs.has(String(o.slug || "").toLowerCase())) {
      kept.push(o);
    } else {
      orgs.push(o);
    }
  }

  if (keepSlugs.size > 0) {
    console.log(`Keep slugs: ${[...keepSlugs].join(", ")}`);
    for (const o of kept) {
      console.log(
        ` KEEP ${o.name} (${o.slug}) [${o.status}/${o.subscriptionPlan || "none"}]`
      );
    }
    const missing = [...keepSlugs].filter(
      (s) => !kept.some((o) => String(o.slug || "").toLowerCase() === s)
    );
    if (missing.length) {
      console.warn(` WARNING — keep slug(s) not found: ${missing.join(", ")}`);
    }
  }

  console.log(
    dryRun
      ? `DRY RUN — would purge ${orgs.length} registered compan(ies):`
      : `Purging ${orgs.length} registered compan(ies):`
  );
  for (const o of orgs) {
    console.log(
      ` - ${o.name} (${o.slug}) [${o.status}/${o.subscriptionPlan || "none"}]`
    );
  }

  if (dryRun || orgs.length === 0) {
    const remaining = await prisma.organization.count({
      where: { isDefault: false },
    });
    console.log(`Registered companies currently: ${remaining}.`);
    await prisma.$disconnect();
    return;
  }

  const orphanUserIds = new Set();
  let deleted = 0;
  let failed = 0;

  for (const org of orgs) {
    for (const m of org.memberships) {
      orphanUserIds.add(m.userId);
    }
  }
  // One deleteMany per table for a batch of orgs (remote DB: per-org loops take hours).
  const BATCH = 50;
  for (let i = 0; i < orgs.length; i += BATCH) {
    const batch = orgs.slice(i, i + BATCH);
    console.log(`Deleting ${i + 1}–${i + batch.length} of ${orgs.length}…`);
    try {
      // No interactive transaction: a mid-loop FK skip must not abort later steps.
      await deleteOrgScopedRows(
        prisma,
        batch.map((o) => o.id)
      );
      deleted += batch.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(` Batch failed (${msg.split("\n")[0]}) — retrying one by one`);
      for (const org of batch) {
        try {
          await deleteOrgScopedRows(prisma, org.id);
          deleted += 1;
        } catch (orgErr) {
          failed += 1;
          const orgMsg = orgErr instanceof Error ? orgErr.message : String(orgErr);
          console.error(` FAILED ${org.slug}:`, orgMsg.split("\n")[0]);
        }
      }
    }
  }

  // Remove company-admin users that no longer have any membership.
  let removedUsers = 0;
  const orphans = (
    await prisma.user.findMany({
      where: { id: { in: [...orphanUserIds] }, memberships: { none: {} } },
      select: { id: true },
    })
  ).map((u) => u.id);
  try {
    await prisma.profile.deleteMany({ where: { userId: { in: orphans } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: orphans } } });
    const removed = await prisma.user.deleteMany({ where: { id: { in: orphans } } });
    removedUsers = removed.count;
    orphanUserIds.clear();
    console.log(` Removed ${removedUsers} orphan admin user(s)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(` Batch user cleanup failed (${msg.split("\n")[0]}) — retrying one by one`);
  }
  for (const userId of orphanUserIds) {
    const left = await prisma.membership.count({ where: { userId } });
    if (left > 0) continue;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        memberships: { select: { id: true }, take: 1 },
      },
    });
    if (!user) continue;
    try {
      await prisma.profile.deleteMany({ where: { userId } });
      await prisma.wallet.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
      removedUsers += 1;
      console.log(` Removed orphan admin user ${user.email}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        ` Could not remove user ${user.email}: ${msg.split("\n")[0]}`
      );
    }
  }

  const remaining = await prisma.organization.findMany({
    where: { isDefault: false },
    select: { name: true, slug: true, status: true, subscriptionPlan: true },
    orderBy: { name: "asc" },
  });
  console.log(
    `Done. Deleted ${deleted}, failed ${failed}. Orphan admins removed: ${removedUsers}.`
  );
  console.log(`Registered companies left (${remaining.length}):`);
  for (const o of remaining) {
    console.log(
      ` - ${o.name} (${o.slug}) [${o.status}/${o.subscriptionPlan || "none"}]`
    );
  }
  await prisma.$disconnect();
  if (failed > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
