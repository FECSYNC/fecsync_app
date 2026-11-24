import dbConnect from "@/lib/db";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { randomBytes } from "crypto";
import { isValidId } from "@/lib/ids";
import { slugifyTailorName } from "@/lib/tailors.shared";
import { paginatedMeta, type PaginationOpts } from "@/lib/pagination";
import { createNotification } from "@/services/notificationService";
import {
  measurementsRecord,
  assertNonEmptyMeasurements,
  measurementFieldLabel,
  MEASUREMENT_FIELD_KEYS,
} from "@/lib/measurements";
import {
  campaignInputSchema,
  DEFAULT_CAMPAIGN_CATEGORIES,
  inviteParticipantsSchema,
  tailorClientInputSchema,
  type CampaignInput,
  type CampaignMeasurementSnapshot,
  type CampaignParticipantDto,
  type CampaignStatsDto,
  type InviteParticipantsInput,
  type MeasurementCampaignDto,
  type TailorClientDto,
  type TailorClientInput,
  type CampaignParticipantStatus,
  type TailorCreditsSummaryDto,
  type CampaignCreditActivityItem,
  type CampaignCreditTransactionItem,
  type CustomerCampaignParticipationDto,
  type CampaignParticipantRole,
  type CoordinatorInviteeDto,
  type CampaignParticipantTreeNode,
  type CampaignParticipantsTreeDto,
  type CampaignParticipantsTreeStatsDto,
  compareParticipantsByInvitedAt,
  partitionCampaignParticipants,
  coordinatorInviteActionSchema,
} from "@/lib/measurementCampaigns.shared";

export * from "@/lib/measurementCampaigns.shared";

type CampaignRow = {
  id: string;
  slug: string;
  name: string;
  category: string;
  description?: string | null;
  eventDate?: Date | null;
  venue?: string | null;
  startDate: Date;
  expiryDate?: Date | null;
  status: string;
  instructions?: string | null;
  sponsoredScansPerInvitee: number;
  logoUrl?: string | null;
  coverImageUrl?: string | null;
  aiCreditsPurchased: number;
  aiCreditsUsed: number;
  aiCreditsReserved: number;
  customCategories: string[];
  createdAt: Date;
  updatedAt: Date;
  participants?: Array<{
    id: string;
    fullName: string;
    email?: string | null;
    phone?: string | null;
    channel: string;
    status: string;
    role?: string;
    canInviteMembers?: boolean;
    shareToken?: string | null;
    invitedByParticipantId?: string | null;
    coordinatorGroupLabel?: string | null;
    aiScansAllocated: number;
    aiScansUsed: number;
    invitedAt: Date;
    acceptedAt?: Date | null;
    submittedAt?: Date | null;
  }>;
};

function parseDate(raw?: string | null): Date | undefined {
  if (!raw?.trim()) return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid date");
  return d;
}

/** Date-only inputs (YYYY-MM-DD) expire at end of that calendar day UTC. */
function parseInviteExpiryDate(raw?: string | null): Date | undefined {
  if (!raw?.trim()) return undefined;
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const d = new Date(`${trimmed}T23:59:59.999Z`);
    if (Number.isNaN(d.getTime())) throw new Error("Invalid date");
    return d;
  }
  return parseDate(trimmed);
}

