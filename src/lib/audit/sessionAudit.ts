/**
 * Login / logout session audit (User stamps + ActivityLog).
 * Do not call on token refresh.
 */

import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import {
  clientIpFromRequest,
  logActivityEntry,
} from "@/lib/audit/activityLog";

export async function recordUserLogin(input: {
  userId: string;
  request?: NextRequest | Request;
  method?: "password" | "google" | "otp";
  /** Primary Membership org when known (login JWT orgId). */
  orgId?: string | null;
}): Promise<void> {
  const id = String(input.userId);
  if (!isValidId(id)) return;

  const ip =
    input.request && "headers" in input.request
      ? clientIpFromRequest(input.request as NextRequest)
      : undefined;

  try {
    await prisma.user.updateMany({
      where: {
        OR: [{ id }, { legacyId: id }],
      },
      data: {
        lastLoginAt: new Date(),
        ...(ip ? { lastLoginIp: ip } : {}),
      },
    });
  } catch (err) {
    console.error("[audit] lastLoginAt write failed:", err);
  }

  logActivityEntry({
    actorSub: id,
    orgId: input.orgId ?? null,
    action: "User Login",
    entityType: "Session",
    entityId: id,
    description: `User signed in${input.method ? ` via ${input.method}` : ""}`,
    request: input.request as NextRequest | undefined,
    metadata: {
      method: input.method ?? null,
      ip: ip ?? null,
    },
  });
}

export async function recordUserLogout(input: {
  userId: string;
  request?: NextRequest | Request;
  orgId?: string | null;
}): Promise<void> {
  const id = String(input.userId);
  if (!isValidId(id)) return;

  try {
    await prisma.user.updateMany({
      where: {
        OR: [{ id }, { legacyId: id }],
      },
      data: { lastLogoutAt: new Date() },
    });
  } catch (err) {
    console.error("[audit] lastLogoutAt write failed:", err);
  }

  logActivityEntry({
    actorSub: id,
    orgId: input.orgId ?? null,
    action: "User Logout",
    entityType: "Session",
    entityId: id,
    description: "User signed out",
    request: input.request as NextRequest | undefined,
  });
}
