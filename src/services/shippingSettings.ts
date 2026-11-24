import { api, unwrap, type MaybeWrapped } from "@/utils/api";

export type ShippingOriginAddress = {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  lga?: string;
  zip?: string;
  country: string;
  phone: string;
  contactName?: string;
};

export type ShippingSettings = {
  orgId?: string;
  originAddress: ShippingOriginAddress;
  defaultWeightKg: number;
  defaultDimensions: { length: number; width: number; height: number };
  autoBookOnPaid: boolean;
  primaryProvider: string;
  enabledProviders: string[];
  updatedAt?: string | Date;
};

type SettingsResponse = {
  settings: ShippingSettings;
  message?: string;
};

type TestResponse = {
  message: string;
  providersTried?: string[];
  quoteCount?: number;
  sampleFees?: Array<{
    provider: string;
    courierName: string;
    fee: number;
    currency: string;
  }>;
};

export async function getAdminShippingSettings(): Promise<ShippingSettings> {
  const raw = await api<MaybeWrapped<SettingsResponse>>(
    "/api/admin/shipping-settings",
    {
      method: "GET",
      credentials: "include",
    }
  );
  const data = unwrap(raw);
  if (!data?.settings) {
    throw new Error("Failed to load shipping settings");
  }
  return data.settings;
}

export async function updateShippingSettings(
  payload: Partial<{
    originAddress: ShippingOriginAddress;
    defaultWeightKg: number;
    defaultDimensions: { length: number; width: number; height: number };
    autoBookOnPaid: boolean;
    primaryProvider: string;
    enabledProviders: string[];
  }>
): Promise<ShippingSettings> {
  const raw = await api<MaybeWrapped<SettingsResponse>>(
    "/api/admin/shipping-settings",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
    }
  );
  const data = unwrap(raw);
  if (!data?.settings) {
    throw new Error("Failed to update shipping settings");
  }
  return data.settings;
}

export async function testShippingConnection(payload?: {
  destinationState?: string;
}): Promise<TestResponse> {
  const raw = await api<MaybeWrapped<TestResponse>>(
    "/api/admin/shipping-settings",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
      credentials: "include",
    }
  );
  const data = unwrap(raw);
  if (!data) {
    throw new Error("Connection test failed");
  }
  return data;
}
