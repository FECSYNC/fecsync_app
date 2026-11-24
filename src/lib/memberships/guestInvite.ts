/**
 * Guest park membership → online account invite / auto-link.
 *
 * Identity rules (conflict-safe):
 * - GuestProfile = park CRM hub; User (client) = online login.
 * - Link is GuestProfile.userId only — never staff Membership seats.
 * - Never reopen /signup. Invite-only User create when email has no account.
 * - Auto-map existing customers by email match.
 * - One linked GuestProfile per User per org (fail closed on dual CRM).
 * - Banned guests and accounts linked to another user are refused.
 */
import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import prisma from "@/lib/prisma";
import { requireId, isValidId } from "@/lib/ids";
import { generateUsername } from "@/lib/utils";
import { assertNotBlacklisted } from "@/lib/userBlacklist";
import { getStorefrontOrgId } from "@/lib/org";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import {
  MembershipBillingError,
  MembershipErrorCodes,
} from "@/lib/memberships/errors";
import {
  sendGuestMembershipCredentialsEmail,
  sendGuestMembershipDashboardInviteEmail,
  sendGuestMembershipLinkedEmail,
} from "@/lib/memberships/mail";
import {
  assertMembershipsStaff,
  assertLocationInMembershipScope,
  type MembershipsActor,
} from "@/lib/memberships/common";
import { assertMembershipsEnabled } from "@/lib/memberships/assert";

const JWT_SECRET = process.env.JWT_SECRET!;
const INVITE_TTL = process.env.GUEST_MEMBERSHIP_INVITE_TTL?.trim() || "7d";
const SITE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"
).replace(/\/$/, "");

export type GuestInviteOutcome =
  | "already_linked"
  | "linked_existing"
  | "created_invite"
  | "synced";

export type GuestInviteResult = {
  outcome: GuestInviteOutcome;
  guestProfileId: string;
  userId: string;
  email: string;
  note: string;
};

type InviteTokenPayload = {
  sub: string;
  email: string;
  guestProfileId: string;
  orgId: string;
  type: "guest_membership_invite";
};

function signGuestMembershipInviteToken(input: {
  userId: string;
  email: string;
  guestProfileId: string;
  orgId: string;
}): string {
  const payload: InviteTokenPayload = {
    sub: input.userId,
    email: input.email,
    guestProfileId: input.guestProfileId,
    orgId: input.orgId,
    type: "guest_membership_invite",
  };
  const options: SignOptions = {
    expiresIn: INVITE_TTL as SignOptions["expiresIn"],
  };
  return jwt.sign(payload, JWT_SECRET, options);
}

export function verifyGuestMembershipInviteToken(
  token: string
): InviteTokenPayload {
  const decoded = jwt.verify(token, JWT_SECRET);
  if (
    typeof decoded !== "object" ||
    !decoded ||
    (decoded as { type?: string }).type !== "guest_membership_invite"
  ) {
    throw new Error("Invalid invite token");
  }
  const p = decoded as InviteTokenPayload;
  if (!p.sub || !p.email || !p.guestProfileId || !p.orgId) {
    throw new Error("Invalid invite token");
  }
  return p;
}

function dashboardUrl(): string {
  return `${SITE_URL}/profile?tab=memberships`;
}

function activateUrl(token: string): string {
  return `${SITE_URL}/memberships/activate?token=${encodeURIComponent(token)}`;
}

/**
 * Link unlinked GuestProfiles whose email matches the signed-in customer.
 * Called when opening Profile → Memberships so existing shop accounts sync
 * without a manual guestProfileId paste.
 */
