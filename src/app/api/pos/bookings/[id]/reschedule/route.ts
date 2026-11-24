export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { handlePosRequest } from "@/lib/pos/http";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return handlePosRequest(request, `/api/pos/bookings/${id}/reschedule`);
}
