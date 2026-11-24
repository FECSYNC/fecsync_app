import { api, unwrap, type MaybeWrapped } from "@/utils/api";

export type PublicVenueDto = {
  orgSlug: string;
  orgName: string;
  venueId: string;
  venueSlug: string;
  name: string;
  addressLine1: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  timezone: string | null;
  allowOnlinePayLater?: boolean;
  holdTtlMinutes?: number;
  timeFormat?: "twelve_hour" | "twenty_four_hour";
};

export type PublicProductDto = {
  id: string;
  type: string;
  name: string;
  description: string | null;
  images: string[];
  minGuests: number | null;
  maxGuests: number | null;
  categoryId?: string | null;
  category?: { id: string; name: string } | null;
  resource: { id: string; name: string; defaultCapacity: number } | null;
  prices: { code: string; amount: number; currency: string }[];
  priceFrom: number | null;
  soldOut?: boolean;
  addOns?: Array<{
    id: string;
    name: string;
    required: boolean;
    maxQty: number | null;
    priceFrom: number | null;
  }>;
};

export type PublicSessionDto = {
  id: string;
  /** Guest-facing slot name when set. */
  label: string | null;
  startsAt: string;
  endsAt: string;
  remaining: number;
  capacity: number;
  /** Flat timeslot price when set — overrides product price bands for this slot. */
  priceOverride: number | null;
  currency: string;
  isClosed?: boolean;
  heldQty?: number;
  committedQty?: number;
  nextReleaseAt?: string | null;
  status?: "open" | "limited" | "held" | "sold_out" | "closed";
  statusMessage?: string;
  availableForQty?: boolean;
};

export type PublicHoldDto = {
  holdId: string;
  token: string;
  expiresAt: string;
  sessionId: string;
  productId: string;
  qty: number;
};

export type GuestBookingDto = {
  id: string;
  publicId: string;
  orgId: string;
  locationId: string;
  status: string;
  channel: string;
  viewToken?: string;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  primaryContactPhone: string | null;
  taxExempt: boolean;
  subtotal: number;
  taxAmount: number;
  total: number;
  amountPaid: number;
  amountDue: number;
  holdExpiresAt: string | null;
  visitStartsAt: string | null;
  visitEndsAt: string | null;
  timeFormat?: "twelve_hour" | "twenty_four_hour";
  location: { id: string; name: string; slug?: string; timezone?: string | null } | null;
  lines: Array<{
    id: string;
    productId: string;
    productName: string;
    productType: string;
    priceBandCode: string | null;
    qty: number;
    unitPrice: number;
    taxAmount: number;
    lineTotal: number;
    sessionId: string | null;
    visitDate: string | null;
  }>;
  credentials?: Array<{
    id: string;
    code: string;
    qrPayload: string;
    status: string;
    customTicketId: string | null;
    ticketToken?: string;
  }>;
  partyDetail?: {
    id: string;
    kidCount?: number | null;
    guests?: Array<{
      id: string;
      name: string | null;
      age?: number | null;
      email?: string | null;
    }>;
    invitations?: Array<{
      id: string;
      status: string;
      sentTo: string | null;
    }>;
  } | null;
};

export const publicBookingKeys = {
  venue: (org: string, venue: string) => ["public", "booking", "venue", org, venue] as const,
  products: (org: string, venue: string) =>
    ["public", "booking", "products", org, venue] as const,
  availability: (
    productId: string,
    date?: string,
    qty?: number,
    from?: string,
    to?: string
  ) =>
    [
      "public",
      "booking",
      "availability",
      productId,
      date ?? "",
      qty ?? 1,
      from ?? "",
      to ?? "",
    ] as const,
};

export async function getPublicVenue(orgSlug: string, venueSlug: string) {
  const raw = await api<MaybeWrapped<{ venue: PublicVenueDto }>>(
    `/api/public/booking/venues/${encodeURIComponent(orgSlug)}/${encodeURIComponent(venueSlug)}`,
    { method: "GET" }
  );
  const data = unwrap(raw);
  if (!data?.venue) throw new Error("Venue not available");
  return data.venue;
}

