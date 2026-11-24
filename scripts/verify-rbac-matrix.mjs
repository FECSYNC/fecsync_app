/**
 * Step 7.2 — RBAC / isolation / tenancy verification matrix.
 *
 * Usage (dev server must be running):
 *   yarn verify-rbac
 *
 * Requires .env.local: DATABASE_URL, JWT_SECRET. Optional: BASE_URL, DEFAULT_ORG_ID.
 */
import dns from "node:dns";
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import {
  loadDatabaseUrl,
  readEnvFile,
  envValue,
} from "./prisma-env.mjs";

dns.setServers(["8.8.8.8", "1.1.1.1"]);

loadDatabaseUrl();
const prisma = new PrismaClient();

const envFile = readEnvFile();
const JWT_SECRET = envValue(envFile, "JWT_SECRET");
const DEFAULT_ORG_ID_ENV = envValue(envFile, "DEFAULT_ORG_ID");
const BASE_URL = process.env.BASE_URL || envValue(envFile, "BASE_URL") || "http://localhost:3000";

if (!JWT_SECRET) {
  console.error("JWT_SECRET required in .env.local");
  process.exit(1);
}

/** Mongo-style `_id` alias for fixtures used in API paths. */
function withId(row) {
  return row ? { ...row, _id: row.id } : row;
}

/** Mirror Step 1.1 catalog presets (keep in sync with permissions.ts). */
const CLIENT_PERMS = [
  "orders:read_own", "orders:create_own", "customizations:manage_own",
  "reviews:create_own", "profile:manage_own", "cart:manage_own",
  "wallet:read_own", "wallet:transact_own", "payments:checkout_own",
  "notifications:read_own",
  "measurements:read_own", "measurements:write_own",
  "tailoring_jobs:read_own", "tailoring_jobs:write_own",
];
const CATALOG_EDITOR_PERMS = [
  "products:read", "products:write", "products:delete",
  "fabrics:read", "fabrics:write", "fabrics:delete",
  "categories:read", "categories:write", "categories:delete",
  "uploads:write",
];
const OPS_MANAGER_PERMS = [
  "orders:read", "orders:manage", "customizations:read", "customizations:manage",
  "reviews:read", "reviews:moderate", "analytics:read",
  "deliveries:read", "deliveries:manage",
  "ai:chats_read", "ai:chats_reply", "ai:chats_delete",
  "tailors:read", "tailors:manage",
  "tailoring_jobs:read", "tailoring_jobs:manage",
];
const FINANCE_PERMS = [
  "tax:manage", "analytics:read", "payments:read", "wallet:read",
];
const PLATFORM_ADMIN_PERMS = [
  ...new Set([
    ...CLIENT_PERMS, ...CATALOG_EDITOR_PERMS, ...OPS_MANAGER_PERMS, ...FINANCE_PERMS,
    "users:read", "users:invite", "users:manage_roles",
    "users:delete", "users:blacklist", "users:reset_password",
    "ai:manage", "settings:manage", "cart:read", "wallet:read",
    "tailors:write_own",
  ]),
];

function signAccessToken(payload) {
  return jwt.sign(
    { type: "access", ...payload },
    JWT_SECRET,
    { expiresIn: "15m" }
  );
}

function actorToken({
  sub,
  email,
  role,
  preset,
  permissions,
  orgId,
  av = 0,
  cwv,
}) {
  return signAccessToken({
    sub,
    email,
    role: role ?? "admin",
    preset,
    membershipRole: preset,
    permissions,
    orgId,
    av,
    ...(cwv === false ? { cwv: false } : cwv === true ? { cwv: true } : {}),
  });
}

async function api(path, { method = "GET", token, body, retries = 3, redirect = "follow" } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers.Cookie = `access-token=${token}`;

  let last = { status: 0, body: "", networkError: true, headers: new Headers() };
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        redirect,
      });
      const text = await res.text();
      last = { status: res.status, body: text, headers: res.headers };
      if (res.status >= 500 && attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      return last;
    } catch (err) {
      last = { status: 0, body: String(err), networkError: true, headers: new Headers() };
      if (attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
    }
  }
  return last;
}

/** Extract a named cookie from fetch Response headers (Node 18+ getSetCookie). */
function cookieValueFromHeaders(headers, name) {
  const list =
    typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  if (list.length === 0) {
    const single = headers.get("set-cookie");
    if (single) list.push(single);
  }
  for (const entry of list) {
    const prefix = `${name}=`;
    if (entry.startsWith(prefix)) {
      return entry.slice(prefix.length).split(";")[0];
    }
  }
  return null;
}

/**
 * Phase 5: real HTTP company registration (not helper + forged JWT).
 * Returns cookies issued by POST /api/auth/register-company.
 */
async function registerCompanyHttp(fields) {
  const res = await fetch(`${BASE_URL}/api/auth/register-company`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  const text = await res.text();
  let parsed = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = {};
  }
  return {
    status: res.status,
    body: text,
    parsed,
    token: cookieValueFromHeaders(res.headers, "access-token"),
    orgId: parsed?.data?.orgId ?? null,
    userId: parsed?.data?.userId ?? null,
    preset: parsed?.data?.preset ?? null,
    redirectTo: parsed?.data?.redirectTo ?? null,
  };
}

const results = [];

function record(section, id, pass, detail = "") {
  results.push({ section, id, pass, detail });
  const mark = pass ? "PASS" : "FAIL";
  console.log(`${mark} [${section}] ${id}${detail ? ` — ${detail}` : ""}`);
}

function expectStatus(actual, expected, label) {
  const pass = actual === expected;
  record("assert", label, pass, `got ${actual}, want ${expected}`);
  return pass;
}

/** --- Fixtures --- */
async function orgByIdOrLegacy(id) {
  if (!id) return null;
  return prisma.organization.findFirst({
    where: { OR: [{ id }, { legacyId: id }] },
  });
}

const defaultOrg =
  (DEFAULT_ORG_ID_ENV && (await orgByIdOrLegacy(DEFAULT_ORG_ID_ENV))) ||
  (await prisma.organization.findFirst({ where: { isDefault: true } })) ||
  (await prisma.organization.findUnique({ where: { slug: "harewa" } }));

if (!defaultOrg) {
  console.error("No default org — run yarn ensure-default-org");
  process.exit(1);
}

let orgB = await prisma.organization.findUnique({ where: { slug: "other-org" } });
if (!orgB) {
  orgB = await prisma.organization.create({
    data: {
      name: "Other Org",
      slug: "other-org",
      status: "active",
      isDefault: false,
    },
  });
}

const orgAId = String(defaultOrg.id);
const orgBId = String(orgB.id);

async function ensureUser(email, role = "client") {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        username: email.split("@")[0],
        role,
        isVerified: true,
        password: await bcrypt.hash("TestPass123!", 10),
      },
    });
  }
  return withId(user);
}

async function ensureMembership(userId, orgId, rolePreset, av = 0, companyWideView = true) {
  const uid = String(userId);
  const oid = String(orgId);
  let m = await prisma.membership.findUnique({
    where: { userId_orgId: { userId: uid, orgId: oid } },
  });
  if (!m) {
    m = await prisma.membership.create({
      data: {
        userId: uid,
        orgId: oid,
        rolePreset,
        status: "active",
        companyWideView,
      },
    });
  } else if (m.rolePreset !== rolePreset || m.companyWideView !== companyWideView) {
    m = await prisma.membership.update({
      where: { id: m.id },
      data: { rolePreset, status: "active", companyWideView },
    });
  }
  await prisma.user.update({ where: { id: uid }, data: { authzVersion: av } });
  return withId(m);
}

const clientA = await ensureUser("rbac-matrix-client-a@test.local", "client");
const clientB = await ensureUser("rbac-matrix-client-b@test.local", "client");
const staffAdmin = await ensureUser("rbac-matrix-admin-a@test.local", "admin");
const staffCatalog = await ensureUser("rbac-matrix-catalog@test.local", "admin");
const staffOps = await ensureUser("rbac-matrix-ops@test.local", "admin");
const staffOpsOwn = await ensureUser("rbac-matrix-ops-own@test.local", "admin");
const staffFinance = await ensureUser("rbac-matrix-finance@test.local", "admin");
const staffRoleChange = await ensureUser("rbac-matrix-rolechange@test.local", "admin");

await ensureMembership(staffAdmin._id, orgAId, "platform_admin", 0);
await ensureMembership(staffCatalog._id, orgAId, "catalog_editor", 0);
await ensureMembership(staffOps._id, orgAId, "ops_manager", 0);
await ensureMembership(staffOpsOwn._id, orgAId, "ops_manager", 0, false);
await ensureMembership(staffFinance._id, orgAId, "finance", 0);
await ensureMembership(staffRoleChange._id, orgAId, "catalog_editor", 0);

const subA = String(clientA._id);
const subB = String(clientB._id);

async function ensureCart(userId) {
  const uid = String(userId);
  let cart = await prisma.cart.findUnique({ where: { userId: uid } });
  if (!cart) {
    cart = await prisma.cart.create({ data: { userId: uid } });
  }
  return withId(cart);
}

