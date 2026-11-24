/**
 * Server-side allowlist for waiver agreement HTML.
 * Drops scripts, event handlers, and non-http(s)/mailto links.
 */

const ALLOWED = new Set([
  "p",
  "br",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "a",
  "blockquote",
  "span",
  "div",
]);

function safeHref(raw: string): string | null {
  const url = raw.trim();
  if (/^https:\/\//i.test(url) || /^http:\/\//i.test(url) || /^mailto:/i.test(url)) {
    if (/javascript:/i.test(url) || /data:/i.test(url)) return null;
    return url.replace(/"/g, "");
  }
  return null;
}

export function sanitizeWaiverHtml(input: string): string {
  let html = String(input ?? "");
  html = html.replace(
    /<\s*(script|style|iframe|object|embed|link|meta|svg|math)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,
    ""
  );
  html = html.replace(
    /<\s*(script|style|iframe|object|embed|link|meta|svg|math)[^>]*\/?>/gi,
    ""
  );
  html = html.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  html = html.replace(/javascript\s*:/gi, "");

  html = html.replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (full, tag: string, attrs: string) => {
    const t = tag.toLowerCase();
    if (!ALLOWED.has(t)) return "";
    const closing = full.startsWith("</");
    if (t === "br") return "<br>";
    if (closing) return `</${t}>`;
    if (t === "a") {
      const href = /href\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
      const url = safeHref(href?.[2] || href?.[3] || "");
      return url ? `<a href="${url}">` : "<a>";
    }
    return `<${t}>`;
  });

  return html.trim();
}
