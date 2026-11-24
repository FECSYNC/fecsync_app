export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from "next/server";
import { signResetToken } from "@/lib/jwt";
import prisma from "@/lib/prisma";
import dbConnect from "@/lib/db";
import { sendResetEmail } from "@/lib/mailer";
import { getStorefrontOrgId } from "@/lib/org";
import {
  assertNotBlacklisted,
  BLACKLISTED_ACCOUNT_MESSAGE,
  normalizeBlacklistEmail,
} from "@/lib/userBlacklist";
import { isAuthHttpError } from "@/lib/auth/http-error";
import { authRateLimited } from "@/lib/rateLimit";
import { publicResetLinkBaseUrl } from "@/lib/publicAppBaseUrl";
import { ACCOUNT_SUSPENDED_MESSAGE } from "@/lib/accountSuspendMessages";

export async function POST(req: NextRequest) {
    await dbConnect();
    const body = await req.json();
    const email =
      typeof body.email === "string"
        ? normalizeBlacklistEmail(body.email)
        : "";

    if (!email) {
        return NextResponse.json(
            { message: "Email is required" },
            { status: 400 }
        );
    }

    const limited = authRateLimited(req, "forgot-password", 5, 15 * 60 * 1000, email);
    if (limited) return limited;

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || user.accountDeleted) {
        return NextResponse.json(
            { message: "Account does not exist. Register a company workspace at /register-company." },
            { status: 404 }
        );
    }

    if (user.accountSuspended) {
        return NextResponse.json(
            { message: ACCOUNT_SUSPENDED_MESSAGE },
            { status: 403 }
        );
    }

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

    const urlToken = signResetToken({
        id: user.id,
        email: user.email,
    });
    // Prefer a configured public origin. Missing env must not email
    // "undefined/reset-password" or a production localhost link.
    const base = publicResetLinkBaseUrl();
    if (!base) {
        return NextResponse.json(
            { message: "Password reset is temporarily unavailable. Please try again later." },
            { status: 503 }
        );
    }
    const resetUrl = `${base}/reset-password?token=${encodeURIComponent(urlToken)}`;
    try {
        await sendResetEmail(user.email, resetUrl);
    } catch (mailErr) {
        console.error(
            "[forgot-password] reset email failed:",
            mailErr instanceof Error ? mailErr.message : mailErr
        );
        return NextResponse.json(
            { message: "We could not send the reset email. Please try again shortly." },
            { status: 503 }
        );
    }

    const response = new NextResponse(JSON.stringify({ success: true }), {
        status: 200,
        headers: {
            "Content-Type": "application/json",
        },
    });

    return response;
}
