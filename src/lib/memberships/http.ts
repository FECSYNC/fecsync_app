/**
 * Map MembershipBillingError → HTTP response for admin routes.
 * Module/Demo ForbiddenError and other AuthHttpError fall through to
 * routeErrorResponse (preserves denial audit).
 */
import { NextResponse } from "next/server";
import { badRequest, conflict, forbidden } from "@/lib/response";
import {
  isMembershipBillingError,
  MembershipErrorCodes,
} from "@/lib/memberships/errors";

export function membershipBillingErrorResponse(
  err: unknown
): NextResponse | null {
  if (!isMembershipBillingError(err)) return null;
  if (
    err.code === MembershipErrorCodes.IDEMPOTENCY_CONFLICT ||
    err.code === MembershipErrorCodes.CUSTOM_ID_CONFLICT
  ) {
    return conflict(`${err.code}: ${err.message}`);
  }
  if (
    err.code === MembershipErrorCodes.PLAN_NOT_FOUND ||
    err.code === MembershipErrorCodes.GUEST_NOT_FOUND ||
    err.code === MembershipErrorCodes.MEMBER_NOT_FOUND ||
    err.code === MembershipErrorCodes.VENUE_INVALID ||
    err.code === MembershipErrorCodes.USAGE_EVENT_NOT_FOUND
  ) {
    return forbidden(`${err.code}: ${err.message}`);
  }
  if (
    err.code === MembershipErrorCodes.NOT_LINKED_TO_GUEST ||
    err.code === MembershipErrorCodes.CLICK_TO_CANCEL_DISABLED ||
    err.code === MembershipErrorCodes.SELF_SERVE_DENIED
  ) {
    return forbidden(`${err.code}: ${err.message}`);
  }
  if (
    err.code === MembershipErrorCodes.CANCEL_ALREADY_SCHEDULED ||
    err.code === MembershipErrorCodes.ALTERNATIVE_INVALID ||
    err.code === MembershipErrorCodes.AGREEMENT_REQUIRED
  ) {
    return badRequest(`${err.code}: ${err.message}`);
  }
  return badRequest(`${err.code}: ${err.message}`);
}
