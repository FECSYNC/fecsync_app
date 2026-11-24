/**
 * Client-safe suspended-account copy + message matchers (no Prisma).
 */

export const ACCOUNT_SUSPENDED_MESSAGE =
  "Your account has been suspended. Contact the developers or IT team for further help on how to unlock the suspension.";

export const SUSPENDED_DIALOG_MESSAGE = ACCOUNT_SUSPENDED_MESSAGE;

/**
 * Match only ops/user soft-lock copy — not generic Fresh "Organization is suspended"
 * (soft-hold / billing expiry use the waiting room + renew, not the IT dialog).
 */
export function isSuspendedAccessMessage(
  message: string | null | undefined
): boolean {
  const msg = (message || "").trim().toLowerCase();
  if (!msg) return false;
  return (
    msg.includes("account has been suspended") ||
    msg.includes("contact the developers or it team") ||
    (msg.includes("ops hold") && msg.includes("contact"))
  );
}

/** True when org is on a manual ops hold (not billing expiry / Demo end). */
export function isOpsCompanyHold(row: {
  status?: string | null;
  subscriptionStatus?: string | null;
}): boolean {
  return (
    row.status === "suspended" &&
    (row.subscriptionStatus || "").trim().toLowerCase() === "ops_hold"
  );
}

export const ACCOUNT_SUSPENDED_EVENT = "harewa:account-suspended";

/** Emit only for explicit account / ops lock messages (not soft-hold Fresh 403s). */
export function emitAccountSuspendedEvent(message?: string) {
  if (typeof window === "undefined") return;
  const raw = (message || "").trim();
  if (raw && !isSuspendedAccessMessage(raw)) return;
  window.dispatchEvent(
    new CustomEvent(ACCOUNT_SUSPENDED_EVENT, {
      detail: { message: ACCOUNT_SUSPENDED_MESSAGE },
    })
  );
}
