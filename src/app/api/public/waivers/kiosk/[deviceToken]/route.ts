export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import { loadKiosk, submitKioskSign } from "@/lib/waivers/capture";
import {
  assertPublicJson,
  clientIp,
  publicWaiverError,
  publicWaiverRateLimit,
} from "@/lib/waivers/publicHttp";

type Ctx = { params: Promise<{ deviceToken: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const limited = publicWaiverRateLimit(request);
  if (limited) return limited;
  try {
    await connectDB();
    const { deviceToken } = await ctx.params;
    return ok(await loadKiosk(deviceToken));
  } catch (err) {
    return publicWaiverError(err);
  }
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const limited = publicWaiverRateLimit(request);
  if (limited) return limited;
  const csrf = assertPublicJson(request);
  if (csrf) return csrf;
  try {
    await connectDB();
    const { deviceToken } = await ctx.params;
    const body = await request.json().catch(() => null);
    const result = await submitKioskSign(deviceToken, body, {
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    return ok(result);
  } catch (err) {
    return publicWaiverError(err);
  }
}
