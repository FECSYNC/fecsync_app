export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { ok } from "@/lib/response";
import { P } from "@/lib/auth/permissions";
import { withPartyStaffRoute } from "@/lib/parties/gate";
import { getPartySummary, partySummaryCsv, partySummaryHtml } from "@/lib/parties/summary";

type Ctx = { params: Promise<{ bookingId: string }> };

/** ?format=json (default) | csv | html (printable). */
export async function GET(request: NextRequest, ctx: Ctx) {
  return withPartyStaffRoute(
    request,
    { route: "GET party summary", permission: P.PartiesRead },
    async (party) => {
      const { bookingId } = await ctx.params;
      const summary = await getPartySummary(party.actor, bookingId);
      const format = request.nextUrl.searchParams.get("format");
      if (format === "csv") {
        return new NextResponse(partySummaryCsv(summary), {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="party-${summary.publicId}.csv"`,
            "Cache-Control": "no-store",
          },
        });
      }
      if (format === "html") {
        return new NextResponse(partySummaryHtml(summary), {
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        });
      }
      return ok({ summary });
    }
  );
}
