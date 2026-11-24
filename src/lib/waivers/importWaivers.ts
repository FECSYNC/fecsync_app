/**
 * Historical waiver CSV. Does not replace a newer live signature.
 */
import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import { P } from "@/lib/auth/permissions";
import prisma from "@/lib/prisma";
import { assertWaiverPermission } from "@/lib/waivers/access";
import { rejectClientOrgFields, requireActorVenueInScope, type WaiversActor } from "@/lib/waivers/common";
import { logActivityEntryAsync } from "@/lib/audit/activityLog";
import {
  computeWaiverExpiresAt,
  zonedParts,
  type WaiverExpiryRuleName,
} from "@/lib/waivers/expiry";

const MAX_ROWS = 2000;
const COLUMNS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "dob",
  "signedAt",
  "expiresAt",
  "templateSlug",
  "locale",
  "externalRef",
  "guardianName",
] as const;

export type ImportRowResult = {
  row: number;
  ok: boolean;
  externalRef: string | null;
  error?: string;
  publicRef?: string;
  action?: "preview" | "created" | "exists";
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(cell.trim());
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += ch;
  }
  row.push(cell.trim());
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

function ageYears(dob: Date, on: Date, timeZone: string): number {
  const today = zonedParts(on, timeZone || "UTC");
  let age = today.year - dob.getUTCFullYear();
  const month = dob.getUTCMonth() + 1;
  const day = dob.getUTCDate();
  if (today.month < month || (today.month === month && today.day < day)) age -= 1;
  return age;
}

function parseDate(value: string, label: string): Date {
  const raw = value.trim();
  const day = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}/.test(day)) throw new Error(`${label} must be YYYY-MM-DD`);
  const dt = new Date(raw.length > 10 ? raw : `${day}T12:00:00.000Z`);
  if (Number.isNaN(dt.getTime())) throw new Error(`${label} is invalid`);
  return dt;
}

