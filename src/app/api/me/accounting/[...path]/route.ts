export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { handleAccountingMeRequest } from "@/lib/accounting/meHttp";

type Ctx = { params: Promise<{ path: string[] }> };

async function handle(request: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return handleAccountingMeRequest(request, `/api/me/accounting/${path.join("/")}`);
}

export const GET = handle;
