/**
 * Soft account / workspace suspension — never deletes records.
 * Company ops hold uses Organization.status=suspended + subscriptionStatus=ops_hold.
 * Per-user lock uses User.accountSuspended (login + Fresh fail-closed).
 */

import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { ForbiddenError } from "@/lib/auth/http-error";
import { asIdString, requireId, idWhere } from "@/lib/ids";
import { invalidateUserSessions } from "@/lib/memberAdmin";
import { assertStorefrontPlatformAdmin } from "@/lib/companyApproval";
import { getStorefrontOrgId } from "@/lib/org";
import { logPlatformActionOnCompany } from "@/lib/platformCompanyAudit";
import {
  ACCOUNT_SUSPENDED_MESSAGE,
} from "@/lib/accountSuspendMessages";
import type { NormalizedAccessToken } from "@/lib/auth/claims";
import type { NextRequest } from "next/server";

export const LAST_STOREFRONT_ADMIN_SUSPEND_MESSAGE =
  "Cannot suspend the last unsuspended FECSYNC storefront platform_admin";

export {
  ACCOUNT_SUSPENDED_MESSAGE,
  SUSPENDED_DIALOG_MESSAGE,
  isSuspendedAccessMessage,
  isOpsCompanyHold,
} from "@/lib/accountSuspendMessages";

export async function assertUserNotAccountSuspended(
  userId: string | null | undefined
): Promise<void> {
  const id = asIdString(userId);
  if (!id) return;
  const row = await prisma.user.findFirst({
    where: idWhere(id),
    select: { accountSuspended: true },
  });
  if (row?.accountSuspended === true) {
    throw new ForbiddenError(ACCOUNT_SUSPENDED_MESSAGE);
  }
}

export async function findPlatformUsers(input: {
  q: string;
  take?: number;
}): Promise<
  Array<{
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    role: string;
    accountSuspended: boolean;
    accountDeleted: boolean;
    memberships: Array<{
      orgId: string;
      orgName: string;
      rolePreset: string;
      status: string;
    }>;
  }>
> {
  const q = input.q.trim().toLowerCase();
  if (q.length < 2) return [];
  const take = Math.min(Math.max(input.take ?? 20, 1), 50);

  const users = await prisma.user.findMany({
    where: {
      accountDeleted: false,
      OR: [
        { email: { contains: q, mode: "insensitive" } },
        { username: { contains: q, mode: "insensitive" } },
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      accountSuspended: true,
      accountDeleted: true,
      memberships: {
        select: {
          orgId: true,
          rolePreset: true,
          status: true,
          org: { select: { name: true } },
        },
        take: 8,
        orderBy: { createdAt: "asc" },
      },
    },
    take,
    orderBy: { email: "asc" },
  });

  return users.map((u) => ({
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    role: u.role,
    accountSuspended: u.accountSuspended === true,
    accountDeleted: u.accountDeleted === true,
    memberships: u.memberships.map((m) => ({
      orgId: m.orgId,
      orgName: m.org?.name ?? m.orgId,
      rolePreset: m.rolePreset,
      status: m.status,
    })),
  }));
}

export async function opsSetUserAccountSuspended(input: {
  userId: string;
  suspend: boolean;
  actor: NormalizedAccessToken;
  request?: NextRequest;
  reason?: string;
}): Promise<{ id: string; accountSuspended: boolean }> {
  await assertStorefrontPlatformAdmin(input.actor);
  const userId = requireId(input.userId, "userId");
  if (userId === input.actor.sub) {
    throw new ForbiddenError("You cannot suspend your own account");
  }

  const existing = await prisma.user.findFirst({
    where: { ...idWhere(userId), accountDeleted: false },
    select: {
      id: true,
      email: true,
      accountSuspended: true,
      memberships: {
        select: { orgId: true },
        take: 1,
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!existing) {
    throw new ForbiddenError("User not found");
  }

  if (existing.accountSuspended === input.suspend) {
    return { id: existing.id, accountSuspended: existing.accountSuspended };
  }

  const storefrontOrgId = await getStorefrontOrgId();

  // Serializable: concurrent mutual suspend cannot zero out storefront ops.
  const updated = await prisma.$transaction(
    async (tx) => {
      if (input.suspend) {
        const targetIsStorefrontAdmin = await tx.membership.findFirst({
          where: {
            userId: existing.id,
            orgId: storefrontOrgId,
            rolePreset: "platform_admin",
            status: "active",
          },
          select: { id: true },
        });
        if (targetIsStorefrontAdmin) {
          const remainingUnsuspended = await tx.membership.count({
            where: {
              orgId: storefrontOrgId,
              rolePreset: "platform_admin",
              status: "active",
              userId: { not: existing.id },
              user: {
                accountDeleted: false,
                accountSuspended: false,
              },
            },
          });
          if (remainingUnsuspended < 1) {
            throw new ForbiddenError(LAST_STOREFRONT_ADMIN_SUSPEND_MESSAGE);
          }
        }
      }

      return tx.user.update({
        where: { id: existing.id },
        data: { accountSuspended: input.suspend },
        select: { id: true, email: true, accountSuspended: true },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );

  // Unsuspend bumps sessions so JWTs pick up the unlock. Suspend leaves the
  // session so /me can show the lock dialog; Fresh APIs fail-closed on the flag.
  if (!input.suspend) {
    await invalidateUserSessions(updated.id);
  }

  const targetOrgId = existing.memberships[0]?.orgId ?? input.actor.orgId ?? "";
  if (targetOrgId) {
    logPlatformActionOnCompany(input.actor, {
      action: input.suspend ? "User Account Suspended" : "User Account Unsuspended",
      targetOrgId,
      description: input.suspend
        ? `Suspended user account "${updated.email}" (records kept)`
        : `Removed suspension for user account "${updated.email}"`,
      request: input.request,
      metadata: {
        opsKind: "account-suspend",
        targetUserId: updated.id,
        reason: input.reason ?? "ops",
      },
    });
  }

  return { id: updated.id, accountSuspended: updated.accountSuspended === true };
}
