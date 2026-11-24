/**
 * Atomic session capacity consume / release (authoritative for oversell prevention).
 */
import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { TicketingError, SESSION_SOLD_OUT } from "@/lib/ticketing/errors";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Decrement remaining by qty when remaining >= qty.
 * Returns true if a row was updated.
 */
export async function tryConsumeSessionCapacity(
  sessionId: string,
  qty: number,
  db: Db = prisma
): Promise<boolean> {
  if (!Number.isInteger(qty) || qty < 1) {
    throw new Error("qty must be a positive integer");
  }
  const result = await db.$executeRaw`
    UPDATE ticket_sessions
    SET remaining = remaining - ${qty}, "updatedAt" = NOW()
    WHERE id = ${sessionId}
      AND "isClosed" = false
      AND remaining >= ${qty}
  `;
  return result === 1;
}

/**
 * Overbook: allow remaining to go negative. Requires caller permission check.
 */
export async function forceConsumeSessionCapacity(
  sessionId: string,
  qty: number,
  db: Db = prisma
): Promise<void> {
  if (!Number.isInteger(qty) || qty < 1) {
    throw new Error("qty must be a positive integer");
  }
  const result = await db.$executeRaw`
    UPDATE ticket_sessions
    SET remaining = remaining - ${qty}, "updatedAt" = NOW()
    WHERE id = ${sessionId}
      AND "isClosed" = false
  `;
  if (result !== 1) {
    throw new TicketingError(SESSION_SOLD_OUT, 409);
  }
}

export async function releaseSessionCapacity(
  sessionId: string,
  qty: number,
  db: Db = prisma
): Promise<void> {
  if (!Number.isInteger(qty) || qty < 1) return;
  // Never let remaining exceed published capacity (double-release / cancel+refund).
  // Overbooked remaining (negative) still recovers toward capacity.
  await db.$executeRaw`
    UPDATE ticket_sessions
    SET remaining = LEAST(capacity, remaining + ${qty}), "updatedAt" = NOW()
    WHERE id = ${sessionId}
  `;
}

/**
 * Consume with optional overbook. Online guests must pass allowOverbook=false.
 */
export async function consumeCapacity(opts: {
  sessionId: string;
  qty: number;
  allowOverbook?: boolean;
  db?: Db;
}): Promise<{ overbooked: boolean }> {
  const db = opts.db ?? prisma;
  const ok = await tryConsumeSessionCapacity(opts.sessionId, opts.qty, db);
  if (ok) return { overbooked: false };
  if (!opts.allowOverbook) {
    throw new TicketingError(SESSION_SOLD_OUT, 409);
  }
  await forceConsumeSessionCapacity(opts.sessionId, opts.qty, db);
  return { overbooked: true };
}

/** Move capacity between sessions atomically (same qty). */
export async function moveSessionCapacity(opts: {
  fromSessionId: string;
  toSessionId: string;
  qty: number;
  allowOverbook?: boolean;
  db?: Db;
}): Promise<{ overbooked: boolean }> {
  const db = opts.db ?? prisma;
  if (opts.fromSessionId === opts.toSessionId) return { overbooked: false };
  await releaseSessionCapacity(opts.fromSessionId, opts.qty, db);
  try {
    return await consumeCapacity({
      sessionId: opts.toSessionId,
      qty: opts.qty,
      allowOverbook: opts.allowOverbook,
      db,
    });
  } catch (err) {
    // Best-effort restore source if target failed.
    await consumeCapacity({
      sessionId: opts.fromSessionId,
      qty: opts.qty,
      allowOverbook: true,
      db,
    }).catch(() => undefined);
    throw err;
  }
}
