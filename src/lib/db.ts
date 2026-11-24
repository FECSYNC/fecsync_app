/**
 * Database bootstrap — Postgres via Prisma (Supabase).
 * Replaces the former Mongoose / MongoDB connection.
 */

import prisma from "@/lib/prisma";
import {
  isTransientDbError,
  isUnreachableDbError,
} from "@/lib/commerceSerialize";

export { isTransientDbError, isUnreachableDbError };

export async function connectDB() {
  // Prisma connects lazily on the first query — no extra ping per request.
  return prisma;
}

async function ensurePrismaReady(): Promise<void> {
  try {
    await prisma.$connect();
  } catch {
    // Surface on the next query attempt.
  }
}

export async function withDbRetry<T>(
  operation: () => Promise<T>,
  retries = 5
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await connectDB();
      return await operation();
    } catch (error) {
      lastError = error;
      // P1001 / "Can't reach database server" is not a brief pool blip — extra
      // 15s connect_timeout attempts make /admin appear to load forever.
      const unreachable = isUnreachableDbError(error);
      const maxAttempts = unreachable ? 2 : retries;
      const canRetry = isTransientDbError(error) && attempt < maxAttempts - 1;
      if (!canRetry) throw error;
      // Never $disconnect the shared singleton — concurrent requests break.
      await ensurePrismaReady();
      // Back off: 400ms, 800ms, 1.6s, 3.2s — gives Supabase pooler time to recover.
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
  }
  throw lastError ?? new Error("Database operation failed");
}

/** @deprecated Use withDbRetry — kept for call-site compatibility during migration. */
export const withMongoRetry = withDbRetry;

export function resetMongoConnection() {
  // No-op: Prisma manages the pool. Kept so legacy imports compile.
}

export default connectDB;
