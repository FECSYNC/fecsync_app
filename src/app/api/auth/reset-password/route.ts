export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// app/api/auth/reset-password/route.ts

import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/db";
import prisma from "@/lib/prisma";
import { verifyResetToken } from "@/lib/jwt";
import bcrypt from "bcryptjs";
import { getStorefrontOrgId } from "@/lib/org";
import {
  assertNotBlacklisted,
  BLACKLISTED_ACCOUNT_MESSAGE,
} from "@/lib/userBlacklist";
import { isAuthHttpError } from "@/lib/auth/http-error";
import { authRateLimited } from "@/lib/rateLimit";
import {
    PASSWORD_TOO_SHORT_MESSAGE,
    passwordMeetsMinLength,
} from "@/lib/passwordPolicy";
import { ACCOUNT_SUSPENDED_MESSAGE } from "@/lib/accountSuspendMessages";

export async function POST(req: NextRequest) {
    await dbConnect();

    const { searchParams } = new URL(req.url);
    const token = searchParams.get("token");

    if (!token) {
        return NextResponse.json({ message: "Missing token" }, { status: 400 });
    }

    let payload;
    try {
        payload = verifyResetToken(token);
    } catch {
        return NextResponse.json({ message: "Invalid or expired token" }, { status: 401 });
    }

    if (!payload?.sub) {
        return NextResponse.json({ message: "Invalid or expired token" }, { status: 401 });
    }

    const { sub } = payload;

    const body = await req.json();
    const { password } = body;

    if (typeof password !== "string" || !passwordMeetsMinLength(password)) {
        return NextResponse.json({ message: PASSWORD_TOO_SHORT_MESSAGE }, { status: 400 });
    }

    const limited = authRateLimited(req, "reset-password", 8, 15 * 60 * 1000, String(sub));
    if (limited) return limited;

    const subject = String(sub);
    // Prefer the primary id. A legacyId match must not win when another row
    // already owns that id, or the email link would change the wrong password.
    let user = await prisma.user.findUnique({ where: { id: subject } });
    if (!user) {
        user = await prisma.user.findFirst({ where: { legacyId: subject } });
    }
    if (!user || user.accountDeleted) {
        return NextResponse.json(
            { message: "This account is no longer available." },
            { status: 403 }
        );
    }
    if (user.accountSuspended) {
        return NextResponse.json(
            { message: ACCOUNT_SUSPENDED_MESSAGE },
            { status: 403 }
        );
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    try {
        const orgId = await getStorefrontOrgId();
        await assertNotBlacklisted(orgId, {
            email: user.email,
            phone: user.phoneNumber,
        });
    } catch (err) {
        if (isAuthHttpError(err) && err.status === 403) {
            return NextResponse.json(
                { message: err.message || BLACKLISTED_ACCOUNT_MESSAGE },
                { status: 403 }
            );
        }
        throw err;
    }

    await prisma.user.update({
        where: { id: user.id },
        data: {
            password: hashedPassword,
            // The reset link was delivered to this inbox, so sign-in must not
            // stop on the unverified gate after the new password is saved.
            isVerified: true,
            verificationCode: null,
        },
    });

    const { invalidateUserSessions } = await import("@/lib/memberAdmin");
    try {
        await invalidateUserSessions(user.id);
    } catch (sessionErr) {
        console.error(
            "[reset-password] session invalidate failed (password already updated):",
            sessionErr instanceof Error ? sessionErr.message : sessionErr
        );
    }

    return NextResponse.json({ message: "Password reset successful" }, { status: 200 });
}
