export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { handleAccountingPublicRequest } from "@/lib/accounting/publicHttp";

type Ctx = { params: Promise<{ path: string[] }> };

async function handle(request: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return handleAccountingPublicRequest(request, `/api/public/accounting/${path.join("/")}`);
}

export const GET = handle;
export const POST = handle;
