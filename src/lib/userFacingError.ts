/**
 * Turn API / network / DB errors into short plain English for everyone
 * (admins, owners, customers) — never stack traces or HTTP jargon.
 */

function rawMessage(error: unknown): string {
  if (typeof error === "string") return error.trim();
  if (error instanceof Error) return error.message.trim();
  if (error && typeof error === "object" && "message" in error) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === "string") return msg.trim();
  }
  return "";
}

function statusOf(error: unknown): number | null {
  if (error && typeof error === "object" && "status" in error) {
    const status = Number((error as { status?: unknown }).status);
    return Number.isFinite(status) ? status : null;
  }
  return null;
}

export function isExpectedClientError(error: unknown): boolean {
  const status = statusOf(error);
  if (status === 0 || status === 401 || status === 403 || status === 404) {
    return true;
  }
  if (status === 503 || (status != null && status >= 500)) return true;
  const name = error instanceof Error ? error.name : "";
  if (name === "ApiError" || name === "AbortError") return true;
  const msg = rawMessage(error).toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("network") ||
    msg.includes("load failed") ||
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    msg.includes("database temporarily") ||
    msg.includes("aborted") ||
    msg.includes("session expired") ||
    msg.includes("no refresh token")
  );
}

export function toUserFacingMessage(error: unknown): string {
  const status = statusOf(error);
  const msg = rawMessage(error);
  const lower = msg.toLowerCase();

  if (
    status === 0 ||
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("network error") ||
    lower.includes("load failed") ||
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("aborted")
  ) {
    // Usually pool congestion / cold remote DB — not the user's Wi‑Fi.
    return "FECSYNC is taking a moment to respond. Wait a few seconds, then try again.";
  }

  if (
    status === 503 ||
    lower.includes("database temporarily") ||
    lower.includes("can't reach database") ||
    lower.includes("connection pool") ||
    lower.includes("max clients") ||
    lower.includes("emaxconnsession") ||
    lower.includes("too many connections")
  ) {
    return "FECSYNC is taking a moment to connect. Please wait a few seconds and try again.";
  }

  if (
    status === 401 ||
    lower.includes("session expired") ||
    lower.includes("sign in again") ||
    lower.includes("no refresh token") ||
    lower.includes("unauthorized")
  ) {
    return "Your session expired. Please sign in again.";
  }

  if (status === 403 || lower.includes("forbidden") || lower.includes("permission")) {
    // Keep clear product/business denials (billing, Demo lock, storefront, HQ,
    // plan caps). Only collapse opaque auth boilerplate to the generic line.
    const genericForbidden =
      !msg ||
      /^(forbidden|unauthorized|missing required permission|admin access required|cross-tenant access denied)$/i.test(
        msg
      );
    if (!genericForbidden) return msg;
    return "You do not have permission to do that.";
  }

  if (status === 404) {
    return "We could not find that item. It may have been removed.";
  }

  if (status === 429 || lower.includes("too many requests")) {
    return "Too many attempts. Please wait a minute and try again.";
  }

  if (status != null && status >= 500) {
    return "Something went wrong on our side. Please try again in a moment.";
  }

  const looksTechnical =
    !msg ||
    msg.includes("\n") ||
    msg.includes("file://") ||
    msg.includes(" at ") ||
    /prisma|p1001|p2024|econnreset|etimedout|internal server/i.test(msg) ||
    msg.length > 180;

  if (!looksTechnical) return msg;

  return "Something went wrong. Please try again.";
}
