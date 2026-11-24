/**
 * Structured alternate address for MembershipPlan.alternateAddress (JSON in column).
 * Plain legacy strings are treated as address-only.
 *
 * Shared by admin UI + merchandising write path so FE/BE stay in lockstep.
 */

export type AlternateAddressDetails = {
  name: string;
  address: string;
  website: string;
  email: string;
  contactNumber: string;
};

export const EMPTY_ALTERNATE_ADDRESS = (): AlternateAddressDetails => ({
  name: '',
  address: '',
  website: '',
  email: '',
  contactNumber: '',
});

const ADDRESS_MAX = 128;
const NAME_MAX = 120;
const WEBSITE_MAX = 200;
const EMAIL_MAX = 200;
const PHONE_MAX = 40;

/** Column max (Prisma String? / merchandising). Structured JSON must fit. */
export const ALTERNATE_ADDRESS_COLUMN_MAX = 2000;

export const ALTERNATE_ADDRESS_LIMITS = {
  name: NAME_MAX,
  address: ADDRESS_MAX,
  website: WEBSITE_MAX,
  email: EMAIL_MAX,
  contactNumber: PHONE_MAX,
} as const;

function clip(s: string, max: number): string {
  return s.trim().slice(0, max);
}

/** Soft-normalize website for storage (add https:// when scheme missing). */
export function normalizeWebsite(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t.slice(0, WEBSITE_MAX);
  if (/^\/\//.test(t)) return `https:${t}`.slice(0, WEBSITE_MAX);
  return `https://${t}`.slice(0, WEBSITE_MAX);
}

export function isPlausibleWebsite(raw: string): boolean {
  const t = raw.trim();
  if (!t) return true;
  const normalized = normalizeWebsite(t);
  try {
    const u = new URL(normalized);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    // Require a host with a dot or localhost
    const host = u.hostname;
    return host === 'localhost' || host.includes('.');
  } catch {
    return false;
  }
}

export function parseAlternateAddress(
  raw: string | null | undefined
): AlternateAddressDetails {
  const empty = EMPTY_ALTERNATE_ADDRESS();
  if (!raw || !raw.trim()) return empty;
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    try {
      const o = JSON.parse(trimmed) as Record<string, unknown>;
      if (o && typeof o === 'object' && !Array.isArray(o)) {
        return {
          name: typeof o.name === 'string' ? o.name : '',
          address: typeof o.address === 'string' ? o.address : '',
          website: typeof o.website === 'string' ? o.website : '',
          email: typeof o.email === 'string' ? o.email : '',
          contactNumber:
            typeof o.contactNumber === 'string'
              ? o.contactNumber
              : typeof o.phone === 'string'
                ? o.phone
                : '',
        };
      }
    } catch {
      /* fall through — treat as legacy free text */
    }
  }
  return { ...empty, address: trimmed.slice(0, ADDRESS_MAX) };
}

/** Serialize for MembershipPlan.alternateAddress column (null when empty). */
export function serializeAlternateAddress(
  details: AlternateAddressDetails | null | undefined
): string | null {
  if (!details) return null;
  const name = clip(details.name, NAME_MAX);
  const address = clip(details.address, ADDRESS_MAX);
  const website = normalizeWebsite(details.website);
  const email = clip(details.email, EMAIL_MAX);
  const contactNumber = clip(details.contactNumber, PHONE_MAX);
  if (!name && !address && !website && !email && !contactNumber) return null;
  const json = JSON.stringify({ name, address, website, email, contactNumber });
  if (json.length > ALTERNATE_ADDRESS_COLUMN_MAX) {
    // Defensive — field limits should already keep us under the column max.
    return json.slice(0, ALTERNATE_ADDRESS_COLUMN_MAX);
  }
  return json;
}

export function validateAlternateAddress(
  details: AlternateAddressDetails
): string | null {
  if (!details.name.trim()) return 'Alternate address Name is required';
  if (details.name.trim().length > NAME_MAX) {
    return `Alternate address Name must be at most ${NAME_MAX} characters`;
  }
  if (!details.address.trim()) return 'Alternate address Address is required';
  if (details.address.trim().length > ADDRESS_MAX) {
    return `Alternate address Address must be at most ${ADDRESS_MAX} characters`;
  }
  const email = details.email.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return 'Alternate address Email is not valid';
  }
  if (email.length > EMAIL_MAX) {
    return `Alternate address Email must be at most ${EMAIL_MAX} characters`;
  }
  if (details.website.trim() && !isPlausibleWebsite(details.website)) {
    return 'Alternate address Website is not a valid URL';
  }
  if (details.contactNumber.trim().length > PHONE_MAX) {
    return `Alternate address Contact number must be at most ${PHONE_MAX} characters`;
  }
  return null;
}

/**
 * Write-path sanitizer for MembershipPlan.alternateAddress.
 * Accepts null/empty → null; structured JSON or legacy free-text → validated JSON.
 * Throws Error messages safe for badRequest().
 */
export function sanitizeAlternateAddressForWrite(
  raw: unknown
): string | null {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string') {
    throw new Error('alternateAddress must be a string');
  }
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > ALTERNATE_ADDRESS_COLUMN_MAX) {
    throw new Error(
      `alternateAddress is too long (max ${ALTERNATE_ADDRESS_COLUMN_MAX})`
    );
  }

  const details = parseAlternateAddress(trimmed);
  // Any non-empty payload must include required name + address (ROLLER parity).
  const hasAny =
    Boolean(details.name.trim()) ||
    Boolean(details.address.trim()) ||
    Boolean(details.website.trim()) ||
    Boolean(details.email.trim()) ||
    Boolean(details.contactNumber.trim());
  if (!hasAny) return null;

  const err = validateAlternateAddress(details);
  if (err) throw new Error(err);

  return serializeAlternateAddress(details);
}

/** Build a one-line preview for chips / list rows. */
export function formatAlternateAddressPreview(
  raw: string | null | undefined
): string | null {
  const d = parseAlternateAddress(raw);
  if (!d.name.trim() && !d.address.trim()) return null;
  if (d.name.trim() && d.address.trim()) {
    return `${d.name.trim()} · ${d.address.trim()}`;
  }
  return d.name.trim() || d.address.trim() || null;
}

/** Map a venue row into alternate-address fields (prefill helper). */
export function venueToAlternateAddress(venue: {
  name: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
  franchiseDisplayName?: string | null;
  franchiseSupportPhone?: string | null;
  franchiseSupportEmail?: string | null;
}): AlternateAddressDetails {
  const line = [
    venue.addressLine1,
    venue.addressLine2,
    [venue.city, venue.region].filter(Boolean).join(', '),
    venue.postalCode,
    venue.country,
  ]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
    .join(', ');

  return {
    name: clip(
      (venue.franchiseDisplayName || venue.name || '').trim(),
      NAME_MAX
    ),
    address: clip(line, ADDRESS_MAX),
    website: '',
    email: clip((venue.franchiseSupportEmail || '').trim(), EMAIL_MAX),
    contactNumber: clip(
      (venue.franchiseSupportPhone || '').trim(),
      PHONE_MAX
    ),
  };
}
