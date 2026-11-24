// lib/otp.ts

import dbConnect from "@/lib/db";
import crypto from "crypto";
import prisma from "@/lib/prisma";
import { signAccessToken, signRefreshToken } from "./jwt";
import { resolveAuthzForUser } from "@/lib/membership";
import { recordUserLogin } from "@/lib/audit/sessionAudit";

export function generateOtp(): string {
  return crypto.randomInt(100000, 1000000).toString(); // 6-digit OTP
}

export async function verifyOtpAndGenerateToken(
  otp: string,
  email: string,
  request?: Request
) {
  const { user, authz } = await verifyEmailOtp(otp, email);

  const accessToken = signAccessToken({
    id: user.id,
    email: user.email,
    role: authz.role,
    permissions: authz.permissions,
    orgId: authz.orgId,
    membershipRole: authz.membershipRole,
    preset: authz.preset,
    companyWideView: authz.companyWideView,
    authzVersion: user.authzVersion,
  });

  const { token: refreshToken, jti: newJTI } = signRefreshToken(user.id);

  await prisma.user.update({
    where: { id: user.id },
    data: { refreshTokenJTI: newJTI },
  });

  await recordUserLogin({
    userId: user.id,
    request,
    method: "otp",
    orgId: authz.orgId,
  });

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      phoneNumber: user.phoneNumber,
      joinedAt: user.joinedAt,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      role: authz.role,
    },
    authz,
  };
}

/**
 * Mark email verified via OTP without creating a session.
 * Used after signup so the user can sign in explicitly on /signin.
 */
export async function verifyEmailOtp(otp: string, email: string) {
  await dbConnect();
  const normalizedEmail = email.trim().toLowerCase();
  const row = await prisma.user.findFirst({
    where: {
      verificationCode: otp,
      email: normalizedEmail,
    },
  });

  if (!row) throw new Error("Invalid or expired OTP");

  const { getStorefrontOrgId } = await import("@/lib/org");
  const { assertNotBlacklisted } = await import("@/lib/userBlacklist");
  const orgId = await getStorefrontOrgId();
  await assertNotBlacklisted(orgId, {
    email: row.email,
    phone: row.phoneNumber,
  });

  const user = await prisma.user.update({
    where: { id: row.id },
    data: {
      isVerified: true,
      verificationCode: null,
    },
  });

  const authz = await resolveAuthzForUser(user);

  return {
    user: {
      id: user.id,
      email: user.email,
      phoneNumber: user.phoneNumber,
      joinedAt: user.joinedAt,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      role: authz.role,
      authzVersion:
        typeof user.authzVersion === "number" ? user.authzVersion : 0,
    },
    authz,
  };
}
