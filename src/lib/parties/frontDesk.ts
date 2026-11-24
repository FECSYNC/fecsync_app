/**
 * Front desk "today's parties" for the POS PARTY action. Same query as
 * GET /api/admin/parties?date=today (listPartiesCore).
 */
import { partyStaffContext, type PartyActor } from "@/lib/parties/gate";
import { listPartiesCore } from "@/lib/parties/partyEngine";

export async function getTodayParties(
  actor: PartyActor,
  opts: { locationId?: string | null; date?: string | null } = {}
) {
  const ctx = await partyStaffContext(actor);
  return listPartiesCore(ctx, {
    date: opts.date?.trim() || "today",
    locationId: opts.locationId,
    take: 200,
  });
}
