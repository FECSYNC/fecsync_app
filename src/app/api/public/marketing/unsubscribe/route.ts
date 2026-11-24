export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { apiRateLimited } from "@/lib/rateLimit";
import {
  applyUnsubscribe,
  parseMarketingUnsubscribeToken,
} from "@/lib/marketing/unsubscribe";

async function tokenFromRequest(request: NextRequest, body?: { token?: string }) {
  const q = request.nextUrl.searchParams.get("token");
  if (q?.trim()) return q.trim();
  return body?.token?.trim() ?? "";
}

function wantsHtml(request: NextRequest): boolean {
  return (request.headers.get("accept") ?? "").includes("text/html");
}

type PageState = "confirm" | "done" | "invalid";

function unsubscribePage(state: PageState, token = ""): NextResponse {
  const title =
    state === "done"
      ? "You’re unsubscribed"
      : state === "confirm"
        ? "Unsubscribe from promotional emails?"
        : "Link not recognised";
  const body =
    state === "done"
      ? "You won’t receive promotional emails from this company any more. Booking confirmations and other service emails are not affected."
      : state === "confirm"
        ? "You’ll stop receiving newsletters and offers from this company. Booking confirmations and other service emails are not affected."
        : "This unsubscribe link is invalid or has expired. Reply to any newsletter and ask to be removed.";
  // Confirmation step: link scanners prefetch GET links and must never unsubscribe a guest.
  const action =
    state === "confirm"
      ? `<form method="post" action="?token=${encodeURIComponent(token)}" style="margin:24px 0 0;">
<button type="submit" style="background:#D4AF37;color:#1c1917;border:0;border-radius:10px;padding:12px 28px;font-size:15px;font-weight:600;cursor:pointer;">Unsubscribe</button>
</form>`
      : "";
  const icon = state === "done" ? "&#10003;" : state === "confirm" ? "&#9993;" : "!";
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head>
<body style="margin:0;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<main style="max-width:480px;margin:64px auto;background:#fff;border-radius:16px;padding:32px;border:1px solid #e7e5e4;text-align:center;">
<div style="width:48px;height:48px;margin:0 auto 16px;border-radius:12px;background:rgba(212,175,55,0.15);color:#8a7020;font-size:24px;line-height:48px;">${icon}</div>
<h1 style="margin:0 0 8px;font-size:22px;color:#1c1917;">${title}</h1>
<p style="margin:0;color:#57534e;line-height:1.6;">${body}</p>
${action}
</main></body></html>`;
  return new NextResponse(html, {
    status: state === "invalid" ? 400 : 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function GET(request: NextRequest) {
  const limited = apiRateLimited(request, "public-marketing-unsubscribe", 20, 60_000);
  if (limited) return limited;

  const token = await tokenFromRequest(request);
  if (wantsHtml(request)) {
    let valid = false;
    try {
      valid = Boolean(token && parseMarketingUnsubscribeToken(token));
    } catch {
      valid = false;
    }
    return unsubscribePage(valid ? "confirm" : "invalid", token);
  }
  if (!token) return badRequest("token is required");

  try {
    await connectDB();
    const okUnsub = await applyUnsubscribe(token);
    return ok({ unsubscribed: okUnsub });
  } catch {
    return ok({ unsubscribed: false });
  }
}

export async function POST(request: NextRequest) {
  const limited = apiRateLimited(request, "public-marketing-unsubscribe", 20, 60_000);
  if (limited) return limited;

  let body: { token?: string };
  try {
    body = (await request.json()) as { token?: string };
  } catch {
    // RFC 8058 one-click and the confirm form post form-encoded bodies; token is in the query.
    body = {};
  }

  const token = await tokenFromRequest(request, body);
  const html = wantsHtml(request);
  if (!token) return html ? unsubscribePage("invalid") : badRequest("token is required");

  let okUnsub = false;
  try {
    await connectDB();
    okUnsub = await applyUnsubscribe(token);
  } catch {
    okUnsub = false;
  }
  if (html) return unsubscribePage(okUnsub ? "done" : "invalid");
  return ok({ unsubscribed: okUnsub });
}
