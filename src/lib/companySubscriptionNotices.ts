/**
 * Step 3 — company SaaS lifecycle notices (email + in-app) SSOT.
 * Never called from /signup. Best-effort: never fail parent register/approve/expire.
 */

import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";
import { getStorefrontOrgId } from "@/lib/org";
import { isSoftBillingHoldRow } from "@/lib/billingSoftHold";
import { createNotification } from "@/services/notificationService";
import type { Prisma } from "@prisma/client";

export type CompanyBillingNoticeEvent =
  | "registered"
  | "ops_pending"
  | "approved"
  | "ops_provisioned"
  | "self_serve_activated"
  | "suspended"
  | "past_due"
  | "expiring_soon"
  | "expired"
  | "ops_grant_expiring_soon"
  | "offboard_requested";

export type CompanyBillingRecipient = {
  userId: string;
  email: string;
  name: string | null;
};

export function companyBillingNoticesEnabled(): boolean {
  const raw = process.env.COMPANY_BILLING_NOTICE_ENABLED?.trim().toLowerCase();
  if (!raw) return true; // default on; set "0"/"false" to disable in tests/local
  return raw === "1" || raw === "true" || raw === "yes";
}

function siteBase(): string {
  return (process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000").replace(
    /\/$/,
    ""
  );
}

/** In-app notification hrefs must be router paths (`/admin/...`), not absolute URLs. */
function appPathFromHref(hrefOrPath: string): string {
  const raw = hrefOrPath.trim();
  if (!raw) return "/admin/billing";
  if (raw.startsWith("/")) return raw.split("?")[0] || raw;
  try {
    const u = new URL(raw);
    return u.pathname || "/admin/billing";
  } catch {
    return raw.startsWith("/") ? raw : `/${raw.replace(/^\/+/, "")}`;
  }
}

function noticeMetadata(
  event: CompanyBillingNoticeEvent,
  orgId: string,
  href: string
): Record<string, unknown> {
  return {
    kind: "company_billing",
    event,
    orgId,
    href: appPathFromHref(href),
  };
}

async function safeNotify(
  label: string,
  fn: () => Promise<void>
): Promise<void> {
  try {
    if (!companyBillingNoticesEnabled()) return;
    await fn();
  } catch (err) {
    console.warn(`[company-notices] ${label} failed (best-effort):`, err);
  }
}

/** Active platform_admin seats + optional Company Profile billing email (as notify target when matches a member). */
export async function resolveCompanyBillingRecipients(
  orgId: string
): Promise<CompanyBillingRecipient[]> {
  const id = requireId(orgId, "orgId");
  const rows = await prisma.membership.findMany({
    where: {
      orgId: id,
      status: "active",
      rolePreset: "platform_admin",
      user: { accountDeleted: false },
    },
    select: {
      userId: true,
      user: { select: { email: true, firstName: true, lastName: true } },
    },
  });
  const byUser = new Map<string, CompanyBillingRecipient>();
  const emailsSeen = new Set<string>();
  for (const row of rows) {
    const email = row.user.email?.trim();
    if (!email) continue;
    const emailKey = email.toLowerCase();
    if (emailsSeen.has(emailKey)) continue;
    emailsSeen.add(emailKey);
    const display =
      [row.user.firstName, row.user.lastName].filter(Boolean).join(" ").trim() ||
      null;
    byUser.set(row.userId, {
      userId: row.userId,
      email,
      name: display,
    });
  }

  // Prefer profile billingEmail when it matches a platform_admin (already in map).
  // If it matches another active member, include them once.
  try {
    const profile = await prisma.companyProfile.findUnique({
      where: { orgId: id },
      select: { billingEmail: true },
    });
    const billing = profile?.billingEmail?.trim().toLowerCase();
    if (billing && !emailsSeen.has(billing)) {
      const extra = await prisma.membership.findFirst({
        where: {
          orgId: id,
          status: "active",
          user: {
            accountDeleted: false,
            email: { equals: billing, mode: "insensitive" },
          },
        },
        select: {
          userId: true,
          user: { select: { email: true, firstName: true, lastName: true } },
        },
      });
      if (extra?.user.email) {
        const display =
          [extra.user.firstName, extra.user.lastName]
            .filter(Boolean)
            .join(" ")
            .trim() || null;
        emailsSeen.add(extra.user.email.trim().toLowerCase());
        byUser.set(extra.userId, {
          userId: extra.userId,
          email: extra.user.email,
          name: display,
        });
      }
    }
  } catch {
    /* profile optional */
  }

  return [...byUser.values()];
}

