/**
 * Lightweight HTML rich-text helpers for MembershipPlan merchandising fields
 * (cancellation terms, instructions, terms & conditions, …).
 * Shared by admin editor + write path + guest render.
 */

/** Cancellation terms — short checkout copy. */
export const CANCELLATION_TERMS_PLAIN_MAX = 500;
export const CANCELLATION_TERMS_HTML_MAX = 2000;

/** Instructions — confirmation / profile guidance (matches prior 4000 column budget). */
export const INSTRUCTIONS_PLAIN_MAX = 2000;
export const INSTRUCTIONS_HTML_MAX = 4000;

/** Plan terms & conditions — membership agreement body (matches prior 8000 column budget). */
export const TERMS_AND_CONDITIONS_PLAIN_MAX = 4000;
export const TERMS_AND_CONDITIONS_HTML_MAX = 8000;

const ALLOWED = new Set([
  'p',
  'br',
  'strong',
  'em',
  'b',
  'i',
  'u',
  'ul',
  'ol',
  'li',
  'a',
]);

function safeHref(raw: string): string | null {
  const url = raw.trim();
  if (
    /^https:\/\//i.test(url) ||
    /^http:\/\//i.test(url) ||
    /^mailto:/i.test(url)
  ) {
    if (/javascript:/i.test(url) || /data:/i.test(url)) return null;
    return url.replace(/"/g, '');
  }
  return null;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Allowlist sanitizer (no DOMPurify dep). Drops scripts, handlers, unsafe links.
 * Safe on server and client.
 */
export function sanitizeMembershipHtml(input: string): string {
  let html = String(input ?? '');
  html = html.replace(
    /<\s*(script|style|iframe|object|embed|link|meta|svg|math)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,
    ''
  );
  html = html.replace(
    /<\s*(script|style|iframe|object|embed|link|meta|svg|math)[^>]*\/?>/gi,
    ''
  );
  html = html.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  html = html.replace(/javascript\s*:/gi, '');

  html = html.replace(
    /<\/?([a-z0-9]+)([^>]*)>/gi,
    (full, tag: string, attrs: string) => {
      const t = tag.toLowerCase();
      if (!ALLOWED.has(t)) return '';
      const closing = full.startsWith('</');
      if (t === 'br') return '<br>';
      if (closing) return `</${t}>`;
      if (t === 'a') {
        const href = /href\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
        const url = safeHref(href?.[2] || href?.[3] || '');
        return url
          ? `<a href="${url}" rel="noopener noreferrer" target="_blank">`
          : '<a>';
      }
      return `<${t}>`;
    }
  );

  return html.trim();
}

/** Strip tags for counters, emails, and legacy plain consumers. */
export function htmlToPlainText(html: string): string {
  const raw = String(html ?? '');
  if (!raw.trim()) return '';
  return raw
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*p\s*>/gi, '\n')
    .replace(/<\/\s*li\s*>/gi, '\n')
    .replace(/<\/\s*div\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function isEmptyMembershipHtml(html: string | null | undefined): boolean {
  return !htmlToPlainText(html ?? '').trim();
}

/**
 * Load DB value into the editor: sanitize HTML, or wrap legacy plain text.
 */
export function toMembershipRichTextEditorHtml(
  raw: string | null | undefined
): string {
  const s = (raw ?? '').trim();
  if (!s) return '';
  if (/<[a-z][\s\S]*>/i.test(s)) {
    return sanitizeMembershipHtml(s);
  }
  const paragraphs = s
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`);
  return sanitizeMembershipHtml(
    paragraphs.join('') || `<p>${escapeHtml(s)}</p>`
  );
}

/** @deprecated Prefer toMembershipRichTextEditorHtml */
export const toCancellationTermsEditorHtml = toMembershipRichTextEditorHtml;

/**
 * Write-path: sanitize, enforce plain + HTML budgets, null when empty.
 */
export function sanitizeMembershipRichTextForWrite(
  raw: unknown,
  opts: {
    field: string;
    plainMax: number;
    htmlMax: number;
  }
): string | null {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string') {
    throw new Error(`${opts.field} must be a string`);
  }
  const html = sanitizeMembershipHtml(raw);
  if (isEmptyMembershipHtml(html)) return null;
  const plain = htmlToPlainText(html);
  if (plain.length > opts.plainMax) {
    throw new Error(
      `${opts.field} text must be at most ${opts.plainMax} characters`
    );
  }
  if (html.length > opts.htmlMax) {
    throw new Error(
      `${opts.field} HTML must be at most ${opts.htmlMax} characters`
    );
  }
  return html;
}

export function sanitizeCancellationTermsForWrite(
  raw: unknown
): string | null {
  return sanitizeMembershipRichTextForWrite(raw, {
    field: 'cancellationTerms',
    plainMax: CANCELLATION_TERMS_PLAIN_MAX,
    htmlMax: CANCELLATION_TERMS_HTML_MAX,
  });
}

export function sanitizeInstructionsForWrite(raw: unknown): string | null {
  return sanitizeMembershipRichTextForWrite(raw, {
    field: 'instructions',
    plainMax: INSTRUCTIONS_PLAIN_MAX,
    htmlMax: INSTRUCTIONS_HTML_MAX,
  });
}

export function sanitizeTermsAndConditionsForWrite(
  raw: unknown
): string | null {
  return sanitizeMembershipRichTextForWrite(raw, {
    field: 'termsAndConditions',
    plainMax: TERMS_AND_CONDITIONS_PLAIN_MAX,
    htmlMax: TERMS_AND_CONDITIONS_HTML_MAX,
  });
}
