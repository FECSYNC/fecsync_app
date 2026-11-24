/**
 * Enrich ticket sessions with hold vs paid capacity for staff + public UIs.
 * Temporary holds free seats at expiresAt; paid/confirmed stays taken.
 */
import prisma from "@/lib/prisma";

export type SessionAvailabilityStatus =
  | "open"
  | "limited"
  | "held"
  | "sold_out"
  | "closed";

export type SessionHoldEnrichment = {
  heldQty: number;
  /** Seats taken by paid/confirmed (or other non-hold) consumption. */
  committedQty: number;
  nextReleaseAt: string | null;
  status: SessionAvailabilityStatus;
  statusMessage: string;
  availableForQty: boolean;
};

type SessionLike = {
  id: string;
  capacity: number;
  remaining: number;
  isClosed?: boolean;
};

export async function enrichSessionsWithHoldState<T extends SessionLike>(
  sessions: T[],
  requestedQty: number
): Promise<Array<T & SessionHoldEnrichment>> {
  const qty = Math.max(1, requestedQty);
  if (!sessions.length) return [];

  const ids = sessions.map((s) => s.id);
  const now = new Date();
  const holds = await prisma.bookingHold.findMany({
    where: {
      sessionId: { in: ids },
      expiresAt: { gt: now },
    },
    select: { sessionId: true, qty: true, expiresAt: true },
    orderBy: { expiresAt: "asc" },
  });

  const heldBySession = new Map<string, number>();
  const nextReleaseBySession = new Map<string, Date>();
  for (const h of holds) {
    if (!h.sessionId) continue;
    heldBySession.set(
      h.sessionId,
      (heldBySession.get(h.sessionId) ?? 0) + h.qty
    );
    const prev = nextReleaseBySession.get(h.sessionId);
    if (!prev || h.expiresAt < prev) {
      nextReleaseBySession.set(h.sessionId, h.expiresAt);
    }
  }

  return sessions.map((s) => {
    if (s.isClosed) {
      return {
        ...s,
        heldQty: 0,
        committedQty: Math.max(0, s.capacity - s.remaining),
        nextReleaseAt: null,
        status: "closed" as const,
        statusMessage: "Closed — not bookable",
        availableForQty: false,
      };
    }

    const heldQty = heldBySession.get(s.id) ?? 0;
    const committedQty = Math.max(0, s.capacity - s.remaining - heldQty);
    const nextRelease = nextReleaseBySession.get(s.id) ?? null;
    const availableForQty = s.remaining >= qty;

    let status: SessionAvailabilityStatus;
    let statusMessage: string;

    if (availableForQty) {
      status = s.remaining < s.capacity ? "limited" : "open";
      statusMessage =
        status === "open"
          ? `${s.remaining} of ${s.capacity} seats open`
          : `${s.remaining} of ${s.capacity} seats open`;
      if (heldQty > 0) {
        statusMessage += ` · ${heldQty} held pending payment`;
      }
      if (committedQty > 0) {
        statusMessage += ` · ${committedQty} paid/confirmed`;
      }
    } else if (s.remaining < 1 && heldQty > 0) {
      status = "held";
      statusMessage =
        "Temporarily full — unpaid holds. Seats free when a hold expires if not paid.";
    } else if (s.remaining < qty && s.remaining > 0) {
      status = "limited";
      statusMessage = `Only ${s.remaining} seat${s.remaining === 1 ? "" : "s"} left (need ${qty})`;
    } else {
      status = "sold_out";
      statusMessage =
        committedQty > 0
          ? "Sold out — seats are paid / confirmed"
          : "Sold out";
    }

    return {
      ...s,
      heldQty,
      committedQty,
      nextReleaseAt: nextRelease ? nextRelease.toISOString() : null,
      status,
      statusMessage,
      availableForQty,
    };
  });
}