async function ensureWallet(userId, token) {
  const uid = String(userId);
  let wallet = await prisma.wallet.findUnique({ where: { userId: uid } });
  if (wallet) return withId(wallet);
  const r = await api("/api/wallet/me", { token });
  if (r.status === 200) {
    try {
      const parsed = JSON.parse(r.body);
      const id = parsed?.data?._id ?? parsed?.data?.id;
      if (id) {
        wallet = await prisma.wallet.findFirst({
          where: { OR: [{ id: String(id) }, { legacyId: String(id) }] },
        });
        if (wallet) return withId(wallet);
      }
    } catch {
      /* fall through */
    }
  }
  wallet = await prisma.wallet.findUnique({ where: { userId: uid } });
  if (!wallet) {
    throw new Error(`Could not provision wallet for user ${userId} (status ${r.status})`);
  }
  return withId(wallet);
}

async function ensureOrder(userId, orgId) {
  const uid = String(userId);
  const oid = String(orgId);
  let order = await prisma.order.findFirst({
    where: { userId: uid, orgId: oid, status: "pending" },
  });
  if (!order) {
    const cart = await ensureCart(uid);
    const wallet = await prisma.wallet.findUnique({ where: { userId: uid } });
    if (!wallet) {
      throw new Error(`Wallet missing for user ${uid} — call ensureWallet first`);
    }
    order = await prisma.order.create({
      data: {
        userId: uid,
        orgId: oid,
        cartId: cart.id,
        walletId: wallet.id,
        status: "pending",
        amount: 1,
        subtotal: 1,
        taxAmount: 0,
        address: "RBAC matrix test address",
      },
    });
  }
  return withId(order);
}

async function ensureCatalogDeps(orgId) {
  let category = await prisma.productCategory.findFirst({ where: { orgId } });
  if (!category) {
    category = await prisma.productCategory.create({
      data: {
        orgId,
        name: `RBAC Category ${orgId.slice(-6)}`,
        description: "RBAC fixture",
      },
    });
  }
  let fabric = await prisma.fabric.findFirst({ where: { orgId } });
  if (!fabric) {
    fabric = await prisma.fabric.create({
      data: {
        orgId,
        name: `RBAC Fabric ${orgId.slice(-6)}`,
        image: "https://example.com/rbac-fabric.jpg",
        type: "cotton",
        color: "white",
      },
    });
  }
  return { category, fabric };
}

async function ensureProduct(orgId, name) {
  const oid = String(orgId);
  let product = await prisma.product.findFirst({ where: { orgId: oid, name } });
  if (!product) {
    const { category, fabric } = await ensureCatalogDeps(oid);
    product = await prisma.product.create({
      data: {
        orgId: oid,
        name,
        description: "RBAC matrix product",
        location: "Test",
        price: 10,
        quantity: 1,
        remainingInStock: 1,
        gender: "unisex",
        categoryId: category.id,
        fabricTypeId: fabric.id,
      },
    });
  }
  return withId(product);
}

const tokenClient = actorToken({
  sub: subA,
  email: clientA.email,
  role: "client",
  preset: "client",
  permissions: CLIENT_PERMS,
  orgId: null,
});
const tokenClientB = actorToken({
  sub: subB,
  email: clientB.email,
  role: "client",
  preset: "client",
  permissions: CLIENT_PERMS,
  orgId: null,
});

const cartA = await ensureCart(subA);
const cartB = await ensureCart(subB);
const walletA = await ensureWallet(subA, tokenClient);
const walletB = await ensureWallet(subB, tokenClientB);
const orderA = await ensureOrder(subA, orgAId);
const orderB = await ensureOrder(subB, orgAId);
const orderOrgB = await ensureOrder(subA, orgBId);
const productA = await ensureProduct(orgAId, "RBAC Matrix Product A");
const productB = await ensureProduct(orgBId, "RBAC Matrix Product B");

const tokenAdmin = actorToken({
  sub: String(staffAdmin._id),
  email: staffAdmin.email,
  role: "admin",
  preset: "platform_admin",
  permissions: PLATFORM_ADMIN_PERMS,
  orgId: orgAId,
});
const tokenCatalog = actorToken({
  sub: String(staffCatalog._id),
  email: staffCatalog.email,
  role: "admin",
  preset: "catalog_editor",
  permissions: CATALOG_EDITOR_PERMS,
  orgId: orgAId,
});
const tokenOps = actorToken({
  sub: String(staffOps._id),
  email: staffOps.email,
  role: "admin",
  preset: "ops_manager",
  permissions: OPS_MANAGER_PERMS,
  orgId: orgAId,
});
const tokenOpsOwn = actorToken({
  sub: String(staffOpsOwn._id),
  email: staffOpsOwn.email,
  role: "admin",
  preset: "ops_manager",
  permissions: OPS_MANAGER_PERMS,
  orgId: orgAId,
  cwv: false,
});
const tokenFinance = actorToken({
  sub: String(staffFinance._id),
  email: staffFinance.email,
  role: "admin",
  preset: "finance",
  permissions: FINANCE_PERMS,
  orgId: orgAId,
});

// Health check
const health = await api("/api/product?limit=1");
if (health.networkError || health.status === 0) {
  console.error(`Cannot reach ${BASE_URL} — start yarn dev first.`);
  process.exit(1);
}

console.log(`\n=== Step 7.2 RBAC matrix @ ${BASE_URL} ===\n`);

// --- A. Anonymous ---
{
  const r = await api("/api/product?limit=1");
  record("A", "A1 public catalog GET", r.status === 200, `status ${r.status}`);
}
{
  const r = await api("/api/admin/members");
  record("A", "A2 admin members no auth", r.status === 401, `status ${r.status}`);
}
{
  const r = await api("/api/admin/tailors");
  record("A", "A2b admin tailors no auth", r.status === 401, `status ${r.status}`);
}
{
  const r = await api("/api/tailor/me");
  record("A", "A2c tailor/me no auth", r.status === 401, `status ${r.status}`);
}
{
  const r = await api("/api/tailors?limit=5");
  let okPublic = r.status === 200;
  let noPii = true;
  try {
    const parsed = JSON.parse(r.body);
    const items = parsed?.data?.items ?? [];
    okPublic = okPublic && Array.isArray(items);
    for (const item of items) {
      if (item?.user || item?.userEmail || item?.orgId || item?.status) {
        noPii = false;
        break;
      }
    }
  } catch {
    okPublic = false;
  }
  record(
    "A",
    "A2d public tailors list (approved, no PII)",
    okPublic && noPii,
    `status ${r.status} noPii=${noPii}`
  );
}
{
  const r = await api("/api/tailors/nia-studio");
  // pending seed slug must 404 on public detail
  record(
    "A",
    "A2e pending/non-approved tailor slug 404",
    r.status === 404,
    `status ${r.status}`
  );
}
{
  const r = await api(`/api/order/${orderA._id}`);
  record("A", "A3 order IDOR no auth", r.status === 401, `status ${r.status}`);
}
{
  const r = await api(`/api/cart/${cartA._id}`);
  record("A", "A4 cart IDOR no auth", r.status === 401, `status ${r.status}`);
}
{
  const r = await api(`/api/wallet/${walletA._id}`);
  record("A", "A5 wallet IDOR no auth", r.status === 401, `status ${r.status}`);
}

