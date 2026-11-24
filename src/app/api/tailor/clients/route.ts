import { NextRequest } from "next/server";
import {
  ok,
  created,
  badRequest,
  notFound,
  serverError,
  authErrorToResponse,
  authAudit,
} from "@/lib/response";
import { requireAuthFresh } from "@/lib/middleware/requireAuth";
import { isPlainObject } from "@/lib/catalogWrite";
import { assertActiveTailorProviderAccess } from "@/lib/tailors";
import {
  createTailorClient,
  listTailorClients,
} from "@/lib/measurementCampaigns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/tailor/clients — list tailor's client roster */
export async function GET(req: NextRequest) {
  try {
    const actor = await requireAuthFresh(req);
    const tailor = await assertActiveTailorProviderAccess(actor);
    const page = Number(req.nextUrl.searchParams.get("page") || "1");
    const limit = Number(req.nextUrl.searchParams.get("limit") || "25");
    const result = await listTailorClients(tailor._id, { page, limit });
    return ok(result);
  } catch (err) {
    const authRes = authErrorToResponse(err, authAudit(req, "GET /api/tailor/clients"));
    if (authRes) return authRes;
    const message = err instanceof Error ? err.message : "";
    if (message.includes("not found")) return notFound(message);
    console.error("List tailor clients error:", err);
    return serverError("Failed to list clients");
  }
}

/** POST /api/tailor/clients — add a client */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireAuthFresh(req);
    const tailor = await assertActiveTailorProviderAccess(actor);
    const body = await req.json();
    if (!isPlainObject(body)) return badRequest("Invalid body");
    const client = await createTailorClient(tailor._id, body);
    return created({ client });
  } catch (err) {
    const authRes = authErrorToResponse(err, authAudit(req, "POST /api/tailor/clients"));
    if (authRes) return authRes;
    const message = err instanceof Error ? err.message : "Failed to add client";
    if (
      message.includes("Plan limit reached") ||
      message.includes("Subscribe to a plan before using this feature")
    ) {
      return authErrorToResponse(err) ?? badRequest(message);
    }
    if (message.includes("not found")) return notFound(message);
    if (
      message.includes("limit") ||
      message.includes("required") ||
      message.includes("Invalid") ||
      message.includes("too long") ||
      message.includes("Must")
    ) {
      return badRequest(message);
    }
    console.error("Create tailor client error:", err);
    return serverError("Failed to add client");
  }
}
