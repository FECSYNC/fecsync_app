export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import prisma from "@/lib/prisma";
import dbConnect from "@/lib/db";
import { NextRequest } from "next/server";
import { requireAuthActiveAccount } from "@/lib/middleware/requireAuth";
import { toDbUserRole } from "@/lib/auth/permissions";
import { ok, notFound, badRequest, serverError, authErrorToResponse } from "@/lib/response";
import { getStorefrontOrgId } from "@/lib/org";
import {
  assertNotBlacklisted,
  BLACKLISTED_ACCOUNT_MESSAGE,
} from "@/lib/userBlacklist";
import { isAuthHttpError } from "@/lib/auth/http-error";
import {
  ensureProfileForUser,
  formatProfileForApi,
  loadProfileUser,
  normalizeAddresses,
} from "@/lib/models/Profile";
import type { Prisma } from "@prisma/client";

// PATCH /api/auth/profile — session user only. Never trust body.user.
export async function PATCH(req: NextRequest) {
    let actor;
    try {
        actor = await requireAuthActiveAccount(req);
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    let body: {
        email?: unknown;
        username?: unknown;
        phone?: unknown;
        firstName?: unknown;
        lastName?: unknown;
        bio?: unknown;
        profilePicture?: unknown;
        addresses?: unknown;
        user?: unknown;
    };
    try {
        body = await req.json();
    } catch {
        return badRequest("Invalid JSON");
    }

    // Never trust body.user / body.role / permissions — session sub only.
    // Email is not self-editable (platform admin / users:manage_roles only).
    void body.user;
    void (body as { role?: unknown }).role;
    void (body as { permissions?: unknown }).permissions;
    void (body as { membershipRole?: unknown }).membershipRole;
    if (body.email !== undefined) {
        return badRequest(
            "Email cannot be changed here. Contact a platform admin for account email changes."
        );
    }

    const {
        username,
        phone,
        firstName,
        lastName,
        bio,
        profilePicture,
        addresses,
    } = body;

    try {
        await dbConnect();

        const user = await prisma.user.findUnique({ where: { id: actor.sub } });
        if (!user) {
            return notFound("User or profile not found");
        }

        let profileRow = await ensureProfileForUser(user.id, {
            firstName: user.firstName || "",
            lastName: user.lastName || "",
        });

        const nextPhone =
            phone !== undefined && phone !== ""
                ? String(phone).trim()
                : user.phoneNumber;

        try {
            const orgId = await getStorefrontOrgId();
            await assertNotBlacklisted(orgId, {
                email: user.email,
                phone: nextPhone,
            });
        } catch (err) {
            if (isAuthHttpError(err) && err.status === 403) {
                return authErrorToResponse(err) ?? badRequest(
                    err.message || BLACKLISTED_ACCOUNT_MESSAGE
                );
            }
            throw err;
        }

        const userPatch: {
            username?: string;
            phoneNumber?: string;
            firstName?: string;
            lastName?: string;
        } = {};
        if (username !== undefined && username !== "") userPatch.username = String(username);
        if (phone !== undefined && phone !== "") userPatch.phoneNumber = String(phone);
        if (firstName !== undefined) userPatch.firstName = String(firstName);
        if (lastName !== undefined) userPatch.lastName = String(lastName);

        const updatedUser = Object.keys(userPatch).length
            ? await prisma.user.update({
                where: { id: user.id },
                data: userPatch,
            })
            : user;

        const profilePatch: {
            firstName?: string;
            lastName?: string;
            bio?: string;
            profilePicture?: string;
            addresses?: Prisma.InputJsonValue;
        } = {};
        if (firstName !== undefined) profilePatch.firstName = String(firstName);
        if (lastName !== undefined) profilePatch.lastName = String(lastName);
        if (bio !== undefined) profilePatch.bio = String(bio);
        if (profilePicture !== undefined) profilePatch.profilePicture = String(profilePicture);

        if (Array.isArray(addresses)) {
            if (addresses.length > 2) {
                return badRequest("A maximum of 2 addresses is allowed.");
            }
            const sanitized = normalizeAddresses(addresses);
            const defaultCount = sanitized.filter((a) => a.isDefault).length;
            if (defaultCount > 1) {
                return badRequest("Only one address can be set as default.");
            }
            profilePatch.addresses = sanitized as unknown as Prisma.InputJsonValue;
        }

        profileRow = Object.keys(profilePatch).length
            ? await prisma.profile.update({
                where: { id: profileRow.id },
                data: profilePatch,
            })
            : profileRow;

        const profileUser = await loadProfileUser(updatedUser.id);
        if (!profileUser) {
            return serverError("Unable to load profile user");
        }
        const profile = formatProfileForApi(profileRow, profileUser);

        return ok({
            message: "User and profile updated successfully",
            user: {
                _id: updatedUser.id,
                email: updatedUser.email,
                username: updatedUser.username,
                firstName: updatedUser.firstName,
                lastName: updatedUser.lastName,
                // Step 7.1: normalize archived seller → client; never self-edit role.
                role: toDbUserRole(updatedUser.role),
                isVerified: updatedUser.isVerified,
                phoneNumber: updatedUser.phoneNumber,
            },
            profile,
        });
    } catch (err) {
        const authRes = authErrorToResponse(err);
        if (authRes) return authRes;
        return serverError(err instanceof Error ? err.message : "Failed to update profile");
    }
}