export async function syncGuestProfilesForUser(userId: string): Promise<{
  linkedIds: string[];
  skippedConflicts: number;
}> {
  const uid = requireId(userId, "userId");
  const user = await prisma.user.findFirst({
    where: { id: uid, accountDeleted: false },
    select: { id: true, email: true },
  });
  if (!user?.email?.trim()) {
    return { linkedIds: [], skippedConflicts: 0 };
  }
  const emailNorm = user.email.trim().toLowerCase();

  const candidates = await prisma.guestProfile.findMany({
    where: {
      userId: null,
      bannedAt: null,
      email: { equals: emailNorm, mode: "insensitive" },
    },
    select: { id: true, orgId: true },
    take: 50,
  });

  const linkedIds: string[] = [];
  let skippedConflicts = 0;

  for (const guest of candidates) {
    try {
      await assertMembershipsEnabled(guest.orgId);
    } catch {
      skippedConflicts += 1;
      continue;
    }

    const alreadyInOrg = await prisma.guestProfile.findFirst({
      where: { orgId: guest.orgId, userId: uid },
      select: { id: true },
    });
    if (alreadyInOrg) {
      skippedConflicts += 1;
      continue;
    }

    const claimed = await prisma.guestProfile.updateMany({
      where: { id: guest.id, orgId: guest.orgId, userId: null, bannedAt: null },
      data: { userId: uid },
    });
    if (claimed.count === 1) {
      linkedIds.push(guest.id);
      logStaffActivityEntry(
        { sub: uid, orgId: guest.orgId },
        {
          action: "memberships.guest.auto_link",
          entityType: "GuestProfile",
          entityId: guest.id,
          description:
            "Auto-linked GuestProfile to existing customer account by email",
        }
      );
    } else {
      skippedConflicts += 1;
    }
  }

  return { linkedIds, skippedConflicts };
}

/**
 * After desk create: if email matches an existing customer, link immediately.
 * Never creates a User (invite path does that). Soft — never throws to callers.
 */
export async function tryAutoLinkGuestProfileByEmail(guestProfileId: string): Promise<{
  linked: boolean;
  userId?: string;
  reason?: string;
}> {
  if (!isValidId(guestProfileId)) {
    return { linked: false, reason: "invalid_id" };
  }
  const guest = await prisma.guestProfile.findFirst({
    where: { id: guestProfileId },
    select: {
      id: true,
      orgId: true,
      email: true,
      userId: true,
      bannedAt: true,
    },
  });
  if (!guest) return { linked: false, reason: "not_found" };
  if (guest.userId) return { linked: true, userId: guest.userId };
  if (guest.bannedAt) return { linked: false, reason: "banned" };
  if (!guest.email?.trim()) return { linked: false, reason: "no_email" };

  const emailNorm = guest.email.trim().toLowerCase();
  const user = await prisma.user.findFirst({
    where: {
      email: emailNorm,
      accountDeleted: false,
      accountSuspended: false,
    },
    select: { id: true, email: true },
  });
  if (!user) return { linked: false, reason: "no_user" };

  const alreadyInOrg = await prisma.guestProfile.findFirst({
    where: { orgId: guest.orgId, userId: user.id },
    select: { id: true },
  });
  if (alreadyInOrg) {
    return { linked: false, reason: "user_already_linked_in_org" };
  }

  const claimed = await prisma.guestProfile.updateMany({
    where: { id: guest.id, orgId: guest.orgId, userId: null, bannedAt: null },
    data: { userId: user.id },
  });
  if (claimed.count !== 1) {
    return { linked: false, reason: "race_conflict" };
  }

  logStaffActivityEntry(
    { sub: user.id, orgId: guest.orgId },
    {
      action: "memberships.guest.auto_link",
      entityType: "GuestProfile",
      entityId: guest.id,
      description: "Desk create auto-linked GuestProfile by email",
    }
  );
  return { linked: true, userId: user.id };
}