/** Date-only start dates begin at start of that calendar day UTC. */
function parseCampaignStartDate(raw?: string | null): Date | undefined {
  if (!raw?.trim()) return undefined;
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const d = new Date(`${trimmed}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) throw new Error("Invalid date");
    return d;
  }
  return parseDate(trimmed);
}

function assertCampaignOpenForParticipation(campaign: {
  startDate: Date;
  expiryDate?: Date | null;
}): void {
  const now = Date.now();
  if (campaign.startDate.getTime() > now) {
    throw new Error("This campaign has not started yet");
  }
  if (campaign.expiryDate && campaign.expiryDate.getTime() < now) {
    throw new Error("This campaign has expired");
  }
}

function isInviteStillOpen(row: {
  status: string;
  inviteExpiresAt?: Date | null;
}): boolean {
  if (row.status !== "invited") return false;
  if (!row.inviteExpiresAt) return true;
  return row.inviteExpiresAt.getTime() >= Date.now();
}

const MAX_GROUP_SHARE_TOKEN_LEN = 128;

/** Parse group token from client input; empty when absent or absurdly long (preview-safe). */
function parseGroupToken(value?: string | null): string {
  const token = value?.trim() || "";
  if (token.length > MAX_GROUP_SHARE_TOKEN_LEN) return "";
  return token;
}

/** Join paths reject oversized tokens explicitly. */
function normalizeGroupToken(value?: string | null): string {
  const token = value?.trim() || "";
  if (token.length > MAX_GROUP_SHARE_TOKEN_LEN) {
    throw new Error("Invalid or expired group link");
  }
  return token;
}

/** Group links only work once the coordinator has accepted (matches coordinator invite RBAC). */
function isActiveGroupCoordinator(row: {
  role: string;
  canInviteMembers: boolean;
  status: string;
}): boolean {
  if (!row.canInviteMembers && row.role !== "coordinator") return false;
  return row.status === "accepted" || row.status === "completed";
}

/** Prisma filter for a coordinator row by reusable group share token. */
function coordinatorShareTokenWhere(campaignId: string, shareToken: string) {
  return {
    campaignId,
    shareToken,
    canInviteMembers: true,
  } as const;
}

/** Prefer completed > accepted > open invite > expired invite when deduping by campaign. */
function customerParticipationRank(
  status: string,
  inviteExpired: boolean
): number {
  if (status === "completed") return 4;
  if (status === "accepted") return 3;
  if (status === "invited" && !inviteExpired) return 2;
  if (status === "invited") return 1;
  return 0;
}

function participationActivityTime(row: {
  submittedAt?: Date | null;
  acceptedAt?: Date | null;
  invitedAt: Date;
}): number {
  return (
    row.submittedAt?.getTime() ??
    row.acceptedAt?.getTime() ??
    row.invitedAt.getTime()
  );
}

/** Unused sponsored scans are forfeited once measurements are submitted. */
function sponsoredScansRemainingForParticipant(
  status: string,
  allocated: number,
  used: number
): number {
  if (status === "completed") return 0;
  return Math.max(0, allocated - used);
}

function iso(d?: Date | null): string | undefined {
  return d ? new Date(d).toISOString() : undefined;
}

const campaignParticipantLookupSelect = {
  id: true,
  userId: true,
  email: true,
  status: true,
  fullName: true,
  acceptedAt: true,
  inviteExpiresAt: true,
  aiScansAllocated: true,
  aiScansUsed: true,
  role: true,
  canInviteMembers: true,
} as const;

/** Resolve a participant row for a signed-in customer on a campaign join/submit flow. */
async function findCampaignParticipantForUser(
  campaignId: string,
  opts: { userId: string; userEmail?: string; inviteToken?: string }
) {
  const userEmail = opts.userEmail?.trim().toLowerCase() || "";
  const inviteToken = opts.inviteToken?.trim() || "";
  const orderBy = [
    { submittedAt: "desc" as const },
    { acceptedAt: "desc" as const },
    { invitedAt: "desc" as const },
  ];

  const byUserId = await prisma.campaignParticipant.findFirst({
    where: { campaignId, userId: opts.userId },
    orderBy,
    select: campaignParticipantLookupSelect,
  });
  if (byUserId) {
    // userId link is authoritative — do not reject when account email changed after join.
    return byUserId;
  }

  if (userEmail) {
    const byEmail = await prisma.campaignParticipant.findFirst({
      where: {
        campaignId,
        email: userEmail,
        OR: [{ userId: null }, { userId: opts.userId }],
      },
      orderBy,
      select: campaignParticipantLookupSelect,
    });
    if (byEmail) {
      assertActorOwnsParticipant(byEmail, opts.userId, userEmail);
      return byEmail;
    }
  }

  if (inviteToken && userEmail) {
    const byToken = await prisma.campaignParticipant.findFirst({
      where: {
        campaignId,
        inviteToken,
        OR: [{ userId: null }, { userId: opts.userId }],
      },
      orderBy,
      select: campaignParticipantLookupSelect,
    });
    if (byToken) {
      assertActorOwnsParticipant(byToken, opts.userId, userEmail);
      return byToken;
    }
  }

  return null;
}

/** Persisted campaign rows are canonical; notification/email failures must not fail the workflow. */
async function notifyCampaignOwnerBestEffort(
  ownerUserId: string | null | undefined,
  title: string,
  message: string,
  metadata: {
    campaignId: string;
    participantId: string;
    coordinatorParticipantId?: string;
  }
): Promise<void> {
  await notifyParticipantBestEffort(ownerUserId, title, message, metadata);
}

/** Best-effort in-app notification when a participant userId is known. */
async function notifyParticipantBestEffort(
  userId: string | null | undefined,
  title: string,
  message: string,
  metadata: {
    campaignId: string;
    participantId: string;
    coordinatorParticipantId?: string;
  }
): Promise<void> {
  const uid = userId?.trim();
  if (!uid) return;
  try {
    await createNotification(uid, title, message, "campaign", metadata);
  } catch (err) {
    console.warn("[measurement-campaigns] participant notification failed:", err);
  }
}

async function notifyCoordinatorBestEffort(
  coordinatorParticipantId: string,
  title: string,
  message: string,
  metadata: {
    campaignId: string;
    participantId: string;
    coordinatorParticipantId?: string;
  }
): Promise<void> {
  const coord = await prisma.campaignParticipant.findFirst({
    where: { id: coordinatorParticipantId },
    select: { userId: true },
  });
  await notifyParticipantBestEffort(coord?.userId, title, message, {
    ...metadata,
    coordinatorParticipantId,
  });
}

/** Reject impossible campaign windows (expiry before start). */
function assertCampaignSchedule(
  startDate: Date,
  expiryDate: Date | null | undefined
) {
  if (expiryDate && expiryDate.getTime() < startDate.getTime()) {
    throw new Error("Expiry date must be on or after the start date");
  }
}

/** Active + past expiry is stored as expired (same outcome as join/public). */
function resolveStatusForWrite(
  status: string,
  expiryDate: Date | null | undefined
): MeasurementCampaignDto["status"] {
  if (
    status === "active" &&
    expiryDate &&
    expiryDate.getTime() < Date.now()
  ) {
    return "expired";
  }
  return status as MeasurementCampaignDto["status"];
}

/**
 * Persist soft-expired actives so list filters, join, and DTO status stay aligned.
 * Scoped to one tailor when provided.
 */
async function persistPastDueCampaigns(tailorProfileId?: string): Promise<void> {
  const now = new Date();
  await prisma.measurementCampaign.updateMany({
    where: {
      ...(tailorProfileId ? { tailorProfileId } : {}),
      status: "active",
      expiryDate: { lt: now },
    },
    data: { status: "expired" },
  });
}

function computeStats(
  participants: CampaignRow["participants"] = []
): CampaignStatsDto {
  const invited = participants.length;
  const accepted = participants.filter(
    (p) => p.status === "accepted" || p.status === "completed"
  ).length;
  const completed = participants.filter((p) => p.status === "completed").length;
  const pending = participants.filter((p) => p.status === "invited").length;
  const completionPercent =
    invited > 0 ? Math.round((completed / invited) * 100) : 0;
  return { invited, accepted, completed, pending, completionPercent };
}

function toMeasurementSnapshot(
  raw: unknown
): CampaignMeasurementSnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const label = typeof o.label === "string" ? o.label.trim() : "";
  const unit = typeof o.unit === "string" ? o.unit.trim() : "cm";
  const measurements = measurementsRecord(o.measurements);
  if (!label && Object.keys(measurements).length === 0) return undefined;
  return {
    label: label || "Measurements",
    unit: unit || "cm",
    gender: typeof o.gender === "string" ? o.gender : undefined,
    measurements,
  };
}

function toParticipantDto(
  p: NonNullable<CampaignRow["participants"]>[number] & {
    measurementSnapshot?: unknown;
    invitedByName?: string;
    inviteeCount?: number;
    inviteeCompletedCount?: number;
  }
): CampaignParticipantDto {
  return {
    _id: p.id,
    fullName: p.fullName,
    email: p.email ?? undefined,
    phone: p.phone ?? undefined,
    channel: p.channel as CampaignParticipantDto["channel"],
    status: p.status as CampaignParticipantDto["status"],
    role: (p.role ?? "direct") as CampaignParticipantDto["role"],
    canInviteMembers: p.canInviteMembers ?? false,
    invitedByParticipantId: p.invitedByParticipantId ?? undefined,
    invitedByName: p.invitedByName,
    coordinatorGroupLabel: p.coordinatorGroupLabel ?? undefined,
    inviteeCount: p.inviteeCount,
    inviteeCompletedCount: p.inviteeCompletedCount,
    aiScansAllocated: p.aiScansAllocated,
    aiScansUsed: p.aiScansUsed,
    invitedAt: iso(p.invitedAt) ?? new Date().toISOString(),
    acceptedAt: iso(p.acceptedAt),
    submittedAt: iso(p.submittedAt),
    measurementSnapshot: toMeasurementSnapshot(p.measurementSnapshot),
  };
}

/** In-memory DTO build when all campaign participants are already loaded (tree view). */
function toParticipantDtosInMemory(
  participants: NonNullable<CampaignRow["participants"]>
): CampaignParticipantDto[] {
  const nameById = new Map(
    participants.map((p) => [p.id, p.fullName.trim()] as const)
  );
  return participants.map((p) => {
    const parentId = p.invitedByParticipantId?.trim();
    return toParticipantDto({
      ...p,
      invitedByName: parentId ? nameById.get(parentId) : undefined,
    });
  });
}

/** Single-snapshot participant list — hierarchy counts match tree partition. */
function buildCampaignParticipantDtos(
  participants: NonNullable<CampaignRow["participants"]>
): CampaignParticipantDto[] {
  const allDtos = toParticipantDtosInMemory(participants);
  const { inviteesByCoordinatorId } = partitionCampaignParticipants(allDtos);
  return allDtos.map((p) => {
    if (p.role !== "coordinator" && !p.canInviteMembers) return p;
    const invitees = inviteesByCoordinatorId.get(p._id) ?? [];
    return {
      ...p,
      inviteeCount: invitees.length,
      inviteeCompletedCount: invitees.filter((i) => i.status === "completed")
        .length,
    };
  });
}

function creditsAvailable(row: {
  aiCreditsPurchased: number;
  aiCreditsUsed: number;
  aiCreditsReserved: number;
}): number {
  return Math.max(
    0,
    row.aiCreditsPurchased - row.aiCreditsUsed - row.aiCreditsReserved
  );
}

function assertCreditsAvailable(
  row: {
    aiCreditsPurchased: number;
    aiCreditsUsed: number;
    aiCreditsReserved: number;
  },
  needed: number
) {
  if (needed <= 0) return;
  const available = creditsAvailable(row);
  if (needed > available) {
    throw new Error(
      `Not enough credits. ${available} available, ${needed} needed.`
    );
  }
}

/** Adjust campaign reserved credits; releases are capped to avoid negative wallets. */
async function applyCampaignCreditsReserveDelta(
  tx: Prisma.TransactionClient,
  campaignId: string,
  delta: number
): Promise<void> {
  if (delta === 0) return;
  if (delta > 0) {
    await tx.measurementCampaign.update({
      where: { id: campaignId },
      data: { aiCreditsReserved: { increment: delta } },
    });
    return;
  }
  const release = -delta;
  const released = await tx.measurementCampaign.updateMany({
    where: { id: campaignId, aiCreditsReserved: { gte: release } },
    data: { aiCreditsReserved: { decrement: release } },
  });
  if (released.count === 0) {
    const wallet = await tx.measurementCampaign.findFirst({
      where: { id: campaignId },
      select: { aiCreditsReserved: true },
    });
    const partial = Math.min(
      release,
      Math.max(0, wallet?.aiCreditsReserved ?? 0)
    );
    if (partial > 0) {
      await tx.measurementCampaign.update({
        where: { id: campaignId },
        data: { aiCreditsReserved: { decrement: partial } },
      });
    }
  }
}

async function assertApprovedTailorForActiveCampaign(
  tailorProfileId: string
): Promise<void> {
  const profile = await prisma.tailorProfile.findFirst({
    where: { id: tailorProfileId },
    select: { status: true },
  });
  if (!profile || profile.status !== "approved") {
    const { ForbiddenError } = await import("@/lib/auth/http-error");
    throw new ForbiddenError(
      "Your tailor profile must be approved before publishing campaigns"
    );
  }
}

function clampParticipantName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "Participant";
  return trimmed.slice(0, 120);
}

/** Personal invite links must be claimed by the invited email (token alone is not enough). */
function assertInviteeEmailMatches(
  invitedEmail: string | null | undefined,
  actorEmail: string
): void {
  const invited = invitedEmail?.trim().toLowerCase();
  if (!invited) return;
  const actor = actorEmail.trim().toLowerCase();
  if (!actor || actor !== invited) {
    throw new Error(
      "Sign in with the email address that received this invitation"
    );
  }
}

/** Verified account email from DB — canonical for invite/participant matching. */
export async function resolveCampaignActorAccount(
  userId: string
): Promise<{ email: string }> {
  if (!isValidId(userId)) {
    throw new Error("You are not a participant in this campaign");
  }
  const user = await prisma.user.findFirst({
    where: { id: userId },
    select: { isVerified: true, email: true },
  });
  if (!user?.isVerified) {
    throw new Error(
      "Add a verified email to your account before joining this campaign"
    );
  }
  const email = user.email?.trim().toLowerCase() || "";
  if (!email) {
    throw new Error(
      "Add a verified email to your account before joining this campaign"
    );
  }
  return { email };
}

/** Ensure the signed-in actor may act on this participant row (no token/email hijack). */
function assertActorOwnsParticipant(
  row: { userId: string | null; email: string | null },
  actorUserId: string,
  actorEmail: string
): void {
  if (row.userId) {
    if (row.userId !== actorUserId) {
      throw new Error("You are not a participant in this campaign");
    }
    return;
  }
  assertInviteeEmailMatches(row.email, actorEmail);
}

/** Display status stays consistent with join/public rules when past expiry. */
function effectiveCampaignStatus(
  status: string,
  expiryDate?: Date | null
): MeasurementCampaignDto["status"] {
  if (
    status === "active" &&
    expiryDate &&
    expiryDate.getTime() < Date.now()
  ) {
    return "expired";
  }
  return status as MeasurementCampaignDto["status"];
}

export function toCampaignDto(
  row: CampaignRow,
  ownerLabel = "You"
): MeasurementCampaignDto {
  const participants = row.participants ?? [];
  const stats = computeStats(participants);
  const available = creditsAvailable(row);
  return {
    _id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category,
    description: row.description ?? undefined,
    eventDate: iso(row.eventDate),
    venue: row.venue ?? undefined,
    startDate: iso(row.startDate) ?? new Date().toISOString(),
    expiryDate: iso(row.expiryDate),
    status: effectiveCampaignStatus(row.status, row.expiryDate),
    instructions: row.instructions ?? undefined,
    sponsoredScansPerInvitee: row.sponsoredScansPerInvitee,
    logoUrl: row.logoUrl ?? undefined,
    coverImageUrl: row.coverImageUrl ?? undefined,
    aiCreditsPurchased: row.aiCreditsPurchased,
    aiCreditsUsed: row.aiCreditsUsed,
    aiCreditsReserved: row.aiCreditsReserved,
    aiCreditsAvailable: available,
    customCategories: row.customCategories ?? [],
    ownerLabel,
    participantCount: participants.length,
    stats,
    joinPath: `/join/${row.slug}`,
    createdAt: iso(row.createdAt) ?? new Date().toISOString(),
    updatedAt: iso(row.updatedAt) ?? new Date().toISOString(),
  };
}

async function uniqueCampaignSlug(base: string): Promise<string> {
  const root = slugifyTailorName(base) || "campaign";
  for (let i = 0; i < 20; i++) {
    const suffix = i === 0 ? "" : `-${i + 1}`;
    const slug = `${root}${suffix}`.slice(0, 60);
    const exists = await prisma.measurementCampaign.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!exists) return slug;
  }
  return `${root}-${randomBytes(3).toString("hex")}`;
}

function inviteToken(): string {
  return randomBytes(24).toString("hex");
}

function generateShareToken(): string {
  return inviteToken();
}

function buildGroupJoinPath(slug: string, shareToken: string): string {
  return `/join/${slug}?group=${encodeURIComponent(shareToken)}`;
}

function buildInviteJoinPath(slug: string, token: string): string {
  return `/join/${slug}?invite=${encodeURIComponent(token)}`;
}

async function loadInvitedByName(
  invitedByParticipantId?: string | null
): Promise<string | undefined> {
  const id = invitedByParticipantId?.trim();
  if (!id) return undefined;
  const row = await prisma.campaignParticipant.findFirst({
    where: { id },
    select: { fullName: true },
  });
  const name = row?.fullName?.trim();
  return name || undefined;
}

export async function assertCoordinatorCanInvite(participant: {
  role: string;
  canInviteMembers: boolean;
  status: string;
  campaignId: string;
}): Promise<void> {
  assertCoordinatorIdentity(participant);
  const campaign = await prisma.measurementCampaign.findFirst({
    where: { id: participant.campaignId },
    select: { startDate: true, expiryDate: true, status: true },
  });
  if (!campaign || campaign.status !== "active") {
    throw new Error("This campaign is not accepting participation");
  }
  assertCampaignOpenForParticipation(campaign);
}

function assertCoordinatorIdentity(participant: {
  role: string;
  canInviteMembers: boolean;
  status: string;
}): void {
  if (!participant.canInviteMembers && participant.role !== "coordinator") {
    throw new Error("You cannot invite members for this campaign");
  }
  if (participant.status !== "accepted" && participant.status !== "completed") {
    throw new Error("Accept the campaign invitation before inviting members");
  }
}

function assertCoordinatorCampaignReadable(campaign: {
  status: string;
  tailorProfile: { status: string };
}): void {
  if (campaign.status === "archived") {
    throw new Error("This campaign is not accepting participation");
  }
  if (campaign.tailorProfile.status !== "approved") {
    throw new Error("This campaign is not accepting participation");
  }
}

/** Coordinators get a reusable group link token once provisioned. */
export async function ensureCoordinatorShareToken(
  participantId: string
): Promise<string> {
  await dbConnect();
  const row = await prisma.campaignParticipant.findFirst({
    where: { id: participantId },
    select: {
      id: true,
      role: true,
      canInviteMembers: true,
      shareToken: true,
    },
  });
  if (!row) throw new Error("Participant not found");
  if (row.role !== "coordinator" && !row.canInviteMembers) {
    throw new Error("Not a campaign coordinator");
  }
  const existing = row.shareToken?.trim();
  if (existing) return existing;

  for (let attempt = 0; attempt < 5; attempt++) {
    const token = generateShareToken();
    try {
      const updated = await prisma.campaignParticipant.update({
        where: { id: participantId },
        data: { shareToken: token },
        select: { shareToken: true },
      });
      const next = updated.shareToken?.trim();
      if (next) return next;
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code: unknown }).code)
          : "";
      if (code === "P2002") continue;
      throw err;
    }
  }
  throw new Error("Could not provision group link; please try again");
}

type CoordinatorActorContext = {
  participant: {
    id: string;
    fullName: string;
    role: string;
    canInviteMembers: boolean;
    status: string;
    campaignId: string;
    coordinatorGroupLabel: string | null;
    userId: string | null;
    email: string | null;
  };
  email: string;
  campaign: {
    id: string;
    slug: string;
    name: string;
    expiryDate: Date | null;
    status: string;
    sponsoredScansPerInvitee: number;
    tailorProfile: { displayName: string; status: string };
  };
};

async function loadCoordinatorActorContext(
  userId: string,
  participantId: string,
  opts?: { requireOpenCampaign?: boolean }
): Promise<CoordinatorActorContext> {
  await dbConnect();
  await persistPastDueCampaigns();
  if (!isValidId(participantId)) {
    throw new Error("You are not a participant in this campaign");
  }
  const { email } = await resolveCampaignActorAccount(userId);
  const participant = await prisma.campaignParticipant.findFirst({
    where: { id: participantId },
    select: {
      id: true,
      fullName: true,
      role: true,
      canInviteMembers: true,
      status: true,
      campaignId: true,
      coordinatorGroupLabel: true,
      userId: true,
      email: true,
      campaign: {
        select: {
          id: true,
          slug: true,
          name: true,
          expiryDate: true,
          status: true,
          sponsoredScansPerInvitee: true,
          tailorProfile: { select: { displayName: true, status: true } },
        },
      },
    },
  });
  if (!participant?.campaign) {
    throw new Error("You are not a participant in this campaign");
  }
  assertActorOwnsParticipant(participant, userId, email);
  assertCoordinatorIdentity(participant);
  if (opts?.requireOpenCampaign === false) {
    assertCoordinatorCampaignReadable(participant.campaign);
  } else {
    await assertCoordinatorCanInvite(participant);
  }
  return { participant, email, campaign: participant.campaign };
}

function toCoordinatorInviteeDto(
  row: {
    id: string;
    fullName: string;
    email?: string | null;
    status: string;
    invitedAt: Date;
    acceptedAt?: Date | null;
    submittedAt?: Date | null;
    inviteToken?: string | null;
    inviteExpiresAt?: Date | null;
  },
  slug: string
): CoordinatorInviteeDto {
  const token = row.inviteToken?.trim();
  const inviteOpen =
    row.status === "invited" &&
    isInviteStillOpen({
      status: row.status,
      inviteExpiresAt: row.inviteExpiresAt,
    });
  const showJoinPath = inviteOpen && Boolean(token);
  return {
    _id: row.id,
    fullName: row.fullName,
    email: row.email?.trim() || undefined,
    status: row.status as CoordinatorInviteeDto["status"],
    invitedAt: iso(row.invitedAt) ?? new Date().toISOString(),
    acceptedAt: iso(row.acceptedAt),
    submittedAt: iso(row.submittedAt),
    joinPath: showJoinPath ? buildInviteJoinPath(slug, token!) : undefined,
  };
}

function computeCoordinatorInviteeStats(
  rows: Array<{ status: string; inviteExpiresAt?: Date | null }>
): {
  total: number;
  completed: number;
  accepted: number;
  invited: number;
} {
  return {
    total: rows.length,
    completed: rows.filter((i) => i.status === "completed").length,
    accepted: rows.filter(
      (i) => i.status === "accepted" || i.status === "completed"
    ).length,
    invited: rows.filter(
      (i) =>
        i.status === "invited" &&
        isInviteStillOpen({
          status: i.status,
          inviteExpiresAt: i.inviteExpiresAt,
        })
    ).length,
  };
}

/** RBAC-checked coordinator row + campaign metadata. */
export async function getCoordinatorContext(
  userId: string,
  participantId: string
): Promise<{
  participantId: string;
  campaignId: string;
  campaignSlug: string;
  campaignName: string;
  coordinatorName: string;
  coordinatorGroupLabel?: string;
  tailorName: string;
}> {
  const ctx = await loadCoordinatorActorContext(userId, participantId, {
    requireOpenCampaign: false,
  });
  return {
    participantId: ctx.participant.id,
    campaignId: ctx.campaign.id,
    campaignSlug: ctx.campaign.slug,
    campaignName: ctx.campaign.name,
    coordinatorName: ctx.participant.fullName,
    coordinatorGroupLabel:
      ctx.participant.coordinatorGroupLabel?.trim() || undefined,
    tailorName: ctx.campaign.tailorProfile.displayName,
  };
}

/** List members invited by the signed-in coordinator. */
export async function listCoordinatorInvitees(
  userId: string,
  participantId: string
): Promise<{
  invitees: CoordinatorInviteeDto[];
  groupJoinPath: string;
  shareToken: string;
  stats: {
    total: number;
    completed: number;
    accepted: number;
    invited: number;
  };
}> {
  const ctx = await loadCoordinatorActorContext(userId, participantId, {
    requireOpenCampaign: false,
  });
  const shareToken = await ensureCoordinatorShareToken(ctx.participant.id);
  const groupJoinPath = buildGroupJoinPath(ctx.campaign.slug, shareToken);
  const inviteeRows = await prisma.campaignParticipant.findMany({
    where: { invitedByParticipantId: ctx.participant.id },
    orderBy: { invitedAt: "asc" },
    select: {
      id: true,
      fullName: true,
      email: true,
      status: true,
      invitedAt: true,
      acceptedAt: true,
      submittedAt: true,
      inviteToken: true,
      inviteExpiresAt: true,
    },
  });
  return {
    invitees: inviteeRows.map((row) =>
      toCoordinatorInviteeDto(row, ctx.campaign.slug)
    ),
    groupJoinPath,
    shareToken,
    stats: computeCoordinatorInviteeStats(inviteeRows),
  };
}

/** Coordinator invites individual members (email or link-only). Credits reserved on join, not invite. */
export async function inviteMembersAsCoordinator(
  userId: string,
  participantId: string,
  raw: unknown
): Promise<{
  invited: number;
  invitees: CoordinatorInviteeDto[];
  campaignId: string;
}> {
  await dbConnect();
  if (raw && typeof raw === "object" && Array.isArray((raw as { members?: unknown }).members)) {
    for (const member of (raw as { members: unknown[] }).members) {
      if (
        member &&
        typeof member === "object" &&
        (member as { role?: string }).role === "coordinator"
      ) {
        throw new Error("Coordinators cannot invite other coordinators");
      }
    }
  }
  const parsed = coordinatorInviteActionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ?? "Invalid invite payload"
    );
  }
  const input = parsed.data;
  const ctx = await loadCoordinatorActorContext(userId, participantId);

  const liveCampaign = await prisma.measurementCampaign.findFirst({
    where: { id: ctx.campaign.id },
    include: {
      tailorProfile: { select: { displayName: true } },
    },
  });
  if (!liveCampaign) {
    throw new Error("This campaign is not accepting participation");
  }

  let coordinatorGroupLabel =
    ctx.participant.coordinatorGroupLabel?.trim() || null;
  if (input.coordinatorGroupLabel?.trim()) {
    coordinatorGroupLabel = input.coordinatorGroupLabel.trim();
  }

  const emailMembers = input.members.filter((m) => m.email?.trim());
  const linkMembers = input.members.filter((m) => !m.email?.trim());

  const emails = emailMembers.map((m) => m.email!.trim().toLowerCase());
  if (emails.length !== new Set(emails).size) {
    throw new Error("Duplicate emails in invite list");
  }

  const now = new Date();
  const expiresAt = liveCampaign.expiryDate;
  if (expiresAt && expiresAt.getTime() < now.getTime()) {
    throw new Error("Cannot invite to an expired campaign");
  }

  const existingRows =
    emails.length > 0
      ? await prisma.campaignParticipant.findMany({
          where: { campaignId: liveCampaign.id, email: { in: emails } },
        })
      : [];

  const blockedEmails: string[] = [];
  const reinviteRows: typeof existingRows = [];
  for (const row of existingRows) {
    const rowEmail = row.email?.toLowerCase();
    if (!rowEmail) continue;
    if (row.role === "coordinator") {
      blockedEmails.push(rowEmail);
      continue;
    }
    if (row.status === "completed" || row.status === "accepted") {
      blockedEmails.push(rowEmail);
      continue;
    }
    if (row.status === "invited") {
      if (isInviteStillOpen(row)) {
        blockedEmails.push(rowEmail);
      } else if (
        row.invitedByParticipantId === ctx.participant.id &&
        row.role === "member"
      ) {
        reinviteRows.push(row);
      } else {
        blockedEmails.push(rowEmail);
      }
    }
  }
  if (blockedEmails.length > 0) {
    throw new Error(
      `Already invited: ${Array.from(new Set(blockedEmails)).join(", ")}`
    );
  }

  const reinviteEmails = new Set(
    reinviteRows.map((r) => r.email?.toLowerCase()).filter(Boolean) as string[]
  );
  const personByEmail = new Map(
    emailMembers.map((p) => [p.email!.trim().toLowerCase(), p] as const)
  );
  const newEmailInvites = emailMembers.filter(
    (p) => !reinviteEmails.has(p.email!.trim().toLowerCase())
  );

  const created = await prisma.$transaction(async (tx) => {
    if (input.coordinatorGroupLabel?.trim()) {
      const trimmedLabel = input.coordinatorGroupLabel.trim();
      coordinatorGroupLabel = trimmedLabel;
      await tx.campaignParticipant.update({
        where: { id: ctx.participant.id },
        data: { coordinatorGroupLabel: trimmedLabel },
      });
      await tx.campaignParticipant.updateMany({
        where: { invitedByParticipantId: ctx.participant.id },
        data: { coordinatorGroupLabel: trimmedLabel },
      });
    }

    const rows = [];
    let creditsToRelease = 0;
    for (const row of reinviteRows) {
      const rowEmail = row.email?.toLowerCase();
      const person = rowEmail ? personByEmail.get(rowEmail) : undefined;
      if (!person) continue;
      const prevAlloc = Math.max(0, row.aiScansAllocated);
      if (prevAlloc > 0) creditsToRelease += prevAlloc;
      const updated = await tx.campaignParticipant.update({
        where: { id: row.id },
        data: {
          fullName: person.fullName,
          channel: "email",
          status: "invited",
          role: "member",
          canInviteMembers: false,
          shareToken: null,
          invitedByParticipantId: ctx.participant.id,
          coordinatorGroupLabel,
          aiScansAllocated: 0,
          aiScansUsed: 0,
          inviteToken: inviteToken(),
          inviteExpiresAt: expiresAt ?? null,
          invitedAt: now,
          lastRemindedAt: null,
          userId: null,
          acceptedAt: null,
          submittedAt: null,
          measurementProfileId: null,
          measurementSnapshot: Prisma.JsonNull,
        },
      });
      rows.push(updated);
    }
    for (const p of newEmailInvites) {
      const row = await tx.campaignParticipant.create({
        data: {
          campaignId: liveCampaign.id,
          fullName: p.fullName,
          email: p.email!.trim().toLowerCase(),
          channel: "email",
          status: "invited",
          role: "member",
          canInviteMembers: false,
          invitedByParticipantId: ctx.participant.id,
          coordinatorGroupLabel,
          aiScansAllocated: 0,
          inviteToken: inviteToken(),
          inviteExpiresAt: expiresAt ?? null,
        },
      });
      rows.push(row);
    }
    for (const p of linkMembers) {
      const row = await tx.campaignParticipant.create({
        data: {
          campaignId: liveCampaign.id,
          fullName: p.fullName,
          channel: "link",
          status: "invited",
          role: "member",
          canInviteMembers: false,
          invitedByParticipantId: ctx.participant.id,
          coordinatorGroupLabel,
          aiScansAllocated: 0,
          inviteToken: inviteToken(),
          inviteExpiresAt: expiresAt ?? null,
        },
      });
      rows.push(row);
    }
    if (creditsToRelease > 0) {
      const released = await tx.measurementCampaign.updateMany({
        where: {
          id: liveCampaign.id,
          aiCreditsReserved: { gte: creditsToRelease },
        },
        data: { aiCreditsReserved: { decrement: creditsToRelease } },
      });
      if (released.count === 0) {
        // Best-effort partial release for legacy wallet drift — never block reinvite.
        const wallet = await tx.measurementCampaign.findFirst({
          where: { id: liveCampaign.id },
          select: { aiCreditsReserved: true },
        });
        const partial = Math.min(
          creditsToRelease,
          Math.max(0, wallet?.aiCreditsReserved ?? 0)
        );
        if (partial > 0) {
          await tx.measurementCampaign.update({
            where: { id: liveCampaign.id },
            data: { aiCreditsReserved: { decrement: partial } },
          });
        }
      }
    }
    return rows;
  });

  const siteUrl = (
    process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"
  ).replace(/\/$/, "");
  const { sendCoordinatorMemberInviteEmail } = await import("@/lib/mailer");
  await Promise.allSettled(
    created.map((row) => {
      if (!row.email || !row.inviteToken) return Promise.resolve();
      const joinUrl = `${siteUrl}${buildInviteJoinPath(
        liveCampaign.slug,
        row.inviteToken
      )}`;
      return sendCoordinatorMemberInviteEmail({
        to: row.email,
        fullName: row.fullName,
        coordinatorName: ctx.participant.fullName,
        campaignName: liveCampaign.name,
        tailorName: liveCampaign.tailorProfile.displayName,
        joinUrl,
        expiresAt: expiresAt ? expiresAt.toISOString() : undefined,
        orgId: liveCampaign.orgId,
      }).catch((err) => {
        console.error("[campaigns] coordinator member invite email failed:", err);
        throw err;
      });
    })
  );

  return {
    invited: created.length,
    invitees: created.map((row) =>
      toCoordinatorInviteeDto(row, liveCampaign.slug)
    ),
    campaignId: liveCampaign.id,
  };
}

/** Update the coordinator's group label (and existing invitees). */
export async function setCoordinatorGroupLabel(
  userId: string,
  participantId: string,
  label: string
): Promise<{ coordinatorGroupLabel: string; campaignId: string }> {
  const trimmed = label.trim();
  if (!trimmed) {
    throw new Error("Group label is required");
  }
  const ctx = await loadCoordinatorActorContext(userId, participantId);
  await prisma.$transaction([
    prisma.campaignParticipant.update({
      where: { id: ctx.participant.id },
      data: { coordinatorGroupLabel: trimmed },
    }),
    prisma.campaignParticipant.updateMany({
      where: { invitedByParticipantId: ctx.participant.id },
      data: { coordinatorGroupLabel: trimmed },
    }),
  ]);
  return { coordinatorGroupLabel: trimmed, campaignId: ctx.campaign.id };
}

/** Coordinator reusable group join link (RBAC-checked). */
export async function getCoordinatorGroupLinkForActor(
  userId: string,
  participantId: string
): Promise<{ groupJoinPath: string; shareToken: string }> {
  const ctx = await loadCoordinatorActorContext(userId, participantId, {
    requireOpenCampaign: false,
  });
  const shareToken = await ensureCoordinatorShareToken(ctx.participant.id);
  return {
    groupJoinPath: buildGroupJoinPath(ctx.campaign.slug, shareToken),
    shareToken,
  };
}

function resolveParticipantInviteRole(
  personRole?: CampaignParticipantRole,
  defaultRole: CampaignParticipantRole = "direct"
): CampaignParticipantRole {
  return personRole ?? defaultRole;
}

/** Role + coordinator flags when tailor (or API) creates/reinvites a participant row.
 * FUTURE: tailor demotion of coordinators (role → direct, revoke canInviteMembers,
 * clear shareToken) is not in v1 — roles are set only at invite time.
 */
function buildParticipantRoleInviteData(
  role: CampaignParticipantRole,
  existingShareToken?: string | null
): {
  role: CampaignParticipantRole;
  canInviteMembers: boolean;
  shareToken: string | null;
} {
  if (role === "coordinator") {
    return {
      role: "coordinator",
      canInviteMembers: true,
      shareToken: existingShareToken?.trim() || generateShareToken(),
    };
  }
  if (role === "member") {
    return {
      role: "member",
      canInviteMembers: false,
      shareToken: null,
    };
  }
  return {
    role: "direct",
    canInviteMembers: false,
    shareToken: null,
  };
}

/** Persist custom category labels on the campaign for reuse in the form. */
function mergeCustomCategories(
  category: string,
  existing: string[] = []
): string[] {
  const defaults = DEFAULT_CAMPAIGN_CATEGORIES as readonly string[];
  if (defaults.includes(category)) return existing;
  if (existing.includes(category)) return existing;
  return [...existing, category];
}

const campaignParticipantHierarchySelect = {
  role: true,
  canInviteMembers: true,
  shareToken: true,
  invitedByParticipantId: true,
  coordinatorGroupLabel: true,
} as const;

/** Participant fields for campaign list/stats (no PII snapshots). */
const participantSummarySelect = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  channel: true,
  status: true,
  aiScansAllocated: true,
  aiScansUsed: true,
  invitedAt: true,
  acceptedAt: true,
  submittedAt: true,
  ...campaignParticipantHierarchySelect,
} as const;

/** Participant fields for the dedicated participants API (includes measurement snapshot). */
const participantDetailSelect = {
  ...participantSummarySelect,
  measurementSnapshot: true,
} as const;

export async function listCampaignsForTailor(
  tailorProfileId: string,
  opts?: PaginationOpts & {
    q?: string;
    status?: string;
    category?: string;
    sort?: "newest" | "oldest" | "name";
  }
) {
  await dbConnect();
  await persistPastDueCampaigns(tailorProfileId);
  const page = Math.max(1, opts?.page ?? 1);
  const limit = Math.min(50, Math.max(1, opts?.limit ?? 20));
  const skip = (page - 1) * limit;
  const q = opts?.q?.trim();
  const now = new Date();
  const statusFilter = opts?.status && opts.status !== "all" ? opts.status : null;

  // Keep list filters aligned with effectiveCampaignStatus (past-due active → expired).
  const andClauses: Record<string, unknown>[] = [];
  if (statusFilter === "expired") {
    // Include both persisted expired and any race soft-expired actives.
    andClauses.push({
      OR: [
        { status: "expired" },
        { status: "active", expiryDate: { lt: now } },
      ],
    });
  } else if (statusFilter === "active") {
    andClauses.push({
      status: "active",
      OR: [{ expiryDate: null }, { expiryDate: { gte: now } }],
    });
  } else if (statusFilter) {
    andClauses.push({ status: statusFilter });
  }
  if (opts?.category && opts.category !== "all") {
    andClauses.push({ category: opts.category });
  }
  if (q) {
    andClauses.push({
      OR: [
        { name: { contains: q, mode: "insensitive" as const } },
        { description: { contains: q, mode: "insensitive" as const } },
      ],
    });
  }

  const where = {
    tailorProfileId,
    ...(andClauses.length ? { AND: andClauses } : {}),
  };
  const orderBy =
    opts?.sort === "oldest"
      ? { createdAt: "asc" as const }
      : opts?.sort === "name"
        ? { name: "asc" as const }
        : { createdAt: "desc" as const };

  const [total, rows] = await Promise.all([
    prisma.measurementCampaign.count({ where }),
    prisma.measurementCampaign.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      include: {
        participants: {
          select: participantSummarySelect,
        },
      },
    }),
  ]);

  const profile = await prisma.tailorProfile.findUnique({
    where: { id: tailorProfileId },
    select: { orgId: true },
  });
  const {
    resolveOrgPlanId,
    resolveOrgPlanResourceCap,
    countPlanResource,
    isCompanyBillingCreateEntitled,
  } = await import("@/lib/planLimits");
  // Missing org is a broken profile — fail-closed for UI (0 slots) to match create.
  const planLimit = profile?.orgId
    ? await resolveOrgPlanResourceCap(profile.orgId, "campaigns")
    : 0;
  const planUsed = profile?.orgId
    ? await countPlanResource(profile.orgId, "campaigns")
    : total;
  const resolved = profile?.orgId
    ? await resolveOrgPlanId(profile.orgId)
    : null;
  const planResolved = resolved?.planResolved ?? null;
  const billingEntitled = resolved
    ? isCompanyBillingCreateEntitled({
        subscriptionStatus: resolved.subscriptionStatus,
        subscriptionEndsAt: resolved.subscriptionEndsAt,
        orgStatus: resolved.orgStatus,
      })
    : false;

  return {
    campaigns: rows.map((r) => toCampaignDto(r)),
    ...paginatedMeta(page, limit, total),
    planLimit,
    planUsed,
    planResolved,
    billingEntitled,
  };
}

export async function getCampaignForTailor(
  tailorProfileId: string,
  campaignId: string
): Promise<MeasurementCampaignDto | null> {
  await dbConnect();
  await persistPastDueCampaigns(tailorProfileId);
  const row = await prisma.measurementCampaign.findFirst({
    where: { id: campaignId, tailorProfileId },
    include: {
      participants: {
        orderBy: { invitedAt: "desc" },
        select: participantSummarySelect,
      },
    },
  });
  if (!row) return null;
  return toCampaignDto(row);
}

export async function createCampaignForTailor(
  tailorProfileId: string,
  orgId: string,
  raw: unknown
): Promise<MeasurementCampaignDto> {
  await dbConnect();
  const parsed = campaignInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ?? "Invalid campaign data"
    );
  }
  const input = parsed.data;
  // Never trust a caller-supplied orgId that does not own this tailor profile —
  // mismatched ids could assert against an uncapped/storefront org while writing
  // under a different tenant's tailor.
  const profile = await prisma.tailorProfile.findUnique({
    where: { id: tailorProfileId },
    select: { orgId: true, status: true },
  });
  if (!profile?.orgId || profile.orgId !== orgId) {
    const { ForbiddenError } = await import("@/lib/auth/http-error");
    throw new ForbiddenError("Tailor profile does not belong to this organization");
  }
  if (profile.status === "suspended") {
    const { ForbiddenError } = await import("@/lib/auth/http-error");
    throw new ForbiddenError("Cannot create campaigns for a suspended tailor profile");
  }
  const startDate = parseCampaignStartDate(input.startDate) ?? new Date();
  const expiryDate = input.expiryDate?.trim()
    ? parseInviteExpiryDate(input.expiryDate) ?? null
    : null;
  assertCampaignSchedule(startDate, expiryDate);
  const status = resolveStatusForWrite(input.status, expiryDate);
  if (status === "active") {
    await assertApprovedTailorForActiveCampaign(tailorProfileId);
  }
  const { assertWithinPlanLimit } = await import("@/lib/planLimits");
  await assertWithinPlanLimit(profile.orgId, "campaigns");
  const slug = await uniqueCampaignSlug(input.name);
  const row = await prisma.measurementCampaign.create({
    data: {
      tailorProfileId,
      orgId: profile.orgId,
      slug,
      name: input.name,
      category: input.category,
      description: input.description || null,
      eventDate: parseDate(input.eventDate) ?? null,
      venue: input.venue || null,
      startDate,
      expiryDate,
      status,
      instructions: input.instructions || null,
      sponsoredScansPerInvitee: input.sponsoredScansPerInvitee,
      logoUrl: input.logoUrl || null,
      coverImageUrl: input.coverImageUrl || null,
      customCategories: mergeCustomCategories(input.category),
    },
    include: {
      participants: { select: participantSummarySelect },
    },
  });
  return toCampaignDto(row);
}

export async function updateCampaignForTailor(
  tailorProfileId: string,
  campaignId: string,
  raw: unknown
): Promise<MeasurementCampaignDto> {
  await dbConnect();
  const parsed = campaignInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ?? "Invalid campaign data"
    );
  }
  const input = parsed.data;
  const existing = await prisma.measurementCampaign.findFirst({
    where: { id: campaignId, tailorProfileId },
  });
  if (!existing) throw new Error("Campaign not found");

  const startDate =
    parseCampaignStartDate(input.startDate) ?? existing.startDate;
  const expiryDate = input.expiryDate?.trim()
    ? parseInviteExpiryDate(input.expiryDate) ?? null
    : null;
  assertCampaignSchedule(startDate, expiryDate);
  const nextStatus = resolveStatusForWrite(input.status, expiryDate);
  if (nextStatus === "active") {
    await assertApprovedTailorForActiveCampaign(tailorProfileId);
  }

  // Archive frees a plan slot; restoring archived → draft/active must re-check quota
  // (same rule as create — otherwise archive→create→unarchive overshoots).
  if (existing.status === "archived" && nextStatus !== "archived") {
    const orgId = existing.orgId;
    if (!orgId) {
      const { ForbiddenError } = await import("@/lib/auth/http-error");
      throw new ForbiddenError("Campaign is missing organization");
    }
    const { assertWithinPlanLimit } = await import("@/lib/planLimits");
    await assertWithinPlanLimit(orgId, "campaigns");
  }

  const row = await prisma.measurementCampaign.update({
    where: { id: campaignId },
    data: {
      name: input.name,
      category: input.category,
      description: input.description || null,
      eventDate: parseDate(input.eventDate) ?? null,
      venue: input.venue || null,
      startDate,
      expiryDate,
      status: nextStatus,
      instructions: input.instructions || null,
      sponsoredScansPerInvitee: input.sponsoredScansPerInvitee,
      logoUrl: input.logoUrl || null,
      coverImageUrl: input.coverImageUrl || null,
      customCategories: mergeCustomCategories(
        input.category,
        existing.customCategories
      ),
    },
    include: {
      participants: { select: participantSummarySelect },
    },
  });
  return toCampaignDto(row);
}

export async function archiveCampaignForTailor(
  tailorProfileId: string,
  campaignId: string
): Promise<MeasurementCampaignDto> {
  await dbConnect();
  const existing = await prisma.measurementCampaign.findFirst({
    where: { id: campaignId, tailorProfileId },
  });
  if (!existing) throw new Error("Campaign not found");
  const row = await prisma.measurementCampaign.update({
    where: { id: campaignId },
    data: { status: "archived" },
    include: {
      participants: { select: participantSummarySelect },
    },
  });
  return toCampaignDto(row);
}

export async function deleteCampaignForTailor(
  tailorProfileId: string,
  campaignId: string
): Promise<void> {
  await dbConnect();
  const existing = await prisma.measurementCampaign.findFirst({
    where: { id: campaignId, tailorProfileId },
  });
  if (!existing) throw new Error("Campaign not found");
  await prisma.measurementCampaign.delete({ where: { id: campaignId } });
}

export async function listCampaignParticipants(
  tailorProfileId: string,
  campaignId: string
): Promise<CampaignParticipantDto[]> {
  await dbConnect();
  if (!isValidId(campaignId)) throw new Error("Campaign not found");
  const campaign = await prisma.measurementCampaign.findFirst({
    where: { id: campaignId, tailorProfileId },
    include: {
      participants: {
        orderBy: { invitedAt: "desc" },
        select: participantDetailSelect,
      },
    },
  });
  if (!campaign) throw new Error("Campaign not found");
  return buildCampaignParticipantDtos(campaign.participants);
}

/** Hierarchical participant tree for tailor dashboard (?view=tree). */
export async function listCampaignParticipantsTree(
  tailorProfileId: string,
  campaignId: string
): Promise<CampaignParticipantsTreeDto> {
  await dbConnect();
  if (!isValidId(campaignId)) throw new Error("Campaign not found");
  const campaign = await prisma.measurementCampaign.findFirst({
    where: { id: campaignId, tailorProfileId },
    include: {
      participants: {
        orderBy: { invitedAt: "desc" },
        select: participantDetailSelect,
      },
    },
  });
  if (!campaign) throw new Error("Campaign not found");

  const allDtos = buildCampaignParticipantDtos(campaign.participants);

  const { coordinators: coordinatorsRaw, inviteesByCoordinatorId, direct } =
    partitionCampaignParticipants(allDtos);

  const coordinators: CampaignParticipantTreeNode[] = coordinatorsRaw
    .sort((a, b) => a.fullName.localeCompare(b.fullName, undefined, {
      sensitivity: "base",
    }))
    .map((coord) => ({
      ...coord,
      invitees: (inviteesByCoordinatorId.get(coord._id) ?? []).sort(
        compareParticipantsByInvitedAt
      ),
    }));

  const directSorted = [...direct].sort((a, b) =>
    a.fullName.localeCompare(b.fullName, undefined, { sensitivity: "base" })
  );

  const stats: CampaignParticipantsTreeStatsDto = {
    ...computeStats(campaign.participants),
    coordinators: coordinators.length,
    members: allDtos.filter((p) => p.role === "member").length,
    direct: directSorted.length,
  };

  return { coordinators, direct: directSorted, stats };
}

export async function inviteCampaignParticipants(
  tailorProfileId: string,
  ownerUserId: string,
  campaignId: string,
  raw: unknown
): Promise<{ invited: number; participants: CampaignParticipantDto[] }> {
  await dbConnect();
  const input = inviteParticipantsSchema.safeParse(raw);
  if (!input.success) {
    throw new Error(
      input.error.issues[0]?.message ?? "Invalid invite payload"
    );
  }
  const parsed = input.data;
  if (parsed.tailorClientId && !isValidId(parsed.tailorClientId)) {
    throw new Error("Invalid client id");
  }
  if (parsed.tailorClientId) {
    const rosterClient = await prisma.tailorClient.findFirst({
      where: { id: parsed.tailorClientId, tailorProfileId },
      select: { id: true },
    });
    if (!rosterClient) {
      throw new Error("Client not found");
    }
  }
  const defaultRole = parsed.defaultRole;
  const campaign = await prisma.measurementCampaign.findFirst({
    where: { id: campaignId, tailorProfileId },
  });
  if (!campaign) throw new Error("Campaign not found");
  await persistPastDueCampaigns(tailorProfileId);
  const live = await prisma.measurementCampaign.findFirst({
    where: { id: campaignId, tailorProfileId },
    include: {
      tailorProfile: { select: { displayName: true } },
    },
  });
  if (!live) throw new Error("Campaign not found");
  if (live.status === "archived") {
    throw new Error("Cannot invite to an archived campaign");
  }
  if (
    live.status === "expired" ||
    (live.expiryDate && live.expiryDate.getTime() < Date.now())
  ) {
    throw new Error("Cannot invite to an expired campaign");
  }
  if (live.status === "active") {
    await assertApprovedTailorForActiveCampaign(tailorProfileId);
  }

  const expiresAt = parseInviteExpiryDate(parsed.expiresAt) ?? live.expiryDate;
  if (expiresAt && expiresAt.getTime() < Date.now()) {
    throw new Error("Invitation expiry date is in the past");
  }

  const emails = parsed.participants.map((p) => p.email.toLowerCase());
  const duplicateInPayload = emails.length !== new Set(emails).size;
  if (duplicateInPayload) {
    throw new Error("Duplicate emails in invite list");
  }

  const now = new Date();
  const existingRows = await prisma.campaignParticipant.findMany({
    where: { campaignId, email: { in: emails } },
  });
  const blockedEmails: string[] = [];
  const reinviteRows: typeof existingRows = [];
  for (const row of existingRows) {
    const email = row.email?.toLowerCase();
    if (!email) continue;
    if (row.status === "completed" || row.status === "accepted") {
      blockedEmails.push(email);
      continue;
    }
    if (row.status === "invited") {
      if (isInviteStillOpen(row)) {
        blockedEmails.push(email);
      } else {
        reinviteRows.push(row);
      }
    }
  }
  if (blockedEmails.length > 0) {
    if (parsed.tailorClientId && parsed.participants.length === 1) {
      const person = parsed.participants[0];
      const email = person.email.toLowerCase();
      if (blockedEmails.includes(email)) {
        const existing = existingRows.find(
          (r) => r.email?.toLowerCase() === email
        );
        const inviteRole = resolveParticipantInviteRole(
          person.role,
          defaultRole
        );
        if (
          existing &&
          inviteRole === "coordinator" &&
          (existing.role === "coordinator" || existing.canInviteMembers)
        ) {
          await linkRosterClientToParticipantRecord(
            tailorProfileId,
            parsed.tailorClientId,
            existing
          );
          try {
            return {
              invited: 0,
              participants: await listCampaignParticipants(
                tailorProfileId,
                campaignId
              ),
            };
          } catch (err) {
            console.error(
              "[campaigns] post link-only participant reload failed:",
              err
            );
            return {
              invited: 0,
              participants: buildCampaignParticipantDtos([existing]),
            };
          }
        }
      }
    }
    throw new Error(
      `Already invited: ${Array.from(new Set(blockedEmails)).join(", ")}`
    );
  }

  const reinviteEmails = new Set(
    reinviteRows.map((r) => r.email?.toLowerCase()).filter(Boolean) as string[]
  );
  const personByEmail = new Map(
    parsed.participants.map((p) => [p.email.toLowerCase(), p] as const)
  );
  const newInvites = parsed.participants.filter(
    (p) => !reinviteEmails.has(p.email.toLowerCase())
  );

  const scansEach = live.sponsoredScansPerInvitee;
  let reserveDelta = scansEach * newInvites.length;
  for (const row of reinviteRows) {
    reserveDelta += scansEach - row.aiScansAllocated;
  }

  const created = await prisma.$transaction(async (tx) => {
    const wallet = await tx.measurementCampaign.findFirst({
      where: { id: campaignId },
      select: {
        aiCreditsPurchased: true,
        aiCreditsUsed: true,
        aiCreditsReserved: true,
      },
    });
    if (!wallet) throw new Error("Campaign not found");
    if (reserveDelta > 0) {
      assertCreditsAvailable(wallet, reserveDelta);
    }

    const rows = [];
    for (const row of reinviteRows) {
      const email = row.email?.toLowerCase();
      const person = email ? personByEmail.get(email) : undefined;
      if (!person) continue;
      const role = resolveParticipantInviteRole(person.role, defaultRole);
      const roleData = buildParticipantRoleInviteData(role, row.shareToken);
      const updated = await tx.campaignParticipant.update({
        where: { id: row.id },
        data: {
          fullName: person.fullName,
          channel: "email",
          status: "invited",
          role: roleData.role,
          canInviteMembers: roleData.canInviteMembers,
          shareToken: roleData.shareToken,
          invitedByParticipantId: null,
          coordinatorGroupLabel: null,
          aiScansAllocated: scansEach,
          aiScansUsed: 0,
          inviteToken: inviteToken(),
          inviteExpiresAt: expiresAt ?? null,
          invitedAt: now,
          lastRemindedAt: null,
          userId: null,
          acceptedAt: null,
          submittedAt: null,
          measurementProfileId: null,
          measurementSnapshot: Prisma.JsonNull,
        },
      });
      rows.push(updated);
    }
    for (const p of newInvites) {
      const role = resolveParticipantInviteRole(p.role, defaultRole);
      const roleData = buildParticipantRoleInviteData(role);
      const row = await tx.campaignParticipant.create({
        data: {
          campaignId,
          fullName: p.fullName,
          email: p.email.toLowerCase(),
          channel: "email",
          status: "invited",
          role: roleData.role,
          canInviteMembers: roleData.canInviteMembers,
          shareToken: roleData.shareToken,
          invitedByParticipantId: null,
          coordinatorGroupLabel: null,
          aiScansAllocated: scansEach,
          inviteToken: inviteToken(),
          inviteExpiresAt: expiresAt ?? null,
        },
      });
      rows.push(row);
    }
    await applyCampaignCreditsReserveDelta(tx, campaignId, reserveDelta);
    return rows;
  });

  void ownerUserId;

  const siteUrl = (
    process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"
  ).replace(/\/$/, "");
  const { sendCampaignInviteEmail } = await import("@/lib/mailer");
  await Promise.allSettled(
    created.map((row) => {
      if (!row.email || !row.inviteToken) return Promise.resolve();
      const joinUrl = `${siteUrl}${buildInviteJoinPath(live.slug, row.inviteToken)}`;
      return sendCampaignInviteEmail({
        to: row.email,
        fullName: row.fullName,
        campaignName: live.name,
        tailorName: live.tailorProfile.displayName,
        joinUrl,
        expiresAt: expiresAt ? expiresAt.toISOString() : undefined,
        orgId: live.orgId,
      }).catch((err) => {
        console.error("[campaigns] invite email failed:", err);
        throw err;
      });
    })
  );

  if (parsed.tailorClientId && created.length > 0) {
    const participant = created[0];
    try {
      await linkRosterClientToParticipantRecord(
        tailorProfileId,
        parsed.tailorClientId,
        participant
      );
    } catch (err) {
      console.warn(
        "[measurement-campaigns] tailor client direct link failed:",
        err
      );
    }
  }

  await Promise.all(
    created.map((row) =>
      linkTailorClientToCampaignParticipantBestEffort(tailorProfileId, row)
    )
  );

  for (const row of created) {
    if (row.role !== "coordinator" && !row.canInviteMembers) continue;
    try {
      await syncTailorClientUserIdFromParticipant(tailorProfileId, row);
    } catch (err) {
      console.warn(
        "[measurement-campaigns] tailor client userId sync failed:",
        err
      );
    }
  }

  // Invites are already committed. If the full reload fails, return a
  // best-effort snapshot so the client does not treat a successful invite as failed.
  try {
    return {
      invited: created.length,
      participants: await listCampaignParticipants(tailorProfileId, campaignId),
    };
  } catch (err) {
    console.error("[campaigns] post-invite participant reload failed:", err);
    return {
      invited: created.length,
      participants: buildCampaignParticipantDtos(created),
    };
  }
}

export async function sendCampaignReminders(
  tailorProfileId: string,
  campaignId: string
): Promise<{ reminded: number }> {
  await dbConnect();
  const campaign = await prisma.measurementCampaign.findFirst({
    where: { id: campaignId, tailorProfileId },
  });
  if (!campaign) throw new Error("Campaign not found");
  if (campaign.status === "archived" || campaign.status === "expired") {
    throw new Error("Cannot send reminders for an archived or expired campaign");
  }
  if (campaign.status !== "active") {
    throw new Error("Cannot send reminders unless the campaign is active");
  }
  assertCampaignOpenForParticipation(campaign);

  const pending = await prisma.campaignParticipant.findMany({
    where: {
      campaignId,
      status: { in: ["invited", "accepted"] },
    },
  });

  if (pending.length === 0) return { reminded: 0 };

  await prisma.campaignParticipant.updateMany({
    where: { id: { in: pending.map((p) => p.id) } },
    data: { lastRemindedAt: new Date() },
  });

  const siteUrl = (
    process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"
  ).replace(/\/$/, "");
  const { sendCampaignReminderEmail } = await import("@/lib/mailer");
  await Promise.allSettled(
    pending.map((row) => {
      if (!row.email) return Promise.resolve();
      const joinPath = row.inviteToken
        ? buildInviteJoinPath(campaign.slug, row.inviteToken)
        : `/join/${campaign.slug}`;
      const reminderJoinUrl = `${siteUrl}${joinPath}`;
      return sendCampaignReminderEmail({
        to: row.email,
        fullName: row.fullName,
        campaignName: campaign.name,
        joinUrl: reminderJoinUrl,
        orgId: campaign.orgId,
      }).catch((err) => {
        console.error("[campaigns] reminder email failed:", err);
        throw err;
      });
    })
  );

  return { reminded: pending.length };
}

export async function allocateScansToParticipants(
  tailorProfileId: string,
  campaignId: string,
  opts: { participantIds?: string[]; scansEach: number; everyone?: boolean }
): Promise<{ updated: number }> {
  await dbConnect();
  await persistPastDueCampaigns(tailorProfileId);
  const campaign = await prisma.measurementCampaign.findFirst({
    where: { id: campaignId, tailorProfileId },
    include: { participants: true },
  });
  if (!campaign) throw new Error("Campaign not found");
  if (opts.scansEach < 1 || opts.scansEach > 100) {
    throw new Error("Scans must be between 1 and 100");
  }
  if (campaign.status === "archived" || campaign.status === "expired") {
    throw new Error("Cannot allocate scans on an archived or expired campaign");
  }
  if (campaign.status === "active") {
    await assertApprovedTailorForActiveCampaign(tailorProfileId);
  }

  const targets = opts.everyone
    ? campaign.participants
    : campaign.participants.filter((p) => opts.participantIds?.includes(p.id));

  if (targets.length === 0) throw new Error("No participants selected");

  const needed = opts.scansEach * targets.length;
  assertCreditsAvailable(campaign, needed);

  await prisma.$transaction(async (tx) => {
    const live = await tx.measurementCampaign.findFirst({
      where: { id: campaignId },
      select: {
        aiCreditsPurchased: true,
        aiCreditsUsed: true,
        aiCreditsReserved: true,
      },
    });
    if (!live) throw new Error("Campaign not found");
    assertCreditsAvailable(live, needed);
    for (const p of targets) {
      await tx.campaignParticipant.update({
        where: { id: p.id },
        data: { aiScansAllocated: { increment: opts.scansEach } },
      });
    }
    await tx.measurementCampaign.update({
      where: { id: campaignId },
      data: { aiCreditsReserved: { increment: needed } },
    });
  });

  return { updated: targets.length };
}

export async function getPublicCampaignBySlug(
  slug: string,
  opts?: {
    userId?: string;
    userEmail?: string;
    inviteToken?: string;
    groupToken?: string;
  }
) {
  await dbConnect();
  await persistPastDueCampaigns();

  const include = {
    tailorProfile: { select: { displayName: true, slug: true, status: true } },
  } as const;

  let row = await prisma.measurementCampaign.findFirst({
    where: {
      slug,
      status: "active",
      tailorProfile: { status: "approved" },
    },
    include,
  });
  if (!row) {
    row = await prisma.measurementCampaign.findFirst({
      where: {
        slug,
        status: "expired",
        tailorProfile: { status: "approved" },
      },
      include,
    });
  }
  if (!row) return null;

  const organizerName = String(row.tailorProfile.displayName ?? "").trim();
  const displayStatus = effectiveCampaignStatus(row.status, row.expiryDate);
  const campaignClosed = displayStatus === "expired";
  const campaignNotStarted = row.startDate.getTime() > Date.now();
  const base = {
    slug: row.slug,
    name: row.name,
    description: row.description?.trim() || undefined,
    instructions: row.instructions?.trim() || undefined,
    tailorName: organizerName,
    tailorSlug: row.tailorProfile.slug,
    organizerName,
    eventDate: iso(row.eventDate),
    logoUrl: row.logoUrl?.trim() || undefined,
    coverImageUrl: row.coverImageUrl?.trim() || undefined,
    startDate: iso(row.startDate),
    expiryDate: iso(row.expiryDate),
    campaignClosed,
    campaignNotStarted,
  };

  const groupToken = parseGroupToken(opts?.groupToken);
  let groupContext: {
    joiningViaGroup?: boolean;
    groupCoordinatorName?: string;
    groupCoordinatorLabel?: string;
    groupLinkNotActive?: boolean;
    invalidGroupLink?: boolean;
  } = {};

  if (groupToken) {
    const coordinator = await prisma.campaignParticipant.findFirst({
      where: coordinatorShareTokenWhere(row.id, groupToken),
      select: {
        fullName: true,
        coordinatorGroupLabel: true,
        role: true,
        canInviteMembers: true,
        status: true,
      },
    });
    if (coordinator) {
      const groupActive = isActiveGroupCoordinator(coordinator);
      groupContext = {
        groupCoordinatorName: coordinator.fullName,
        groupCoordinatorLabel:
          coordinator.coordinatorGroupLabel?.trim() || undefined,
        joiningViaGroup: groupActive,
        ...(groupActive ? {} : { groupLinkNotActive: true }),
      };
    } else {
      groupContext = { invalidGroupLink: true };
    }
  }

  const userId = opts?.userId?.trim();
  if (!userId || !isValidId(userId)) {
    return { ...base, ...groupContext };
  }

  let userEmail = "";
  try {
    userEmail = (await resolveCampaignActorAccount(userId)).email;
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("verified email")) {
      return { ...base, ...groupContext, emailVerificationRequired: true };
    }
    return { ...base, ...groupContext };
  }

  const inviteToken = opts?.inviteToken?.trim() || "";

  let participant: Awaited<ReturnType<typeof findCampaignParticipantForUser>>;
  try {
    participant = await findCampaignParticipantForUser(row.id, {
      userId,
      userEmail,
      inviteToken,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("email address that received")) {
      return {
        ...base,
        ...groupContext,
        participantInviteEmailMismatch: true,
      };
    }
    if (message.includes("not a participant in this campaign")) {
      return { ...base, ...groupContext };
    }
    throw err;
  }
  if (!participant) return { ...base, ...groupContext };

  const inviteExpired =
    participant.status === "invited" &&
    !isInviteStillOpen({
      status: participant.status,
      inviteExpiresAt: participant.inviteExpiresAt,
    });

  const allocated = Math.max(0, participant.aiScansAllocated);
  const used = Math.max(0, participant.aiScansUsed);

  return {
    ...base,
    ...groupContext,
    participantStatus: participant.status,
    participantRole: (participant.role ?? "direct") as CampaignParticipantRole,
    canInviteMembers: participant.canInviteMembers ?? false,
    ...(inviteExpired ? { participantInviteExpired: true } : {}),
    sponsoredScansAllocated: allocated,
    sponsoredScansUsed: used,
    sponsoredScansRemaining: sponsoredScansRemainingForParticipant(
      participant.status,
      allocated,
      used
    ),
  };
}

/** Join if needed; skip re-join when the actor is already accepted (submit flow). */
export async function ensureJoinedForCampaignSubmit(
  slug: string,
  userId: string,
  userName: string,
  userEmail: string,
  inviteToken?: string | null,
  groupToken?: string | null
): Promise<{ participantId: string; campaignId: string; campaignName: string }> {
  await dbConnect();
  await persistPastDueCampaigns();

  const campaign = await prisma.measurementCampaign.findFirst({
    where: {
      slug,
      status: "active",
      tailorProfile: { status: "approved" },
    },
    select: { id: true, name: true, tailorProfileId: true },
  });
  if (!campaign) throw new Error("Campaign not found or not accepting joins");

  const { email } = await resolveCampaignActorAccount(userId);

  const existing = await findCampaignParticipantForUser(campaign.id, {
    userId,
    userEmail: email,
    inviteToken: inviteToken ?? undefined,
  });
  if (existing?.status === "accepted" || existing?.status === "completed") {
    if (existing.role === "coordinator" || existing.canInviteMembers) {
      await linkTailorClientToCampaignParticipantBestEffort(
        campaign.tailorProfileId,
        {
          id: existing.id,
          userId: existing.userId ?? userId,
          email: existing.email ?? email,
          role: existing.role,
          canInviteMembers: existing.canInviteMembers,
        }
      );
    }
    return {
      participantId: existing.id,
      campaignId: campaign.id,
      campaignName: campaign.name,
    };
  }

  return joinCampaignBySlug(
    slug,
    userId,
    userName,
    email,
    inviteToken,
    groupToken
  );
}

export async function joinCampaignBySlug(
  slug: string,
  userId: string,
  userName: string,
  _userEmail: string,
  inviteTokenValue?: string | null,
  groupTokenValue?: string | null
): Promise<{ participantId: string; campaignId: string; campaignName: string }> {
  await dbConnect();
  await persistPastDueCampaigns();

  const campaign = await prisma.measurementCampaign.findFirst({
    where: {
      slug,
      status: "active",
      tailorProfile: { status: "approved" },
    },
    include: { tailorProfile: { select: { userId: true, status: true } } },
  });
  if (!campaign) throw new Error("Campaign not found or not accepting joins");
  assertCampaignOpenForParticipation(campaign);

  const { email } = await resolveCampaignActorAccount(userId);
  const safeName = clampParticipantName(userName || email || "Participant");
  const token = inviteTokenValue?.trim() || "";
  const groupToken = normalizeGroupToken(groupTokenValue);

  type JoinResult = {
    participant: {
      id: string;
      role: string;
      canInviteMembers: boolean;
      invitedByParticipantId?: string | null;
    };
    created: boolean;
    acceptedInvite: boolean;
    joinedViaGroup: boolean;
    coordinator?: { id: string; fullName: string };
  };

  const runJoin = () =>
    prisma.$transaction(
      async (tx) => {
        let existing = await tx.campaignParticipant.findFirst({
          where: { campaignId: campaign.id, userId },
        });
        let existingFromInviteToken = false;

        if (!existing && token) {
          const byToken = await tx.campaignParticipant.findFirst({
            where: {
              campaignId: campaign.id,
              inviteToken: token,
              OR: [{ userId: null }, { userId }],
            },
          });
          if (byToken) {
            existing = byToken;
            existingFromInviteToken = true;
            assertInviteeEmailMatches(existing.email, email);
            if (
              existing.inviteExpiresAt &&
              existing.inviteExpiresAt.getTime() < Date.now()
            ) {
              throw new Error("This invitation has expired");
            }
          } else if (!groupToken) {
            throw new Error("Invalid or already used invitation link");
          }
        }

        if (!existing && email) {
          existing = await tx.campaignParticipant.findFirst({
            where: {
              campaignId: campaign.id,
              email,
              OR: [{ userId: null }, { userId }],
            },
            orderBy: { invitedAt: "asc" },
          });
          if (existing) {
            assertInviteeEmailMatches(existing.email, email);
          }
          if (
            existing?.inviteExpiresAt &&
            existing.inviteExpiresAt.getTime() < Date.now() &&
            existing.status === "invited"
          ) {
            if (!groupToken) {
              throw new Error("This invitation has expired");
            }
          }
        }

        if (existing) {
          if (existing.status === "completed") {
            throw new Error(
              "You have already submitted measurements for this campaign"
            );
          }
          if (existing.email?.trim()) {
            assertInviteeEmailMatches(existing.email, email);
          }
          const inviteExpired =
            existing.status === "invited" &&
            existing.inviteExpiresAt != null &&
            existing.inviteExpiresAt.getTime() < Date.now();
          // Spec §6.4.1: existing direct rows keep role when user opens a group link.
          const keepDirectParticipant =
            existing.role === "direct" && !existing.invitedByParticipantId;

          if (groupToken && !existingFromInviteToken) {
            const linkCoordinator = await tx.campaignParticipant.findFirst({
              where: coordinatorShareTokenWhere(campaign.id, groupToken),
              select: {
                id: true,
                fullName: true,
                coordinatorGroupLabel: true,
                role: true,
                canInviteMembers: true,
                status: true,
              },
            });

            if (linkCoordinator && existing.id === linkCoordinator.id) {
              throw new Error(
                "This is your group link — share it with members so they can join your group"
              );
            }

            if (
              linkCoordinator &&
              (existing.role === "coordinator" || existing.canInviteMembers)
            ) {
              throw new Error(
                "Group coordinators cannot join another coordinator's group. Use your personal invitation link instead."
              );
            }

            const isCoordinatorRow =
              existing.role === "coordinator" || existing.canInviteMembers;

            if (!isCoordinatorRow && !keepDirectParticipant) {
              if (
                existing.status === "accepted" &&
                existing.role === "member" &&
                existing.invitedByParticipantId
              ) {
                throw new Error("You're already participating in this campaign");
              }

              if (!linkCoordinator) {
                throw new Error("Invalid or expired group link");
              }
              if (!isActiveGroupCoordinator(linkCoordinator)) {
                throw new Error("This group link is not active yet");
              }

              const coordinator = linkCoordinator;
              const scansEach = campaign.sponsoredScansPerInvitee;
              const liveWallet = await tx.measurementCampaign.findFirst({
                where: { id: campaign.id },
                select: {
                  aiCreditsPurchased: true,
                  aiCreditsUsed: true,
                  aiCreditsReserved: true,
                },
              });
              if (!liveWallet) {
                throw new Error("Campaign not found or not accepting joins");
              }

              if (
                existing.role === "member" &&
                existing.invitedByParticipantId === coordinator.id
              ) {
                const prevAlloc = Math.max(0, existing.aiScansAllocated);
                const acceptingInvite = existing.status === "invited";
                let reserveDelta = 0;
                let nextAlloc = prevAlloc;
                if (acceptingInvite && prevAlloc === 0 && scansEach > 0) {
                  reserveDelta = scansEach;
                  nextAlloc = scansEach;
                  assertCreditsAvailable(liveWallet, reserveDelta);
                }
                const row = await tx.campaignParticipant.update({
                  where: { id: existing.id },
                  data: {
                    userId,
                    fullName: safeName,
                    email: email || existing.email,
                    status: "accepted",
                    acceptedAt: existing.acceptedAt ?? new Date(),
                    inviteExpiresAt: null,
                    ...(nextAlloc !== prevAlloc
                      ? { aiScansAllocated: nextAlloc }
                      : {}),
                  },
                });
                if (reserveDelta > 0) {
                  await tx.measurementCampaign.update({
                    where: { id: campaign.id },
                    data: { aiCreditsReserved: { increment: reserveDelta } },
                  });
                }
                return {
                  participant: row,
                  created: false as const,
                  acceptedInvite: acceptingInvite,
                  joinedViaGroup: true as const,
                  coordinator: {
                    id: coordinator.id,
                    fullName: coordinator.fullName,
                  },
                };
              }

              if (
                existing.invitedByParticipantId &&
                existing.invitedByParticipantId !== coordinator.id &&
                isInviteStillOpen({
                  status: existing.status,
                  inviteExpiresAt: existing.inviteExpiresAt,
                })
              ) {
                throw new Error(
                  "You already have a pending invitation from another group in this campaign"
                );
              }

              const prevAlloc = Math.max(0, existing.aiScansAllocated);
              const reserveDelta = scansEach - prevAlloc;
              if (reserveDelta > 0) {
                assertCreditsAvailable(liveWallet, reserveDelta);
              }

              const row = await tx.campaignParticipant.update({
                where: { id: existing.id },
                data: {
                  userId,
                  fullName: safeName,
                  email: email || existing.email,
                  channel: "link",
                  role: "member",
                  canInviteMembers: false,
                  shareToken: null,
                  invitedByParticipantId: coordinator.id,
                  coordinatorGroupLabel: coordinator.coordinatorGroupLabel,
                  status: "accepted",
                  acceptedAt: new Date(),
                  aiScansAllocated: scansEach,
                  aiScansUsed: 0,
                  inviteToken: inviteToken(),
                  inviteExpiresAt: null,
                },
              });
              if (reserveDelta !== 0) {
                if (reserveDelta > 0) {
                  await tx.measurementCampaign.update({
                    where: { id: campaign.id },
                    data: { aiCreditsReserved: { increment: reserveDelta } },
                  });
                } else {
                  const release = -reserveDelta;
                  const released = await tx.measurementCampaign.updateMany({
                    where: {
                      id: campaign.id,
                      aiCreditsReserved: { gte: release },
                    },
                    data: { aiCreditsReserved: { decrement: release } },
                  });
                  if (released.count === 0) {
                    const wallet = await tx.measurementCampaign.findFirst({
                      where: { id: campaign.id },
                      select: { aiCreditsReserved: true },
                    });
                    const partial = Math.min(
                      release,
                      Math.max(0, wallet?.aiCreditsReserved ?? 0)
                    );
                    if (partial > 0) {
                      await tx.measurementCampaign.update({
                        where: { id: campaign.id },
                        data: { aiCreditsReserved: { decrement: partial } },
                      });
                    }
                  }
                }
              }
              return {
                participant: row,
                created: false as const,
                acceptedInvite: existing.status === "invited" || inviteExpired,
                joinedViaGroup: true as const,
                coordinator: {
                  id: coordinator.id,
                  fullName: coordinator.fullName,
                },
              };
            }
          }

          if (inviteExpired && !(groupToken && keepDirectParticipant)) {
            throw new Error("This invitation has expired");
          }
          const wasInvited = existing.status === "invited";
          const data: {
            userId: string;
            fullName?: string;
            email?: string;
            status?: "accepted";
            acceptedAt?: Date;
            aiScansAllocated?: number;
            inviteExpiresAt?: null;
          } = { userId };
          if (safeName) data.fullName = safeName;
          if (email && !existing.email) data.email = email;
          if (wasInvited) {
            data.status = "accepted";
            data.acceptedAt = new Date();
            data.inviteExpiresAt = null;
            const needsCreditOnAccept =
              existing.role === "member" &&
              existing.invitedByParticipantId &&
              Math.max(0, existing.aiScansAllocated) === 0;
            if (needsCreditOnAccept) {
              const scansEach = campaign.sponsoredScansPerInvitee;
              if (scansEach > 0) {
                const liveWallet = await tx.measurementCampaign.findFirst({
                  where: { id: campaign.id },
                  select: {
                    aiCreditsPurchased: true,
                    aiCreditsUsed: true,
                    aiCreditsReserved: true,
                  },
                });
                if (!liveWallet) {
                  throw new Error("Campaign not found or not accepting joins");
                }
                assertCreditsAvailable(liveWallet, scansEach);
                data.aiScansAllocated = scansEach;
                await tx.measurementCampaign.update({
                  where: { id: campaign.id },
                  data: { aiCreditsReserved: { increment: scansEach } },
                });
              }
            }
          }
          const row = await tx.campaignParticipant.update({
            where: { id: existing.id },
            data,
          });
          return {
            participant: row,
            created: false as const,
            acceptedInvite: wasInvited,
            joinedViaGroup: false as const,
          };
        }

        const scansEach = campaign.sponsoredScansPerInvitee;
        const live = await tx.measurementCampaign.findFirst({
          where: { id: campaign.id },
          select: {
            aiCreditsPurchased: true,
            aiCreditsUsed: true,
            aiCreditsReserved: true,
          },
        });
        if (!live) throw new Error("Campaign not found or not accepting joins");
        assertCreditsAvailable(live, scansEach);

        if (groupToken) {
          const coordinator = await tx.campaignParticipant.findFirst({
            where: coordinatorShareTokenWhere(campaign.id, groupToken),
            select: {
              id: true,
              fullName: true,
              coordinatorGroupLabel: true,
              role: true,
              canInviteMembers: true,
              status: true,
            },
          });
          if (!coordinator) {
            throw new Error("Invalid or expired group link");
          }
          if (!isActiveGroupCoordinator(coordinator)) {
            throw new Error("This group link is not active yet");
          }

          const row = await tx.campaignParticipant.create({
            data: {
              campaignId: campaign.id,
              userId,
              fullName: safeName,
              email: email || null,
              channel: "link",
              role: "member",
              invitedByParticipantId: coordinator.id,
              coordinatorGroupLabel: coordinator.coordinatorGroupLabel,
              status: "accepted",
              aiScansAllocated: scansEach,
              acceptedAt: new Date(),
              inviteToken: inviteToken(),
            },
          });
          if (scansEach > 0) {
            await tx.measurementCampaign.update({
              where: { id: campaign.id },
              data: { aiCreditsReserved: { increment: scansEach } },
            });
          }
          return {
            participant: row,
            created: true as const,
            acceptedInvite: false as const,
            joinedViaGroup: true as const,
            coordinator: {
              id: coordinator.id,
              fullName: coordinator.fullName,
            },
          };
        }

        const row = await tx.campaignParticipant.create({
          data: {
            campaignId: campaign.id,
            userId,
            fullName: safeName,
            email: email || null,
            channel: "link",
            role: "direct",
            status: "accepted",
            aiScansAllocated: scansEach,
            acceptedAt: new Date(),
            inviteToken: inviteToken(),
          },
        });
        if (scansEach > 0) {
          await tx.measurementCampaign.update({
            where: { id: campaign.id },
            data: { aiCreditsReserved: { increment: scansEach } },
          });
        }
        return {
          participant: row,
          created: true as const,
          acceptedInvite: false as const,
          joinedViaGroup: false as const,
        };
      },
      { isolationLevel: "Serializable" }
    );

  let joined: JoinResult | null = null;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      joined = await runJoin();
      lastErr = undefined;
      break;
    } catch (err) {
      lastErr = err;
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code: unknown }).code)
          : "";
      // P2034 = serialization failure; P2002 = unique (campaignId, userId) race.
      if (code !== "P2034" && code !== "P2002") throw err;
    }
  }
  if (!joined) {
    throw lastErr instanceof Error
      ? lastErr
      : new Error("Could not join campaign; please try again");
  }
  const { participant, created, acceptedInvite, joinedViaGroup, coordinator } =
    joined;

  if (
    acceptedInvite &&
    (participant.role === "coordinator" || participant.canInviteMembers)
  ) {
    try {
      await ensureCoordinatorShareToken(participant.id);
    } catch (err) {
      console.warn(
        "[measurement-campaigns] coordinator shareToken provision failed:",
        err
      );
    }
  }

  if (joinedViaGroup && coordinator) {
    const joinMeta = {
      campaignId: campaign.id,
      participantId: participant.id,
      coordinatorParticipantId: coordinator.id,
    };
    await notifyCampaignOwnerBestEffort(
      campaign.tailorProfile.userId,
      `New group member in ${campaign.name}`,
      `${safeName} joined via ${coordinator.fullName}'s group link`,
      joinMeta
    );
    await notifyCoordinatorBestEffort(
      coordinator.id,
      `New member in ${campaign.name}`,
      `${safeName} joined your group`,
      joinMeta
    );
  } else if (
    acceptedInvite &&
    participant.role === "member" &&
    participant.invitedByParticipantId?.trim()
  ) {
    const coordinatorParticipantId = participant.invitedByParticipantId.trim();
    const coordinatorName =
      (await loadInvitedByName(coordinatorParticipantId)) ?? "their coordinator";
    const joinMeta = {
      campaignId: campaign.id,
      participantId: participant.id,
      coordinatorParticipantId,
    };
    await notifyCampaignOwnerBestEffort(
      campaign.tailorProfile.userId,
      `New group member in ${campaign.name}`,
      `${safeName} accepted ${coordinatorName}'s invitation`,
      joinMeta
    );
    await notifyCoordinatorBestEffort(
      coordinatorParticipantId,
      `New member in ${campaign.name}`,
      `${safeName} joined your group`,
      joinMeta
    );
  } else if (created || acceptedInvite) {
    await notifyCampaignOwnerBestEffort(
      campaign.tailorProfile.userId,
      `New participant in ${campaign.name}`,
      created
        ? `${safeName} joined via shareable link`
        : `${safeName} accepted their invitation`,
      { campaignId: campaign.id, participantId: participant.id }
    );
  }

  if (
    participant.role === "coordinator" ||
    participant.canInviteMembers
  ) {
    const fullParticipant = await prisma.campaignParticipant.findUnique({
      where: { id: participant.id },
      select: {
        id: true,
        userId: true,
        email: true,
        phone: true,
        role: true,
        canInviteMembers: true,
      },
    });
    if (fullParticipant) {
      await linkTailorClientToCampaignParticipantBestEffort(
        campaign.tailorProfileId,
        fullParticipant
      );
    }
  }

  return {
    participantId: participant.id,
    campaignId: campaign.id,
    campaignName: campaign.name,
  };
}

