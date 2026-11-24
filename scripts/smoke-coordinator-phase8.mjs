/**
 * Phase 8 — Campaign coordinator & group invite end-to-end smoke.
 * Usage: node scripts/smoke-coordinator-phase8.mjs
 *
 * Requires: yarn dev on BASE_URL (default http://localhost:3000), seeded tailor (ada-atelier).
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

const FILE_CHECKLIST = [
  ["prisma/schema.prisma", "MODIFY"],
  ["src/lib/measurementCampaigns.shared.ts", "MODIFY"],
  ["src/lib/measurementCampaigns.ts", "MODIFY"],
  ["src/lib/mailer.ts", "MODIFY"],
  ["src/lib/auth/permissions.ts", "MODIFY"],
  ["src/app/api/campaigns/join/[slug]/route.ts", "MODIFY"],
  ["src/app/api/campaigns/my/route.ts", "EXISTS"],
  ["src/app/api/campaigns/my/[participantId]/invitees/route.ts", "CREATE"],
  ["src/app/api/tailor/campaigns/[id]/participants/route.ts", "MODIFY"],
  ["src/services/measurementCampaigns.ts", "MODIFY"],
  ["src/hooks/useMeasurementCampaigns.ts", "MODIFY"],
  ["src/components/Public_C/campaigns/JoinCampaignClient.tsx", "MODIFY"],
  ["src/components/Public_C/campaigns/CampaignJoinHero.tsx", "MODIFY"],
  ["src/components/Protected/profile/campaigns/CustomerCampaignCard.tsx", "MODIFY"],
  ["src/components/Protected/profile/campaigns/CustomerCampaignsSection.tsx", "MODIFY"],
  ["src/components/Protected/profile/campaigns/CoordinatorGroupPanel.tsx", "CREATE"],
  ["src/components/Protected/tailor/CampaignParticipantsModal.tsx", "MODIFY"],
];

const CLIENT_PERMS = [
  "cart:manage_own",
  "orders:create_own",
  "profile:manage_own",
  "measurements:read_own",
  "measurements:write_own",
  "tailoring_jobs:read_own",
  "tailoring_jobs:write_own",
];

const TAILOR_PERMS = [...CLIENT_PERMS, "tailors:write_own"];

const STUB_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const TEST_EMAILS = [
  "alice@test.com",
  "bob@test.com",
  "carol@test.com",
  "direct@test.com",
  "eve@test.com",
];

function actorToken(claims) {
  return jwt.sign(
    {
      type: "access",
      sub: claims.sub,
      email: claims.email,
      role: claims.role ?? "client",
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

function data(res) {
  return res.json?.data ?? res.json;
}

async function waitForServer(maxMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const r = await api("/api/tailors?limit=1");
      if (r.status > 0) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function createVerifiedUser(email, firstName) {
  return prisma.user.upsert({
    where: { email },
    create: {
      email,
      firstName,
      password: "unused",
      role: "client",
      isVerified: true,
      authzVersion: 0,
    },
    update: { isVerified: true, firstName, accountDeleted: false },
  });
}

async function clientToken(user, orgId) {
  return actorToken({
    sub: user.id,
    email: user.email,
    preset: "client",
    permissions: CLIENT_PERMS,
    orgId,
  });
}

async function createProfile(token, userId, label = "QA Profile") {
  const r = await api("/api/measurement-profiles", {
    method: "POST",
    token,
    body: {
      label,
      unit: "cm",
      gender: "female",
      measurements: { bust: 90, waist: 70, hips: 96 },
    },
  });
  if (r.status !== 201) return null;
  const row = await prisma.measurementProfile.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return row ? { _id: row.id, id: row.id } : null;
}

async function joinAndSubmit(slug, token, { inviteToken, groupToken, profileId } = {}) {
  const body = { measurementProfileId: profileId };
  if (inviteToken) body.inviteToken = inviteToken;
  if (groupToken) body.groupToken = groupToken;
  return api(`/api/campaigns/join/${slug}`, {
    method: "POST",
    token,
    body,
  });
}

async function cleanupTestUsers() {
  const users = await prisma.user.findMany({
    where: { email: { in: TEST_EMAILS } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await prisma.campaignParticipant.deleteMany({ where: { userId: { in: ids } } });
    await prisma.measurementProfile.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
}

let campaignId = null;
let slug = null;

async function cleanupCampaign() {
  if (campaignId) {
    await prisma.measurementCampaign.deleteMany({ where: { id: campaignId } });
    campaignId = null;
    slug = null;
  }
}

try {
  // --- File checklist ---
  for (const [rel, action] of FILE_CHECKLIST) {
    const full = path.join(root, rel);
    const exists = fs.existsSync(full);
    ok(`file ${rel} (${action})`, exists, exists ? "" : "missing");
  }

  if (!(await waitForServer())) {
    console.error(`Cannot reach ${BASE} — start yarn dev first.`);
    process.exit(1);
  }
  ok("dev server reachable", true, BASE);

  const org =
    (await prisma.organization.findFirst({ where: { isDefault: true } })) ||
    (await prisma.organization.findFirst());
  if (!org) throw new Error("No organization");

  const adaProfile = await prisma.tailorProfile.findFirst({
    where: { slug: "ada-atelier", status: "approved", orgId: org.id },
    include: { user: true },
  });
  if (!adaProfile?.user) {
    ok("seed tailor ada-atelier", false, "run yarn seed-tailors");
    throw new Error("Missing ada-atelier");
  }
  ok("seed tailor ada-atelier", true);

  const tokenTailor = actorToken({
    sub: adaProfile.userId,
    email: adaProfile.user.email,
    preset: "tailor",
    permissions: TAILOR_PERMS,
    orgId: org.id,
    av: adaProfile.user.authzVersion ?? 0,
  });

  await cleanupTestUsers();
  await cleanupCampaign();

  const ts = Date.now();
  const startDate = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  // --- Tailor: create active campaign with sponsored scans ---
  const createRes = await api("/api/tailor/campaigns", {
    method: "POST",
    token: tokenTailor,
    body: {
      name: `Phase8 QA Campaign ${ts}`,
      category: "Wedding",
      startDate,
      status: "active",
      sponsoredScansPerInvitee: 2,
      logoUrl: "",
      coverImageUrl: "",
    },
  });
  const campaign = data(createRes)?.campaign;
  ok(
    "tailor create active campaign (sponsored scans > 0)",
    createRes.status === 201 && campaign?.slug,
    `status ${createRes.status}${createRes.status !== 201 ? ` ${createRes.text?.slice(0, 120)}` : ""}`
  );
  if (!campaign?.slug) throw new Error("Campaign create failed");
  campaignId = campaign._id ?? campaign.id;
  slug = campaign.slug;

  await prisma.measurementCampaign.update({
    where: { id: campaignId },
    data: { aiCreditsPurchased: 500 },
  });

  // --- Open join link (no params) — before coordinator invite ---
  const openGet = await api(`/api/campaigns/join/${slug}`);
  ok(
    "/join/[slug] without params loads campaign",
    openGet.status === 200 && data(openGet)?.campaign?.slug === slug,
    `status ${openGet.status}`
  );

  const directUser = await createVerifiedUser("direct@test.com", "Direct Dan");
  const tokenDirect = await clientToken(directUser, org.id);
  let directJoin = await api(`/api/campaigns/join/${slug}`, {
    method: "POST",
    token: tokenDirect,
    body: { fullName: "Direct Dan" },
  });
  if (directJoin.status === 404 || directJoin.status >= 500) {
    await new Promise((r) => setTimeout(r, 1500));
    directJoin = await api(`/api/campaigns/join/${slug}`, {
      method: "POST",
      token: tokenDirect,
      body: { fullName: "Direct Dan" },
    });
  }
  ok(
    "open link join (direct participant)",
    directJoin.status === 201,
    `status ${directJoin.status} ${directJoin.text?.slice(0, 120) ?? ""}`
  );

  const directProfile = await createProfile(
    tokenDirect,
    directUser.id,
    "Direct Scan Profile"
  );
  ok("direct participant profile for AI scan", Boolean(directProfile?.id));

  const profileGet = await api(
    `/api/measurement-profiles/${directProfile.id}`,
    { token: tokenDirect }
  );
  ok(
    "direct profile GET by id (ai-scan prerequisite)",
    profileGet.status === 200,
    `status ${profileGet.status} id=${directProfile.id} sub=${directUser.id}`
  );

  const directScansBefore = await prisma.campaignParticipant.findFirst({
    where: { campaignId, userId: directUser.id },
    select: { aiScansUsed: true, aiScansAllocated: true },
  });
  const scanRes = await api(
    `/api/measurement-profiles/${directProfile?.id}/ai-scan`,
    {
      method: "POST",
      token: tokenDirect,
      body: {
        frontImage: STUB_IMAGE,
        backImage: STUB_IMAGE,
        sideImage: STUB_IMAGE,
        campaignSlug: slug,
      },
    }
  );
  const directScansAfter = await prisma.campaignParticipant.findFirst({
    where: { campaignId, userId: directUser.id },
    select: { aiScansUsed: true },
  });
  ok(
    "AI scan with campaign slug deducts quota",
    scanRes.status === 200 &&
      data(scanRes)?.sponsoredScanConsumed === true &&
      (directScansAfter?.aiScansUsed ?? 0) ===
        (directScansBefore?.aiScansUsed ?? 0) + 1,
    `status ${scanRes.status}, used ${directScansBefore?.aiScansUsed} → ${directScansAfter?.aiScansUsed} ${scanRes.text?.slice(0, 100) ?? ""}`
  );

  // --- Tailor: invite Alice as coordinator ---
  const inviteAlice = await api(
    `/api/tailor/campaigns/${campaignId}/participants`,
    {
      method: "POST",
      token: tokenTailor,
      body: {
        action: "invite",
        participants: [
          { fullName: "Alice Coordinator", email: "alice@test.com", role: "coordinator" },
        ],
      },
    }
  );
  ok(
    "tailor invite alice@test.com as coordinator",
    inviteAlice.status === 201 && (data(inviteAlice)?.invited ?? 0) >= 1,
    `status ${inviteAlice.status}`
  );

  const aliceRow = await prisma.campaignParticipant.findFirst({
    where: { campaignId, email: "alice@test.com" },
  });
  ok("alice participant row + invite token", Boolean(aliceRow?.inviteToken));

  // --- Participants list + tree ---
  const listRes = await api(
    `/api/tailor/campaigns/${campaignId}/participants`,
    { token: tokenTailor }
  );
  const participants = data(listRes)?.participants ?? [];
  ok(
    "participants flat list",
    listRes.status === 200 && participants.length >= 2,
    `count ${participants.length}`
  );

  const treeRes = await api(
    `/api/tailor/campaigns/${campaignId}/participants?view=tree`,
    { token: tokenTailor }
  );
  const tree = data(treeRes);
  ok(
    "participants tree view",
    treeRes.status === 200 && Array.isArray(tree?.coordinators),
    `status ${treeRes.status}`
  );

  // --- Export CSV ---
  const exportRes = await fetch(
    `${BASE}/api/tailor/campaigns/${campaignId}/participants/export`,
    { headers: { Cookie: `access-token=${tokenTailor}` } }
  );
  const csv = await exportRes.text();
  ok("export CSV status", exportRes.status === 200, `status ${exportRes.status}`);
  ok("export CSV has Role column", csv.includes("Role"));
  ok("export CSV has Invited by column", csv.includes("Invited by"));
  ok("export CSV has Group label column", csv.includes("Group label"));

  // --- Send reminder ---
  const remindRes = await api(
    `/api/tailor/campaigns/${campaignId}/participants`,
    {
      method: "POST",
      token: tokenTailor,
      body: { action: "remind" },
    }
  );
  ok(
    "send reminder",
    remindRes.status === 200 && typeof data(remindRes)?.reminded === "number",
    `status ${remindRes.status}, reminded ${data(remindRes)?.reminded}`
  );

  // --- Non-coordinator tailor invite (regression) ---
  const inviteEve = await api(
    `/api/tailor/campaigns/${campaignId}/participants`,
    {
      method: "POST",
      token: tokenTailor,
      body: {
        action: "invite",
        participants: [{ fullName: "Eve Direct", email: "eve@test.com" }],
        defaultRole: "direct",
      },
    }
  );
  ok(
    "tailor non-coordinator invite",
    inviteEve.status === 201,
    `status ${inviteEve.status}`
  );

  // --- Alice: sign up, join, submit ---
  const aliceUser = await createVerifiedUser("alice@test.com", "Alice");
  const tokenAlice = await clientToken(aliceUser, org.id);
  const aliceProfile = await createProfile(tokenAlice, aliceUser.id, "Alice Measurements");
  ok("alice measurement profile", Boolean(aliceProfile?.id));

  const aliceJoinOnly = await api(`/api/campaigns/join/${slug}`, {
    method: "POST",
    token: tokenAlice,
    body: {
      fullName: "Alice Coordinator",
      inviteToken: aliceRow.inviteToken,
    },
  });
  ok(
    "alice join (before submit)",
    aliceJoinOnly.status === 201 || aliceJoinOnly.status === 200,
    `status ${aliceJoinOnly.status}`
  );

  const aliceJoin = await joinAndSubmit(slug, tokenAlice, {
    inviteToken: aliceRow.inviteToken,
    profileId: aliceProfile.id,
  });
  ok(
    "alice join + submit measurements",
    aliceJoin.status === 200 && data(aliceJoin)?.completed === true,
    `status ${aliceJoin.status}${aliceJoin.status !== 200 ? ` ${aliceJoin.text?.slice(0, 160)}` : ""}`
  );

  const myAlice = await api("/api/campaigns/my", { token: tokenAlice });
  const aliceParticipation = (data(myAlice)?.participations ?? []).find(
    (p) => p.slug === slug
  );
  ok(
    "alice /api/campaigns/my lists campaign",
    Boolean(aliceParticipation),
    aliceParticipation ? "" : "not found"
  );
  ok(
    "alice canInviteMembers (group manager panel)",
    aliceParticipation?.canInviteMembers === true,
    `canInviteMembers=${aliceParticipation?.canInviteMembers}`
  );

  const aliceParticipantId = aliceParticipation?.participantId;
  const coordGet = await api(
    `/api/campaigns/my/${aliceParticipantId}/invitees`,
    { token: tokenAlice }
  );
  const coordData = data(coordGet);
  ok(
    "alice coordinator invitees + group link",
    coordGet.status === 200 && Boolean(coordData?.groupJoinPath),
    coordData?.groupJoinPath ?? `status ${coordGet.status}`
  );

  const groupToken = coordData?.shareToken;
  const groupJoinPath = coordData?.groupJoinPath;

  // --- §6.4.1: direct participant opening group link keeps direct role ---
  const directGroupJoin = await api(`/api/campaigns/join/${slug}`, {
    method: "POST",
    token: tokenDirect,
    body: { fullName: "Direct Dan", groupToken },
  });
  const directRowAfterGroup = await prisma.campaignParticipant.findFirst({
    where: { campaignId, userId: directUser.id },
    select: { role: true, invitedByParticipantId: true, status: true },
  });
  ok(
    "direct participant group link join (no role change)",
    directGroupJoin.status === 201 &&
      directRowAfterGroup?.role === "direct" &&
      !directRowAfterGroup?.invitedByParticipantId,
    `status ${directGroupJoin.status} role=${directRowAfterGroup?.role} parent=${directRowAfterGroup?.invitedByParticipantId ?? "none"}`
  );

  // --- §6.4.1 regression: expired direct invite + group link still accepts as direct ---
  const eveRow = await prisma.campaignParticipant.findFirst({
    where: { campaignId, email: "eve@test.com" },
    select: { id: true },
  });
  if (eveRow) {
    await prisma.campaignParticipant.update({
      where: { id: eveRow.id },
      data: { inviteExpiresAt: new Date(Date.now() - 86_400_000) },
    });
    const eveUser = await createVerifiedUser("eve@test.com", "Eve Direct");
    const tokenEve = await clientToken(eveUser, org.id);
    const eveGroupJoin = await api(`/api/campaigns/join/${slug}`, {
      method: "POST",
      token: tokenEve,
      body: { fullName: "Eve Direct", groupToken },
    });
    const eveAfter = await prisma.campaignParticipant.findFirst({
      where: { id: eveRow.id },
      select: { role: true, status: true, invitedByParticipantId: true },
    });
    ok(
      "expired direct invite accepts via group link (still direct)",
      eveGroupJoin.status === 201 &&
        eveAfter?.role === "direct" &&
        eveAfter?.status === "accepted" &&
        !eveAfter?.invitedByParticipantId,
      `status ${eveGroupJoin.status} role=${eveAfter?.role} status=${eveAfter?.status}`
    );
  } else {
    ok("expired direct invite accepts via group link (still direct)", false, "eve row missing");
  }

  // --- Alice: invite Bob ---
  const inviteBob = await api(
    `/api/campaigns/my/${aliceParticipantId}/invitees`,
    {
      method: "POST",
      token: tokenAlice,
      body: {
        action: "invite",
        members: [{ fullName: "Bob Member", email: "bob@test.com" }],
      },
    }
  );
  ok(
    "alice invite bob@test.com",
    inviteBob.status === 200 && (data(inviteBob)?.invited ?? 0) >= 1,
    `status ${inviteBob.status}`
  );

  // --- Alice: set group label ---
  const setLabel = await api(
    `/api/campaigns/my/${aliceParticipantId}/invitees`,
    {
      method: "POST",
      token: tokenAlice,
      body: {
        action: "set-group-label",
        coordinatorGroupLabel: "Bridesmaids",
      },
    }
  );
  ok(
    'alice set group label "Bridesmaids"',
    setLabel.status === 200 &&
      data(setLabel)?.coordinatorGroupLabel === "Bridesmaids",
    `status ${setLabel.status}`
  );

  const bobRow = await prisma.campaignParticipant.findFirst({
    where: { campaignId, email: "bob@test.com" },
  });
  ok("bob invite token", Boolean(bobRow?.inviteToken));

  // --- Bob: join + submit ---
  const bobUser = await createVerifiedUser("bob@test.com", "Bob");
  const tokenBob = await clientToken(bobUser, org.id);
  const bobProfile = await createProfile(tokenBob, bobUser.id, "Bob Measurements");
  const bobJoin = await joinAndSubmit(slug, tokenBob, {
    inviteToken: bobRow.inviteToken,
    profileId: bobProfile.id,
  });
  ok(
    "bob individual invite join + submit",
    bobJoin.status === 200 && data(bobJoin)?.completed === true,
    `status ${bobJoin.status}${bobJoin.status !== 200 ? ` ${bobJoin.text?.slice(0, 160)}` : ""}`
  );

  // --- Carol: group link (no pre-invite) ---
  const carolUser = await createVerifiedUser("carol@test.com", "Carol");
  const tokenCarol = await clientToken(carolUser, org.id);
  const carolProfile = await createProfile(tokenCarol, carolUser.id, "Carol Measurements");
  const carolJoin = await joinAndSubmit(slug, tokenCarol, {
    groupToken,
    profileId: carolProfile.id,
  });
  ok(
    "carol group link join + submit",
    carolJoin.status === 200 && data(carolJoin)?.completed === true,
    `status ${carolJoin.status}${carolJoin.status !== 200 ? ` ${carolJoin.text?.slice(0, 160)}` : ""}`
  );

  const myCarol = await api("/api/campaigns/my", { token: tokenCarol });
  const carolParticipation = (data(myCarol)?.participations ?? []).find(
    (p) => p.slug === slug
  );
  ok(
    "carol NOT coordinator (no group panel)",
    carolParticipation?.canInviteMembers === false,
    `canInviteMembers=${carolParticipation?.canInviteMembers}`
  );

  const carolForbidden = await api(
    `/api/campaigns/my/${aliceParticipantId}/invitees`,
    { token: tokenCarol }
  );
  ok(
    "carol blocked from coordinator API",
    carolForbidden.status === 403,
    `status ${carolForbidden.status}`
  );

  // --- Tailor tree verification ---
  const treeFinal = data(
    await api(`/api/tailor/campaigns/${campaignId}/participants?view=tree`, {
      token: tokenTailor,
    })
  );
  const aliceNode = (treeFinal?.coordinators ?? []).find(
    (c) => c.email === "alice@test.com"
  );
  ok("tree: Alice coordinator node", Boolean(aliceNode));
  const inviteeEmails = (aliceNode?.invitees ?? []).map((i) => i.email).sort();
  ok(
    "tree: Alice → Bob, Carol",
    inviteeEmails.includes("bob@test.com") &&
      inviteeEmails.includes("carol@test.com"),
    inviteeEmails.join(", ")
  );
  const directEmails = (treeFinal?.direct ?? []).map((d) => d.email);
  ok(
    "tree: direct participants separate section",
    directEmails.includes("direct@test.com") || directEmails.includes("eve@test.com"),
    directEmails.join(", ")
  );

  // --- Measurement snapshots ---
  const listFinal = data(
    await api(`/api/tailor/campaigns/${campaignId}/participants`, {
      token: tokenTailor,
    })
  )?.participants;
  for (const email of ["alice@test.com", "bob@test.com", "carol@test.com"]) {
    const row = (listFinal ?? []).find((p) => p.email === email);
    ok(
      `measurement snapshot visible: ${email}`,
      row?.status === "completed" &&
        row?.measurementSnapshot &&
        Object.keys(row.measurementSnapshot.measurements ?? {}).length > 0,
      row?.status ?? "missing"
    );
  }

  // --- Pre-migration participant behaves as direct ---
  const legacyRow = await prisma.campaignParticipant.create({
    data: {
      campaignId,
      fullName: "Legacy Direct",
      email: `legacy.${ts}@test.com`,
      channel: "manual",
      status: "accepted",
      role: "direct",
      acceptedAt: new Date(),
    },
  });
  const treeLegacy = data(
    await api(`/api/tailor/campaigns/${campaignId}/participants?view=tree`, {
      token: tokenTailor,
    })
  );
  const legacyInDirect = (treeLegacy?.direct ?? []).some(
    (d) => d._id === legacyRow.id
  );
  ok("pre-migration participant in direct section", legacyInDirect);

  // --- Customer vs tailor routes not crossed ---
  const clientOnTailorApi = await api("/api/tailor/campaigns", {
    token: tokenAlice,
  });
  ok(
    "customer token blocked from tailor campaigns API",
    clientOnTailorApi.status === 403,
    `status ${clientOnTailorApi.status}`
  );

  ok("group join path format", groupJoinPath?.includes(`group=`));

  // --- Summary ---
  const failed = results.filter((r) => !r.pass);
  console.log("\n--- Phase 8 summary ---");
  console.log(`Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`);
  if (failed.length) {
    console.log("\nFailures:");
    for (const f of failed) {
      console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ""}`);
    }
    process.exitCode = 1;
  } else {
    console.log("\nAll Phase 8 checks passed.");
  }
} catch (err) {
  console.error("Smoke aborted:", err);
  process.exitCode = 1;
} finally {
  await cleanupCampaign();
  await cleanupTestUsers();
  await prisma.$disconnect();
}
