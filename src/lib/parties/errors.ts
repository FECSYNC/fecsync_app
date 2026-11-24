/**
 * Stable party error codes (message === code). Extends ticketing/errors —
 * one TicketingError class, one response mapper.
 */
import { NextResponse } from "next/server";
import {
  TicketingError,
  isTicketingError,
  ticketingErrorToResponse,
  SESSION_SOLD_OUT,
  HOLD_EXPIRED,
  OVERBOOK_FORBIDDEN,
  PAYMENT_INCOMPLETE,
  BOOKING_NOT_FOUND,
  INVALID_STATUS_TRANSITION,
  BOOKING_PAST_LOCKED,
} from "@/lib/ticketing/errors";

export {
  TicketingError,
  isTicketingError,
  ticketingErrorToResponse,
  SESSION_SOLD_OUT,
  HOLD_EXPIRED,
  OVERBOOK_FORBIDDEN,
  PAYMENT_INCOMPLETE,
  BOOKING_NOT_FOUND,
  INVALID_STATUS_TRANSITION,
  BOOKING_PAST_LOCKED,
};

export const PARTY_DEPOSIT_REQUIRED = "PARTY_DEPOSIT_REQUIRED";
export const PARTY_ROOM_CONFLICT = "PARTY_ROOM_CONFLICT";
export const PARTY_GUEST_CAP = "PARTY_GUEST_CAP";
export const PARTY_FOOD_CUTOFF = "PARTY_FOOD_CUTOFF";
export const PARTY_PAST_LOCKED = "PARTY_PAST_LOCKED";
export const PARTY_NOT_FOUND = "PARTY_NOT_FOUND";
export const PARTY_ONLINE_DISABLED = "PARTY_ONLINE_DISABLED";
export const PARTY_INVITE_EXPIRED = "PARTY_INVITE_EXPIRED";
export const PARTY_INVITE_INVALID = "PARTY_INVITE_INVALID";
export const PARTY_PACKAGE_INVALID = "PARTY_PACKAGE_INVALID";
export const PARTY_ROOM_ARCHIVED = "PARTY_ROOM_ARCHIVED";
export const PARTY_GUEST_DUPLICATE_EMAIL = "PARTY_GUEST_DUPLICATE_EMAIL";
export const PARTY_HONOREE_EXISTS = "PARTY_HONOREE_EXISTS";
export const PARTY_COUNTS_INVALID = "PARTY_COUNTS_INVALID";
export const PARTY_MENU_ITEM_INVALID = "PARTY_MENU_ITEM_INVALID";
export const PARTY_HOST_EDIT_DISABLED = "PARTY_HOST_EDIT_DISABLED";
export const PARTY_CANCEL_CUTOFF = "PARTY_CANCEL_CUTOFF";
export const PARTY_OPS_TRANSITION = "PARTY_OPS_TRANSITION";
export const PARTY_NAME_TAKEN = "PARTY_NAME_TAKEN";
export const PARTY_REASON_REQUIRED = "PARTY_REASON_REQUIRED";

/** Field-level validation (package publish, settings). */
export class PartyValidationError extends TicketingError {
  readonly fields: Record<string, string>;

  constructor(code: string, fields: Record<string, string>) {
    super(code, 400);
    this.fields = fields;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isPartyValidationError(err: unknown): err is PartyValidationError {
  return (
    isTicketingError(err) &&
    typeof (err as { fields?: unknown }).fields === "object" &&
    (err as { fields?: unknown }).fields !== null
  );
}

export function partyErrorToResponse(err: unknown): NextResponse | null {
  if (isPartyValidationError(err)) {
    return NextResponse.json(
      { success: false, error: err.code, fields: err.fields },
      { status: 400 }
    );
  }
  return ticketingErrorToResponse(err);
}

export function partyNotFound(): TicketingError {
  return new TicketingError(PARTY_NOT_FOUND, 404);
}