export async function importWaiverCsv(
  actor: WaiversActor,
  input: { csv: string; locationId: string; dryRun: boolean }
) {
  rejectClientOrgFields(input);
  const orgId = await assertWaiverPermission(actor, P.WaiversAdmin);
  const locationId = input.locationId.trim();
  const venue = await requireActorVenueInScope(actor, locationId);
  if (venue.status !== "active") throw new Error("Choose an active venue");
  const settingsRows = await prisma.waiverSettings.findMany({
    where: { orgId },
    select: {
      locationId: true,
      expiryRule: true,
      expiryDays: true,
      ageOfMajorityYears: true,
      requireGuardianForMinors: true,
    },
  });
  const settings =
    settingsRows.find((row) => row.locationId === locationId) ??
    settingsRows.find((row) => row.locationId == null) ??
    null;
  const table = parseCsv(input.csv || "");
  if (table.length < 2) throw new Error("The CSV needs a header and at least one row");
  const header = table[0].map((col) => col.trim());
  for (const required of ["firstName", "lastName", "signedAt", "templateSlug"]) {
    if (!header.includes(required)) throw new Error(`Missing column ${required}`);
  }
  const data = table.slice(1);
  if (data.length > MAX_ROWS) throw new Error(`Import at most ${MAX_ROWS} rows`);
  const results: ImportRowResult[] = [];
  let created = 0;
  let existing = 0;
  let failed = 0;

  for (let index = 0; index < data.length; index += 1) {
    const cells = data[index];
    const bag: Record<string, string> = {};
    header.forEach((key, i) => {
      bag[key] = cells[i] ?? "";
    });
    const rowNo = index + 2;
    const externalRef = bag.externalRef?.trim() || null;
    try {
      const firstName = bag.firstName?.trim();
      const lastName = bag.lastName?.trim();
      if (!firstName || !lastName) throw new Error("First and last name are required");
      const signedAt = parseDate(bag.signedAt, "signedAt");
      let expiresAt = bag.expiresAt?.trim() ? parseDate(bag.expiresAt, "expiresAt") : null;
      if (expiresAt && expiresAt.getTime() < signedAt.getTime()) {
        throw new Error("expiresAt is before signedAt");
      }
      const template = await prisma.waiverTemplate.findFirst({
        where: { orgId, slug: bag.templateSlug.trim(), status: "published", archivedAt: null },
        include: { currentPublishedVersion: true },
      });
      if (!template?.currentPublishedVersion) throw new Error("Published template not found");
      if (template.locationId && template.locationId !== locationId) {
        throw new Error("That template belongs to another venue");
      }
      if (!expiresAt) {
        const templateRule = template.defaultExpiryRule;
        const rule = (templateRule || settings?.expiryRule || "calendar_year") as WaiverExpiryRuleName;
        const expiryDays =
          rule !== "days"
            ? null
            : templateRule === "days"
              ? (template.defaultExpiryDays ?? settings?.expiryDays ?? null)
              : (settings?.expiryDays ?? null);
        expiresAt = computeWaiverExpiresAt({
          rule,
          signedAt,
          expiryDays,
          timeZone: venue.timezone || "UTC",
        });
        if (!expiresAt && rule !== "never") {
          throw new Error("expiresAt is required for this template");
        }
      }
      const dob = bag.dob?.trim() ? parseDate(bag.dob, "dob") : null;
      const majority = settings?.ageOfMajorityYears ?? 18;
      const requireGuardian = settings?.requireGuardianForMinors ?? true;
      const minor =
        Boolean(dob) &&
        requireGuardian &&
        ageYears(dob!, signedAt, venue.timezone || "UTC") < majority;
      if (minor && !bag.guardianName?.trim()) {
        throw new Error("A guardian name is required for a minor");
      }
      if (externalRef) {
        const prior = await prisma.waiverRecord.findFirst({
          where: { orgId, externalRef },
          select: { id: true, publicRef: true },
        });
        if (prior) {
          existing += 1;
          results.push({
            row: rowNo,
            ok: true,
            externalRef,
            publicRef: prior.publicRef,
            action: "exists",
          });
          continue;
        }
      }
      const email = bag.email?.trim().toLowerCase() || null;
      const phone = (bag.phone ?? "").replace(/[^\d+]/g, "") || null;
      let guest = email
        ? await prisma.guestProfile.findFirst({
            where: { orgId, email: { equals: email, mode: "insensitive" } },
            select: { id: true, bannedAt: true, locationId: true },
          })
        : null;
      if (!guest && phone) {
        guest = await prisma.guestProfile.findFirst({
          where: { orgId, phone },
          select: { id: true, bannedAt: true, locationId: true },
        });
      }
      if (guest?.bannedAt) throw new Error("This guest is blocked and cannot be imported");
      if (guest) {
        const newer = await prisma.waiverRecord.findFirst({
          where: {
            orgId,
            guestProfileId: guest.id,
            templateId: template.id,
            status: "signed",
            signedAt: { gt: signedAt },
          },
          select: { id: true },
        });
        if (newer) throw new Error("A newer signature is already on file");
      }
      if (input.dryRun) {
        results.push({ row: rowNo, ok: true, externalRef, action: "preview" });
        continue;
      }
      const saved = await prisma.$transaction(async (tx) => {
        if (guest?.id && !guest.locationId) {
          await tx.guestProfile.update({
            where: { id: guest.id },
            data: { locationId },
          });
        }
        const guestId =
          guest?.id ??
          (
            await tx.guestProfile.create({
              data: {
                orgId,
                locationId,
                firstName: firstName.slice(0, 80),
                lastName: lastName.slice(0, 80),
                email,
                phone: phone && phone.length >= 7 ? phone : null,
                dateOfBirth: dob,
              },
              select: { id: true },
            })
          ).id;
        const publicRef = `WR${randomBytes(4).toString("hex").toUpperCase()}`;
        const record = await tx.waiverRecord.create({
          data: {
            orgId,
            locationId,
            guestProfileId: guestId,
            templateId: template.id,
            templateVersionId: template.currentPublishedVersion!.id,
            status: "signed",
            signerRole: "imported",
            channel: "import",
            locale: (bag.locale || "en").slice(0, 12) || "en",
            signedAt,
            expiresAt,
            externalRef,
            importedFrom: "csv",
            publicRef,
            waiverGroupId: `wg_${randomBytes(12).toString("hex")}`,
          },
        });
        await tx.waiverSigner.create({
          data: {
            orgId,
            waiverRecordId: record.id,
            guestProfileId: guestId,
            fullName: `${firstName} ${lastName}`.trim(),
            dateOfBirth: dob,
            isMinor: minor,
            role: minor ? "minor" : "adult_self",
          },
        });
        if (bag.guardianName?.trim()) {
          await tx.waiverSigner.create({
            data: {
              orgId,
              waiverRecordId: record.id,
              fullName: bag.guardianName.trim().slice(0, 80),
              isMinor: false,
              role: "guardian",
            },
          });
        }
        await tx.waiverSignature.create({
          data: {
            orgId,
            waiverRecordId: record.id,
            signedAt,
            timezone: venue.timezone || "UTC",
            intentAccepted: true,
            typedName: `${firstName} ${lastName}`.trim(),
            witnessName: "imported historical",
            locale: (bag.locale || "en").slice(0, 12) || "en",
            templateVersionId: template.currentPublishedVersion!.id,
            contentSha256: template.currentPublishedVersion!.contentSha256,
          },
        });
        return record;
      });
      created += 1;
      results.push({
        row: rowNo,
        ok: true,
        externalRef,
        publicRef: saved.publicRef,
        action: "created",
      });
    } catch (err) {
      if (
        externalRef &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        const prior = await prisma.waiverRecord.findFirst({
          where: { orgId, externalRef },
          select: { publicRef: true },
        });
        existing += 1;
        results.push({
          row: rowNo,
          ok: true,
          externalRef,
          publicRef: prior?.publicRef,
          action: "exists",
        });
        continue;
      }
      failed += 1;
      results.push({
        row: rowNo,
        ok: false,
        externalRef,
        error: err instanceof Error ? err.message : "Could not import this row",
      });
    }
  }

  if (!input.dryRun && created > 0) {
    await logActivityEntryAsync({
      actorSub: actor.sub,
      orgId,
      action: "waiver.import",
      entityType: "WaiverRecord",
      entityId: orgId,
      description: `Imported ${created} historical waivers`,
      metadata: { created, existing, failed },
    });
  }

  return { dryRun: input.dryRun, created, existing, failed, results, columns: COLUMNS };
}