// --- B. Client ---
{
  const r = await api("/api/cart/me", { token: tokenClient });
  record("B", "B1 own cart/me", r.status === 200, `status ${r.status}`);
}
{
  const r = await api(`/api/order/${orderA._id}`, { token: tokenClient });
  record("B", "B2 own order GET", r.status === 200, `status ${r.status}`);
}
{
  const r = await api(`/api/wallet/${walletA._id}`, { token: tokenClient });
  record("B", "B3 own wallet GET", r.status === 200, `status ${r.status}`);
}
{
  const r = await api(`/api/cart/${cartB._id}`, { token: tokenClient });
  record("B", "B4 other cart 403", r.status === 403, `status ${r.status}`);
}
{
  const r = await api(`/api/order/${orderB._id}`, { token: tokenClient });
  record("B", "B5 other order 403", r.status === 403, `status ${r.status}`);
}
{
  const r = await api(`/api/wallet/${walletB._id}`, { token: tokenClient });
  record("B", "B6 other wallet 403", r.status === 403, `status ${r.status}`);
}
{
  const r = await api("/api/product", {
    method: "POST",
    token: tokenClient,
    body: { name: "Hack", price: 1 },
  });
  record("B", "B7 catalog POST denied", r.status === 403, `status ${r.status}`);
}
{
  const r = await api("/api/admin/members", { token: tokenClient });
  record("B", "B8 admin API denied", r.status === 403, `status ${r.status}`);
}
{
  const r = await api("/admin", { token: tokenClient, redirect: "manual" });
  const loc = r.headers?.get?.("location") ?? "";
  const blocked =
    r.status === 307 || r.status === 308 || r.status === 302
      ? loc.includes("/403")
      : r.status === 403;
  record("B", "B9 /admin UI blocked for client", blocked, `status ${r.status} loc=${loc}`);
}
{
  const r = await api("/api/admin/tailors", { token: tokenClient });
  record("B", "B10 admin tailors denied for client", r.status === 403, `status ${r.status}`);
}
{
  const r = await api("/api/measurement-profiles", { token: tokenClient });
  record(
    "B",
    "B11 measurement-profiles list (auth)",
    r.status === 200,
    `status ${r.status}`
  );
}
{
  const created = await api("/api/measurement-profiles", {
    method: "POST",
    token: tokenClient,
    body: {
      label: "RBAC Measure A",
      unit: "cm",
      measurements: { waist: 80, height: 170 },
    },
  });
  let profileId = null;
  try {
    profileId = JSON.parse(created.body)?.data?.profile?._id ?? null;
  } catch {
    profileId = null;
  }
  record(
    "B",
    "B12 create measurement profile",
    created.status === 201 && Boolean(profileId),
    `status ${created.status}`
  );
  if (profileId) {
    const idor = await api(`/api/measurement-profiles/${profileId}`, {
      token: tokenClientB,
    });
    record(
      "B",
      "B13 measurement IDOR blocked",
      idor.status === 404 || idor.status === 403,
      `status ${idor.status}`
    );
    await api(`/api/measurement-profiles/${profileId}`, {
      method: "DELETE",
      token: tokenClient,
    });
  } else {
    record("B", "B13 measurement IDOR blocked", false, "skipped — create failed");
  }
}
{
  const r = await api("/api/campaigns/my", { token: tokenClient });
  record(
    "B",
    "B13b campaigns/my (auth)",
    r.status === 200,
    `status ${r.status}`
  );
  const denied = await api("/api/campaigns/my", { token: null });
  record(
    "B",
    "B13c campaigns/my unauthenticated",
    denied.status === 401 || denied.status === 403,
    `status ${denied.status}`
  );
}
{
  const r = await api("/api/admin/tailoring-jobs", { token: tokenClient });
  record(
    "B",
    "B14 admin tailoring-jobs denied for client",
    r.status === 403,
    `status ${r.status}`
  );
}
{
  const r = await api("/api/tailoring-jobs", { token: tokenClient });
  record(
    "B",
    "B15 customer tailoring-jobs list",
    r.status === 200,
    `status ${r.status}`
  );
}
{
  const r = await api("/api/payment/tailoring", {
    method: "POST",
    body: { jobId: "507f1f77bcf86cd799439011", type: "stripe-gateway" },
  });
  record(
    "B",
    "B16 payment/tailoring no auth",
    r.status === 401,
    `status ${r.status}`
  );
}
{
  const r = await api("/api/payment/tailoring", {
    method: "POST",
    token: tokenClient,
    body: { jobId: "507f1f77bcf86cd799439011", type: "stripe-gateway" },
  });
  record(
    "B",
    "B17 payment/tailoring IDOR (foreign job)",
    r.status === 404 || r.status === 403 || r.status === 400,
    `status ${r.status}`
  );
}
{
  const r = await api("/api/tailors/ada-atelier/reviews");
  record(
    "B",
    "B18 public tailor reviews list",
    r.status === 200 || r.status === 404,
    `status ${r.status}`
  );
}
{
  const r = await api("/api/tailors/ada-atelier/reviews", {
    method: "POST",
    body: { jobId: "507f1f77bcf86cd799439011", rating: 5 },
  });
  record(
    "B",
    "B19 tailor reviews no auth",
    r.status === 401,
    `status ${r.status}`
  );
}
{
  const r = await api("/api/tailoring-jobs?scope=tailor", {
    token: tokenClient,
  });
  let ok = r.status === 200;
  if (ok) {
    try {
      const parsed = JSON.parse(r.body);
      ok = Array.isArray(parsed?.data?.jobs);
    } catch {
      ok = false;
    }
  }
  record(
    "B",
    "B20 client tailor-scope jobs (empty or list)",
    ok,
    `status ${r.status}`
  );
}
{
  const ada = await prisma.tailorProfile.findFirst({
    where: { slug: "ada-atelier", status: "approved" },
    select: { id: true },
  });
  if (ada) {
    const measure = await api("/api/measurement-profiles", {
      method: "POST",
      token: tokenClient,
      body: {
        label: "RBAC tailor IDOR",
        unit: "cm",
        measurements: { chest: 40 },
        isDefault: false,
      },
    });
    let measureId = null;
    try {
      measureId = JSON.parse(measure.body)?.data?.profile?._id ?? null;
    } catch {
      measureId = null;
    }
    if (measureId && measure.status === 201) {
      const booked = await api("/api/tailoring-jobs", {
        method: "POST",
        token: tokenClient,
        body: {
          tailorSlug: "ada-atelier",
          measurementProfileId: measureId,
          title: `RBAC IDOR job ${Date.now()}`,
        },
      });
      let jobId = null;
      try {
        jobId = JSON.parse(booked.body)?.data?.job?._id ?? null;
      } catch {
        jobId = null;
      }
      if (jobId && booked.status === 201) {
        const getIdor = await api(`/api/tailoring-jobs/${jobId}`, {
          token: tokenClientB,
        });
        record(
          "B",
          "B21 tailoring job GET IDOR blocked",
          getIdor.status === 403 || getIdor.status === 404,
          `status ${getIdor.status}`
        );
        const patchIdor = await api(`/api/tailoring-jobs/${jobId}`, {
          method: "PATCH",
          token: tokenClientB,
          body: { status: "cancelled", note: "IDOR attempt" },
        });
        record(
          "B",
          "B22 tailoring job PATCH IDOR blocked",
          patchIdor.status === 403 || patchIdor.status === 404,
          `status ${patchIdor.status}`
        );
        const cancelIdor = await api("/api/payment/tailoring/cancel", {
          method: "POST",
          token: tokenClientB,
          body: { jobId },
        });
        record(
          "B",
          "B23 payment cancel IDOR blocked",
          cancelIdor.status === 403 || cancelIdor.status === 404,
          `status ${cancelIdor.status}`
        );
        await prisma.tailoringJob.deleteMany({ where: { id: jobId } });
      } else {
        record(
          "B",
          "B21 tailoring job GET IDOR blocked",
          false,
          "skipped — job create failed"
        );
        record(
          "B",
          "B22 tailoring job PATCH IDOR blocked",
          false,
          "skipped — job create failed"
        );
        record(
          "B",
          "B23 payment cancel IDOR blocked",
          false,
          "skipped — job create failed"
        );
      }
      await api(`/api/measurement-profiles/${measureId}`, {
        method: "DELETE",
        token: tokenClient,
      });
    } else {
      record(
        "B",
        "B21 tailoring job GET IDOR blocked",
        false,
        "skipped — measurement create failed"
      );
      record(
        "B",
        "B22 tailoring job PATCH IDOR blocked",
        false,
        "skipped — measurement create failed"
      );
      record(
        "B",
        "B23 payment cancel IDOR blocked",
        false,
        "skipped — measurement create failed"
      );
    }
  } else {
    record(
      "B",
      "B21 tailoring job GET IDOR blocked",
      true,
      "skipped — no seed ada-atelier"
    );
    record(
      "B",
      "B22 tailoring job PATCH IDOR blocked",
      true,
      "skipped — no seed ada-atelier"
    );
    record(
      "B",
      "B23 payment cancel IDOR blocked",
      true,
      "skipped — no seed ada-atelier"
    );
  }
}
{
  const r = await api("/api/tailoring-jobs/reference-images", { method: "POST" });
  record(
    "B",
    "B24 reference-images no auth",
    r.status === 401,
    `status ${r.status}`
  );
}
{
  const r = await api("/api/payment/tailoring/confirm");
  record(
    "B",
    "B25 payment confirm missing session",
    r.status === 400,
    `status ${r.status}`
  );
}

// --- C. platform_admin ---
{
  const r = await api("/api/product?scope=staff&limit=1", { token: tokenAdmin });
  record("C", "C1 staff product list", r.status === 200, `status ${r.status}`);
}
{
  const r = await api("/api/admin/members", { token: tokenAdmin });
  record("C", "C2 members list", r.status === 200, `status ${r.status}`);
}
{
  const r = await api("/api/analytics", { token: tokenAdmin });
  record("C", "C3 analytics", r.status === 200, `status ${r.status}`);
}
{
  const r = await api("/api/fabric?scope=staff&limit=1", { token: tokenAdmin });
  record("C", "C4 fabrics staff list", r.status === 200, `status ${r.status}`);
}
{
  const r = await api("/api/product-category?scope=staff", { token: tokenAdmin });
  record("C", "C5 categories staff list", r.status === 200, `status ${r.status}`);
}
{
  const r = await api("/api/admin/tax-settings", { token: tokenAdmin });
  record("C", "C6 tax settings within org", r.status === 200, `status ${r.status}`);
}
{
  const r = await api("/api/admin/homepage-content", { token: tokenAdmin });
  record("C", "C6b homepage content (settings:manage)", r.status === 200, `status ${r.status}`);
}
{
  const r = await api("/api/admin/ad-banners", { token: tokenAdmin });
  record("C", "C6c ad banners (settings:manage)", r.status === 200, `status ${r.status}`);
}
{
  const r = await api("/api/admin/venue-locations", { token: tokenAdmin });
  // Storefront / DEFAULT_ORG platform_admin must not manage VenueLocation.
  const denied =
    r.status === 403 &&
    (r.body.includes("storefront") ||
      r.body.includes("registered company") ||
      r.body.includes("venue"));
  record("C", "C6e storefront admin venue-locations denied", denied, `status ${r.status}`);
}
{
  const r = await api("/api/admin/tailors", { token: tokenAdmin });
  record("C", "C6d admin tailors list (tailors:read)", r.status === 200, `status ${r.status}`);
}
{
  const r = await api("/admin", { token: tokenAdmin, redirect: "manual" });
  const allowed = r.status === 200 || (r.status >= 300 && r.status < 400);
  record("C", "C7 /admin UI allowed for staff", allowed, `status ${r.status}`);
}

