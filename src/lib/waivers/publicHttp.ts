import { NextRequest } from "next/server";
import { errorResponse, serverError } from "@/lib/response";
import { isAuthHttpError } from "@/lib/auth/http-error";
import { apiRateLimited } from "@/lib/rateLimit";
import { WaiverLinkError } from "@/lib/waivers/signToken";

const UNAVAILABLE = "This waiver link is not available.";

export function publicWaiverRateLimit(request: NextRequest) {
  return apiRateLimited(request, "waiver-public", 40, 10 * 60 * 1000);
}

export function publicWaiverExtractRateLimit(request: NextRequest) {
  return apiRateLimited(request, "waiver-extract", 8, 10 * 60 * 1000);
}

export function assertPublicJson(request: NextRequest) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return errorResponse("JSON body required", 415);
  }
  const origin = request.headers.get("origin");
  if (!origin) return null;
  const host =
    request.headers.get("x-forwarded-host") || request.headers.get("host");
  try {
    if (host && new URL(origin).host !== host) {
      return errorResponse(UNAVAILABLE, 403);
    }
  } catch {
    return errorResponse(UNAVAILABLE, 403);
  }
  return null;
}

export function publicWaiverError(err: unknown) {
  if (
    err instanceof Error &&
    err.name === "WaiverLinkError" &&
    "status" in err &&
    typeof (err as WaiverLinkError).status === "number"
  ) {
    return errorResponse(err.message, (err as WaiverLinkError).status);
  }
  if (isAuthHttpError(err)) return errorResponse(UNAVAILABLE, 403);
  if (err instanceof Error && err.name === "Error") {
    return errorResponse(err.message, 400);
  }
  console.error("Public waiver failed:", err instanceof Error ? err.message : "error");
  return serverError("Could not complete this waiver");
}

export function clientIp(request: NextRequest): string | undefined {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || undefined;
  return request.headers.get("x-real-ip")?.trim() || undefined;
}
