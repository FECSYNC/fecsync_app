/**
 * Ticket credentials (QR / codes) issued on confirm.
 */
import { createHash, randomBytes } from "crypto";
import type { Prisma, TicketCredentialStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";
import {
  TicketingError,
  TICKET_ID_TAKEN,
  REDEEMED_QTY_LOCKED,
} from "@/lib/ticketing/errors";

type Db = Prisma.TransactionClient | typeof prisma;

function generateCode(orgId: string): string {
  const stamp = randomBytes(5).toString("hex").toUpperCase();
  return `T-${orgId.slice(-4).toUpperCase()}-${stamp}`;
}

function qrPayload(opts: {
  orgId: string;
  bookingId: string;
  code: string;
}): string {
  return JSON.stringify({
    t: "venue_ticket",
    orgId: opts.orgId,
    bookingId: opts.bookingId,
    code: opts.code,
  });
}

export async function issueCredentialsForBooking(
  opts: {
    orgId: string;
    locationId: string;
    bookingId: string;
    /** One credential per ticket head (qty sum of non-add_on lines, or all lines). */
    heads: Array<{
      passExpiresAt?: Date | null;
      guestId?: string | null;
    }>;
  },
  db: Db = prisma
) {
  const created = [];
  for (const head of opts.heads) {
    let code = generateCode(opts.orgId);
    // Extremely unlikely collision — retry once.
    for (let i = 0; i < 3; i++) {
      try {
        const row = await db.ticketCredential.create({
          data: {
            orgId: opts.orgId,
            locationId: opts.locationId,
            bookingId: opts.bookingId,
            code,
            qrPayload: qrPayload({
              orgId: opts.orgId,
              bookingId: opts.bookingId,
              code,
            }),
            status: "unused",
            passExpiresAt: head.passExpiresAt ?? null,
          },
        });
        created.push(row);
        break;
      } catch {
        code = generateCode(opts.orgId);
        if (i === 2) throw new Error("Failed to issue ticket credential");
      }
    }
  }
  return created;
}

export async function voidUnusedCredentials(
  bookingId: string,
  db: Db = prisma
): Promise<number> {
  const result = await db.ticketCredential.updateMany({
    where: {
      bookingId: requireId(bookingId, "bookingId"),
      status: "unused",
    },
    data: { status: "void" },
  });
  return result.count;
}

export async function countRedeemedHeads(
  bookingId: string,
  db: Db = prisma
): Promise<number> {
  return db.ticketCredential.count({
    where: {
      bookingId: requireId(bookingId, "bookingId"),
      status: "redeemed",
    },
  });
}

export async function countRestorableHeads(
  bookingId: string,
  db: Db = prisma
): Promise<number> {
  return db.ticketCredential.count({
    where: {
      bookingId: requireId(bookingId, "bookingId"),
      status: { in: ["unused", "void", "expired"] },
    },
  });
}

/**
 * Capacity to restore on cancel/refund = unused (+ voided unused path) heads
 * that were sold. Redeemed never restore.
 * Before credentials exist (hold/pending), use booking line qty.
 */
export async function restorableCapacityQty(
  bookingId: string,
  heldQty: number,
  db: Db = prisma
): Promise<number> {
  const redeemed = await countRedeemedHeads(bookingId, db);
  const issued = await db.ticketCredential.count({
    where: { bookingId },
  });
  if (issued === 0) return Math.max(0, heldQty);
  return Math.max(0, heldQty - redeemed);
}

/**
 * Keep unused+redeemed credentials equal to ticket heads after confirm / line replace.
 * Redeemed tickets are never voided or deleted.
 */
export async function syncLiveCredentialsToHeads(
  opts: {
    orgId: string;
    locationId: string;
    bookingId: string;
    heads: Array<{ passExpiresAt?: Date | null }>;
  },
  db: Db = prisma
): Promise<void> {
  const bookingId = requireId(opts.bookingId, "bookingId");
  const redeemed = await db.ticketCredential.count({
    where: { bookingId, status: "redeemed" },
  });
  if (redeemed > opts.heads.length) {
    throw new TicketingError(REDEEMED_QTY_LOCKED, 400);
  }

  const unused = await db.ticketCredential.findMany({
    where: { bookingId, status: "unused" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const neededUnused = opts.heads.length - redeemed;
  if (unused.length > neededUnused) {
    const extra = unused.slice(neededUnused).map((r) => r.id);
    await db.ticketCredential.updateMany({
      where: { id: { in: extra } },
      data: { status: "void" },
    });
  } else if (unused.length < neededUnused) {
    const extraHeads = opts.heads.slice(redeemed + unused.length);
    await issueCredentialsForBooking(
      {
        orgId: opts.orgId,
        locationId: opts.locationId,
        bookingId,
        heads: extraHeads,
      },
      db
    );
  }
}

export async function assignCustomTicketIds(
  orgId: string,
  assignments: Array<{ credentialId: string; customTicketId: string }>,
  opts?: { bookingId?: string },
  db: Db = prisma
) {
  for (const a of assignments) {
    const customTicketId = a.customTicketId.trim();
    if (!customTicketId) throw new Error("customTicketId is required");
    const existing = await db.ticketCredential.findFirst({
      where: {
        orgId,
        customTicketId,
        id: { not: requireId(a.credentialId, "credentialId") },
      },
      select: { id: true },
    });
    if (existing) throw new TicketingError(TICKET_ID_TAKEN, 409);
  }

  const updated = [];
  for (const a of assignments) {
    const row = await db.ticketCredential.updateMany({
      where: {
        id: requireId(a.credentialId, "credentialId"),
        orgId,
        ...(opts?.bookingId ? { bookingId: opts.bookingId } : {}),
      },
      data: { customTicketId: a.customTicketId.trim() },
    });
    if (row.count !== 1) throw new Error("Credential not found");
    const cred = await db.ticketCredential.findFirst({
      where: { id: a.credentialId, orgId },
    });
    if (cred) updated.push(cred);
  }
  return updated;
}

export async function updatePassExpiry(
  orgId: string,
  credentialId: string,
  passExpiresAt: Date | null,
  db: Db = prisma
) {
  const row = await db.ticketCredential.findFirst({
    where: { id: requireId(credentialId, "credentialId"), orgId },
  });
  if (!row) throw new Error("Credential not found");
  return db.ticketCredential.update({
    where: { id: row.id },
    data: { passExpiresAt },
  });
}

export function listTicketsDto(
  credentials: Array<{
    id: string;
    code: string;
    qrPayload: string;
    status: TicketCredentialStatus;
    customTicketId: string | null;
    passExpiresAt: Date | null;
    redeemedAt: Date | null;
  }>
) {
  return credentials.map((c) => ({
    id: c.id,
    code: c.code,
    qrPayload: c.qrPayload,
    status: c.status,
    customTicketId: c.customTicketId,
    passExpiresAt: c.passExpiresAt?.toISOString() ?? null,
    redeemedAt: c.redeemedAt?.toISOString() ?? null,
  }));
}

/** Opaque ticket view token = publicId.hash — indexed via booking publicId (no cross-tenant scan). */
export function ticketViewTokenHash(code: string, viewToken: string): string {
  return createHash("sha256")
    .update(`${code}:${viewToken}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Mark one unused credential redeemed. A second call returns null so the caller can 400.
 * Paid and date rules stay in the POS check-in service.
 */
export async function redeemTicketCredential(opts: {
  orgId: string;
  credentialId: string;
}): Promise<{ id: string; status: string; redeemedAt: Date | null } | null> {
  const result = await prisma.$executeRaw`
    UPDATE ticket_credentials
    SET status = 'redeemed', "redeemedAt" = NOW(), "updatedAt" = NOW()
    WHERE id = ${opts.credentialId}
      AND "orgId" = ${opts.orgId}
      AND status = 'unused'
  `;
  if (result !== 1) return null;
  const row = await prisma.ticketCredential.findFirst({
    where: { id: opts.credentialId, orgId: opts.orgId },
    select: { id: true, status: true, redeemedAt: true },
  });
  return row;
}

/** Public ticket URL token. Prefer this over bare hashes. */
export function ticketViewToken(
  code: string,
  viewToken: string,
  bookingPublicId: string
): string {
  return `${bookingPublicId}.${ticketViewTokenHash(code, viewToken)}`;
}
