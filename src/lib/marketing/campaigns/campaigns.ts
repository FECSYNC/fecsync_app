import type { MarketingCampaign, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireId, isValidId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import { assertMarketingEnabled } from "@/lib/marketing/assert";
import { assertVenueInOrg } from "@/lib/guests/upsertFromChannel";
import { getOrCreateMarketingSettings } from "@/lib/marketing/settings";
import { resolveCtaUrls } from "@/lib/marketing/templates";
import { buildUnsubscribeUrl } from "@/lib/marketing/unsubscribe";
import { publicAppBaseUrl } from "@/lib/publicAppBaseUrl";
import {
  renderMarketingGuestEmailPreview,
  sendMarketingGuestEmail,
} from "@/lib/mailer";
import {
  normalizeCampaignBlocks,
  renderCampaignBodyHtml,
  renderCampaignSubject,
  usesEventsBlock,
  hasRenderableContent,
  type CampaignEventItem,
  type CampaignMergeVars,
} from "@/lib/marketing/campaigns/blocks";
import {
  countCampaignAudience,
  normalizeCampaignAudience,
} from "@/lib/marketing/campaigns/audience";
import {
  formatEventWhen,
  isValidTimeZone,
  monthlyWindowKey,
  monthNameForWindow,
  nextMonthlyRun,
} from "@/lib/marketing/campaigns/schedule";
import type {
  CampaignAction,
  CampaignAudience,
  CampaignBlock,
  CampaignWindowStats,
  MarketingCampaignDto,
  MarketingCampaignInput,
} from "@/lib/marketing/campaigns/types";

export const ONCE_WINDOW_KEY = "once";

/** Minimal park-scope shape (EffectiveParkScope satisfies this). */
export type CampaignParkScope = {
  parkLocked: boolean;
  assignedLocationIds: string[];
  locationId?: string | null;
};

const PARK_OUTSIDE = "Outside your park assignment";

export function assertCampaignLocationAllowed(
  scope: CampaignParkScope | null | undefined,
  locationId: string | null
): void {
  if (!scope?.parkLocked) return;
  if (!locationId || !scope.assignedLocationIds.includes(locationId)) {
    throw new ForbiddenError(PARK_OUTSIDE);
  }
}

function campaignScopeWhere(
  scope: CampaignParkScope | null | undefined
): Prisma.MarketingCampaignWhereInput {
  if (!scope?.parkLocked) return {};
  return { locationId: { in: scope.assignedLocationIds } };
}

type CampaignRow = MarketingCampaign & { location?: { name: string } | null };

function toDto(row: CampaignRow, lastWindow: CampaignWindowStats | null): MarketingCampaignDto {
  return {
    id: row.id,
    orgId: row.orgId,
    locationId: row.locationId,
    locationName: row.location?.name ?? null,
    name: row.name,
    subject: row.subject,
    preheader: row.preheader,
    blocks: normalizeCampaignBlocks(row.blocks),
    audience: normalizeCampaignAudience(row.audience),
    scheduleKind: row.scheduleKind,
    sendAt: row.sendAt?.toISOString() ?? null,
    dayOfMonth: row.dayOfMonth,
    sendHour: row.sendHour,
    timezone: row.timezone,
    status: row.status,
    nextRunAt: row.nextRunAt?.toISOString() ?? null,
    currentWindowKey: row.currentWindowKey,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    lastCompletedAt: row.lastCompletedAt?.toISOString() ?? null,
    lastWindow,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Delivery counts for the most recent issue of each campaign. */
async function loadLastWindowStats(
  orgId: string,
  campaignIds: string[]
): Promise<Map<string, CampaignWindowStats>> {
  const out = new Map<string, CampaignWindowStats>();
  if (campaignIds.length === 0) return out;
  const groups = await prisma.marketingCampaignRecipient.groupBy({
    by: ["campaignId", "windowKey", "status"],
    where: { orgId, campaignId: { in: campaignIds } },
    _count: { _all: true },
    _max: { createdAt: true },
  });
  const newestWindow = new Map<string, { windowKey: string; at: number }>();
  for (const g of groups) {
    const at = g._max.createdAt?.getTime() ?? 0;
    const cur = newestWindow.get(g.campaignId);
    if (!cur || at > cur.at) newestWindow.set(g.campaignId, { windowKey: g.windowKey, at });
  }
  for (const g of groups) {
    const newest = newestWindow.get(g.campaignId);
    if (!newest || newest.windowKey !== g.windowKey) continue;
    const stats = out.get(g.campaignId) ?? {
      windowKey: g.windowKey,
      sent: 0,
      skipped: 0,
      failed: 0,
    };
    stats[g.status] = g._count._all;
    out.set(g.campaignId, stats);
  }
  return out;
}

export async function listMarketingCampaigns(
  orgId: string,
  scope?: CampaignParkScope | null
): Promise<MarketingCampaignDto[]> {
  const id = requireId(orgId, "orgId");
  await assertMarketingEnabled(id);
  const rows = await prisma.marketingCampaign.findMany({
    where: { orgId: id, status: { not: "archived" }, ...campaignScopeWhere(scope) },
    include: { location: { select: { name: true } } },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  const stats = await loadLastWindowStats(
    id,
    rows.map((r) => r.id)
  );
  return rows.map((r) => toDto(r, stats.get(r.id) ?? null));
}

export class MarketingNotFoundError extends Error {
  constructor(message = "Campaign not found") {
    super(message);
    this.name = "MarketingNotFoundError";
  }
}

export class MarketingConflictError extends Error {
  constructor(message = "This campaign was changed by someone else") {
    super(message);
    this.name = "MarketingConflictError";
  }
}

async function loadCampaignRow(orgId: string, campaignId: string): Promise<CampaignRow> {
  if (!isValidId(campaignId)) throw new MarketingNotFoundError();
  const row = await prisma.marketingCampaign.findFirst({
    where: { id: campaignId, orgId },
    include: { location: { select: { name: true } } },
  });
  if (!row) throw new MarketingNotFoundError();
  return row;
}

export async function getMarketingCampaign(
  orgId: string,
  campaignId: string,
  scope?: CampaignParkScope | null
): Promise<MarketingCampaignDto & { audienceCount: number }> {
  const id = requireId(orgId, "orgId");
  await assertMarketingEnabled(id);
  const row = await loadCampaignRow(id, campaignId);
  assertCampaignLocationAllowed(scope, row.locationId);
  const stats = await loadLastWindowStats(id, [row.id]);
  const dto = toDto(row, stats.get(row.id) ?? null);
  const audienceCount = await countCampaignAudience({
    orgId: id,
    locationId: row.locationId,
    audience: dto.audience,
  });
  return { ...dto, audienceCount };
}

async function defaultTimezone(orgId: string, locationId: string | null): Promise<string> {
  const venue = await prisma.venueLocation.findFirst({
    where: {
      orgId,
      ...(locationId ? { id: locationId } : {}),
      timezone: { not: null },
      archivedAt: null,
    },
    select: { timezone: true },
    orderBy: { name: "asc" },
  });
  const tz = venue?.timezone?.trim();
  return tz && isValidTimeZone(tz) ? tz : "UTC";
}

type NormalizedInput = {
  name?: string;
  subject?: string;
  preheader?: string | null;
  blocks?: CampaignBlock[];
  audience?: CampaignAudience;
  locationId?: string | null;
  scheduleKind?: "once" | "monthly";
  sendAt?: Date | null;
  dayOfMonth?: number | null;
  sendHour?: number;
  timezone?: string;
};

function normalizeInput(raw: MarketingCampaignInput): NormalizedInput {
  const out: NormalizedInput = {};
  if (raw.name !== undefined) {
    out.name = String(raw.name ?? "").trim().slice(0, 120) || "Untitled newsletter";
  }
  if (raw.subject !== undefined) {
    out.subject = String(raw.subject ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 200);
  }
  if (raw.preheader !== undefined) {
    const p = raw.preheader == null ? "" : String(raw.preheader).trim().slice(0, 200);
    out.preheader = p || null;
  }
  if (raw.blocks !== undefined) out.blocks = normalizeCampaignBlocks(raw.blocks);
  if (raw.audience !== undefined) out.audience = normalizeCampaignAudience(raw.audience);
  if (raw.locationId !== undefined) {
    const loc = raw.locationId == null ? "" : String(raw.locationId).trim();
    if (loc && !isValidId(loc)) throw new Error("locationId is invalid");
    out.locationId = loc || null;
  }
  if (raw.scheduleKind !== undefined) {
    if (raw.scheduleKind !== "once" && raw.scheduleKind !== "monthly") {
      throw new Error("scheduleKind must be once or monthly");
    }
    out.scheduleKind = raw.scheduleKind;
  }
  if (raw.sendAt !== undefined) {
    if (raw.sendAt == null || raw.sendAt === "") {
      out.sendAt = null;
    } else {
      const d = new Date(String(raw.sendAt));
      if (Number.isNaN(d.getTime())) throw new Error("sendAt is not a valid date");
      out.sendAt = d;
    }
  }
  if (raw.dayOfMonth !== undefined) {
    if (raw.dayOfMonth == null) {
      out.dayOfMonth = null;
    } else {
      const n = Math.trunc(Number(raw.dayOfMonth));
      if (!Number.isFinite(n) || n < 1 || n > 28) {
        throw new Error("Day of month must be between 1 and 28");
      }
      out.dayOfMonth = n;
    }
  }
  if (raw.sendHour !== undefined) {
    const n = Math.trunc(Number(raw.sendHour));
    if (!Number.isFinite(n) || n < 0 || n > 23) throw new Error("Send hour must be 0–23");
    out.sendHour = n;
  }
  if (raw.timezone !== undefined) {
    const tz = String(raw.timezone ?? "").trim();
    if (!isValidTimeZone(tz)) throw new Error("Timezone is not recognised");
    out.timezone = tz;
  }
  return out;
}

function toPrismaData(input: NormalizedInput) {
  return {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.subject !== undefined ? { subject: input.subject } : {}),
    ...(input.preheader !== undefined ? { preheader: input.preheader } : {}),
    ...(input.blocks !== undefined
      ? { blocks: input.blocks as unknown as Prisma.InputJsonValue }
      : {}),
    ...(input.audience !== undefined
      ? { audience: input.audience as unknown as Prisma.InputJsonValue }
      : {}),
    ...(input.scheduleKind !== undefined ? { scheduleKind: input.scheduleKind } : {}),
    ...(input.sendAt !== undefined ? { sendAt: input.sendAt } : {}),
    ...(input.dayOfMonth !== undefined ? { dayOfMonth: input.dayOfMonth } : {}),
    ...(input.sendHour !== undefined ? { sendHour: input.sendHour } : {}),
    ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
  };
}

export async function createMarketingCampaign(input: {
  orgId: string;
  actorUserId?: string | null;
  scope?: CampaignParkScope | null;
  data: MarketingCampaignInput;
}): Promise<MarketingCampaignDto> {
  const orgId = requireId(input.orgId, "orgId");
  await assertMarketingEnabled(orgId);
  const data = normalizeInput(input.data);
  // Park-locked seats cannot target the whole company — default to their park.
  const locationId =
    data.locationId ??
    (input.scope?.parkLocked
      ? input.scope.locationId ?? input.scope.assignedLocationIds[0] ?? null
      : null);
  if (locationId) await assertVenueInOrg(orgId, locationId);
  assertCampaignLocationAllowed(input.scope, locationId);

  const row = await prisma.marketingCampaign.create({
    data: {
      orgId,
      locationId,
      name: data.name ?? "Untitled newsletter",
      subject: data.subject ?? "",
      createdById: input.actorUserId && isValidId(input.actorUserId) ? input.actorUserId : null,
      timezone: data.timezone ?? (await defaultTimezone(orgId, locationId)),
      ...toPrismaData({ ...data, name: undefined, subject: undefined, timezone: undefined }),
    },
    include: { location: { select: { name: true } } },
  });
  return toDto(row, null);
}

export async function updateMarketingCampaign(input: {
  orgId: string;
  campaignId: string;
  scope?: CampaignParkScope | null;
  data: MarketingCampaignInput;
}): Promise<MarketingCampaignDto> {
  const orgId = requireId(input.orgId, "orgId");
  await assertMarketingEnabled(orgId);
  const existing = await loadCampaignRow(orgId, input.campaignId);
  assertCampaignLocationAllowed(input.scope, existing.locationId);
  if (existing.status === "sending") {
    throw new Error("This issue is being delivered — pause it before editing");
  }
  if (existing.status === "sent" || existing.status === "archived") {
    throw new Error("Sent campaigns are read-only — duplicate it to send again");
  }
  const expected = input.data.expectedUpdatedAt
    ? new Date(String(input.data.expectedUpdatedAt))
    : null;
  if (expected && !Number.isNaN(expected.getTime())) {
    if (expected.getTime() !== existing.updatedAt.getTime()) throw new MarketingConflictError();
  }

  const data = normalizeInput(input.data);
  if (data.locationId !== undefined && data.locationId) {
    await assertVenueInOrg(orgId, data.locationId);
  }
  if (data.locationId !== undefined) {
    assertCampaignLocationAllowed(input.scope, data.locationId);
  }

  const patchData = {
    ...toPrismaData(data),
    ...(data.locationId !== undefined ? { locationId: data.locationId } : {}),
  };
  const merged = { ...existing, ...patchData } as MarketingCampaign;
  const now = new Date();
  let schedulePatch: { nextRunAt: Date; currentWindowKey: string } | null = null;

  if (existing.status === "scheduled") {
    // A live campaign must stay sendable; schedule edits apply to the next issue.
    assertContentReady(merged);
    const scheduleChanged =
      merged.scheduleKind !== existing.scheduleKind ||
      merged.dayOfMonth !== existing.dayOfMonth ||
      merged.sendHour !== existing.sendHour ||
      merged.timezone !== existing.timezone ||
      (merged.sendAt?.getTime() ?? null) !== (existing.sendAt?.getTime() ?? null);
    if (scheduleChanged) {
      assertScheduleReady(merged, now);
      const plan = await planUndeliveredRun(merged, now);
      schedulePatch = { nextRunAt: plan.runAt, currentWindowKey: plan.windowKey };
    }
  }

  // Conditional on status so an edit can never land on an issue that just started sending.
  const updated = await prisma.marketingCampaign.updateMany({
    where: {
      id: existing.id,
      orgId,
      status: existing.status,
      ...(expected ? { updatedAt: existing.updatedAt } : {}),
    },
    data: { ...patchData, ...(schedulePatch ?? {}) },
  });
  if (updated.count === 0) throw new MarketingConflictError();
  const row = await loadCampaignRow(orgId, existing.id);
  const stats = await loadLastWindowStats(orgId, [row.id]);
  return toDto(row, stats.get(row.id) ?? null);
}

function assertContentReady(row: MarketingCampaign): void {
  if (!row.subject.trim()) throw new Error("Add a subject line before sending");
  if (!hasRenderableContent(normalizeCampaignBlocks(row.blocks))) {
    throw new Error("Add some content (text, image, button…) before sending");
  }
  if (row.scheduleKind === "monthly" && !row.dayOfMonth) {
    throw new Error("Choose which day of the month to send");
  }
}

function assertScheduleReady(row: MarketingCampaign, now: Date): void {
  if (row.scheduleKind !== "once") return;
  if (!row.sendAt) throw new Error("Choose a send date and time (or use Send now)");
  if (row.sendAt.getTime() <= now.getTime()) {
    throw new Error("That send time is in the past — pick a future time or use Send now");
  }
}

function planFirstRun(
  row: MarketingCampaign,
  now: Date
): { runAt: Date; windowKey: string } {
  if (row.scheduleKind === "monthly") {
    return nextMonthlyRun({
      after: now,
      dayOfMonth: row.dayOfMonth ?? 1,
      sendHour: row.sendHour,
      timezone: row.timezone,
    });
  }
  const at = row.sendAt && row.sendAt.getTime() > now.getTime() ? row.sendAt : now;
  return { runAt: at, windowKey: ONCE_WINDOW_KEY };
}

/** Like planFirstRun, but a monthly issue that already has deliveries is never reopened. */
async function planUndeliveredRun(
  row: MarketingCampaign,
  now: Date
): Promise<{ runAt: Date; windowKey: string }> {
  const plan = planFirstRun(row, now);
  if (row.scheduleKind !== "monthly") return plan;
  const delivered = await prisma.marketingCampaignRecipient.findFirst({
    where: { campaignId: row.id, windowKey: plan.windowKey },
    select: { id: true },
  });
  return delivered ? planNextMonthlyAfter(row, plan.windowKey, now) : plan;
}

/** Next monthly issue after finishing `finishedWindow` (never the same month twice). */
export function planNextMonthlyAfter(
  row: Pick<MarketingCampaign, "dayOfMonth" | "sendHour" | "timezone">,
  finishedWindow: string,
  now: Date
): { runAt: Date; windowKey: string } {
  const base = {
    dayOfMonth: row.dayOfMonth ?? 1,
    sendHour: row.sendHour,
    timezone: row.timezone,
  };
  let next = nextMonthlyRun({ ...base, after: now });
  if (next.windowKey <= finishedWindow) {
    next = nextMonthlyRun({ ...base, after: next.runAt });
  }
  return next;
}

function currentLocalWindowKey(timezone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value) - 1;
  return monthlyWindowKey(y, m);
}

export async function applyMarketingCampaignAction(input: {
  orgId: string;
  campaignId: string;
  actorUserId?: string | null;
  scope?: CampaignParkScope | null;
  action: CampaignAction | "duplicate";
}): Promise<MarketingCampaignDto> {
  const orgId = requireId(input.orgId, "orgId");
  await assertMarketingEnabled(orgId);
  const row = await loadCampaignRow(orgId, input.campaignId);
  assertCampaignLocationAllowed(input.scope, row.locationId);
  const now = new Date();

  let data: Prisma.MarketingCampaignUpdateManyMutationInput | null = null;
  let fromStatuses: MarketingCampaign["status"][] = [row.status];

  switch (input.action) {
    case "schedule": {
      if (row.status !== "draft" && row.status !== "paused") {
        throw new Error("Only draft or paused campaigns can be scheduled");
      }
      assertContentReady(row);
      assertScheduleReady(row, now);
      const plan = await planUndeliveredRun(row, now);
      data = { status: "scheduled", nextRunAt: plan.runAt, currentWindowKey: plan.windowKey };
      break;
    }
    case "send_now": {
      if (!["draft", "paused", "scheduled"].includes(row.status)) {
        throw new Error("This campaign cannot be sent right now");
      }
      assertContentReady(row);
      const windowKey =
        row.scheduleKind === "monthly"
          ? currentLocalWindowKey(row.timezone, now)
          : ONCE_WINDOW_KEY;
      data = { status: "scheduled", nextRunAt: now, currentWindowKey: windowKey };
      break;
    }
    case "pause": {
      if (row.status !== "scheduled" && row.status !== "sending") {
        throw new Error("Only scheduled campaigns can be paused");
      }
      data = { status: "paused" };
      fromStatuses = ["scheduled", "sending"];
      break;
    }
    case "resume": {
      if (row.status !== "paused") throw new Error("Campaign is not paused");
      assertContentReady(row);
      if (row.scheduleKind === "monthly") {
        const thisMonth = currentLocalWindowKey(row.timezone, now);
        const stale = !row.currentWindowKey || row.currentWindowKey < thisMonth;
        if (stale) {
          const plan = await planUndeliveredRun(row, now);
          data = { status: "scheduled", nextRunAt: plan.runAt, currentWindowKey: plan.windowKey };
          break;
        }
      }
      const windowKey = row.currentWindowKey ?? planFirstRun(row, now).windowKey;
      const started = await prisma.marketingCampaignRecipient.findFirst({
        where: { campaignId: row.id, windowKey },
        select: { id: true },
      });
      data = {
        status: "scheduled",
        // A half-delivered issue continues immediately (drops the runner's claim lease).
        nextRunAt: started ? now : row.nextRunAt ?? now,
        currentWindowKey: windowKey,
      };
      break;
    }
    case "duplicate": {
      const copy = await prisma.marketingCampaign.create({
        data: {
          orgId,
          locationId: row.locationId,
          name: `${row.name} (copy)`.slice(0, 120),
          subject: row.subject,
          preheader: row.preheader,
          blocks: row.blocks as Prisma.InputJsonValue,
          audience: row.audience as Prisma.InputJsonValue,
          scheduleKind: row.scheduleKind,
          dayOfMonth: row.dayOfMonth,
          sendHour: row.sendHour,
          timezone: row.timezone,
          createdById:
            input.actorUserId && isValidId(input.actorUserId) ? input.actorUserId : null,
        },
        include: { location: { select: { name: true } } },
      });
      return toDto(copy, null);
    }
    default:
      throw new Error("Unsupported campaign action");
  }

  const applied = await prisma.marketingCampaign.updateMany({
    where: { id: row.id, orgId, status: { in: fromStatuses } },
    data,
  });
  if (applied.count === 0) {
    throw new Error("This campaign changed status in the meantime — reload and try again");
  }
  const updated = await loadCampaignRow(orgId, row.id);
  const stats = await loadLastWindowStats(orgId, [row.id]);
  return toDto(updated, stats.get(row.id) ?? null);
}

export async function archiveMarketingCampaign(input: {
  orgId: string;
  campaignId: string;
  scope?: CampaignParkScope | null;
}): Promise<void> {
  const orgId = requireId(input.orgId, "orgId");
  await assertMarketingEnabled(orgId);
  const row = await loadCampaignRow(orgId, input.campaignId);
  assertCampaignLocationAllowed(input.scope, row.locationId);
  if (row.status === "sending") {
    throw new Error("Pause the campaign before archiving it");
  }
  const archived = await prisma.marketingCampaign.updateMany({
    where: { id: row.id, orgId, status: { not: "sending" } },
    data: { status: "archived", nextRunAt: null },
  });
  if (archived.count === 0) {
    throw new Error("Pause the campaign before archiving it");
  }
}

// ── Rendering ────────────────────────────────────────────────────────────────

export type CampaignRenderBase = {
  orgId: string;
  orgName: string;
  address: string | null;
  websiteUrl: string;
  bookUrl: string;
  events: CampaignEventItem[];
  replyTo: string | null;
  fromName: string | null;
};

function formatAddress(p: {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
} | null): string | null {
  if (!p) return null;
  const parts = [p.addressLine1, p.addressLine2, p.city, p.state, p.postalCode, p.country]
    .map((v) => v?.trim())
    .filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

async function loadUpcomingEvents(input: {
  orgId: string;
  locationId: string | null;
  limit: number;
  timezone: string;
  fallbackUrl: string;
}): Promise<CampaignEventItem[]> {
  if (input.limit <= 0) return [];
  const now = new Date();
  const sessions = await prisma.ticketSession.findMany({
    where: {
      orgId: input.orgId,
      ...(input.locationId ? { locationId: input.locationId } : {}),
      isClosed: false,
      remaining: { gt: 0 },
      startsAt: { gt: now, lt: new Date(now.getTime() + 45 * 86_400_000) },
      product: { published: true, archivedAt: null },
      location: { status: "active", archivedAt: null },
    },
    select: {
      label: true,
      startsAt: true,
      product: { select: { name: true } },
      location: { select: { slug: true, publicBookingEnabled: true, timezone: true } },
    },
    orderBy: { startsAt: "asc" },
    take: input.limit * 4,
  });
  const base = publicAppBaseUrl();
  const seen = new Set<string>();
  const items: CampaignEventItem[] = [];
  for (const s of sessions) {
    const title = s.label?.trim() ? `${s.product.name} — ${s.label.trim()}` : s.product.name;
    const tz = s.location.timezone?.trim() && isValidTimeZone(s.location.timezone)
      ? s.location.timezone
      : input.timezone;
    const when = formatEventWhen(s.startsAt, tz);
    const key = `${title}|${when}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      title,
      when,
      url: s.location.publicBookingEnabled
        ? `${base}/book/${s.location.slug}`
        : input.fallbackUrl,
    });
    if (items.length >= input.limit) break;
  }
  return items;
}

export async function loadCampaignRenderBase(input: {
  orgId: string;
  locationId: string | null;
  timezone: string;
  blocks: CampaignBlock[];
}): Promise<CampaignRenderBase> {
  const settings = await getOrCreateMarketingSettings(input.orgId);
  const [org, profile, venue] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: input.orgId },
      select: { name: true, slug: true },
    }),
    prisma.companyProfile.findUnique({
      where: { orgId: input.orgId },
      select: {
        tradingName: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        postalCode: true,
        country: true,
      },
    }),
    input.locationId
      ? prisma.venueLocation.findFirst({
          where: { id: input.locationId, orgId: input.orgId },
          select: { slug: true, publicBookingEnabled: true },
        })
      : Promise.resolve(null),
  ]);
  const ctas = await resolveCtaUrls({
    orgId: input.orgId,
    orgSlug: org?.slug,
    settings,
  });
  const bookUrl =
    venue?.publicBookingEnabled && venue.slug
      ? `${publicAppBaseUrl()}/book/${venue.slug}`
      : ctas.bookAgainUrl;
  const orgName = profile?.tradingName?.trim() || org?.name || "Our park";
  const events = await loadUpcomingEvents({
    orgId: input.orgId,
    locationId: input.locationId,
    limit: usesEventsBlock(input.blocks),
    timezone: input.timezone,
    fallbackUrl: bookUrl,
  });
  return {
    orgId: input.orgId,
    orgName,
    address: formatAddress(profile),
    websiteUrl: ctas.websiteUrl,
    bookUrl,
    events,
    replyTo: settings.replyToEmail,
    fromName: settings.fromName,
  };
}

export function renderCampaignForGuest(input: {
  base: CampaignRenderBase;
  subject: string;
  preheader: string | null;
  blocks: CampaignBlock[];
  windowKey: string | null;
  timezone: string;
  guestFirstName: string;
  unsubscribeUrl: string;
}): { subject: string; html: string } {
  const vars: CampaignMergeVars = {
    guestFirstName: input.guestFirstName.trim() || "there",
    orgName: input.base.orgName,
    websiteUrl: input.base.websiteUrl,
    bookUrl: input.base.bookUrl,
    monthName: monthNameForWindow(input.windowKey, input.timezone),
  };
  return {
    subject: renderCampaignSubject(input.subject, vars),
    html: renderCampaignBodyHtml(input.blocks, {
      vars,
      events: input.base.events,
      preheader: input.preheader,
      footer: {
        orgName: input.base.orgName,
        address: input.base.address,
        unsubscribeUrl: input.unsubscribeUrl,
      },
    }),
  };
}

/** Preview unsaved composer state — returns the full branded HTML + audience size. */
export async function previewMarketingCampaign(input: {
  orgId: string;
  scope?: CampaignParkScope | null;
  data: MarketingCampaignInput;
}): Promise<{
  subject: string;
  preheader: string;
  fromName: string;
  html: string;
  audienceCount: number;
  eventCount: number;
}> {
  const orgId = requireId(input.orgId, "orgId");
  await assertMarketingEnabled(orgId);
  const data = normalizeInput(input.data);
  const locationId =
    data.locationId ??
    (input.scope?.parkLocked
      ? input.scope.locationId ?? input.scope.assignedLocationIds[0] ?? null
      : null);
  if (locationId) await assertVenueInOrg(orgId, locationId);
  assertCampaignLocationAllowed(input.scope, locationId);
  const blocks = data.blocks ?? [];
  const timezone = data.timezone ?? (await defaultTimezone(orgId, locationId));
  const base = await loadCampaignRenderBase({ orgId, locationId, timezone, blocks });
  const windowKey =
    data.scheduleKind === "monthly" ? currentLocalWindowKey(timezone, new Date()) : null;
  const rendered = renderCampaignForGuest({
    base,
    subject: data.subject || "(no subject)",
    preheader: data.preheader ?? null,
    blocks,
    windowKey,
    timezone,
    guestFirstName: "Alex",
    unsubscribeUrl: "#unsubscribe",
  });
  const html = await renderMarketingGuestEmailPreview({
    orgId,
    subject: rendered.subject,
    htmlBody: rendered.html,
  });
  const audienceCount = await countCampaignAudience({
    orgId,
    locationId,
    audience: data.audience ?? normalizeCampaignAudience(null),
  });
  const preheader = data.preheader
    ? renderCampaignSubject(data.preheader, {
        guestFirstName: "Alex",
        orgName: base.orgName,
        websiteUrl: base.websiteUrl,
        bookUrl: base.bookUrl,
        monthName: monthNameForWindow(windowKey, timezone),
      })
    : "";
  return {
    subject: rendered.subject,
    preheader,
    fromName: base.fromName?.trim() || base.orgName,
    html,
    audienceCount,
    eventCount: base.events.length,
  };
}

/** Sends the saved campaign to the signed-in staff member only. */
export async function sendMarketingCampaignTest(input: {
  orgId: string;
  campaignId: string;
  actorUserId: string;
  scope?: CampaignParkScope | null;
}): Promise<{ sent: boolean; toEmail: string }> {
  const orgId = requireId(input.orgId, "orgId");
  await assertMarketingEnabled(orgId);
  const row = await loadCampaignRow(orgId, input.campaignId);
  assertCampaignLocationAllowed(input.scope, row.locationId);
  const user = await prisma.user.findUnique({
    where: { id: requireId(input.actorUserId, "userId") },
    select: { email: true, firstName: true },
  });
  const toEmail = user?.email?.trim();
  if (!toEmail) {
    throw new Error("Your staff account has no email — test send goes to you only");
  }
  const blocks = normalizeCampaignBlocks(row.blocks);
  const base = await loadCampaignRenderBase({
    orgId,
    locationId: row.locationId,
    timezone: row.timezone,
    blocks,
  });
  const rendered = renderCampaignForGuest({
    base,
    subject: row.subject || "(no subject)",
    preheader: row.preheader,
    blocks,
    windowKey:
      row.scheduleKind === "monthly"
        ? row.currentWindowKey ?? currentLocalWindowKey(row.timezone, new Date())
        : null,
    timezone: row.timezone,
    guestFirstName: user?.firstName?.trim() || "there",
    unsubscribeUrl: buildUnsubscribeUrl(orgId, input.actorUserId),
  });
  const sent = await sendMarketingGuestEmail({
    orgId,
    to: toEmail,
    subject: `[Test] ${rendered.subject}`,
    htmlBody: rendered.html,
    replyTo: base.replyTo,
    fromName: base.fromName,
  });
  return { sent, toEmail };
}
