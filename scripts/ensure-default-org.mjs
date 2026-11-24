/**
 * Step 5.1 — idempotent Organization bootstrap + orgId backfill.
 *
 * Ensures exactly one default org (Harewa), backfills Product / Fabric /
 * ProductCategory / TaxSettings / AiSettings / Order, and prints
 * DEFAULT_ORG_ID for .env.local.
 *
 * Usage:
 *   yarn ensure-default-org
 *
 * Shop is left unused. Cart / Wishlist are not backfilled (user-scoped).
 */
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import {
  loadDatabaseUrl,
  envPath,
  readEnvFile,
  envValue,
} from "./prisma-env.mjs";

loadDatabaseUrl();
const prisma = new PrismaClient();

const DEFAULT_NAME = "Harewa";
const DEFAULT_SLUG = "harewa";

async function ensureDefaultOrg() {
  let org = await prisma.organization.findFirst({ where: { isDefault: true } });
  if (!org) org = await prisma.organization.findUnique({ where: { slug: DEFAULT_SLUG } });
  if (!org) {
    // Never promote a registered company to isDefault just because it is alone.
    const only = await prisma.organization.findMany({ take: 2 });
    if (only.length === 1 && only[0].slug === DEFAULT_SLUG) {
      org = only[0];
    }
  }

  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: DEFAULT_NAME,
        slug: DEFAULT_SLUG,
        status: "active",
        isDefault: true,
      },
    });
    console.log("CREATED default Organization:", DEFAULT_NAME);
    return org;
  }

  await prisma.organization.updateMany({
    where: { id: { not: org.id }, isDefault: true },
    data: { isDefault: false },
  });
  org = await prisma.organization.update({
    where: { id: org.id },
    data: {
      isDefault: true,
      slug: org.slug || DEFAULT_SLUG,
      name: org.name || DEFAULT_NAME,
      status: org.status || "active",
    },
  });
  console.log("REUSED default Organization:", org.name || DEFAULT_NAME);
  return org;
}

const defaultOrg = await ensureDefaultOrg();
const orgId = defaultOrg.id;

const defaultCount = await prisma.organization.count({ where: { isDefault: true } });
if (defaultCount !== 1) {
  console.error("Expected exactly one isDefault org, found", defaultCount);
  await prisma.$disconnect();
  process.exit(1);
}

async function backfill(model, label) {
  // Postgres schema requires orgId — nothing to backfill from null.
  // Kept for script compatibility with older Mongo bootstrap docs.
  console.log(`Backfill ${label}: skipped (orgId is required in Postgres)`);
}

await backfill(prisma.product, "products");
await backfill(prisma.fabric, "fabrics");
await backfill(prisma.productCategory, "productcategories");
await backfill(prisma.taxSettings, "taxsettings");
await backfill(prisma.aiSettings, "aisettings");
await backfill(prisma.order, "orders");

async function keepOnePerOrg(model, label) {
  const rows = await model.findMany({
    where: { orgId },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
  });
  if (rows.length <= 1) return;
  const [, ...extras] = rows;
  const deleted = await model.deleteMany({
    where: { id: { in: extras.map((r) => r.id) } },
  });
  console.log(
    `Deduped ${label} for default org: kept ${rows[0].id}, removed ${deleted.count}`
  );
}

await keepOnePerOrg(prisma.taxSettings, "tax_settings");
await keepOnePerOrg(prisma.aiSettings, "ai_settings");

async function ensureAiSettingsShape() {
  let doc = await prisma.aiSettings.findFirst({
    where: { orgId },
    orderBy: { updatedAt: "desc" },
  });
  if (!doc) {
    await prisma.aiSettings.create({
      data: {
        orgId,
        botName: "StyleForge AI",
        usePublicData: false,
        provider: "openrouter",
        model: "google/gemini-2.5-flash",
        apiKeyLast4: "",
        baseUrl: "",
        maxTokens: 512,
      },
    });
    console.log("CREATED default AiSettings for org");
    return;
  }

  const patch = {};
  if (doc.provider == null) patch.provider = "openrouter";
  if (doc.model == null || doc.model === "") patch.model = "google/gemini-2.5-flash";
  if (doc.baseUrl == null) patch.baseUrl = "";
  if (doc.apiKeyLast4 == null) patch.apiKeyLast4 = "";
  if (doc.usePublicData == null) patch.usePublicData = false;
  if (!doc.botName) patch.botName = "StyleForge AI";
  if (doc.maxTokens == null) patch.maxTokens = 512;

  const effectiveProvider = patch.provider ?? doc.provider ?? "openrouter";
  if (
    effectiveProvider === "env_default" &&
    (doc.apiKeyLast4 || doc.model || doc.baseUrl || (doc.maxTokens != null && doc.maxTokens !== 512))
  ) {
    patch.model = "";
    patch.baseUrl = "";
    patch.maxTokens = null;
    patch.apiKeyLast4 = "";
  }

  if (Object.keys(patch).length > 0) {
    await prisma.aiSettings.update({
      where: { id: doc.id },
      data: patch,
    });
    console.log(`Backfill aisettings fields: ${Object.keys(patch).join(", ")}`);
  }
}

await ensureAiSettingsShape();

const envFile = readEnvFile();
if (!envValue(envFile, "DEFAULT_ORG_ID")) {
  fs.appendFileSync(
    envPath,
    `\n# Step 5.1 — current storefront Organization (tenant). Server-only.\nDEFAULT_ORG_ID=${orgId}\n`
  );
  console.log("Appended DEFAULT_ORG_ID to .env.local");
} else {
  console.log("DEFAULT_ORG_ID already set in .env.local (not overwritten)");
}

console.log("Default org id:", orgId);
console.log(
  "Storefront catalog filters by DEFAULT_ORG_ID if set, else this default org."
);
console.log("Done.");

await prisma.$disconnect();