// --- D. catalog_editor ---
{
  const r = await api("/api/product?scope=staff&limit=1", { token: tokenCatalog });
  record("D", "D1 products read", r.status === 200, `status ${r.status}`);
}
{
  const r = await api("/api/admin/tax-settings", { token: tokenCatalog });
  record("D", "D2 tax denied", r.status === 403, `status ${r.status}`);
}
{
  const r = await api("/api/admin/homepage-content", { token: tokenCatalog });
  record("D", "D2b homepage denied", r.status === 403, `status ${r.status}`);
}
{
  const r = await api("/api/admin/venue-locations", { token: tokenCatalog });
  record("D", "D2d venue-locations denied (not settings:manage)", r.status === 403, `status ${r.status}`);
}
{
  const r = await api("/api/admin/ad-banners", { token: tokenCatalog });
  record("D", "D2c ad banners denied", r.status === 403, `status ${r.status}`);
}
{
  const r = await api("/api/admin/tailors", { token: tokenCatalog });
  record("D", "D2d admin tailors denied", r.status === 403, `status ${r.status}`);
}
{
  const r = await api("/api/order", { token: tokenCatalog });
  record("D", "D3 orders list denied", r.status === 403, `status ${r.status}`);
}
{
  const r = await api("/api/admin/members", { token: tokenCatalog });
  record("D", "D4 users denied", r.status === 403, `status ${r.status}`);
}
{
  const r = await api("/api/fabric?scope=staff&limit=1", { token: tokenCatalog });
  record("D", "D5 fabrics read OK", r.status === 200, `status ${r.status}`);
}
{
  const r = await api("/api/product-category?scope=staff", { token: tokenCatalog });
  record("D", "D6 categories read OK", r.status === 200, `status ${r.status}`);
}
{
  const r = await api(`/api/order/${orderA._id}`, {
    method: "PUT",
    token: tokenCatalog,
    body: { status: "processing" },
  });
  record("D", "D7 orders manage denied", r.status === 403, `status ${r.status}`);
}

// --- E. ops_manager ---
{
  const r = await api("/api/order", { token: tokenOps });
  record("E", "E1 orders read", r.status === 200, `status ${r.status}`);
}
{
  const r = await api("/api/customization", { token: tokenOps });
  record("E", "E2 customizations read", r.status === 200, `status ${r.status}`);
}
{
  // companyWideView=false: staff list returns only own user rows (none for this actor).
  const r = await api("/api/order", { token: tokenOpsOwn });
  let ownOnly = r.status === 200;
  if (ownOnly) {
    try {
      const parsed = JSON.parse(r.body);
      const list = Array.isArray(parsed?.data)
        ? parsed.data
        : Array.isArray(parsed)
          ? parsed
          : [];
      ownOnly = list.every(
        (row) => String(row.user ?? row.userId ?? "") === String(staffOpsOwn._id)
      );
    } catch {
      ownOnly = false;
    }
  }
  record(
    "E",
    "E2b orders list own-scope (cwv=false)",
    ownOnly,
    `status ${r.status}`
  );
}
{
  const r = await api(`/api/order/${orderA._id}`, { token: tokenOpsOwn });
  record(
    "E",
    "E2c other order denied when cwv=false",
    r.status === 403,
    `status ${r.status}`
  );
}
{
  const r = await api("/api/product", {
    method: "POST",
    token: tokenOps,
    body: { name: "OpsHack", price: 1 },
  });
  record("E", "E3 catalog POST denied", r.status === 403, `status ${r.status}`);
}
{
  const r = await api("/api/admin/tax-settings", { token: tokenOps });
  record("E", "E4 tax denied", r.status === 403, `status ${r.status}`);
}
{
  const r = await api("/api/admin/homepage-content", { token: tokenOps });
  record("E", "E4b homepage denied", r.status === 403, `status ${r.status}`);
}
{
  const r = await api("/api/admin/ad-banners", { token: tokenOps });
  record("E", "E4c ad banners denied", r.status === 403, `status ${r.status}`);
}
{
  const r = await api("/api/admin/tailoring-jobs", { token: tokenOps });
  record(
    "E",
    "E10 admin tailoring-jobs list (ops)",
    r.status === 200,
    `status ${r.status}`
  );
}

