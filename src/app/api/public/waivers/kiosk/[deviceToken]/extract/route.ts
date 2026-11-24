export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import { extractForKiosk } from "@/lib/waivers/documentExtract";
import {
  assertPublicJson,
  publicWaiverError,
  publicWaiverExtractRateLimit,
} from "@/lib/waivers/publicHttp";

type Ctx = { params: Promise<{ deviceToken: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const limited = publicWaiverExtractRateLimit(request);
  if (limited) return limited;
  const csrf = assertPublicJson(request);
  if (csrf) return csrf;
  try {
    await connectDB();
    const { deviceToken } = await ctx.params;
    const body = await request.json().catch(() => null);
    const result = await extractForKiosk(deviceToken, body);
    return ok(result);
  } catch (err) {
    return publicWaiverError(err);
  }
}
