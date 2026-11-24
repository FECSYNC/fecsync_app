export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { created } from "@/lib/response";
import { readJsonBody } from "@/lib/parties/gate";
import { withPublicPartyRoute } from "@/lib/parties/publicRoute";
import { rejectBodyOrgId } from "@/lib/parties/scope";
import { publicPartyCheckout } from "@/lib/parties/publicParties";
import { optionalAuthUserId } from "@/lib/parties/publicAuth";

export async function POST(request: NextRequest) {
  return withPublicPartyRoute(
    request,
    { route: "POST public parties checkout", bucket: "public-parties-checkout", limit: 10 },
    async () => {
      const body = rejectBodyOrgId(await readJsonBody(request));
      const contact = (body.contact && typeof body.contact === "object" ? body.contact : {}) as Record<string, unknown>;
      const addOns = Array.isArray(body.addOns)
        ? body.addOns.map((a) => ({
            productId: String((a as Record<string, unknown>)?.productId ?? ""),
            qty: Number((a as Record<string, unknown>)?.qty ?? 1),
          }))
        : undefined;
      return created(
        await publicPartyCheckout({
          orgSlug: String(body.orgSlug ?? ""),
          venueSlug: String(body.venueSlug ?? ""),
          holdId: typeof body.holdId === "string" ? body.holdId : undefined,
          holdToken: String(body.holdToken ?? ""),
          kidCount: Number(body.kidCount ?? 0),
          adultCount: Number(body.adultCount ?? 0),
          partyName: String(body.partyName ?? ""),
          honoreeName: typeof body.honoreeName === "string" ? body.honoreeName : null,
          honoreeAge: body.honoreeAge == null || body.honoreeAge === "" ? null : Number(body.honoreeAge),
          honoreeBirthDate: typeof body.honoreeBirthDate === "string" ? body.honoreeBirthDate : null,
          contact: {
            name: typeof contact.name === "string" ? contact.name : null,
            email: typeof contact.email === "string" ? contact.email : null,
            phone: typeof contact.phone === "string" ? contact.phone : null,
          },
          addOns,
          payLater: body.payLater === true,
          userId: await optionalAuthUserId(request),
        })
      );
    }
  );
}
