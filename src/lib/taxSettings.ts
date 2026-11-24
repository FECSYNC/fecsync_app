import prisma from "@/lib/prisma";
import { asIdString } from "@/lib/ids";
import { getStorefrontOrgId } from "@/lib/org";
import type { TaxSettingsLike } from "@/utils/tax";
import { normalizeTaxRate } from "@/utils/tax";
import { syncFromTaxSettings } from "@/lib/accounting/taxCodes";

export type TaxSettingsDoc = TaxSettingsLike & {
  _id?: string;
  orgId?: string;
  createdByName?: string | null;
  updatedByName?: string | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
};

/** Staff admin payload — includes audit trail. */
export type StaffTaxSettings = TaxSettingsLike & {
  createdByName?: string | null;
  updatedByName?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

function auditName(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function isoDate(value?: string | Date | null): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function toStaffTaxSettings(settings: TaxSettingsDoc): StaffTaxSettings {
  return {
    enabled: Boolean(settings.enabled),
    rate: normalizeTaxRate(settings.rate),
    label: settings.label?.trim() || "Tax",
    createdByName: auditName(settings.createdByName),
    updatedByName: auditName(settings.updatedByName),
    createdAt: isoDate(settings.createdAt ?? null),
    updatedAt: isoDate(settings.updatedAt ?? null),
  };
}

export async function getOrCreateTaxSettings(
  orgId?: string | null
): Promise<TaxSettingsDoc> {
  const fromArg = asIdString(orgId) ?? String(orgId ?? "").trim();
  const orgKey = fromArg || String(await getStorefrontOrgId());

  const settings = await prisma.$transaction(async (tx) => {
    let row = await tx.taxSettings.findUnique({
      where: { orgId: orgKey },
    });
    if (!row) {
      row = await tx.taxSettings.create({
        data: {
          orgId: orgKey,
          enabled: false,
          rate: 0,
          label: "Tax",
        },
      });
    }
    // Keep TaxCode in the same transaction when accounting is initialized.
    try {
      await syncFromTaxSettings(tx, orgKey);
    } catch (err) {
      console.error("[taxSettings] syncFromTaxSettings failed", orgKey, err);
    }
    return row;
  });

  return {
    _id: settings.id,
    orgId: orgKey,
    enabled: Boolean(settings.enabled),
    rate: normalizeTaxRate(settings.rate),
    label: settings.label?.trim() || "Tax",
    createdByName: settings.createdByName ?? null,
    updatedByName: settings.updatedByName ?? null,
    createdAt: settings.createdAt ?? null,
    updatedAt: settings.updatedAt ?? null,
  };
}

/** After staff save — keep accounting tax codes in sync when initialized. */
export async function afterTaxSettingsSaved(
  orgId: string,
  db: Parameters<typeof syncFromTaxSettings>[0] = prisma
): Promise<void> {
  try {
    await syncFromTaxSettings(db, orgId);
  } catch (err) {
    console.error("[taxSettings] syncFromTaxSettings failed", orgId, err);
  }
}

export function toTaxSettingsLike(settings: TaxSettingsDoc): TaxSettingsLike {
  return {
    enabled: Boolean(settings.enabled),
    rate: normalizeTaxRate(settings.rate),
    label: settings.label?.trim() || "Tax",
  };
}