async function createInviteOnlyClientUser(input: {
  email: string;
  firstName: string;
  lastName: string;
  /** When set, staff-chosen password (min 8). Otherwise random — guest uses set-password invite. */
  password?: string;
}): Promise<{ id: string; email: string }> {
  const email = input.email.trim().toLowerCase();
  const storefrontOrgId = await getStorefrontOrgId();
  await assertNotBlacklisted(storefrontOrgId, { email });

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, accountDeleted: true },
  });
  if (existing && !existing.accountDeleted) {
    throw new MembershipBillingError(
      MembershipErrorCodes.INVITE_CONFLICT,
      "An account with this email already exists — link instead of create"
    );
  }

  if (input.password != null && input.password.length < 8) {
    throw new MembershipBillingError(
      MembershipErrorCodes.SELF_SERVE_DENIED,
      "Password must be at least 8 characters"
    );
  }

  const joinedAt = new Date();
  const fullName = `${input.firstName} ${input.lastName}`.trim() || email;
  const username = await generateUsername(joinedAt, fullName);
  const plainPassword =
    input.password?.trim() || crypto.randomBytes(32).toString("hex");
  const hashedPassword = await bcrypt.hash(plainPassword, 12);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        firstName: input.firstName.slice(0, 100) || null,
        lastName: input.lastName.slice(0, 100) || null,
        email,
        password: hashedPassword,
        username,
        isVerified: true,
        joinedAt,
        role: "client",
      },
    });
    await tx.profile.create({
      data: {
        userId: created.id,
        firstName: input.firstName.slice(0, 100) || "",
        lastName: input.lastName.slice(0, 100) || "",
      },
    });
    await tx.wallet.create({
      data: { userId: created.id, balance: 0 },
    });
    return created;
  });

  return { id: user.id, email };
}

/**
 * Desk create: provision invite-only client login with a staff-chosen password,
 * link GuestProfile, and optionally email credentials. Never creates a staff seat.
 * Never overwrites an existing account password.
 */
export async function provisionGuestDashboardWithPassword(
  actor: MembershipsActor,
  input: {
    guestProfileId: string;
    password: string;
    sendCredentialsEmail?: boolean;
  }
): Promise<GuestInviteResult> {
  const orgId = await assertMembershipsStaff(actor);
  const guestProfileId = requireId(input.guestProfileId, "guestProfileId");
  const password = input.password?.trim() || "";
  if (password.length < 8) {
    throw new MembershipBillingError(
      MembershipErrorCodes.SELF_SERVE_DENIED,
      "Password must be at least 8 characters"
    );
  }
  const sendEmail = input.sendCredentialsEmail !== false;

  const guest = await prisma.guestProfile.findFirst({
    where: { id: guestProfileId, orgId },
  });
  if (!guest) {
    throw new MembershipBillingError(
      MembershipErrorCodes.GUEST_NOT_FOUND,
      "Guest profile not found"
    );
  }
  if (guest.locationId) {
    await assertLocationInMembershipScope(actor, guest.locationId);
  }
  if (guest.bannedAt) {
    throw new MembershipBillingError(
      MembershipErrorCodes.INVITE_GUEST_BANNED,
      "Banned guests cannot get a dashboard account"
    );
  }
  if (!guest.email?.trim()) {
    throw new MembershipBillingError(
      MembershipErrorCodes.INVITE_EMAIL_REQUIRED,
      "Email is required when setting a dashboard password"
    );
  }
  if (guest.userId) {
    throw new MembershipBillingError(
      MembershipErrorCodes.INVITE_CONFLICT,
      "Guest is already linked — use Invite dashboard to resend access (password is not changed)"
    );
  }

  const emailNorm = guest.email.trim().toLowerCase();
  const existingUser = await prisma.user.findFirst({
    where: { email: emailNorm, accountDeleted: false },
    select: { id: true },
  });
  if (existingUser) {
    throw new MembershipBillingError(
      MembershipErrorCodes.INVITE_CONFLICT,
      "An account with this email already exists — leave password blank to auto-link, then use Invite dashboard"
    );
  }

  const created = await createInviteOnlyClientUser({
    email: emailNorm,
    firstName: guest.firstName,
    lastName: guest.lastName,
    password,
  });

  const claimed = await prisma.guestProfile.updateMany({
    where: { id: guest.id, orgId, userId: null, bannedAt: null },
    data: { userId: created.id },
  });
  if (claimed.count !== 1) {
    throw new MembershipBillingError(
      MembershipErrorCodes.INVITE_CONFLICT,
      "Could not link newly created account — guest may already be linked"
    );
  }

  const guestName =
    `${guest.firstName} ${guest.lastName}`.trim() || "Member";
  let emailed = false;
  if (sendEmail) {
    try {
      await sendGuestMembershipCredentialsEmail({
        to: created.email,
        guestName,
        password,
        dashboardUrl: dashboardUrl(),
        signInUrl: `${SITE_URL}/signin`,
      });
      emailed = true;
    } catch (mailErr) {
      console.warn(
        "[memberships/guestInvite] credentials email failed (account already created):",
        mailErr instanceof Error ? mailErr.message : mailErr
      );
    }
  }

  logStaffActivityEntry(actor, {
    action: "memberships.guest.provision_password",
    entityType: "GuestProfile",
    entityId: guest.id,
    description:
      "Created invite-only client account with staff-set password for membership dashboard",
  });

  return {
    outcome: "created_invite",
    guestProfileId: guest.id,
    userId: created.id,
    email: created.email,
    note: !sendEmail
      ? "Online account created with the password you set (email send skipped)"
      : emailed
        ? "Online account created — login details emailed to the member"
        : "Online account created — credentials email could not be sent (tell them the password in person)",
  };
}

