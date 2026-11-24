export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from "next/server";
import { appendClearedAuthCookies } from "@/lib/auth/sessionCookies";
import { verifyEmailOtp } from "@/lib/otp";
import { toPublicAuthzFromClaims } from "@/lib/auth/claims";
import { sendWelcomeEmail } from "@/lib/mailer";
import connectDB from "@/lib/db";
import { ensureProfileForUser } from "@/lib/models/Profile";
import { ensureOwnedWallet } from "@/lib/wallet";
import { authRateLimited } from "@/lib/rateLimit";

function clearedAuthCookies(response: NextResponse, req: Request) {
  appendClearedAuthCookies(response, req);
  return response;
}

/**
 * Email OTP verification after signup.
 * Marks the account verified and provisions profile/wallet, but does NOT
 * create a session — the client must sign in on /signin afterward.
 * Any prior auth cookies are cleared so the user is not silently logged in.
 */
export async function POST(req: Request) {
  const body = await req.json();
  const otp = body.otp;
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!email || typeof otp !== "string" || !otp.trim()) {
    return NextResponse.json(
      { success: false, message: "Email and verification code are required" },
      { status: 400 }
    );
  }

  const limited = authRateLimited(req, "verify-otp", 10, 15 * 60 * 1000, email);
  if (limited) return limited;

  try {
    const { user, authz } = await verifyEmailOtp(otp, email);

    await connectDB();

    const profile = await ensureProfileForUser(user.id, {
      firstName: user.firstName || "",
      lastName: user.lastName || "",
    });

    try {
      await ensureOwnedWallet(user.id);
    } catch (walletError) {
      console.error("[auth/verify] wallet provision failed:", walletError);
      // Account is verified; wallet can be created on first login/checkout.
    }

    const welcomeName = user.firstName
      ? user.lastName
        ? `${user.firstName} ${user.lastName}`
        : user.firstName
      : user.username || "";
    try {
      await sendWelcomeEmail(user.email, welcomeName);
    } catch (mailError) {
      console.error("[auth/verify] welcome email failed:", mailError);
    }

    const response = NextResponse.json({
      success: true,
      data: {
        profile: {
          _id: profile.id,
          firstName: profile.firstName || "",
          user: {
            id: user.id,
            _id: user.id,
            username: user.username,
            // Step 7.1: normalized live role (never archived seller).
            role: authz.role,
            email: user.email,
          },
        },
        ...toPublicAuthzFromClaims(authz),
        userId: user.id,
        requiresLogin: true,
      },
    });

    return clearedAuthCookies(response, req);
  } catch (err: unknown) {
    const { isAuthHttpError } = await import("@/lib/auth/http-error");
    if (isAuthHttpError(err)) {
      return NextResponse.json(
        { success: false, message: err.message },
        { status: err.status }
      );
    }
    if (err instanceof Error) {
      return NextResponse.json(
        { success: false, message: err.message },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { success: false, message: "Unknown error" },
      { status: 500 }
    );
  }
}
