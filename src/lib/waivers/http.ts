import { badRequest, routeErrorResponse, serverError, authErrorToResponse, authAudit } from "@/lib/response";
import type { NextRequest } from "next/server";

export function waiverValidationBadRequest(err: unknown) {
  if (err instanceof Error && err.name === "Error") {
    return badRequest(err.message);
  }
  return null;
}

export function waiverAuthFail(
  err: unknown,
  request: NextRequest,
  route: string,
  permission: string
) {
  return (
    authErrorToResponse(err, authAudit(request, route, { permission })) ??
    serverError("Failed to authorize")
  );
}

export function waiverFail(
  err: unknown,
  request: NextRequest,
  route: string,
  message: string,
  actor?: { sub?: string; orgId?: string | null }
) {
  const validation = waiverValidationBadRequest(err);
  if (validation) return validation;
  return routeErrorResponse(
    err,
    message,
    authAudit(request, route, {
      actorSub: actor?.sub,
      orgId: actor?.orgId ?? null,
    })
  );
}