export async function clearCompanySubscriptionNoticeWatermarks(
  orgId: string,
  tx?: Prisma.TransactionClient
): Promise<void> {
  const id = requireId(orgId, "orgId");
  const db = tx ?? prisma;
  await db.organization.updateMany({
    where: { id, isDefault: false },
    data: {
      subscriptionNoticePastDueAt: null,
      subscriptionNoticeExpiredAt: null,
      subscriptionNoticeRemind14dAt: null,
      subscriptionNoticeRemind7dAt: null,
      subscriptionNoticeRemind3dAt: null,
      subscriptionNoticeRemind1dAt: null,
      opsGrantNoticeRemind14dAt: null,
      opsGrantNoticeRemind7dAt: null,
      opsGrantNoticeRemind3dAt: null,
      opsGrantNoticeRemind1dAt: null,
    },
  });
}

/** Clear only remind watermarks when subscriptionEndsAt advances (new period). */
export async function clearCompanySubscriptionRemindWatermarks(
  orgId: string,
  tx?: Prisma.TransactionClient
): Promise<void> {
  const id = requireId(orgId, "orgId");
  const db = tx ?? prisma;
  await db.organization.updateMany({
    where: { id, isDefault: false },
    data: {
      subscriptionNoticeRemind14dAt: null,
      subscriptionNoticeRemind7dAt: null,
      subscriptionNoticeRemind3dAt: null,
      subscriptionNoticeRemind1dAt: null,
      opsGrantNoticeRemind14dAt: null,
      opsGrantNoticeRemind7dAt: null,
      opsGrantNoticeRemind3dAt: null,
      opsGrantNoticeRemind1dAt: null,
    },
  });
}

export type CompanyExpiringSoonDays = 14 | 7 | 3 | 1;

async function notifyAdminsInApp(
  recipients: CompanyBillingRecipient[],
  title: string,
  message: string,
  event: CompanyBillingNoticeEvent,
  orgId: string,
  href: string
): Promise<void> {
  await Promise.all(
    recipients.map((r) =>
      createNotification(
        r.userId,
        title,
        message,
        "alert",
        noticeMetadata(event, orgId, href)
      ).catch((err) => {
        console.warn("[company-notices] in-app notify failed:", r.userId, err);
      })
    )
  );
}

async function loadOrgName(orgId: string): Promise<string> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true, isDefault: true },
  });
  if (!org || org.isDefault) return "Company workspace";
  return org.name;
}

/** After durable register-company success. */
export async function notifyCompanyRegistered(orgId: string): Promise<void> {
  await safeNotify("registered", async () => {
    const id = requireId(orgId, "orgId");
    const name = await loadOrgName(id);
    const recipients = await resolveCompanyBillingRecipients(id);
    const href = `${siteBase()}/company-pending`;
    const { sendCompanyRegisteredPendingEmail } = await import("@/lib/mailer");
    await Promise.all(
      recipients.map((r) =>
        sendCompanyRegisteredPendingEmail({
          to: r.email,
          orgName: name,
          orgId: id,
          pendingUrl: href,
        }).catch((err) =>
          console.warn("[company-notices] registered email:", err)
        )
      )
    );
    await notifyAdminsInApp(
      recipients,
      "Company workspace registered",
      `"${name}" is pending FECSYNC approval. You will unlock admin after approval.`,
      "registered",
      id,
      href
    );
  });
}