/** Thrown when listMyCampaignParticipations needs a verified email. */
export const CAMPAIGN_EMAIL_VERIFICATION_REQUIRED =
  "EMAIL_VERIFICATION_REQUIRED";

/** Campaigns the signed-in customer participates in (profile tab). */
export async function listMyCampaignParticipations(
  userId: string
): Promise<CustomerCampaignParticipationDto[]> {
  await dbConnect();
  if (!isValidId(userId)) return [];

  let email = "";
  try {
    email = (await resolveCampaignActorAccount(userId)).email;
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("verified email")) {
      throw new Error(CAMPAIGN_EMAIL_VERIFICATION_REQUIRED);
    }
    return [];
  }

  await persistPastDueCampaigns();

  const orConditions: Prisma.CampaignParticipantWhereInput[] = [{ userId }];
  if (email) {
    orConditions.push({
      email,
      OR: [{ userId: null }, { userId }],
    });
  }

  const rows = await prisma.campaignParticipant.findMany({
    where: { OR: orConditions },
    include: {
      campaign: {
        include: {
          tailorProfile: {
            select: { displayName: true, slug: true, status: true },
          },
        },
      },
    },
    orderBy: [{ acceptedAt: "desc" }, { invitedAt: "desc" }],
  });

  type Candidate = {
    campaignId: string;
    rank: number;
    activityTime: number;
    dto: CustomerCampaignParticipationDto;
  };

  const candidates: Candidate[] = [];
  const seenRowIds = new Set<string>();

  for (const row of rows) {
    if (seenRowIds.has(row.id)) continue;
    if (row.userId && row.userId !== userId) continue;
    const rowEmail = row.email?.trim().toLowerCase() || "";
    if (!row.userId && email && rowEmail !== email) {
      continue;
    }
    seenRowIds.add(row.id);

    const campaign = row.campaign;
    if (!campaign) continue;
    if (campaign.status === "archived" || campaign.status === "draft") continue;
    if (campaign.tailorProfile.status !== "approved") continue;

    const inviteExpired =
      row.status === "invited" &&
      !isInviteStillOpen({
        status: row.status,
        inviteExpiresAt: row.inviteExpiresAt,
      });

    const allocated = Math.max(0, row.aiScansAllocated);
    const used = Math.max(0, row.aiScansUsed);
    const organizerName = String(campaign.tailorProfile.displayName ?? "").trim();
    const displayStatus = effectiveCampaignStatus(
      campaign.status,
      campaign.expiryDate
    );
    const campaignClosed = displayStatus === "expired";
    const campaignNotStarted = campaign.startDate.getTime() > Date.now();

    const isCoordinator = row.canInviteMembers || row.role === "coordinator";
    let shareToken: string | undefined;
    let inviteeStats:
      | CustomerCampaignParticipationDto["inviteeStats"]
      | undefined;
    let groupJoinPath: string | undefined;

    if (isCoordinator && isActiveGroupCoordinator(row)) {
      try {
        shareToken = await ensureCoordinatorShareToken(row.id);
      } catch (err) {
        console.warn(
          "[measurement-campaigns] shareToken provision on list failed:",
          err
        );
        shareToken = row.shareToken?.trim() || undefined;
      }
      const invitees = await prisma.campaignParticipant.findMany({
        where: { invitedByParticipantId: row.id },
        select: { status: true, inviteExpiresAt: true },
      });
      inviteeStats = computeCoordinatorInviteeStats(invitees);
      if (shareToken) {
        groupJoinPath = buildGroupJoinPath(campaign.slug, shareToken);
      }
    }

    candidates.push({
      campaignId: campaign.id,
      rank: customerParticipationRank(row.status, inviteExpired),
      activityTime: participationActivityTime(row),
      dto: {
        participantId: row.id,
        slug: campaign.slug,
        campaignName: campaign.name,
        organizerName: organizerName || "Your tailor",
        category: campaign.category,
        eventDate: iso(campaign.eventDate),
        startDate: iso(campaign.startDate),
        expiryDate: iso(campaign.expiryDate),
        campaignStatus: displayStatus,
        participantStatus:
          row.status as CustomerCampaignParticipationDto["participantStatus"],
        role: (row.role ?? "direct") as CustomerCampaignParticipationDto["role"],
        canInviteMembers: row.canInviteMembers ?? false,
        ...(shareToken ? { shareToken } : {}),
        ...(row.coordinatorGroupLabel?.trim()
          ? { coordinatorGroupLabel: row.coordinatorGroupLabel.trim() }
          : {}),
        ...(inviteeStats ? { inviteeStats } : {}),
        ...(groupJoinPath ? { groupJoinPath } : {}),
        ...(inviteExpired ? { participantInviteExpired: true } : {}),
        ...(campaignClosed ? { campaignClosed: true } : {}),
        ...(campaignNotStarted ? { campaignNotStarted: true } : {}),
        sponsoredScansAllocated: allocated,
        sponsoredScansUsed: used,
        sponsoredScansRemaining: sponsoredScansRemainingForParticipant(
          row.status,
          allocated,
          used
        ),
        instructions: campaign.instructions?.trim() || undefined,
        joinPath:
          row.status === "invited" &&
          row.inviteToken?.trim() &&
          !inviteExpired
            ? buildInviteJoinPath(campaign.slug, row.inviteToken.trim())
            : `/join/${campaign.slug}`,
      },
    });
  }

  const bestByCampaign = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const prev = bestByCampaign.get(candidate.campaignId);
    if (
      !prev ||
      candidate.rank > prev.rank ||
      (candidate.rank === prev.rank &&
        candidate.activityTime > prev.activityTime)
    ) {
      bestByCampaign.set(candidate.campaignId, candidate);
    }
  }

  return Array.from(bestByCampaign.values())
    .sort((a, b) => b.activityTime - a.activityTime)
    .map((c) => c.dto);
}

