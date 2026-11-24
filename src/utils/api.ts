// src/utils/api.ts

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "";
/** Client abort ceiling — not infinite (that hangs the UI forever on dead connections). */
const DEFAULT_TIMEOUT = 90_000;
/**
 * Token refresh can be slow on cold Mongo / Turbopack first compile in dev
 * (we've seen 20s+ successes). Keep below DEFAULT_TIMEOUT but well above 10s.
 */
const REFRESH_TIMEOUT =
  process.env.NODE_ENV === "development" ? 90_000 : 45_000;

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[];

export type MaybeWrapped<T> = { success?: boolean; data?: T } | T;

export class ApiError extends Error {
  status: number;
  payload?: unknown;
  constructor(message: string, status: number, payload?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

/** Retry-worthy API failures (cold DB, brief Supabase blips). */
export function isTransientApiError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 0) return true;
  if (error.status === 503) return true;
  if (error.status >= 500) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("database temporarily unavailable") ||
      msg.includes("failed to authorize")
    );
  }
  return false;
}

// In-flight GET request deduplication to avoid duplicate network calls
const pendingGetRequests = new Map<string, Promise<any>>();

// ===== helpers =====

// Join API_BASE + path safely
function buildUrl(path: string) {
  if (path.startsWith("http")) return path;
  if (!API_BASE) return path; // same-origin
  try {
    return new URL(
      path.replace(/^\//, ""),
      API_BASE.endsWith("/") ? API_BASE : API_BASE + "/"
    ).toString();
  } catch {
    return `${API_BASE}${path}`;
  }
}

// Decide headers only when needed (don't set for FormData)
// Normalizes Headers instances and plain objects to a plain object before merging.
function withJson(init: RequestInit): RequestInit {
  // normalize incoming headers to a plain object
  let incomingHeaders: Record<string, any> = {};
  if (init.headers instanceof Headers) {
    init.headers.forEach((v, k) => {
      incomingHeaders[k] = v;
    });
  } else if (init.headers && typeof init.headers === "object") {
    // covers Record<string,string> and plain objects
    incomingHeaders = { ...(init.headers as Record<string, any>) };
  }

  const isFormData =
    typeof window !== "undefined" && init.body instanceof FormData;

  return {
    ...init,
    headers: {
      ...incomingHeaders,
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
    },
  };
}

// Parse response body (json or text → best-effort json)
async function parseBody(res: Response): Promise<any> {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return await res.json().catch(() => null);
  }
  const text = await res.text();
  if (text && (text.startsWith("{") || text.startsWith("["))) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

// Normalize auth error text from API bodies ({ error: "..." } or { message: "..." }).
function authResponseMessage(body: unknown): string {
  if (typeof body === "string") return body;
  if (!body || typeof body !== "object") return "";
  const record = body as { error?: unknown; message?: unknown; code?: unknown };
  const errorField = record.error;
  if (typeof errorField === "string") return errorField;
  if (errorField && typeof errorField === "object") {
    const nested = errorField as { message?: unknown; code?: unknown };
    if (typeof nested.message === "string") return nested.message;
    if (typeof nested.code === "string") return nested.code;
  }
  if (typeof record.message === "string") return record.message;
  if (typeof record.code === "string") return record.code;
  return "";
}

/** Guest / cleared / post-migration stale cookies — not a real app failure. */
export function isExpectedStaleSession401(status: number, message: unknown): boolean {
  if (status !== 401) return false;
  const msg = String(message ?? "").toLowerCase();
  return (
    msg.includes("no refresh token") ||
    msg.includes("no access token") ||
    msg.includes("invalid or expired refresh token") ||
    msg.includes("invalid or expired") ||
    msg.includes("session expired") ||
    msg.includes("invalid user") ||
    msg.includes("invalid token")
  );
}

// Detect "access token expired" shapes from backend
function isAccessExpired(status: number, body: unknown) {
  if (status !== 401) return false;
  const msg = authResponseMessage(body).toLowerCase();
  return (
    msg.includes("token expired") ||
    msg.includes("jwt expired") ||
    msg.includes("access token expired") ||
    msg.includes("session expired") ||
    msg.includes("session outdated")
  );
}

// Detect "invalid token" that should trigger refresh (malformed/corrupted tokens)
function isInvalidToken(status: number, body: unknown) {
  if (status !== 403) return false;
  const msg = authResponseMessage(body).toLowerCase();
  return msg.includes("invalid token");
}

// ===== refresh single-flight =====
// Survive Turbopack Fast Refresh remounts — module locals reset mid-flight and
// a second POST with the old refresh JTI trips reuse detection → false logout.
type RefreshFlightGlobal = typeof globalThis & {
  __fecsyncRefreshPromise?: Promise<void> | null;
};

function refreshFlightSlot(): RefreshFlightGlobal {
  return globalThis as RefreshFlightGlobal;
}

async function doRefreshOnce(): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, REFRESH_TIMEOUT);

  try {
    const res = await fetch(buildUrl("/api/auth/refresh"), {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      const body = await parseBody(res);
      const msg =
        (body && (body.error?.message || body.error || body.message)) ||
        res.statusText ||
        "Refresh failed";
      // Guest / cleared / stale Mongo-era cookies after DB migration.
      if (isExpectedStaleSession401(res.status, msg)) {
        console.warn("[API] Session refresh skipped:", msg);
      } else {
        console.warn("[API] Refresh failed:", res.status, body);
      }
      throw new ApiError(String(msg), res.status, body);
    }

    //console.log('[API] Token refresh successful');
  } catch (err: unknown) {
    clearTimeout(timer);
    const name =
      err && typeof err === "object" && "name" in err
        ? String((err as { name?: unknown }).name)
        : "";
    if (name === "AbortError") {
      // Recoverable — silentRefresh falls back to /me; avoid alarming console.error.
      console.warn(
        `[API] Refresh request timed out after ${REFRESH_TIMEOUT}ms (will retry / fall back to session)`
      );
      throw new ApiError("Token refresh timed out", 0, { reason: "timeout" });
    }
    throw err;
  }
}

