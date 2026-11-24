export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok, created } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { readJsonBody, withPartyStaffRoute } from "@/lib/parties/gate";
import { rejectQueryOrgId } from "@/lib/parties/scope";
import { createParty, listPartiesCore, parseCreatePartyBody } from "@/lib/parties/partyEngine";

export async function GET(request: NextRequest) {
  return withPartyStaffRoute(
    request,
    { route: "GET admin/parties", permission: P.PartiesRead },
    async (ctx) => {
      const sp = request.nextUrl.searchParams;
      rejectQueryOrgId(sp);
      const take = Number(sp.get("take") ?? sp.get("limit") ?? 50);
      const page = Number(sp.get("page") ?? 0);
      const skip = sp.has("skip") ? Number(sp.get("skip")) : page > 0 ? (page - 1) * take : 0;
      return ok(
        await listPartiesCore(ctx, {
          date: sp.get("date"),
          locationId: sp.get("locationId"),
          q: sp.get("q"),
          opsStatus: sp.get("opsStatus"),
          amountDueOnly: sp.get("amountDueOnly") === "1" || sp.get("amountDueOnly") === "true",
          roomResourceId: sp.get("roomResourceId"),
          hostStaffUserId: sp.get("hostStaffUserId"),
          take: Number.isFinite(take) ? take : 50,
          skip: Number.isFinite(skip) ? skip : 0,
        })
      );
    }
  );
}

export async function POST(request: NextRequest) {
  return withPartyStaffRoute(
    request,
    { route: "POST admin/parties", permission: P.PartiesWrite },
    async (ctx) => {
      const body = await readJsonBody(request);
      return created({ party: await createParty(ctx.actor, parseCreatePartyBody(body)) });
    }
  );
}