/** Resolve the participant row for complete — prefer explicit id from a just-finished join. */
async function resolveParticipantForComplete(
  campaignId: string,
  userId: string,
  opts?: { userEmail?: string; inviteToken?: string; participantId?: string }
) {
  const actorEmail = opts?.userEmail?.trim().toLowerCase() ?? "";
  const explicitId = opts?.participantId?.trim();
  if (explicitId && isValidId(explicitId)) {
    const row = await prisma.campaignParticipant.findFirst({
      where: { id: explicitId, campaignId },
      select: campaignParticipantLookupSelect,
    });
    if (!row) {
      throw new Error("You are not a participant in this campaign");
    }
    assertActorOwnsParticipant(row, userId, actorEmail);
    return row;
  }

  const participant = await findCampaignParticipantForUser(campaignId, {
    userId,
    userEmail: opts?.userEmail,
    inviteToken: opts?.inviteToken,
  });
  if (!participant) {
    throw new Error("You are not a participant in this campaign");
  }
  assertActorOwnsParticipant(participant, userId, actorEmail);
  return participant;
}

/** Pre-flight check before running a sponsored AI scan. */
export async function assertSponsoredAiScanAvailable(
  campaignId: string,
  userId: string,
  opts?: { inviteToken?: string }
): Promise<void> {
  await dbConnect();
  if (!isValidId(campaignId) || !isValidId(userId)) {
    throw new Error("You are not a participant in this campaign");
  }
  const campaign = await prisma.measurementCampaign.findFirst({
    where: { id: campaignId },
    include: {
      tailorProfile: { select: { status: true } },
    },
  });
  if (
    !campaign ||
    campaign.status === "archived" ||
    campaign.status === "draft" ||
    campaign.status === "expired" ||
    campaign.tailorProfile.status !== "approved"
  ) {
    throw new Error("This campaign is no longer accepting submissions");
  }
  if (campaign.status !== "active") {
    throw new Error("This campaign is no longer accepting submissions");
  }
  assertCampaignOpenForParticipation(campaign);

  const { email } = await resolveCampaignActorAccount(userId);
  const participant = await findCampaignParticipantForUser(campaignId, {
    userId,
    userEmail: email,
    inviteToken: opts?.inviteToken,
  });
  if (!participant) {
    throw new Error("You are not a participant in this campaign");
  }
  assertActorOwnsParticipant(participant, userId, email);
  if (participant.status === "completed") {
    throw new Error("Measurements already submitted for this campaign");
  }
  if (participant.status === "invited") {
    throw new Error("Join the campaign before using a sponsored AI scan");
  }
  const allocated = Math.max(0, participant.aiScansAllocated);
  const used = Math.max(0, participant.aiScansUsed);
  if (allocated <= 0) {
    throw new Error("This campaign has no sponsored AI scans for you");
  }
  if (used >= allocated) {
    throw new Error("You have used all sponsored AI scans for this campaign");
  }
}