async function ensureRefresh(): Promise<void> {
  const slot = refreshFlightSlot();
  if (!slot.__fecsyncRefreshPromise) {
    slot.__fecsyncRefreshPromise = doRefreshOnce().finally(() => {
      slot.__fecsyncRefreshPromise = null;
    });
  }
  return slot.__fecsyncRefreshPromise;
}

/**
 * Single-flight access/refresh cookie rotation.
 * All callers (silentRefresh, 401 retry, admin boot) MUST use this so two
 * parallel POSTs cannot trip refresh-token reuse detection and log the user out.
 */
export async function refreshAccessToken(): Promise<void> {
  return ensureRefresh();
}

/** Tiny fetch wrapper with timeout + cookie auth + auto refresh/retry + better errors */
export async function api<T = any>(
  path: string,
  init: RequestInit = {},
  opts: { timeout?: number } = {}
): Promise<T> {
  const url = buildUrl(path);
  const timeoutMs = opts.timeout ?? DEFAULT_TIMEOUT;

  //console.log(`[API] ${init.method || 'GET'} ${url} (timeout: ${timeoutMs}ms)`);

  // Clone the body if it exists so we can retry with the same data
  let bodyForRetry: any = null;
  if (init.body) {
    if (typeof init.body === 'string') {
      bodyForRetry = init.body;
    } else if (init.body instanceof FormData) {
      // FormData can't be cloned easily, so we'll just use the original
      bodyForRetry = init.body;
    } else {
      // For other types, try to stringify
      try {
        bodyForRetry = JSON.stringify(init.body);
      } catch {
        bodyForRetry = init.body;
      }
    }
  }

  async function runOnce(isRetry = false): Promise<{ res: Response; body: any }> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      // warn — Next.js overlays every console.error; timeouts are transient under load
      console.warn(`[API] Request timeout after ${timeoutMs}ms: ${url}`);
      controller.abort();
    }, timeoutMs);

    try {
      const startTime = Date.now();

      // On retry, reconstruct the request with the saved body
      const fetchInit: RequestInit = {
        credentials: "include",
        signal: controller.signal,
        ...init,
      };

      // If this is a retry and we have a body, use the cloned version
      if (isRetry && bodyForRetry !== null) {
        fetchInit.body = bodyForRetry;
      }

      const res = await fetch(url, fetchInit);
      const elapsed = Date.now() - startTime;
      //console.log(`[API] Response received in ${elapsed}ms: ${res.status} ${url}`);

      // 204/205: no content to parse
      if (res.status === 204 || res.status === 205) {
        if (!res.ok)
          throw new ApiError(res.statusText || `HTTP ${res.status}`, res.status);
        return { res, body: undefined };
      }

      const body = await parseBody(res);
      return { res, body };
    } catch (err: any) {
      // Convert AbortError into a typed ApiError for consistent handling
      if (err && err.name === "AbortError") {
        console.warn(`[API] Request aborted (timeout or cancel): ${url}`);
        throw new ApiError("Request timed out", 0, { reason: "timeout", url });
      }
      const msg = String(err?.message || "");
      // Fetch abort / offline blips — same overlay problem as timeouts
      if (
        msg.includes("Failed to fetch") ||
        msg.includes("NetworkError") ||
        msg.includes("Load failed") ||
        msg.includes("aborted")
      ) {
        console.warn(`[API] Network blip for ${url}:`, msg);
        throw new ApiError(err?.message || "Network error", 0, err);
      }
      // Network error or other fetch error
      console.warn(`[API] Network error for ${url}:`, err.message);
      throw new ApiError(err?.message || "Network error", 0, err);
    } finally {
      clearTimeout(timer);
    }
  }

  // Core executor that performs the request with refresh handling
  const execute = async (): Promise<T> => {
    const maxTransientRetries = 2;

    for (let attempt = 0; attempt <= maxTransientRetries; attempt++) {
      let { res, body } = await runOnce(attempt > 0);

      // If access expired or invalid token → single-flight refresh → replay once
      if (isAccessExpired(res.status, body) || isInvalidToken(res.status, body)) {
        try {
          await ensureRefresh();
        } catch (err: any) {
          const message = err?.message || "Session expired";
          if (isExpectedStaleSession401(401, message)) {
            console.warn("[API] Refresh skipped after session clear:", message);
          } else {
            console.warn("[API] Refresh failed:", message);
          }
          throw new ApiError(message, 401, err?.payload ?? body);
        }
        ({ res, body } = await runOnce(true));
      }

      if (res.ok) {
        return body as T;
      }

      const errorBody =
        body && typeof body === "object"
          ? (body as { error?: unknown; message?: unknown })
          : null;
      const msg =
        (typeof errorBody?.error === "string" && errorBody.error) ||
        (typeof errorBody?.message === "string" && errorBody.message) ||
        res.statusText ||
        `HTTP ${res.status}`;

      const msgLower = String(msg).toLowerCase();
      const expectedAuthMiss =
        res.status === 401 &&
        (msgLower.includes("no refresh token") ||
          msgLower.includes("no access token") ||
          msgLower.includes("unauthorized") ||
          msgLower.includes("token expired") ||
          msgLower.includes("session expired") ||
          msgLower.includes("jwt expired") ||
          msgLower.includes("invalid token") ||
          msgLower.includes("not authenticated"));
      const transientServer =
        res.status === 503 ||
        (res.status >= 500 &&
          (msgLower.includes("database temporarily unavailable") ||
            msgLower.includes("failed to authorize")));

      const isFileUpload =
        url.includes("/api/upload") ||
        url.includes("/api/tailor/portfolio") ||
        url.includes("/api/tailor/campaigns/media") ||
        url.includes("reference-images") ||
        url.includes("/api/auth/profile/picture");
      if (transientServer && attempt < maxTransientRetries && !isFileUpload) {
        console.warn(
          `[API] Transient ${res.status} — retry ${attempt + 1}/${maxTransientRetries}: ${url}`
        );
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }

      if (
        res.status === 403 ||
        expectedAuthMiss ||
        transientServer ||
        (res.status >= 400 && res.status < 500)
      ) {
        console.warn(`[API] ${res.status}: ${msg}`);
      } else {
        console.warn(`[API] Error response: ${res.status} ${msg}`);
      }
      if (res.status === 403 && typeof window !== "undefined") {
        try {
          const {
            isSuspendedAccessMessage,
            emitAccountSuspendedEvent,
          } = await import("@/lib/accountSuspendMessages");
          if (isSuspendedAccessMessage(String(msg))) {
            emitAccountSuspendedEvent(String(msg));
          }
        } catch {
          /* ignore dialog emit failures */
        }
      }
      throw new ApiError(String(msg), res.status, body);
    }

    throw new ApiError("Database temporarily unavailable. Please try again.", 503);
  };

  // Deduplicate GET requests to the same URL while in-flight
  const method = (init.method || 'GET').toUpperCase();
  const isGet = method === 'GET';
  const dedupeKey = `${method}:${url}`;

  if (isGet) {
    const existing = pendingGetRequests.get(dedupeKey);
    if (existing) {
      //console.log(`[API] Deduplicating GET request: ${url}`);
      return existing as Promise<T>;
    }
    const p = execute().finally(() => {
      pendingGetRequests.delete(dedupeKey);
    });
    pendingGetRequests.set(dedupeKey, p);
    return p as Promise<T>;
  }

  return execute();
}

/** SWR/React Query compatible fetcher */
export const fetcher = <T = any>(url: string) => api<T>(url);

/** Helper to normalize {success,data} or bare data */
export function unwrap<T>(payload: MaybeWrapped<T>): T {
  if (payload && typeof payload === "object" && "data" in (payload as any)) {
    const firstLevel = (payload as any).data;
    // Handle double-nested structure: response.data.data
    if (firstLevel && typeof firstLevel === "object" && "data" in firstLevel) {
      return (firstLevel.data ?? null) as T;
    }
    // Handle single-nested structure: response.data
    return (firstLevel ?? null) as T;
  }
  return payload as T;
}

/** Convenience for JSON POST-style requests */
export const json = (body: unknown): RequestInit =>
  withJson({ method: "POST", body: JSON.stringify(body) });