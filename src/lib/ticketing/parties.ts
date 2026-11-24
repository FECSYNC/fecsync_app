/**
 * Compatibility shim — party logic lives in src/lib/parties/**.
 * Keep only re-exports here.
 */
export { getPartyRunSheet, listDailyPartyRunSheets } from "@/lib/parties/runSheet";
export { putPartyRunSheet as patchPartyRunSheet } from "@/lib/parties/runSheet";
export { getPartySummary } from "@/lib/parties/summary";
export { listPartyGuests as getPartyGuests, replacePartyGuestsForStaff as patchPartyGuests } from "@/lib/parties/guests";
export {
  legacyPublicPartyRsvp as publicPartyRsvp,
  createPartyInvitationForStaff as createPartyInvitation,
} from "@/lib/parties/invitations";
export { patchPartyGuestsForOwner } from "@/lib/parties/owner";
