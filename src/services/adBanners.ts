import { api, unwrap, type MaybeWrapped } from "@/utils/api";
import type { AdBannerDto, AdBannerInput } from "@/lib/adBanners.shared";

type ListResponse = { banners: AdBannerDto[] };
type OneResponse = { banner: AdBannerDto; message?: string };

export async function getPublicAdBanners(): Promise<AdBannerDto[]> {
  const raw = await api<MaybeWrapped<ListResponse>>("/api/ad-banners", {
    method: "GET",
    credentials: "include",
  });
  const data = unwrap(raw);
  return data?.banners ?? [];
}

export async function getAdminAdBanners(): Promise<AdBannerDto[]> {
  const raw = await api<MaybeWrapped<ListResponse>>("/api/admin/ad-banners", {
    method: "GET",
    credentials: "include",
  });
  const data = unwrap(raw);
  return data?.banners ?? [];
}

export async function createAdminAdBanner(
  payload: AdBannerInput
): Promise<AdBannerDto> {
  const raw = await api<MaybeWrapped<OneResponse>>("/api/admin/ad-banners", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include",
  });
  const data = unwrap(raw);
  if (!data?.banner) throw new Error("Failed to create banner");
  return data.banner;
}

export async function updateAdminAdBanner(
  id: string,
  payload: AdBannerInput
): Promise<AdBannerDto> {
  const raw = await api<MaybeWrapped<OneResponse>>(
    `/api/admin/ad-banners/${id}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
    }
  );
  const data = unwrap(raw);
  if (!data?.banner) throw new Error("Failed to update banner");
  return data.banner;
}

export async function deleteAdminAdBanner(id: string): Promise<void> {
  await api(`/api/admin/ad-banners/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
}
