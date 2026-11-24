/**
 * Phase 2 Find-a-Tailor public discovery smoke (dev server on :3000).
 * Usage: node scripts/smoke-tailors-phase2.mjs
 */
import dns from "node:dns";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
    redirect: "manual",
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

const results = [];
function ok(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const adminPerms = [
  "users:read",
  "users:manage_roles",
  "users:invite",
  "tailors:read",
  "tailors:manage",
  "orders:read",
  "orders:manage",
  "products:read",
  "products:write",
  "products:delete",
  "fabrics:read",
  "fabrics:write",
  "fabrics:delete",
  "categories:read",
  "categories:write",
  "categories:delete",
  "customizations:read",
  "customizations:manage",
  "reviews:moderate",
  "tax:manage",
  "settings:manage",
  "ai:manage",
  "ai:chats_read",
  "ai:chats_reply",
  "ai:chats_delete",
  "analytics:read",
  "tailoring_jobs:read",
  "tailoring_jobs:manage",
];

try {
  const health = await api("/api/tailors?limit=1");
  if (health.status === 0) {
    console.error(`Cannot reach ${BASE} — start yarn dev first.`);
    process.exit(1);
  }

  // --- Public API: list ---
  {
    const r = await api("/api/tailors?page=1&limit=5");
    let noPii = true;
    let hasMeta = false;
    if (r.status === 200 && r.json?.success) {
      const data = r.json.data ?? {};
      hasMeta =
        Array.isArray(data.items) &&
        typeof data.page === "number" &&
        typeof data.totalPages === "number";
      for (const item of data.items ?? []) {
        if (item?.user || item?.userEmail || item?.orgId || item?.status) {
          noPii = false;
          break;
        }
      }
    }
    ok(
      "public list pagination + approved DTO",
      r.status === 200 && hasMeta && noPii,
      `status ${r.status} meta=${hasMeta} noPii=${noPii}`
    );
  }

  // --- Empty search ---
  {
    const r = await api(
      `/api/tailors?q=${encodeURIComponent("zzzz-no-tailor-match-xyz")}&limit=5`
    );
    const items = r.json?.data?.items ?? [];
    ok(
      "empty search results",
      r.status === 200 && Array.isArray(items) && items.length === 0,
      `status ${r.status} count=${items.length}`
    );
  }

  // --- Invalid slug API ---
  {
    const r = await api("/api/tailors/not-a-real-tailor-slug-404");
    ok("invalid slug API 404", r.status === 404, `status ${r.status}`);
  }

  // --- Pages regression ---
  for (const path of ["/home", "/shop", "/customize", "/tailors"]) {
    const r = await api(path);
    ok(`page ${path} loads`, r.status === 200, `status ${r.status}`);
  }

  // --- Invalid slug page 404 ---
  {
    const r = await api("/tailors/not-a-real-tailor-slug-404");
    ok("invalid slug page 404", r.status === 404, `status ${r.status}`);
  }

  // --- Phase 1 ↔ Phase 2 approve sync ---
  const admin = await prisma.user.findFirst({
    where: { role: "admin", accountDeleted: false },
    orderBy: { joinedAt: "asc" },
  });
  const org =
    (await prisma.organization.findFirst({ where: { isDefault: true } })) ||
    (await prisma.organization.findFirst());

  if (!admin || !org) {
    ok("approve sync workflow", false, "missing admin/org");
  } else {
    const adminMem = await prisma.membership.findFirst({
      where: { userId: admin.id, orgId: org.id, status: "active" },
    });
    const av =
      typeof admin.authzVersion === "number" ? admin.authzVersion : 0;
    const tokenAdmin = actorToken({
      sub: admin.id,
      email: admin.email,
      role: "admin",
      preset: adminMem?.rolePreset ?? "platform_admin",
      permissions: adminPerms,
      orgId: org.id,
      av,
    });

    const slug = `smoke-p2-${Date.now()}`;
    const email = `smoke.p2.${Date.now()}@example.com`;
    const user = await prisma.user.create({
      data: {
        email,
        username: `smokep2${Date.now()}`,
        password: "unused",
        role: "client",
        authzVersion: 0,
      },
    });

    const created = await api("/api/admin/tailors", {
      method: "POST",
      token: tokenAdmin,
      body: {
        userId: user.id,
        displayName: "Smoke P2 Tailor",
        slug,
        status: "pending",
        specialties: ["Bridal"],
      },
    });
    const tailorId = created.json?.data?.tailor?._id;

    if (created.status === 201 && tailorId) {
      const pendingList = await api("/api/tailors?limit=50");
      const pendingSlug = await api(`/api/tailors/${slug}`);
      const listedWhilePending = (pendingList.json?.data?.items ?? []).some(
        (t) => t?.slug === slug
      );
      ok(
        "pending not in public list",
        !listedWhilePending,
        `listed=${listedWhilePending}`
      );
      ok(
        "pending slug API 404",
        pendingSlug.status === 404,
        `status ${pendingSlug.status}`
      );

      const approved = await api(`/api/admin/tailors/${tailorId}`, {
        method: "PATCH",
        token: tokenAdmin,
        body: { status: "approved" },
      });
      const approvedList = await api("/api/tailors?limit=50");
      const approvedDetail = await api(`/api/tailors/${slug}`);
      const listedWhenApproved = (approvedList.json?.data?.items ?? []).some(
        (t) => t?.slug === slug
      );
      ok(
        "admin approve",
        approved.status === 200 &&
          approved.json?.data?.tailor?.status === "approved",
        `status ${approved.status}`
      );
      ok(
        "approved in public list",
        listedWhenApproved,
        `listed=${listedWhenApproved}`
      );
      ok(
        "approved slug detail 200",
        approvedDetail.status === 200 &&
          approvedDetail.json?.data?.tailor?.slug === slug,
        `status ${approvedDetail.status}`
      );

      const qSearch = await api(
        `/api/tailors?q=${encodeURIComponent("Bridal")}&limit=20`
      );
      const qItems = qSearch.json?.data?.items ?? [];
      ok(
        "q search matches specialty",
        qSearch.status === 200 &&
          qItems.some((t) => t?.slug === slug),
        `found=${qItems.some((t) => t?.slug === slug)}`
      );

      const suspended = await api(`/api/admin/tailors/${tailorId}`, {
        method: "PATCH",
        token: tokenAdmin,
        body: { status: "suspended" },
      });
      const suspendedList = await api("/api/tailors?limit=50");
      const suspendedSlug = await api(`/api/tailors/${slug}`);
      const listedWhenSuspended = (suspendedList.json?.data?.items ?? []).some(
        (t) => t?.slug === slug
      );
      ok(
        "suspend admin",
        suspended.status === 200,
        `status ${suspended.status}`
      );
      ok(
        "suspended not in public list",
        !listedWhenSuspended,
        `listed=${listedWhenSuspended}`
      );
      ok(
        "suspended slug API 404",
        suspendedSlug.status === 404,
        `status ${suspendedSlug.status}`
      );

      await prisma.tailorReview.deleteMany({
        where: { tailorProfileId: tailorId },
      });
      await prisma.tailoringJob.deleteMany({ where: { tailorProfileId: tailorId } });
      await prisma.tailorProfile.delete({ where: { id: tailorId } });
    } else {
      ok("approve sync workflow", false, `create failed status ${created.status}`);
    }

    await prisma.membership.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\nPhase 2 smoke: ${passed}/${results.length} passed`);
  if (failed > 0) process.exit(1);
} finally {
  await prisma.$disconnect();
}
