import type { AdmissionProductType, CapacityResourceType } from '@/services/ticketing';
import { formatClockDateTime, formatClockTime } from '@/lib/timeClock';

export const PRODUCT_TYPE_OPTIONS: { value: AdmissionProductType; label: string }[] = [
  { value: 'timed_session', label: 'Timed session' },
  { value: 'day_pass', label: 'Day pass' },
  { value: 'group', label: 'Group' },
  { value: 'camp_event', label: 'Camp / event' },
  { value: 'party_package', label: 'Party package' },
  { value: 'add_on', label: 'Add-on' },
  { value: 'pass', label: 'Pass' },
];

/** Operator guidance shown on create/edit — keeps booking + catalog behavior aligned. */
export const PRODUCT_TYPE_GUIDANCE: Record<
  AdmissionProductType,
  { summary: string; afterCreate: string }
> = {
  timed_session: {
    summary: 'Session-based entry with capacity per time slot.',
    afterCreate:
      'Use the Sessions wizard to name slots (Morning Adventure, etc.) and generate dates. Guests pick a date, then those named times.',
  },
  day_pass: {
    summary: 'Valid for a calendar day at the venue (no time slot required).',
    afterCreate: 'Ready for bookings once published — guests pick a visit date.',
  },
  group: {
    summary: 'Group admission with min/max guest controls.',
    afterCreate:
      'Add sessions if this group product is timed; otherwise guests book by date.',
  },
  camp_event: {
    summary: 'Camp or multi-day event with remaining capacity across dates.',
    afterCreate: 'Create sessions covering the event dates before selling.',
  },
  party_package: {
    summary: 'Party package tied to a room / party room resource and guest cap.',
    afterCreate:
      'Attach sessions for party timeslots so bookings can reserve the room.',
  },
  add_on: {
    summary: 'Upsell item linked to parent products (food, socks, photos, etc.).',
    afterCreate:
      'Link this add-on from parent products; optionally add stock periods.',
  },
  pass: {
    summary: 'Multi-visit credential with optional default expiry days.',
    afterCreate: 'Set expiry if needed, then publish for staff and online sales.',
  },
};

export const COMMON_PRICE_BAND_CODES = [
  'adult',
  'child',
  'infant',
  'senior',
  'group',
] as const;

export const RESOURCE_TYPE_OPTIONS: { value: CapacityResourceType; label: string }[] = [
  { value: 'attraction', label: 'Attraction' },
  { value: 'session', label: 'Session space' },
  { value: 'room', label: 'Room' },
  { value: 'lane', label: 'Lane' },
  { value: 'party_room', label: 'Party room' },
  { value: 'other', label: 'Other' },
];

/** Operator copy — resource type is a space category, not a product type. */
export const RESOURCE_TYPE_GUIDANCE: Record<CapacityResourceType, string> = {
  attraction:
    'A ride, exhibit, or activity area. Optional default space on timed, group, or camp products.',
  session:
    'A named program space (not a timed ticket). Optional default space when the product uses sessions.',
  room:
    'A bookable room. Party packages must use Room or Party room.',
  lane:
    'A split unit of capacity (bowling lane, kart lane, climbing lane). Optional on most products.',
  party_room:
    'A party-specific room. Party packages must use Room or Party room.',
  other:
    'Any other capacity pool you need to attach to a product or session.',
};

export const PARTY_RESOURCE_TYPES: CapacityResourceType[] = [
  'room',
  'party_room',
];

/**
 * How admission product type talks to capacity resources.
 * These are different taxonomies — only party packages filter + require a room.
 */
export type ProductResourceMode = 'required' | 'optional' | 'hidden';

export type ProductResourcePolicy = {
  mode: ProductResourceMode;
  allowedTypes: CapacityResourceType[] | 'all';
  fieldLabel: string;
  placeholder: string;
  /** Under Type on the Basics step */
  typeHint: string;
  /** Under the resource picker on Venue */
  venueHint: string;
};

const OPTIONAL_SLOT_RESOURCE: ProductResourcePolicy = {
  mode: 'optional',
  allowedTypes: 'all',
  fieldLabel: 'Capacity resource (optional)',
  placeholder: 'None — capacity lives on the product / sessions',
  typeHint:
    'You may attach any resource at this venue on the next step (attraction, lane, room, …), or leave it empty.',
  venueHint:
    'Optional. Any resource at this venue is allowed. Grouped by type so you can pick the matching space.',
};