/**
 * Staff: invite guest to their membership dashboard.
 * - Existing customer email → link + notify
 * - No account → invite-only client User (no staff seat) + set-password email
 */
export async function inviteGuestToDashboard(
  actor: MembershipsActor,
  input: {
    guestProfileId: string;
    /** When false, only link existing users — never create a User. Default true. */
    createAccountIfMissing?: boolean;
    /** Soft-fail email send errors. Default true. */
    sendEmail?: boolean;
  }
): Promise<GuestInviteResult> {
  const orgId = await assertMembershipsStaff(actor);
  const guestProfileId = requireId(input.guestProfileId, "guestProfileId");
  const createIfMissing = input.createAccountIfMissing !== false;
  const sendEmail = input.sendEmail !== false;

  const guest = await prisma.guestProfile.findFirst({
    where: { id: guestProfileId, orgId },
  });
  if (!guest) {
    throw new MembershipBillingError(
      MembershipErrorCodes.GUEST_NOT_FOUND,
      "Guest profile not found"
    );
  }
  if (guest.locationId) {
    await assertLocationInMembershipScope(actor, guest.locationId);
  }
  if (guest.bannedAt) {
    throw new MembershipBillingError(
      MembershipErrorCodes.INVITE_GUEST_BANNED,
      "Banned guests cannot be invited to the online dashboard"
    );
  }
  if (!guest.email?.trim()) {
    throw new MembershipBillingError(
      MembershipErrorCodes.INVITE_EMAIL_REQUIRED,
      "Guest email is required to invite to the membership dashboard"
    );
  }

  const emailNorm = guest.email.trim().toLowerCase();
  const guestName = `${guest.firstName} ${guest.lastName}`.trim() || "Member";

  const latestMembership = await prisma.guestMembership.findFirst({
    where: { guestProfileId: guest.id, orgId },
    orderBy: { createdAt: "desc" },
    include: { plan: { select: { name: true } } },
  });
  const planName = latestMembership?.plan.name ?? "your membership";

  // Already linked — resend dashboard tip (no password reset unless they ask).
  if (guest.userId) {
    const linkedUser = await prisma.user.findFirst({
      where: { id: guest.userId, accountDeleted: false },
      select: { id: true, email: true },
    });
    if (!linkedUser) {
      throw new MembershipBillingError(
        MembershipErrorCodes.INVITE_CONFLICT,
        "Guest is linked to a missing account — unlink and invite again"
      );
    }
    if (sendEmail && linkedUser.email) {
      await sendGuestMembershipLinkedEmail({
        to: linkedUser.email,
        guestName,
        planName,
        dashboardUrl: dashboardUrl(),
      });
    }
    logStaffActivityEntry(actor, {
      action: "memberships.guest.invite_resend",
      entityType: "GuestProfile",
      entityId: guest.id,
      description: "Resent membership dashboard access email",
    });
    return {
      outcome: "already_linked",
      guestProfileId: guest.id,
      userId: linkedUser.id,
      email: linkedUser.email ?? emailNorm,
      note: "Guest already linked — dashboard access email resent",
    };
  }

  const existingUser = await prisma.user.findFirst({
    where: {
      email: emailNorm,
      accountDeleted: false,
      accountSuspended: false,
    },
    select: { id: true, email: true },
  });

  if (existingUser) {
    const conflict = await prisma.guestProfile.findFirst({
      where: {
        orgId,
        userId: existingUser.id,
        id: { not: guest.id },
      },
      select: { id: true },
    });
    if (conflict) {
      throw new MembershipBillingError(
        MembershipErrorCodes.INVITE_CONFLICT,
        "This customer account is already linked to another guest profile in this company — unlink that profile first to avoid CRM conflicts"
      );
    }

    const claimed = await prisma.guestProfile.updateMany({
      where: { id: guest.id, orgId, userId: null, bannedAt: null },
      data: { userId: existingUser.id },
    });
    if (claimed.count !== 1) {
      throw new MembershipBillingError(
        MembershipErrorCodes.INVITE_CONFLICT,
        "Guest profile was linked by another request — refresh and retry"
      );
    }

    if (sendEmail) {
      await sendGuestMembershipLinkedEmail({
        to: existingUser.email ?? emailNorm,
        guestName,
        planName,
        dashboardUrl: dashboardUrl(),
      });
    }

    logStaffActivityEntry(actor, {
      action: "memberships.guest.invite_link_existing",
      entityType: "GuestProfile",
      entityId: guest.id,
      description: `Linked GuestProfile to existing customer ${existingUser.id}`,
    });

    return {
      outcome: "linked_existing",
      guestProfileId: guest.id,
      userId: existingUser.id,
      email: existingUser.email ?? emailNorm,
      note: "Matched existing customer account by email and linked — they can open Profile → Memberships",
    };
  }

  if (!createIfMissing) {
    throw new MembershipBillingError(
      MembershipErrorCodes.INVITE_EMAIL_REQUIRED,
      "No customer account for this email — enable account create or ask them to register via an invite"
    );
  }

  const created = await createInviteOnlyClientUser({
    email: emailNorm,
    firstName: guest.firstName,
    lastName: guest.lastName,
  });

  const claimed = await prisma.guestProfile.updateMany({
    where: { id: guest.id, orgId, userId: null, bannedAt: null },
    data: { userId: created.id },
  });
  if (claimed.count !== 1) {
    // Compensate orphan user if link raced — keep soft (email unique blocks retry).
    throw new MembershipBillingError(
      MembershipErrorCodes.INVITE_CONFLICT,
      "Could not link newly created account — guest may already be linked"
    );
  }

  const token = signGuestMembershipInviteToken({
    userId: created.id,
    email: created.email,
    guestProfileId: guest.id,
    orgId,
  });

  if (sendEmail) {
    await sendGuestMembershipDashboardInviteEmail({
      to: created.email,
      guestName,
      planName,
      activateUrl: activateUrl(token),
      dashboardUrl: dashboardUrl(),
    });
  }

  logStaffActivityEntry(actor, {
    action: "memberships.guest.invite_create",
    entityType: "GuestProfile",
    entityId: guest.id,
    description: `Created invite-only client account and invited to membership dashboard`,
  });

  return {
    outcome: "created_invite",
    guestProfileId: guest.id,
    userId: created.id,
    email: created.email,
    note: "Created online account and sent set-password invite (not a staff seat)",
  };
}

