export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, serverError, authErrorToResponse } from "@/lib/response";
import { assertCronBearer } from "@/lib/cronAuth";
import { runAllMarketingAutomations } from "@/lib/marketing/automations/runAll";

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const denied = assertCronBearer(req);
  if (denied) return denied;
  try {
    await connectDB();
    const summary = await runAllMarketingAutomations();
    return ok({ summary });
  } catch (err) {
    console.error("[cron] marketing-automations:", err);
    return authErrorToResponse(err) ?? serverError("Failed to run marketing automations");
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
