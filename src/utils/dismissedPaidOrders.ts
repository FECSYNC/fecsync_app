/**
 * Persist which recent paid/shipping orders an admin has dismissed from the
 * notification bell (click / mark all read). Cleared when they leave that queue
 * (e.g. courier progress → shipped).
 */

const STORAGE_PREFIX = 'harewa:dismissed-paid-orders:';

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

export function loadDismissedPaidOrderIds(userId: string | null | undefined): Set<string> {
  if (!userId || typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0));
  } catch {
    return new Set();
  }
}

export function saveDismissedPaidOrderIds(
  userId: string | null | undefined,
  ids: Set<string>
): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify([...ids]));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Keep only dismissals for orders that are still in the paid/shipping queue. */
export function pruneDismissedPaidOrderIds(
  dismissed: Set<string>,
  stillPaidIds: Set<string>
): Set<string> {
  const next = new Set<string>();
  for (const id of dismissed) {
    if (stillPaidIds.has(id)) next.add(id);
  }
  return next;
}

/** Paid orders updated/created within this window appear in the bell queue. */
export const RECENT_PAID_NOTIFICATION_MS = 7 * 24 * 60 * 60 * 1000;

export function isRecentPaidOrder(
  order: { updatedAt?: string; createdAt?: string },
  now = Date.now(),
  windowMs = RECENT_PAID_NOTIFICATION_MS
): boolean {
  const ts = new Date(order.updatedAt || order.createdAt || '').getTime();
  if (!Number.isFinite(ts)) return false;
  return now - ts <= windowMs;
}
