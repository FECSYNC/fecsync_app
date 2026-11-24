/**
 * Newsletter campaign shapes shared by the admin composer (client) and the
 * server engine. No Prisma / Node imports — safe for client bundles.
 */
import { richDocFromPlainText, type RichDoc } from "@/lib/marketing/campaigns/richText";

export type BlockAlign = "left" | "center" | "right";

export const CAMPAIGN_BLOCK_TYPES = [
  "heading",
  "text",
  "image",
  "button",
  "promo",
  "events",
  "divider",
] as const;

export type CampaignBlockType = (typeof CAMPAIGN_BLOCK_TYPES)[number];

export type CampaignBlock =
  | { id: string; type: "heading"; text: string; align: BlockAlign }
  | { id: string; type: "text"; doc: RichDoc }
  | { id: string; type: "image"; url: string; alt: string; href: string; align: BlockAlign }
  | {
      id: string;
      type: "button";
      label: string;
      url: string;
      align: BlockAlign;
      variant: "solid" | "outline";
    }
  | { id: string; type: "promo"; title: string; text: string; code: string; url: string }
  | { id: string; type: "events"; title: string; limit: number }
  | { id: string; type: "divider" };

export type CampaignAudience = {
  /** "newsletter" = only guests who signed up via the newsletter form. */
  source: "all_opted_in" | "newsletter";
  /** Only guests who visited within N days (null = any). */
  visitedWithinDays: number | null;
  /** Only guests holding an active guest membership. */
  activeMembersOnly: boolean;
};

export const DEFAULT_CAMPAIGN_AUDIENCE: CampaignAudience = {
  source: "all_opted_in",
  visitedWithinDays: null,
  activeMembersOnly: false,
};

export type CampaignStatus =
  | "draft"
  | "scheduled"
  | "sending"
  | "sent"
  | "paused"
  | "archived";

export type CampaignScheduleKind = "once" | "monthly";

export type CampaignWindowStats = {
  windowKey: string;
  sent: number;
  skipped: number;
  failed: number;
};

export type MarketingCampaignDto = {
  id: string;
  orgId: string;
  locationId: string | null;
  locationName: string | null;
  name: string;
  subject: string;
  preheader: string | null;
  blocks: CampaignBlock[];
  audience: CampaignAudience;
  scheduleKind: CampaignScheduleKind;
  sendAt: string | null;
  dayOfMonth: number | null;
  sendHour: number;
  timezone: string;
  status: CampaignStatus;
  nextRunAt: string | null;
  currentWindowKey: string | null;
  lastRunAt: string | null;
  lastCompletedAt: string | null;
  /** Delivery counts for the most recent issue (current or last completed). */
  lastWindow: CampaignWindowStats | null;
  createdAt: string;
  updatedAt: string;
};

export type MarketingCampaignInput = {
  name?: string;
  subject?: string;
  preheader?: string | null;
  blocks?: unknown;
  audience?: unknown;
  locationId?: string | null;
  scheduleKind?: CampaignScheduleKind;
  sendAt?: string | null;
  dayOfMonth?: number | null;
  sendHour?: number;
  timezone?: string;
  /** Optimistic concurrency: reject the save when the campaign changed since this version. */
  expectedUpdatedAt?: string | null;
};

export type CampaignAction = "schedule" | "pause" | "resume" | "send_now";

/** Merge tags operators may type inside text / heading / button blocks. */
export const CAMPAIGN_MERGE_TAGS = [
  { tag: "{{guestFirstName}}", label: "Guest first name" },
  { tag: "{{orgName}}", label: "Company name" },
  { tag: "{{websiteUrl}}", label: "Website link" },
  { tag: "{{bookUrl}}", label: "Booking link" },
  { tag: "{{monthName}}", label: "Month name" },
] as const;

export function newBlockId(): string {
  return `b_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export function emptyBlock(type: CampaignBlockType): CampaignBlock {
  const id = newBlockId();
  switch (type) {
    case "heading":
      return { id, type, text: "", align: "left" };
    case "text":
      return { id, type, doc: { type: "doc", content: [{ type: "paragraph" }] } };
    case "image":
      return { id, type, url: "", alt: "", href: "", align: "center" };
    case "button":
      return { id, type, label: "Book now", url: "{{bookUrl}}", align: "center", variant: "solid" };
    case "promo":
      return { id, type, title: "This month’s offer", text: "", code: "", url: "" };
    case "events":
      return { id, type, title: "Coming up", limit: 5 };
    case "divider":
      return { id, type };
  }
}

/** Starter layout for a recurring monthly newsletter. */
export function starterMonthlyBlocks(): CampaignBlock[] {
  return [
    { id: newBlockId(), type: "heading", text: "{{monthName}} at {{orgName}}", align: "left" },
    {
      id: newBlockId(),
      type: "text",
      doc: richDocFromPlainText(
        "Hi {{guestFirstName}},\n\nHere’s what’s happening this month — **new events, offers, and reasons to visit**."
      ),
    },
    { id: newBlockId(), type: "events", title: "Coming up this month", limit: 5 },
    {
      id: newBlockId(),
      type: "promo",
      title: "Subscriber offer",
      text: "Show this email at the desk or use the code online.",
      code: "",
      url: "",
    },
    {
      id: newBlockId(),
      type: "button",
      label: "Book your visit",
      url: "{{bookUrl}}",
      align: "center",
      variant: "solid",
    },
  ];
}
