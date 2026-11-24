import { api, unwrap, type MaybeWrapped } from "@/utils/api";

const BASE = "/api/admin/booking-accounts";

export type BookingAccountContactDto = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  isPrimary: boolean;
};

export type BookingAccountDto = {
  id: string;
  orgId: string;
  locationId: string | null;
  name: string;
  billingEmail: string | null;
  phone: string | null;
  taxId: string | null;
  notes: string | null;
  defaultTaxExempt: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  contactsCount: number;
  bookingsCount: number;
  contacts?: BookingAccountContactDto[];
  storedCards?: Array<{
    id: string;
    brand: string | null;
    last4: string | null;
    expMonth: number | null;
    expYear: number | null;
    isDefault: boolean;
  }>;
};

export const bookingAccountKeys = {
  all: ["admin", "booking-accounts"] as const,
  list: () => [...bookingAccountKeys.all, "list"] as const,
  detail: (id: string) => [...bookingAccountKeys.all, "detail", id] as const,
};

export async function listBookingAccounts(): Promise<BookingAccountDto[]> {
  const raw = await api<MaybeWrapped<{ accounts?: BookingAccountDto[] }>>(BASE, {
    method: "GET",
    credentials: "include",
  });
  const data = unwrap(raw);
  return Array.isArray(data?.accounts) ? data.accounts : [];
}

export async function getBookingAccount(
  id: string
): Promise<BookingAccountDto> {
  const raw = await api<MaybeWrapped<{ account: BookingAccountDto }>>(
    `${BASE}/${encodeURIComponent(id)}`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.account) throw new Error("Could not load company");
  return data.account;
}

export async function createBookingAccount(payload: {
  name: string;
  billingEmail?: string | null;
  phone?: string | null;
  taxId?: string | null;
  notes?: string | null;
  defaultTaxExempt?: boolean;
  locationId?: string | null;
}): Promise<BookingAccountDto> {
  const raw = await api<MaybeWrapped<{ account: BookingAccountDto }>>(BASE, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(payload),
  });
  const data = unwrap(raw);
  if (!data?.account) throw new Error("Could not create company");
  return data.account;
}

export async function patchBookingAccount(
  id: string,
  payload: Partial<{
    name: string;
    billingEmail: string | null;
    phone: string | null;
    taxId: string | null;
    notes: string | null;
    defaultTaxExempt: boolean;
  }>
): Promise<BookingAccountDto> {
  const raw = await api<MaybeWrapped<{ account: BookingAccountDto }>>(
    `${BASE}/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      credentials: "include",
      body: JSON.stringify(payload),
    }
  );
  const data = unwrap(raw);
  if (!data?.account) throw new Error("Could not update company");
  return data.account;
}

export async function listBookingAccountContacts(
  accountId: string
): Promise<BookingAccountContactDto[]> {
  const raw = await api<
    MaybeWrapped<{ contacts?: BookingAccountContactDto[] }>
  >(`${BASE}/${encodeURIComponent(accountId)}/contacts`, {
    method: "GET",
    credentials: "include",
  });
  const data = unwrap(raw);
  return Array.isArray(data?.contacts) ? data.contacts : [];
}

export async function createBookingAccountContact(
  accountId: string,
  payload: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
    title?: string | null;
    isPrimary?: boolean;
  }
): Promise<BookingAccountContactDto> {
  const raw = await api<MaybeWrapped<{ contact: BookingAccountContactDto }>>(
    `${BASE}/${encodeURIComponent(accountId)}/contacts`,
    {
      method: "POST",
      credentials: "include",
      body: JSON.stringify(payload),
    }
  );
  const data = unwrap(raw);
  if (!data?.contact) throw new Error("Could not create contact");
  return data.contact;
}
