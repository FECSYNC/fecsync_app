import type { GuestSurveyStatus, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireId, isValidId } from "@/lib/ids";
import { assertVenueInOrg } from "@/lib/guests/upsertFromChannel";
import { assertMarketingEnabled } from "@/lib/marketing/assert";
import { renderMarketingTemplate } from "@/lib/marketing/templates";
import { sendPromotionalMarketingEmail } from "@/lib/marketing/send";
import type {
  GuestSurveyDto,
  GuestSurveyInviteDto,
  GuestSurveyResponseDto,
} from "@/lib/marketing/types";
import { publicAppBaseUrl } from "@/lib/publicAppBaseUrl";

function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || "survey";
}

function toSurveyDto(row: {
  id: string;
  orgId: string;
  locationId: string | null;
  name: string;
  slug: string;
  status: GuestSurveyStatus;
  questions: Prisma.JsonValue;
  thankYouMessage: string | null;
  promoUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}): GuestSurveyDto {
  return {
    id: row.id,
    orgId: row.orgId,
    locationId: row.locationId,
    name: row.name,
    slug: row.slug,
    status: row.status,
    questions: row.questions,
    thankYouMessage: row.thankYouMessage,
    promoUrl: row.promoUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toInviteDto(row: {
  id: string;
  orgId: string;
  surveyId: string;
  guestProfileId: string;
  locationId: string | null;
  bookingId: string | null;
  visitRef: string | null;
  token: string;
  sentAt: Date | null;
  openedAt?: Date | null;
  completedAt: Date | null;
  expiresAt: Date | null;
}): GuestSurveyInviteDto {
  return {
    id: row.id,
    orgId: row.orgId,
    surveyId: row.surveyId,
    guestProfileId: row.guestProfileId,
    locationId: row.locationId,
    bookingId: row.bookingId,
    visitRef: row.visitRef,
    token: row.token,
    sentAt: row.sentAt?.toISOString() ?? null,
    openedAt: row.openedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}

function toResponseDto(row: {
  id: string;
  orgId: string;
  surveyId: string;
  inviteId: string | null;
  guestProfileId: string | null;
  answers: Prisma.JsonValue;
  rating: number | null;
  comment: string | null;
  createdAt: Date;
}): GuestSurveyResponseDto {
  return {
    id: row.id,
    orgId: row.orgId,
    surveyId: row.surveyId,
    inviteId: row.inviteId,
    guestProfileId: row.guestProfileId,
    answers: row.answers,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.createdAt.toISOString(),
  };
}

export function buildVisitRef(input: {
  guestProfileId: string;
  visitDay: string;
  bookingId?: string | null;
}): string {
  if (input.bookingId) {
    return `booking:${input.bookingId}`;
  }
  return `visit:${input.guestProfileId}:${input.visitDay}`;
}

export async function listGuestSurveys(orgId: string): Promise<GuestSurveyDto[]> {
  const id = requireId(orgId, "orgId");
  await assertMarketingEnabled(id);
  const rows = await prisma.guestSurvey.findMany({
    where: { orgId: id },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(toSurveyDto);
}

export async function getGuestSurvey(
  orgId: string,
  surveyId: string
): Promise<GuestSurveyDto | null> {
  const id = requireId(orgId, "orgId");
  const sid = requireId(surveyId, "surveyId");
  const row = await prisma.guestSurvey.findFirst({
    where: { id: sid, orgId: id },
  });
  return row ? toSurveyDto(row) : null;
}

export async function createGuestSurvey(input: {
  orgId: string;
  name: string;
  locationId?: string | null;
  questions?: unknown;
  thankYouMessage?: string | null;
  promoUrl?: string | null;
  createdById?: string | null;
}): Promise<GuestSurveyDto> {
  const orgId = requireId(input.orgId, "orgId");
  await assertMarketingEnabled(orgId);
  const name = input.name.trim();
  if (!name) throw new Error("name is required");

  let locationId: string | null = input.locationId ?? null;
  if (locationId) {
    if (!isValidId(locationId)) throw new Error("locationId is invalid");
    await assertVenueInOrg(orgId, locationId);
  }

  let slug = slugify(name);
  for (let i = 0; i < 20; i += 1) {
    const candidate = i === 0 ? slug : `${slug}-${i + 1}`;
    const taken = await prisma.guestSurvey.findUnique({
      where: { orgId_slug: { orgId, slug: candidate } },
      select: { id: true },
    });
    if (!taken) {
      slug = candidate;
      break;
    }
  }

  const row = await prisma.guestSurvey.create({
    data: {
      orgId,
      locationId,
      name: name.slice(0, 200),
      slug,
      questions: (input.questions ?? []) as Prisma.InputJsonValue,
      thankYouMessage: input.thankYouMessage?.trim().slice(0, 2000) ?? null,
      promoUrl: input.promoUrl?.trim().slice(0, 500) ?? null,
      createdById: input.createdById ?? null,
    },
  });
  return toSurveyDto(row);
}

export async function updateGuestSurvey(
  orgId: string,
  surveyId: string,
  patch: Partial<{
    name: string;
    locationId: string | null;
    status: GuestSurveyStatus;
    questions: unknown;
    thankYouMessage: string | null;
    promoUrl: string | null;
  }>
): Promise<GuestSurveyDto> {
  const id = requireId(orgId, "orgId");
  const sid = requireId(surveyId, "surveyId");
  await assertMarketingEnabled(id);

  const existing = await prisma.guestSurvey.findFirst({
    where: { id: sid, orgId: id },
  });
  if (!existing) throw new Error("Survey not found");

  if (patch.locationId) {
    if (!isValidId(patch.locationId)) throw new Error("locationId is invalid");
    await assertVenueInOrg(id, patch.locationId);
  }

  const row = await prisma.guestSurvey.update({
    where: { id: sid },
    data: {
      ...(patch.name !== undefined ? { name: patch.name.trim().slice(0, 200) } : {}),
      ...(patch.locationId !== undefined ? { locationId: patch.locationId } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.questions !== undefined
        ? { questions: patch.questions as Prisma.InputJsonValue }
        : {}),
      ...(patch.thankYouMessage !== undefined
        ? { thankYouMessage: patch.thankYouMessage?.trim().slice(0, 2000) ?? null }
        : {}),
      ...(patch.promoUrl !== undefined
        ? { promoUrl: patch.promoUrl?.trim().slice(0, 500) ?? null }
        : {}),
    },
  });
  return toSurveyDto(row);
}

export async function createSurveyInvite(input: {
  orgId: string;
  surveyId: string;
  guestProfileId: string;
  locationId?: string | null;
  bookingId?: string | null;
  visitRef?: string | null;
  expiresAt?: Date | null;
}): Promise<GuestSurveyInviteDto> {
  const orgId = requireId(input.orgId, "orgId");
  const surveyId = requireId(input.surveyId, "surveyId");
  const guestProfileId = requireId(input.guestProfileId, "guestProfileId");

  const survey = await prisma.guestSurvey.findFirst({
    where: { id: surveyId, orgId },
    select: { id: true, status: true },
  });
  if (!survey) throw new Error("Survey not found");

  const guest = await prisma.guestProfile.findFirst({
    where: { id: guestProfileId, orgId },
    select: { id: true, bannedAt: true },
  });
  if (!guest || guest.bannedAt) throw new Error("Guest not eligible for survey invite");

  const row = await prisma.guestSurveyInvite.create({
    data: {
      orgId,
      surveyId,
      guestProfileId,
      locationId: input.locationId ?? null,
      bookingId: input.bookingId ?? null,
      visitRef: input.visitRef ?? null,
      expiresAt: input.expiresAt ?? null,
    },
  });
  return toInviteDto(row);
}

export async function getInviteByToken(token: string): Promise<{
  invite: GuestSurveyInviteDto;
  survey: GuestSurveyDto;
} | null> {
  const trimmed = token.trim();
  if (!trimmed) return null;

  const invite = await prisma.guestSurveyInvite.findUnique({
    where: { token: trimmed },
    include: { survey: true },
  });
  if (!invite) return null;
  if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) return null;
  if (invite.survey.status !== "published") return null;

  return {
    invite: toInviteDto(invite),
    survey: toSurveyDto(invite.survey),
  };
}

export async function submitSurveyResponse(input: {
  token: string;
  answers?: Record<string, unknown>;
  rating?: number | null;
  comment?: string | null;
}): Promise<GuestSurveyResponseDto> {
  const loaded = await getInviteByToken(input.token);
  if (!loaded) throw new Error("Survey invite not found or expired");

  if (loaded.invite.completedAt) {
    throw new Error("This survey was already completed");
  }

  const rating =
    input.rating == null
      ? null
      : Math.min(5, Math.max(1, Math.round(Number(input.rating))));

  const response = await prisma.$transaction(async (tx) => {
    const row = await tx.guestSurveyResponse.create({
      data: {
        orgId: loaded.invite.orgId,
        surveyId: loaded.invite.surveyId,
        inviteId: loaded.invite.id,
        guestProfileId: loaded.invite.guestProfileId,
        answers: (input.answers ?? {}) as Prisma.InputJsonValue,
        rating,
        comment: input.comment?.trim().slice(0, 5000) ?? null,
      },
    });
    await tx.guestSurveyInvite.update({
      where: { id: loaded.invite.id },
      data: { completedAt: new Date() },
    });
    return row;
  });

  const guest = await prisma.guestProfile.findFirst({
    where: { id: loaded.invite.guestProfileId },
    select: { id: true, firstName: true, email: true, marketingEmailOptIn: true, bannedAt: true },
  });

  const promoUrl = loaded.survey.promoUrl?.trim() || null;
  if (
    guest?.email &&
    guest.marketingEmailOptIn &&
    !guest.bannedAt
  ) {
    try {
      const org = await prisma.organization.findUnique({
        where: { id: loaded.invite.orgId },
        select: { name: true, slug: true },
      });
      const rendered = await renderMarketingTemplate({
        orgId: loaded.invite.orgId,
        kind: "survey_thank_you",
        guestProfileId: guest.id,
        guestFirstName: guest.firstName,
        orgName: org?.name ?? "Our park",
        orgSlug: org?.slug,
        settings: { promoCodeOrUrl: promoUrl },
      });
      await sendPromotionalMarketingEmail({
        orgId: loaded.invite.orgId,
        locationId: loaded.invite.locationId,
        guestProfileId: guest.id,
        kind: "survey_thank_you",
        automationKey: `survey_thank_you:${loaded.invite.id}`,
        subject: rendered.subject,
        htmlBody: rendered.html,
        templateKey: rendered.templateKey,
      });
    } catch (err) {
      // Response already persisted — never fail the guest submit on mail errors.
      console.error(
        "[marketing] survey thank-you email failed:",
        err instanceof Error ? err.message : err
      );
    }
  }

  return toResponseDto(response);
}

export async function listSurveyResponses(
  orgId: string,
  surveyId: string,
  opts?: { take?: number }
): Promise<GuestSurveyResponseDto[]> {
  const id = requireId(orgId, "orgId");
  const sid = requireId(surveyId, "surveyId");
  await assertMarketingEnabled(id);

  const take = Math.min(Math.max(opts?.take ?? 100, 1), 500);
  const rows = await prisma.guestSurveyResponse.findMany({
    where: { orgId: id, surveyId: sid },
    orderBy: { createdAt: "desc" },
    take,
  });
  return rows.map(toResponseDto);
}

function csvEscape(value: string | number | null | undefined): string {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(s)) {
    s = `'${s}`;
  }
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvRow(cells: Array<string | number | null | undefined>): string {
  return cells.map(csvEscape).join(",");
}

export async function exportSurveyResponsesCsv(
  orgId: string,
  surveyId: string
): Promise<string> {
  const id = requireId(orgId, "orgId");
  const sid = requireId(surveyId, "surveyId");
  await assertMarketingEnabled(id);

  const survey = await prisma.guestSurvey.findFirst({
    where: { id: sid, orgId: id },
    select: { name: true },
  });
  if (!survey) throw new Error("Survey not found");

  const rows = await prisma.guestSurveyResponse.findMany({
    where: { orgId: id, surveyId: sid },
    orderBy: { createdAt: "asc" },
    include: {
      guest: { select: { firstName: true, lastName: true, email: true } },
    },
  });

  const lines = [
    csvRow([
      "responseId",
      "createdAt",
      "guestName",
      "guestEmail",
      "rating",
      "comment",
      "answersJson",
    ]),
  ];

  for (const row of rows) {
    const name = row.guest
      ? `${row.guest.firstName} ${row.guest.lastName}`.trim()
      : "";
    lines.push(
      csvRow([
        row.id,
        row.createdAt.toISOString(),
        name,
        row.guest?.email ?? "",
        row.rating,
        row.comment,
        JSON.stringify(row.answers),
      ])
    );
  }

  return lines.join("\n");
}

export function buildPublicSurveyUrl(token: string): string {
  return `${publicAppBaseUrl()}/survey/${token}`;
}
