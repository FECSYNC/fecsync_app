/**
 * Ensure ShippingSettings for DEFAULT_ORG_ID (Phase 1 / STEP 6).
 * Usage: node scripts/seed-shipping-defaults.mjs
 */
import { PrismaClient } from "@prisma/client";
import { loadDatabaseUrl, readEnvFile, envValue } from "./prisma-env.mjs";

loadDatabaseUrl();
const envFile = readEnvFile();
const defaultOrgId = envValue(envFile, "DEFAULT_ORG_ID");
if (defaultOrgId) process.env.DEFAULT_ORG_ID = defaultOrgId;

const prisma = new PrismaClient();

const DEFAULT_ORIGIN = {
  line1: "Harewa Fulfillment, Ikeja",
  line2: "",
  city: "Lagos",
  state: "Lagos",
  lga: "Ikeja",
  zip: "100001",
  country: "NG",
  phone: "08000000000",
  contactName: "Harewa",
};

async function resolveOrgId() {
  if (defaultOrgId?.trim()) {
    const found = await prisma.organization.findUnique({
      where: { id: defaultOrgId.trim() },
      select: { id: true },
    });
    if (found) return found.id;
  }
  const storefront = await prisma.organization.findFirst({
    where: { isDefault: true },
    select: { id: true },
  });
  if (!storefront) throw new Error("No DEFAULT_ORG_ID / default organization");
  return storefront.id;
}

async function main() {
  const orgId = await resolveOrgId();
  const existing = await prisma.shippingSettings.findUnique({
    where: { orgId },
  });
  if (existing) {
    console.log(
      JSON.stringify(
        {
          created: false,
          orgId: existing.orgId,
          autoBookOnPaid: existing.autoBookOnPaid,
          primaryProvider: existing.primaryProvider,
        },
        null,
        2
      )
    );
    return;
  }
  const created = await prisma.shippingSettings.create({
    data: {
      orgId,
      originAddress: DEFAULT_ORIGIN,
      defaultWeightKg: 1,
      defaultDimensions: { length: 30, width: 25, height: 5 },
      autoBookOnPaid: true,
      primaryProvider: "shipbubble",
      enabledProviders: ["shipbubble"],
    },
  });
  console.log(
    JSON.stringify(
      {
        created: true,
        orgId: created.orgId,
        autoBookOnPaid: created.autoBookOnPaid,
        primaryProvider: created.primaryProvider,
        city: "Lagos",
        country: "NG",
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
