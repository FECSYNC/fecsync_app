import type { MarketingAutomationSettingsDto } from "@/lib/marketing/types";

export function marketingAutomationsDto(
  settings: MarketingAutomationSettingsDto
): Record<string, unknown> {
  return {
    newsletterEnabled: settings.newsletterEnabled,
    welcomeEnabled: settings.welcomeEnabled,
    welcomeFromNewsletter: settings.welcomeFromNewsletter,
    birthdayEnabled: settings.birthdayEnabled,
    reengagementEnabled: settings.reengagementEnabled,
    postVisitSurveyEnabled: settings.postVisitSurveyEnabled,
    welcomeDelayHours: settings.welcomeDelayHours,
    birthdayDaysAhead: settings.birthdayDaysAhead,
    reengagementInactiveDays: settings.reengagementInactiveDays,
    reengagementCooldownDays: settings.reengagementCooldownDays,
    postVisitDelayHours: settings.postVisitDelayHours,
    defaultSurveyId: settings.defaultSurveyId,
    updatedAt: settings.updatedAt,
  };
}

export type MarketingAutomationsPatch = Partial<{
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
  defaultSurveyId: string | null;
}>;
