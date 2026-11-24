/**
 * Phase 3 Find-a-Tailor — measurements, booking & job management smoke.
 * Usage: node scripts/smoke-tailors-phase3.mjs
 *
 * Flow: measurement CRUD → book job → tailor accept → tailor quote
 * Security: IDOR on measurements/jobs, invalid transitions, cancel before accept
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

const CLIENT_PERMS = [
  "cart:manage_own",
  "orders:create_own",
  "profile:manage_own",
  "measurements:read_own",
  "measurements:write_own",
  "tailoring_jobs:read_own",
  "tailoring_jobs:write_own",
];

const adminPerms = [
  "tailors:read",
  "tailors:manage",
  "tailoring_jobs:read",
  "tailoring_jobs:manage",
  "users:read",
  "orders:read",
  "products:read",
];

try {
  const health = await api("/api/tailors?limit=1");
  if (health.status === 0) {
    console.error(`Cannot reach ${BASE} — start yarn dev first.`);
    process.exit(1);
  }

  const org =
    (await prisma.organization.findFirst({ where: { isDefault: true } })) ||
    (await prisma.organization.findFirst());
  if (!org) throw new Error("No organization");

  const adaProfile = await prisma.tailorProfile.findFirst({
    where: { slug: "ada-atelier", status: "approved", orgId: org.id },
    include: { user: true },
  });
  const kaiProfile = await prisma.tailorProfile.findFirst({
    where: { slug: "kai-menswear", status: "approved", orgId: org.id },
    include: { user: true },
  });
  if (!adaProfile?.user || !kaiProfile?.user) {
    ok("seed tailors ada/kai", false, "run yarn seed-tailors");
    throw new Error("Missing seed tailors");
  }

  const ts = Date.now();
  const customer = await prisma.user.create({
    data: {
      email: `smoke.p3.${ts}@example.com`,
      username: `smokep3${ts}`,
      password: "unused",
      role: "client",
      authzVersion: 0,
    },
  });
  const otherClient = await prisma.user.create({
    data: {
      email: `smoke.p3.other.${ts}@example.com`,
      username: `smokep3o${ts}`,
      password: "unused",
      role: "client",
      authzVersion: 0,
    },
  });

  const tokenCustomer = actorToken({
    sub: customer.id,
    email: customer.email,
    role: "client",
    preset: "client",
    permissions: CLIENT_PERMS,
    orgId: org.id,
    av: 0,
  });
  const tokenOther = actorToken({
    sub: otherClient.id,
    email: otherClient.email,
    role: "client",
    preset: "client",
    permissions: CLIENT_PERMS,
    orgId: org.id,
    av: 0,
  });

  const adaMem = await prisma.membership.findFirst({
    where: { userId: adaProfile.userId, orgId: org.id, status: "active" },
  });
  const tokenAda = actorToken({
    sub: adaProfile.userId,
    email: adaProfile.user.email,
    role: "client",
    preset: "tailor",
    permissions: [...CLIENT_PERMS, "tailors:write_own"],
    orgId: org.id,
    av: adaProfile.user.authzVersion ?? 0,
  });
  void adaMem;

  const tokenKai = actorToken({
    sub: kaiProfile.userId,
    email: kaiProfile.user.email,
    role: "client",
    preset: "tailor",
    permissions: [...CLIENT_PERMS, "tailors:write_own"],
    orgId: org.id,
    av: kaiProfile.user.authzVersion ?? 0,
  });

  const admin = await prisma.user.findFirst({
    where: { role: "admin", accountDeleted: false },
    orderBy: { joinedAt: "asc" },
  });
  const adminMem = admin
    ? await prisma.membership.findFirst({
        where: { userId: admin.id, orgId: org.id, status: "active" },
      })
    : null;
  const tokenAdmin = admin
    ? actorToken({
        sub: admin.id,
        email: admin.email,
        role: "admin",
        preset: adminMem?.rolePreset ?? "platform_admin",
        permissions: adminPerms,
        orgId: org.id,
        av: admin.authzVersion ?? 0,
      })
    : null;

  // --- Measurements: no auth ---
  {
    const r = await api("/api/measurement-profiles");
    ok("measurements no auth", r.status === 401, `status ${r.status}`);
  }

  // --- Measurement CRUD ---
  let measureId = null;
  {
    const r = await api("/api/measurement-profiles", {
      method: "POST",
      token: tokenCustomer,
      body: {
        label: "Smoke P3",
        unit: "cm",
        measurements: { chest: 40, waist: 32 },
        isDefault: true,
      },
    });
    measureId = r.json?.data?.profile?._id ?? null;
    ok(
      "create measurement profile",
      r.status === 201 && Boolean(measureId),
      `status ${r.status}`
    );
  }

  {
    const r = await api(`/api/measurement-profiles/${measureId}`, {
      method: "PUT",
      token: tokenCustomer,
      body: {
        label: "Smoke P3 Updated",
        unit: "cm",
        measurements: { chest: 41, waist: 33 },
      },
    });
    ok(
      "update measurement profile",
      r.status === 200 &&
        r.json?.data?.profile?.label === "Smoke P3 Updated",
      `status ${r.status}`
    );
  }

  {
    const r = await api(`/api/measurement-profiles/${measureId}`, {
      token: tokenOther,
    });
    ok(
      "measurement IDOR blocked",
      r.status === 404,
      `status ${r.status}`
    );
  }

  // --- Book job ---
  let jobId = null;
  {
    const r = await api("/api/tailoring-jobs", {
      method: "POST",
      token: tokenCustomer,
      body: {
        tailorSlug: adaProfile.slug,
        measurementProfileId: measureId,
        title: `Smoke P3 Job ${ts}`,
        description: "Phase 3 smoke",
        style: "Agbada",
        eventType: "Wedding",
      },
    });
    jobId = r.json?.data?.job?._id ?? null;
    const job = r.json?.data?.job;
    ok(
      "POST tailoring-jobs creates submitted",
      r.status === 201 &&
        job?.status === "submitted" &&
        job?.tailorSlug === adaProfile.slug &&
        Array.isArray(job?.statusHistory) &&
        job.statusHistory.length >= 1 &&
        job?.measurementSnapshot?.measurements?.chest === 41,
      `status ${r.status} jobStatus=${job?.status}`
    );
  }

  {
    const notif = await prisma.notification.findFirst({
      where: {
        userId: adaProfile.userId,
        title: "New tailoring request",
      },
      orderBy: { createdAt: "desc" },
    });
    const meta =
      notif?.metadata && typeof notif.metadata === "object"
        ? notif.metadata
        : null;
    const metaJobId =
      meta && "jobId" in meta ? String(meta.jobId) : "";
    ok(
      "tailor notified on submit",
      Boolean(notif) && metaJobId === jobId,
      notif ? `metaJobId=${metaJobId}` : "missing"
    );
  }

  // --- Job IDOR ---
  {
    const r = await api(`/api/tailoring-jobs/${jobId}`, { token: tokenOther });
    ok("job IDOR other customer", r.status === 403, `status ${r.status}`);
  }
  {
    const r = await api(`/api/tailoring-jobs/${jobId}`, { token: tokenKai });
    ok("job IDOR other tailor", r.status === 403, `status ${r.status}`);
  }

  // --- Tailor inbox ---
  {
    const r = await api("/api/tailoring-jobs?scope=tailor", {
      token: tokenAda,
    });
    const jobs = r.json?.data?.jobs ?? [];
    const found = jobs.some((j) => j._id === jobId);
    ok(
      "tailor scope lists own job",
      r.status === 200 && found,
      `status ${r.status} found=${found}`
    );
  }

  // --- Invalid transition (customer cannot accept) ---
  {
    const r = await api(`/api/tailoring-jobs/${jobId}`, {
      method: "PATCH",
      token: tokenCustomer,
      body: { status: "accepted" },
    });
    ok(
      "invalid transition rejected",
      r.status === 403,
      `status ${r.status}`
    );
  }

  // --- Tailor accept ---
  {
    const r = await api(`/api/tailoring-jobs/${jobId}`, {
      method: "PATCH",
      token: tokenAda,
      body: { status: "accepted" },
    });
    const job = r.json?.data?.job;
    const hist = job?.statusHistory ?? [];
    ok(
      "tailor accept → accepted",
      r.status === 200 &&
        job?.status === "accepted" &&
        hist.some((h) => h.status === "accepted"),
      `status ${r.status}`
    );
  }

  {
    const notif = await prisma.notification.findFirst({
      where: {
        userId: customer.id,
        title: "Tailor accepted your request",
      },
      orderBy: { createdAt: "desc" },
    });
    ok("customer notified on accept", Boolean(notif), notif ? "found" : "missing");
  }

  // --- Tailor quote → quoted (payment covered in smoke-tailors-phase4.mjs) ---
  {
    const r = await api(`/api/tailoring-jobs/${jobId}`, {
      method: "PATCH",
      token: tokenAda,
      body: { status: "quoted", quotedPrice: 125000 },
    });
    const job = r.json?.data?.job;
    ok(
      "tailor quote → quoted status reachable",
      r.status === 200 &&
        job?.status === "quoted" &&
        job?.quotedPrice === 125000,
      `status ${r.status} quoted=${job?.quotedPrice}`
    );
  }

  {
    const notif = await prisma.notification.findFirst({
      where: {
        userId: customer.id,
        title: "You received a quote",
      },
      orderBy: { createdAt: "desc" },
    });
    ok("customer notified on quote", Boolean(notif), notif ? "found" : "missing");
  }

  // --- Tailor decline (separate job) ---
  let declineJobId = null;
  {
    const created = await api("/api/tailoring-jobs", {
      method: "POST",
      token: tokenCustomer,
      body: {
        tailorSlug: adaProfile.slug,
        measurementProfileId: measureId,
        title: `Smoke P3 Decline ${ts}`,
        description: "decline test",
      },
    });
    declineJobId = created.json?.data?.job?._id;
    const r = await api(`/api/tailoring-jobs/${declineJobId}`, {
      method: "PATCH",
      token: tokenAda,
      body: { status: "cancelled", note: "Cannot take this job" },
    });
    const job = r.json?.data?.job;
    ok(
      "tailor decline → cancelled",
      r.status === 200 &&
        job?.status === "cancelled" &&
        (job?.statusHistory ?? []).some((h) => h.status === "cancelled"),
      `status ${r.status}`
    );
  }

  {
    const notif = await prisma.notification.findFirst({
      where: {
        userId: customer.id,
        title: "Tailoring job cancelled",
      },
      orderBy: { createdAt: "desc" },
    });
    const meta =
      notif?.metadata && typeof notif.metadata === "object"
        ? notif.metadata
        : null;
    const metaJobId =
      meta && "jobId" in meta ? String(meta.jobId) : "";
    ok(
      "customer notified on decline",
      Boolean(notif) && metaJobId === declineJobId,
      notif ? `metaJobId=${metaJobId}` : "missing"
    );
  }

  // --- Cancel before accept (separate job) ---
  let cancelJobId = null;
  {
    const created = await api("/api/tailoring-jobs", {
      method: "POST",
      token: tokenCustomer,
      body: {
        tailorSlug: adaProfile.slug,
        measurementProfileId: measureId,
        title: `Smoke P3 Cancel ${ts}`,
        description: "cancel test",
      },
    });
    cancelJobId = created.json?.data?.job?._id;
    const r = await api(`/api/tailoring-jobs/${cancelJobId}`, {
      method: "PATCH",
      token: tokenCustomer,
      body: { status: "cancelled", note: "Changed mind" },
    });
    ok(
      "customer cancel before accept",
      r.status === 200 && r.json?.data?.job?.status === "cancelled",
      `status ${r.status}`
    );
  }

  {
    const notif = await prisma.notification.findFirst({
      where: {
        userId: adaProfile.userId,
        title: "Tailoring request cancelled",
      },
      orderBy: { createdAt: "desc" },
    });
    const meta =
      notif?.metadata && typeof notif.metadata === "object"
        ? notif.metadata
        : null;
    const metaJobId =
      meta && "jobId" in meta ? String(meta.jobId) : "";
    ok(
      "tailor notified on customer cancel",
      Boolean(notif) && metaJobId === cancelJobId,
      notif ? `metaJobId=${metaJobId}` : "missing"
    );
  }

  // --- Missing measurement on book ---
  {
    const r = await api("/api/tailoring-jobs", {
      method: "POST",
      token: tokenCustomer,
      body: {
        tailorSlug: adaProfile.slug,
        measurementProfileId: "507f1f77bcf86cd799439011",
        title: "Bad measure",
      },
    });
    ok(
      "missing measurement rejected",
      r.status === 400,
      `status ${r.status}`
    );
  }

  // --- Measurement delete blocked when linked to job ---
  {
    const r = await api(`/api/measurement-profiles/${measureId}`, {
      method: "DELETE",
      token: tokenCustomer,
    });
    ok(
      "delete measurement linked to jobs blocked",
      r.status === 400,
      `status ${r.status}`
    );
  }

  // --- Admin oversight read ---
  if (tokenAdmin) {
    const r = await api("/api/admin/tailoring-jobs", { token: tokenAdmin });
    const jobs = r.json?.data?.jobs ?? [];
    ok(
      "admin tailoring-jobs list",
      r.status === 200 && Array.isArray(jobs),
      `status ${r.status} count=${jobs.length}`
    );
    const detail = await api(`/api/admin/tailoring-jobs/${jobId}`, {
      token: tokenAdmin,
    });
    ok(
      "admin job detail read",
      detail.status === 200 && detail.json?.data?.job?.status === "quoted",
      `status ${detail.status}`
    );
  } else {
    ok("admin tailoring-jobs list", false, "no admin user");
    ok("admin job detail read", false, "no admin user");
  }

  // --- Book page auth gate (redirect/manual) ---
  {
    const r = await api(`/tailors/${adaProfile.slug}/book`, {
      redirect: "manual",
    });
    ok(
      "book page loads for guest",
      r.status === 200 || (r.status >= 300 && r.status < 400),
      `status ${r.status}`
    );
  }

  // --- Cleanup ---
  await prisma.tailorReview.deleteMany({
    where: { jobId: { in: [jobId, cancelJobId].filter(Boolean) } },
  });
  await prisma.tailoringJob.deleteMany({
    where: { id: { in: [jobId, cancelJobId, declineJobId].filter(Boolean) } },
  });
  await prisma.measurementProfile.deleteMany({ where: { userId: customer.id } });
  await prisma.notification.deleteMany({
    where: { userId: { in: [customer.id, adaProfile.userId] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [customer.id, otherClient.id] } },
  });
} catch (err) {
  console.error(err);
  ok("phase 3 smoke runner", false, err.message);
}

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass).length;
console.log(`\nPhase 3 smoke: ${passed}/${results.length} passed`);
if (failed > 0) process.exit(1);
await prisma.$disconnect();
