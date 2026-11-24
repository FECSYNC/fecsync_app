import { api, unwrap, type MaybeWrapped } from "@/utils/api";

export const publicPartyKeys = {
  all: ["public", "parties"] as const,
  packages: (orgSlug: string, venueSlug: string) =>
    [...publicPartyKeys.all, "packages", orgSlug, venueSlug] as const,
  availability: (q: { orgSlug: string; venueSlug: string; productId: string; date?: string; kids?: number; adults?: number }) =>
    [...publicPartyKeys.all, "availability", q] as const,
  confirmation: (publicId: string) => [...publicPartyKeys.all, "confirmation", publicId] as const,
  payLink: (token: string) => [...publicPartyKeys.all, "pay", token] as const,
  invite: (token: string) => [...publicPartyKeys.all, "invite", token] as const,
};

export type PublicPartyPackage = {
  id: string;
  name: string;
  description: string | null;
  images: string[];
  minGuests: number | null;
  maxGuests: number | null;
  durationMinutes: number;
  includedKids: number;
  includedAdults: number;
  extraKidPriceCents: number | null;
  extraAdultPriceCents: number | null;
  basePriceCents: number | null;
  includesFood: boolean;
  addOns: Array<{ productId: string; name: string; maxQty: number | null; priceCents: number | null }>;
  depositPreviewCents: number;
};

export type PublicPartyInvitation = {
  partyName: string;
  honoreeName: string | null;
  visitStartsAt: string | null;
  visitEndsAt: string | null;
  timezone: string | null;
  venueName: string | null;
  rsvpStatus: string;
  respondedAt: string | null;
  open: boolean;
  closedReason: string | null;
};

async function call<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const raw = await api<MaybeWrapped<T>>(path, {
    credentials: "include",
    ...rest,
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
  });
  return unwrap(raw) as T;
}

const enc = encodeURIComponent;

export function getPublicPartyPackages(orgSlug: string, venueSlug: string) {
  return call<{
    venue: Record<string, unknown>;
    allowOnlinePartyBooking: boolean;
    allowPayLater: boolean;
    packages: PublicPartyPackage[];
  }>(`/api/public/parties/packages?orgSlug=${enc(orgSlug)}&venueSlug=${enc(venueSlug)}`);
}

export function getPublicPartyAvailability(q: {
  orgSlug: string;
  venueSlug: string;
  productId: string;
  date?: string;
  from?: string;
  to?: string;
  kids?: number;
  adults?: number;
}) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") sp.set(k, String(v));
  return call<{
    productId: string;
    kids: number;
    adults: number;
    countsOk: boolean;
    timezone: string | null;
    sessions: Array<Record<string, unknown> & { id: string; startsAt: string; endsAt: string; bookable: boolean }>;
  }>(`/api/public/parties/availability?${sp.toString()}`);
}

export async function createPublicPartyHold(payload: {
  orgSlug: string;
  venueSlug: string;
  productId: string;
  sessionId: string;
}) {
  return (await call<{ hold: { holdId: string; token: string; expiresAt: string } }>(`/api/public/parties/holds`, {
    method: "POST",
    json: payload,
  })).hold;
}

export function publicPartyCheckout(payload: Record<string, unknown>) {
  return call<{
    bookingPublicId: string;
    viewToken: string;
    party: Record<string, unknown>;
    payment: { amountCents: number; checkoutUrl: string | null; paymentLinkToken: string } | null;
  }>(`/api/public/parties/checkout`, { method: "POST", json: payload });
}

export function getPublicPartyConfirmation(publicId: string, viewToken: string) {
  return call<{ booking: Record<string, unknown>; party: Record<string, unknown> }>(
    `/api/public/parties/confirmation/${enc(publicId)}?viewToken=${enc(viewToken)}`
  );
}

export function getPublicPartyPayLink(token: string) {
  return call<{ link: Record<string, unknown>; party: Record<string, unknown> | null }>(
    `/api/public/parties/pay/${enc(token)}`
  );
}

export async function getPublicPartyInvitation(token: string) {
  return (await call<{ invitation: PublicPartyInvitation }>(`/api/public/parties/invite/${enc(token)}`)).invitation;
}

export function rsvpPublicPartyInvitation(
  token: string,
  payload: { accept: boolean; name?: string; age?: number | null }
) {
  return call<{ ok: boolean; idempotent: boolean; rsvpStatus: string }>(
    `/api/public/parties/invite/${enc(token)}/rsvp`,
    { method: "POST", json: payload }
  );
}