// --- E2. Find-a-Tailor Phase 1 behaviors (create / approve / self-edit / slug) ---
{
  const email = `rbac.tailor.${Date.now()}@example.com`;
  const newUser = await prisma.user.create({
    data: {
      email,
      password: await bcrypt.hash("RbacTailor1!", 4),
      firstName: "Rbac",
      lastName: "Tailor",
      isVerified: true,
      accountDeleted: false,
      authzVersion: 0,
      role: "client",
    },
  });
  const newUserId = newUser.id;

  try {
  const intendedSlug = `rbac-tailor-${Date.now()}`;
  const created = await api("/api/admin/tailors", {
    method: "POST",
    token: tokenAdmin,
    body: {
      userId: String(newUserId),
      displayName: "RBAC Tailor",
      slug: intendedSlug,
      status: "pending",
    },
  });
  let createdOk = created.status === 201;
  let tailorId = null;
  let createdSlug = "";
  try {
    const parsed = JSON.parse(created.body);
    tailorId = parsed?.data?.tailor?._id ?? null;
    createdSlug = parsed?.data?.tailor?.slug ?? "";
    createdOk =
      createdOk &&
      Boolean(tailorId) &&
      createdSlug === intendedSlug;
  } catch {
    createdOk = false;
  }
  record(
    "E",
    "E6 admin create tailor",
    createdOk,
    `status ${created.status} slug=${createdSlug}`
  );

  const seedAda = await prisma.tailorProfile.findFirst({
    where: { slug: "ada-atelier" },
    select: { id: true },
  });
  if (seedAda) {
    const dupeEmail = `rbac.tailor.dupe.${Date.now()}@example.com`;
    const dupeUser = await prisma.user.create({
      data: {
        email: dupeEmail,
        password: await bcrypt.hash("RbacTailor1!", 4),
        firstName: "Rbac",
        lastName: "Dupe",
        isVerified: true,
        accountDeleted: false,
        authzVersion: 0,
        role: "client",
      },
    });
    const dupeCreate = await api("/api/admin/tailors", {
      method: "POST",
      token: tokenAdmin,
      body: {
        userId: String(dupeUser.id),
        displayName: "RBAC Dupe Tailor",
        slug: "ada-atelier",
        status: "pending",
      },
    });
    let dupeOk = dupeCreate.status === 201;
    let dupeSlug = "";
    let dupeTailorId = null;
    try {
      const parsed = JSON.parse(dupeCreate.body);
      dupeTailorId = parsed?.data?.tailor?._id ?? null;
      dupeSlug = parsed?.data?.tailor?.slug ?? "";
      dupeOk = dupeOk && Boolean(dupeTailorId) && dupeSlug !== "ada-atelier";
    } catch {
      dupeOk = false;
    }
    record(
      "E",
      "E6b slug dedupe on collision",
      dupeOk,
      `status ${dupeCreate.status} slug=${dupeSlug}`
    );
    if (dupeTailorId) {
      await prisma.tailorProfile.deleteMany({
        where: { OR: [{ id: dupeTailorId }, { legacyId: dupeTailorId }] },
      });
    }
    await prisma.membership.deleteMany({ where: { userId: dupeUser.id } });
    await prisma.user.delete({ where: { id: dupeUser.id } });
  } else {
    record("E", "E6b slug dedupe on collision", true, "skipped — no seed ada-atelier");
  }

  if (tailorId) {
    const userBeforeApprove = await prisma.user.findUnique({
      where: { id: newUserId },
    });
    const pendingAv =
      typeof userBeforeApprove?.authzVersion === "number"
        ? userBeforeApprove.authzVersion
        : 0;
    const pendingTok = actorToken({
      sub: String(newUserId),
      email,
      role: "client",
      preset: "tailor",
      permissions: [...CLIENT_PERMS, "tailors:write_own"],
      orgId: orgAId,
      av: pendingAv,
    });
    const pendingEdit = await api("/api/tailor/me", {
      method: "PUT",
      token: pendingTok,
      body: { bio: "should fail while pending" },
    });
    record(
      "E",
      "E7b pending tailor cannot self-edit",
      pendingEdit.status === 403,
      `status ${pendingEdit.status}`
    );

    const approved = await api(`/api/admin/tailors/${tailorId}`, {
      method: "PATCH",
      token: tokenAdmin,
      body: { status: "approved" },
    });
    let approvedOk = approved.status === 200;
    try {
      const parsed = JSON.parse(approved.body);
      approvedOk = approvedOk && parsed?.data?.tailor?.status === "approved";
    } catch {
      approvedOk = false;
    }
    record("E", "E7 admin approve tailor", approvedOk, `status ${approved.status}`);

    const userAfter = await prisma.user.findUnique({ where: { id: newUserId } });
    const tailorAv =
      typeof userAfter?.authzVersion === "number" ? userAfter.authzVersion : 0;
    const tailorTok = actorToken({
      sub: String(newUserId),
      email,
      role: "client",
      preset: "tailor",
      permissions: [...CLIENT_PERMS, "tailors:write_own"],
      orgId: orgAId,
      av: tailorAv,
    });
    const selfEdit = await api("/api/tailor/me", {
      method: "PUT",
      token: tailorTok,
      body: { bio: "RBAC self-edit", specialties: ["Test"] },
    });
    let selfOk = selfEdit.status === 200;
    try {
      const parsed = JSON.parse(selfEdit.body);
      selfOk =
        selfOk &&
        String(parsed?.data?.tailor?.bio || "").includes("RBAC self-edit");
    } catch {
      selfOk = false;
    }
    record("E", "E8 tailor self-edit /me", selfOk, `status ${selfEdit.status}`);

    const suspended = await api(`/api/admin/tailors/${tailorId}`, {
      method: "PATCH",
      token: tokenAdmin,
      body: { status: "suspended" },
    });
    const suspendedEdit = await api("/api/tailor/me", {
      method: "PUT",
      token: tailorTok,
      body: { bio: "should fail while suspended" },
    });
    const suspendedJobs = await api("/api/tailoring-jobs?scope=tailor", {
      token: tailorTok,
    });
    let suspendedJobsOk = suspendedJobs.status === 200;
    if (suspendedJobsOk) {
      try {
        const parsed = JSON.parse(suspendedJobs.body);
        suspendedJobsOk = Array.isArray(parsed?.data?.jobs);
      } catch {
        suspendedJobsOk = false;
      }
    }
    record(
      "E",
      "E8c suspended tailor cannot self-edit",
      suspended.status === 200 && suspendedEdit.status === 403,
      `suspend=${suspended.status} edit=${suspendedEdit.status}`
    );
    record(
      "E",
      "E8d suspended tailor retains in-flight job scope",
      suspended.status === 200 && suspendedJobsOk,
      `suspend=${suspended.status} jobs=${suspendedJobs.status}`
    );
    // Re-approve so later demote/cleanup paths stay consistent.
    await api(`/api/admin/tailors/${tailorId}`, {
      method: "PATCH",
      token: tokenAdmin,
      body: { status: "approved" },
    });

    const tailorJobs = await api("/api/tailoring-jobs?scope=tailor", {
      token: tailorTok,
    });
    let tailorJobsOk = tailorJobs.status === 200;
    if (tailorJobsOk) {
      try {
        const parsed = JSON.parse(tailorJobs.body);
        tailorJobsOk = Array.isArray(parsed?.data?.jobs);
      } catch {
        tailorJobsOk = false;
      }
    }
    record(
      "E",
      "E11 tailor jobs list (scope=tailor)",
      tailorJobsOk,
      `status ${tailorJobs.status}`
    );

    // Demoted client (no active tailor membership) must not edit leftover profile.
    await prisma.membership.updateMany({
      where: { userId: newUserId, orgId: orgAId },
      data: { status: "revoked" },
    });
    await prisma.user.update({
      where: { id: newUserId },
      data: { authzVersion: { increment: 1 } },
    });
    const demoted = await prisma.user.findUnique({ where: { id: newUserId } });
    const demotedTok = actorToken({
      sub: String(newUserId),
      email,
      role: "client",
      preset: "client",
      permissions: [...CLIENT_PERMS],
      orgId: orgAId,
      av: typeof demoted?.authzVersion === "number" ? demoted.authzVersion : 0,
    });
    const demotedEdit = await api("/api/tailor/me", {
      method: "PUT",
      token: demotedTok,
      body: { bio: "should fail after demote" },
    });
    record(
      "E",
      "E8b demoted tailor cannot self-edit",
      demotedEdit.status === 403 || demotedEdit.status === 401,
      `status ${demotedEdit.status}`
    );

    const clientOwn = await api("/api/tailor/me", {
      method: "PUT",
      token: tokenClient,
      body: { bio: "should fail" },
    });
    record(
      "E",
      "E9 client cannot edit tailor /me",
      clientOwn.status === 404 || clientOwn.status === 403,
      `status ${clientOwn.status}`
    );

  } else {
    record("E", "E7b pending tailor cannot self-edit", false, "skipped — create failed");
    record("E", "E7 admin approve tailor", false, "skipped — create failed");
    record("E", "E8 tailor self-edit /me", false, "skipped — create failed");
    record("E", "E8c suspended tailor cannot self-edit", false, "skipped — create failed");
    record("E", "E8d suspended tailor has no provider job scope", false, "skipped — create failed");
    record("E", "E11 tailor jobs list (scope=tailor)", false, "skipped — create failed");
    record("E", "E8b demoted tailor cannot self-edit", false, "skipped — create failed");
    record("E", "E9 client cannot edit tailor /me", false, "skipped — create failed");
  }
  } finally {
    await prisma.tailorProfile.deleteMany({ where: { userId: newUserId } });
    await prisma.membership.deleteMany({ where: { userId: newUserId } });
    await prisma.user.delete({ where: { id: newUserId } }).catch(() => {});
  }
}

// --- F. finance ---
{
  const r = await api("/api/admin/tax-settings", { token: tokenFinance });
  record("F", "F1 tax settings", r.status === 200, `status ${r.status}`);
}
{
  const r = await api("/api/admin/homepage-content", { token: tokenFinance });
  record("F", "F1b homepage denied (not settings:manage)", r.status === 403, `status ${r.status}`);
}
{
  const r = await api("/api/admin/venue-locations", { token: tokenFinance });
  record("F", "F1d venue-locations denied (not settings:manage)", r.status === 403, `status ${r.status}`);
}
{
  const r = await api("/api/admin/ad-banners", { token: tokenFinance });
  record("F", "F1c ad banners denied (not settings:manage)", r.status === 403, `status ${r.status}`);
}
{
  const r = await api("/api/analytics", { token: tokenFinance });
  record("F", "F2 analytics", r.status === 200, `status ${r.status}`);
}
{
  const r = await api("/api/product", {
    method: "POST",
    token: tokenFinance,
    body: { name: "FinHack", price: 1 },
  });
  record("F", "F3 catalog POST denied", r.status === 403, `status ${r.status}`);
}
{
  const r = await api("/api/order", { token: tokenFinance });
  record("F", "F4 orders list denied", r.status === 403, `status ${r.status}`);
}

// --- G. Cross-tenant ---
{
  const r = await api(`/api/product/${productB._id}?scope=staff`, { token: tokenAdmin });
  const cross =
    r.status === 403 &&
    (r.body.includes("Cross-tenant") || r.body.includes("cross-tenant"));
  record("G", "G1 org A admin → org B product", cross, `status ${r.status}`);
}
{
  const r = await api(`/api/order/${orderOrgB._id}`, { token: tokenAdmin });
  const cross =
    r.status === 403 &&
    (r.body.includes("Cross-tenant") || r.body.includes("cross-tenant"));
  record("G", "G2 org A admin → org B order", cross, `status ${r.status}`);
}

// --- H. Role change (authzVersion) ---
{
  const rcSub = String(staffRoleChange._id);
  await ensureMembership(staffRoleChange._id, orgAId, "catalog_editor", 0);
  const staleToken = actorToken({
    sub: rcSub,
    email: staffRoleChange.email,
    role: "admin",
    preset: "catalog_editor",
    permissions: CATALOG_EDITOR_PERMS,
    orgId: orgAId,
    av: 0,
  });
  let r = await api("/api/order", { token: staleToken });
  record("H", "H1 catalog_editor orders denied", r.status === 403, `status ${r.status}`);

  await prisma.membership.updateMany({
    where: { userId: rcSub, orgId: orgAId },
    data: { rolePreset: "ops_manager" },
  });
  await prisma.user.update({
    where: { id: rcSub },
    data: { authzVersion: 1, refreshTokenJTI: null },
  });

  r = await api("/api/order", { token: staleToken });
  record("H", "H2 stale token after role change → 401", r.status === 401, `status ${r.status}`);

  const freshToken = actorToken({
    sub: rcSub,
    email: staffRoleChange.email,
    role: "admin",
    preset: "ops_manager",
    permissions: OPS_MANAGER_PERMS,
    orgId: orgAId,
    av: 1,
  });
  r = await api("/api/order", { token: freshToken });
  record("H", "H3 re-login token orders OK", r.status === 200, `status ${r.status}`);

  r = await api("/api/auth/me", { token: freshToken });
  let meOk = false;
  if (r.status === 200) {
    try {
      const me = JSON.parse(r.body);
      const preset = me?.preset ?? me?.membershipRole;
      const perms = me?.permissions ?? [];
      meOk =
        preset === "ops_manager" &&
        Array.isArray(perms) &&
        perms.includes("orders:read");
    } catch {
      meOk = false;
    }
  }
  record("H", "H4 /api/auth/me reflects new role", meOk, `status ${r.status}`);

  // Restore catalog_editor for idempotency
  await prisma.membership.updateMany({
    where: { userId: rcSub, orgId: orgAId },
    data: { rolePreset: "catalog_editor" },
  });
  await prisma.user.update({
    where: { id: rcSub },
    data: { authzVersion: 0 },
  });
}

