export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Invite-only membership dashboard activation (set password).
 * Does NOT reopen /signup — token must be a guest_membership_invite JWT.
 */
import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import { activateGuestMembershipInvite } from "@/lib/memberships/guestInvite";
import {
  isMembershipBillingError,
} from "@/lib/memberships/errors";
import { authRateLimited } from "@/lib/rateLimit";
import { isAuthHttpError } from "@/lib/auth/http-error";

export async function POST(req: NextRequest) {
  await connectDB();

  const body = (await req.json().catch(() => null)) as {
    token?: string;
    password?: string;
  } | null;
  if (!body || typeof body.token !== "string" || !body.token.trim()) {
    return NextResponse.json({ message: "Missing invite token" }, { status: 400 });
  }

  const limited = authRateLimited(
    req,
    "memberships-activate",
    8,
    15 * 60 * 1000,
    body.token.slice(0, 24)
  );
  if (limited) return limited;

  try {
    const result = await activateGuestMembershipInvite({
      token: body.token.trim(),
      password: typeof body.password === "string" ? body.password : "",
    });
    return NextResponse.json({
      message: "Password set — sign in to open your membership dashboard",
      email: result.email,
      dashboardUrl: result.dashboardUrl,
    });
  } catch (err) {
    if (isMembershipBillingError(err)) {
      return NextResponse.json({ message: err.message, code: err.code }, { status: 400 });
    }
    if (isAuthHttpError(err) && err.status === 403) {
      return NextResponse.json({ message: err.message }, { status: 403 });
    }
    console.error("[memberships/activate]", err);
    return NextResponse.json(
      { message: "Could not activate membership invite" },
      { status: 500 }
    );
  }
}