/** Atomically consume one sponsored AI scan credit for a participant. */
export async function consumeSponsoredAiScan(
  campaignId: string,
  userId: string,
  opts?: { inviteToken?: string; tx?: Prisma.TransactionClient }
): Promise<{ scansRemaining: number; participantId: string }> {
  const { email } = await resolveCampaignActorAccount(userId);
  const participant = await findCampaignParticipantForUser(campaignId, {
    userId,
    userEmail: email,
    inviteToken: opts?.inviteToken,
  });
  if (!participant) {
    throw new Error("You are not a participant in this campaign");
  }
  assertActorOwnsParticipant(participant, userId, email);
  if (participant.status === "completed") {
    throw new Error("Measurements already submitted for this campaign");
  }
  if (participant.status === "invited") {
    throw new Error("Join the campaign before using a sponsored AI scan");
  }

  const db = opts?.tx ?? prisma;
  const campaign = await db.measurementCampaign.findFirst({
    where: { id: campaignId },
    include: {
      tailorProfile: { select: { status: true } },
    },
  });
  if (
    !campaign ||
    campaign.status === "archived" ||
    campaign.status === "draft" ||
    campaign.status === "expired" ||
    campaign.tailorProfile.status !== "approved"
  ) {
    throw new Error("This campaign is no longer accepting submissions");
  }
  if (campaign.status !== "active") {
    throw new Error("This campaign is no longer accepting submissions");
  }
  assertCampaignOpenForParticipation(campaign);

  const live = await db.campaignParticipant.findFirst({
    where: { id: participant.id, campaignId },
    select: {
      id: true,
      status: true,
      aiScansAllocated: true,
      aiScansUsed: true,
    },
  });
  if (!live) {
    throw new Error("You are not a participant in this campaign");
  }
  if (live.status === "completed") {
    throw new Error("Measurements already submitted for this campaign");
  }
  if (live.status === "invited") {
    throw new Error("Join the campaign before using a sponsored AI scan");
  }

  const allocated = Math.max(0, live.aiScansAllocated);
  const used = Math.max(0, live.aiScansUsed);
  if (allocated <= 0 || used >= allocated) {
    throw new Error("You have used all sponsored AI scans for this campaign");
  }

  const updated = await db.campaignParticipant.updateMany({
    where: {
      id: live.id,
      status: { not: "completed" },
      aiScansUsed: { lt: allocated },
    },
    data: { aiScansUsed: { increment: 1 } },
  });
  if (updated.count === 0) {
    throw new Error("You have used all sponsored AI scans for this campaign");
  }

  // Move one credit from reserved → used on the campaign wallet.
  const walletUpdated = await db.measurementCampaign.updateMany({
    where: { id: campaignId, aiCreditsReserved: { gt: 0 } },
    data: {
      aiCreditsUsed: { increment: 1 },
      aiCreditsReserved: { decrement: 1 },
    },
  });
  if (walletUpdated.count === 0) {
    // Legacy wallet drift: participant quota reserved but campaign.reserved is 0.
    const legacyUsed = await db.measurementCampaign.updateMany({
      where: { id: campaignId },
      data: { aiCreditsUsed: { increment: 1 } },
    });
    if (legacyUsed.count === 0) {
      throw new Error(
        "Campaign credit wallet is out of sync; please contact support"
      );
    }
  }

  const row = await db.campaignParticipant.findUnique({
    where: { id: live.id },
    select: { aiScansAllocated: true, aiScansUsed: true },
  });
  const scansRemaining = Math.max(
    0,
    (row?.aiScansAllocated ?? 0) - (row?.aiScansUsed ?? 0)
  );
  return { scansRemaining, participantId: live.id };
}