// --- I. Signup cannot self-promote ---
{
  const evilEmail = `rbac-signup-evil-${Date.now()}@test.local`;
  const r = await api("/api/auth/signup", {
    method: "POST",
    body: {
      fullName: "Evil Admin",
      email: evilEmail,
      password: "TestPass123!",
      role: "admin",
    },
  });
  const created = await prisma.user.findUnique({ where: { email: evilEmail } });
  const roleOk = created && created.role === "client";
  record("I", "I1 signup ignores admin role", roleOk, created ? `role=${created.role}` : "no user");
  if (created) await prisma.user.delete({ where: { id: created.id } });
}

// --- J. Step 7.3 resource policies ---
{
  const r = await api(`/api/order/${orderA._id}`, {
    method: "PUT",
    token: tokenOps,
    body: { amount: 9999 },
  });
  record("J", "J1 orders:manage cannot change amount", r.status === 403, `status ${r.status}`);
}
{
  const r = await api(`/api/product/${productA._id}`, {
    method: "DELETE",
    token: tokenFinance,
  });
  record("J", "J2 finance cannot delete product", r.status === 403, `status ${r.status}`);
}

// --- K. Phase 3 — members privilege boundaries ---
{
  // Temporary limited manager: can invite/manage roles but cannot grant catalog_editor.
  const limited = await ensureUser("rbac-matrix-limited-mgr@test.local", "admin");
  const limitedPerms = [
    "users:read",
    "users:invite",
    "users:manage_roles",
    "orders:read",
  ];
  await prisma.membership.upsert({
    where: { userId_orgId: { userId: limited._id, orgId: orgAId } },
    create: {
      userId: limited._id,
      orgId: orgAId,
      rolePreset: "custom",
      permissionsOverride: limitedPerms,
      companyWideView: true,
      status: "active",
    },
    update: {
      rolePreset: "custom",
      permissionsOverride: limitedPerms,
      companyWideView: true,
      status: "active",
    },
  });
  await prisma.user.update({
    where: { id: limited._id },
    data: { authzVersion: 0, role: "admin" },
  });
  const tokenLimited = actorToken({
    sub: String(limited._id),
    email: limited.email,
    role: "admin",
    preset: "custom",
    permissions: limitedPerms,
    orgId: orgAId,
    companyWideView: true,
    av: 0,
  });
  const overEmail = `rbac-overgrant-${Date.now()}@test.local`;
  const overUser = await ensureUser(overEmail, "client");
  const r = await api("/api/admin/members", {
    method: "POST",
    token: tokenLimited,
    body: {
      email: overUser.email,
      rolePreset: "catalog_editor",
      status: "invited",
    },
  });
  record(
    "K",
    "K1 over-grant invite 403",
    r.status === 403,
    `status ${r.status}`
  );
  await prisma.membership.deleteMany({
    where: { userId: overUser._id, orgId: orgAId },
  });
}

{
  // catalog_editor Users denial (also D4) — re-assert for Phase 3 completion.
  const r = await api("/api/admin/members", { token: tokenCatalog });
  record("K", "K2 catalog_editor members denied", r.status === 403, `status ${r.status}`);
}

{
  // Last active platform_admin cannot be demoted.
  const admins = await prisma.membership.findMany({
    where: {
      orgId: orgAId,
      rolePreset: "platform_admin",
      status: "active",
    },
    select: { id: true, userId: true, rolePreset: true, status: true },
  });
  const sole = admins.find((a) => String(a.userId) === String(staffAdmin._id)) ?? admins[0];
  const others = admins.filter((a) => a.id !== sole?.id);
  for (const o of others) {
    await prisma.membership.update({
      where: { id: o.id },
      data: { rolePreset: "ops_manager" },
    });
  }
  try {
    if (!sole) {
      record("K", "K3 last-admin demote 403", false, "no platform_admin fixture");
    } else {
      const r = await api(`/api/admin/members/${sole.id}`, {
        method: "PATCH",
        token: tokenAdmin,
        body: { rolePreset: "ops_manager" },
      });
      record(
        "K",
        "K3 last-admin demote 403",
        r.status === 403,
        `status ${r.status}`
      );
    }
  } finally {
    for (const o of others) {
      await prisma.membership.update({
        where: { id: o.id },
        data: { rolePreset: "platform_admin", status: "active" },
      });
    }
  }
}

{
  // Template assign + delete-while-assigned blocked.
  const tplName = `rbac-phase3-tpl-${Date.now()}`;
  const createTpl = await api("/api/admin/role-templates", {
    method: "POST",
    token: tokenAdmin,
    body: {
      name: tplName,
      description: "Phase 3 assign test",
      permissions: ["orders:read"],
    },
  });
  const createOk = createTpl.status === 201 || createTpl.status === 200;
  let tplId = null;
  try {
    const parsed = JSON.parse(createTpl.body || "{}");
    tplId =
      parsed?.data?.template?._id ||
      parsed?.data?.template?.id ||
      parsed?.template?._id ||
      parsed?.template?.id ||
      null;
  } catch {
    tplId = null;
  }
  if (!createOk || !tplId) {
    record(
      "K",
      "K4 template assign + delete-while-assigned",
      false,
      `create status ${createTpl.status}`
    );
  } else {
    const assignee = await ensureUser(
      `rbac-tpl-assignee-${Date.now()}@test.local`,
      "client"
    );
    const invite = await api("/api/admin/members", {
      method: "POST",
      token: tokenAdmin,
      body: {
        email: assignee.email,
        rolePreset: "custom",
        roleTemplateId: tplId,
        status: "invited",
        companyWideView: false,
      },
    });
    const inviteOk = invite.status === 201 || invite.status === 200;
    const delAssigned = await api(`/api/admin/role-templates/${tplId}`, {
      method: "DELETE",
      token: tokenAdmin,
    });
    const blocked =
      delAssigned.status === 400 ||
      delAssigned.status === 403 ||
      delAssigned.status === 409;
    record(
      "K",
      "K4 template assign + delete-while-assigned",
      inviteOk && blocked,
      `invite ${invite.status}; delete ${delAssigned.status}`
    );
    await prisma.membership.deleteMany({
      where: { userId: assignee._id, orgId: orgAId },
    });
    await api(`/api/admin/role-templates/${tplId}`, {
      method: "DELETE",
      token: tokenAdmin,
    });
  }
}

// --- Dual-seat: live other-org blocks invite; revoked allows ops move ---
{
  const stamp = Date.now();
  const dualUser = await ensureUser(
    `rbac-matrix-dual-invite-${stamp}@test.local`,
    "client"
  );
  await prisma.membership.deleteMany({ where: { userId: dualUser._id } });

  // K5a: revoked on org B → invite to org A allowed (ops move after soft-revoke).
  await prisma.membership.create({
    data: {
      userId: dualUser._id,
      orgId: orgBId,
      rolePreset: "catalog_editor",
      status: "revoked",
      companyWideView: false,
    },
  });
  const inviteAfterRevoke = await api("/api/admin/members", {
    method: "POST",
    token: tokenAdmin,
    body: {
      email: dualUser.email,
      rolePreset: "catalog_editor",
      status: "invited",
      companyWideView: false,
    },
  });
  const moveOk =
    inviteAfterRevoke.status === 201 || inviteAfterRevoke.status === 200;
  record(
    "K",
    "K5a invite allowed after revoked other-org seat (ops move)",
    moveOk,
    `status ${inviteAfterRevoke.status}`
  );

  // K5b: active on org B → invite to org A refused (live dual-seat).
  const activeElsewhereUser = await ensureUser(
    `rbac-matrix-dual-active-${stamp}@test.local`,
    "client"
  );
  await prisma.membership.deleteMany({
    where: { userId: activeElsewhereUser._id },
  });
  await ensureMembership(
    activeElsewhereUser._id,
    orgBId,
    "catalog_editor",
    0,
    false
  );
  const inviteActive = await api("/api/admin/members", {
    method: "POST",
    token: tokenAdmin,
    body: {
      email: activeElsewhereUser.email,
      rolePreset: "catalog_editor",
      status: "invited",
      companyWideView: false,
    },
  });
  const activeRefused =
    inviteActive.status === 400 &&
    (inviteActive.body.includes("live membership") ||
      inviteActive.body.includes("another organization") ||
      inviteActive.body.includes("no org switcher"));
  record(
    "K",
    "K5b invite refused for active other-org seat",
    activeRefused,
    `status ${inviteActive.status}`
  );

  await prisma.membership.deleteMany({
    where: {
      userId: { in: [dualUser._id, activeElsewhereUser._id] },
    },
  });
  await prisma.user
    .deleteMany({
      where: { id: { in: [dualUser._id, activeElsewhereUser._id] } },
    })
    .catch(() => {});
}

