export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";

const OAUTH_STATE_COOKIE = "oauth-state";
/** Company slug when Google sign-in starts from that company's own sign-in page. */
const OAUTH_COMPANY_COOKIE = "oauth-company";
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function GET(req: NextRequest) {
    const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
    const REDIRECT_URI = process.env.GOOGLE_CALLBACK_URL!;
    const state = crypto.randomBytes(24).toString("hex");
    const company = req.nextUrl.searchParams.get("company")?.trim().toLowerCase() ?? "";

    const authURL = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authURL.searchParams.set("client_id", GOOGLE_CLIENT_ID);
    authURL.searchParams.set("redirect_uri", REDIRECT_URI);
    authURL.searchParams.set("response_type", "code");
    authURL.searchParams.set("scope", "openid email profile");
    authURL.searchParams.set("prompt", "select_account");
    authURL.searchParams.set("include_granted_scopes", "true");
    authURL.searchParams.set("state", state);

    const isProd = process.env.NODE_ENV === "production";
    const cookie = (name: string, value: string, maxAge: number) =>
        [
            `${name}=${value}`,
            "HttpOnly",
            "Path=/",
            `Max-Age=${maxAge}`,
            "SameSite=Lax",
            isProd ? "Secure" : "",
        ]
            .filter(Boolean)
            .join("; ");
    const response = NextResponse.redirect(authURL.toString());
    response.headers.append("Set-Cookie", cookie(OAUTH_STATE_COOKIE, state, 600));
    response.headers.append(
        "Set-Cookie",
        SLUG_RE.test(company)
            ? cookie(OAUTH_COMPANY_COOKIE, company, 600)
            : cookie(OAUTH_COMPANY_COOKIE, "", 0)
    );
    return response;
}
