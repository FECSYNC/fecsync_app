/**
 * Phase 4 Find-a-Tailor — payments, reviews & settlement smoke.
 * Usage: node scripts/smoke-tailors-phase4.mjs
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
  "reviews:create_own",
];

try {
  const org =
    (await prisma.organization.findFirst({ where: { isDefault: true } })) ||
    (await prisma.organization.findFirst());
  if (!org) throw new Error("No organization");

  const adaProfile = await prisma.tailorProfile.findFirst({
    where: { slug: "ada-atelier", status: "approved", orgId: org.id },
    include: { user: true },
  });
  if (!adaProfile?.user) {
    ok("seed tailor ada", false, "run yarn seed-tailors");
    throw new Error("Missing seed tailor");
  }

  const ts = Date.now();
  const customer = await prisma.user.create({
    data: {
      email: `smoke.p4.${ts}@example.com`,
      username: `smokep4${ts}`,
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

  const tokenAda = actorToken({
    sub: adaProfile.userId,
    email: adaProfile.user.email,
    role: "client",
    preset: "tailor",
    permissions: [...CLIENT_PERMS, "tailors:write_own"],
    orgId: org.id,
    av: adaProfile.user.authzVersion ?? 0,
  });

  const measure = await api("/api/measurement-profiles", {
    method: "POST",
    token: tokenCustomer,
    body: {
      label: "Smoke P4",
      unit: "cm",
      measurements: { chest: 42 },
      isDefault: true,
    },
  });
  const measureId = measure.json?.data?.profile?._id;

  const booked = await api("/api/tailoring-jobs", {
    method: "POST",
    token: tokenCustomer,
    body: {
      tailorSlug: adaProfile.slug,
      measurementProfileId: measureId,
      title: `Smoke P4 Job ${ts}`,
      description: "Phase 4 smoke",
    },
  });
  const jobId = booked.json?.data?.job?._id;

  await api(`/api/tailoring-jobs/${jobId}`, {
    method: "PATCH",
    token: tokenAda,
    body: { status: "accepted" },
  });
  const quoted = await api(`/api/tailoring-jobs/${jobId}`, {
    method: "PATCH",
    token: tokenAda,
    body: { status: "quoted", quotedPrice: 99000 },
  });
  ok(
    "quote → quoted with price",
    quoted.status === 200 && quoted.json?.data?.job?.status === "quoted",
    `status ${quoted.status}`
  );

  {
    const r = await api("/api/payment/tailoring", {
      method: "POST",
      token: tokenCustomer,
      body: { jobId, type: "stripe-gateway" },
    });
    ok(
      "payment initiate on quoted",
      r.status === 200 && Boolean(r.json?.data?.url || r.json?.data?.sessionId),
      `status ${r.status}`
    );
  }

  {
    const r = await api("/api/tailoring-jobs", {
      method: "POST",
      token: tokenCustomer,
      body: {
        tailorSlug: adaProfile.slug,
        measurementProfileId: measureId,
        title: "Bad pay status",
      },
    });
    const badId = r.json?.data?.job?._id;
    const pay = await api("/api/payment/tailoring", {
      method: "POST",
      token: tokenCustomer,
      body: { jobId: badId, type: "stripe-gateway" },
    });
    ok(
      "payment rejected on submitted status",
      pay.status === 400,
      `status ${pay.status}`
    );
    await prisma.tailoringJob.deleteMany({ where: { id: badId } });
  }

  {
    const r = await api("/api/payment/tailoring/cancel", {
      method: "POST",
      token: tokenCustomer,
      body: { jobId },
    });
    const payload = r.json?.data;
    ok(
      "cancel checkout reverts to quoted",
      r.status === 200 &&
        (payload?.status === "quoted" || payload?.reverted === true),
      `status ${r.status}`
    );
  }

  {
    const r = await api("/api/payment/tailoring", {
      method: "POST",
      token: tokenCustomer,
      body: { jobId, type: "stripe-gateway" },
    });
    ok("payment retry after cancel", r.status === 200, `status ${r.status}`);
  }

  {
    const r = await api(`/api/tailoring-jobs/${jobId}`, {
      method: "PATCH",
      token: tokenAda,
      body: { status: "completed" },
    });
    ok(
      "tailor complete without pay blocked",
      r.status === 403,
      `status ${r.status}`
    );
  }

  {
    const r = await api(`/api/tailors/${adaProfile.slug}/reviews`, {
      method: "POST",
      token: tokenCustomer,
      body: { jobId, rating: 5, comment: "Too early" },
    });
    ok(
      "review before complete blocked",
      r.status === 400 || r.status === 404,
      `status ${r.status}`
    );
  }

  const admin = await prisma.user.findFirst({
    where: { role: "admin", accountDeleted: false },
    orderBy: { joinedAt: "asc" },
  });
  let tokenAdmin = null;
  if (admin) {
    const adminMem = await prisma.membership.findFirst({
      where: { userId: admin.id, orgId: org.id, status: "active" },
    });
    tokenAdmin = actorToken({
      sub: admin.id,
      email: admin.email,
      role: "admin",
      preset: adminMem?.rolePreset ?? "platform_admin",
      permissions: ["tailoring_jobs:read", "tailoring_jobs:manage"],
      orgId: org.id,
      av: admin.authzVersion ?? 0,
    });
  }

  if (tokenAdmin) {
    const paid = await api(`/api/admin/tailoring-jobs/${jobId}`, {
      method: "PATCH",
      token: tokenAdmin,
      body: { status: "paid", note: "Smoke ops settlement" },
    });
    ok(
      "admin ops mark paid",
      paid.status === 200 &&
        (paid.json?.data?.job?.status === "in_progress" ||
          paid.json?.data?.job?.status === "paid") &&
        Boolean(paid.json?.data?.job?.paymentReference),
      `status ${paid.status} job=${paid.json?.data?.job?.status}`
    );
  } else {
    ok("admin ops mark paid", false, "no admin user");
  }

  {
    const r = await api(`/api/tailoring-jobs/${jobId}`, {
      method: "PATCH",
      token: tokenAda,
      body: { status: "completed", note: "Smoke complete" },
    });
    ok(
      "tailor mark completed after pay",
      r.status === 200 && r.json?.data?.job?.status === "completed",
      `status ${r.status}`
    );
  }

  {
    const r = await api(`/api/tailors/${adaProfile.slug}/reviews`, {
      method: "POST",
      token: tokenCustomer,
      body: { jobId, rating: 5, comment: "Great work smoke" },
    });
    ok(
      "review after complete",
      r.status === 201 || r.status === 200,
      `status ${r.status}`
    );
  }

  {
    const r = await api(`/api/tailors/${adaProfile.slug}/reviews`, {
      method: "POST",
      token: tokenCustomer,
      body: { jobId, rating: 4 },
    });
    ok(
      "duplicate review blocked",
      r.status === 400 || r.status === 409,
      `status ${r.status}`
    );
  }

  {
    const r = await api(`/api/tailors/${adaProfile.slug}/reviews`);
    ok(
      "public reviews list",
      r.status === 200 && Array.isArray(r.json?.data?.reviews),
      `status ${r.status}`
    );
  }

  const profile = await prisma.tailorProfile.findFirst({
    where: { id: adaProfile.id },
    select: { reviewCount: true, avgRating: true },
  });
  ok(
    "tailor avg rating updated",
    (profile?.reviewCount ?? 0) >= 1 && (profile?.avgRating ?? 0) > 0,
    `count=${profile?.reviewCount} avg=${profile?.avgRating}`
  );

  {
    const r = await api("/api/payment/stripe/create-session", {
      method: "POST",
      body: { orderId: "507f1f77bcf86cd799439011" },
    });
    ok(
      "product stripe checkout auth gate",
      r.status === 401,
      `status ${r.status}`
    );
  }

  if (tokenAdmin) {
    const r = await api(`/api/admin/tailoring-jobs/${jobId}`, {
      token: tokenAdmin,
    });
    const job = r.json?.data?.job;
    ok(
      "admin job detail shows paid/completed job",
      r.status === 200 &&
        (job?.status === "completed" || job?.status === "paid"),
      `status ${r.status} job=${job?.status}`
    );
  } else {
    ok("admin job detail shows paid/completed job", false, "no admin user");
  }

  await prisma.tailorReview.deleteMany({ where: { jobId } });
  await prisma.tailoringJob.deleteMany({ where: { id: jobId } });
  await prisma.measurementProfile.deleteMany({ where: { userId: customer.id } });
  await prisma.notification.deleteMany({
    where: { userId: { in: [customer.id, adaProfile.userId] } },
  });
  await prisma.user.delete({ where: { id: customer.id } });

  const reviews = await prisma.tailorReview.findMany({
    where: { tailorProfileId: adaProfile.id },
    select: { rating: true },
  });
  const reviewCount = reviews.length;
  const avgRating =
    reviewCount === 0
      ? 0
      : Math.round(
          (reviews.reduce((a, r) => a + r.rating, 0) / reviewCount) * 10
        ) / 10;
  await prisma.tailorProfile.update({
    where: { id: adaProfile.id },
    data: { reviewCount, avgRating },
  });
} catch (err) {
  console.error(err);
  ok("phase 4 smoke runner", false, err.message);
}

const passed = results.filter((r) => r.pass).length;
console.log(`\nPhase 4 smoke: ${passed}/${results.length} passed`);
if (results.some((r) => !r.pass)) process.exit(1);
await prisma.$disconnect();
