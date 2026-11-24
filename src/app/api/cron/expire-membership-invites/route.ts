import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, serverError, authErrorToResponse } from "@/lib/response";
import { assertCronBearer } from "@/lib/cronAuth";
import { expireOverdueMembershipInvites } from "@/lib/membershipInvites";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Daily — revoke overdue membership invites (frees plan seats). */
export async function GET(req: NextRequest) {
  const denied = assertCronBearer(req);
  if (denied) return denied;

  try {
    await connectDB();
    const summary = await expireOverdueMembershipInvites();
    return ok({ summary });
  } catch (err) {
    console.error("[cron] expire-membership-invites:", err);
    return (
      authErrorToResponse(err) ??
      serverError("Failed to expire membership invites")
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
