export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import {
  ok,
  notFound,
  serverError,
  authErrorToResponse,
  authAudit,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import {
  requireActorOrgId,
  actorHasCompanyWideView,
} from "@/lib/staffOrg";
import { getShipmentByIdForOrg } from "@/lib/shipping/shipmentsApi";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/shipping/shipments/[id] — deliveries:read, org-scoped (+ CWV own-order) */
export async function GET(request: NextRequest, context: Ctx) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.DeliveriesRead);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "GET /api/shipping/shipments/[id]", {
          permission: P.DeliveriesRead,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const { id } = await context.params;
    const shipment = await getShipmentByIdForOrg(String(id || "").trim(), orgId, {
      orderUserId: actorHasCompanyWideView(actor) ? undefined : actor.sub,
    });
    if (!shipment) return notFound("Shipment not found");
    return ok(shipment);
  } catch (err) {
    const authRes = authErrorToResponse(err);
    if (authRes) return authRes;
    console.error("Get shipment error:", err);
    return serverError("Failed to load shipment");
  }
}
