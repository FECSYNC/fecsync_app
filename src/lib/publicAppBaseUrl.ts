/**
 * Canonical public origin for absolute links (Stripe return URLs, SMS, email).
 * Prefer APP_URL, then BASE_URL (shop/mailer), then NEXT_PUBLIC_URL, then NEXTAUTH_URL.
 */
export function configuredPublicAppBaseUrl(): string | null {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    "";
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}

export function publicAppBaseUrl(): string {
  return configuredPublicAppBaseUrl() ?? "http://localhost:3000";
}

/**
 * Origin for password-reset emails.
 * Production with no public URL configured returns null (caller should 503)
 * so links never become "undefined/reset-password" or localhost.
 */
export function publicResetLinkBaseUrl(): string | null {
  const configured = configuredPublicAppBaseUrl();
  if (configured) return configured;
  if (process.env.NODE_ENV !== "production") return "http://localhost:3000";
  return null;
}
