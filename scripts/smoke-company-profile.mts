/**
 * Company Profile smoke: pending upsert denied, active upsert encrypts bank,
 * API DTO redacts ciphertext, brand DTO safe, cross-tenant isolation.
 *
 *   yarn smoke:company-profile
 */
import { PrismaClient } from "@prisma/client";
import { loadDatabaseUrl, readEnvFile, envValue } from "./prisma-env.mjs";

loadDatabaseUrl();

// Bank encryption prefers COMPANY_PROFILE_ENCRYPTION_KEY; fall back to JWT_SECRET.
{
  const envFile = readEnvFile();
  if (!process.env.COMPANY_PROFILE_ENCRYPTION_KEY) {
    const key = envValue(envFile, "COMPANY_PROFILE_ENCRYPTION_KEY");
    if (key) process.env.COMPANY_PROFILE_ENCRYPTION_KEY = key;
  }
  if (!process.env.JWT_SECRET) {
    const jwt = envValue(envFile, "JWT_SECRET");
    if (jwt) process.env.JWT_SECRET = jwt;
  }
  if (
    !process.env.COMPANY_PROFILE_ENCRYPTION_KEY &&
    !process.env.JWT_SECRET
  ) {
    process.env.COMPANY_PROFILE_ENCRYPTION_KEY =
      "smoke-company-profile-encryption-key";
  }
}

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
  const {
    createOrganizationWithPlatformAdmin,
  } = await import("../src/lib/orgRegistration.ts");
  const {
    upsertCompanyProfile,
    getOrEmptyCompanyProfile,
    getCompanyBrandForDocuments,
    resolveBrandForOrg,
    isOwnedCompanyLogoPublicId,
    toPrintSafeCompanyProfile,
    CompanyProfileValidationError,
  } = await import("../src/lib/companyProfile.ts");
  const { ORG_PENDING_APPROVAL_MESSAGE } = await import("../src/lib/org.ts");
  const stamp = Date.now();

  const userA = await prisma.user.create({
    data: {
      email: `smoke-cp-a-${stamp}@test.local`,
      password: "x",
      username: `smokecpa${stamp}`,
      firstName: "A",
      lastName: "Admin",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const userB = await prisma.user.create({
    data: {
      email: `smoke-cp-b-${stamp}@test.local`,
      password: "x",
      username: `smokecpb${stamp}`,
      firstName: "B",
      lastName: "Admin",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });

  const regA = await createOrganizationWithPlatformAdmin({
    name: `Smoke CP A ${stamp}`,
    slug: `smoke-cp-a-${stamp}`,
    userId: userA.id,
    invalidateSessions: true,
  });
  const regB = await createOrganizationWithPlatformAdmin({
    name: `Smoke CP B ${stamp}`,
    slug: `smoke-cp-b-${stamp}`,
    userId: userB.id,
    invalidateSessions: true,
  });

  const actorA = { sub: userA.id, orgId: regA.organization.id };
  const actorB = { sub: userB.id, orgId: regB.organization.id };

  let pendingDenied = false;
  try {
    await upsertCompanyProfile(actorA, {
      legalName: "Should Fail Pending",
    });
  } catch (err) {
    pendingDenied =
      err instanceof Error &&
      (err.message.includes(ORG_PENDING_APPROVAL_MESSAGE) ||
        err.message.toLowerCase().includes("pending"));
  }
  check("pending-upsert-denied", pendingDenied);

  await prisma.organization.update({
    where: { id: regA.organization.id },
    data: { status: "active", approvedAt: new Date() },
  });
  await prisma.organization.update({
    where: { id: regB.organization.id },
    data: { status: "active", approvedAt: new Date() },
  });

  const bankPlain = "0123456789";
  const { profile: profileA } = await upsertCompanyProfile(actorA, {
    legalName: "Smoke Legal A",
    tradingName: "Smoke Trade A",
    supportEmail: `support-a-${stamp}@test.local`,
    addressLine1: "1 Test Street",
    city: "Lagos",
    country: "NG",
    bankName: "Test Bank",
    bankAccountName: "Smoke Legal A",
    bankAccountNumber: bankPlain,
    bankCurrency: "NGN",
  });

  check(
    "active-upsert-returns-last4",
    profileA.bankAccountLast4 === "6789" && profileA.hasBankAccount,
    `last4=${profileA.bankAccountLast4}`
  );
  check(
    "dto-has-no-ciphertext-field",
    !("bankAccountCiphertext" in profileA),
    ""
  );

  const rowA = await prisma.companyProfile.findUnique({
    where: { orgId: regA.organization.id },
  });
  check(
    "db-stores-ciphertext-not-plaintext",
    Boolean(rowA?.bankAccountCiphertext) &&
      !String(rowA?.bankAccountCiphertext).includes(bankPlain) &&
      rowA?.bankAccountLast4 === "6789",
    `cipherPrefix=${String(rowA?.bankAccountCiphertext ?? "").slice(0, 8)}`
  );

  const emptyB = await getOrEmptyCompanyProfile(regB.organization.id);
  check(
    "cross-tenant-read-empty",
    emptyB.legalName == null && emptyB.orgId === regB.organization.id,
    `legal=${emptyB.legalName}`
  );

  const { profile: profileB } = await upsertCompanyProfile(actorB, {
    legalName: "Smoke Legal B",
  });
  check(
    "cross-tenant-write-isolated",
    profileB.orgId === regB.organization.id &&
      profileB.legalName === "Smoke Legal B",
    profileB.orgId
  );

  const stillA = await prisma.companyProfile.findUnique({
    where: { orgId: regA.organization.id },
  });
  check(
    "org-a-unchanged-by-b",
    stillA?.legalName === "Smoke Legal A",
    String(stillA?.legalName)
  );

  const brand = await getCompanyBrandForDocuments(regA.organization.id);
  check(
    "brand-safe-fields",
    brand.legalName === "Smoke Legal A" &&
      brand.bankAccountLast4 === "6789" &&
      !("bankAccountCiphertext" in brand),
    brand.displayName
  );

  const { profile: logoOnly } = await upsertCompanyProfile(actorB, {
    legalName: null,
    logoUrl: "https://res.cloudinary.com/demo/image/upload/sample.jpg",
  });
  const logoBrand = await resolveBrandForOrg(regB.organization.id);
  check(
    "logo-only-keeps-tenant-brand",
    logoOnly.completeness === 20 &&
      logoBrand.isPlatformFallback === false &&
      Boolean(logoBrand.logoUrl?.includes("cloudinary")),
    `completeness=${logoOnly.completeness}`
  );

  const { profile: tradingOnly } = await upsertCompanyProfile(actorB, {
    logoUrl: null,
    logoPublicId: null,
    tradingName: "Trade Only B",
  });
  check(
    "trading-name-counts-completeness",
    tradingOnly.completeness === 20 &&
      tradingOnly.displayName === "Trade Only B",
    `completeness=${tradingOnly.completeness}`
  );

  const { profile: cleared } = await upsertCompanyProfile(actorA, {
    clearBank: true,
  });
  check(
    "clear-bank-removes-last4",
    cleared.hasBankAccount === false && cleared.bankAccountLast4 == null,
    `hasBank=${cleared.hasBankAccount}`
  );

  check(
    "completeness-after-clear-still-identity",
    cleared.completeness >= 40,
    `completeness=${cleared.completeness}`
  );

  let validationOk = false;
  try {
    await upsertCompanyProfile(actorA, {
      website: "javascript:alert(1)",
    });
  } catch (err) {
    validationOk =
      err instanceof CompanyProfileValidationError ||
      (err instanceof Error && err.name === "CompanyProfileValidationError");
  }
  check("rejects-bad-website", validationOk);

  // Empty profile after wipe → resolveBrand keeps Organization.name (not Harewa wipe).
  await prisma.companyProfile.deleteMany({
    where: { orgId: regB.organization.id },
  });
  const emptyBrand = await resolveBrandForOrg(regB.organization.id);
  check(
    "empty-profile-keeps-org-name",
    emptyBrand.displayName === regB.organization.name &&
      emptyBrand.isPlatformFallback === true,
    emptyBrand.displayName
  );

  const { wrote: backgroundClearWrote } = await upsertCompanyProfile(actorB, {
    signinBackgroundUrl: null,
    signinBackgroundPublicId: null,
  });
  const rowAfterBackgroundClear = await prisma.companyProfile.findUnique({
    where: { orgId: regB.organization.id },
  });
  check(
    "background-clear-only-does-not-create-row",
    backgroundClearWrote === false && rowAfterBackgroundClear == null,
    `wrote=${backgroundClearWrote}`
  );

  check(
    "logo-public-id-org-bound",
    isOwnedCompanyLogoPublicId(
      regA.organization.id,
      `company-profiles/${regA.organization.id}/logo_1`
    ) &&
      !isOwnedCompanyLogoPublicId(
        regA.organization.id,
        `company-profiles/${regB.organization.id}/logo_1`
      ) &&
      !isOwnedCompanyLogoPublicId(
        regA.organization.id,
        `company-profiles/${regA.organization.id}/../${regB.organization.id}/logo`
      ) &&
      !isOwnedCompanyLogoPublicId(
        regA.organization.id,
        `company-profiles/${regA.organization.id}/nested/logo`
      ),
    ""
  );

  let foreignLogoRejected = false;
  try {
    await upsertCompanyProfile(actorA, {
      logoUrl: "https://res.cloudinary.com/demo/image/upload/sample.jpg",
      logoPublicId: `company-profiles/${regB.organization.id}/logo_1`,
    });
  } catch (err) {
    foreignLogoRejected =
      err instanceof CompanyProfileValidationError ||
      (err instanceof Error &&
        err.message.toLowerCase().includes("logo public id"));
  }
  check("upsert-rejects-foreign-logo-public-id", foreignLogoRejected);

  let foreignBackgroundRejected = false;
  try {
    await upsertCompanyProfile(actorA, {
      signinBackgroundUrl: "https://res.cloudinary.com/demo/image/upload/sample.jpg",
      signinBackgroundPublicId: `company-profiles/${regB.organization.id}/signin-background`,
    });
  } catch (err) {
    foreignBackgroundRejected =
      err instanceof CompanyProfileValidationError ||
      (err instanceof Error && err.name === "CompanyProfileValidationError");
  }
  check("upsert-rejects-foreign-signin-background-public-id", foreignBackgroundRejected);

  let dataUrlBackgroundRejected = false;
  try {
    await upsertCompanyProfile(actorA, {
      signinBackgroundUrl: "data:image/png;base64,AAAA",
    });
  } catch (err) {
    dataUrlBackgroundRejected =
      err instanceof CompanyProfileValidationError ||
      (err instanceof Error && err.name === "CompanyProfileValidationError");
  }
  check("upsert-rejects-base64-signin-background", dataUrlBackgroundRejected);

  const { profile: withBackground } = await upsertCompanyProfile(actorA, {
    signinBackgroundUrl: "https://res.cloudinary.com/demo/image/upload/sample.jpg",
    signinBackgroundPublicId: `company-profiles/${regA.organization.id}/signin-background`,
  });
  check(
    "signin-background-persists-and-print-safe-strips-id",
    Boolean(withBackground.signinBackgroundUrl?.includes("cloudinary")) &&
      withBackground.signinBackgroundPublicId ===
        `company-profiles/${regA.organization.id}/signin-background` &&
      toPrintSafeCompanyProfile(withBackground).signinBackgroundPublicId == null,
    ""
  );
  const { profile: withoutBackground } = await upsertCompanyProfile(actorA, {
    signinBackgroundUrl: null,
    signinBackgroundPublicId: null,
  });
  check(
    "signin-background-clears",
    withoutBackground.signinBackgroundUrl == null &&
      withoutBackground.signinBackgroundPublicId == null,
    ""
  );
  const completenessBeforeRouting = cleared.completeness;
  const { profile: sensitive } = await upsertCompanyProfile(actorA, {
    bankRoutingOrIban: "123456789",
    billingEmail: `billing-a-${stamp}@test.local`,
  });
  const printA = toPrintSafeCompanyProfile(sensitive);
  check(
    "print-safe-strips-sensitive",
    sensitive.bankRoutingOrIban == null &&
      sensitive.hasBankRoutingOrIban === true &&
      sensitive.billingEmail === `billing-a-${stamp}@test.local` &&
      printA.bankRoutingOrIban == null &&
      printA.billingEmail == null &&
      printA.logoPublicId == null,
    ""
  );
  check(
    "routing-only-bumps-completeness",
    sensitive.hasBankAccount === false &&
      sensitive.hasBankRoutingOrIban === true &&
      sensitive.completeness === completenessBeforeRouting + 15,
    `before=${completenessBeforeRouting} after=${sensitive.completeness}`
  );

  // Write-only secrets: a non-bank field update must keep routing (never infer clearBank).
  const { profile: afterNonBankSave } = await upsertCompanyProfile(actorA, {
    supportEmail: `support-keep-bank-${stamp}@test.local`,
    bankName: null,
    bankAccountName: null,
    bankCurrency: null,
  });
  check(
    "non-bank-save-keeps-routing",
    afterNonBankSave.hasBankRoutingOrIban === true &&
      afterNonBankSave.completeness === sensitive.completeness,
    `hasRouting=${afterNonBankSave.hasBankRoutingOrIban} completeness=${afterNonBankSave.completeness}`
  );

  // Cleanup
  await prisma.companyProfile.deleteMany({
    where: { orgId: { in: [regA.organization.id, regB.organization.id] } },
  });
  await prisma.membership.deleteMany({
    where: { orgId: { in: [regA.organization.id, regB.organization.id] } },
  });
  await prisma.organization.deleteMany({
    where: { id: { in: [regA.organization.id, regB.organization.id] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [userA.id, userB.id] } },
  });

  if (failed > 0) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll company-profile smoke checks passed");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
