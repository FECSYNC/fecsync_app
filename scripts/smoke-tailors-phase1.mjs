/**
 * Phase 1 Find-a-Tailor workflow smoke (dev server on :3000).
 * Usage: node scripts/smoke-tailors-phase1.mjs
 */
import dns from "node:dns";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { loadDatabaseUrl } from "./prisma-env.mjs";

dns.setServers(["8.8.8.8", "1.1.1.1"]);
loadDatabaseUrl();

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = fs.readFileSync(path.join(root, ".env.local"), "utf8");
function get(k) {
  const m = env.match(new RegExp(`^${k}=(.*)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
}

const JWT_SECRET = get("JWT_SECRET");
const BASE = process.env.BASE_URL || get("BASE_URL") || "http://localhost:3000";
const prisma = new PrismaClient();

function actorToken(claims) {
  return jwt.sign(
    {
      type: "access",
      sub: claims.sub,
      email: claims.email,
      role: claims.role,
      preset: claims.preset,
      membershipRole: claims.preset,
      permissions: claims.permissions,
      orgId: claims.orgId,
      av: claims.av ?? 0,
    },
    JWT_SECRET,
    { expiresIn: "15m" }
  );
}

async function api(pathname, { method = "GET", token, body } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      ...(token ? { Cookie: `access-token=${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: res.status, json, text };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const admin = await prisma.user.findFirst({
  where: { role: "admin", accountDeleted: false },
  orderBy: { joinedAt: "asc" },
});
assert(admin, "Need an admin user");
const org =
  (await prisma.organization.findFirst({ where: { isDefault: true } })) ||
  (await prisma.organization.findFirst());
assert(org, "Need an organization");

const adminMem = await prisma.membership.findFirst({
  where: { userId: admin.id, orgId: org.id, status: "active" },
});
const tokenAdmin = actorToken({
  sub: admin.id,
  email: admin.email,
  role: "admin",
  preset: adminMem?.rolePreset || "platform_admin",
  permissions: ["*"],
  orgId: org.id,
  av: admin.authzVersion ?? 0,
});

const client = await prisma.user.findFirst({
  where: { role: "client", accountDeleted: false, email: { not: { contains: "rbac." } } },
});
assert(client, "Need a client user");
const tokenClient = actorToken({
  sub: client.id,
  email: client.email,
  role: "client",
  preset: "client",
  permissions: [],
  orgId: org.id,
  av: client.authzVersion ?? 0,
});

const email = `smoke.tailor.${Date.now()}@example.com`;
const user = await prisma.user.create({
  data: {
    email,
    password: await bcrypt.hash("SmokeTailor1!", 4),
    firstName: "Smoke",
    lastName: "Tailor",
    isVerified: true,
    accountDeleted: false,
    authzVersion: 0,
    role: "client",
  },
});

let passed = 0;
const results = [];
function ok(name, cond, detail = "") {
  results.push(`${cond ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (cond) passed += 1;
  else throw new Error(`FAIL ${name}: ${detail}`);
}

try {
  const denied = await api("/api/admin/tailors", { token: tokenClient });
  ok("client denied admin list", denied.status === 403, `status ${denied.status}`);

  const created = await api("/api/admin/tailors", {
    method: "POST",
    token: tokenAdmin,
    body: {
      userId: user.id,
      displayName: "Smoke Tailor",
      slug: `smoke-tailor-${Date.now()}`,
      status: "pending",
    },
  });
  const tailorId = created.json?.data?.tailor?._id;
  ok("admin create pending", created.status === 201 && Boolean(tailorId), `status ${created.status}`);

  const pendingUser = await prisma.user.findUnique({ where: { id: user.id } });
  const pendingTok = actorToken({
    sub: user.id,
    email,
    role: "client",
    preset: "tailor",
    permissions: ["tailors:write_own"],
    orgId: org.id,
    av: pendingUser?.authzVersion ?? 0,
  });
  const pendingEdit = await api("/api/tailor/me", {
    method: "PUT",
    token: pendingTok,
    body: { bio: "pending should fail" },
  });
  ok("pending cannot edit", pendingEdit.status === 403, `status ${pendingEdit.status}`);

  const approved = await api(`/api/admin/tailors/${tailorId}`, {
    method: "PATCH",
    token: tokenAdmin,
    body: { status: "approved" },
  });
  ok(
    "admin approve",
    approved.status === 200 && approved.json?.data?.tailor?.status === "approved",
    `status ${approved.status}`
  );

  const after = await prisma.user.findUnique({ where: { id: user.id } });
  const tailorTok = actorToken({
    sub: user.id,
    email,
    role: "client",
    preset: "tailor",
    permissions: ["tailors:write_own"],
    orgId: org.id,
    av: after?.authzVersion ?? 0,
  });
  const selfEdit = await api("/api/tailor/me", {
    method: "PUT",
    token: tailorTok,
    body: { bio: "approved edit ok", specialties: ["Smoke"] },
  });
  ok(
    "approved can edit",
    selfEdit.status === 200 &&
      String(selfEdit.json?.data?.tailor?.bio || "").includes("approved edit ok"),
    `status ${selfEdit.status}`
  );

  const suspended = await api(`/api/admin/tailors/${tailorId}`, {
    method: "PATCH",
    token: tokenAdmin,
    body: { status: "suspended" },
  });
  const suspendedEdit = await api("/api/tailor/me", {
    method: "PUT",
    token: tailorTok,
    body: { bio: "suspended should fail" },
  });
  ok(
    "suspended cannot edit",
    suspended.status === 200 && suspendedEdit.status === 403,
    `suspend=${suspended.status} edit=${suspendedEdit.status}`
  );

  console.log(results.join("\n"));
  console.log(`\nPhase 1 smoke: ${passed}/${results.length} passed`);
} finally {
  await prisma.tailorProfile.deleteMany({ where: { userId: user.id } });
  await prisma.membership.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  await prisma.$disconnect();
}