export async function completeCampaignParticipation(
  campaignId: string,
  userId: string,
  measurementProfileId: string,
  opts?: {
    userEmail?: string;
    inviteToken?: string;
    participantId?: string;
  }
): Promise<{ alreadyCompleted: boolean }> {
  await dbConnect();
  await persistPastDueCampaigns();

  if (!isValidId(measurementProfileId)) {
    throw new Error("Measurement profile not found");
  }
  if (!isValidId(userId)) {
    throw new Error("You are not a participant in this campaign");
  }

  const { email: actorEmail } = await resolveCampaignActorAccount(userId);

  const participant = await resolveParticipantForComplete(campaignId, userId, {
    ...opts,
    userEmail: actorEmail,
  });

  const participantRow = await prisma.campaignParticipant.findFirst({
    where: { id: participant.id, campaignId },
    include: {
      campaign: {
        include: {
          tailorProfile: {
            select: { userId: true, displayName: true, status: true },
          },
        },
      },
    },
  });
  if (!participantRow) {
    throw new Error("You are not a participant in this campaign");
  }
  assertActorOwnsParticipant(
    participantRow,
    userId,
    actorEmail
  );
  if (participantRow.status === "completed") return { alreadyCompleted: true };
  if (participantRow.status === "invited") {
    throw new Error("Join the campaign before submitting measurements");
  }

  const campaign = participantRow.campaign;
  if (
    campaign.status === "archived" ||
    campaign.status === "expired" ||
    campaign.tailorProfile.status !== "approved"
  ) {
    throw new Error("This campaign is no longer accepting submissions");
  }
  if (campaign.status !== "active") {
    throw new Error("This campaign is no longer accepting submissions");
  }
  assertCampaignOpenForParticipation(campaign);

  const profile = await prisma.measurementProfile.findFirst({
    where: { id: measurementProfileId, userId },
    select: {
      id: true,
      label: true,
      measurements: true,
      unit: true,
      gender: true,
    },
  });
  if (!profile) {
    throw new Error("Measurement profile not found");
  }

  const profileMeasurements = measurementsRecord(profile.measurements);
  assertNonEmptyMeasurements(
    profileMeasurements,
    "Add measurements to your profile before submitting to this campaign"
  );

  const txResult = await prisma.$transaction(async (tx) => {
    const live = await tx.campaignParticipant.findFirst({
      where: { id: participantRow.id, campaignId },
      select: {
        id: true,
        status: true,
        acceptedAt: true,
        userId: true,
        aiScansAllocated: true,
        aiScansUsed: true,
      },
    });
    if (!live) {
      throw new Error("You are not a participant in this campaign");
    }
    if (live.status === "completed") {
      return { alreadyCompleted: true as const };
    }
    if (live.status === "invited") {
      throw new Error("Join the campaign before submitting measurements");
    }

    const profileLive = await tx.measurementProfile.findFirst({
      where: { id: measurementProfileId, userId },
      select: {
        id: true,
        label: true,
        measurements: true,
        unit: true,
        gender: true,
      },
    });
    if (!profileLive) {
      throw new Error("Measurement profile not found");
    }
    const snapshotMeasurements = measurementsRecord(profileLive.measurements);
    assertNonEmptyMeasurements(
      snapshotMeasurements,
      "Add measurements to your profile before submitting to this campaign"
    );

    const measurementSnapshot: CampaignMeasurementSnapshot = {
      label: String(profileLive.label ?? "").trim() || "Measurements",
      unit: String(profileLive.unit ?? "cm"),
      gender: profileLive.gender ? String(profileLive.gender) : undefined,
      measurements: snapshotMeasurements,
    };

    const updated = await tx.campaignParticipant.updateMany({
      where: {
        id: live.id,
        status: "accepted",
      },
      data: {
        status: "completed",
        submittedAt: new Date(),
        acceptedAt: live.acceptedAt ?? new Date(),
        measurementProfileId: profileLive.id,
        measurementSnapshot: measurementSnapshot as object,
        aiScansAllocated: live.aiScansUsed,
        ...(live.userId ? {} : { userId }),
      },
    });
    if (updated.count === 0) {
      const again = await tx.campaignParticipant.findFirst({
        where: { id: live.id },
        select: { status: true },
      });
      if (again?.status === "completed") {
        return { alreadyCompleted: true as const };
      }
      throw new Error("Join the campaign before submitting measurements");
    }

    const unusedScans = Math.max(
      0,
      Math.max(0, live.aiScansAllocated) - Math.max(0, live.aiScansUsed)
    );
    if (unusedScans > 0) {
      const released = await tx.measurementCampaign.updateMany({
        where: { id: campaignId, aiCreditsReserved: { gte: unusedScans } },
        data: { aiCreditsReserved: { decrement: unusedScans } },
      });
      if (released.count === 0) {
        // Best-effort partial release for legacy wallet drift — never block submit.
        const wallet = await tx.measurementCampaign.findFirst({
          where: { id: campaignId },
          select: { aiCreditsReserved: true },
        });
        const partial = Math.min(
          unusedScans,
          Math.max(0, wallet?.aiCreditsReserved ?? 0)
        );
        if (partial > 0) {
          await tx.measurementCampaign.update({
            where: { id: campaignId },
            data: { aiCreditsReserved: { decrement: partial } },
          });
        }
      }
    }

    return { alreadyCompleted: false as const };
  });

  if (txResult.alreadyCompleted) {
    return { alreadyCompleted: true };
  }

  const coordinatorParticipantId =
    participantRow.invitedByParticipantId?.trim() || undefined;
  const submitMeta = {
    campaignId,
    participantId: participantRow.id,
    ...(coordinatorParticipantId
      ? { coordinatorParticipantId }
      : {}),
  };
  await notifyCampaignOwnerBestEffort(
    campaign.tailorProfile.userId,
    `Measurements submitted to ${campaign.name}`,
    `${participantRow.fullName} submitted their measurements`,
    submitMeta
  );
  if (coordinatorParticipantId && participantRow.role === "member") {
    await notifyCoordinatorBestEffort(
      coordinatorParticipantId,
      `Group member submitted measurements`,
      `${participantRow.fullName} submitted measurements for ${campaign.name}`,
      submitMeta
    );
  }

  if (
    participantRow.role === "coordinator" ||
    participantRow.canInviteMembers
  ) {
    const fresh = await prisma.campaignParticipant.findUnique({
      where: { id: participantRow.id },
      select: {
        id: true,
        userId: true,
        email: true,
        phone: true,
        role: true,
        canInviteMembers: true,
      },
    });
    if (fresh) {
      await linkTailorClientToCampaignParticipantBestEffort(
        campaign.tailorProfileId,
        fresh
      );
    }
  }

  return { alreadyCompleted: false };
}

