/**
 * Step 3 — membership invite TTL. Expired invites free plan seats.
 */

import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";

export const MEMBERSHIP_INVITE_EXPIRED_MESSAGE =
  "This invitation has expired. Ask an admin to send a new invite.";

export function membershipInviteTtlDays(): number {
  const raw = Number(process.env.MEMBERSHIP_INVITE_DAYS || "14");
  return Number.isFinite(raw) && raw > 0 ? raw : 14;
}

export function membershipInviteExpiresAt(from: Date = new Date()): Date {
  return new Date(
    from.getTime() + membershipInviteTtlDays() * 24 * 60 * 60 * 1000
  );
}

export function isMembershipInviteExpired(row: {
  status: string;
  inviteExpiresAt?: Date | null;
  createdAt?: Date | null;
  now?: Date;
}): boolean {
  if (row.status !== "invited") return false;
  const now = row.now ?? new Date();
  if (row.inviteExpiresAt != null) {
    return row.inviteExpiresAt.getTime() < now.getTime();
  }
  // Legacy invited rows without a stamp: expire against createdAt + TTL.
  // Missing createdAt → fail closed (treat expired so seats cannot leak forever).
  if (!row.createdAt) return true;
  return membershipInviteExpiresAt(row.createdAt).getTime() <= now.getTime();
}

/**
 * Revoke overdue invited seats (frees members / tailorSeats meters).
 * Optional orgId scopes to one tenant; omit for global cron.
 */
export async function expireOverdueMembershipInvites(input?: {
  orgId?: string;
  now?: Date;
  take?: number;
}): Promise<{ expired: number }> {
  const now = input?.now ?? new Date();
  const take = input?.take ?? 200;
  const orgId = input?.orgId ? requireId(input.orgId, "orgId") : null;
  const legacyCutoff = new Date(
    now.getTime() - membershipInviteTtlDays() * 24 * 60 * 60 * 1000
  );

  const result = await prisma.membership.updateMany({
    where: {
      status: "invited",
      ...(orgId ? { orgId } : {}),
      OR: [
        { inviteExpiresAt: { not: null, lt: now } },
        // Legacy invited+null: treat createdAt older than TTL as expired.
        { inviteExpiresAt: null, createdAt: { lte: legacyCutoff } },
      ],
    },
    data: {
      status: "revoked",
      // Keep inviteExpiresAt for audit; seat no longer burns quota.
    },
  });

  // Bounded note: updateMany has no take; for very large fleets cron runs often.
  void take;
  return { expired: result.count };
}

/** Lazy expire for a single org before members list / invite asserts. */
export async function expireOverdueMembershipInvitesForOrg(
  orgId: string
): Promise<number> {
  const { expired } = await expireOverdueMembershipInvites({ orgId });
  return expired;
}

export async function assertMembershipInviteNotExpired(membership: {
  id: string;
  status: string;
  inviteExpiresAt?: Date | null;
  createdAt?: Date | null;
}): Promise<void> {
  if (!isMembershipInviteExpired(membership)) return;
  // Best-effort revoke so meters free immediately.
  await prisma.membership.updateMany({
    where: { id: membership.id, status: "invited" },
    data: { status: "revoked" },
  });
  const { ForbiddenError } = await import("@/lib/auth/http-error");
  throw new ForbiddenError(MEMBERSHIP_INVITE_EXPIRED_MESSAGE);
}
