import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  assertLocationInWaiverScope,
  assertWaiversStaff,
  waiverStampedLocationWhere,
  type WaiversActor,
} from "@/lib/waivers/common";

export type WaiverRecordListItem = {
  id: string;
  publicRef: string;
  status: string;
  locationId: string;
  guestProfileId: string;
  guestName: string;
  guestEmail: string | null;
  templateId: string;
  templateName: string;
  version: number | null;
  locale: string;
  signedAt: string | null;
  expiresAt: string | null;
  channel: string;
  fillMethod: string | null;
  minorCount: number;
  createdAt: string;
};

const RECORD_STATUSES = new Set([
  "pending",
  "signed",
  "expired",
  "declined",
  "voided",
  "revoked",
]);

const CHANNELS = new Set([
  "online",
  "email_link",
  "sms_link",
  "qr",
  "kiosk",
  "onsite",
  "import",
]);

export type WaiverRecordListQuery = {
  status?: string;
  q?: string;
  email?: string;
  phone?: string;
  templateId?: string;
  locationId?: string;
  channel?: string;
  from?: string;
  to?: string;
  expiringWithinDays?: number;
};

/** Stored rows stay `signed`. The list and detail show `expired` once expiresAt has passed. */
export function waiverRecordDisplayStatus(
  status: string,
  expiresAt: Date | null,
  now = new Date()
): string {
  if (status === "signed" && expiresAt && expiresAt.getTime() < now.getTime()) {
    return "expired";
  }
  return status;
}

function parseDay(value: string | undefined, label: string): Date | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} is invalid`);
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new Error(`${label} is invalid`);
  }
  return dt;
}

function phoneNeedles(raw: string): string[] {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/[^\d]/g, "");
  return digits && digits !== trimmed ? [trimmed, digits] : [trimmed];
}

/** Shared by the desk list and CSV export so both honor the same filters. */
export async function waiverRecordListWhere(
  actor: WaiversActor,
  opts?: WaiverRecordListQuery
): Promise<Prisma.WaiverRecordWhereInput> {
  const orgId = await assertWaiversStaff(actor);
  if (opts?.status && !RECORD_STATUSES.has(opts.status)) {
    throw new Error("Invalid waiver status");
  }
  if (opts?.channel && !CHANNELS.has(opts.channel)) {
    throw new Error("Invalid waiver channel");
  }
  if (
    opts?.expiringWithinDays != null &&
    (!Number.isFinite(opts.expiringWithinDays) || opts.expiringWithinDays < 1)
  ) {
    throw new Error("Expiring days is invalid");
  }
  const loc = await waiverStampedLocationWhere(actor);
  if (opts?.locationId) {
    await assertLocationInWaiverScope(actor, opts.locationId);
  }
  const q = opts?.q?.trim();
  const email = opts?.email?.trim();
  const phone = opts?.phone?.trim();
  const now = new Date();
  const from = parseDay(opts?.from, "From date");
  const to = parseDay(opts?.to, "To date");
  const expiring =
    opts?.expiringWithinDays != null
      ? Math.min(365, Math.floor(opts.expiringWithinDays))
      : null;
  const statusFilter =
    opts?.status === "expired"
      ? { status: "signed" as const, expiresAt: { lt: now } }
      : opts?.status === "signed"
        ? {
            status: "signed" as const,
            OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
          }
        : opts?.status
          ? { status: opts.status as "pending" | "declined" | "voided" | "revoked" }
          : {};
  const toExclusive = to ? new Date(to.getTime() + 86_400_000) : null;
  const signedRange = {
    ...(from ? { gte: from } : {}),
    ...(toExclusive ? { lt: toExclusive } : {}),
  };
  const phoneOr = phone
    ? phoneNeedles(phone).flatMap((needle) => [
        { guestProfile: { phone: { contains: needle } } },
        { guardian: { phone: { contains: needle } } },
      ])
    : [];
  return {
    orgId,
    ...loc,
    ...(opts?.locationId ? { locationId: opts.locationId } : {}),
    ...(opts?.templateId ? { templateId: opts.templateId } : {}),
    ...(opts?.channel
      ? { channel: opts.channel as "online" | "email_link" | "sms_link" | "qr" | "kiosk" | "onsite" | "import" }
      : {}),
    AND: [
      statusFilter,
      ...(expiring
        ? [
            {
              status: "signed" as const,
              expiresAt: {
                gte: now,
                lte: new Date(now.getTime() + expiring * 86_400_000),
              },
            },
          ]
        : []),
      ...(from || to
        ? [
            {
              OR: [
                { signedAt: signedRange },
                { signedAt: null, createdAt: signedRange },
              ],
            },
          ]
        : []),
      ...(email
        ? [
            {
              OR: [
                { guestProfile: { email: { equals: email, mode: "insensitive" as const } } },
                { guardian: { email: { equals: email, mode: "insensitive" as const } } },
              ],
            },
          ]
        : []),
      ...(phoneOr.length ? [{ OR: phoneOr }] : []),
      ...(q
        ? [
            {
              OR: [
                { publicRef: { contains: q, mode: "insensitive" as const } },
                {
                  guestProfile: {
                    OR: [
                      { firstName: { contains: q, mode: "insensitive" as const } },
                      { lastName: { contains: q, mode: "insensitive" as const } },
                      { email: { contains: q, mode: "insensitive" as const } },
                      ...phoneNeedles(q).map((needle) => ({ phone: { contains: needle } })),
                    ],
                  },
                },
                {
                  guardian: {
                    OR: [
                      { firstName: { contains: q, mode: "insensitive" as const } },
                      { lastName: { contains: q, mode: "insensitive" as const } },
                      { email: { contains: q, mode: "insensitive" as const } },
                      ...phoneNeedles(q).map((needle) => ({ phone: { contains: needle } })),
                    ],
                  },
                },
              ],
            },
          ]
        : []),
    ],
  };
}

export async function listWaiverRecords(
  actor: WaiversActor,
  opts?: WaiverRecordListQuery
): Promise<WaiverRecordListItem[]> {
  const where = await waiverRecordListWhere(actor, opts);
  const now = new Date();
  const rows = await prisma.waiverRecord.findMany({
    where,
    include: {
      guestProfile: { select: { firstName: true, lastName: true, email: true } },
      guardian: { select: { email: true } },
      template: { select: { name: true } },
      templateVersion: { select: { version: true } },
      signers: { select: { isMinor: true, role: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map((row) => ({
    id: row.id,
    publicRef: row.publicRef,
    status: waiverRecordDisplayStatus(row.status, row.expiresAt, now),
    locationId: row.locationId,
    guestProfileId: row.guestProfileId,
    guestName: `${row.guestProfile.firstName} ${row.guestProfile.lastName}`.trim(),
    guestEmail: row.guestProfile.email || row.guardian?.email || null,
    templateId: row.templateId,
    templateName: row.template.name,
    version: row.templateVersion.version,
    locale: row.locale,
    signedAt: row.signedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    channel: row.channel,
    fillMethod: row.fillMethod,
    minorCount: row.signers.filter((s) => s.isMinor || s.role === "minor").length,
    createdAt: row.createdAt.toISOString(),
  }));
}
