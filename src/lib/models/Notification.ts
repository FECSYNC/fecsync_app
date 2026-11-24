/**
 * Thin Prisma re-export — prefer `prisma.notification` / `@/services/notificationService`.
 */
export type { Notification, NotificationType } from "@prisma/client";

export const NOTIFICATION_TYPES = [
  "order",
  "system",
  "promo",
  "alert",
  "tailoring",
  "campaign",
  "booking",
  "membership",
  "waiver",
  "pos",
  "marketing_send",
  "marketing_lead",
  "survey_response",
  "automation_run",
  "party",
  "accounting",
] as const;

export const NOTIFICATION_TYPE_LABELS: Record<(typeof NOTIFICATION_TYPES)[number], string> = {
  order: "Order",
  system: "System",
  promo: "Promo",
  alert: "Alert",
  tailoring: "Tailoring",
  campaign: "Campaign",
  booking: "Booking",
  membership: "Membership",
  waiver: "Waiver",
  pos: "POS",
  marketing_send: "Marketing send",
  marketing_lead: "Marketing lead",
  survey_response: "Survey response",
  automation_run: "Automation",
  party: "Party",
  accounting: "Accounting",
};
