/**
 * Desk-assist staff password reset (Users → Reset password).
 * Fail-closed vs FECSYNC software owners unless the actor is also an owner.
 */
import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import { requireActorOrgId } from "@/lib/staffOrg";
import { invalidateUserSessions } from "@/lib/memberAdmin";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import {
  assertCanManageStaffUserTarget,
  PLATFORM_OWNER_PROTECTED_MESSAGE,
} from "@/lib/resolvePlatformSoftwareOwner";
import { publicAppBaseUrl } from "@/lib/publicAppBaseUrl";
import {
  PASSWORD_TOO_SHORT_MESSAGE,
  passwordMeetsMinLength,
} from "@/lib/passwordPolicy";
import { notificationTransporter } from "@/lib/mailer";

export type StaffPasswordResetActor = {
  sub: string;
  orgId?: string | null;
  preset?: string | null;
  membershipRole?: string | null;
  storefrontOrgId?: string | null;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function adminResetStaffPassword(
  actor: StaffPasswordResetActor,
  input: {
    targetUserId: string;
    password: string;
    sendEmail?: boolean;
  }
): Promise<{ userId: string; email: string; note: string }> {
  const orgId = requireActorOrgId(actor);
  const targetUserId = input.targetUserId?.trim() || "";
  if (!isValidId(targetUserId)) {
    throw new ForbiddenError(PLATFORM_OWNER_PROTECTED_MESSAGE);
  }

  const password = typeof input.password === "string" ? input.password : "";
  if (!passwordMeetsMinLength(password)) {
    throw new Error(PASSWORD_TOO_SHORT_MESSAGE);
  }

  // Target must hold a live seat in the actor's org (no cross-tenant reset).
  const membership = await prisma.membership.findFirst({
    where: {
      orgId,
      userId: targetUserId,
      status: { in: ["active", "invited", "suspended"] },
    },
    select: { id: true, userId: true },
  });
  if (!membership) {
    throw new ForbiddenError(PLATFORM_OWNER_PROTECTED_MESSAGE);
  }

  await assertCanManageStaffUserTarget(actor, targetUserId);

  if (targetUserId === actor.sub) {
    throw new Error(
      "Use Change password on your profile to update your own password"
    );
  }

  const user = await prisma.user.findFirst({
    where: { id: targetUserId, accountDeleted: false },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      accountSuspended: true,
    },
  });
  if (!user?.email) {
    throw new ForbiddenError(PLATFORM_OWNER_PROTECTED_MESSAGE);
  }
  if (user.accountSuspended) {
    throw new Error("Cannot reset password for a suspended account");
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: hashedPassword,
      // Desk-assist is meant to let them sign in immediately. Login rejects
      // isVerified:false even when the new hash is correct.
      isVerified: true,
      verificationCode: null,
    },
  });
  try {
    await invalidateUserSessions(user.id);
  } catch (sessionErr) {
    console.error(
      "[adminResetStaffPassword] session invalidate failed (password already updated):",
      sessionErr instanceof Error ? sessionErr.message : sessionErr
    );
  }

  const wantEmail = input.sendEmail !== false;
  let emailed = false;
  if (wantEmail) {
    const base = publicAppBaseUrl();
    const guestName =
      `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "there";
    const userSmtp = process.env.NOTIFICATION_EMAIL_USER?.trim();
    const text = `Hi ${guestName},\n\nAn administrator reset your FECSYNC sign-in password.\n\nEmail: ${user.email}\nTemporary password: ${password}\n\nSign in: ${base}/signin\n\nPlease change your password after you sign in. If you did not expect this, contact your company admin.`;
    if (userSmtp) {
      try {
        await notificationTransporter.sendMail({
          from: `"FECSYNC" <${userSmtp}>`,
          to: user.email,
          subject: "Your FECSYNC password was reset",
          text,
          html: `<p>${escapeHtml(text).replace(/\n/g, "<br/>")}</p>`,
        });
        emailed = true;
      } catch (mailErr) {
        console.warn(
          "[adminResetStaffPassword] credentials email failed (password already updated):",
          mailErr instanceof Error ? mailErr.message : mailErr
        );
      }
    } else {
      console.info(
        "[adminResetStaffPassword] (no NOTIFICATION_EMAIL_USER) password updated; email skipped →",
        user.email
      );
    }
  }

  logStaffActivityEntry(actor, {
    action: "users.reset_password",
    entityType: "User",
    entityId: user.id,
    description: `Desk-assist password reset for staff user ${user.id.slice(-8)}`,
  });

  let note = "Password updated — their other sessions were signed out";
  if (wantEmail && emailed) {
    note =
      "Password updated — temporary credentials emailed; their other sessions were signed out";
  } else if (wantEmail && !emailed) {
    note =
      "Password updated and sessions signed out — credentials email could not be sent (tell them the new password in person, or check NOTIFICATION_EMAIL_USER)";
  }

  return {
    userId: user.id,
    email: user.email,
    note,
  };
}