/**
 * Soft invite after desk sell — never fails the sell.
 * Skips noisy resend when already linked; still links / creates when needed.
 */
export async function softInviteAfterSell(input: {
  actorUserId: string;
  orgId: string;
  guestProfileId: string;
}): Promise<GuestInviteResult | null> {
  try {
    const guest = await prisma.guestProfile.findFirst({
      where: { id: input.guestProfileId, orgId: input.orgId },
      select: { id: true, userId: true, email: true },
    });
    if (!guest?.email?.trim()) return null;
    if (guest.userId) {
      // Already online — ensure link is intact; do not resend on every sell.
      return {
        outcome: "already_linked",
        guestProfileId: guest.id,
        userId: guest.userId,
        email: guest.email.trim().toLowerCase(),
        note: "Guest already has an online membership dashboard",
      };
    }
    // Prefer link-only first; create account only when no customer exists.
    return await inviteGuestToDashboard(
      { sub: input.actorUserId, orgId: input.orgId },
      { guestProfileId: input.guestProfileId, createAccountIfMissing: true }
    );
  } catch (err) {
    console.info(
      "[memberships/guestInvite] soft invite after sell skipped:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Public claim: set password from invite token (invite-only account path).
 */
export async function activateGuestMembershipInvite(input: {
  token: string;
  password: string;
}): Promise<{ userId: string; email: string; dashboardUrl: string }> {
  if (!input.password || input.password.length < 8) {
    throw new MembershipBillingError(
      MembershipErrorCodes.SELF_SERVE_DENIED,
      "Password must be at least 8 characters"
    );
  }

  let payload: InviteTokenPayload;
  try {
    payload = verifyGuestMembershipInviteToken(input.token);
  } catch {
    throw new MembershipBillingError(
      MembershipErrorCodes.SELF_SERVE_DENIED,
      "Invalid or expired invite link"
    );
  }

  const user = await prisma.user.findFirst({
    where: { id: payload.sub, accountDeleted: false },
    select: { id: true, email: true },
  });
  if (!user?.email || user.email.trim().toLowerCase() !== payload.email) {
    throw new MembershipBillingError(
      MembershipErrorCodes.SELF_SERVE_DENIED,
      "Invite account not found"
    );
  }

  const storefrontOrgId = await getStorefrontOrgId();
  await assertNotBlacklisted(storefrontOrgId, { email: user.email });

  const guest = await prisma.guestProfile.findFirst({
    where: { id: payload.guestProfileId, orgId: payload.orgId },
    select: { id: true, userId: true, bannedAt: true },
  });
  if (!guest || guest.bannedAt) {
    throw new MembershipBillingError(
      MembershipErrorCodes.INVITE_GUEST_BANNED,
      "Guest profile is not available"
    );
  }
  if (guest.userId && guest.userId !== user.id) {
    throw new MembershipBillingError(
      MembershipErrorCodes.INVITE_CONFLICT,
      "Guest profile is linked to another account"
    );
  }
  if (!guest.userId) {
    const conflict = await prisma.guestProfile.findFirst({
      where: {
        orgId: payload.orgId,
        userId: user.id,
        id: { not: guest.id },
      },
      select: { id: true },
    });
    if (conflict) {
      throw new MembershipBillingError(
        MembershipErrorCodes.INVITE_CONFLICT,
        "Account already linked to another guest in this company"
      );
    }
    await prisma.guestProfile.updateMany({
      where: { id: guest.id, orgId: payload.orgId, userId: null },
      data: { userId: user.id },
    });
  }

  const hashedPassword = await bcrypt.hash(input.password, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: { password: hashedPassword, isVerified: true },
  });

  return {
    userId: user.id,
    email: user.email,
    dashboardUrl: dashboardUrl(),
  };
}
