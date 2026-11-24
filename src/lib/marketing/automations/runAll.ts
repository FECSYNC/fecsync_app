import prisma from "@/lib/prisma";
import { planAllowsModule } from "@/lib/subscriptionPlans";
import { runWelcomeAutomation } from "@/lib/marketing/automations/welcome";
import { runBirthdayAutomation } from "@/lib/marketing/automations/birthday";
import { runReengagementAutomation } from "@/lib/marketing/automations/reengagement";
import { runPostVisitSurveyAutomation } from "@/lib/marketing/automations/postVisitSurvey";
import type { AutomationRunResult } from "@/lib/marketing/types";

export type RunAllMarketingResult = {
  orgsProcessed: number;
  welcome: AutomationRunResult;
  birthday: AutomationRunResult;
  reengagement: AutomationRunResult;
  postVisitSurvey: AutomationRunResult;
};

function mergeResults(
  a: AutomationRunResult,
  b: AutomationRunResult
): AutomationRunResult {
  return {
    sent: a.sent + b.sent,
    skipped: a.skipped + b.skipped,
    failed: a.failed + b.failed,
  };
}

const empty: AutomationRunResult = { sent: 0, skipped: 0, failed: 0 };

export async function runAllMarketingAutomations(opts?: {
  orgId?: string;
  limit?: number;
}): Promise<RunAllMarketingResult> {
  const orgs = await prisma.organization.findMany({
    where: {
      status: "active",
      ...(opts?.orgId ? { id: opts.orgId } : {}),
    },
    select: { id: true, subscriptionPlan: true },
  });

  let welcome = { ...empty };
  let birthday = { ...empty };
  let reengagement = { ...empty };
  let postVisitSurvey = { ...empty };
  let orgsProcessed = 0;

  for (const org of orgs) {
    if (!planAllowsModule(org.subscriptionPlan, "marketing")) continue;
    const runOpts = { limit: opts?.limit };
    try {
      // assertMarketingEnabled inside each runner may fail closed for unpaid /
      // Demo / storefront — never abort the whole cron for one org.
      welcome = mergeResults(welcome, await runWelcomeAutomation(org.id, runOpts));
      birthday = mergeResults(
        birthday,
        await runBirthdayAutomation(org.id, runOpts)
      );
      reengagement = mergeResults(
        reengagement,
        await runReengagementAutomation(org.id, runOpts)
      );
      postVisitSurvey = mergeResults(
        postVisitSurvey,
        await runPostVisitSurveyAutomation(org.id, runOpts)
      );
      orgsProcessed += 1;
    } catch (err) {
      console.error(
        `[marketing] automations skipped for org ${org.id}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return {
    orgsProcessed,
    welcome,
    birthday,
    reengagement,
    postVisitSurvey,
  };
}
