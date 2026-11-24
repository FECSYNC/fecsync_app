/**
 * Staff create-booking contact rules (walk_in / phone / pos).
 *
 * Public online/account channels stay on bookingEngine’s email-required path.
 * Marketing opt-ins are intentionally absent: no Guest CRM / GuestProfile
 * marketingEmail|marketingSms (or similar) columns exist — do not fake storage.
 *
 * `requireGuestName` (default true) is for the admin Create wizard UX.
 * The shared bookingEngine / POS API pass `requireGuestName: false` so
 * programmatic staff creates stay compatible with pre-upgrade callers/smokes.
 */

export type StaffBookingChannel = "walk_in" | "phone" | "pos";

export type StaffContactInput = {
  channel: StaffBookingChannel;
  holderType: "guest" | "company";
  accountId?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeStaffContact(input: StaffContactInput) {
  return {
    channel: input.channel,
    holderType: input.holderType,
    accountId: input.accountId?.trim() || null,
    name: input.name?.trim() || "",
    email: input.email?.trim() || "",
    phone: input.phone?.trim() || "",
  };
}

/**
 * Returns an error message, or null when valid.
 *
 * Wizard rules (`requireGuestName` true, default):
 * - Company holder + accountId → contact optional (account covers billing).
 * - Guest name required for walk_in / phone / admin POS channel.
 * - If email present, must be a simple valid shape.
 * - Phone channel: email OR phone required.
 * - Walk-in / POS desk: name alone OK at the counter.
 *
 * Engine / POS API (`requireGuestName: false`):
 * - Company holder still needs accountId.
 * - Email format checked when present.
 * - No hard guest-name gate (keeps /api/admin/bookings, /api/pos/bookings,
 *   and smoke createBooking callers compatible).
 */
export function validateStaffBookingContact(
  input: StaffContactInput & { requireGuestName?: boolean }
): string | null {
  const c = normalizeStaffContact(input);
  const requireGuestName = input.requireGuestName !== false;

  if (c.holderType === "company") {
    if (!c.accountId) {
      return "Select a company booking account";
    }
    if (c.email && !EMAIL_RE.test(c.email)) {
      return "Enter a valid contact email";
    }
    return null;
  }

  if (!requireGuestName) {
    if (c.email && !EMAIL_RE.test(c.email)) {
      return "Enter a valid guest email";
    }
    return null;
  }

  if (!c.name) {
    return "Enter the guest’s name";
  }
  if (c.email && !EMAIL_RE.test(c.email)) {
    return "Enter a valid guest email";
  }

  const deskSale = c.channel === "walk_in" || c.channel === "pos";
  if (deskSale) {
    // Desk exception: name is enough to open the sale; contact optional.
    return null;
  }

  // Phone (wizard): need a reachable contact.
  if (!c.email && !c.phone) {
    return "Phone bookings need a guest email or phone number (or pick a company account)";
  }
  return null;
}
