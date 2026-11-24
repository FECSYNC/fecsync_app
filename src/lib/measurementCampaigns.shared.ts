import { z } from "zod";

export const CAMPAIGN_STATUSES = [
  "draft",
  "active",
  "archived",
  "expired",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_PARTICIPANT_STATUSES = [
  "invited",
  "accepted",
  "completed",
] as const;
export type CampaignParticipantStatus =
  (typeof CAMPAIGN_PARTICIPANT_STATUSES)[number];

export const CAMPAIGN_PARTICIPANT_ROLES = [
  "direct",
  "coordinator",
  "member",
] as const;
export type CampaignParticipantRole =
  (typeof CAMPAIGN_PARTICIPANT_ROLES)[number];

export const CAMPAIGN_INVITE_CHANNELS = ["email", "link", "manual"] as const;
export type CampaignInviteChannel = (typeof CAMPAIGN_INVITE_CHANNELS)[number];

export const DEFAULT_CAMPAIGN_CATEGORIES = [
  "Fashion",
  "Wedding",
  "Uniform",
  "Graduation",
  "Corporate",
  "Other",
] as const;

/** Campaign logo/cover must come from the authenticated media upload (Cloudinary). */
function isCampaignMediaUrl(value: string): boolean {
  if (!value) return true;
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      u.hostname.includes("res.cloudinary.com") &&
      u.pathname.includes("/upload/")
    );
  } catch {
    return false;
  }
}

const campaignMediaUrlSchema = z.preprocess(
  (value) => (value == null ? "" : value),
  z.string().trim().refine(isCampaignMediaUrl, {
    message: "Image must be uploaded via campaign media",
  })
);

export const campaignInputSchema = z.object({
  name: z.string().trim().min(1, "Campaign name is required").max(120),
  category: z.string().trim().min(1).max(60).default("Other"),
  description: z.string().trim().max(2000).optional(),
  eventDate: z.string().trim().optional(),
  venue: z.string().trim().max(200).optional(),
  startDate: z.string().trim().min(1, "Start date is required"),
  expiryDate: z.string().trim().optional(),
  status: z.enum(CAMPAIGN_STATUSES).default("draft"),
  instructions: z.string().trim().max(4000).optional(),
  sponsoredScansPerInvitee: z.coerce.number().int().min(0).max(100).default(0),
  logoUrl: campaignMediaUrlSchema,
  coverImageUrl: campaignMediaUrlSchema,
});

export type CampaignInput = z.infer<typeof campaignInputSchema>;

export type CampaignStatsDto = {
  invited: number;
  accepted: number;
  completed: number;
  pending: number;
  completionPercent: number;
};

export type CampaignParticipantDto = {
  _id: string;
  fullName: string;
  email?: string;
  phone?: string;
  channel: CampaignInviteChannel;
  status: CampaignParticipantStatus;
  role: CampaignParticipantRole;
  canInviteMembers: boolean;
  shareToken?: string;
  invitedByParticipantId?: string;
  invitedByName?: string;
  coordinatorGroupLabel?: string;
  inviteeCount?: number;
  inviteeCompletedCount?: number;
  aiScansAllocated: number;
  aiScansUsed: number;
  invitedAt: string;
  acceptedAt?: string;
  submittedAt?: string;
  /** Frozen at submit time so the tailor can read measurements (profiles are owner-only). */
  measurementSnapshot?: CampaignMeasurementSnapshot;
};

export type CampaignMeasurementSnapshot = {
  label: string;
  unit: string;
  gender?: string;
  measurements: Record<string, number>;
};

/** Public join landing — GET /api/campaigns/join/[slug] */
export type PublicCampaignDto = {
  slug: string;
  name: string;
  description?: string;
  instructions?: string;
  tailorName: string;
  tailorSlug: string;
  organizerName: string;
  eventDate?: string;
  logoUrl?: string;
  coverImageUrl?: string;
  startDate?: string;
  expiryDate?: string;
  /** Server-derived — campaign past expiry or marked expired. */
  campaignClosed?: boolean;
  /** Server-derived — before startDate window. */
  campaignNotStarted?: boolean;
  /** Present when the request is authenticated and the user has a participant row. */
  participantStatus?: CampaignParticipantStatus;
  participantId?: string;
  groupCoordinatorName?: string;
  groupCoordinatorLabel?: string;
  joiningViaGroup?: boolean;
  /** Group token in URL but coordinator has not accepted yet — join blocked. */
  groupLinkNotActive?: boolean;
  /** Group token in URL does not match any coordinator for this campaign. */
  invalidGroupLink?: boolean;
  participantRole?: CampaignParticipantRole;
  canInviteMembers?: boolean;
  /** True when participantStatus is invited but inviteExpiresAt has passed. */
  participantInviteExpired?: boolean;
  /** Signed-in user lacks a verified email (join/submit blocked). */
  emailVerificationRequired?: boolean;
  /** Personal invite link opened with a different account email. */
  participantInviteEmailMismatch?: boolean;
  sponsoredScansAllocated?: number;
  sponsoredScansUsed?: number;
  sponsoredScansRemaining?: number;
};

