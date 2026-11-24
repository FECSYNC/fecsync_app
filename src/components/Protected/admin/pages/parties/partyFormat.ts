/** Shared party display helpers (admin + public party screens). */

const PARTY_ERROR_MESSAGES: Record<string, string> = {
  PARTY_DEPOSIT_REQUIRED: 'The deposit must be paid before this party can be confirmed.',
  PARTY_ROOM_CONFLICT: 'That room is already booked for an overlapping party.',
  PARTY_GUEST_CAP: 'The guest list is full for these counts. Increase the kid or adult count first.',
  PARTY_FOOD_CUTOFF: 'Food is past the kitchen cutoff. Add an override reason to submit anyway.',
  PARTY_PAST_LOCKED: 'This party has already started, so it can no longer be edited.',
  PARTY_NOT_FOUND: 'Party not found.',
  PARTY_ONLINE_DISABLED: 'Online party booking is turned off for this venue.',
  PARTY_INVITE_EXPIRED: 'This invitation is closed (it expired or the party was cancelled).',
  PARTY_INVITE_INVALID: 'This invitation link is not valid.',
  PARTY_PACKAGE_INVALID: 'This package is not ready to book. Check it is published and fully set up.',
  PARTY_ROOM_ARCHIVED: 'That room is archived and cannot be assigned.',
  PARTY_GUEST_DUPLICATE_EMAIL: 'Another guest on this party already uses that email.',
  PARTY_HONOREE_EXISTS: 'This party already has a guest of honor.',
  PARTY_COUNTS_INVALID: 'Guest counts are outside what this package or room allows.',
  PARTY_MENU_ITEM_INVALID: 'That menu item is not available at this venue.',
  PARTY_HOST_EDIT_DISABLED: 'The venue does not allow hosts to change this.',
  PARTY_CANCEL_CUTOFF: 'It is too close to the party to cancel online. Contact the venue.',
  PARTY_OPS_TRANSITION: 'That status change is not allowed yet (the booking must be confirmed first).',
  PARTY_NAME_TAKEN: 'That name is already used at this venue.',
  PARTY_REASON_REQUIRED: 'A reason is required.',
  SESSION_SOLD_OUT: 'That time slot is sold out.',
  HOLD_EXPIRED: 'The hold expired. Please start again.',
  OVERBOOK_FORBIDDEN: 'You do not have permission to overbook.',
  PAYMENT_INCOMPLETE: 'There is nothing due on this party.',
  INVALID_STATUS_TRANSITION: 'That action is not available for the party’s current status.',
  BOOKING_PAST_LOCKED: 'This party has already started, so it can no longer be edited.',
};

export function partyErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (!raw) return fallback;
  return PARTY_ERROR_MESSAGES[raw] ?? raw;
}

export const OPS_STATUS_LABELS: Record<string, string> = {
  inquiry: 'Inquiry',
  held: 'Held',
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No-show',
};

/** Overlay transitions staff may pick (engine enforces: confirmed booking only, no-show after start). */
export function allowedOpsTransitions(
  bookingStatus: string,
  opsStatus: string,
  visitStartsAt?: string | null
): string[] {
  if (bookingStatus !== 'confirmed') return [];
  const order = ['confirmed', 'checked_in', 'in_progress', 'completed'];
  const out = new Set<string>();
  const i = order.indexOf(opsStatus);
  if (i >= 0 && i < order.length - 1) out.add(order[i + 1]!);
  const started = !visitStartsAt || new Date(visitStartsAt).getTime() <= Date.now();
  if (opsStatus === 'confirmed' && started) out.add('no_show');
  if (opsStatus === 'no_show') out.add('checked_in');
  return [...out];
}

export function centsLabel(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return `$${(Math.round(cents) / 100).toFixed(2)}`;
}

/** PAID when nothing is due, else $X BALANCE. */
export function balanceChip(amountDueCents: number, bookingStatus: string) {
  if (bookingStatus === 'cancelled' || bookingStatus === 'expired') {
    return { label: bookingStatus.toUpperCase(), className: 'bg-stone-100 text-stone-600' };
  }
  if (amountDueCents <= 0) return { label: 'PAID', className: 'bg-emerald-100 text-emerald-900' };
  return { label: `${centsLabel(amountDueCents)} BALANCE`, className: 'bg-amber-100 text-amber-900' };
}

export function formatInZone(
  iso: string | null | undefined,
  timezone: string | null | undefined,
  opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }
): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: timezone || undefined }).format(d);
  } catch {
    return new Intl.DateTimeFormat(undefined, opts).format(d);
  }
}

export function timeInZone(iso: string | null | undefined, timezone: string | null | undefined): string {
  return formatInZone(iso, timezone, { hour: 'numeric', minute: '2-digit' });
}

/** YYYY-MM-DD for "today" in a venue timezone (browser zone when unknown). */
export function todayInZone(timezone?: string | null): string {
  return ymdInZone(new Date().toISOString(), timezone);
}

/** YYYY-MM-DD of an instant in a venue timezone. */
export function ymdInZone(iso: string | null | undefined, timezone?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || undefined,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(Number.isNaN(d.getTime()) ? new Date() : d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Wall-clock "YYYY-MM-DDTHH:mm" in a venue timezone → UTC ISO.
 * Two-pass offset correction keeps DST boundaries correct.
 */
export function zonedLocalToIso(local: string, timezone: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as unknown as number[];
  const wallUtc = Date.UTC(y!, mo! - 1, d!, h!, mi!);
  if (!timezone) return new Date(y!, mo! - 1, d!, h!, mi!).toISOString();
  const offsetAt = (ts: number) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date(ts));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute')) - ts;
  };
  let ts = wallUtc - offsetAt(wallUtc);
  ts = wallUtc - offsetAt(ts);
  return new Date(ts).toISOString();
}

export const GUEST_KIND_LABELS: Record<string, string> = {
  honoree: 'Guest of honor',
  kid: 'Kid',
  adult: 'Adult',
  chaperone: 'Chaperone',
  other: 'Other',
};
