import { api, unwrap, type MaybeWrapped } from "@/utils/api";
import type { GuestBookingDto } from "@/services/publicBooking";

export const meBookingKeys = {
  all: ["me", "bookings"] as const,
  list: () => [...meBookingKeys.all, "list"] as const,
  detail: (id: string) => [...meBookingKeys.all, "detail", id] as const,
};

export async function listMyBookings(): Promise<GuestBookingDto[]> {
  const raw = await api<MaybeWrapped<{ bookings?: GuestBookingDto[] }>>(
    "/api/me/bookings",
    { method: "GET", credentials: "include" }
  );
  return unwrap(raw)?.bookings ?? [];
}

export async function getMyBooking(id: string): Promise<GuestBookingDto> {
  const raw = await api<MaybeWrapped<{ booking: GuestBookingDto }>>(
    `/api/me/bookings/${encodeURIComponent(id)}`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.booking) throw new Error("Booking not found");
  return data.booking;
}

export async function cancelMyBooking(id: string): Promise<GuestBookingDto> {
  const raw = await api<MaybeWrapped<{ booking: GuestBookingDto }>>(
    `/api/me/bookings/${encodeURIComponent(id)}/cancel`,
    { method: "POST", credentials: "include", body: JSON.stringify({}) }
  );
  const data = unwrap(raw);
  if (!data?.booking) throw new Error("Could not cancel");
  return data.booking;
}

export async function patchMyPartyGuests(
  id: string,
  guests: Array<{ id?: string; kind?: 'kid' | 'adult'; name?: string; age?: number | null }>
) {
  const raw = await api<MaybeWrapped<{ guests?: unknown[] }>>(
    `/api/me/bookings/${encodeURIComponent(id)}/party-guests`,
    {
      method: "PATCH",
      credentials: "include",
      body: JSON.stringify({ guests }),
    }
  );
  return unwrap(raw);
}
