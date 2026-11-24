import prisma from "@/lib/prisma";
import { asIdString } from "@/lib/ids";
import { getStorefrontOrgId } from "@/lib/org";
import type { ShippingProviderCode } from "@prisma/client";
import {
  DEFAULT_PARCEL_DIMENSIONS,
  DEFAULT_PARCEL_WEIGHT_KG,
  normalizeParcelDimensions,
  normalizeWeightKg,
} from "./parcelDefaults";
import type {
  ParcelDimensions,
  ShippingOriginAddress,
  ShippingSettingsDoc,
} from "./types";

/** Lagos warehouse placeholder — line1 + phone required for isShippingCheckoutRequired. */
const DEFAULT_ORIGIN_ADDRESS: ShippingOriginAddress = {
  line1: "FECSYNC Fulfillment, Ikeja",
  line2: "",
  city: "Lagos",
  state: "Lagos",
  lga: "Ikeja",
  zip: "100001",
  country: "NG",
  phone: "08000000000",
  contactName: "FECSYNC",
};

function parseOriginAddress(value: unknown): ShippingOriginAddress {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_ORIGIN_ADDRESS };
  }
  const raw = value as Record<string, unknown>;
  const asText = (v: unknown, fallback = ""): string => {
    if (typeof v === "number" && Number.isFinite(v)) return String(v).trim();
    if (typeof v === "string") return v.trim();
    return fallback;
  };
  return {
    line1: asText(raw.line1),
    line2: asText(raw.line2) || undefined,
    city: asText(raw.city, DEFAULT_ORIGIN_ADDRESS.city) || DEFAULT_ORIGIN_ADDRESS.city,
    state: asText(raw.state, DEFAULT_ORIGIN_ADDRESS.state) || DEFAULT_ORIGIN_ADDRESS.state,
    lga: asText(raw.lga) || undefined,
    zip: asText(raw.zip) || undefined,
    country: asText(raw.country, "NG") || "NG",
    phone: asText(raw.phone),
    contactName:
      asText(raw.contactName, DEFAULT_ORIGIN_ADDRESS.contactName) ||
      DEFAULT_ORIGIN_ADDRESS.contactName,
  };
}

function toSettingsDoc(row: {
  id: string;
  orgId: string;
  originAddress: unknown;
  defaultWeightKg: number;
  defaultDimensions: unknown;
  autoBookOnPaid: boolean;
  primaryProvider: ShippingProviderCode;
  enabledProviders: ShippingProviderCode[];
  createdAt: Date;
  updatedAt: Date;
}): ShippingSettingsDoc {
  return {
    _id: row.id,
    orgId: row.orgId,
    originAddress: parseOriginAddress(row.originAddress),
    defaultWeightKg: normalizeWeightKg(row.defaultWeightKg),
    defaultDimensions: normalizeParcelDimensions(row.defaultDimensions),
    autoBookOnPaid: Boolean(row.autoBookOnPaid),
    primaryProvider: row.primaryProvider,
    enabledProviders: row.enabledProviders?.length
      ? row.enabledProviders
      : [row.primaryProvider],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getShippingSettings(
  orgId?: string | null
): Promise<ShippingSettingsDoc | null> {
  const fromArg = asIdString(orgId) ?? String(orgId ?? "").trim();
  const orgKey = fromArg || String(await getStorefrontOrgId());

  const settings = await prisma.shippingSettings.findUnique({
    where: { orgId: orgKey },
  });
  if (!settings) return null;
  return toSettingsDoc(settings);
}

/**
 * Upsert Lagos-placeholder origin settings when missing.
 * Seed org resolves via getStorefrontOrgId (DEFAULT_ORG_ID env, then default org).
 */
export async function getOrCreateShippingSettings(
  orgId?: string | null
): Promise<ShippingSettingsDoc> {
  const fromArg = asIdString(orgId) ?? String(orgId ?? "").trim();
  const orgKey = fromArg || String(await getStorefrontOrgId());

  let settings = await prisma.shippingSettings.findUnique({
    where: { orgId: orgKey },
  });

  if (!settings) {
    try {
      settings = await prisma.shippingSettings.create({
        data: {
          orgId: orgKey,
          originAddress: DEFAULT_ORIGIN_ADDRESS,
          defaultWeightKg: DEFAULT_PARCEL_WEIGHT_KG,
          defaultDimensions: DEFAULT_PARCEL_DIMENSIONS,
          autoBookOnPaid: true,
          primaryProvider: "shipbubble",
          enabledProviders: ["shipbubble"],
        },
      });
    } catch {
      // Concurrent create race on unique orgId — load the winner.
      settings = await prisma.shippingSettings.findUnique({
        where: { orgId: orgKey },
      });
      if (!settings) {
        throw new Error("Unable to provision shipping settings");
      }
    }
  }

  return toSettingsDoc(settings);
}

/** STEP 3 alias for getOrCreateShippingSettings. */
export async function ensureDefaultShippingSettings(
  orgId?: string | null
): Promise<ShippingSettingsDoc> {
  return getOrCreateShippingSettings(orgId);
}

export type UpsertShippingSettingsInput = {
  originAddress?: ShippingOriginAddress;
  defaultWeightKg?: number;
  defaultDimensions?: ParcelDimensions;
  autoBookOnPaid?: boolean;
  primaryProvider?: ShippingProviderCode;
  enabledProviders?: ShippingProviderCode[];
};

/**
 * Admin upsert — callers MUST authorize (staff settings:manage + org match).
 * HTTP: GET|PUT|POST /api/admin/shipping-settings
 */
export async function upsertShippingSettings(
  orgId: string,
  input: UpsertShippingSettingsInput
): Promise<ShippingSettingsDoc> {
  const orgKey = asIdString(orgId) ?? orgId.trim();
  const existing = await prisma.shippingSettings.findUnique({
    where: { orgId: orgKey },
  });

  const data = {
    originAddress: input.originAddress ?? existing?.originAddress ?? DEFAULT_ORIGIN_ADDRESS,
    defaultWeightKg: normalizeWeightKg(
      input.defaultWeightKg ?? existing?.defaultWeightKg ?? DEFAULT_PARCEL_WEIGHT_KG
    ),
    defaultDimensions: input.defaultDimensions
      ? input.defaultDimensions
      : normalizeParcelDimensions(existing?.defaultDimensions ?? DEFAULT_PARCEL_DIMENSIONS),
    autoBookOnPaid: input.autoBookOnPaid ?? existing?.autoBookOnPaid ?? true,
    primaryProvider: input.primaryProvider ?? existing?.primaryProvider ?? "shipbubble",
    enabledProviders:
      input.enabledProviders?.length
        ? input.enabledProviders
        : existing?.enabledProviders ?? ["shipbubble"],
  };

  const settings = existing
    ? await prisma.shippingSettings.update({
        where: { orgId: orgKey },
        data,
      })
    : await (async () => {
        try {
          return await prisma.shippingSettings.create({
            data: { orgId: orgKey, ...data },
          });
        } catch {
          const raced = await prisma.shippingSettings.findUnique({
            where: { orgId: orgKey },
          });
          if (!raced) {
            throw new Error("Unable to upsert shipping settings");
          }
          return prisma.shippingSettings.update({
            where: { orgId: orgKey },
            data,
          });
        }
      })();

  return toSettingsDoc(settings);
}
