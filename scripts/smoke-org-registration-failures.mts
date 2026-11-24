/**
 * Edge / failure cases for createOrganizationWithPlatformAdmin.
 * Usage: npx tsx scripts/smoke-org-registration-failures.mts
 */
import { loadDatabaseUrl } from "./prisma-env.mjs";
loadDatabaseUrl();

const {
  createOrganizationWithPlatformAdmin,
  orgRegistrationCreateData,
  ORG_SLUG_TAKEN_MESSAGE,
  ORG_NAME_REQUIRED_MESSAGE,
  ORG_USER_REQUIRED_MESSAGE,
  ORG_CANNOT_CLAIM_DEFAULT_SLUG,
  ORG_INVITED_BY_INVALID_MESSAGE,
  ORG_USER_ALREADY_HAS_MEMBERSHIP_MESSAGE,
} = await import("../src/lib/orgRegistration.ts");
const { ORG_SLUG_INVALID_MESSAGE, getDefaultOrgId } = await import(
  "../src/lib/org.ts"
);
const { isRefreshSessionRevoked } = await import("../src/lib/memberAdmin.ts");
const { default: prisma } = await import("../src/lib/prisma.ts");
const { BLACKLISTED_ACCOUNT_MESSAGE } = await import(
  "../src/lib/userBlacklist.ts"
);

const stamp = Date.now();
let failed = 0;
const cleanups = [];

function check(label, ok, detail = "") {
  console.log(ok ? "PASS" : "FAIL", label, detail ? `:: ${detail}` : "");
  if (!ok) failed += 1;
}

async function expectReject(label, fn, expected) {
  try {
    await fn();
    check(label, false, "did not throw");
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    check(label, m === expected || m.includes(expected), m.slice(0, 160));
  }
}

await expectReject(
  "empty name",
  () =>
    createOrganizationWithPlatformAdmin({
      name: "  ",
      slug: `n-${stamp}`,
      userId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
    }),
  ORG_NAME_REQUIRED_MESSAGE
);

await expectReject(
  "punctuation-only slug",
  () =>
    createOrganizationWithPlatformAdmin({
      name: "Acme",
      slug: "!!!",
      userId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
    }),
  ORG_SLUG_INVALID_MESSAGE
);

await expectReject(
  "cannot claim harewa",
  () =>
    createOrganizationWithPlatformAdmin({
      name: "Acme",
      slug: "HaReWa",
      userId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
    }),
  ORG_CANNOT_CLAIM_DEFAULT_SLUG
);

await expectReject(
  "invalid userId shape",
  () =>
    createOrganizationWithPlatformAdmin({
      name: "Acme",
      slug: `bad-uid-${stamp}`,
      userId: "not-an-id",
    }),
  "Invalid userId"
);

await expectReject(
  "missing user record",
  () =>
    createOrganizationWithPlatformAdmin({
      name: "Acme",
      slug: `miss-uid-${stamp}`,
      userId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
    }),
  ORG_USER_REQUIRED_MESSAGE
);

// orgRegistrationCreateData must not emit empty/harewa slug
try {
  orgRegistrationCreateData({ name: "Ok", slug: "@@@" });
  check("createData rejects empty slug", false, "no throw");
} catch (e) {
  const m = e instanceof Error ? e.message : String(e);
  check(
    "createData rejects empty slug",
    m === ORG_SLUG_INVALID_MESSAGE,
    m
  );
}
try {
  orgRegistrationCreateData({ name: "Ok", slug: "harewa" });
  check("createData rejects harewa", false, "no throw");
} catch (e) {
  const m = e instanceof Error ? e.message : String(e);
  check(
    "createData rejects harewa",
    m === ORG_CANNOT_CLAIM_DEFAULT_SLUG,
    m
  );
}

const user = await prisma.user.create({
  data: {
    email: `rbac-fail-${stamp}@test.local`,
    password: "x",
    role: "client",
    isVerified: true,
    username: `rfail${stamp}`,
  },
});
cleanups.push(async () => {
  await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
});

// Deleted soft-account
await prisma.user.update({
  where: { id: user.id },
  data: { accountDeleted: true },
});
await expectReject(
  "accountDeleted user",
  () =>
    createOrganizationWithPlatformAdmin({
      name: "Gone Co",
      slug: `gone-${stamp}`,
      userId: user.id,
    }),
  ORG_USER_REQUIRED_MESSAGE
);
await prisma.user.update({
  where: { id: user.id },
  data: { accountDeleted: false },
});

// Blacklisted email (storefront org)
const storefrontOrgId = await getDefaultOrgId();
const bl = await prisma.userBlacklist.create({
  data: {
    orgId: storefrontOrgId,
    type: "email",
    value: user.email.toLowerCase(),
    source: "manual",
  },
});
await expectReject(
  "blacklisted email",
  () =>
    createOrganizationWithPlatformAdmin({
      name: "Blocked Co",
      slug: `blocked-${stamp}`,
      userId: user.id,
    }),
  BLACKLISTED_ACCOUNT_MESSAGE
);
await prisma.userBlacklist.deleteMany({ where: { id: bl.id } });