/** Customer profile campaigns tab — GET /api/campaigns/my */
export type CustomerCampaignParticipationDto = {
  participantId: string;
  slug: string;
  campaignName: string;
  organizerName: string;
  category: string;
  eventDate?: string;
  startDate?: string;
  expiryDate?: string;
  /** Campaign lifecycle status (active / expired while still listed). */
  campaignStatus: CampaignStatus;
  participantStatus: CampaignParticipantStatus;
  role: CampaignParticipantRole;
  canInviteMembers: boolean;
  shareToken?: string;
  coordinatorGroupLabel?: string;
  inviteeStats?: {
    total: number;
    completed: number;
    accepted: number;
    invited: number;
  };
  groupJoinPath?: string;
  participantInviteExpired?: boolean;
  /** True when the campaign is expired/closed — submit/join CTAs should be disabled. */
  campaignClosed?: boolean;
  /** Server-derived — before startDate window. */
  campaignNotStarted?: boolean;
  sponsoredScansAllocated: number;
  sponsoredScansUsed: number;
  sponsoredScansRemaining: number;
  instructions?: string;
  joinPath: string;
};

export const DEFAULT_CAMPAIGN_JOIN_INSTRUCTIONS = `Please use the link provided to enter your measurements. You have two options:

1. Take photos directly using the tool; or
2. Upload existing photos clearly showing your full front, full back, and full side views.

Once your photos have been captured or uploaded, use the AI scanning feature to analyze the images and automatically generate your measurements.`;

export const DEFAULT_CAMPAIGN_JOIN_PRIVACY = `Privacy Notice: Your photos will not be stored or retained by the tool. They are used solely to generate your measurements and are immediately discarded once the measurement process is complete.`;

export type MeasurementCampaignDto = {
  _id: string;
  slug: string;
  name: string;
  category: string;
  description?: string;
  eventDate?: string;
  venue?: string;
  startDate: string;
  expiryDate?: string;
  status: CampaignStatus;
  instructions?: string;
  sponsoredScansPerInvitee: number;
  logoUrl?: string;
  coverImageUrl?: string;
  aiCreditsPurchased: number;
  aiCreditsUsed: number;
  aiCreditsReserved: number;
  aiCreditsAvailable: number;
  customCategories: string[];
  ownerLabel: string;
  participantCount: number;
  stats: CampaignStatsDto;
  joinPath: string;
  createdAt: string;
  updatedAt: string;
};

export const tailorClientInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.preprocess(
    (val) => (typeof val === "string" && !val.trim() ? undefined : val),
    z.string().trim().email("Valid email required").max(200).optional()
  ),
  phone: z.string().trim().max(40).optional(),
  gender: z.enum(["male", "female", "unisex", "other"]).optional(),
  garmentOccasion: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
  vitals: z
    .object({
      heightUnit: z.enum(["ft", "cm"]).optional(),
      heightFt: z.coerce.number().optional(),
      heightIn: z.coerce.number().optional(),
      heightCm: z.coerce.number().optional(),
      weightUnit: z.enum(["lb", "kg"]).optional(),
      weight: z.coerce.number().optional(),
      bodyShape: z.string().trim().max(60).optional(),
    })
    .optional(),
});

export type TailorClientInput = z.infer<typeof tailorClientInputSchema>;

export type TailorClientCampaignLinkDto = {
  participantId: string;
  status: CampaignParticipantStatus;
};

export type TailorClientDto = {
  _id: string;
  name: string;
  email?: string;
  phone?: string;
  gender?: string;
  garmentOccasion?: string;
  notes?: string;
  vitals?: Record<string, unknown>;
  campaignLink?: TailorClientCampaignLinkDto;
  createdAt: string;
  updatedAt: string;
};

export const inviteParticipantsSchema = z.object({
  expiresAt: z.string().trim().optional(),
  defaultRole: z.enum(CAMPAIGN_PARTICIPANT_ROLES).default("direct"),
  tailorClientId: z.string().trim().optional(),
  participants: z
    .array(
      z.object({
        fullName: z.string().trim().min(1, "Full name is required").max(120),
        email: z.string().trim().email("Valid email required").max(200),
        role: z.enum(CAMPAIGN_PARTICIPANT_ROLES).optional(),
      })
    )
    .min(1, "Add at least one participant")
    .max(50, "Invite at most 50 participants at a time"),
});

export type InviteParticipantsInput = z.infer<typeof inviteParticipantsSchema>;

