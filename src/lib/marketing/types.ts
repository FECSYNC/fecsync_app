import type { GuestSurveyStatus, MarketingSendStatus } from "@prisma/client";

export const MARKETING_AUTOMATION_KINDS = [
  "welcome",
  "birthday",
  "reengagement",
  "post_visit_survey",
  "newsletter_confirm",
  "survey_thank_you",
] as const;

export type MarketingAutomationKind =
  (typeof MARKETING_AUTOMATION_KINDS)[number];

export const MARKETING_BATCH_CAP = 100;

export type MarketingAutomationSettingsDto = {
  id: string;
  orgId: string;
  locationId: string | null;
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
  updatedAt: string;
};

export type MarketingSendLogDto = {
  id: string;
  orgId: string;
  locationId: string | null;
  guestProfileId: string | null;
  toEmail: string;
  kind: string;
  automationKey: string;
  status: MarketingSendStatus;
  skipReason: string | null;
  templateKey: string | null;
  createdAt: string;
};

export type GuestSurveyDto = {
  id: string;
  orgId: string;
  locationId: string | null;
  name: string;
  slug: string;
  status: GuestSurveyStatus;
  questions: unknown;
  thankYouMessage: string | null;
  promoUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GuestSurveyInviteDto = {
  id: string;
  orgId: string;
  surveyId: string;
  guestProfileId: string;
  locationId: string | null;
  bookingId: string | null;
  visitRef: string | null;
  token: string;
  sentAt: string | null;
  openedAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
};

export type GuestSurveyResponseDto = {
  id: string;
  orgId: string;
  surveyId: string;
  inviteId: string | null;
  guestProfileId: string | null;
  answers: unknown;
  rating: number | null;
  comment: string | null;
  createdAt: string;
};

export type MarketingOverviewDto = {
  optedInLeadCount: number;
  welcomeSentCount: number;
  birthdayUpcomingCount: number;
  reengagementQueueCount: number;
  surveyPublishedCount: number;
  surveyResponseCount: number;
  campaignActiveCount: number;
  newsletterSentLast30Days: number;
  membershipsDunning: {
    dunningEnabled: boolean;
    pastDueCount: number;
  };
  waiverReminders: {
    remindBeforeDays: number[];
    sentLast30Days: number;
  };
};

export type AutomationRunResult = {
  sent: number;
  skipped: number;
  failed: number;
};
