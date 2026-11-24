/**
 * Shared admin booking route helpers.
 */
import {
  authErrorToResponse,
  authAudit,
  routeErrorResponse,
  badRequest,
  serverError,
} from "@/lib/response";
import { ticketingErrorToResponse } from "@/lib/ticketing/errors";
import type { NextRequest } from "next/server";

export function bookingValidationResponse(err: unknown) {
  const ticketing = ticketingErrorToResponse(err);
  if (ticketing) return ticketing;
  if (err instanceof Error && err.name === "Error") {
    return badRequest(err.message);
  }
  return null;
}

export function bookingRouteCatch(
  err: unknown,
  request: NextRequest,
  route: string,
  actor: { sub?: string; orgId?: string | null } | null,
  fallback: string,
  permission?: string
) {
  const validation = bookingValidationResponse(err);
  if (validation) return validation;
  return routeErrorResponse(
    err,
    fallback,
    authAudit(request, route, {
      actorSub: actor?.sub,
      orgId: actor?.orgId ?? null,
      permission,
    })
  );
}

export {
  authErrorToResponse,
  authAudit,
  serverError,
  badRequest,
};