// ─── Tailor clients ──────────────────────────────────────────────────────────

function normalizePhoneDigits(value?: string | null): string {
  return (value ?? "").replace(/\D/g, "");
}

/** Keep TailorClient.userId aligned with linked participant (incl. reinvite → null). */
async function syncTailorClientUserIdFromParticipant(
  tailorProfileId: string,
  participant: { id: string; userId?: string | null }
): Promise<void> {
  await prisma.tailorClient.updateMany({
    where: { campaignParticipantId: participant.id, tailorProfileId },
    data: { userId: participant.userId ?? null },
  });
}

/** Assign a roster client row to a known campaign participant (direct / link-only). */
async function linkRosterClientToParticipantRecord(
  tailorProfileId: string,
  tailorClientId: string,
  participant: {
    id: string;
    email?: string | null;
    userId?: string | null;
  }
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.tailorClient.updateMany({
      where: {
        tailorProfileId,
        campaignParticipantId: participant.id,
        NOT: { id: tailorClientId },
      },
      data: { campaignParticipantId: null, userId: null },
    });
    const linked = await tx.tailorClient.updateMany({
      where: { id: tailorClientId, tailorProfileId },
      data: {
        campaignParticipantId: participant.id,
        userId: participant.userId ?? null,
        ...(participant.email?.trim()
          ? { email: participant.email.trim().toLowerCase() }
          : {}),
      },
    });
    if (linked.count === 0) {
      throw new Error("Client not found");
    }
  });
}

/** Match roster client by participant email/phone and link campaign participant row. */
async function linkTailorClientToCampaignParticipantBestEffort(
  tailorProfileId: string,
  participant: {
    id: string;
    userId?: string | null;
    email?: string | null;
    phone?: string | null;
    role?: string | null;
    canInviteMembers?: boolean | null;
  }
): Promise<void> {
  const ownedParticipant = await prisma.campaignParticipant.findFirst({
    where: {
      id: participant.id,
      campaign: { tailorProfileId },
    },
    select: {
      id: true,
      userId: true,
      email: true,
      phone: true,
      role: true,
      canInviteMembers: true,
    },
  });
  if (!ownedParticipant) return;

  if (
    ownedParticipant.role !== "coordinator" &&
    !ownedParticipant.canInviteMembers
  ) {
    await prisma.tailorClient.updateMany({
      where: {
        campaignParticipantId: ownedParticipant.id,
        tailorProfileId,
      },
      data: { campaignParticipantId: null, userId: null },
    });
    return;
  }

  const existingLink = await prisma.tailorClient.findFirst({
    where: { campaignParticipantId: ownedParticipant.id, tailorProfileId },
    select: { id: true, userId: true },
  });
  if (existingLink) {
    if (
      ownedParticipant.userId &&
      existingLink.userId !== ownedParticipant.userId
    ) {
      try {
        await prisma.tailorClient.update({
          where: { id: existingLink.id },
          data: { userId: ownedParticipant.userId },
        });
      } catch (err) {
        console.warn(
          "[measurement-campaigns] tailor client userId refresh failed:",
          err
        );
      }
    }
    return;
  }

  const email = ownedParticipant.email?.trim().toLowerCase() || "";
  const phoneNorm = normalizePhoneDigits(ownedParticipant.phone);
  if (!email && phoneNorm.length < 7) return;

  try {
    const clients = await prisma.tailorClient.findMany({
      where: { tailorProfileId },
      orderBy: { createdAt: "desc" },
    });
    let match = email
      ? clients.find(
          (c) => c.email?.trim().toLowerCase() === email
        )
      : undefined;
    if (!match && phoneNorm.length >= 7) {
      match = clients.find(
        (c) => normalizePhoneDigits(c.phone) === phoneNorm
      );
    }
    if (!match) return;

    if (match.campaignParticipantId === ownedParticipant.id) {
      if (
        ownedParticipant.userId &&
        match.userId !== ownedParticipant.userId
      ) {
        await prisma.tailorClient.update({
          where: { id: match.id },
          data: { userId: ownedParticipant.userId },
        });
      }
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.tailorClient.updateMany({
        where: {
          tailorProfileId,
          campaignParticipantId: ownedParticipant.id,
          NOT: { id: match.id },
        },
        data: { campaignParticipantId: null, userId: null },
      });
      await tx.tailorClient.update({
        where: { id: match.id },
        data: {
          campaignParticipantId: ownedParticipant.id,
          userId: ownedParticipant.userId ?? null,
          ...(email && !match.email?.trim() ? { email } : {}),
        },
      });
    });
  } catch (err) {
    console.warn(
      "[measurement-campaigns] tailor client ↔ participant link failed:",
      err
    );
  }
}

