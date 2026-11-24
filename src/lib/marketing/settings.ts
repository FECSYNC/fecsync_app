import type { MarketingAutomationSettings } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireId, isValidId } from "@/lib/ids";
import { assertVenueInOrg } from "@/lib/guests/upsertFromChannel";
import type { MarketingAutomationSettingsDto } from "@/lib/marketing/types";

function toDto(row: MarketingAutomationSettings): MarketingAutomationSettingsDto {
  return {
    id: row.id,
    orgId: row.orgId,
    locationId: row.locationId,
    newsletterEnabled: row.newsletterEnabled,
    welcomeEnabled: row.welcomeEnabled,
    welcomeFromNewsletter: row.welcomeFromNewsletter,
    birthdayEnabled: row.birthdayEnabled,
    reengagementEnabled: row.reengagementEnabled,
    postVisitSurveyEnabled: row.postVisitSurveyEnabled,
    welcomeDelayHours: row.welcomeDelayHours,
    birthdayDaysAhead: row.birthdayDaysAhead,
    reengagementInactiveDays: row.reengagementInactiveDays,
    reengagementCooldownDays: row.reengagementCooldownDays,
    postVisitDelayHours: row.postVisitDelayHours,
    fromName: row.fromName,
    replyToEmail: row.replyToEmail,
    partyBookingCtaPath: row.partyBookingCtaPath,
    partyCategorySlug: row.partyCategorySlug,
    websiteCtaUrl: row.websiteCtaUrl,
    promoCodeOrUrl: row.promoCodeOrUrl,
    defaultSurveyId: row.defaultSurveyId,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getOrCreateMarketingSettings(
  orgId: string,
  locationId?: string | null
): Promise<MarketingAutomationSettingsDto> {
  const id = requireId(orgId, "orgId");
  let loc: string | null = locationId ?? null;
  if (loc) {
    if (!isValidId(loc)) throw new Error("locationId is invalid");
    await assertVenueInOrg(id, loc);
  }

  const existing = await prisma.marketingAutomationSettings.findFirst({
    where: { orgId: id, locationId: loc },
  });
  const row =
    existing ??
    (await prisma.marketingAutomationSettings.create({
      data: { orgId: id, locationId: loc },
    }));
  return toDto(row);
}

export type MarketingSettingsPatch = Partial<{
  newsletterEnabled: boolean;
  welcomeEnabled: boolean;
  welcomeFromNewsletter: boolean;
  birthdayEnabled: boolean;
  reengagementEnabled: boolean;
  postVisitSurveyEnabled: boolean;
  welcomeDelayHours: number;
  birthdayDaysAhead: number;
  reengagementInactiveDays: number;
  reengagementCooldownDays: number;
  postVisitDelayHours: number;
  fromName: string | null;
  replyToEmail: string | null;
  partyBookingCtaPath: string | null;
  partyCategorySlug: string | null;
  websiteCtaUrl: string | null;
  promoCodeOrUrl: string | null;
  defaultSurveyId: string | null;
}>;

function asFiniteInt(value: unknown, label: string): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`${label} must be a number`);
  }
  return Math.trunc(n);
}

export async function patchMarketingSettings(
  orgId: string,
  locationId: string | null | undefined,
  patch: MarketingSettingsPatch
): Promise<MarketingAutomationSettingsDto> {
  await getOrCreateMarketingSettings(orgId, locationId ?? null);
  const id = requireId(orgId, "orgId");
  let loc: string | null = locationId ?? null;
  if (loc) {
    if (!isValidId(loc)) throw new Error("locationId is invalid");
    await assertVenueInOrg(id, loc);
  }

  if (patch.defaultSurveyId) {
    const survey = await prisma.guestSurvey.findFirst({
      where: { id: patch.defaultSurveyId, orgId: id },
      select: { id: true },
    });
    if (!survey) throw new Error("Survey not found in this company");
  }

  const existing = await prisma.marketingAutomationSettings.findFirst({
    where: { orgId: id, locationId: loc },
    select: { id: true },
  });
  if (!existing) {
    throw new Error("Marketing settings not found");
  }

  const row = await prisma.marketingAutomationSettings.update({
    where: { id: existing.id },
    data: {
      ...(patch.newsletterEnabled !== undefined
        ? { newsletterEnabled: patch.newsletterEnabled }
        : {}),
      ...(patch.welcomeEnabled !== undefined
        ? { welcomeEnabled: patch.welcomeEnabled }
        : {}),
      ...(patch.welcomeFromNewsletter !== undefined
        ? { welcomeFromNewsletter: patch.welcomeFromNewsletter }
        : {}),
      ...(patch.birthdayEnabled !== undefined
        ? { birthdayEnabled: patch.birthdayEnabled }
        : {}),
      ...(patch.reengagementEnabled !== undefined
        ? { reengagementEnabled: patch.reengagementEnabled }
        : {}),
      ...(patch.postVisitSurveyEnabled !== undefined
        ? { postVisitSurveyEnabled: patch.postVisitSurveyEnabled }
        : {}),
      ...(patch.welcomeDelayHours !== undefined
        ? {
            welcomeDelayHours: Math.max(
              0,
              Math.min(asFiniteInt(patch.welcomeDelayHours, "welcomeDelayHours"), 168)
            ),
          }
        : {}),
      ...(patch.birthdayDaysAhead !== undefined
        ? {
            birthdayDaysAhead: Math.max(
              1,
              Math.min(asFiniteInt(patch.birthdayDaysAhead, "birthdayDaysAhead"), 60)
            ),
          }
        : {}),
      ...(patch.reengagementInactiveDays !== undefined
        ? {
            reengagementInactiveDays: Math.max(
              7,
              Math.min(
                asFiniteInt(
                  patch.reengagementInactiveDays,
                  "reengagementInactiveDays"
                ),
                730
              )
            ),
          }
        : {}),
      ...(patch.reengagementCooldownDays !== undefined
        ? {
            reengagementCooldownDays: Math.max(
              7,
              Math.min(
                asFiniteInt(
                  patch.reengagementCooldownDays,
                  "reengagementCooldownDays"
                ),
                365
              )
            ),
          }
        : {}),
      ...(patch.postVisitDelayHours !== undefined
        ? {
            postVisitDelayHours: Math.max(
              0,
              Math.min(
                asFiniteInt(patch.postVisitDelayHours, "postVisitDelayHours"),
                168
              )
            ),
          }
        : {}),
      ...(patch.fromName !== undefined
        ? { fromName: patch.fromName?.trim().slice(0, 120) ?? null }
        : {}),
      ...(patch.replyToEmail !== undefined
        ? { replyToEmail: patch.replyToEmail?.trim().slice(0, 200) ?? null }
        : {}),
      ...(patch.partyBookingCtaPath !== undefined
        ? { partyBookingCtaPath: patch.partyBookingCtaPath?.trim().slice(0, 500) ?? null }
        : {}),
      ...(patch.partyCategorySlug !== undefined
        ? { partyCategorySlug: patch.partyCategorySlug?.trim().slice(0, 120) ?? null }
        : {}),
      ...(patch.websiteCtaUrl !== undefined
        ? { websiteCtaUrl: patch.websiteCtaUrl?.trim().slice(0, 500) ?? null }
        : {}),
      ...(patch.promoCodeOrUrl !== undefined
        ? { promoCodeOrUrl: patch.promoCodeOrUrl?.trim().slice(0, 500) ?? null }
        : {}),
      ...(patch.defaultSurveyId !== undefined
        ? { defaultSurveyId: patch.defaultSurveyId }
        : {}),
    },
  });
  return toDto(row);
}
