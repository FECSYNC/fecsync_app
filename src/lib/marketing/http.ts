import {
  badRequest,
  errorResponse,
  notFound,
  routeErrorResponse,
  serverError,
  authErrorToResponse,
  authAudit,
} from "@/lib/response";
import type { NextRequest } from "next/server";

export function marketingValidationBadRequest(err: unknown) {
  if (err instanceof Error) {
    return badRequest(err.message);
  }
  return null;
}

export function marketingAuthFail(
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

export function marketingFail(
  err: unknown,
  request: NextRequest,
  route: string,
  message: string,
  actor?: { sub?: string; orgId?: string | null }
) {
  const auth = authErrorToResponse(
    err,
    authAudit(request, route, { actorSub: actor?.sub, orgId: actor?.orgId ?? null })
  );
  if (auth) return auth;
  if (err instanceof Error && err.name === "MarketingNotFoundError") {
    return notFound(err.message);
  }
  if (err instanceof Error && err.name === "MarketingConflictError") {
    return errorResponse(err.message, 409);
  }
  const validation = marketingValidationBadRequest(err);
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

export function rejectClientOrgSelectors(request: NextRequest): ReturnType<typeof badRequest> | null {
  const sp = request.nextUrl.searchParams;
  if (
    sp.has("orgId") ||
    sp.has("organizationId") ||
    sp.has("userId") ||
    sp.has("guestProfileId") ||
    sp.has("membershipId")
  ) {
    return badRequest("Unsupported selector in query");
  }
  return null;
}
