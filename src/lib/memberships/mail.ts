/**
 * Guest membership lifecycle emails (Phase 2 dunning + Phase 4 cancel/agreement).
 * SMS omitted unless a provider is configured elsewhere — honesty: email-only.
 */
import { notificationTransporter } from "@/lib/mailer";
import { htmlToPlainText } from "@/lib/memberships/richText";

async function sendSimple(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  const user = process.env.NOTIFICATION_EMAIL_USER?.trim();
  if (!user) {
    console.info(
      "[memberships/mail] (no NOTIFICATION_EMAIL_USER) would send:",
      input.subject,
      "→",
      input.to
    );
    return;
  }
  const escaped = input.text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  await notificationTransporter.sendMail({
    from: `"FECSYNC" <${user}>`,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: `<p>${escaped.replace(/\n/g, "<br/>")}</p>`,
  });
}

export async function sendGuestMembershipDunningEmail(input: {
  to: string;
  guestName: string;
  planName: string;
  kind: "failed" | "recovered" | "reminder";
  failCount: number;
}): Promise<void> {
  if (input.kind === "failed") {
    await sendSimple({
      to: input.to,
      subject: `Membership payment failed — ${input.planName}`,
      text: `Hi ${input.guestName},\n\nWe could not collect payment for your ${input.planName} membership (attempt ${input.failCount}). Please update your payment method or contact the park.\n\nBenefits may be suspended while past due.`,
    });
    return;
  }
  if (input.kind === "reminder") {
    await sendSimple({
      to: input.to,
      subject: `Membership payment reminder — ${input.planName}`,
      text: `Hi ${input.guestName},\n\nThis is a reminder that payment for your ${input.planName} membership is still past due (attempt ${input.failCount}). Please update your card or contact the park.`,
    });
    return;
  }
  await sendSimple({
    to: input.to,
    subject: `Membership payment recovered — ${input.planName}`,
    text: `Hi ${input.guestName},\n\nPayment for your ${input.planName} membership succeeded. Your membership is active again.`,
  });
}

export async function sendGuestMembershipCancelEmail(input: {
  to: string;
  guestName: string;
  planName: string;
  when: "immediate" | "end_of_period";
  accessEndsAt?: Date | null;
  cancellationTerms?: string | null;
}): Promise<void> {
  const end =
    input.accessEndsAt instanceof Date &&
    !Number.isNaN(input.accessEndsAt.getTime())
      ? input.accessEndsAt.toISOString().slice(0, 10)
      : "today";
  // Emails are plain text — strip rich-text HTML from plan merchandising.
  const termsPlain = htmlToPlainText(input.cancellationTerms ?? "");
  const terms = termsPlain
    ? `\n\nCancellation terms:\n${termsPlain}`
    : "";
  const body =
    input.when === "end_of_period"
      ? `Hi ${input.guestName},\n\nYour ${input.planName} membership cancel is scheduled for the end of the billing period. Access continues until ${end}.${terms}\n\nIf this was a mistake, contact the park to reactivate before the period ends.`
      : `Hi ${input.guestName},\n\nYour ${input.planName} membership has been cancelled. Access ended on ${end}.${terms}\n\nContact the park if you want to purchase again.`;
  await sendSimple({
    to: input.to,
    subject: `Membership cancelled — ${input.planName}`,
    text: body,
  });
}

export async function sendGuestMembershipAgreementEmail(input: {
  to: string;
  guestName: string;
  planName: string;
}): Promise<void> {
  await sendSimple({
    to: input.to,
    subject: `Membership agreement required — ${input.planName}`,
    text: `Hi ${input.guestName},\n\nPlease accept the membership agreement for ${input.planName} in your online account (Profile → Memberships) before benefits activate.\n\nThis is a stored acceptance record — not a certified e-sign kiosk.`,
  });
}

export async function sendGuestMembershipDashboardInviteEmail(input: {
  to: string;
  guestName: string;
  planName: string;
  activateUrl: string;
  dashboardUrl: string;
}): Promise<void> {
  await sendSimple({
    to: input.to,
    subject: `Set up your membership dashboard — ${input.planName}`,
    text: `Hi ${input.guestName},\n\nYour ${input.planName} membership is ready. Create your password to open your membership dashboard (plan details, visits, renewals, and payment history):\n\n${input.activateUrl}\n\nAfter you set a password, sign in and open Profile → Memberships:\n${input.dashboardUrl}\n\nThis invite-only link does not use public signup. If you did not expect this email, contact the park.`,
  });
}

export async function sendGuestMembershipLinkedEmail(input: {
  to: string;
  guestName: string;
  planName: string;
  dashboardUrl: string;
}): Promise<void> {
  await sendSimple({
    to: input.to,
    subject: `Your membership is on your account — ${input.planName}`,
    text: `Hi ${input.guestName},\n\nYour ${input.planName} membership is linked to this account. Sign in and open your membership dashboard:\n\n${input.dashboardUrl}\n\nThere you can track visits, plan details, renewals, and payment history.`,
  });
}

/** Staff desk set a password — email sign-in details (guest should change password after first login). */
export async function sendGuestMembershipCredentialsEmail(input: {
  to: string;
  guestName: string;
  password: string;
  dashboardUrl: string;
  signInUrl: string;
}): Promise<void> {
  const text = `Hi ${input.guestName},\n\nThe park desk created your online membership account. Sign in with:\n\nEmail: ${input.to}\nTemporary password: ${input.password}\n\nSign in: ${input.signInUrl}\nMembership dashboard: ${input.dashboardUrl}\n\nPlease change your password after you sign in. If you did not expect this email, contact the park.`;
  await sendSimple({
    to: input.to,
    subject: "Your membership dashboard login",
    text,
  });
}

export async function sendMembershipFinanceEscalationEmail(input: {
  to: string;
  orgName: string;
  memberCustomId: string;
  planName: string;
  failCount: number;
}): Promise<void> {
  await sendSimple({
    to: input.to,
    subject: `[Enterprise dunning] Past-due escalation — ${input.orgName}`,
    text: `Membership ${input.memberCustomId} (${input.planName}) has ${input.failCount} failed payment attempts and needs finance review.`,
  });
}