/** Alert FECSYNC ops (env COMPANY_OPS_ALERT_EMAIL + storefront platform_admins). */
export async function notifyHarewaOpsNewCompanyPending(
  orgId: string
): Promise<void> {
  await safeNotify("ops_pending", async () => {
    const id = requireId(orgId, "orgId");
    const name = await loadOrgName(id);
    const href = `${siteBase()}/admin/registered-companies`;
    const { sendCompanyOpsPendingAlertEmail } = await import("@/lib/mailer");

    const opsEmail = process.env.COMPANY_OPS_ALERT_EMAIL?.trim();
    if (opsEmail) {
      await sendCompanyOpsPendingAlertEmail({
        to: opsEmail,
        orgName: name,
        orgId: id,
        reviewUrl: href,
      }).catch((err) =>
        console.warn("[company-notices] ops alert email:", err)
      );
    }

    try {
      const storefrontId = await getStorefrontOrgId();
      const opsRecipients = await resolveCompanyBillingRecipients(storefrontId);
      await Promise.all(
        opsRecipients.map((r) =>
          sendCompanyOpsPendingAlertEmail({
            to: r.email,
            orgName: name,
            orgId: id,
            reviewUrl: href,
          }).catch((err) =>
            console.warn("[company-notices] ops admin email:", err)
          )
        )
      );
      await notifyAdminsInApp(
        opsRecipients,
        "New company registered",
        `"${name}" registered. Self-serve Checkout activates admin automatically after payment; Approve remains for unpaid / Enterprise cases.`,
        "ops_pending",
        id,
        href
      );
    } catch (err) {
      console.warn("[company-notices] ops pending storefront lookup:", err);
    }
  });
}

export async function notifyCompanyApproved(orgId: string): Promise<void> {
  await safeNotify("approved", async () => {
    const id = requireId(orgId, "orgId");

    // Idempotent: ops create → Set plan, or Approve then Set plan, must not
    // spam the same mailbox with duplicate "approved" mail.
    const recentApproved = await prisma.notification.findFirst({
      where: {
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        OR: [
          {
            AND: [
              { metadata: { path: ["event"], equals: "approved" } },
              { metadata: { path: ["orgId"], equals: id } },
            ],
          },
          {
            AND: [
              { metadata: { path: ["event"], equals: "ops_provisioned" } },
              { metadata: { path: ["orgId"], equals: id } },
            ],
          },
        ],
      },
      select: { id: true },
    });
    if (recentApproved) return;

    const name = await loadOrgName(id);
    const recipients = await resolveCompanyBillingRecipients(id);
    if (recipients.length === 0) return;

    const adminUrl = `${siteBase()}/admin`;
    const billingUrl = `${siteBase()}/admin/billing`;
    const profileUrl = `${siteBase()}/admin/company-profile`;

    const orgBilling = await prisma.organization.findUnique({
      where: { id },
      select: {
        subscriptionPlan: true,
        subscriptionInterval: true,
        requestedDurationMonths: true,
      },
    });
    const {
      getSubscriptionPlan,
      computePlanTermTotalMajor,
      formatSubscriptionTermLabel,
      resolveBillingDurationMonthsInterest,
      billingDurationLabel,
    } = await import("@/lib/subscriptionPlans");
    const planId = orgBilling?.subscriptionPlan?.trim().toLowerCase() || null;
    const plan = planId ? getSubscriptionPlan(planId) : null;
    const months = resolveBillingDurationMonthsInterest({
      requestedDurationMonths: orgBilling?.requestedDurationMonths,
      subscriptionInterval: orgBilling?.subscriptionInterval,
    });
    const termLabel =
      formatSubscriptionTermLabel(orgBilling?.subscriptionInterval) ||
      billingDurationLabel(months);
    const termTotalMajor =
      planId && planId !== "demo"
        ? computePlanTermTotalMajor(planId, months)
        : planId === "demo"
          ? 0
          : null;
    const planAlreadyActive = Boolean(planId);

    const packageBit =
      plan?.name || planId
        ? ` (${[plan?.name || planId, termLabel].filter(Boolean).join(" · ")})`
        : "";

    // Claim in-app first so a parallel Set plan / create+stamp cannot send
    // a second email before this run finishes SMTP.
    await notifyAdminsInApp(
      recipients,
      planAlreadyActive
        ? "Company workspace ready"
        : "Company workspace approved",
      planAlreadyActive
        ? `"${name}" is active${packageBit}. Open your dashboard to continue — Billing is only needed if you change packages later.`
        : `"${name}" is active. Open Billing to choose a package, then complete company profile for invoices.`,
      "approved",
      id,
      planAlreadyActive ? adminUrl : billingUrl
    );

    const { sendCompanyApprovedEmail } = await import("@/lib/mailer");
    await Promise.all(
      recipients.map((r) =>
        sendCompanyApprovedEmail({
          to: r.email,
          orgName: name,
          orgId: id,
          billingUrl,
          profileUrl,
          adminUrl,
          planName: plan?.name || planId,
          termLabel,
          termTotalMajor,
          currency: plan?.currency || "USD",
          planAlreadyActive,
        }).catch((err) =>
          console.warn("[company-notices] approved email:", err)
        )
      )
    );
  });
}

