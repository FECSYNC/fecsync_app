export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Public shop / guest signup is closed. New accounts must use
 * POST /api/auth/register-company (package required).
 * Existing clients may still sign in; admins via yarn create-admin / invites.
 */
import { NextResponse } from "next/server";
import { authRateLimited } from "@/lib/rateLimit";

export const CLIENT_SIGNUP_CLOSED_MESSAGE =
  "Guest shop signup is closed. Register a company workspace and choose a subscription package at /register-company.";

export async function POST(req: Request) {
  const limited = authRateLimited(req, "signup", 8, 60 * 60 * 1000);
  if (limited) return limited;

  return NextResponse.json(
    {
      message: CLIENT_SIGNUP_CLOSED_MESSAGE,
      redirectTo: "/register-company",
    },
    { status: 410 }
  );
}
