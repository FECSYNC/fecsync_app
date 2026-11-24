/**
 * Stable Phase 2 booking error codes (message === code for API clients).
 */
import { conflict, forbidden, badRequest, notFound, gone } from "@/lib/response";
import type { NextResponse } from "next/server";

export const SESSION_SOLD_OUT = "SESSION_SOLD_OUT";
export const HOLD_EXPIRED = "HOLD_EXPIRED";
export const BOOKING_PAST_LOCKED = "BOOKING_PAST_LOCKED";
export const BOOKING_REVIEW_REQUIRED = "BOOKING_REVIEW_REQUIRED";
export const OVERBOOK_FORBIDDEN = "OVERBOOK_FORBIDDEN";
export const PAYMENT_INCOMPLETE = "PAYMENT_INCOMPLETE";
export const GIFT_CARD_INSUFFICIENT = "GIFT_CARD_INSUFFICIENT";
export const INVOICE_NOT_CANCELLABLE = "INVOICE_NOT_CANCELLABLE";
export const TICKET_ID_TAKEN = "TICKET_ID_TAKEN";
export const RESOURCE_CONFLICT = "RESOURCE_CONFLICT";
export const PUBLIC_VENUE_NOT_PUBLISHED = "PUBLIC_VENUE_NOT_PUBLISHED";
export const BOOKING_NOT_FOUND = "BOOKING_NOT_FOUND";
export const INVALID_STATUS_TRANSITION = "INVALID_STATUS_TRANSITION";
export const REDEEMED_QTY_LOCKED = "REDEEMED_QTY_LOCKED";
export const PAYMENT_EXCEEDS_DUE = "PAYMENT_EXCEEDS_DUE";
export const CHECKOUT_HOLD_MISMATCH = "CHECKOUT_HOLD_MISMATCH";
export const CANCEL_CUTOFF_PASSED = "CANCEL_CUTOFF_PASSED";

export class TicketingError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409 | 410;

  constructor(
    code: string,
    status: 400 | 403 | 404 | 409 | 410 = 400
  ) {
    super(code);
    this.name = "TicketingError";
    this.code = code;
    this.status = status;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isTicketingError(err: unknown): err is TicketingError {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: string }).name === "TicketingError" &&
    typeof (err as { code?: unknown }).code === "string"
  );
}

export function ticketingErrorToResponse(err: unknown): NextResponse | null {
  if (!isTicketingError(err)) return null;
  switch (err.status) {
    case 403:
      return forbidden(err.code);
    case 404:
      return notFound(err.code);
    case 409:
      return conflict(err.code);
    case 410:
      return gone(err.code);
    default:
      return badRequest(err.code);
  }
}