// --- L. Phase 5 — two companies via HTTP /api/auth/register-company ---
{
  const stamp = Date.now();
  const cleanups = [];
  const password = "TestPass123!";
  const L_CHECKS = [
    "L1 HTTP register two companies → pending + /company-pending",
    "L1b pending company staff product denied until approve",
    "M1 pending company billing plans 403",
    "M1b pending company-profile 403",
    "M1c pending venue-locations 403",
    "L2 company B staff → company A product 403",
    "L3 company A staff → own product OK",
    "L4 public catalog/detail excludes registered-company product",
    "L4b HTTP cookies open /admin (not client 403)",
    "L7 company B denied storefront-only customization list",
    "M2 approved company billing plans 200",
    "M2b approved company-profile GET 200",
    "M2c approved company venue-locations GET 200",
    "M3 portal ignores foreign orgId (actor.orgId only)",
    "M3b venue create ignores foreign orgId (actor.orgId only)",
    "L.set_plan.demo",
    "L.set_plan.starter",
  ];
  const recordedL = new Set();
  const recordL = (name, ok, detail) => {
    recordedL.add(name);
    record("L", name, ok, detail);
  };

  async function cleanupRegisteredCompany(userId, orgId) {
    if (orgId) {
      await prisma.activityLog.deleteMany({ where: { orgId } }).catch(() => {});
      await prisma.product.deleteMany({ where: { orgId } }).catch(() => {});
      // ensureProduct → ensureCatalogDeps creates category + fabric on the org.
      await prisma.fabric.deleteMany({ where: { orgId } }).catch(() => {});
      await prisma.productCategory
        .deleteMany({ where: { orgId } })
        .catch(() => {});
      await prisma.membership.deleteMany({ where: { orgId } }).catch(() => {});
      try {
        await prisma.organization.delete({ where: { id: orgId } });
      } catch (err) {
        console.warn(
          "[verify-rbac L] org cleanup failed",
          orgId,
          err instanceof Error ? err.message : err
        );
      }
    }
    if (userId) {
      await prisma.wallet.deleteMany({ where: { userId } }).catch(() => {});
      await prisma.profile.deleteMany({ where: { userId } }).catch(() => {});
      await prisma.membership.deleteMany({ where: { userId } }).catch(() => {});
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    }
  }

  try {
    const emailA = `rbac-matrix-http-a-${stamp}@test.local`;
    const emailB = `rbac-matrix-http-b-${stamp}@test.local`;
    const slugA = `matrix-http-a-${stamp}`;
    const slugB = `matrix-http-b-${stamp}`;

    const httpA = await registerCompanyHttp({
      companyName: `Matrix HTTP Co A ${stamp}`,
      slug: slugA,
      fullName: "Matrix Admin A",
      email: emailA,
      password,
    });
    cleanups.push(() => cleanupRegisteredCompany(httpA.userId, httpA.orgId));

    const httpB = await registerCompanyHttp({
      companyName: `Matrix HTTP Co B ${stamp}`,
      slug: slugB,
      fullName: "Matrix Admin B",
      email: emailB,
      password,
    });
    cleanups.push(() => cleanupRegisteredCompany(httpB.userId, httpB.orgId));

    const httpShapeOk =
      (httpA.status === 201 || httpA.status === 200) &&
      (httpB.status === 201 || httpB.status === 200) &&
      Boolean(httpA.token) &&
      Boolean(httpB.token) &&
      Boolean(httpA.orgId) &&
      Boolean(httpB.orgId) &&
      httpA.orgId !== httpB.orgId &&
      httpA.preset === "platform_admin" &&
      httpB.preset === "platform_admin" &&
      httpA.redirectTo === "/company-pending" &&
      httpB.redirectTo === "/company-pending";

    let dbShapeOk = false;
    if (httpA.orgId && httpB.orgId) {
      const [orgARow, orgBRow, memA, memB] = await Promise.all([
        prisma.organization.findUnique({ where: { id: httpA.orgId } }),
        prisma.organization.findUnique({ where: { id: httpB.orgId } }),
        prisma.membership.findFirst({
          where: { userId: httpA.userId, orgId: httpA.orgId, status: "active" },
        }),
        prisma.membership.findFirst({
          where: { userId: httpB.userId, orgId: httpB.orgId, status: "active" },
        }),
      ]);
      dbShapeOk =
        orgARow?.isDefault === false &&
        orgBRow?.isDefault === false &&
        orgARow?.status === "pending" &&
        orgBRow?.status === "pending" &&
        memA?.rolePreset === "platform_admin" &&
        memA?.companyWideView === true &&
        memB?.rolePreset === "platform_admin" &&
        memB?.companyWideView === true;
    }

    recordL(
      L_CHECKS[0],
      httpShapeOk && dbShapeOk,
      httpShapeOk && dbShapeOk
        ? `A=${httpA.orgId} B=${httpB.orgId}`
        : `httpA=${httpA.status} httpB=${httpB.status} db=${dbShapeOk}`
    );

    if (!httpShapeOk || !httpA.orgId || !httpB.token || !httpA.token) {
      for (const name of L_CHECKS.slice(1)) {
        recordL(name, false, "skipped");
      }
    } else {
      // Pending companies cannot run staff catalog APIs until Harewa approves.
      const pendingProbe = await api(
        `/api/product?scope=staff&limit=1`,
        { token: httpA.token }
      );
      const pendingBlocked =
        pendingProbe.status === 403 &&
        (pendingProbe.body.includes("pending") ||
          pendingProbe.body.includes("Harewa approval"));
      recordL(
        L_CHECKS[1],
        pendingBlocked,
        `status ${pendingProbe.status}`
      );

      const pendingBilling = await api("/api/admin/billing/plans", {
        token: httpA.token,
      });
      const pendingBillingDenied =
        pendingBilling.status === 403 &&
        (pendingBilling.body.includes("pending") ||
          pendingBilling.body.includes("Harewa approval") ||
          pendingBilling.body.includes("suspended"));
      recordL(
        L_CHECKS[2],
        pendingBillingDenied,
        `status ${pendingBilling.status}`
      );

      const pendingProfile = await api("/api/admin/company-profile", {
        token: httpA.token,
      });
      const pendingProfileDenied =
        pendingProfile.status === 403 &&
        (pendingProfile.body.includes("pending") ||
          pendingProfile.body.includes("Harewa approval") ||
          pendingProfile.body.includes("suspended"));
      recordL(
        L_CHECKS[3],
        pendingProfileDenied,
        `status ${pendingProfile.status}`
      );

      const pendingVenues = await api("/api/admin/venue-locations", {
        token: httpA.token,
      });
      const pendingVenuesDenied =
        pendingVenues.status === 403 &&
        (pendingVenues.body.includes("pending") ||
          pendingVenues.body.includes("Harewa approval") ||
          pendingVenues.body.includes("suspended"));
      recordL(
        L_CHECKS[4],
        pendingVenuesDenied,
        `status ${pendingVenues.status}`
      );

      // Storefront platform_admin approves both companies (subscription foundation).
      const approveA = await api("/api/admin/registered-companies", {
        method: "PATCH",
        token: tokenAdmin,
        body: {
          orgId: httpA.orgId,
          action: "approve",
          subscriptionPlan: "starter",
        },
      });
      const approveB = await api("/api/admin/registered-companies", {
        method: "PATCH",
        token: tokenAdmin,
        body: {
          orgId: httpB.orgId,
          action: "approve",
          subscriptionPlan: "growth",
        },
      });
      const approveOk =
        (approveA.status === 200 || approveA.status === 201) &&
        (approveB.status === 200 || approveB.status === 201);
      if (!approveOk) {
        for (const name of L_CHECKS.slice(5)) {
          recordL(
            name,
            false,
            `approve skipped A=${approveA.status} B=${approveB.status}`
          );
        }
      } else {
      // Emergency set_plan (same storefront admin) — records untouched.
      const setPlanA = await api("/api/admin/registered-companies", {
        method: "PATCH",
        token: tokenAdmin,
        body: {
          orgId: httpA.orgId,
          action: "set_plan",
          subscriptionPlan: "demo",
        },
      });
      recordL(
        "L.set_plan.demo",
        setPlanA.status === 200 || setPlanA.status === 201,
        `set_plan demo status=${setPlanA.status}`
      );
      const setPlanBack = await api("/api/admin/registered-companies", {
        method: "PATCH",
        token: tokenAdmin,
        body: {
          orgId: httpA.orgId,
          action: "set_plan",
          subscriptionPlan: "starter",
        },
      });
      recordL(
        "L.set_plan.starter",
        setPlanBack.status === 200 || setPlanBack.status === 201,
        `set_plan starter status=${setPlanBack.status}`
      );
      const productCoA = await ensureProduct(
        httpA.orgId,
        `Matrix HTTP Co A Product ${stamp}`
      );

      const cross = await api(
        `/api/product/${productCoA._id}?scope=staff`,
        { token: httpB.token }
      );
      const crossOk =
        cross.status === 403 &&
        (cross.body.includes("Cross-tenant") ||
          cross.body.includes("cross-tenant"));
      recordL(L_CHECKS[5], crossOk, `status ${cross.status}`);

      const own = await api(
        `/api/product/${productCoA._id}?scope=staff`,
        { token: httpA.token }
      );
      recordL(L_CHECKS[6], own.status === 200, `status ${own.status}`);

      // Public list + public detail must not expose company-tenant products.
      const publicCatalog = await api("/api/product?limit=50");
      let storefrontOk = publicCatalog.status === 200;
      if (storefrontOk) {
        try {
          const parsed = JSON.parse(publicCatalog.body);
          const items = parsed?.data?.items ?? parsed?.data ?? parsed ?? [];
          const list = Array.isArray(items) ? items : [];
          storefrontOk = !list.some(
            (row) =>
              String(row?.id ?? row?._id ?? "") === String(productCoA._id)
          );
        } catch {
          storefrontOk = false;
        }
      }
      const publicDetail = await api(`/api/product/${productCoA._id}`);
      const detailHidden =
        publicDetail.status === 404 ||
        publicDetail.status === 403 ||
        publicDetail.status === 400;
      recordL(
        L_CHECKS[7],
        storefrontOk && detailHidden,
        `list=${publicCatalog.status} detail=${publicDetail.status}`
      );

      const adminUi = await api("/admin", {
        token: httpA.token,
        redirect: "manual",
      });
      const adminOk =
        adminUi.status === 200 ||
        (adminUi.status >= 300 &&
          adminUi.status < 400 &&
          String(adminUi.headers.get("location") || "").includes("/admin"));
      // Staff may get 200 HTML; clients are bounced to /403 (B9). Company admin
      // cookies must not be treated as client.
      const notClient403 = !(
        adminUi.status >= 300 &&
        String(adminUi.headers.get("location") || "").includes("/403")
      );
      recordL(
        L_CHECKS[8],
        adminOk && notClient403,
        `status ${adminUi.status} loc=${adminUi.headers.get("location") || ""}`
      );

      // Registered company staff must not see Harewa storefront customization list.
      const custB = await api("/api/customization", { token: httpB.token });
      recordL(
        L_CHECKS[9],
        custB.status === 403,
        `status ${custB.status}`
      );

      const billingA = await api("/api/admin/billing/plans", {
        token: httpA.token,
      });
      recordL(
        L_CHECKS[10],
        billingA.status === 200,
        `status ${billingA.status}`
      );

      const profileA = await api("/api/admin/company-profile", {
        token: httpA.token,
      });
      let profileOk = profileA.status === 200;
      if (profileOk) {
        try {
          const parsed = JSON.parse(profileA.body);
          const profile =
            parsed?.data?.profile ?? parsed?.profile ?? parsed?.data ?? null;
          // Never return bank ciphertext / write-only routing on GET.
          profileOk =
            profile != null &&
            !("bankAccountCiphertext" in (profile || {})) &&
            (profile.bankRoutingOrIban == null ||
              profile.bankRoutingOrIban === undefined);
        } catch {
          profileOk = false;
        }
      }
      recordL(
        L_CHECKS[11],
        profileOk,
        `status ${profileA.status}`
      );

      const venuesA = await api("/api/admin/venue-locations", {
        token: httpA.token,
      });
      let venuesListOk = venuesA.status === 200;
      if (venuesListOk) {
        try {
          const parsed = JSON.parse(venuesA.body);
          const data = parsed?.data ?? parsed;
          const list = data?.venues;
          venuesListOk =
            Array.isArray(list) &&
            String(data?.orgId ?? "") === String(httpA.orgId);
        } catch {
          venuesListOk = false;
        }
      }
      recordL(
        L_CHECKS[12],
        venuesListOk,
        `status ${venuesA.status}`
      );

      // Portal must bind to actor.orgId — body.orgId for A must not open A's portal for B.
      const portalB = await api("/api/admin/billing/portal", {
        method: "POST",
        token: httpB.token,
        body: { orgId: httpA.orgId },
      });
      let portalIsolated = portalB.status === 400 || portalB.status === 403;
      if (portalB.status === 200) {
        try {
          const parsed = JSON.parse(portalB.body);
          const url = String(parsed?.data?.url ?? parsed?.url ?? "");
          // If Stripe returned a URL, it is still for B's customer (or none) —
          // never accept a success that references org A id in the payload.
          portalIsolated = !portalB.body.includes(httpA.orgId);
          void url;
        } catch {
          portalIsolated = false;
        }
      }
      recordL(
        L_CHECKS[13],
        portalIsolated,
        `status ${portalB.status}`
      );

      // Venue create must stamp actor.orgId — foreign body.orgId must not create under A for B.
      const venueCreateB = await api("/api/admin/venue-locations", {
        method: "POST",
        token: httpB.token,
        body: {
          name: `Matrix Venue B ${stamp}`,
          slug: `matrix-venue-b-${stamp}`,
          orgId: httpA.orgId,
        },
      });
      let venueIsolated =
        venueCreateB.status === 400 || venueCreateB.status === 403;
      if (venueCreateB.status === 200 || venueCreateB.status === 201) {
        try {
          const parsed = JSON.parse(venueCreateB.body);
          const venue =
            parsed?.data?.venue ?? parsed?.venue ?? parsed?.data ?? null;
          venueIsolated =
            venue != null && String(venue.orgId) === String(httpB.orgId);
        } catch {
          venueIsolated = false;
        }
      }
      // Also assert privileged status/id cannot be client-set.
      const venueStatusProbe = await api("/api/admin/venue-locations", {
        method: "POST",
        token: httpB.token,
        body: {
          name: `Matrix Venue Status ${stamp}`,
          slug: `matrix-venue-status-${stamp}`,
          status: "archived",
        },
      });
      const statusRejected = venueStatusProbe.status === 400;
      recordL(
        L_CHECKS[14],
        venueIsolated && statusRejected,
        `create=${venueCreateB.status} statusProbe=${venueStatusProbe.status}`
      );
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    for (const name of L_CHECKS) {
      if (recordedL.has(name)) continue;
      recordL(
        name,
        false,
        recordedL.size === 0 && name === L_CHECKS[0]
          ? msg.slice(0, 160)
          : `skipped (${msg.slice(0, 80)})`
      );
    }
  } finally {
    for (const fn of cleanups.reverse()) {
      await fn();
    }
  }
}

// --- L5. Catalog CWV=false own-scope (Phase 5 / Part 11) ---
{
  const stamp = Date.now();
  const editor = await ensureUser(
    `rbac-matrix-cwv-editor-${stamp}@test.local`,
    "admin"
  );
  await ensureMembership(editor._id, orgAId, "catalog_editor", 0, false);
  const tokenCwvFalse = actorToken({
    sub: String(editor._id),
    email: editor.email,
    role: "admin",
    preset: "catalog_editor",
    permissions: CATALOG_EDITOR_PERMS,
    orgId: orgAId,
    cwv: false,
  });

  // Coworker fabric (createdBy = platform_admin) must be hidden when CWV false.
  const fabricCoworker = await prisma.fabric.create({
    data: {
      orgId: orgAId,
      name: `RBAC CWV fabric coworker ${stamp}`,
      image: "https://example.com/f.jpg",
      type: "cotton",
      color: "navy",
      createdById: String(staffAdmin._id),
      createdByName: "Admin",
    },
  });
  const fabricOwn = await prisma.fabric.create({
    data: {
      orgId: orgAId,
      name: `RBAC CWV fabric own ${stamp}`,
      image: "https://example.com/f2.jpg",
      type: "silk",
      color: "cream",
      createdById: String(editor._id),
      createdByName: "Editor",
    },
  });

  try {
    const denied = await api(`/api/fabric/${fabricCoworker.id}?scope=staff`, {
      token: tokenCwvFalse,
    });
    record(
      "L",
      "L5 CWV=false coworker fabric denied",
      denied.status === 403,
      `status ${denied.status}`
    );
    const allowed = await api(`/api/fabric/${fabricOwn.id}?scope=staff`, {
      token: tokenCwvFalse,
    });
    record(
      "L",
      "L6 CWV=false own fabric OK",
      allowed.status === 200,
      `status ${allowed.status}`
    );
  } finally {
    await prisma.fabric.deleteMany({
      where: { id: { in: [fabricCoworker.id, fabricOwn.id] } },
    });
    await prisma.membership.deleteMany({
      where: { userId: editor._id, orgId: orgAId },
    });
    await prisma.user.delete({ where: { id: editor._id } }).catch(() => {});
  }
}

await prisma.$disconnect();

const failed = results.filter((r) => !r.pass);
console.log("\n=== Summary ===");
console.log(`Total: ${results.length}  Passed: ${results.length - failed.length}  Failed: ${failed.length}`);
if (failed.length) {
  console.log("\nFailed:");
  for (const f of failed) {
    console.log(`  [${f.section}] ${f.id}${f.detail ? ` — ${f.detail}` : ""}`);
  }
  process.exit(1);
}
console.log("\nAll matrix checks passed.");
