/**
 * Typed auth failures for API guards.
 *
 * Routes that `catch` and inspect `.message` keep working: messages match
 * the previous plain `Error` strings. New routes should use
 * `authErrorToResponse` from `@/lib/response` so 401 vs 403 is consistent.
 *
 * Do not use `instanceof` across Next.js bundles — check `name` + `status`.
 */

export const AUTH_HTTP_ERROR = "AuthHttpError";

export class AuthHttpError extends Error {
  readonly status: 401 | 403;
  /** Tenant context when known (e.g. suspended Organization). */
  readonly orgId: string | null;

  constructor(message: string, status: 401 | 403, orgId?: string | null) {
    super(message);
    this.name = AUTH_HTTP_ERROR;
    this.status = status;
    this.orgId = orgId ?? null;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UnauthorizedError extends AuthHttpError {
  constructor(message = "Unauthorized", orgId?: string | null) {
    super(message, 401, orgId);
  }
}

export class ForbiddenError extends AuthHttpError {
  constructor(message = "Forbidden", orgId?: string | null) {
    super(message, 403, orgId);
  }
}

export function isAuthHttpError(error: unknown): error is AuthHttpError {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { name?: unknown; status?: unknown; message?: unknown };
  return (
    candidate.name === AUTH_HTTP_ERROR &&
    (candidate.status === 401 || candidate.status === 403) &&
    typeof candidate.message === "string"
  );
}

/** Messages thrown by requireAuth before typed errors existed. */
export const AUTH_UNAUTHENTICATED_MESSAGES = new Set([
  "No access token provided",
  "Token expired",
  "Invalid token",
  "Invalid access token",
  "Unauthorized",
  "Session outdated; sign in again",
]);

export const AUTH_FORBIDDEN_MESSAGES = new Set([
  "Admin access required",
  "Client access required",
  "Forbidden",
  "Missing required permission",
  "Checkout method is not enabled",
  "Cross-tenant access denied",
  "Organization membership required",
  "Organization is suspended",
  "Your account has been suspended. Contact the developers or IT team for further help on how to unlock the suspension.",
  "Cannot remove or demote the last platform_admin in this organization",
  "Cannot grant permissions beyond your own",
  "Not an active tailor provider",
  "Tailor profile not found",
  "Your tailor profile is suspended",
  "Your tailor profile must be approved before publishing campaigns",
]);
