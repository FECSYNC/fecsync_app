import { api, unwrap, type MaybeWrapped } from "@/utils/api";
import type { TaxSettingsLike } from "@/utils/tax";

export type TaxSettings = TaxSettingsLike & {
  createdByName?: string | null;
  updatedByName?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type TaxSettingsResponse = {
  settings: TaxSettings;
};

export async function getTaxSettings(): Promise<TaxSettingsLike> {
  const raw = await api<MaybeWrapped<TaxSettingsResponse>>("/api/tax-settings", {
    method: "GET",
    credentials: "include",
  });
  const data = unwrap(raw);
  return (
    data?.settings ?? {
      enabled: false,
      rate: 0,
      label: "Tax",
    }
  );
}

export async function getAdminTaxSettings(): Promise<TaxSettings> {
  const raw = await api<MaybeWrapped<TaxSettingsResponse>>(
    "/api/admin/tax-settings",
    {
      method: "GET",
      credentials: "include",
    }
  );
  const data = unwrap(raw);
  return (
    data?.settings ?? {
      enabled: false,
      rate: 0,
      label: "Tax",
    }
  );
}

export async function updateTaxSettings(
  payload: Partial<TaxSettingsLike>
): Promise<TaxSettings> {
  const raw = await api<MaybeWrapped<TaxSettingsResponse>>(
    "/api/admin/tax-settings",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
    }
  );
  const data = unwrap(raw);
  if (!data?.settings) {
    throw new Error("Failed to update tax settings");
  }
  return data.settings;
}
