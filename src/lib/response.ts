import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  AUTH_FORBIDDEN_MESSAGES,
  AUTH_UNAUTHENTICATED_MESSAGES,
  isAuthHttpError,
} from "@/lib/auth/http-error";
import {
  logPermissionDenial,
  type DenialAuditContext,
} from "@/lib/audit/activityLog";
import { isTransientDbError } from "@/lib/commerceSerialize";
import { ORG_SUSPENDED_MESSAGE, ORG_PENDING_APPROVAL_MESSAGE } from "@/lib/org";

type ResponseData = Record<string, unknown> | unknown | unknown[] | null;

export type AuthAuditOptions = DenialAuditContext & { request: NextRequest };

interface SuccessBody {
    success: true;
    message: string;
    data?: ResponseData;
}

interface ErrorBody {
    success: false;
    error: string;
}

export function jsonResponse(
    data: ResponseData,
    status: number = 200,
    message: string = "Success"
): NextResponse {
    const body: SuccessBody = {
        success: true,
        message,
    };

    if (data !== null && typeof data !== "undefined") {
        body.data = data;
    }

    return new NextResponse(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

export function errorResponse(
    message: string,
    status: number = 400
): NextResponse {
    const body: ErrorBody = {
        success: false,
        error: message,
    };

    return new NextResponse(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

// ✅ Semantic helpers
export function ok(data: ResponseData, message = "Success") {
    return jsonResponse(data, 200, message);
}

export function created(data: ResponseData, message = "Created") {
    return jsonResponse(data, 201, message);
}
export function uploaded(data: ResponseData, message = "Uploaded") {
    return jsonResponse(data, 200, message);
}

export function badRequest(message = "Bad Request") {
    return errorResponse(message, 400);
}

export function unauthorized(message = "Unauthorized") {
    return errorResponse(message, 401);
}

export function forbidden(message = "Forbidden") {
    return errorResponse(message, 403);
}

/**
 * Map thrown auth guards to NextResponse. Returns null if `error` is not an
 * auth failure so the route can fall through to serverError/badRequest.
 *
 * Pass `audit` on sensitive admin routes to record permission denials (Step 7.3).
 */
function shouldAuditAuthDenial(error: unknown): boolean {
    // Org-status denials are stamped once inside requireAuthFresh / PermissionFresh.
    // Approve sync fail-closed is a billing outcome, not a permission miss
    // (keep literals in sync with ORG_APPROVE_*_MESSAGE in companyApproval.ts).
    const message = error instanceof Error ? error.message : String(error);
    return (
        message !== ORG_SUSPENDED_MESSAGE &&
        message !== ORG_PENDING_APPROVAL_MESSAGE &&
        !message.includes(
          "Contact the developers or IT team for further help"
        ) &&
        message !==
            "Could not sync retained Stripe subscription; company left suspended. Retry approve when Stripe is reachable." &&
        message !==
            "Stripe subscription is bound but plan could not be applied; company left suspended. Check Price→plan mapping and retry approve."
    );
}

export function authErrorToResponse(
    error: unknown,
    audit?: AuthAuditOptions
): NextResponse | null {
    if (isAuthHttpError(error)) {
        const res =
            error.status === 401
                ? unauthorized(error.message)
                : forbidden(error.message);
        if (audit && shouldAuditAuthDenial(error)) {
            logPermissionDenial(audit.request, error, audit);
        }
        return res;
    }

    const message = error instanceof Error ? error.message : "";
    if (AUTH_UNAUTHENTICATED_MESSAGES.has(message)) {
        const res = unauthorized(message);
        if (audit && shouldAuditAuthDenial(error)) {
            logPermissionDenial(audit.request, error, audit);
        }
        return res;
    }
    if (AUTH_FORBIDDEN_MESSAGES.has(message)) {
        const res = forbidden(message);
        if (audit && shouldAuditAuthDenial(error)) {
            logPermissionDenial(audit.request, error, audit);
        }
        return res;
    }
    if (isTransientDbError(error)) {
        console.warn("Database unavailable during authorization guard");
        return errorResponse(
            "Database temporarily unavailable. Please try again.",
            503
        );
    }
    return null;
}

/**
 * Map auth guard failures. Distinguishes real auth errors from transient DB
 * outages that were previously misreported as "Failed to authorize" (500).
 */
export function authorizeGuardResponse(
    error: unknown,
    audit?: AuthAuditOptions
): NextResponse {
    const authRes = authErrorToResponse(error, audit);
    if (authRes) return authRes;
    if (isTransientDbError(error)) {
        console.warn("Database unavailable during authorization guard");
        return errorResponse(
            "Database temporarily unavailable. Please try again.",
            503
        );
    }
    console.error("Authorization guard error:", error);
    return serverError("Failed to authorize");
}

/** Build audit context for authErrorToResponse. */
export function authAudit(
    request: NextRequest,
    route: string,
    partial?: Omit<DenialAuditContext, "route">
): AuthAuditOptions {
    return { request, route, ...partial };
}

export function notFound(message = "Not Found") {
    return errorResponse(message, 404);
}

export function gone(message = "Gone") {
    return errorResponse(message, 410);
}

export function serverError(message = "Something went wrong") {
    return errorResponse(message, 500);
}

/** Route catch blocks: auth failures, transient DB (503), else 500. */
export function routeErrorResponse(
    error: unknown,
    fallbackMessage = "Something went wrong",
    audit?: AuthAuditOptions
): NextResponse {
    const authRes = authErrorToResponse(error, audit);
    if (authRes) return authRes;
    if (isTransientDbError(error)) {
        console.warn(`Database unavailable: ${fallbackMessage}`);
        return errorResponse(
            "Database temporarily unavailable. Please try again.",
            503
        );
    }
    console.error(fallbackMessage, error);
    return serverError(fallbackMessage);
}
export function conflict(message = "Conflict") {
    return errorResponse(message, 409);
}

export function tooManyRequests(
    message = "Too many requests. Please try again shortly.",
    retryAfterSec = 60
) {
    const res = errorResponse(message, 429);
    res.headers.set("Retry-After", String(Math.max(1, retryAfterSec)));
    return res;
}