/**
 * Super-admin ops create (Activate + plan stamp): one welcome email with
 * congratulations, assigned package, and login details. Never asks them to
 * open Billing to subscribe again.
 */
export async function notifyCompanyOpsProvisioned(input: {
  orgId: string;
  adminEmail: string;
  adminUserId: string;
  adminFullName?: string | null;
  /** Plain password only when a new user was just created — never logged. */
  temporaryPassword?: string | null;
  createdAdminUser: boolean;
  planId: string;
  durationMonths?: number | null;
}): Promise<void> {
  await safeNotify("ops_provisioned", async () => {
    const id = requireId(input.orgId, "orgId");
    const to = String(input.adminEmail || "")
      .trim()
      .toLowerCase();
    if (!to || !to.includes("@")) return;

    const recent = await prisma.notification.findFirst({
      where: {
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        OR: [
          {
            AND: [
              { metadata: { path: ["event"], equals: "ops_provisioned" } },
              { metadata: { path: ["orgId"], equals: id } },
            ],
          },
          {
            AND: [
              { metadata: { path: ["event"], equals: "approved" } },
              { metadata: { path: ["orgId"], equals: id } },
            ],
          },
        ],
      },
      select: { id: true },
    });
    if (recent) return;

    const name = await loadOrgName(id);
    const {
      getSubscriptionPlan,
      billingDurationLabel,
      isBillingDurationMonths,
      normalizeBillingDurationMonths,
      formatSubscriptionTermLabel,
    } = await import("@/lib/subscriptionPlans");

    const orgBilling = await prisma.organization.findUnique({
      where: { id },
      select: {
        subscriptionPlan: true,
        subscriptionInterval: true,
        requestedDurationMonths: true,
      },
    });
    const planId =
      (orgBilling?.subscriptionPlan || input.planId || "")
        .trim()
        .toLowerCase() || null;
    const plan = planId ? getSubscriptionPlan(planId) : null;
    const months = isBillingDurationMonths(
      input.durationMonths ?? orgBilling?.requestedDurationMonths
    )
      ? normalizeBillingDurationMonths(
          input.durationMonths ?? orgBilling?.requestedDurationMonths
        )
      : null;
    const termLabel =
      (months != null ? billingDurationLabel(months) : null) ||
      formatSubscriptionTermLabel(orgBilling?.subscriptionInterval) ||
      null;

    const signInUrl = `${siteBase()}/signin?returnTo=${encodeURIComponent("/admin")}`;
    const adminUrl = `${siteBase()}/admin`;

    // Claim before SMTP so a second create/stamp cannot duplicate.
    await createNotification(
      input.adminUserId,
      "Company workspace ready",
      `"${name}" is approved and active${
        plan?.name || planId
          ? ` (${[plan?.name || planId, termLabel].filter(Boolean).join(" · ")})`
          : ""
      }. Sign in to open your dashboard.`,
      "alert",
      noticeMetadata("ops_provisioned", id, adminUrl)
    ).catch((err) =>
      console.warn("[company-notices] ops_provisioned in-app failed:", err)
    );

    const { sendCompanyOpsProvisionedEmail } = await import("@/lib/mailer");
    await sendCompanyOpsProvisionedEmail({
      to,
      orgName: name,
      orgId: id,
      adminFullName: input.adminFullName ?? null,
      loginEmail: to,
      temporaryPassword: input.createdAdminUser
        ? input.temporaryPassword ?? null
        : null,
      createdAdminUser: input.createdAdminUser,
      planName: plan?.name || planId,
      termLabel,
      signInUrl,
      adminUrl,
    });
  });
}

/**
 * Self-serve: Stripe payment activated a pending org (no FECSYNC Approve click).
 * Notifies the company admins and FECSYNC ops (informational — not an Approve email).
 */