export async function listPublicProducts(orgSlug: string, venueSlug: string) {
  const raw = await api<MaybeWrapped<{ products?: PublicProductDto[] }>>(
    `/api/public/booking/venues/${encodeURIComponent(orgSlug)}/${encodeURIComponent(venueSlug)}/products`,
    { method: "GET" }
  );
  return unwrap(raw)?.products ?? [];
}

export async function listPublicAvailability(opts: {
  productId: string;
  date?: string;
  from?: string;
  to?: string;
  qty?: number;
}) {
  const sp = new URLSearchParams({ productId: opts.productId });
  if (opts.date) sp.set("date", opts.date);
  if (opts.from) sp.set("from", opts.from);
  if (opts.to) sp.set("to", opts.to);
  if (opts.qty) sp.set("qty", String(opts.qty));
  const raw = await api<MaybeWrapped<{ sessions?: PublicSessionDto[] }>>(
    `/api/public/booking/availability?${sp}`,
    { method: "GET" }
  );
  return unwrap(raw)?.sessions ?? [];
}

export async function createPublicHold(body: {
  orgSlug: string;
  venueSlug: string;
  productId: string;
  sessionId: string;
  qty: number;
}): Promise<PublicHoldDto> {
  const raw = await api<MaybeWrapped<{ hold: PublicHoldDto }>>(
    "/api/public/booking/holds",
    { method: "POST", body: JSON.stringify(body) }
  );
  const data = unwrap(raw);
  if (!data?.hold) throw new Error("Could not hold seats");
  return data.hold;
}

export async function publicCheckout(body: {
  orgSlug: string;
  venueSlug: string;
  holdId?: string;
  holdToken?: string;
  priceBandCode?: string;
  lines?: Array<{ productId: string; sessionId?: string; qty: number; priceBandCode?: string; visitDate?: string }>;
  primaryContactName?: string;
  primaryContactEmail?: string;
  primaryContactPhone?: string;
  payLater?: boolean;
}): Promise<GuestBookingDto> {
  const raw = await api<MaybeWrapped<{ booking: GuestBookingDto }>>(
    "/api/public/booking/checkout",
    { method: "POST", credentials: "include", body: JSON.stringify(body) }
  );
  const data = unwrap(raw);
  if (!data?.booking) throw new Error("Checkout failed");
  return data.booking;
}

export type CompanyCheckoutResultDto = {
  booking: {
    publicId: string;
    status: string;
    total: number;
    amountDue: number;
    primaryContactEmail: string | null;
  };
  payment: {
    clientSecret: string;
    publishableKey: string;
    cancel: { bookingId: string; paymentId: string; token: string };
  } | null;
};

/** Company category site checkout — embedded Stripe Checkout when paying now. */
export async function companyCategoryCheckout(
  orgSlug: string,
  categorySlug: string,
  body: {
    productId: string;
    holdId?: string;
    holdToken?: string;
    priceBandCode?: string;
    lines?: Array<{ productId: string; sessionId?: string; qty: number; priceBandCode?: string; visitDate?: string }>;
    primaryContactName?: string;
    primaryContactEmail?: string;
    primaryContactPhone?: string;
    payLater?: boolean;
    /** Checkout started inside the iframe embed; embedOrigin is the framing page. */
    embed?: boolean;
    embedOrigin?: string;
  }
): Promise<CompanyCheckoutResultDto> {
  const raw = await api<MaybeWrapped<CompanyCheckoutResultDto>>(
    `/api/public/category/${encodeURIComponent(orgSlug)}/${encodeURIComponent(categorySlug)}/checkout`,
    { method: "POST", credentials: "include", body: JSON.stringify(body) }
  );
  const data = unwrap(raw);
  if (!data?.booking) throw new Error("Checkout failed");
  return data;
}

export async function cancelCompanyCardPayment(cancel: {
  bookingId: string;
  paymentId: string;
  token: string;
}) {
  await api("/api/payment/booking/cancel", {
    method: "POST",
    body: JSON.stringify(cancel),
  });
}

