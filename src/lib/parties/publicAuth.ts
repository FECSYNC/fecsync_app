import type { NextRequest } from "next/server";
import { requireAuthFresh } from "@/lib/middleware/requireAuth";

/** Signed-in guest id for public checkout (guests without a session are fine). */
export async function optionalAuthUserId(request: NextRequest): Promise<string | null> {
  try {
    const payload = await requireAuthFresh(request);
    return payload?.sub ? String(payload.sub) : null;
  } catch {
    return null;
  }
}
