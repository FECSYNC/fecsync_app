/**
 * Browser-only: the origin of the page framing a company embed. Sent with embed
 * checkout so the server can check it against the company's allowed origins.
 * ancestorOrigins where supported; otherwise the first-load referrer, kept for the
 * frame session because in-frame navigation replaces the referrer.
 */
const STORAGE_KEY = "company-embed-parent-origin";

function referrerOrigin(): string | null {
  try {
    return document.referrer ? new URL(document.referrer).origin : null;
  } catch {
    return null;
  }
}

export function embedParentOrigin(): string | null {
  if (typeof window === "undefined") return null;
  if (window.parent === window) return window.location.origin;
  const ancestors = window.location.ancestorOrigins;
  if (ancestors && ancestors.length > 0) return ancestors[0];
  const referrer = referrerOrigin();
  // After in-frame navigation the referrer is this app, which says nothing about the parent.
  const fromReferrer = referrer && referrer !== window.location.origin ? referrer : null;
  let stored: string | null = null;
  try {
    stored = window.sessionStorage.getItem(STORAGE_KEY);
    if (fromReferrer) {
      window.sessionStorage.setItem(STORAGE_KEY, fromReferrer);
      return fromReferrer;
    }
  } catch {
    /* storage blocked in third-party frames — fall back to the referrer */
  }
  return fromReferrer || stored;
}