export const coordinatorInviteMemberSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200).optional(),
  coordinatorGroupLabel: z.string().trim().max(120).optional(),
});

export const coordinatorInviteBatchSchema = z.object({
  coordinatorGroupLabel: z.string().trim().max(120).optional(),
  members: z.array(coordinatorInviteMemberSchema).min(1).max(25),
});

export const coordinatorInviteActionSchema = z.object({
  action: z.literal("invite"),
  coordinatorGroupLabel: z.string().trim().max(120).optional(),
  members: z.array(coordinatorInviteMemberSchema).min(1).max(25),
});

export const coordinatorSetGroupLabelSchema = z.object({
  action: z.literal("set-group-label"),
  coordinatorGroupLabel: z.string().trim().min(1).max(120),
});

export const coordinatorInvitePostSchema = z.discriminatedUnion("action", [
  coordinatorInviteActionSchema,
  coordinatorSetGroupLabelSchema,
]);

export type CoordinatorInviteeDto = {
  _id: string;
  fullName: string;
  email?: string;
  status: CampaignParticipantStatus;
  invitedAt: string;
  acceptedAt?: string;
  submittedAt?: string;
  joinPath?: string;
};

export type CampaignParticipantTreeNode = CampaignParticipantDto & {
  invitees: CampaignParticipantDto[];
};

/** Hierarchy counts for tailor participants tree view. */
export type CampaignParticipantsTreeStatsDto = CampaignStatsDto & {
  coordinators: number;
  members: number;
  direct: number;
};

export type CampaignParticipantsTreeDto = {
  coordinators: CampaignParticipantTreeNode[];
  direct: CampaignParticipantDto[];
  stats: CampaignParticipantsTreeStatsDto;
};

/** Shared tailor tree partition — used by listCampaignParticipantsTree and modal stats. */
export function partitionCampaignParticipants(
  all: CampaignParticipantDto[] | null | undefined
): {
  coordinators: CampaignParticipantDto[];
  inviteesByCoordinatorId: Map<string, CampaignParticipantDto[]>;
  direct: CampaignParticipantDto[];
} {
  const rows = Array.isArray(all) ? all : [];
  const coordinatorIds = new Set<string>();
  const coordinators = rows.filter((p) => {
    const isCoordinator = p.role === "coordinator" || p.canInviteMembers;
    if (isCoordinator) coordinatorIds.add(p._id);
    return isCoordinator;
  });

  const inviteesByCoordinatorId = new Map<string, CampaignParticipantDto[]>();
  for (const p of rows) {
    const parentId = p.invitedByParticipantId?.trim();
    if (parentId && coordinatorIds.has(parentId) && !coordinatorIds.has(p._id)) {
      const list = inviteesByCoordinatorId.get(parentId) ?? [];
      list.push(p);
      inviteesByCoordinatorId.set(parentId, list);
    }
  }

  const direct = rows.filter((p) => {
    if (coordinatorIds.has(p._id)) return false;
    const parentId = p.invitedByParticipantId?.trim();
    if (parentId && coordinatorIds.has(parentId)) return false;
    return true;
  });

  return { coordinators, inviteesByCoordinatorId, direct };
}

/** Stable invite-time sort (invalid dates sort last). */
export function compareParticipantsByInvitedAt(
  a: { invitedAt?: string },
  b: { invitedAt?: string }
): number {
  const ta = Date.parse(a.invitedAt ?? "");
  const tb = Date.parse(b.invitedAt ?? "");
  const sa = Number.isFinite(ta) ? ta : Number.POSITIVE_INFINITY;
  const sb = Number.isFinite(tb) ? tb : Number.POSITIVE_INFINITY;
  return sa - sb;
}

export type CampaignCreditActivityType =
  | "invite"
  | "accept"
  | "submit"
  | "reminder";

export type CampaignCreditActivityItem = {
  id: string;
  campaignId: string;
  campaignName: string;
  type: CampaignCreditActivityType;
  label: string;
  occurredAt: string;
  creditsInvolved?: number;
};

export type CampaignCreditsWalletDto = {
  purchased: number;
  used: number;
  reserved: number;
  available: number;
};

export type CampaignCreditsBreakdownItem = {
  _id: string;
  name: string;
  status: CampaignStatus;
  purchased: number;
  used: number;
  reserved: number;
  available: number;
};

export type TailorCreditsSummaryDto = {
  wallet: CampaignCreditsWalletDto;
  campaignCount: number;
  campaigns: CampaignCreditsBreakdownItem[];
  recentActivity: CampaignCreditActivityItem[];
  measurementProgress: {
    completed: number;
    total: number;
    percent: number;
  };
  creditTransactions: CampaignCreditTransactionItem[];
};

export type CampaignCreditTransactionItem = {
  id: string;
  occurredAt: string;
  type: string;
  credits: number;
  reference: string;
};