function toTailorClientDto(row: {
  id: string;
  tailorProfileId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  gender?: string | null;
  garmentOccasion?: string | null;
  notes?: string | null;
  vitals?: unknown;
  createdAt: Date;
  updatedAt: Date;
  campaignParticipant?: {
    id: string;
    status: string;
    campaign?: { tailorProfileId: string };
  } | null;
}): TailorClientDto {
  const participant = row.campaignParticipant;
  const link =
    participant &&
    participant.campaign?.tailorProfileId === row.tailorProfileId
      ? participant
      : null;
  return {
    _id: row.id,
    name: row.name,
    email: row.email?.trim() || undefined,
    phone: row.phone ?? undefined,
    gender: row.gender ?? undefined,
    garmentOccasion: row.garmentOccasion ?? undefined,
    notes: row.notes ?? undefined,
    vitals:
      row.vitals && typeof row.vitals === "object"
        ? (row.vitals as Record<string, unknown>)
        : undefined,
    ...(link
      ? {
          campaignLink: {
            participantId: link.id,
            status: link.status as CampaignParticipantStatus,
          },
        }
      : {}),
    createdAt: iso(row.createdAt) ?? new Date().toISOString(),
    updatedAt: iso(row.updatedAt) ?? new Date().toISOString(),
  };
}

export async function listTailorClients(
  tailorProfileId: string,
  opts?: PaginationOpts
) {
  await dbConnect();
  const page = Math.max(1, opts?.page ?? 1);
  const limit = Math.min(50, Math.max(1, opts?.limit ?? 25));
  const skip = (page - 1) * limit;
  const where = { tailorProfileId };
  const [total, rows] = await Promise.all([
    prisma.tailorClient.count({ where }),
    prisma.tailorClient.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        campaignParticipant: {
          select: {
            id: true,
            status: true,
            campaign: { select: { tailorProfileId: true } },
          },
        },
      },
    }),
  ]);

  const orphanIds = rows
    .filter((row) => row.campaignParticipantId && !row.campaignParticipant)
    .map((row) => row.id);
  if (orphanIds.length > 0) {
    try {
      await prisma.tailorClient.updateMany({
        where: { id: { in: orphanIds }, tailorProfileId },
        data: { campaignParticipantId: null, userId: null },
      });
      for (const row of rows) {
        if (orphanIds.includes(row.id)) {
          row.campaignParticipantId = null;
          row.campaignParticipant = null;
        }
      }
    } catch (err) {
      console.warn(
        "[measurement-campaigns] tailor client orphan link repair failed:",
        err
      );
    }
  }

  const profile = await prisma.tailorProfile.findUnique({
    where: { id: tailorProfileId },
    select: { orgId: true },
  });
  const {
    resolveOrgPlanId,
    resolveOrgPlanResourceCap,
    countPlanResource,
    isCompanyBillingCreateEntitled,
  } = await import("@/lib/planLimits");
  const planLimit = profile?.orgId
    ? await resolveOrgPlanResourceCap(profile.orgId, "tailorClients")
    : 0;
  const planUsed = profile?.orgId
    ? await countPlanResource(profile.orgId, "tailorClients")
    : total;
  const resolved = profile?.orgId
    ? await resolveOrgPlanId(profile.orgId)
    : null;
  const planResolved = resolved?.planResolved ?? null;
  const billingEntitled = resolved
    ? isCompanyBillingCreateEntitled({
        subscriptionStatus: resolved.subscriptionStatus,
        subscriptionEndsAt: resolved.subscriptionEndsAt,
        orgStatus: resolved.orgStatus,
      })
    : false;

  return {
    clients: rows.map(toTailorClientDto),
    ...paginatedMeta(page, limit, total),
    planLimit,
    planUsed,
    planResolved,
    billingEntitled,
  };
}

export async function createTailorClient(
  tailorProfileId: string,
  raw: unknown
): Promise<TailorClientDto> {
  await dbConnect();
  const parsed = tailorClientInputSchema.safeParse(raw);
  if (!parsed.success) {
    const msg =
      parsed.error.issues[0]?.message ?? "Invalid client data";
    throw new Error(msg);
  }
  const input = parsed.data;
  const profile = await prisma.tailorProfile.findUnique({
    where: { id: tailorProfileId },
    select: { orgId: true, status: true },
  });
  if (!profile?.orgId) {
    throw new Error("Tailor profile not found");
  }
  if (profile.status === "suspended") {
    const { ForbiddenError } = await import("@/lib/auth/http-error");
    throw new ForbiddenError("Cannot add clients to a suspended tailor profile");
  }
  const { assertWithinPlanLimit } = await import("@/lib/planLimits");
  await assertWithinPlanLimit(profile.orgId, "tailorClients");
  const row = await prisma.$transaction(async (tx) => {
    const vitals = sanitizeVitals(input.vitals);
    return tx.tailorClient.create({
      data: {
        tailorProfileId,
        name: input.name,
        email: input.email?.trim().toLowerCase() || null,
        phone: input.phone?.trim() || null,
        gender: input.gender ?? null,
        garmentOccasion: input.garmentOccasion?.trim() || null,
        notes: input.notes?.trim() || null,
        ...(vitals ? { vitals: vitals as object } : {}),
      },
    });
  });
  return toTailorClientDto(row);
}

function sanitizeVitals(
  vitals: TailorClientInput["vitals"]
): Record<string, unknown> | undefined {
  if (!vitals || typeof vitals !== "object") return undefined;
  const out: Record<string, unknown> = {};
  const copyKeys = [
    "heightUnit",
    "weightUnit",
    "bodyShape",
  ] as const;
  for (const key of copyKeys) {
    const value = vitals[key];
    if (typeof value === "string" && value.trim()) out[key] = value.trim();
  }
  const numKeys = ["heightFt", "heightIn", "heightCm", "weight"] as const;
  for (const key of numKeys) {
    const value = vitals[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      out[key] = value;
    }
  }
  const hasMeasure =
    "heightFt" in out ||
    "heightIn" in out ||
    "heightCm" in out ||
    "weight" in out ||
    "bodyShape" in out;
  return hasMeasure ? out : undefined;
}

export async function deleteTailorClient(
  tailorProfileId: string,
  clientId: string
): Promise<void> {
  await dbConnect();
  const row = await prisma.tailorClient.findFirst({
    where: { id: clientId, tailorProfileId },
  });
  if (!row) throw new Error("Client not found");
  await prisma.tailorClient.delete({ where: { id: clientId } });
}

function csvEscape(value: string | number | null | undefined): string {
  let s = value == null ? "" : String(value);
  // Mitigate CSV formula injection when opened in Excel / Sheets.
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvRow(cells: Array<string | number | null | undefined>): string {
  return cells.map(csvEscape).join(",");
}

export async function getTailorCreditsSummary(
  tailorProfileId: string
): Promise<TailorCreditsSummaryDto> {
  await dbConnect();
  await persistPastDueCampaigns(tailorProfileId);

  const rows = await prisma.measurementCampaign.findMany({
    where: { tailorProfileId },
    select: {
      id: true,
      name: true,
      status: true,
      expiryDate: true,
      aiCreditsPurchased: true,
      aiCreditsUsed: true,
      aiCreditsReserved: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  const campaigns = rows.map((row) => {
    const available = creditsAvailable(row);
    return {
      _id: row.id,
      name: row.name,
      status: effectiveCampaignStatus(row.status, row.expiryDate),
      purchased: row.aiCreditsPurchased,
      used: row.aiCreditsUsed,
      reserved: row.aiCreditsReserved,
      available,
    };
  });

  let wallet = campaigns.reduce(
    (acc, c) => ({
      purchased: acc.purchased + c.purchased,
      used: acc.used + c.used,
      reserved: acc.reserved + c.reserved,
      available: acc.available + c.available,
    }),
    { purchased: 0, used: 0, reserved: 0, available: 0 }
  );

  const participantWhere = { campaign: { tailorProfileId } };
  const [completedCount, totalParticipants, scansUsedAgg] = await Promise.all([
    prisma.campaignParticipant.count({
      where: { ...participantWhere, status: "completed" },
    }),
    prisma.campaignParticipant.count({ where: participantWhere }),
    prisma.campaignParticipant.aggregate({
      where: participantWhere,
      _sum: { aiScansUsed: true },
    }),
  ]);

  const measurementPercent =
    totalParticipants > 0
      ? Math.round((completedCount / totalParticipants) * 100)
      : 0;

  const scansUsedTotal = scansUsedAgg._sum.aiScansUsed ?? 0;
  if (scansUsedTotal > wallet.used) {
    wallet = { ...wallet, used: scansUsedTotal };
    wallet.available = Math.max(
      0,
      wallet.purchased - wallet.used - wallet.reserved
    );
  }

  const participantRows = await prisma.campaignParticipant.findMany({
    where: participantWhere,
    select: {
      id: true,
      campaignId: true,
      fullName: true,
      status: true,
      invitedAt: true,
      acceptedAt: true,
      submittedAt: true,
      lastRemindedAt: true,
      aiScansAllocated: true,
      aiScansUsed: true,
      campaign: { select: { name: true } },
    },
    orderBy: { invitedAt: "desc" },
    take: 300,
  });

  const activity: CampaignCreditActivityItem[] = [];
  const creditTransactions: CampaignCreditTransactionItem[] = [];

  const scanRows = await prisma.campaignParticipant.findMany({
    where: { ...participantWhere, aiScansUsed: { gt: 0 } },
    select: {
      id: true,
      aiScansUsed: true,
      submittedAt: true,
      acceptedAt: true,
      invitedAt: true,
      campaign: { select: { name: true } },
    },
    orderBy: { submittedAt: "desc" },
  });
  for (const p of scanRows) {
    const when =
      p.submittedAt?.toISOString() ??
      p.acceptedAt?.toISOString() ??
      p.invitedAt.toISOString();
    for (let i = 0; i < p.aiScansUsed; i++) {
      creditTransactions.push({
        id: `${p.id}-scan-${i}`,
        occurredAt: when,
        type: "Sponsored scan",
        credits: -1,
        reference: "Sponsored AI measurement",
      });
    }
  }

  for (const p of participantRows) {
    const campaignName = p.campaign.name;
    if (p.aiScansUsed > 0) {
      const when =
        p.submittedAt?.toISOString() ??
        p.acceptedAt?.toISOString() ??
        p.invitedAt.toISOString();
      activity.push({
        id: `${p.id}-scan-use`,
        campaignId: p.campaignId,
        campaignName,
        type: "submit",
        label: `${p.aiScansUsed} credit${p.aiScansUsed === 1 ? '' : 's'} used for a sponsored AI measurement`,
        occurredAt: when,
        creditsInvolved: p.aiScansUsed,
      });
    }
    if (p.submittedAt) {
      activity.push({
        id: `${p.id}-submit`,
        campaignId: p.campaignId,
        campaignName,
        type: "submit",
        label: `${p.fullName} completed their measurements`,
        occurredAt: p.submittedAt.toISOString(),
      });
    } else if (p.status === "completed") {
      // legacy rows without submittedAt
      activity.push({
        id: `${p.id}-submit`,
        campaignId: p.campaignId,
        campaignName,
        type: "submit",
        label: `${p.fullName} completed their measurements`,
        occurredAt: p.invitedAt.toISOString(),
      });
    }
    if (p.acceptedAt) {
      activity.push({
        id: `${p.id}-accept`,
        campaignId: p.campaignId,
        campaignName,
        type: "accept",
        label: `${p.fullName} joined the campaign`,
        occurredAt: p.acceptedAt.toISOString(),
        creditsInvolved: p.aiScansAllocated > 0 ? p.aiScansAllocated : undefined,
      });
    }
    if (p.lastRemindedAt) {
      activity.push({
        id: `${p.id}-remind`,
        campaignId: p.campaignId,
        campaignName,
        type: "reminder",
        label: `Reminder sent to ${p.fullName}`,
        occurredAt: p.lastRemindedAt.toISOString(),
      });
    }
    activity.push({
      id: `${p.id}-invite`,
      campaignId: p.campaignId,
      campaignName,
      type: "invite",
      label:
        p.status === "invited"
          ? `Invitation pending for ${p.fullName}`
          : `${p.fullName} invited`,
      occurredAt: p.invitedAt.toISOString(),
      creditsInvolved: p.aiScansAllocated > 0 ? p.aiScansAllocated : undefined,
    });
  }

  activity.sort(
    (a, b) =>
      new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  );
  creditTransactions.sort(
    (a, b) =>
      new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  );

  return {
    wallet,
    campaignCount: campaigns.length,
    campaigns,
    recentActivity: activity.slice(0, 40),
    measurementProgress: {
      completed: completedCount,
      total: totalParticipants,
      percent: measurementPercent,
    },
    creditTransactions: creditTransactions.slice(0, 50),
  };
}

export async function exportCampaignParticipantsCsv(
  tailorProfileId: string,
  campaignId: string
): Promise<{ filename: string; csv: string }> {
  await dbConnect();
  const campaign = await prisma.measurementCampaign.findFirst({
    where: { id: campaignId, tailorProfileId },
    include: {
      participants: {
        orderBy: { invitedAt: "asc" },
        select: participantDetailSelect,
      },
    },
  });
  if (!campaign) throw new Error("Campaign not found");

  const rows = buildCampaignParticipantDtos(campaign.participants).map(
    (participant) => ({
      campaignName: campaign.name,
      participant,
    })
  );

  const safeName = campaign.name
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const filename = `${safeName || "campaign"}-participants.csv`;
  const csv = buildParticipantsCsv(rows);
  return { filename, csv };
}

function buildParticipantsCsv(
  rows: Array<{
    campaignName: string;
    participant: CampaignParticipantDto;
  }>
): string {
  // Always export the full catalog so unset fields stay aligned across rows.
  const measureKeys = [...MEASUREMENT_FIELD_KEYS];

  const baseHeaders = [
    "Campaign",
    "Full name",
    "Email",
    "Phone",
    "Status",
    "Channel",
    "Role",
    "Invited by",
    "Group label",
    "Invited at",
    "Accepted at",
    "Submitted at",
    "Scans allocated",
    "Scans used",
    "Measurement label",
    "Measurement unit",
    "Gender",
    ...measureKeys.map(measurementFieldLabel),
  ];

  const lines = [csvRow(baseHeaders)];
  for (const { campaignName, participant: p } of rows) {
    const snap = p.measurementSnapshot;
    lines.push(
      csvRow([
        campaignName,
        p.fullName,
        p.email ?? "",
        p.phone ?? "",
        p.status,
        p.channel,
        p.role,
        p.invitedByName ?? "",
        p.coordinatorGroupLabel ?? "",
        p.invitedAt,
        p.acceptedAt ?? "",
        p.submittedAt ?? "",
        p.aiScansAllocated,
        p.aiScansUsed,
        snap?.label ?? "",
        snap?.unit ?? "",
        snap?.gender ?? "",
        ...measureKeys.map((k) =>
          snap?.measurements?.[k] != null ? snap.measurements[k] : ""
        ),
      ])
    );
  }
  return `\uFEFF${lines.join("\r\n")}`;
}

export async function exportAllCampaignParticipantsCsv(
  tailorProfileId: string
): Promise<{ filename: string; csv: string }> {
  await dbConnect();
  const campaigns = await prisma.measurementCampaign.findMany({
    where: { tailorProfileId },
    include: {
      participants: {
        orderBy: { invitedAt: "asc" },
        select: participantDetailSelect,
      },
    },
    orderBy: { name: "asc" },
  });

  const rows: Array<{ campaignName: string; participant: CampaignParticipantDto }> =
    [];
  for (const campaign of campaigns) {
    for (const participant of buildCampaignParticipantDtos(
      campaign.participants
    )) {
      rows.push({
        campaignName: campaign.name,
        participant,
      });
    }
  }

  const filename = "all-campaign-participants.csv";
  const csv = buildParticipantsCsv(rows);
  return { filename, csv };
}

