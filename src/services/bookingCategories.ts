/**
 * Thin Booking category client — keep the categories leaf chunk small.
 */
import { api, unwrap, type MaybeWrapped } from "@/utils/api";
import type { PublicCategoryPageDto } from "@/lib/publicCategory/snippet";

export type { PublicCategoryPageDto };

export type BookingCategoryDto = {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
  productCount: number;
  createdAt: string;
  updatedAt: string;
  publicPage: PublicCategoryPageDto | null;
};

const BASE = "/api/admin/ticketing/categories";

export const bookingCategoryKeys = {
  all: ["admin", "ticketing", "categories"] as const,
  list: (includeArchived?: boolean) =>
    [
      ...bookingCategoryKeys.all,
      includeArchived ? "all" : "active",
    ] as const,
};

export async function listBookingCategories(opts?: {
  includeArchived?: boolean;
}): Promise<BookingCategoryDto[]> {
  const qs = opts?.includeArchived ? "?includeArchived=1" : "";
  const raw = await api<MaybeWrapped<{ categories: BookingCategoryDto[] }>>(
    `${BASE}${qs}`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  return data?.categories ?? [];
}

export async function createBookingCategory(body: {
  name: string;
  description?: string | null;
}): Promise<BookingCategoryDto> {
  const raw = await api<MaybeWrapped<{ category: BookingCategoryDto }>>(
    BASE,
    { method: "POST", credentials: "include", body: JSON.stringify(body) }
  );
  const data = unwrap(raw);
  if (!data?.category) throw new Error("Could not create booking category");
  return data.category;
}

export async function updateBookingCategory(
  id: string,
  body: {
    name?: string;
    description?: string | null;
    slug?: string;
    layout?: "auto" | "grid" | "stack";
    embedEnabled?: boolean;
  }
): Promise<BookingCategoryDto> {
  const raw = await api<MaybeWrapped<{ category: BookingCategoryDto }>>(
    `${BASE}/${encodeURIComponent(id)}`,
    { method: "PATCH", credentials: "include", body: JSON.stringify(body) }
  );
  const data = unwrap(raw);
  if (!data?.category) throw new Error("Could not update booking category");
  return data.category;
}

export async function archiveBookingCategory(
  id: string
): Promise<BookingCategoryDto> {
  const raw = await api<MaybeWrapped<{ category: BookingCategoryDto }>>(
    `${BASE}/${encodeURIComponent(id)}`,
    { method: "DELETE", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.category) throw new Error("Could not archive booking category");
  return data.category;
}
