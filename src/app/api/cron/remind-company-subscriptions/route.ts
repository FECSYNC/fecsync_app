import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, serverError, authErrorToResponse } from "@/lib/response";
import { assertCronBearer } from "@/lib/cronAuth";
import { runCompanySubscriptionReminders } from "@/lib/companySubscriptionRemind";
import { expireOverdueMembershipInvites } from "@/lib/membershipInvites";
import { runMembershipsDunningTick } from "@/lib/memberships/dunning";
import { remindExpiringWaivers } from "@/lib/waivers/remindExpiring";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Daily — 14/7/3/1 day subscription + ops-grant reminders (never suspends).
 * Also runs membership invite TTL expiry so Vercel Hobby (2 cron jobs) can
 * cover both; dedicated `/api/cron/expire-membership-invites` remains for CLI/GH.
 * Invite expiry is isolated so a remind failure still frees seats.
 * Piggybacks guest memberships dunning + fixed-term expiry (Feature 08 Phase 2)
 * — dedicated `/api/cron/memberships-dunning` remains for CLI/GH (no 3rd Vercel cron).
 * After billing, also reminds guests whose waivers fall inside remindBeforeDays.
 * Dedicated `/api/cron/waivers-remind` remains for CLI/GH. That is not a third Vercel cron.
 */
export async function GET(req: NextRequest) {
  const denied = assertCronBearer(req);
  if (denied) return denied;

  try {
    await connectDB();

    let remind: Awaited<ReturnType<typeof runCompanySubscriptionReminders>> | {
      error: string;
    };
    let invites: Awaited<ReturnType<typeof expireOverdueMembershipInvites>> | {
      error: string;
    };
    let membershipsDunning: Awaited<
      ReturnType<typeof runMembershipsDunningTick>
    > | { error: string };

    try {
      remind = await runCompanySubscriptionReminders();
    } catch (err) {
      console.error("[cron] remind-company-subscriptions remind phase:", err);
      remind = {
        error: err instanceof Error ? err.message : "remind failed",
      };
    }

    try {
      invites = await expireOverdueMembershipInvites();
    } catch (err) {
      console.error("[cron] remind-company-subscriptions invite phase:", err);
      invites = {
        error: err instanceof Error ? err.message : "invite expire failed",
      };
    }

    try {
      membershipsDunning = await runMembershipsDunningTick();
    } catch (err) {
      console.error(
        "[cron] remind-company-subscriptions memberships dunning phase:",
        err
      );
      membershipsDunning = {
        error: err instanceof Error ? err.message : "memberships dunning failed",
      };
    }

    let waiverReminders: Awaited<ReturnType<typeof remindExpiringWaivers>> | { error: string };
    try {
      waiverReminders = await remindExpiringWaivers();
    } catch (err) {
      console.error("[cron] remind-company-subscriptions waiver remind phase:", err);
      waiverReminders = {
        error: err instanceof Error ? err.message : "waiver remind failed",
      };
    }

    const hardFail =
      typeof remind === "object" &&
      remind !== null &&
      "error" in remind &&
      typeof invites === "object" &&
      invites !== null &&
      "error" in invites;
    if (hardFail) {
      return serverError("Failed to remind company subscriptions and expire invites");
    }

    return ok({ summary: { remind, invites, membershipsDunning, waiverReminders } });
  } catch (err) {
    console.error("[cron] remind-company-subscriptions:", err);
    return (
      authErrorToResponse(err) ??
      serverError("Failed to remind company subscriptions")
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
