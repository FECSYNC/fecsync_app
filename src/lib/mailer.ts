// lib/mailer.ts
import dns from "node:dns";
import nodemailer from "nodemailer";
import { ICustomization } from "./models/Customization";
import { buildAdminOrderPath } from "@/utils/authRedirect";
import { isPlatformAuthEmail } from "@/lib/companyProfile";
import {
  PLATFORM_BRAND_NAME,
  PLATFORM_SITE_URL,
  PLATFORM_SUPPORT_EMAIL,
  platformEmailAssetBaseUrl,
} from "@/lib/platformBrand";
import { companyLoginUrl } from "@/lib/tenantDomain";

export { isPlatformAuthEmail };
try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  // Node < 17
}

/** Normalized admin inbox from ADMIN_EMAIL (strips quotes/whitespace). */
export function getAdminEmail(): string | undefined {
  const raw = process.env.ADMIN_EMAIL;
  if (!raw) return undefined;
  const cleaned = raw.trim().replace(/^["']|["']$/g, "").trim();
  return cleaned || undefined;
}

function smtpIpv4Lookup(
  hostname: string,
  _options: dns.LookupOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string,
    family: number
  ) => void
) {
  dns.lookup(hostname, { family: 4, hints: dns.ADDRCONFIG }, callback);
}

// Shared SMTP config (cPanel / Hostinger)
const smtpConfig = {
  host: process.env.SMTP_HOST, // e.g. mail.fecsync.com (cPanel mail on domain A record)
  port: Number(process.env.SMTP_PORT || 465),
  secure: true, // SSL for port 465
  family: 4 as const,
  lookup: smtpIpv4Lookup,
  // Prevent localhost login/signup from hanging when SMTP is unreachable
  connectionTimeout: 8_000,
  greetingTimeout: 8_000,
  socketTimeout: 12_000,
};

// Team emails (welcome, general comms)
const teamTransporter = nodemailer.createTransport({
  ...smtpConfig,
  auth: {
    user: process.env.TEAM_EMAIL_USER,
    pass: process.env.TEAM_EMAIL_PASS,
  },
});

// Notification emails (OTP, verification, reset, admin alerts)
export const notificationTransporter = nodemailer.createTransport({
  ...smtpConfig,
  auth: {
    user: process.env.NOTIFICATION_EMAIL_USER,
    pass: process.env.NOTIFICATION_EMAIL_PASS,
  },
});

/* -------------------------------------------------------------------------- */
/*                           EMAIL WRAPPER TEMPLATE                           */
/* -------------------------------------------------------------------------- */

/** Remote-safe base URL for images/assets in email HTML. */
function getEmailAssetBaseUrl(): string {
  return platformEmailAssetBaseUrl();
}

/** Base URL for clickable email links (CTAs). Uses localhost in development. */
function getEmailActionBaseUrl(): string {
  const configuredBaseUrl =
    process.env.EMAIL_ACTION_BASE_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    PLATFORM_SITE_URL;
  const normalized = configuredBaseUrl.replace(/\/$/, "");

  if (
    process.env.NODE_ENV === "development" &&
    normalized.includes("localhost")
  ) {
    return normalized;
  }

  return normalized.includes("localhost") ? PLATFORM_SITE_URL : normalized;
}

export function buildAdminOrderActionUrl(orderId: string): string {
  return `${getEmailActionBaseUrl()}${buildAdminOrderPath(orderId)}`;
}

export type EmailBrandOptions = {
  displayName?: string;
  logoUrl?: string;
  supportEmail?: string | null;
  /** SMTP Reply-To for org-scoped customer mail. */
  replyToEmail?: string | null;
  tagline?: string;
};

/** Strip characters that break SMTP From display-name quoting. */
export function sanitizeSmtpDisplayName(name: string | null | undefined): string {
  const cleaned = String(name ?? "")
    .replace(/[\r\n"]/g, "")
    .trim();
  return cleaned || "FECSYNC";
}

export function brandSmtpReplyTo(
  brand: EmailBrandOptions | null | undefined
): string | null {
  const raw = brand?.replyToEmail?.trim() || brand?.supportEmail?.trim() || "";
  return raw.includes("@") ? raw : null;
}

async function resolveEmailBrand(
  orgId?: string | null
): Promise<EmailBrandOptions | null> {
  if (!orgId) return null;
  try {
    const { resolveBrandForOrg } = await import("@/lib/companyProfile");
    const brand = await resolveBrandForOrg(orgId);
    return {
      displayName: brand.displayName,
      logoUrl: brand.logoUrl,
      supportEmail: brand.supportEmail || brand.replyToEmail,
      replyToEmail: brand.replyToEmail || brand.supportEmail,
      tagline: brand.isPlatformFallback
        ? "Venue operations platform"
        : `Powered by ${PLATFORM_BRAND_NAME}`,
    };
  } catch (err) {
    console.warn("Failed to resolve email brand; using FECSYNC defaults:", err);
    return null;
  }
}

export const wrapEmailHtml = (
  content: string,
  title?: string,
  brand?: EmailBrandOptions | null,
  kind?: string
) => {
  // Platform auth / marketing must never white-label to a tenant company.
  const safeBrand =
    kind && isPlatformAuthEmail(kind) ? null : brand ?? null;
  const siteUrl = getEmailAssetBaseUrl();
  // Tenant brand with empty logoUrl → text letterhead (never inject FECSYNC mark).
  const logoUrl = safeBrand
    ? safeBrand.logoUrl?.trim() || ""
    : `${siteUrl}/brand/fecsync-mark.svg`;
  const displayName = safeBrand?.displayName?.trim() || PLATFORM_BRAND_NAME;
  const supportEmail =
    safeBrand?.supportEmail?.trim() ||
    (safeBrand ? "" : PLATFORM_SUPPORT_EMAIL);
  const tagline =
    safeBrand?.tagline?.trim() ||
    (safeBrand ? `Powered by ${PLATFORM_BRAND_NAME}` : "Venue operations platform");
  const safeName = displayName.replace(/[<>&"]/g, "");
  const safeSupport = supportEmail.replace(/[<>&"]/g, "");
  const safeLogo = logoUrl.replace(/"/g, "&quot;");
  const headerBlock = safeLogo
    ? `<img src="${safeLogo}" alt="${safeName}" />`
    : `<p style="margin:0;color:#D4AF37;font-size:22px;font-weight:700;letter-spacing:0.02em;">${safeName}</p>`;
  const helpBlock = safeSupport
    ? `<p style="margin: 0 0 12px 0;">
              Need help? Contact us at <a href="mailto:${safeSupport}">${safeSupport}</a>
            </p>`
    : "";

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="X-UA-Compatible" content="IE=edge">
      ${title ? `<title>${title}</title>` : ''}
      <style>
        body { margin: 0; padding: 0; background-color: #f4f6f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }
        .email-container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
        .header { background-color: #000000; padding: 32px 24px; text-align: center; }
        .header img { height: 60px; width: auto; display: block; margin: 0 auto; }
        .content { padding: 40px 32px; color: #1f2937; line-height: 1.7; }
        .footer { background-color: #f9fafb; padding: 24px 32px; text-align: center; color: #6b7280; font-size: 13px; border-top: 1px solid #e5e7eb; }
        .footer a { color: #D4AF37; text-decoration: none; }
        .button { display: inline-block; background: linear-gradient(135deg, #D4AF37 0%, #F4D03F 100%); color: #000000 !important; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; margin: 20px 0; box-shadow: 0 4px 6px rgba(212, 175, 55, 0.3); }
        .code-box { background: linear-gradient(135deg, #fffbf0 0%, #fef8e6 100%); border: 2px solid #D4AF37; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0; }
        .code { font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #D4AF37; font-family: 'Courier New', monospace; }
        .info-box { background-color: #f9fafb; border-left: 4px solid #D4AF37; padding: 20px; border-radius: 6px; margin: 24px 0; }
        .warning-box { background-color: #fef2f2; border-left: 4px solid #dc2626; padding: 20px; border-radius: 6px; margin: 24px 0; }
        .success-box { background-color: #fffbf0; border-left: 4px solid #D4AF37; padding: 20px; border-radius: 6px; margin: 24px 0; }
        h1 { color: #111827; font-size: 28px; font-weight: 700; margin: 0 0 16px 0; }
        h2 { color: #1f2937; font-size: 22px; font-weight: 600; margin: 0 0 12px; }
        p { margin: 0 0 16px 0; color: #374151; }
        ul { padding-left: 24px; margin: 16px 0; }
        li { margin-bottom: 8px; color: #4b5563; }
        .divider { height: 1px; background-color: #e5e7eb; margin: 32px 0; }
        @media only screen and (max-width: 600px) {
          .content { padding: 32px 20px !important; }
          .header { padding: 24px 20px !important; }
          .footer { padding: 20px !important; }
          h1 { font-size: 24px !important; }
          .code { font-size: 28px !important; letter-spacing: 6px !important; }
        }
      </style>
    </head>
    <body>
      <div style="background-color: #f4f6f9; padding: 40px 20px;">
        <div class="email-container">
          <div class="header">
            ${headerBlock}
          </div>
          <div class="content">
            ${content}
          </div>
          <div class="footer">
            <p style="margin: 0 0 8px 0;">
              <strong>${safeName}</strong> - ${tagline.replace(/[<>&"]/g, "")}
            </p>
            ${helpBlock}
            <p style="margin: 0; font-size: 12px; color: #9ca3af;">
              &copy; ${new Date().getFullYear()} ${safeName}. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
};

const generateCustomRequestHtml = (data: any, type: 'user' | 'admin', customerEmail?: string) => {
  // Helper to get display label for outfit
  const getOutfitLabel = (outfit: string) => {
    const lower = outfit.toLowerCase();
    if (lower === 'blouse' || lower === 'top') return 'Top';
    return outfit.charAt(0).toUpperCase() + outfit.slice(1);
  };

  // Helper to get display label for option
  const getOptionLabel = (option: string) => {
    return option.split('-').map(word => {
      const lower = word.toLowerCase();
      if (lower === 'blouse') return 'Top';
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }).join(' ');
  };

  // Determine selections HTML
  let selectionsHtml = '';
  if (data.selections && Array.isArray(data.selections) && data.selections.length > 0) {
    selectionsHtml = data.selections.map((s: any) => `
      <div style="margin-bottom: 8px; padding: 10px; background-color: #f9f9f9; border-radius: 8px; border-left: 4px solid #D4AF37;">
        <span style="font-weight: bold;">${getOutfitLabel(s.outfit)}:</span> 
        <span style="color: #333;">${getOptionLabel(s.option)}</span>
      </div>
    `).join('');
  } else {
    // Fallback for legacy data
    selectionsHtml = `
      <div style="margin-bottom: 8px; padding: 10px; background-color: #f9f9f9; border-radius: 8px; border-left: 4px solid #D4AF37;">
        <span style="font-weight: bold;">${getOutfitLabel(data.outfit || '')}:</span> 
        <span style="color: #333;">${getOptionLabel(data.outfitOption || 'N/A')}</span>
      </div>
    `;
  }

  return `
    <div style="max-width: 600px; margin: 0 auto; color: #333; font-family: 'Inter', sans-serif;">
      <h2 style="color: #000; font-size: 24px; margin-bottom: 20px; border-bottom: 2px solid #D4AF37; padding-bottom: 10px;">
        Customization Request
      </h2>
      
      <p style="font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
        ${type === 'user'
      ? "Thank you for your customization request! We have received your design preferences and our team will review them shortly."
      : `A new customization request has been received from <strong>${customerEmail || 'a customer'}</strong>.`
    }
      </p>

      <div style="background-color: #fff; border: 1px solid #eee; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
        <h3 style="font-size: 18px; margin-top: 0; margin-bottom: 16px; color: #D4AF37; text-transform: uppercase; letter-spacing: 1px;">
          Design Selections
        </h3>
        
        <div style="margin-bottom: 20px;">
          ${selectionsHtml}
        </div>

        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 10px 0; border-bottom: 1px solid #eee; color: #666;">Fabric Type</td>
            <td style="padding: 10px 0; border-bottom: 1px solid #eee; font-weight: bold; text-align: right;">${data.fabricType}</td>
          </tr>
          <tr>
            <td style="padding: 10px 0; border-bottom: 1px solid #eee; color: #666;">Size</td>
            <td style="padding: 10px 0; border-bottom: 1px solid #eee; font-weight: bold; text-align: right;">${data.size}</td>
          </tr>
          <tr>
            <td style="padding: 10px 0; border-bottom: 1px solid #eee; color: #666;">Preferred Color</td>
            <td style="padding: 10px 0; border-bottom: 1px solid #eee; font-weight: bold; text-align: right;">${data.preferredColor}</td>
          </tr>
        </table>

        ${data.additionalNotes ? `
          <div style="margin-top: 24px;">
            <h4 style="font-size: 14px; margin-bottom: 8px; color: #666; text-transform: uppercase;">Additional Notes</h4>
            <div style="padding: 12px; background-color: #f5f5f5; border-radius: 8px; font-style: italic;">
              "${data.additionalNotes}"
            </div>
          </div>
        ` : ''}

        ${type === 'admin' ? `
          <div style="margin-top: 32px; padding: 20px; background-color: #fffbf0; border-radius: 12px; border: 1px solid #D4AF37; text-align: center;">
            <p style="margin: 0; font-size: 14px; color: #333;">
              <strong>Action Required:</strong> You can check the <strong>Admin Dashboard</strong> for more customization details and reference images.
            </p>
          </div>
        ` : ''}
      </div>
    </div>
  `;
};

/* -------------------------------------------------------------------------- */
/*                                EMAIL SENDERS                               */
/* -------------------------------------------------------------------------- */

export async function sendVerificationEmail(to: string, code: string) {
  const content = `
    <h1>Verify Your Email Address</h1>
    <p>Welcome to <strong>FECSYNC</strong>! We're excited to have you join our fashion community.</p>
    <p>To complete your registration and secure your account, please use the verification code below:</p>
    
    <div class="code-box">
      <p style="margin: 0 0 12px 0; font-size: 14px; color: #6b7280; font-weight: 500;">YOUR VERIFICATION CODE</p>
      <div class="code">${code}</div>
      <p style="margin: 12px 0 0 0; font-size: 13px; color: #9ca3af;">This code expires in 10 minutes</p>
    </div>
    
    <div class="info-box">
      <p style="margin: 0; font-size: 14px;"><strong>Security Tip:</strong> Never share this code with anyone. FECSYNC will never ask for your verification code via phone or email.</p>
    </div>
    
    <p style="margin-top: 32px; color: #6b7280; font-size: 14px;">
      If you didn't request this verification code, please ignore this email or contact our support team if you have concerns.
    </p>
    
    <div class="divider"></div>
    
    <p style="margin: 0; color: #6b7280; font-size: 14px;">
      Best regards,<br>
      <strong style="color: #1f2937;">The FECSYNC Team</strong>
    </p>
  `;

  await notificationTransporter.sendMail({
    from: `"FECSYNC" <${process.env.NOTIFICATION_EMAIL_USER}>`,
    to,
    subject: "🔐 Verify Your Email - FECSYNC",
    html: wrapEmailHtml(content, "Verify Your Email - FECSYNC", null, "verification"),
  });
}

export async function sendAdminVerificationEmail(
  userMail: string,
  code: string
) {
  const adminEmail = getAdminEmail();
  if (!adminEmail) {
    throw new Error("ADMIN_EMAIL is not configured");
  }
  const content = `
    <h1>🔐 New Admin Registration</h1>
    <p>A new administrator account has been created and requires verification.</p>
    
    <div class="info-box">
      <p style="margin: 0 0 8px 0;"><strong>Registrant Email:</strong></p>
      <p style="margin: 0; font-size: 16px; color: #D4AF37; font-weight: 600;">${userMail}</p>
    </div>
    
    <p>Please share the following verification code with the new administrator to complete their registration:</p>
    
    <div class="code-box">
      <p style="margin: 0 0 12px 0; font-size: 14px; color: #6b7280; font-weight: 500;">ADMIN VERIFICATION CODE</p>
      <div class="code">${code}</div>
      <p style="margin: 12px 0 0 0; font-size: 13px; color: #9ca3af;">This code expires in 15 minutes</p>
    </div>
    
    <div class="warning-box">
      <p style="margin: 0; font-size: 14px;"><strong>⚠️ Important:</strong> Only share this code through secure channels. Verify the identity of the person requesting admin access before providing this code.</p>
    </div>
    
    <p style="margin-top: 32px; color: #6b7280; font-size: 14px;">
      If this registration was not authorized, please contact the security team immediately.
    </p>
    
    <div class="divider"></div>
    
    <p style="margin: 0; color: #6b7280; font-size: 14px;">
      Best regards,<br>
      <strong style="color: #1f2937;">FECSYNC Security Team</strong>
    </p>
  `;

  await notificationTransporter.sendMail({
    from: `"FECSYNC" <${process.env.NOTIFICATION_EMAIL_USER}>`,
    to: adminEmail,
    subject: "🔐 New Admin Registration - Verification Required",
    html: wrapEmailHtml(content, "Admin Verification - FECSYNC", null, "admin_verification"),
  });
}

/** Step 6.2 — notify an existing user they were invited to an org membership. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Slug of a registered company (never the platform storefront org), for its own sign-in link. */
async function registeredCompanySlug(orgId?: string | null): Promise<string | null> {
  if (!orgId) return null;
  try {
    const { default: prisma } = await import("@/lib/prisma");
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { slug: true, isDefault: true },
    });
    return org && !org.isDefault && org.slug ? org.slug : null;
  } catch (err) {
    console.warn("Failed to resolve company sign-in link; using the platform sign-in:", err);
    return null;
  }
}

export async function sendMembershipInviteEmail(input: {
  to: string;
  rolePreset: string;
  orgName?: string;
  invitedByEmail?: string;
  orgId?: string | null;
  inviteExpiresAt?: Date | null;
  inviteTtlDays?: number;
}) {
  const siteUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const base = siteUrl.replace(/\/$/, "");
  const isTailorInvite = input.rolePreset === "tailor";
  const companySlug = isTailorInvite ? null : await registeredCompanySlug(input.orgId);
  const signInUrl = isTailorInvite
    ? `${base}/signin?returnTo=${encodeURIComponent("/tailor/home")}`
    : companySlug
      ? companyLoginUrl(companySlug, base)
      : `${base}/signin`;
  const roleLabel = escapeHtml(input.rolePreset.replace(/_/g, " "));
  const byLine = input.invitedByEmail
    ? `<p><strong>Invited by:</strong> ${escapeHtml(input.invitedByEmail)}</p>`
    : "";
  const accessCopy = isTailorInvite
    ? `<p>Sign in with this email address to open your tailor studio. If your membership is still pending, an administrator may need to activate it.</p>`
    : `<p>Sign in with this email address to access the admin tools available for your role. If your membership is still pending, an administrator may need to activate it.</p>`;
  const ttlDays =
    typeof input.inviteTtlDays === "number" && input.inviteTtlDays > 0
      ? input.inviteTtlDays
      : null;
  const expiresLine = input.inviteExpiresAt
    ? `<p style="margin-top: 16px; color: #6b7280; font-size: 14px;"><strong>Invitation expires:</strong> ${escapeHtml(
        input.inviteExpiresAt.toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      )}${ttlDays ? ` (about ${ttlDays} days from invite)` : ""}.</p>`
    : ttlDays
      ? `<p style="margin-top: 16px; color: #6b7280; font-size: 14px;">Pending invitations expire after <strong>${ttlDays} days</strong>. Ask an admin to resend if yours lapses.</p>`
      : "";
  const brand = await resolveEmailBrand(input.orgId);
  const displayName = brand?.displayName?.trim() || input.orgName?.trim() || "FECSYNC";
  const orgLabel = escapeHtml(displayName);
  const content = `
    <h1>You're invited to ${orgLabel}</h1>
    <p>You have been invited to join the <strong>${orgLabel}</strong> team.</p>

    <div class="info-box">
      <p style="margin: 0 0 8px 0;"><strong>Role:</strong></p>
      <p style="margin: 0; font-size: 16px; color: #D4AF37; font-weight: 600; text-transform: capitalize;">${roleLabel}</p>
    </div>
    ${byLine}

    ${accessCopy}
    ${expiresLine}

    <div style="text-align: center; margin: 32px 0;">
      <a href="${signInUrl}" class="button">Sign in to ${orgLabel}</a>
    </div>

    <p style="margin-top: 32px; color: #6b7280; font-size: 14px;">
      If you were not expecting this invitation, you can ignore this email.
    </p>
  `;

  await sendMailWithFallback({
    to: input.to,
    subject: `Invitation to ${displayName}`,
    html: wrapEmailHtml(
      content,
      `Team Invitation - ${displayName}`,
      brand
    ),
    fromDisplayName: displayName,
    replyTo: brandSmtpReplyTo(brand),
  });
}

/** Sent when staff links an existing user as a Find-a-Tailor provider. */
export async function sendTailorStudioInviteEmail(input: {
  to: string;
  displayName: string;
  orgName?: string;
  status?: string;
  invitedByEmail?: string;
  /** Tenant org for Company Profile brand (not platform auth). */
  orgId?: string | null;
}) {
  const siteUrl = (process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000").replace(
    /\/$/,
    ""
  );
  const studioPath = "/tailor/home";
  const signInUrl = `${siteUrl}/signin?returnTo=${encodeURIComponent(studioPath)}`;
  const studioUrl = `${siteUrl}${studioPath}`;
  const brand = await resolveEmailBrand(input.orgId);
  const displayName = brand?.displayName?.trim() || input.orgName?.trim() || "FECSYNC";
  const name = escapeHtml(input.displayName.trim() || "there");
  const orgLabel = escapeHtml(displayName);
  const status = (input.status || "pending").trim().toLowerCase();
  const byLine = input.invitedByEmail
    ? `<p><strong>Set up by:</strong> ${escapeHtml(input.invitedByEmail)}</p>`
    : "";
  const statusNote =
    status === "approved"
      ? `<p>Your profile is <strong>approved</strong> — you can open your studio and start inviting clients right away.</p>`
      : `<p>Your profile status is <strong>${escapeHtml(status)}</strong>. You can sign in and prepare your studio; an administrator may still need to approve your public listing.</p>`;

  const content = `
    <h1>Your tailor studio is ready, ${name}</h1>
    <p>You've been added as a tailor on <strong>${orgLabel}</strong>. Sign in with this email to open your studio dashboard.</p>

    <div class="info-box">
      <p style="margin: 0 0 8px 0;"><strong>What you can do:</strong></p>
      <ul style="margin: 0; padding-left: 20px;">
        <li>Manage your client roster</li>
        <li>Create measurement campaigns and invite clients</li>
        <li>Track bookings and jobs</li>
        <li>Update your portfolio and profile</li>
      </ul>
    </div>
    ${statusNote}
    ${byLine}

    <div style="text-align: center; margin: 32px 0;">
      <a href="${signInUrl}" class="button">Open tailor studio</a>
    </div>

    <p style="color: #6b7280; font-size: 14px;">
      After you sign in, go to <a href="${studioUrl}" style="color: #D4AF37; text-decoration: none;">${escapeHtml(studioUrl)}</a> anytime.
    </p>

    <p style="margin-top: 32px; color: #6b7280; font-size: 14px;">
      If you were not expecting this email, you can ignore it.
    </p>
  `;

  await sendMailWithFallback({
    to: input.to,
    subject: `Your tailor studio is ready — ${displayName}`,
    html: wrapEmailHtml(content, `Tailor Studio Access - ${displayName}`, brand),
    fromDisplayName: displayName,
    replyTo: brandSmtpReplyTo(brand),
  });
}

export async function sendWelcomeEmail(to: string, name?: string) {
  const siteUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

  // Extract first name if full name is provided
  const firstName = name ? name.trim().split(/\s+/)[0] : 'Friend';

  const content = `
    <h1>Welcome to FECSYNC, ${firstName}! 🎉</h1>
    <p>We're absolutely thrilled to have you join our vibrant fashion community!</p>
    
    <p>FECSYNC is your ultimate destination for discovering the latest fashion trends, exploring unique styles, and creating custom outfits that express your personality.</p>
    
    <div class="success-box">
      <h2 style="margin: 0 0 12px 0; font-size: 18px;">What You Can Do:</h2>
      <ul style="margin: 0; padding-left: 20px;">
        <li><strong>Explore Trends:</strong> Stay updated with the latest fashion insights</li>
        <li><strong>Shop Ready-to-Wear:</strong> Browse our curated collection</li>
        <li><strong>AI Style Generator:</strong> Get personalized fashion recommendations</li>
        <li><strong>Custom Designs:</strong> Create unique pieces tailored to you</li>
      </ul>
    </div>
    
    <div style="text-align: center; margin: 32px 0;">
      <a href="${siteUrl}" class="button">Start Exploring</a>
    </div>
    
    <p style="color: #6b7280; font-size: 14px;">
      Need help getting started? Our support team is always here to assist you at <a href="mailto:${PLATFORM_SUPPORT_EMAIL}" style="color: #D4AF37; text-decoration: none;">${PLATFORM_SUPPORT_EMAIL}</a>
    </p>
    
    <div class="divider"></div>
    
    <p style="margin: 0; color: #6b7280; font-size: 14px;">
      Warm regards,<br>
      <strong style="color: #1f2937;">The FECSYNC Team</strong>
    </p>
  `;

  await teamTransporter.sendMail({
    from: `"FECSYNC" <${process.env.TEAM_EMAIL_USER}>`,
    to,
    subject: "🎉 Welcome to FECSYNC - Let's Get Started!",
    html: wrapEmailHtml(content, "Welcome to FECSYNC", null, "welcome"),
  });
}

export async function resendOtpEmail(to: string, otp: string) {
  const content = `
    <h1>Your Verification Code</h1>
    <p>You requested a new verification code for your FECSYNC account.</p>
    
    <div class="code-box">
      <p style="margin: 0 0 12px 0; font-size: 14px; color: #6b7280; font-weight: 500;">ONE-TIME PASSWORD (OTP)</p>
      <div class="code">${otp}</div>
      <p style="margin: 12px 0 0 0; font-size: 13px; color: #9ca3af;">This code expires in 10 minutes</p>
    </div>
    
    <div class="info-box">
      <p style="margin: 0; font-size: 14px;"><strong>Security Note:</strong> This is a one-time code. Do not share it with anyone, including FECSYNC staff.</p>
    </div>
    
    <p style="margin-top: 32px; color: #6b7280; font-size: 14px;">
      If you didn't request this code, please secure your account immediately by changing your password.
    </p>
    
    <div class="divider"></div>
    
    <p style="margin: 0; color: #6b7280; font-size: 14px;">
      Best regards,<br>
      <strong style="color: #1f2937;">The FECSYNC Team</strong>
    </p>
  `;

  await notificationTransporter.sendMail({
    from: `"FECSYNC" <${process.env.NOTIFICATION_EMAIL_USER}>`,
    to,
    subject: "Your OTP Verification Code - FECSYNC",
    html: wrapEmailHtml(content, "OTP Verification - FECSYNC", null, "otp"),
  });
}

export async function sendResetEmail(to: string, url: string) {
  const content = `
    <h1>Reset Your Password</h1>
    <p>We received a request to reset the password for your FECSYNC account.</p>
    
    <p>Click the button below to create a new password.</p>
    
    <div style="text-align: center; margin: 32px 0;">
      <a href="${url}" class="button">Reset My Password</a>
    </div>

    <div class="info-box">
      <p style="margin: 0 0 8px 0; font-size: 14px; color: #1f2937;">
        <strong>Notice — link expiry</strong>
      </p>
      <p style="margin: 0; font-size: 14px; color: #4b5563; line-height: 1.55;">
        For your security, this password reset link expires in <strong>1 hour</strong>.
        After that time the link becomes invalid and cannot be used.
        If it has expired, please request a new password reset link to continue.
      </p>
    </div>
    
    <div class="info-box">
      <p style="margin: 0 0 8px 0; font-size: 14px;"><strong>Alternative Link:</strong></p>
      <p style="margin: 0; font-size: 13px; word-break: break-all; color: #6b7280;">
        If the button doesn't work, copy and paste this <strong>entire</strong> link into your browser (do not open it inside the email app preview):<br>
        <a href="${url}" style="color: #D4AF37; text-decoration: none;">${url}</a>
      </p>
    </div>
    
    <div class="warning-box">
      <p style="margin: 0; font-size: 14px;"><strong>Didn't request this?</strong> If you didn't ask to reset your password, please ignore this email. Your account remains secure.</p>
    </div>
    
    <div class="divider"></div>
    
    <p style="margin: 0; color: #6b7280; font-size: 14px;">
      Best regards,<br>
      <strong style="color: #1f2937;">The FECSYNC Team</strong>
    </p>
  `;

  await notificationTransporter.sendMail({
    from: `"FECSYNC" <${process.env.NOTIFICATION_EMAIL_USER}>`,
    to,
    subject: "Reset Your Password - FECSYNC",
    html: wrapEmailHtml(content, "Password Reset - FECSYNC", null, "password_reset"),
  });
}

export const sendFailureMail = async ({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}) => {
  return notificationTransporter.sendMail({
    from: `"FECSYNC" <${process.env.NOTIFICATION_EMAIL_USER}>`,
    to,
    subject,
    html: wrapEmailHtml(html),
  });
};

export const sendCustomRequestMail = async ({
  to,
  subject,
  type,
  data,
  customerEmail,
}: {
  to: string;
  subject: string;
  type: "user" | "admin";
  data: ICustomization;
  customerEmail?: string;
}) => {
  const html = generateCustomRequestHtml(data, type, customerEmail);
  await notificationTransporter.sendMail({
    from: `"FECSYNC" <${process.env.NOTIFICATION_EMAIL_USER}>`,
    to,
    subject,
    html: wrapEmailHtml(html),
  });
};

type OrderEmailItem = {
  name: string;
  quantity: number;
  imageUrl?: string;
  unitLabel?: string;
};

function buildOrderItemsHtml(
  items?: OrderEmailItem[],
  heading = "Items in your order"
) {
  if (!items || items.length === 0) return "";

  return `
    <h2 style="font-size: 18px; margin: 24px 0 12px 0;">${heading}</h2>
    <table style="width:100%; border-collapse: collapse;">
      <tbody>
        ${items
          .map(
            (item) => `
          <tr>
            <td style="padding: 8px 0; vertical-align: top; width: 56px;">
              ${
                item.imageUrl
                  ? `<img src="${item.imageUrl}" alt="${item.name}" width="48" height="48" style="display:block; width:48px; height:48px; object-fit:cover; border-radius:8px; border:1px solid #e5e7eb;" />`
                  : `<div style="width:48px; height:48px; border-radius:8px; border:1px solid #e5e7eb; background:#f9fafb;"></div>`
              }
            </td>
            <td style="padding: 8px 0 8px 10px; vertical-align: top;">
              <p style="margin:0; font-weight:600; color:#111827;">${item.name}</p>
              <p style="margin:2px 0 0 0; font-size:12px; color:#6b7280;">Qty: ${item.quantity}${
                item.unitLabel ? ` (${item.unitLabel})` : ""
              }</p>
            </td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

async function sendMailWithFallback(payload: {
  to: string;
  subject: string;
  html: string;
  /** Org-scoped customer mail — SMTP From display name (defaults FECSYNC). */
  fromDisplayName?: string | null;
  /** Org-scoped Reply-To (replyToEmail || supportEmail). */
  replyTo?: string | null;
  headers?: Record<string, string>;
}) {
  const fromName = sanitizeSmtpDisplayName(payload.fromDisplayName);
  const replyToRaw =
    typeof payload.replyTo === "string" ? payload.replyTo.trim() : "";
  const replyTo = replyToRaw.includes("@") ? replyToRaw : undefined;
  const { fromDisplayName: _omit, replyTo: _replyOmit, ...mail } = payload;
  void _omit;
  void _replyOmit;
  const envelope = {
    ...mail,
    ...(replyTo ? { replyTo } : {}),
  };
  try {
    await notificationTransporter.sendMail({
      from: `"${fromName}" <${process.env.NOTIFICATION_EMAIL_USER}>`,
      ...envelope,
    });
    return;
  } catch (notificationError) {
    console.error("Notification transporter failed:", notificationError);
  }

  try {
    await teamTransporter.sendMail({
      from: `"${fromName}" <${process.env.TEAM_EMAIL_USER}>`,
      ...envelope,
    });
  } catch (teamError) {
    console.error("Team transporter failed:", teamError);
    throw teamError;
  }
}

export async function sendAdminOrderPaidEmail({
  customerEmail,
  customerName,
  orderId,
  amount,
  subtotal,
  taxAmount,
  taxLabel,
  shippingFee,
  hasShippingMethod,
  items,
  orgId,
}: {
  customerEmail: string;
  customerName?: string;
  orderId: string;
  amount?: number;
  subtotal?: number;
  taxAmount?: number;
  taxLabel?: string;
  shippingFee?: number;
  hasShippingMethod?: boolean;
  items?: OrderEmailItem[];
  /** Reserved — platform ADMIN_EMAIL inbox stays FECSYNC-branded. */
  orgId?: string | null;
}) {
  void orgId;
  const adminEmail = getAdminEmail();
  if (!adminEmail) {
    console.warn("ADMIN_EMAIL not set; skipping admin order payment notification");
    return;
  }

  const shortOrderId = orderId.slice(-8);
  const customerLabel =
    customerName?.trim() || customerEmail || "Customer";
  const shippingLine =
    typeof shippingFee === "number" && shippingFee > 0
      ? `<p style="margin: 0;"><strong>Shipping:</strong> $${shippingFee.toLocaleString()}</p>`
      : hasShippingMethod && typeof shippingFee === "number"
        ? `<p style="margin: 0;"><strong>Shipping:</strong> Free</p>`
        : typeof shippingFee === "number"
          ? `<p style="margin: 0;"><strong>Shipping:</strong> —</p>`
          : "";
  const amountLine = [
    typeof subtotal === "number"
      ? `<p style="margin: 0;"><strong>Subtotal:</strong> $${subtotal.toLocaleString()}</p>`
      : "",
    shippingLine,
    typeof taxAmount === "number" && taxAmount > 0
      ? `<p style="margin: 0;"><strong>${taxLabel || "Tax"}:</strong> $${taxAmount.toLocaleString()}</p>`
      : "",
    typeof amount === "number"
      ? `<p style="margin: 0;"><strong>Amount Paid:</strong> $${amount.toLocaleString()}</p>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  const processOrderUrl = buildAdminOrderActionUrl(orderId);
  if (process.env.NODE_ENV === "development") {
    console.log(`[dev] Admin Process Order link: ${processOrderUrl}`);
  }

  const content = `
    <h1>New order payment received</h1>
    <p>A customer has completed payment for an order. Review the items below and process the order when ready.</p>
    <div class="success-box">
      <p style="margin: 0;"><strong>Order ID:</strong> #${shortOrderId}</p>
      <p style="margin: 0;"><strong>Customer:</strong> ${customerLabel}</p>
      <p style="margin: 0;"><strong>Customer Email:</strong> ${customerEmail}</p>
      ${amountLine}
      <p style="margin: 0;"><strong>Status:</strong> Paid</p>
    </div>
    ${buildOrderItemsHtml(items, "Items ordered")}
    <div style="text-align: center; margin: 28px 0 8px 0;">
      <a href="${processOrderUrl}" class="button" style="background: linear-gradient(135deg, #111827 0%, #1f2937 100%); color: #ffffff !important; font-size: 15px; letter-spacing: 0.02em;">
        Process Order #${shortOrderId}
      </a>
    </div>
    <p style="margin: 0 0 8px 0; color: #6b7280; font-size: 13px; text-align: center;">
      Opens this order in the admin dashboard. Sign in if prompted.
    </p>
    <p style="margin-top: 16px; color: #6b7280; font-size: 14px;">
      This alert is sent only after payment is confirmed.
    </p>
  `;

  await notificationTransporter.sendMail({
    from: `"FECSYNC" <${process.env.NOTIFICATION_EMAIL_USER}>`,
    to: adminEmail,
    subject: `New paid order #${shortOrderId} from ${customerLabel}`,
    html: wrapEmailHtml(content, "New Paid Order - FECSYNC"),
  });
}

/** Notify tenant company ops (billing/support). FECSYNC ADMIN_EMAIL stays separate. */
export async function sendCompanyOrderPaidEmail({
  customerEmail,
  customerName,
  orderId,
  amount,
  subtotal,
  taxAmount,
  taxLabel,
  shippingFee,
  hasShippingMethod,
  items,
  orgId,
}: {
  customerEmail: string;
  customerName?: string;
  orderId: string;
  amount?: number;
  subtotal?: number;
  taxAmount?: number;
  taxLabel?: string;
  shippingFee?: number;
  hasShippingMethod?: boolean;
  items?: OrderEmailItem[];
  orgId?: string | null;
}) {
  const id = typeof orgId === "string" ? orgId.trim() : "";
  if (!id) return;

  try {
    const { getStorefrontOrgId } = await import("@/lib/org");
    const storefrontOrgId = await getStorefrontOrgId();
    if (id === storefrontOrgId) return;

    const { getCompanyProfile, resolveBrandForOrg } = await import(
      "@/lib/companyProfile"
    );
    const [profile, brandDoc] = await Promise.all([
      getCompanyProfile(id),
      resolveBrandForOrg(id),
    ]);
    const to =
      profile?.billingEmail?.trim() ||
      profile?.supportEmail?.trim() ||
      brandDoc.supportEmail?.trim() ||
      "";
    if (!to.includes("@")) return;

    const brand = await resolveEmailBrand(id);
    const displayName = brand?.displayName?.trim() || brandDoc.displayName;
    const shortOrderId = orderId.slice(-8);
    const customerLabel =
      customerName?.trim() || customerEmail || "Customer";
    const shippingLine =
      typeof shippingFee === "number" && shippingFee > 0
        ? `<p style="margin: 0;"><strong>Shipping:</strong> $${shippingFee.toLocaleString()}</p>`
        : hasShippingMethod && typeof shippingFee === "number"
          ? `<p style="margin: 0;"><strong>Shipping:</strong> Free</p>`
          : typeof shippingFee === "number"
            ? `<p style="margin: 0;"><strong>Shipping:</strong> —</p>`
            : "";
    const amountLine = [
      typeof subtotal === "number"
        ? `<p style="margin: 0;"><strong>Subtotal:</strong> $${subtotal.toLocaleString()}</p>`
        : "",
      shippingLine,
      typeof taxAmount === "number" && taxAmount > 0
        ? `<p style="margin: 0;"><strong>${taxLabel || "Tax"}:</strong> $${taxAmount.toLocaleString()}</p>`
        : "",
      typeof amount === "number"
        ? `<p style="margin: 0;"><strong>Amount Paid:</strong> $${amount.toLocaleString()}</p>`
        : "",
    ]
      .filter(Boolean)
      .join("");

    const processOrderUrl = buildAdminOrderActionUrl(orderId);
    const content = `
    <h1>New order payment received</h1>
    <p>A customer completed payment for an order on <strong>${escapeHtml(displayName)}</strong>.</p>
    <div class="success-box">
      <p style="margin: 0;"><strong>Order ID:</strong> #${shortOrderId}</p>
      <p style="margin: 0;"><strong>Customer:</strong> ${escapeHtml(customerLabel)}</p>
      <p style="margin: 0;"><strong>Customer Email:</strong> ${escapeHtml(customerEmail)}</p>
      ${amountLine}
      <p style="margin: 0;"><strong>Status:</strong> Paid</p>
    </div>
    ${buildOrderItemsHtml(items, "Items ordered")}
    <div style="text-align: center; margin: 28px 0 8px 0;">
      <a href="${processOrderUrl}" class="button">Open order</a>
    </div>
  `;

    await sendMailWithFallback({
      to,
      subject: `New paid order #${shortOrderId} — ${displayName}`,
      html: wrapEmailHtml(content, `New Paid Order - ${displayName}`, brand),
      fromDisplayName: displayName,
      replyTo: brandSmtpReplyTo(brand),
    });
  } catch (err) {
    console.warn("[mailer] company order-paid email skipped:", err);
  }
}

/** Notify customer and admin after payment is confirmed (not on order placement). */
export async function notifyOrderPaid({
  customerEmail,
  customerName,
  orderId,
  amount,
  subtotal,
  taxAmount,
  taxLabel,
  shippingFee,
  hasShippingMethod,
  items,
  orgId,
}: {
  customerEmail: string;
  customerName?: string;
  orderId: string;
  amount?: number;
  subtotal?: number;
  taxAmount?: number;
  taxLabel?: string;
  shippingFee?: number;
  hasShippingMethod?: boolean;
  items?: OrderEmailItem[];
  orgId?: string | null;
}) {
  const [customerResult, adminResult, companyResult] = await Promise.allSettled([
    sendOrderStatusEmail({
      to: customerEmail,
      customerName,
      orderId,
      status: "paid",
      items,
      orgId,
    }),
    sendAdminOrderPaidEmail({
      customerEmail,
      customerName,
      orderId,
      amount,
      subtotal,
      taxAmount,
      taxLabel,
      shippingFee,
      hasShippingMethod,
      items,
      orgId,
    }),
    sendCompanyOrderPaidEmail({
      customerEmail,
      customerName,
      orderId,
      amount,
      subtotal,
      taxAmount,
      taxLabel,
      shippingFee,
      hasShippingMethod,
      items,
      orgId,
    }),
  ]);

  if (customerResult.status === "rejected") {
    console.error("Customer order paid email failed:", customerResult.reason);
  }
  if (adminResult.status === "rejected") {
    console.error("Admin order paid email failed:", adminResult.reason);
  }
  if (companyResult.status === "rejected") {
    console.error("Company order paid email failed:", companyResult.reason);
  }
}

export async function sendOrderStatusEmail({
  to,
  customerName,
  orderId,
  status,
  items,
  trackingUrl,
  courierName,
  trackingNumber,
  orgId,
}: {
  to: string;
  customerName?: string;
  orderId: string;
  status: string;
  items?: OrderEmailItem[];
  trackingUrl?: string;
  courierName?: string;
  trackingNumber?: string;
  /** Order.orgId — tenant brand for wrapper; platform auth emails stay FECSYNC. */
  orgId?: string | null;
}) {
  const firstName = customerName ? customerName.trim().split(/\s+/)[0] : "Customer";
  const shortOrderId = orderId.slice(-8);
  const brand = await resolveEmailBrand(orgId);

  const statusCopy: Record<
    string,
    { title: string; body: string }
  > = {
    pending: {
      title: "Your order is pending",
      body: "We have received your order and it is currently pending confirmation.",
    },
    initiated: {
      title: "Your order payment is being processed",
      body: "Your payment flow has started and we will confirm once payment is completed.",
    },
    paid: {
      title: "Your order is confirmed",
      body: "Payment was received successfully and your order is now confirmed.",
    },
    shipping: {
      title: "Your shipping label is ready",
      body: "Your order is with the courier. We will notify you again as it moves.",
    },
    shipped: {
      title: "Your order has been shipped",
      body: "Great news! Your order is on the way with the courier.",
    },
    delivered: {
      title: "Your order has been delivered",
      body: "Your order was marked as delivered. We hope you love your purchase.",
    },
    cancelled: {
      title: "Your order has been cancelled",
      body: "Your order was cancelled. If this was unexpected, please contact support.",
    },
  };

  const copy = statusCopy[status] ?? {
    title: "Your order status was updated",
    body: "There is a new update on your order. Please check your account for details.",
  };

  const itemRows = buildOrderItemsHtml(items);
  const courierLine = (() => {
    const name = courierName?.trim();
    if (!name) return "";
    const safe = name.replace(/[<>&"]/g, "");
    return `<p style="margin: 0;"><strong>Courier:</strong> ${safe}</p>`;
  })();
  const trackingNumberLine = (() => {
    const num = trackingNumber?.trim();
    if (!num) return "";
    const safe = num.replace(/[<>&"]/g, "").slice(0, 128);
    return `<p style="margin: 0;"><strong>Tracking number:</strong> ${safe}</p>`;
  })();
  const trackingBlock = (() => {
    const raw = trackingUrl?.trim();
    if (!raw) return "";
    try {
      const u = new URL(raw);
      if (u.protocol !== "http:" && u.protocol !== "https:") return "";
      return `<p><a href="${u.toString()}">Track your shipment</a></p>`;
    } catch {
      return "";
    }
  })();

  const content = `
    <h1>${copy.title}</h1>
    <p>Hi ${firstName},</p>
    <p>${copy.body}</p>
    <div class="success-box">
      <p style="margin: 0;"><strong>Order ID:</strong> #${shortOrderId}</p>
      <p style="margin: 0;"><strong>Current Status:</strong> ${status.charAt(0).toUpperCase() + status.slice(1)}</p>
      ${courierLine}
      ${trackingNumberLine}
    </div>
    ${trackingBlock}
    ${itemRows}
    <p>Thank you for shopping with ${escapeHtml(brand?.displayName?.trim() || "Company")}.</p>
  `;
  await sendMailWithFallback({
    to,
    subject: `Order #${shortOrderId} update: ${status}`,
    html: wrapEmailHtml(
      content,
      `Order ${status} - ${brand?.displayName?.trim() || "Company"}`,
      brand
    ),
    fromDisplayName: brand?.displayName,
    replyTo: brandSmtpReplyTo(brand),
  });
}

/** Pay reminder after tailor sends a quote. */
export async function sendTailoringJobSubmittedEmail({
  to,
  tailorName,
  jobId,
  title,
  customerName,
  jobsUrl,
  orgId,
}: {
  to: string;
  tailorName?: string;
  jobId: string;
  title: string;
  customerName?: string;
  jobsUrl?: string;
  orgId?: string | null;
}) {
  const shortId = jobId.slice(-8);
  const who = customerName?.trim() || "A customer";
  const brand = await resolveEmailBrand(orgId);
  const displayName = brand?.displayName?.trim() || "FECSYNC";
  const content = `
    <h1>New tailoring request</h1>
    <p>Hi ${tailorName ? tailorName.trim().split(/\s+/)[0] : "there"},</p>
    <p><strong>${who}</strong> submitted a new request: <strong>${title}</strong>.</p>
    <div class="success-box">
      <p style="margin: 0;"><strong>Job:</strong> #${shortId}</p>
    </div>
    ${
      jobsUrl
        ? `<p><a href="${jobsUrl}" style="display:inline-block;padding:12px 20px;background:#D4AF37;color:#111;text-decoration:none;border-radius:8px;font-weight:600;">View jobs</a></p>`
        : "<p>Open your tailor workspace to review and respond.</p>"
    }
  `;

  await sendMailWithFallback({
    to,
    subject: `New request: ${title} (#${shortId})`,
    html: wrapEmailHtml(content, `New tailoring request - ${displayName}`, brand),
    fromDisplayName: displayName,
    replyTo: brandSmtpReplyTo(brand),
  });
}

/** Pay reminder after tailor sends a quote. */
export async function sendTailoringQuoteEmail({
  to,
  customerName,
  jobId,
  title,
  quotedPrice,
  currency,
  taxAmount,
  amount,
  tailorName,
  payUrl,
  orgId,
}: {
  to: string;
  customerName?: string;
  jobId: string;
  title: string;
  quotedPrice: number;
  currency?: string;
  taxAmount?: number;
  amount?: number;
  tailorName?: string;
  payUrl?: string;
  orgId?: string | null;
}) {
  const firstName = customerName
    ? customerName.trim().split(/\s+/)[0]
    : "Customer";
  const shortId = jobId.slice(-8);
  const cur = (currency || "NGN").toUpperCase();
  const brand = await resolveEmailBrand(orgId);
  const displayName = brand?.displayName?.trim() || "FECSYNC";
  const total =
    typeof amount === "number" && amount > 0 ? amount : quotedPrice;
  const taxLine =
    typeof taxAmount === "number" && taxAmount > 0
      ? `<p style="margin: 0;"><strong>Tax:</strong> ${cur} ${taxAmount.toFixed(2)}</p>`
      : "";

  const content = `
    <h1>Your tailor sent a quote</h1>
    <p>Hi ${firstName},</p>
    <p>${
      tailorName
        ? `<strong>${tailorName}</strong> quoted your request`
        : "Your tailor quoted your request"
    } <strong>${title}</strong>.</p>
    <div class="success-box">
      <p style="margin: 0;"><strong>Job:</strong> #${shortId}</p>
      <p style="margin: 0;"><strong>Quote:</strong> ${cur} ${quotedPrice.toFixed(2)}</p>
      ${taxLine}
      <p style="margin: 0;"><strong>Total due:</strong> ${cur} ${total.toFixed(2)}</p>
    </div>
    ${
      payUrl
        ? `<p><a href="${payUrl}" style="display:inline-block;padding:12px 20px;background:#D4AF37;color:#111;text-decoration:none;border-radius:8px;font-weight:600;">Pay now</a></p>`
        : "<p>Open your tailoring jobs in your profile to pay securely.</p>"
    }
    <p>Thank you for choosing ${displayName} Find a Tailor.</p>
  `;

  await sendMailWithFallback({
    to,
    subject: `Quote ready for ${title} (#${shortId})`,
    html: wrapEmailHtml(content, `Tailoring quote - ${displayName}`, brand),
    fromDisplayName: displayName,
    replyTo: brandSmtpReplyTo(brand),
  });
}

export async function sendTailoringJobStatusEmail({
  to,
  customerName,
  jobId,
  title,
  status,
  note,
  amount,
  currency,
  orgId,
}: {
  to: string;
  customerName?: string;
  jobId: string;
  title: string;
  status: string;
  note?: string;
  amount?: number;
  currency?: string;
  orgId?: string | null;
}) {
  const firstName = customerName
    ? customerName.trim().split(/\s+/)[0]
    : "Customer";
  const shortId = jobId.slice(-8);
  const cur = (currency || "NGN").toUpperCase();
  const brand = await resolveEmailBrand(orgId);
  const displayName = brand?.displayName?.trim() || "FECSYNC";

  const copy: Record<string, { title: string; body: string }> = {
    submitted: {
      title: "We received your tailoring request",
      body: "Your request was submitted successfully. The tailor will review it and follow up soon.",
    },
    accepted: {
      title: "Your tailor accepted your request",
      body: "Good news — your tailor accepted this request and will continue with next steps.",
    },
    quoted: {
      title: "Your tailor sent a quote",
      body: "A quote is ready. Pay securely from your profile to start work.",
    },
    paid: {
      title: "Payment received",
      body: "Thanks — your payment was received and work can begin.",
    },
    completed: {
      title: "Your job is complete",
      body: "Your tailor marked this job completed. You can leave a review on their profile.",
    },
    cancelled: {
      title: "Your tailoring job was cancelled",
      body: "This job was cancelled. If that was unexpected, contact support.",
    },
  };

  const selected = copy[status] ?? {
    title: "Tailoring job update",
    body: "There is a new update on your tailoring job.",
  };

  const amountLine =
    typeof amount === "number"
      ? `<p style="margin: 0;"><strong>Amount:</strong> ${cur} ${amount.toFixed(2)}</p>`
      : "";

  const content = `
    <h1>${selected.title}</h1>
    <p>Hi ${firstName},</p>
    <p>${selected.body}</p>
    <div class="success-box">
      <p style="margin: 0;"><strong>Job:</strong> ${title} (#${shortId})</p>
      <p style="margin: 0;"><strong>Status:</strong> ${status.replace(/_/g, " ")}</p>
      ${amountLine}
      ${note ? `<p style="margin: 0;"><strong>Note:</strong> ${note}</p>` : ""}
    </div>
    <p>Thank you for choosing ${displayName}.</p>
  `;

  await sendMailWithFallback({
    to,
    subject: `Tailoring #${shortId}: ${status.replace(/_/g, " ")}`,
    html: wrapEmailHtml(content, `Tailoring ${status} - ${displayName}`, brand),
    fromDisplayName: displayName,
    replyTo: brandSmtpReplyTo(brand),
  });
}

async function sendTailorPaidEmail({
  to,
  tailorName,
  jobId,
  title,
  amount,
  currency,
  customerName,
  orgId,
}: {
  to: string;
  tailorName?: string;
  jobId: string;
  title: string;
  amount?: number;
  currency?: string;
  customerName?: string;
  orgId?: string | null;
}) {
  const firstName = tailorName
    ? tailorName.trim().split(/\s+/)[0]
    : "Tailor";
  const shortId = jobId.slice(-8);
  const cur = (currency || "NGN").toUpperCase();
  const brand = await resolveEmailBrand(orgId);
  const displayName = brand?.displayName?.trim() || "FECSYNC";
  const amountLine =
    typeof amount === "number"
      ? `<p style="margin: 0;"><strong>Paid:</strong> ${cur} ${amount.toFixed(2)}</p>`
      : "";

  const content = `
    <h1>Customer payment received</h1>
    <p>Hi ${firstName},</p>
    <p>${
      customerName
        ? `<strong>${customerName}</strong> paid for`
        : "A customer paid for"
    } <strong>${title}</strong>. You can start work from your dashboard.</p>
    <div class="success-box">
      <p style="margin: 0;"><strong>Job:</strong> #${shortId}</p>
      ${amountLine}
    </div>
  `;

  await sendMailWithFallback({
    to,
    subject: `Paid: ${title} (#${shortId})`,
    html: wrapEmailHtml(content, `Tailoring paid - ${displayName}`, brand),
    fromDisplayName: displayName,
    replyTo: brandSmtpReplyTo(brand),
  });
}

/** Notify customer + tailor after tailoring payment settles. */
export async function notifyTailoringJobPaid({
  customerEmail,
  customerName,
  tailorEmail,
  tailorName,
  jobId,
  title,
  amount,
  subtotal,
  taxAmount,
  taxLabel,
  currency,
  orgId,
}: {
  customerEmail: string;
  customerName?: string;
  tailorEmail?: string;
  tailorName?: string;
  jobId: string;
  title: string;
  amount?: number;
  subtotal?: number;
  taxAmount?: number;
  taxLabel?: string;
  currency?: string;
  orgId?: string | null;
}) {
  const tasks: Promise<unknown>[] = [
    sendTailoringJobStatusEmail({
      to: customerEmail,
      customerName,
      jobId,
      title,
      status: "paid",
      amount,
      currency,
      orgId,
      note:
        typeof taxAmount === "number" && taxAmount > 0
          ? `${taxLabel || "Tax"}: ${taxAmount.toFixed(2)}${
              typeof subtotal === "number"
                ? ` (quote ${subtotal.toFixed(2)})`
                : ""
            }`
          : undefined,
    }),
  ];

  if (tailorEmail) {
    tasks.push(
      sendTailorPaidEmail({
        to: tailorEmail,
        tailorName,
        jobId,
        title,
        amount,
        currency,
        customerName,
        orgId,
      })
    );
  }

  const results = await Promise.allSettled(tasks);
  for (const r of results) {
    if (r.status === "rejected") {
      console.error("Tailoring paid email failed:", r.reason);
    }
  }
}

/** Invite someone to submit measurements for a tailor campaign. */
export async function sendCampaignInviteEmail(input: {
  to: string;
  fullName?: string;
  campaignName: string;
  tailorName?: string;
  joinUrl: string;
  expiresAt?: string;
  orgId?: string | null;
}) {
  const firstName = input.fullName?.trim().split(/\s+/)[0] || "there";
  const campaign = escapeHtml(input.campaignName);
  const tailor = input.tailorName
    ? escapeHtml(input.tailorName)
    : "your tailor";
  const brand = await resolveEmailBrand(input.orgId);
  const displayName = brand?.displayName?.trim() || "FECSYNC";
  const expiryLine = input.expiresAt
    ? `<p><strong>Invitation expires:</strong> ${escapeHtml(
        new Date(input.expiresAt).toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      )}</p>`
    : "";

  const content = `
    <h1>You're invited to ${campaign}</h1>
    <p>Hi ${escapeHtml(firstName)},</p>
    <p><strong>${tailor}</strong> invited you to submit your measurements for <strong>${campaign}</strong> on ${escapeHtml(displayName)}.</p>
    ${expiryLine}
    <div style="text-align: center; margin: 32px 0;">
      <a href="${input.joinUrl}" class="button">Join campaign</a>
    </div>
    <p style="margin-top: 24px; color: #6b7280; font-size: 14px;">
      If you were not expecting this invitation, you can ignore this email.
    </p>
  `;

  await sendMailWithFallback({
    to: input.to,
    subject: `Invitation: ${input.campaignName} — ${displayName}`,
    html: wrapEmailHtml(content, `Campaign invitation - ${displayName}`, brand),
    fromDisplayName: displayName,
    replyTo: brandSmtpReplyTo(brand),
  });
}

/** Invite a member to join a campaign group via a coordinator. */
export async function sendCoordinatorMemberInviteEmail(input: {
  to: string;
  fullName?: string;
  coordinatorName: string;
  campaignName: string;
  tailorName?: string;
  joinUrl: string;
  expiresAt?: string;
  orgId?: string | null;
}) {
  const firstName = input.fullName?.trim().split(/\s+/)[0] || "there";
  const campaign = escapeHtml(input.campaignName);
  const coordinator = escapeHtml(input.coordinatorName);
  const tailor = input.tailorName
    ? escapeHtml(input.tailorName)
    : "your tailor";
  const brand = await resolveEmailBrand(input.orgId);
  const displayName = brand?.displayName?.trim() || "FECSYNC";
  const expiryLine = input.expiresAt
    ? `<p><strong>Invitation expires:</strong> ${escapeHtml(
        new Date(input.expiresAt).toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      )}</p>`
    : "";

  const content = `
    <h1>You're invited to ${campaign}</h1>
    <p>Hi ${escapeHtml(firstName)},</p>
    <p><strong>${coordinator}</strong> invited you to submit your measurements for <strong>${campaign}</strong> on ${escapeHtml(displayName)} (${tailor}).</p>
    ${expiryLine}
    <div style="text-align: center; margin: 32px 0;">
      <a href="${input.joinUrl}" class="button">Join campaign</a>
    </div>
    <p style="margin-top: 24px; color: #6b7280; font-size: 14px;">
      If you were not expecting this invitation, you can ignore this email.
    </p>
  `;

  await sendMailWithFallback({
    to: input.to,
    subject: `Group invitation: ${input.campaignName} — ${displayName}`,
    html: wrapEmailHtml(
      content,
      `Campaign group invitation - ${displayName}`,
      brand
    ),
    fromDisplayName: displayName,
    replyTo: brandSmtpReplyTo(brand),
  });
}

/** Nudge invitees who have not finished submitting measurements. */
export async function sendCampaignReminderEmail(input: {
  to: string;
  fullName?: string;
  campaignName: string;
  joinUrl: string;
  orgId?: string | null;
}) {
  const firstName = input.fullName?.trim().split(/\s+/)[0] || "there";
  const campaign = escapeHtml(input.campaignName);
  const brand = await resolveEmailBrand(input.orgId);
  const displayName = brand?.displayName?.trim() || "FECSYNC";

  const content = `
    <h1>Reminder: ${campaign}</h1>
    <p>Hi ${escapeHtml(firstName)},</p>
    <p>This is a friendly reminder to submit your measurements for <strong>${campaign}</strong> on ${escapeHtml(displayName)}.</p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="${input.joinUrl}" class="button">Continue on ${escapeHtml(displayName)}</a>
    </div>
  `;

  await sendMailWithFallback({
    to: input.to,
    subject: `Reminder: ${input.campaignName} — ${displayName}`,
    html: wrapEmailHtml(content, `Campaign reminder - ${displayName}`, brand),
    fromDisplayName: displayName,
    replyTo: brandSmtpReplyTo(brand),
  });
}

// ─── Company SaaS billing lifecycle (Step 3) ─────────────────────────────────

export async function sendCompanyRegisteredPendingEmail(input: {
  to: string;
  orgName: string;
  orgId: string;
  pendingUrl: string;
}) {
  const brand = await resolveEmailBrand(input.orgId);
  const orgLabel = escapeHtml(input.orgName);
  const content = `
    <h1>Workspace registered</h1>
    <p>Your company workspace <strong>${orgLabel}</strong> is registered and waiting for FECSYNC approval.</p>
    <p>You will unlock admin tools (venues, team, billing) after approval.</p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="${input.pendingUrl}" class="button">Check approval status</a>
    </div>
  `;
  await sendMailWithFallback({
    to: input.to,
    subject: `${input.orgName} — pending approval`,
    html: wrapEmailHtml(content, `Pending approval - ${input.orgName}`, brand),
    fromDisplayName: brand?.displayName?.trim() || "FECSYNC",
    replyTo: brandSmtpReplyTo(brand),
  });
}

export async function sendCompanyOpsPendingAlertEmail(input: {
  to: string;
  orgName: string;
  orgId: string;
  reviewUrl: string;
}) {
  const brand = await resolveEmailBrand(null);
  const content = `
    <h1>New company pending</h1>
    <p><strong>${escapeHtml(input.orgName)}</strong> registered a company workspace and awaits Approve.</p>
    <p style="color:#6b7280;font-size:14px;">Org id: ${escapeHtml(input.orgId)}</p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="${input.reviewUrl}" class="button">Open company workspaces</a>
    </div>
  `;
  await sendMailWithFallback({
    to: input.to,
    subject: `Pending company: ${input.orgName}`,
    html: wrapEmailHtml(content, "Company pending approval", brand),
    fromDisplayName: "FECSYNC",
    replyTo: brandSmtpReplyTo(brand),
  });
}

export async function sendCompanyOpsProvisionedEmail(input: {
  to: string;
  orgName: string;
  orgId: string;
  adminFullName?: string | null;
  loginEmail: string;
  /** Only included when ops just created the user account. */
  temporaryPassword?: string | null;
  createdAdminUser: boolean;
  planName?: string | null;
  termLabel?: string | null;
  signInUrl: string;
  adminUrl: string;
}) {
  const brand = await resolveEmailBrand(input.orgId);
  const orgLabel = escapeHtml(input.orgName);
  const greetName = escapeHtml(
    (input.adminFullName || "").trim() || "there"
  );
  const planBits = [input.planName?.trim(), input.termLabel?.trim()]
    .filter(Boolean)
    .join(" · ");
  const packageLine = planBits
    ? `<p><strong>Your package:</strong> ${escapeHtml(planBits)}</p>`
    : "";
  const passwordBlock = input.createdAdminUser
    ? input.temporaryPassword
      ? `<p><strong>Temporary password:</strong> <code style="font-size:14px;background:#f5f5f4;padding:4px 8px;border-radius:4px;">${escapeHtml(
          input.temporaryPassword
        )}</code></p>
    <p style="font-size:13px;color:#57534e;">Sign in, then change this password from your profile when you can.</p>`
      : `<p>Your admin account was created — use the password set by FECSYNC ops, then change it after sign-in.</p>`
    : `<p>Use your existing FECSYNC password for this email. If you forgot it, use Forgot password on the sign-in page.</p>`;

  const content = `
    <h1>Congratulations — your workspace is approved</h1>
    <p>Hi ${greetName},</p>
    <p><strong>${orgLabel}</strong> is live on FECSYNC. Your company admin seat is ready.</p>
    ${packageLine}
    <p><strong>Sign-in email:</strong> ${escapeHtml(input.loginEmail)}</p>
    ${passwordBlock}
    <div style="text-align: center; margin: 32px 0;">
      <a href="${input.signInUrl}" class="button">Sign in to your dashboard</a>
    </div>
    <p style="text-align:center;font-size:13px;color:#57534e;">
      After sign-in you land on <a href="${input.adminUrl}">Company Admin</a>. Your package is already assigned — you do not need to subscribe again in Billing.
    </p>
  `;
  await sendMailWithFallback({
    to: input.to,
    subject: `${input.orgName} — approved · login details inside`,
    html: wrapEmailHtml(content, `Approved - ${input.orgName}`, brand),
    fromDisplayName: brand?.displayName?.trim() || "FECSYNC",
    replyTo: brandSmtpReplyTo(brand),
  });
}

export async function sendCompanyApprovedEmail(input: {
  to: string;
  orgName: string;
  orgId: string;
  billingUrl: string;
  profileUrl: string;
  /** Company admin dashboard (preferred CTA when plan is already stamped). */
  adminUrl?: string | null;
  /** Optional package name (e.g. Starter). */
  planName?: string | null;
  /** Optional term label (e.g. 1 year). */
  termLabel?: string | null;
  /** Optional term total in major currency units. */
  termTotalMajor?: number | null;
  currency?: string | null;
  /** When true, copy is payment-activated (not ops Approve). */
  selfServePayment?: boolean;
  /** Ops already stamped a plan — do not ask them to subscribe again. */
  planAlreadyActive?: boolean;
}) {
  const brand = await resolveEmailBrand(input.orgId);
  const orgLabel = escapeHtml(input.orgName);
  const planLine =
    input.planName?.trim() ||
    input.termLabel?.trim() ||
    input.termTotalMajor != null
      ? `<p><strong>Package:</strong> ${escapeHtml(
          [
            input.planName?.trim(),
            input.termLabel?.trim(),
            input.termTotalMajor != null
              ? `$${input.termTotalMajor}${
                  input.currency?.trim()
                    ? ` ${input.currency.trim().toUpperCase()}`
                    : " USD"
                } per term`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")
        )}</p>`
      : "";
  const selfServe = input.selfServePayment === true;
  const planActive = input.planAlreadyActive === true && !selfServe;
  const dashboardUrl =
    (typeof input.adminUrl === "string" && input.adminUrl.trim()) ||
    input.billingUrl.replace(/\/admin\/billing\/?$/, "/admin");
  const content = selfServe
    ? `
    <h1>Payment received — workspace active</h1>
    <p><strong>${orgLabel}</strong> is active after successful Checkout.</p>
    ${planLine}
    <p>Sign in to open your company dashboard. Complete your company profile for branded invoices and receipts.</p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="${dashboardUrl}" class="button">Open dashboard</a>
    </div>
    <p style="text-align:center;"><a href="${input.profileUrl}">Company profile</a></p>
  `
    : planActive
      ? `
    <h1>Workspace ready</h1>
    <p><strong>${orgLabel}</strong> is active. Your package is already set — you do not need to subscribe again in Billing.</p>
    ${planLine}
    <p>Sign in to open your company dashboard. Complete your company profile for branded invoices and receipts. Use Billing later only if you want to change packages.</p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="${dashboardUrl}" class="button">Open dashboard</a>
    </div>
    <p style="text-align:center;"><a href="${input.profileUrl}">Company profile</a> · <a href="${input.billingUrl}">Billing</a></p>
  `
      : `
    <h1>Workspace approved</h1>
    <p><strong>${orgLabel}</strong> is active. Complete your company profile and choose a billing package to unlock venues, team seats, and catalog tools.</p>
    ${planLine}
    <div style="text-align: center; margin: 32px 0;">
      <a href="${input.billingUrl}" class="button">Open Billing</a>
    </div>
    <p style="text-align:center;"><a href="${input.profileUrl}">Company profile</a></p>
  `;
  await sendMailWithFallback({
    to: input.to,
    subject: selfServe
      ? `${input.orgName} — payment received, workspace active`
      : planActive
        ? `${input.orgName} — workspace ready`
        : `${input.orgName} — workspace approved`,
    html: wrapEmailHtml(
      content,
      selfServe
        ? `Payment received - ${input.orgName}`
        : planActive
          ? `Ready - ${input.orgName}`
          : `Approved - ${input.orgName}`,
      brand
    ),
    fromDisplayName: brand?.displayName?.trim() || input.orgName,
    replyTo: brandSmtpReplyTo(brand),
  });
}

export async function sendCompanySuspendedEmail(input: {
  to: string;
  orgName: string;
  orgId: string;
  reason?: string | null;
  pendingUrl: string;
}) {
  const brand = await resolveEmailBrand(input.orgId);
  const reasonLine = input.reason
    ? `<p><strong>Reason:</strong> ${escapeHtml(input.reason)}</p>`
    : "";
  const content = `
    <h1>Workspace suspended</h1>
    <p>Operational access for <strong>${escapeHtml(input.orgName)}</strong> is on hold. Your company records were kept and will appear as before once the hold is removed. Public FECSYNC shop is unaffected.</p>
    ${reasonLine}
    <p>Contact the developers or IT team for further help on how to unlock the suspension.</p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="${input.pendingUrl}" class="button">View status</a>
    </div>
  `;
  await sendMailWithFallback({
    to: input.to,
    subject: `${input.orgName} — workspace suspended`,
    html: wrapEmailHtml(content, `Suspended - ${input.orgName}`, brand),
    fromDisplayName: brand?.displayName?.trim() || "FECSYNC",
    replyTo: brandSmtpReplyTo(brand),
  });
}

export async function sendCompanyPastDueEmail(input: {
  to: string;
  orgName: string;
  orgId: string;
  billingUrl: string;
  /** Soft-hold: Checkout locked — CTA is company-pending, not Billing. */
  softHold?: boolean;
}) {
  const brand = await resolveEmailBrand(input.orgId);
  const softHold = input.softHold === true;
  const content = softHold
    ? `
    <h1>Billing hold</h1>
    <p>Billing for <strong>${escapeHtml(input.orgName)}</strong> is on soft-hold (past-due or overdue period). Open the company waiting room to renew payment — self-serve renew stays available. Ops Approve is only required for a manual ops hold.</p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="${input.billingUrl}" class="button">Open waiting room</a>
    </div>
  `
    : `
    <h1>Payment past due</h1>
    <p>Billing for <strong>${escapeHtml(input.orgName)}</strong> is past due. Update payment soon to keep venues and team tools entitled.</p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="${input.billingUrl}" class="button">Fix billing</a>
    </div>
  `;
  await sendMailWithFallback({
    to: input.to,
    subject: softHold
      ? `${input.orgName} — billing hold`
      : `${input.orgName} — payment past due`,
    html: wrapEmailHtml(
      content,
      softHold ? `Billing hold - ${input.orgName}` : `Past due - ${input.orgName}`,
      brand
    ),
    fromDisplayName: brand?.displayName?.trim() || input.orgName,
    replyTo: brandSmtpReplyTo(brand),
  });
}

export async function sendCompanyExpiringSoonEmail(input: {
  to: string;
  orgName: string;
  orgId: string;
  daysLeft: number;
  endsAt: Date;
  billingUrl: string;
  opsGrant?: boolean;
}) {
  const brand = await resolveEmailBrand(input.orgId);
  const when = input.endsAt.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const kind = input.opsGrant ? "Ops grant" : "Subscription";
  const content = `
    <h1>${escapeHtml(kind)} ending soon</h1>
    <p><strong>${escapeHtml(input.orgName)}</strong> — ${escapeHtml(kind).toLowerCase()} ends in <strong>${input.daysLeft}</strong> day(s) (${escapeHtml(when)}).</p>
    <p>${input.opsGrant ? "Complete Checkout in Billing to keep your workspace entitled." : "Review Billing to renew or update payment."}</p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="${input.billingUrl}" class="button">Open Billing</a>
    </div>
  `;
  await sendMailWithFallback({
    to: input.to,
    subject: `${input.orgName} — ${kind.toLowerCase()} ends in ${input.daysLeft}d`,
    html: wrapEmailHtml(content, `${kind} reminder - ${input.orgName}`, brand),
    fromDisplayName: brand?.displayName?.trim() || input.orgName,
    replyTo: brandSmtpReplyTo(brand),
  });
}

export async function sendCompanyExpiredEmail(input: {
  to: string;
  orgName: string;
  orgId: string;
  pendingUrl: string;
}) {
  const brand = await resolveEmailBrand(input.orgId);
  const content = `
    <h1>Subscription ended — moved to Demo</h1>
    <p>The paid subscription for <strong>${escapeHtml(input.orgName)}</strong> has ended.</p>
    <p>Your workspace was moved to the <strong>Demo</strong> package so you can still open Billing and Company profile. <strong>None of your company records were deleted</strong> — venues, catalog, orders, team history, and transactions stay intact.</p>
    <p>Renew Starter, Growth, or Enterprise in Billing to restore full access and continue where you left off.</p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="${input.pendingUrl}" class="button">Open Billing</a>
    </div>
  `;
  await sendMailWithFallback({
    to: input.to,
    subject: `${input.orgName} — moved to Demo (records kept)`,
    html: wrapEmailHtml(content, `Demo demotion - ${input.orgName}`, brand),
    fromDisplayName: brand?.displayName?.trim() || "FECSYNC",
    replyTo: brandSmtpReplyTo(brand),
  });
}

/** Guest special request from public booking — notify company ops email. */
export async function sendBookingSpecialRequestEmail(input: {
  to: string;
  orgName: string;
  orgId: string;
  venueName: string;
  publicId: string;
  guestName: string;
  guestEmail: string;
  guestPhone: string | null;
  productName: string | null;
  preferredDate: string | null;
  qty: number | null;
  message: string;
  dashboardUrl: string;
}) {
  const brand = await resolveEmailBrand(input.orgId);
  const content = `
    <h1>Guest special request</h1>
    <p>A guest on <strong>${escapeHtml(input.venueName)}</strong> sent a special request for <strong>${escapeHtml(input.orgName)}</strong>.</p>
    <div class="success-box">
      <p style="margin:0;"><strong>Reference:</strong> ${escapeHtml(input.publicId)}</p>
      <p style="margin:8px 0 0;"><strong>Guest:</strong> ${escapeHtml(input.guestName)} &lt;${escapeHtml(input.guestEmail)}&gt;</p>
      ${input.guestPhone ? `<p style="margin:8px 0 0;"><strong>Phone:</strong> ${escapeHtml(input.guestPhone)}</p>` : ""}
      ${input.productName ? `<p style="margin:8px 0 0;"><strong>Package:</strong> ${escapeHtml(input.productName)}</p>` : ""}
      ${input.preferredDate ? `<p style="margin:8px 0 0;"><strong>Preferred date:</strong> ${escapeHtml(input.preferredDate)}</p>` : ""}
      ${input.qty != null ? `<p style="margin:8px 0 0;"><strong>Party size:</strong> ${input.qty}</p>` : ""}
    </div>
    <p style="margin-top:16px;white-space:pre-wrap;">${escapeHtml(input.message)}</p>
    <div style="text-align:center;margin:32px 0;">
      <a href="${input.dashboardUrl}" class="button">Open in dashboard</a>
    </div>
    <p style="font-size:13px;color:#666;">Reply to the guest at ${escapeHtml(input.guestEmail)} to continue the conversation.</p>
  `;
  await sendMailWithFallback({
    to: input.to,
    subject: `${input.orgName} — special request ${input.publicId}`,
    html: wrapEmailHtml(
      content,
      `Special request - ${input.orgName}`,
      brand
    ),
    fromDisplayName: brand?.displayName?.trim() || input.orgName,
    replyTo: input.guestEmail,
  });
}

function waiverMailConfigured(): boolean {
  return Boolean(
    process.env.NOTIFICATION_EMAIL_USER?.trim() ||
      process.env.TEAM_EMAIL_USER?.trim()
  );
}

/** Org-branded HTML mail. Returns false when SMTP is not configured or both transports fail. */
export async function sendWaiverGuestEmail(input: {
  orgId: string;
  to: string;
  subject: string;
  htmlBody: string;
}): Promise<boolean> {
  return sendBrandedGuestEmail(input, "Waiver");
}

export function guestMailConfigured(): boolean {
  return waiverMailConfigured();
}

/** Org-branded transactional guest mail (waivers, parties). Never throws. */
export async function sendBrandedGuestEmail(
  input: {
    orgId: string;
    to: string;
    subject: string;
    htmlBody: string;
  },
  label = "Guest"
): Promise<boolean> {
  if (!waiverMailConfigured()) return false;
  const brand = await resolveEmailBrand(input.orgId);
  const send = sendMailWithFallback({
    to: input.to,
    subject: input.subject,
    html: wrapEmailHtml(input.htmlBody, input.subject, brand),
    fromDisplayName: brand?.displayName,
    replyTo: brandSmtpReplyTo(brand),
  });
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("Email send timed out")), 8000);
  });
  try {
    await Promise.race([send, timeout]);
    return true;
  } catch (err) {
    console.error(`${label} email failed:`, err instanceof Error ? err.message : "send failed");
    return false;
  }
}

/** Full branded HTML exactly as `sendMarketingGuestEmail` would deliver it (admin preview). */
export async function renderMarketingGuestEmailPreview(input: {
  orgId: string;
  subject: string;
  htmlBody: string;
}): Promise<string> {
  const brand = await resolveEmailBrand(input.orgId);
  return wrapEmailHtml(input.htmlBody, input.subject, brand);
}

export function marketingMailConfigured(): boolean {
  return waiverMailConfigured();
}

/** Promotional / survey guest mail — same transport as waivers; distinct from auth sendWelcomeEmail. */
export async function sendMarketingGuestEmail(input: {
  orgId: string;
  to: string;
  subject: string;
  htmlBody: string;
  replyTo?: string | null;
  /** Overrides the company display name in the SMTP From header. */
  fromName?: string | null;
  /** Adds RFC 8058 one-click List-Unsubscribe headers (endpoint must accept POST). */
  listUnsubscribeUrl?: string | null;
}): Promise<boolean> {
  if (!waiverMailConfigured()) return false;
  const brand = await resolveEmailBrand(input.orgId);
  const unsubscribe = input.listUnsubscribeUrl?.trim();
  const send = sendMailWithFallback({
    to: input.to,
    subject: input.subject,
    html: wrapEmailHtml(input.htmlBody, input.subject, brand),
    fromDisplayName: input.fromName?.trim() || brand?.displayName,
    replyTo: input.replyTo?.trim() || brandSmtpReplyTo(brand),
    ...(unsubscribe
      ? {
          headers: {
            "List-Unsubscribe": `<${unsubscribe}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }
      : {}),
  });
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("Email send timed out")), 8000);
  });
  try {
    await Promise.race([send, timeout]);
    return true;
  } catch (err) {
    console.error(
      "Marketing guest email failed:",
      err instanceof Error ? err.message : "send failed"
    );
    return false;
  }
}

