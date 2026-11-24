export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, serverError, authErrorToResponse } from "@/lib/response";
import { assertCronBearer } from "@/lib/cronAuth";
import { remindExpiringWaivers } from "@/lib/waivers/remindExpiring";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const denied = assertCronBearer(req);
  if (denied) return denied;
  try {
    await connectDB();
    const summary = await remindExpiringWaivers();
    return ok({ summary });
  } catch (err) {
    console.error("[cron] waivers-remind:", err);
    return authErrorToResponse(err) ?? serverError("Failed to remind expiring waivers");
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