export async function notifyCompanySelfServeActivated(
  orgId: string
): Promise<void> {
  await safeNotify("self_serve_activated", async () => {
    const id = requireId(orgId, "orgId");
    const name = await loadOrgName(id);
    const billingUrl = `${siteBase()}/admin/billing`;
    const profileUrl = `${siteBase()}/admin/company-profile`;
    const adminUrl = `${siteBase()}/admin`;
    const reviewUrl = `${siteBase()}/admin/registered-companies?status=active`;

    const orgBilling = await prisma.organization.findUnique({
      where: { id },
      select: {
        subscriptionPlan: true,
        subscriptionInterval: true,
        requestedDurationMonths: true,
      },
    });
    const {
      getSubscriptionPlan,
      computePlanTermTotalMajor,
      formatSubscriptionTermLabel,
      resolveBillingDurationMonthsInterest,
      billingDurationLabel,
    } = await import("@/lib/subscriptionPlans");
    const planId = orgBilling?.subscriptionPlan?.trim().toLowerCase() || null;
    const plan = planId ? getSubscriptionPlan(planId) : null;
    const months = resolveBillingDurationMonthsInterest({
      requestedDurationMonths: orgBilling?.requestedDurationMonths,
      subscriptionInterval: orgBilling?.subscriptionInterval,
    });
    const termLabel =
      formatSubscriptionTermLabel(orgBilling?.subscriptionInterval) ||
      billingDurationLabel(months);
    const termTotalMajor =
      planId && planId !== "demo"
        ? computePlanTermTotalMajor(planId, months)
        : planId === "demo"
          ? 0
          : null;
    const packageSummary = [
      plan?.name || planId,
      termLabel,
      termTotalMajor != null
        ? `$${termTotalMajor} ${(plan?.currency || "USD").toUpperCase()} per term`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");

    // Company side (same email path as Approve — copy differs for payment).
    const recipients = await resolveCompanyBillingRecipients(id);
    const { sendCompanyApprovedEmail } = await import("@/lib/mailer");
    await Promise.all(
      recipients.map((r) =>
        sendCompanyApprovedEmail({
          to: r.email,
          orgName: name,
          orgId: id,
          billingUrl,
          profileUrl,
          selfServePayment: true,
          planName: plan?.name || planId,
          termLabel,
          termTotalMajor,
          currency: plan?.currency || "USD",
        }).catch((err) =>
          console.warn("[company-notices] self-serve activate email:", err)
        )
      )
    );
    await notifyAdminsInApp(
      recipients,
      "Payment received — workspace active",
      packageSummary
        ? `"${name}" is active after Checkout (${packageSummary}). Sign in to open your company dashboard.`
        : `"${name}" is active after successful Checkout. Sign in to open your company dashboard.`,
      "approved",
      id,
      adminUrl
    );

    // FECSYNC ops — informational, not a manual Approve task.
    try {
      const { sendCompanyOpsPendingAlertEmail } = await import("@/lib/mailer");
      const opsEmail = process.env.COMPANY_OPS_ALERT_EMAIL?.trim();
      const href = reviewUrl;
      if (opsEmail) {
        await sendCompanyOpsPendingAlertEmail({
          to: opsEmail,
          orgName: name,
          orgId: id,
          reviewUrl: href,
        }).catch((err) =>
          console.warn("[company-notices] ops paid-activate email:", err)
        );
      }
      const storefrontId = await getStorefrontOrgId();
      const opsRecipients = await resolveCompanyBillingRecipients(storefrontId);
      await notifyAdminsInApp(
        opsRecipients,
        "Company paid — auto-activated",
        packageSummary
          ? `"${name}" completed Checkout (${packageSummary}) and was activated automatically (no Approve click needed).`
          : `"${name}" completed Checkout and was activated automatically (no Approve click needed).`,
        "ops_pending",
        id,
        href
      );
    } catch (err) {
      console.warn("[company-notices] ops self-serve activate:", err);
    }
  });
}

export async function notifyCompanySuspended(
  orgId: string,
  reason?: string
): Promise<void> {
  await safeNotify("suspended", async () => {
    const id = requireId(orgId, "orgId");
    const name = await loadOrgName(id);
    const recipients = await resolveCompanyBillingRecipients(id);
    const href = `${siteBase()}/company-pending`;
    const { sendCompanySuspendedEmail } = await import("@/lib/mailer");
    await Promise.all(
      recipients.map((r) =>
        sendCompanySuspendedEmail({
          to: r.email,
          orgName: name,
          orgId: id,
          reason: reason ?? null,
          pendingUrl: href,
        }).catch((err) =>
          console.warn("[company-notices] suspended email:", err)
        )
      )
    );
    await notifyAdminsInApp(
      recipients,
      "Company workspace suspended",
      `"${name}" is on an ops hold. Contact the developers or IT team for further help on how to unlock the suspension. Records were kept.`,
      "suspended",
      id,
      href
    );
  });
}

/** Watermarked — only once per past_due / soft-hold episode until clear on renew. */
export async function notifyCompanyPastDue(orgId: string): Promise<boolean> {
  let sent = false;
  await safeNotify("past_due", async () => {
    const id = requireId(orgId, "orgId");
    const claimed = await prisma.organization.updateMany({
      where: {
        id,
        isDefault: false,
        status: "active",
        subscriptionStatus: "past_due",
        subscriptionNoticePastDueAt: null,
      },
      data: { subscriptionNoticePastDueAt: new Date() },
    });
    if (claimed.count === 0) return;

    const name = await loadOrgName(id);
    const recipients = await resolveCompanyBillingRecipients(id);
    const org = await prisma.organization.findUnique({
      where: { id },
      select: {
        status: true,
        subscriptionStatus: true,
        subscriptionEndsAt: true,
      },
    });
    const softHold = org
      ? isSoftBillingHoldRow({
          status: org.status,
          subscriptionStatus: org.subscriptionStatus,
          subscriptionEndsAt: org.subscriptionEndsAt,
        })
      : true;
    // Soft-hold: Fresh denies Checkout/portal — point at waiting room, not Billing.
    const path = softHold ? "/company-pending" : "/admin/billing";
    const href = `${siteBase()}${path}`;
    const { sendCompanyPastDueEmail } = await import("@/lib/mailer");
    await Promise.all(
      recipients.map((r) =>
        sendCompanyPastDueEmail({
          to: r.email,
          orgName: name,
          orgId: id,
          billingUrl: href,
          softHold,
        }).catch((err) =>
          console.warn("[company-notices] past_due email:", err)
        )
      )
    );
    await notifyAdminsInApp(
      recipients,
      softHold ? "Billing hold — renew from waiting room" : "Payment past due",
      softHold
        ? `"${name}" billing is on soft-hold (past-due / overdue period). Open the waiting room to renew payment — self-serve renew stays available. Ops Approve is not required for soft-hold.`
        : `"${name}" billing is past due. Update payment in Billing to keep venues and team tools entitled.`,
      "past_due",
      id,
      href
    );
    sent = true;
  });
  return sent;
}

export async function notifyCompanyExpired(orgId: string): Promise<boolean> {
  let sent = false;
  await safeNotify("expired", async () => {
    const id = requireId(orgId, "orgId");
    // Paid demotion → active+demo. Demo trial end → suspended+expired+demo.
    const claimed = await prisma.organization.updateMany({
      where: {
        id,
        isDefault: false,
        subscriptionNoticeExpiredAt: null,
        OR: [
          {
            status: "suspended",
            subscriptionStatus: "expired",
            subscriptionPlan: "demo",
          },
          { status: "suspended", subscriptionStatus: "expired" },
          { status: "active", subscriptionPlan: "demo" },
        ],
      },
      data: { subscriptionNoticeExpiredAt: new Date() },
    });
    if (claimed.count === 0) return;

    const row = await prisma.organization.findUnique({
      where: { id },
      select: {
        status: true,
        subscriptionPlan: true,
        subscriptionStatus: true,
      },
    });
    const demoTrialEnded =
      row?.status === "suspended" &&
      row.subscriptionStatus === "expired" &&
      row.subscriptionPlan?.trim().toLowerCase() === "demo";

    const name = await loadOrgName(id);
    const recipients = await resolveCompanyBillingRecipients(id);
    const href = demoTrialEnded
      ? `${siteBase()}/company-pending`
      : `${siteBase()}/admin/billing`;
    const { sendCompanyExpiredEmail } = await import("@/lib/mailer");
    await Promise.all(
      recipients.map((r) =>
        sendCompanyExpiredEmail({
          to: r.email,
          orgName: name,
          orgId: id,
          pendingUrl: href,
        }).catch((err) =>
          console.warn("[company-notices] expired email:", err)
        )
      )
    );
    await notifyAdminsInApp(
      recipients,
      demoTrialEnded ? "Demo trial ended" : "Moved to Demo plan",
      demoTrialEnded
        ? `"${name}" Demo trial ended — workspace is suspended. Contact FECSYNC to reactivate Demo, then upgrade from Billing. Records were kept.`
        : `"${name}" paid period ended — workspace is on Demo. Your records were kept. Renew in Billing to restore full access.`,
      "expired",
      id,
      href
    );
    sent = true;
  });
  return sent;
}

export async function notifyCompanyExpiringSoon(
  orgId: string,
  daysLeft: CompanyExpiringSoonDays,
  endsAt: Date
): Promise<boolean> {
  let sent = false;
  await safeNotify(`expiring_${daysLeft}d`, async () => {
    const id = requireId(orgId, "orgId");
    const field =
      daysLeft === 14
        ? "subscriptionNoticeRemind14dAt"
        : daysLeft === 7
          ? "subscriptionNoticeRemind7dAt"
          : daysLeft === 3
            ? "subscriptionNoticeRemind3dAt"
            : "subscriptionNoticeRemind1dAt";
    const claimed = await prisma.organization.updateMany({
      where: {
        id,
        isDefault: false,
        status: "active",
        subscriptionStatus: { in: ["active", "trialing", "past_due"] },
        subscriptionEndsAt: { not: null },
        [field]: null,
      },
      data: { [field]: new Date() },
    });
    if (claimed.count === 0) return;

    const name = await loadOrgName(id);
    const recipients = await resolveCompanyBillingRecipients(id);
    const href = `${siteBase()}/admin/billing`;
    const { sendCompanyExpiringSoonEmail } = await import("@/lib/mailer");
    await Promise.all(
      recipients.map((r) =>
        sendCompanyExpiringSoonEmail({
          to: r.email,
          orgName: name,
          orgId: id,
          daysLeft,
          endsAt,
          billingUrl: href,
          opsGrant: false,
        }).catch((err) =>
          console.warn("[company-notices] expiring email:", err)
        )
      )
    );
    await notifyAdminsInApp(
      recipients,
      daysLeft === 1
        ? "Subscription ends tomorrow — renew now"
        : daysLeft === 14
          ? "Subscription renews in 2 weeks"
          : `Subscription ends in ${daysLeft} days — renew soon`,
      `"${name}" renews or ends on ${endsAt.toLocaleDateString()}. Open Billing to renew so your workspace is not suspended automatically.`,
      "expiring_soon",
      id,
      href
    );
    sent = true;
  });
  return sent;
}

export async function notifyOpsGrantExpiringSoon(
  orgId: string,
  daysLeft: CompanyExpiringSoonDays,
  endsAt: Date
): Promise<boolean> {
  let sent = false;
  await safeNotify(`ops_grant_${daysLeft}d`, async () => {
    const id = requireId(orgId, "orgId");
    const field =
      daysLeft === 14
        ? "opsGrantNoticeRemind14dAt"
        : daysLeft === 7
          ? "opsGrantNoticeRemind7dAt"
          : daysLeft === 3
            ? "opsGrantNoticeRemind3dAt"
            : "opsGrantNoticeRemind1dAt";
    const claimed = await prisma.organization.updateMany({
      where: {
        id,
        isDefault: false,
        status: "active",
        subscriptionStatus: "active",
        subscriptionPlan: { not: null },
        // Align with remind detector: blank binding is not a live Stripe sub.
        OR: [{ stripeSubscriptionId: null }, { stripeSubscriptionId: "" }],
        subscriptionEndsAt: { not: null },
        [field]: null,
      },
      data: { [field]: new Date() },
    });
    if (claimed.count === 0) return;

    const name = await loadOrgName(id);
    const recipients = await resolveCompanyBillingRecipients(id);
    const href = `${siteBase()}/admin/billing`;
    const { sendCompanyExpiringSoonEmail } = await import("@/lib/mailer");
    await Promise.all(
      recipients.map((r) =>
        sendCompanyExpiringSoonEmail({
          to: r.email,
          orgName: name,
          orgId: id,
          daysLeft,
          endsAt,
          billingUrl: href,
          opsGrant: true,
        }).catch((err) =>
          console.warn("[company-notices] ops grant expiring email:", err)
        )
      )
    );
    await notifyAdminsInApp(
      recipients,
      daysLeft === 1
        ? "Ops grant ends tomorrow"
        : daysLeft === 14
          ? "Ops grant ends in 2 weeks"
          : `Ops grant ends in ${daysLeft} days`,
      `"${name}" temporary plan access ends on ${endsAt.toLocaleDateString()}. Complete Checkout in Billing to stay entitled — access suspends automatically when the grant ends.`,
      "ops_grant_expiring_soon",
      id,
      href
    );
    sent = true;
  });
  return sent;
}

/**
 * Step 4 — soft offboard request. Company admins + FECSYNC ops (no hard-delete).
 */
export async function notifyCompanyOffboardRequested(
  orgId: string,
  reason?: string | null
): Promise<void> {
  await safeNotify("offboard_requested", async () => {
    const id = requireId(orgId, "orgId");

    // Idempotent delivery — stamp may succeed while notice fails; client retry
    // with created:false must still deliver once. Skip if already notified.
    const recent = await prisma.notification.findFirst({
      where: {
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        AND: [
          { metadata: { path: ["event"], equals: "offboard_requested" } },
          { metadata: { path: ["orgId"], equals: id } },
        ],
      },
      select: { id: true },
    });
    if (recent) return;

    const name = await loadOrgName(id);
    const orgRow = await prisma.organization.findUnique({
      where: { id },
      select: {
        status: true,
        subscriptionStatus: true,
        subscriptionEndsAt: true,
        offboardRequestedAt: true,
      },
    });
    // No open stamp — nothing to notify (e.g. ops cleared before retry).
    if (!orgRow?.offboardRequestedAt) return;

    const softHold = isSoftBillingHoldRow({
      status: orgRow.status,
      subscriptionStatus: orgRow.subscriptionStatus,
      subscriptionEndsAt: orgRow.subscriptionEndsAt,
    });
    // Soft-hold admins are redirected away from /admin — deep-link waiting room.
    const companyHref = softHold
      ? `${siteBase()}/company-pending`
      : `${siteBase()}/admin/company-profile`;
    const opsHref = `${siteBase()}/admin/registered-companies?status=offboard`;
    const reasonNote = reason?.trim()
      ? ` Reason: ${reason.trim().slice(0, 200)}`
      : "";

    const companyRecipients = await resolveCompanyBillingRecipients(id);
    await notifyAdminsInApp(
      companyRecipients,
      "Workspace offboard requested",
      `"${name}" offboard was requested. Export your data from Company settings; FECSYNC ops will follow up. No orders or users were deleted.${reasonNote}`,
      "offboard_requested",
      id,
      companyHref
    );

    const opsEmail = process.env.COMPANY_OPS_ALERT_EMAIL?.trim();
    if (opsEmail) {
      try {
        const { sendCompanyOpsPendingAlertEmail } = await import("@/lib/mailer");
        await sendCompanyOpsPendingAlertEmail({
          to: opsEmail,
          orgName: `${name} (offboard requested)`,
          orgId: id,
          reviewUrl: opsHref,
        }).catch((err) =>
          console.warn("[company-notices] offboard ops email:", err)
        );
      } catch (err) {
        console.warn("[company-notices] offboard ops mailer:", err);
      }
    }

    try {
      const storefrontId = await getStorefrontOrgId();
      const opsRecipients = await resolveCompanyBillingRecipients(storefrontId);
      await notifyAdminsInApp(
        opsRecipients,
        "Company offboard requested",
        `"${name}" (${id}) requested workspace offboard.${reasonNote} Review registered companies — soft request only (no hard-delete).`,
        "offboard_requested",
        id,
        opsHref
      );
    } catch (err) {
      console.warn("[company-notices] offboard ops in-app:", err);
    }
  });
}
