export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import dbConnect from "@/lib/db";
import prisma from "@/lib/prisma";
import { requireAuthActiveAccount } from "@/lib/middleware/requireAuth";
import { signAccessToken, signRefreshToken } from "@/lib/jwt";
import { resolveAuthzForUser } from "@/lib/membership";
import { invalidateUserSessions } from "@/lib/memberAdmin";
import { appendAuthSessionCookies } from "@/lib/auth/sessionCookies";
import {
  ok,
  badRequest,
  notFound,
  serverError,
  authErrorToResponse,
} from "@/lib/response";

/**
 * POST /api/auth/change-password — session user only.
 * Requires currentPassword + newPassword. Google-only accounts have no password.
 * Other devices lose their refresh session; this device gets rotated cookies.
 */
export async function POST(req: NextRequest) {
  let actor;
  try {
    actor = await requireAuthActiveAccount(req);
  } catch (err) {
    return authErrorToResponse(err) ?? serverError("Failed to authorize");
  }

  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON");
  }

  const currentPassword =
    typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword =
    typeof body.newPassword === "string" ? body.newPassword : "";

  if (!currentPassword || !newPassword) {
    return badRequest("Current password and new password are required");
  }
  if (newPassword.length < 8) {
    return badRequest("New password must be at least 8 characters");
  }
  if (currentPassword === newPassword) {
    return badRequest("New password must be different from the current password");
  }

  try {
    await dbConnect();
    const user = await prisma.user.findUnique({ where: { id: actor.sub } });
    if (!user) {
      return notFound("User not found");
    }

    if (!user.password) {
      return badRequest(
        "This account uses Google sign-in and has no password to change. Use forgot password only if you add a password later."
      );
    }

    const matches = await bcrypt.compare(currentPassword, user.password);
    if (!matches) {
      return badRequest("Current password is incorrect");
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashed },
    });

    const nextAv = await invalidateUserSessions(user.id);
    const authz = await resolveAuthzForUser(user);
    const accessToken = signAccessToken({
      id: user.id,
      email: user.email,
      role: authz.role,
      permissions: authz.permissions,
      orgId: authz.orgId,
      membershipRole: authz.membershipRole,
      preset: authz.preset,
      companyWideView: authz.companyWideView,
      authzVersion: nextAv,
    });
    const { token: refreshToken, jti } = signRefreshToken(user.id);
    await prisma.user.update({
      where: { id: user.id },
      data: { refreshTokenJTI: jti },
    });

    const response = ok({ message: "Password updated successfully" });
    appendAuthSessionCookies(response, req, { accessToken, refreshToken });
    return response;
  } catch (err) {
    const authRes = authErrorToResponse(err);
    if (authRes) return authRes;
    return serverError(
      err instanceof Error ? err.message : "Failed to change password"
    );
  }
}
