export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { verifyAccessToken, verifyRefreshToken } from "@/lib/jwt";
import { recordUserLogout } from "@/lib/audit/sessionAudit";
import { appendClearedAuthCookies } from "@/lib/auth/sessionCookies";

function cookieValue(req: NextRequest, name: string): string | undefined {
  const raw = req.cookies.get(name)?.value;
  return raw || undefined;
}

function resolveLogoutSession(req: NextRequest): {
  userId: string | null;
  orgId: string | null;
} {
  const access = cookieValue(req, "access-token");
  if (access) {
    try {
      const payload = verifyAccessToken(access);
      if (payload.sub) {
        return {
          userId: payload.sub,
          orgId: typeof payload.orgId === "string" ? payload.orgId : null,
        };
      }
    } catch {
      // fall through to refresh
    }
  }
  const refresh = cookieValue(req, "refresh-token");
  if (refresh) {
    try {
      const payload = verifyRefreshToken(refresh);
      if (payload.sub) {
        return { userId: payload.sub, orgId: null };
      }
    } catch {
      // ignore — still clear cookies
    }
  }
  return { userId: null, orgId: null };
}

export async function POST(req: NextRequest) {
  const { userId, orgId } = resolveLogoutSession(req);

  // Clear cookies immediately — never block session end on audit/DB latency.
  const response = new NextResponse(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });

  appendClearedAuthCookies(response, req);

  if (userId) {
    void recordUserLogout({ userId, request: req, orgId }).catch((err) => {
      console.error("[auth/logout] audit failed:", err);
    });
  }

  return response;
}
