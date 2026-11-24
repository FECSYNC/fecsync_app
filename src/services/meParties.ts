import { api, unwrap, type MaybeWrapped } from "@/utils/api";

export const mePartyKeys = {
  all: ["me", "parties"] as const,
  list: () => [...mePartyKeys.all, "list"] as const,
  detail: (id: string) => [...mePartyKeys.all, "detail", id] as const,
};

export type MyPartyRow = {
  bookingId: string;
  publicId: string;
  status: string;
  opsStatus: string;
  partyName: string;
  honoreeName: string | null;
  kidCount: number;
  adultCount: number;
  room: { name: string } | null;
  location: { id: string; name: string };
  timezone: string | null;
  visitStartsAt: string | null;
  totalCents: number;
  amountDueCents: number;
  depositRequiredCents: number;
  depositPaidCents: number;
};

export type MyPartyGuest = {
  id: string;
  kind: "honoree" | "kid" | "adult" | "chaperone" | "other";
  name: string | null;
  age: number | null;
  email?: string | null;
  phone?: string | null;
  rsvpStatus: string;
  waiverStatus: string;
};

export type MyParty = {
  bookingId: string;
  publicId: string;
  status: string;
  opsStatus: string;
  location: { id: string; name: string } | null;
  timezone: string | null;
  visitStartsAt: string | null;
  visitEndsAt: string | null;
  partyName: string;
  honoreeName: string | null;
  honoreeAge: number | null;
  kidCount: number;
  adultCount: number;
  package: { id: string; name: string } | null;
  room: { id: string; name: string | null } | null;
  addOns: Array<{ productId: string; name: string; qty: number; lineTotalCents: number }>;
  totalCents: number;
  amountPaidCents: number;
  amountDueCents: number;
  depositRequiredCents: number;
  depositPaidCents: number;
  depositDueAt: string | null;
  balanceDueAt: string | null;
  primaryContactName: string | null;
  guests: MyPartyGuest[];
  invitations: Array<{ id: string; guestId: string | null; channel: string; status: string; expiresAt: string | null; respondedAt: string | null }>;
  foodOrders: Array<{ id: string; status: string; lines: Array<{ menuItemId: string | null; nameSnapshot: string; qty: number; unitPriceCents: number }> }>;
};

export type MyPartyDetail = {
  party: MyParty;
  capabilities: {
    canEditGuests: boolean;
    canEditFood: boolean;
    canCancel: boolean;
    canInvite: boolean;
    canPay: boolean;
    hostCancelCutoffHours: number;
    foodOrderCutoffMinutes: number;
  };
  menu: Array<{ id: string; name: string; kind: string; priceCents: number }>;
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

export async function listMyParties() {
  return (await call<{ parties: MyPartyRow[] }>(`/api/me/parties`)).parties;
}

export function getMyParty(id: string) {
  return call<MyPartyDetail>(`/api/me/parties/${enc(id)}`);
}

export async function patchMyPartyGuests(id: string, guests: Array<Record<string, unknown>>) {
  return (await call<{ guests: unknown[] }>(`/api/me/parties/${enc(id)}/guests`, {
    method: "PATCH",
    json: { guests },
  })).guests;
}

export async function putMyPartyFood(id: string, payload: { lines: Array<Record<string, unknown>>; notes?: string }) {
  return (await call<{ orders: unknown[] }>(`/api/me/parties/${enc(id)}/food`, {
    method: "PUT",
    json: payload,
  })).orders;
}

export function cancelMyParty(id: string, reason?: string) {
  return call<MyPartyDetail>(`/api/me/parties/${enc(id)}/cancel`, {
    method: "POST",
    json: reason ? { reason } : {},
  });
}

export function createMyPartyPayLink(id: string) {
  return call<{ payPath: string }>(`/api/me/parties/${enc(id)}/pay`, { method: "POST", json: {} });
}

export async function createMyPartyInvitation(
  id: string,
  payload: { channel?: "email" | "sms" | "link"; toEmail?: string; toPhone?: string; guestId?: string; send?: boolean }
) {
  return (await call<{ invitation: { id: string; rsvpUrl: string; status: string } }>(
    `/api/me/parties/${enc(id)}/invitations`,
    { method: "POST", json: payload }
  )).invitation;
}
