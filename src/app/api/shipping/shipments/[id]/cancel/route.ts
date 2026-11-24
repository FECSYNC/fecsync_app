export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import {
  ok,
  badRequest,
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
import { cancelShipmentRecord, isShippingError } from "@/lib/shipping";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/shipping/shipments/[id]/cancel — deliveries:manage (+ CWV own-order) */
export async function POST(request: NextRequest, context: Ctx) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.DeliveriesManage);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "POST /api/shipping/shipments/[id]/cancel", {
          permission: P.DeliveriesManage,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const { id } = await context.params;
    const shipmentId = String(id || "").trim();
    if (!shipmentId) return badRequest("Shipment id is required");

    const shipment = await cancelShipmentRecord(shipmentId, orgId, {
      orderUserId: actorHasCompanyWideView(actor) ? undefined : actor.sub,
    });
    return ok(shipment);
  } catch (err) {
    const authRes = authErrorToResponse(err);
    if (authRes) return authRes;
    if (isShippingError(err)) {
      if (err.code === "shipment_not_found") return notFound(err.message);
      return badRequest(err.message);
    }
    console.error("Cancel shipment error:", err);
    return serverError("Failed to cancel shipment");
  }
}
