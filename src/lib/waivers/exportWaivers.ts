/**
 * Staff CSV export. Content hashes only — signature drawings stay off the file.
 */
import { P } from "@/lib/auth/permissions";
import prisma from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rateLimit";
import { WaiverLinkError } from "@/lib/waivers/signToken";
import { assertWaiverPermission } from "@/lib/waivers/access";
import { waiverStampedLocationWhere, type WaiversActor } from "@/lib/waivers/common";
import { waiverRecordDisplayStatus, waiverRecordListWhere, type WaiverRecordListQuery } from "@/lib/waivers/records";
import { redactWaiverFormAnswers } from "@/lib/waivers/capture";

function cell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function csv(rows: unknown[][]): string {
  return rows.map((row) => row.map(cell).join(",")).join("\n");
}

export async function exportWaiverCsv(
  actor: WaiversActor,
  type: "records" | "responses",
  recordQuery?: WaiverRecordListQuery
): Promise<string> {
  const orgId = await assertWaiverPermission(actor, P.WaiversExport);
  const limit = consumeRateLimit(`waiver-export:${orgId}`, 10, 60 * 60 * 1000);
  if (!limit.allowed) {
    throw new WaiverLinkError("Too many exports. Try again shortly.", 429);
  }
  const scope = await waiverStampedLocationWhere(actor);
  const where = {
    orgId,
    ...(scope.locationId ? { locationId: scope.locationId } : {}),
  };
  if (type === "responses") {
    const templateId = recordQuery?.templateId?.trim();
    const rows = await prisma.formResponse.findMany({
      where: {
        ...where,
        ...(templateId ? { templateId } : {}),
      },
      include: {
        template: { select: { name: true, slug: true } },
        templateVersion: { select: { version: true, contentSha256: true } },
        guestProfile: { select: { firstName: true, lastName: true, email: true, phone: true } },
        waiverRecord: { select: { guardian: { select: { email: true, phone: true } } } },
      },
      orderBy: { submittedAt: "desc" },
      take: 5000,
    });
    return csv([
      ["submittedAt", "template", "slug", "version", "contentSha256", "guest", "email", "phone", "status", "locale", "source", "answers"],
      ...rows.map((row) => {
        const answers = redactWaiverFormAnswers(row.payloadJson);
        const packed = Object.entries(answers)
          .map(([key, value]) => `${key}=${value}`)
          .join(" | ");
        return [
          row.submittedAt.toISOString(),
          row.template.name,
          row.template.slug,
          row.templateVersion.version,
          row.templateVersion.contentSha256,
          row.guestProfile
            ? `${row.guestProfile.firstName} ${row.guestProfile.lastName}`.trim()
            : "",
          row.guestProfile?.email || row.waiverRecord?.guardian?.email || "",
          row.guestProfile?.phone || row.waiverRecord?.guardian?.phone || "",
          row.status,
          row.locale,
          row.source,
          packed,
        ];
      }),
    ]);
  }
  const now = new Date();
  const recordWhere = await waiverRecordListWhere(actor, recordQuery);
  const rows = await prisma.waiverRecord.findMany({
    where: recordWhere,
    include: {
      template: { select: { name: true, slug: true } },
      templateVersion: { select: { version: true, contentSha256: true } },
      guestProfile: { select: { firstName: true, lastName: true, email: true, phone: true } },
      guardian: { select: { email: true, phone: true } },
      signatures: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { contentSha256: true, acceptedClauses: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });
  function clauseSummary(raw: unknown): { count: number; labels: string } {
    if (!Array.isArray(raw)) return { count: 0, labels: "" };
    const labels = raw
      .map((row) =>
        row && typeof row === "object" && "label" in row && typeof (row as { label: unknown }).label === "string"
          ? (row as { label: string }).label
          : ""
      )
      .filter(Boolean);
    return { count: labels.length, labels: labels.join("; ") };
  }

  return csv([
    [
      "publicRef",
      "guest",
      "email",
      "phone",
      "template",
      "slug",
      "version",
      "contentSha256",
      "status",
      "channel",
      "signedAt",
      "expiresAt",
      "locale",
      "fillMethod",
      "clausesAcceptedCount",
      "clausesAcceptedLabels",
    ],
    ...rows.map((row) => {
      const clauses = clauseSummary(row.signatures[0]?.acceptedClauses);
      return [
        row.publicRef,
        `${row.guestProfile.firstName} ${row.guestProfile.lastName}`.trim(),
        row.guestProfile.email || row.guardian?.email || "",
        row.guestProfile.phone || row.guardian?.phone || "",
        row.template.name,
        row.template.slug,
        row.templateVersion.version,
        row.signatures[0]?.contentSha256 || row.templateVersion.contentSha256,
        waiverRecordDisplayStatus(row.status, row.expiresAt, now),
        row.channel,
        row.signedAt?.toISOString() ?? "",
        row.expiresAt?.toISOString() ?? "",
        row.locale,
        row.fillMethod ?? "",
        clauses.count,
        clauses.labels,
      ];
    }),
  ]);
}
