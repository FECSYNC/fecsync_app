export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from "next/server";
import dbConnect from "@/lib/db";
import prisma from "@/lib/prisma";
import { generateOtp } from "@/lib/otp";
import {
  getAdminEmail,
  resendOtpEmail,
  sendAdminVerificationEmail,
} from "@/lib/mailer";
import { getStorefrontOrgId } from "@/lib/org";
import {
  assertNotBlacklisted,
  BLACKLISTED_ACCOUNT_MESSAGE,
  normalizeBlacklistEmail,
} from "@/lib/userBlacklist";
import { isAuthHttpError } from "@/lib/auth/http-error";
import { authRateLimited } from "@/lib/rateLimit";

export async function POST(req: Request) {
  const body = await req.json();
  const email =
    typeof body.email === "string"
      ? normalizeBlacklistEmail(body.email)
      : "";

  if (!email) {
    return NextResponse.json({ message: "Email is required" }, { status: 400 });
  }

  const limited = authRateLimited(req, "resend-otp", 5, 15 * 60 * 1000, email);
  if (limited) return limited;

  await dbConnect();

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    return NextResponse.json({ message: "User not found" }, { status: 404 });
  }

  if (user.isVerified) {
    return NextResponse.json(
      {
        message: "Email already verified. Please log in.",
        alreadyVerified: true,
      },
      { status: 400 }
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

  const otp = generateOtp();

  await prisma.user.update({
    where: { id: user.id },
    data: { verificationCode: otp },
  });

  if (user.role === "admin" && getAdminEmail()) {
    await sendAdminVerificationEmail(user.email, otp);
  } else {
    await resendOtpEmail(email, otp);
  }

  return NextResponse.json(
    { message: "OTP sent successfully" },
    { status: 200 }
  );
}