const NO_RESOURCE: ProductResourcePolicy = {
  mode: 'hidden',
  allowedTypes: 'all',
  fieldLabel: 'Capacity resource',
  placeholder: 'None',
  typeHint:
    'This type does not reserve a room or attraction. Skip resource on the Venue step.',
  venueHint: '',
};

export const PRODUCT_RESOURCE_POLICY: Record<
  AdmissionProductType,
  ProductResourcePolicy
> = {
  party_package: {
    mode: 'required',
    allowedTypes: PARTY_RESOURCE_TYPES,
    fieldLabel: 'Party room',
    placeholder: 'Select a room or party room',
    typeHint:
      'On Venue you must pick a Room or Party room. Attractions, lanes, and other types will not appear.',
    venueHint:
      'Party packages only list Room and Party room resources for this venue — that is the space the booking holds.',
  },
  timed_session: OPTIONAL_SLOT_RESOURCE,
  group: OPTIONAL_SLOT_RESOURCE,
  camp_event: OPTIONAL_SLOT_RESOURCE,
  day_pass: NO_RESOURCE,
  pass: NO_RESOURCE,
  add_on: NO_RESOURCE,
};

export function formatResourceType(type: string) {
  return (
    RESOURCE_TYPE_OPTIONS.find((o) => o.value === type)?.label ??
    type.replace(/_/g, ' ')
  );
}

export function filterResourcesForProductType<
  T extends { type: CapacityResourceType },
>(resources: T[], productType: AdmissionProductType): T[] {
  const allowed = PRODUCT_RESOURCE_POLICY[productType].allowedTypes;
  if (allowed === 'all') return resources;
  return resources.filter((r) => allowed.includes(r.type));
}

export function groupResourcesByType<T extends { type: CapacityResourceType }>(
  resources: T[]
): Array<{ type: CapacityResourceType; label: string; items: T[] }> {
  const buckets = new Map<CapacityResourceType, T[]>();
  for (const resource of resources) {
    const list = buckets.get(resource.type) ?? [];
    list.push(resource);
    buckets.set(resource.type, list);
  }
  return RESOURCE_TYPE_OPTIONS.filter((o) => buckets.has(o.value)).map((o) => ({
    type: o.value,
    label: o.label,
    items: buckets.get(o.value) ?? [],
  }));
}

export const fieldClass =
  'w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-900 focus:border-[#D4AF37] focus:outline-none focus:ring-1 focus:ring-[#D4AF37] disabled:opacity-60';

export const btnPrimaryClass =
  'inline-flex items-center justify-center gap-2 rounded-md bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-stone-950 hover:bg-[#c4a030] disabled:opacity-60';

export const btnSecondaryClass =
  'rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-50';

export const btnDangerClass =
  'rounded-md border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100 disabled:opacity-50';

/** Guest + staff slot title: "Morning Adventure (9:00 AM – 10:30 AM)" */
export function formatNamedSlot(
  label: string | null | undefined,
  startsAt: string,
  endsAt?: string | null,
  timeFormat?: string | null
) {
  const startText = formatClockDateTime(startsAt, timeFormat);
  let range = startText;
  if (endsAt) {
    range = `${startText} – ${formatClockTime(endsAt, timeFormat)}`;
  }
  const name = label?.trim();
  return name ? `${name} (${range})` : range;
}

export function formatProductType(type: string) {
  return PRODUCT_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
}

/** Guest-facing origin of a booking — keep labels simple for company staff. */
export const BOOKING_CHANNEL_OPTIONS: { value: string; label: string }[] = [
  { value: 'online', label: 'Online' },
  { value: 'account', label: 'Online (guest account)' },
  { value: 'walk_in', label: 'At venue' },
  { value: 'phone', label: 'Phone (staff)' },
  { value: 'pos', label: 'POS / front desk' },
];

export function formatBookingChannel(channel: string | null | undefined) {
  if (!channel) return '—';
  return BOOKING_CHANNEL_OPTIONS.find((o) => o.value === channel)?.label ?? channel;
}

export function formatMoney(amount: number | null | undefined, currency = 'USD') {
  if (amount == null || !Number.isFinite(amount)) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}