await expectReject(
  "bogus invitedById",
  () =>
    createOrganizationWithPlatformAdmin({
      name: `Inv By ${stamp}`,
      slug: `inv-by-${stamp}`,
      userId: user.id,
      invitedById: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
    }),
  ORG_INVITED_BY_INVALID_MESSAGE
);

// Happy path + duplicate slug + session revoke
const { organization, membership } =
  await createOrganizationWithPlatformAdmin({
    name: `Fail Co ${stamp}`,
    slug: `fail-co-${stamp}`,
    userId: user.id,
  });
cleanups.push(async () => {
  await prisma.activityLog.deleteMany({ where: { orgId: organization.id } });
  await prisma.membership.deleteMany({ where: { orgId: organization.id } });
  await prisma.organization.delete({ where: { id: organization.id } });
});

const refreshed = await prisma.user.findUniqueOrThrow({
  where: { id: user.id },
  select: { role: true, refreshTokenJTI: true },
});
check("success role admin", refreshed.role === "admin");
check(
  "success refresh revoked",
  isRefreshSessionRevoked(refreshed.refreshTokenJTI)
);

// Same user already has a membership — dual seat refused before slug check.
await expectReject(
  "second org same user refused",
  () =>
    createOrganizationWithPlatformAdmin({
      name: "Dup",
      slug: `fail-co-2-${stamp}`,
      userId: user.id,
    }),
  ORG_USER_ALREADY_HAS_MEMBERSHIP_MESSAGE
);

// Duplicate slug needs a clean user (no membership) so the slug gate fires.
const user2 = await prisma.user.create({
  data: {
    email: `rbac-fail2-${stamp}@test.local`,
    password: "x",
    role: "client",
    isVerified: true,
    username: `rfail2${stamp}`,
  },
});
cleanups.push(async () => {
  await prisma.user.delete({ where: { id: user2.id } }).catch(() => {});
});
await expectReject(
  "duplicate slug",
  () =>
    createOrganizationWithPlatformAdmin({
      name: "Dup",
      slug: `fail-co-${stamp}`,
      userId: user2.id,
    }),
  ORG_SLUG_TAKEN_MESSAGE
);

// preferOrgId for deleted/missing org falls through (no throw)
const { resolvePrimaryMembership } = await import("../src/lib/membership.ts");
const primary = await resolvePrimaryMembership(user.id, {
  preferOrgId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
});
check(
  "preferOrgId missing org falls through",
  primary != null && primary.userId === user.id
);

// Concurrent same-user registration must not create dual seats.
const raceUser = await prisma.user.create({
  data: {
    email: `rbac-race-${stamp}@test.local`,
    password: "x",
    role: "client",
    isVerified: true,
    username: `rrace${stamp}`,
  },
});
cleanups.push(async () => {
  const orgs = await prisma.organization.findMany({
    where: { slug: { in: [`race-a-${stamp}`, `race-b-${stamp}`] } },
    select: { id: true },
  });
  const orgIds = orgs.map((o) => o.id);
  if (orgIds.length) {
    await prisma.activityLog.deleteMany({ where: { orgId: { in: orgIds } } });
    await prisma.membership.deleteMany({ where: { orgId: { in: orgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  }
  await prisma.user.delete({ where: { id: raceUser.id } }).catch(() => {});
});
const raceResults = await Promise.allSettled([
  createOrganizationWithPlatformAdmin({
    name: `Race A ${stamp}`,
    slug: `race-a-${stamp}`,
    userId: raceUser.id,
  }),
  createOrganizationWithPlatformAdmin({
    name: `Race B ${stamp}`,
    slug: `race-b-${stamp}`,
    userId: raceUser.id,
  }),
]);
const raceOk = raceResults.filter((r) => r.status === "fulfilled");
const raceDenied = raceResults.filter(
  (r) =>
    r.status === "rejected" &&
    r.reason instanceof Error &&
    r.reason.message === ORG_USER_ALREADY_HAS_MEMBERSHIP_MESSAGE
);
const raceMemberships = await prisma.membership.count({
  where: { userId: raceUser.id },
});
check(
  "concurrent same-user one seat",
  raceOk.length === 1 && raceDenied.length === 1 && raceMemberships === 1,
  `ok=${raceOk.length} denied=${raceDenied.length} memberships=${raceMemberships}`
);
for (const r of raceOk) {
  if (r.status === "fulfilled") {
    cleanups.push(async () => {
      await prisma.activityLog.deleteMany({
        where: { orgId: r.value.organization.id },
      });
      await prisma.membership.deleteMany({
        where: { orgId: r.value.organization.id },
      });
      await prisma.organization
        .delete({ where: { id: r.value.organization.id } })
        .catch(() => {});
    });
  }
}

for (const fn of cleanups.reverse()) {
  await fn();
}
await prisma.$disconnect();

if (failed) process.exit(1);
console.log("PASS org-registration failures");