export async function beginPublicPayNow(bookingPublicId: string, viewToken: string) {
  const raw = await api<
    MaybeWrapped<{ checkoutUrl?: string | null; booking?: GuestBookingDto }>
  >("/api/public/booking/pay-now", {
    method: "POST",
    body: JSON.stringify({ bookingPublicId, viewToken }),
  });
  return unwrap(raw) ?? {};
}

export async function releasePublicHold(holdId: string, holdToken: string) {
  const qs = new URLSearchParams({ token: holdToken });
  await api(
    `/api/public/booking/holds/${encodeURIComponent(holdId)}?${qs.toString()}`,
    { method: "DELETE", credentials: "include" }
  );
}

export async function getPublicConfirmation(publicId: string, viewToken: string) {
  const raw = await api<MaybeWrapped<{ booking: GuestBookingDto }>>(
    `/api/public/booking/confirmation/${encodeURIComponent(publicId)}?viewToken=${encodeURIComponent(viewToken)}`,
    { method: "GET" }
  );
  const data = unwrap(raw);
  if (!data?.booking) throw new Error("Confirmation not found");
  return data.booking;
}

export async function getPaymentLink(token: string) {
  const raw = await api<MaybeWrapped<{ link?: unknown; booking?: GuestBookingDto } & Record<string, unknown>>>(
    `/api/public/booking/pay/${encodeURIComponent(token)}`,
    { method: "GET" }
  );
  return unwrap(raw);
}

export async function payPaymentLink(token: string, amount?: number) {
  const raw = await api<
    MaybeWrapped<{ checkoutUrl?: string | null; booking?: GuestBookingDto }>
  >(`/api/public/booking/pay/${encodeURIComponent(token)}`, {
    method: "POST",
    body: JSON.stringify(amount != null ? { amount } : {}),
  });
  return unwrap(raw) ?? {};
}

export async function getMagicBooking(token: string) {
  const raw = await api<
    MaybeWrapped<{
      valid: boolean;
      bookingPublicId: string;
      viewToken?: string;
      booking?: GuestBookingDto;
    }>
  >(`/api/public/booking/magic/${encodeURIComponent(token)}`, { method: "GET" });
  const data = unwrap(raw);
  if (!data?.valid) throw new Error("Link expired");
  return data;
}

export async function getPublicTicket(ticketToken: string, bookingPublicIdHint?: string) {
  const q = bookingPublicIdHint
    ? `?booking=${encodeURIComponent(bookingPublicIdHint)}`
    : "";
  const raw = await api<MaybeWrapped<{ ticket: { code: string; qrPayload: string; status: string }; bookingPublicId: string }>>(
    `/api/public/booking/tickets/${encodeURIComponent(ticketToken)}${q}`,
    { method: "GET" }
  );
  const data = unwrap(raw);
  if (!data?.ticket) throw new Error("Ticket not found");
  return data;
}

export async function patchMagicPartyGuests(
  token: string,
  guests: Array<{ id?: string; kind?: 'kid' | 'adult'; name?: string; age?: number | null }>
) {
  const raw = await api<MaybeWrapped<{ guests?: unknown[] }>>(
    `/api/public/booking/magic/${encodeURIComponent(token)}/guests`,
    { method: "PATCH", body: JSON.stringify({ guests }) }
  );
  return unwrap(raw);
}

export async function submitPublicSpecialRequest(body: {
  orgSlug: string;
  venueSlug: string;
  name: string;
  email: string;
  phone?: string;
  message: string;
  productId?: string;
  preferredDate?: string;
  qty?: number;
}): Promise<{
  ok: true;
  publicId: string;
  bookingId: string;
  message: string;
}> {
  const raw = await api<
    MaybeWrapped<{
      ok: true;
      publicId: string;
      bookingId: string;
      message: string;
    }>
  >("/api/public/booking/special-request", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const data = unwrap(raw);
  if (!data?.ok || !data.publicId) {
    throw new Error("Could not send your request");
  }
  return data;
}
