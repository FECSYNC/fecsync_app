/**
 * Expiry reminders. One send per record per remindBeforeDays window.
 * Live expiry stays computed from expiresAt. This job does not flip status.
 */
import prisma from "@/lib/prisma";
import { sendWaiverGuestEmail } from "@/lib/mailer";
import { smsIsConfigured, sendSms } from "@/lib/sms";
import { planAllowsModule } from "@/lib/subscriptionPlans";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function windowsFrom(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [14, 3];
  const days = raw
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 365);
  return days.length ? [...new Set(days)].sort((a, b) => b - a) : [14, 3];
}

export async function remindExpiringWaivers(
  now = new Date(),
  opts?: { orgId?: string }
) {
  const orgs = await prisma.organization.findMany({
    where: {
      status: "active",
      ...(opts?.orgId ? { id: opts.orgId } : {}),
    },
    select: { id: true, subscriptionPlan: true },
  });
  let sent = 0;
  let skipped = 0;
  for (const org of orgs) {
    if (!planAllowsModule(org.subscriptionPlan, "waivers")) continue;
    const settings = await prisma.waiverSettings.findMany({
      where: { orgId: org.id },
      select: { locationId: true, remindBeforeDays: true },
    });
    const records = await prisma.waiverRecord.findMany({
      where: {
        orgId: org.id,
        status: "signed",
        expiresAt: { gt: now },
      },
      include: {
        guestProfile: { select: { email: true, phone: true, firstName: true } },
        guardian: { select: { email: true, phone: true, firstName: true } },
        template: { select: { name: true } },
        location: { select: { id: true, name: true } },
        reminderWatermarks: { select: { windowDays: true } },
      },
      take: 400,
    });
    for (const record of records) {
      try {
        if (!record.expiresAt || !record.signedAt || !record.location) {
          skipped += 1;
          continue;
        }
        const daysLeft = Math.ceil((record.expiresAt.getTime() - now.getTime()) / 86_400_000);
        if (daysLeft < 1) {
          skipped += 1;
          continue;
        }
        const local =
          settings.find((row) => row.locationId === record.locationId) ??
          settings.find((row) => row.locationId == null);
        const windows = windowsFrom(local?.remindBeforeDays);
        const already = new Set(record.reminderWatermarks.map((row) => row.windowDays));
        const due = windows.filter((window) => daysLeft <= window && !already.has(window));
        if (!due.length) {
          skipped += 1;
          continue;
        }
        const email = (record.guestProfile.email || record.guardian?.email || "").trim();
        const phone = (record.guestProfile.phone || record.guardian?.phone || "").trim();
        const guestName = escapeHtml(
          (record.guestProfile.email ? record.guestProfile.firstName : record.guardian?.firstName) ||
            record.guestProfile.firstName ||
            "there"
        );
        const templateName = escapeHtml(record.template.name);
        const publicRef = escapeHtml(record.publicRef);
        const expiresOn = record.expiresAt.toISOString().slice(0, 10);
        let delivered = false;
        if (email) {
          delivered = await sendWaiverGuestEmail({
            orgId: org.id,
            to: email,
            subject: `${record.location.name} — waiver expiring`,
            htmlBody: `<p>Hello ${guestName},</p><p>Your waiver for <strong>${templateName}</strong> expires on ${expiresOn}. Reference ${publicRef}.</p>`,
          });
        }
        if (phone && smsIsConfigured()) {
          try {
            await sendSms(
              phone,
              `${record.location.name}: waiver ${record.publicRef} expires ${expiresOn}`
            );
            delivered = true;
          } catch {
            /* email may already have been sent */
          }
        }
        if (!delivered) {
          skipped += 1;
          continue;
        }
        await prisma.waiverReminderWatermark.createMany({
          data: due.map((windowDays) => ({
            orgId: org.id,
            recordId: record.id,
            windowDays,
          })),
          skipDuplicates: true,
        });
        sent += 1;
      } catch {
        skipped += 1;
      }
    }
  }
  return { sent, skipped };
}
