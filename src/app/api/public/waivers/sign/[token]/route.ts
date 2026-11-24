export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import { loadPublicSign, submitPublicSign } from "@/lib/waivers/capture";
import {
  assertPublicJson,
  clientIp,
  publicWaiverError,
  publicWaiverRateLimit,
} from "@/lib/waivers/publicHttp";

type Ctx = { params: Promise<{ token: string }> };

function localeFrom(request: NextRequest): string | null {
  return (
    request.nextUrl.searchParams.get("locale") ||
    request.headers.get("accept-language")?.split(",")[0]?.trim() ||
    null
  );
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const limited = publicWaiverRateLimit(request);
  if (limited) return limited;
  try {
    await connectDB();
    const { token } = await ctx.params;
    const session = await loadPublicSign(token, {
      orgSlug: request.nextUrl.searchParams.get("orgSlug"),
      venueSlug: request.nextUrl.searchParams.get("venueSlug"),
      locale: localeFrom(request),
    });
    return ok(session);
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
    const { token } = await ctx.params;
    const body = await request.json().catch(() => null);
    const receipt = await submitPublicSign(token, body, {
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent") ?? undefined,
      locale: localeFrom(request),
      orgSlug: request.nextUrl.searchParams.get("orgSlug"),
      venueSlug: request.nextUrl.searchParams.get("venueSlug"),
    });
    return ok(receipt);
  } catch (err) {
    return publicWaiverError(err);
  }
}
