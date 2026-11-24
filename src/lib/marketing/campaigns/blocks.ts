import { escapeHtml } from "@/lib/marketing/templates";
import { publicAppBaseUrl } from "@/lib/publicAppBaseUrl";
import {
  CAMPAIGN_BLOCK_TYPES,
  newBlockId,
  type BlockAlign,
  type CampaignBlock,
  type CampaignBlockType,
} from "@/lib/marketing/campaigns/types";
import {
  richDocFromPlainText,
  richDocTextLength,
  sanitizeRichDoc,
  type RichMark,
  type RichNode,
} from "@/lib/marketing/campaigns/richText";

export const MAX_CAMPAIGN_BLOCKS = 40;
const MAX_TEXT = 5000;
const MAX_SHORT = 200;
const MAX_URL = 1000;

export type CampaignMergeVars = {
  guestFirstName: string;
  orgName: string;
  websiteUrl: string;
  bookUrl: string;
  monthName: string;
};

export type CampaignEventItem = {
  title: string;
  when: string;
  url: string;
};

export type CampaignRenderContext = {
  vars: CampaignMergeVars;
  events: CampaignEventItem[];
  preheader?: string | null;
  footer: {
    orgName: string;
    address: string | null;
    unsubscribeUrl: string;
  };
};

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function align(value: unknown, fallback: BlockAlign): BlockAlign {
  return value === "left" || value === "center" || value === "right" ? value : fallback;
}

/** Coerce untrusted JSON into known blocks; unknown types and junk are dropped. */
export function normalizeCampaignBlocks(raw: unknown): CampaignBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: CampaignBlock[] = [];
  for (const item of raw.slice(0, MAX_CAMPAIGN_BLOCKS)) {
    if (!item || typeof item !== "object") continue;
    const b = item as Record<string, unknown>;
    const type = b.type as CampaignBlockType;
    if (!CAMPAIGN_BLOCK_TYPES.includes(type)) continue;
    const id =
      typeof b.id === "string" && /^[\w-]{1,40}$/.test(b.id) ? b.id : newBlockId();
    switch (type) {
      case "heading":
        out.push({ id, type, text: str(b.text, MAX_SHORT), align: align(b.align, "left") });
        break;
      case "text":
        out.push({
          id,
          type,
          // Pre-rich-text blocks stored plain `text`; upgrade them transparently.
          doc:
            b.doc && typeof b.doc === "object"
              ? sanitizeRichDoc(b.doc)
              : richDocFromPlainText(str(b.text, MAX_TEXT)),
        });
        break;
      case "image":
        out.push({
          id,
          type,
          url: str(b.url, MAX_URL),
          alt: str(b.alt, MAX_SHORT),
          href: str(b.href, MAX_URL),
          align: align(b.align, "center"),
        });
        break;
      case "button":
        out.push({
          id,
          type,
          label: str(b.label, 80),
          url: str(b.url, MAX_URL),
          align: align(b.align, "center"),
          variant: b.variant === "outline" ? "outline" : "solid",
        });
        break;
      case "promo":
        out.push({
          id,
          type,
          title: str(b.title, MAX_SHORT),
          text: str(b.text, 1000),
          code: str(b.code, 60),
          url: str(b.url, MAX_URL),
        });
        break;
      case "events": {
        const n = Number(b.limit);
        out.push({
          id,
          type,
          title: str(b.title, MAX_SHORT),
          limit: Number.isFinite(n) ? Math.max(1, Math.min(Math.trunc(n), 10)) : 5,
        });
        break;
      }
      case "divider":
        out.push({ id, type });
        break;
    }
  }
  return out;
}

/** True when at least one block would put something in front of the guest. */
export function hasRenderableContent(blocks: CampaignBlock[]): boolean {
  return blocks.some((b) => {
    switch (b.type) {
      case "heading":
        return b.text.trim().length > 0;
      case "text":
        return richDocTextLength(b.doc) > 0;
      case "image":
        return b.url.trim().length > 0;
      case "button":
        return b.label.trim().length > 0 && b.url.trim().length > 0;
      case "promo":
        return Boolean(b.title.trim() || b.text.trim() || b.code.trim());
      case "events":
        return true;
      case "divider":
        return false;
    }
  });
}

export function usesEventsBlock(blocks: CampaignBlock[]): number {
  let max = 0;
  for (const b of blocks) {
    if (b.type === "events") max = Math.max(max, b.limit);
  }
  return max;
}

function substitute(text: string, vars: CampaignMergeVars, escape: boolean): string {
  let out = text;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(escape ? escapeHtml(value) : value);
  }
  return out;
}

/** Returns an absolute http(s)/mailto URL or "" when the value is unsafe. */
export function safeCampaignUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value) || /^mailto:/i.test(value)) return value;
  if (value.startsWith("/") && !value.startsWith("//")) {
    return `${publicAppBaseUrl()}${value}`;
  }
  return "";
}

function resolveUrl(raw: string, vars: CampaignMergeVars): string {
  return safeCampaignUrl(substitute(raw, vars, false));
}

/** Escaped plain text → paragraphs with **bold** and [label](url) support. */
function formatRichText(text: string, vars: CampaignMergeVars): string {
  const escaped = substitute(escapeHtml(text), vars, true);
  const paragraphs = escaped
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return paragraphs
    .map((p) => {
      const inline = p
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) => {
          const url = safeCampaignUrl(href.replace(/&amp;/g, "&"));
          return url
            ? `<a href="${escapeHtml(url)}" style="color:#A6892A;">${label}</a>`
            : label;
        })
        .replace(/\n/g, "<br>");
      return `<p style="margin:0 0 16px 0;color:#374151;">${inline}</p>`;
    })
    .join("\n");
}

function wrapMarks(html: string, marks: RichMark[] | undefined, vars: CampaignMergeVars): string {
  if (!marks?.length) return html;
  let out = html;
  const color = marks.find((m) => m.type === "textStyle");
  if (color) out = `<span style="color:${color.attrs.color};">${out}</span>`;
  for (const m of marks) {
    if (m.type === "bold") out = `<strong>${out}</strong>`;
    else if (m.type === "italic") out = `<em>${out}</em>`;
    else if (m.type === "underline") out = `<u>${out}</u>`;
    else if (m.type === "strike") out = `<s>${out}</s>`;
  }
  const link = marks.find((m) => m.type === "link");
  if (link) {
    const href = resolveUrl(link.attrs.href, vars);
    if (href) {
      const linkColor = color ? color.attrs.color : "#A6892A";
      out = `<a href="${escapeHtml(href)}" style="color:${linkColor};text-decoration:underline;">${out}</a>`;
    }
  }
  return out;
}

function renderInline(nodes: RichNode[] | undefined, vars: CampaignMergeVars): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === "text") {
        return wrapMarks(substitute(escapeHtml(n.text), vars, true), n.marks, vars);
      }
      if (n.type === "mergeTag") {
        return wrapMarks(escapeHtml(vars[n.attrs.tag] ?? ""), n.marks, vars);
      }
      if (n.type === "hardBreak") return "<br>";
      return "";
    })
    .join("");
}

function alignStyle(attrs: { textAlign?: string | null } | undefined): string {
  return attrs?.textAlign ? `text-align:${attrs.textAlign};` : "";
}

/** Allow-listed document → inline-styled email HTML (all text escaped). */
function renderRichNodes(
  nodes: RichNode[] | undefined,
  vars: CampaignMergeVars,
  inList = false
): string {
  return (nodes ?? [])
    .map((n) => {
      switch (n.type) {
        case "paragraph": {
          const inner = renderInline(n.content, vars);
          const margin = inList ? "0" : "0 0 16px 0";
          return `<p style="margin:${margin};color:#374151;${alignStyle(n.attrs)}">${inner || "&nbsp;"}</p>`;
        }
        case "heading": {
          const tag = n.attrs.level === 3 ? "h3" : "h2";
          const size = n.attrs.level === 3 ? "18px" : "22px";
          return `<${tag} style="margin:8px 0 12px 0;color:#1f2937;font-size:${size};${alignStyle(n.attrs)}">${renderInline(n.content, vars)}</${tag}>`;
        }
        case "bulletList":
          return `<ul style="margin:0 0 16px 0;padding-left:24px;color:#374151;">${renderRichNodes(n.content, vars, true)}</ul>`;
        case "orderedList":
          return `<ol${n.attrs?.start ? ` start="${n.attrs.start}"` : ""} style="margin:0 0 16px 0;padding-left:24px;color:#374151;">${renderRichNodes(n.content, vars, true)}</ol>`;
        case "listItem":
          return `<li style="margin:0 0 6px 0;">${renderRichNodes(n.content, vars, true)}</li>`;
        case "blockquote":
          return `<blockquote style="margin:0 0 16px 0;padding:12px 16px;border-left:4px solid #D4AF37;background:#fffbf0;color:#4b5563;border-radius:0 8px 8px 0;">${renderRichNodes(n.content, vars, true)}</blockquote>`;
        case "horizontalRule":
          return `<div style="height:1px;background-color:#e5e7eb;margin:24px 0;"></div>`;
        default:
          return "";
      }
    })
    .join("\n");
}

function renderBlock(block: CampaignBlock, ctx: CampaignRenderContext): string {
  const { vars } = ctx;
  switch (block.type) {
    case "heading": {
      const text = substitute(escapeHtml(block.text), vars, true).trim();
      return text
        ? `<h1 style="margin:0 0 16px 0;color:#111827;text-align:${block.align};">${text}</h1>`
        : "";
    }
    case "text":
      return richDocTextLength(block.doc) > 0 ? renderRichNodes(block.doc.content, vars) : "";
    case "image": {
      const src = resolveUrl(block.url, vars);
      if (!src || !/^https?:\/\//i.test(src)) return "";
      const img = `<img src="${escapeHtml(src)}" alt="${escapeHtml(block.alt)}" style="display:inline-block;width:100%;max-width:536px;height:auto;border:0;border-radius:12px;" />`;
      const href = resolveUrl(block.href, vars);
      const inner = href ? `<a href="${escapeHtml(href)}">${img}</a>` : img;
      return `<div style="margin:0 0 16px 0;text-align:${block.align};">${inner}</div>`;
    }
    case "button": {
      const url = resolveUrl(block.url, vars);
      const label = substitute(escapeHtml(block.label), vars, true).trim();
      if (!url || !label) return "";
      const style =
        block.variant === "outline"
          ? "display:inline-block;background:#ffffff;color:#8a7020;border:2px solid #D4AF37;padding:12px 30px;text-decoration:none;border-radius:8px;font-weight:600;"
          : "display:inline-block;background:#D4AF37;color:#000000;padding:14px 32px;text-decoration:none;border-radius:8px;font-weight:600;";
      return `<p style="margin:0 0 16px 0;text-align:${block.align};"><a href="${escapeHtml(url)}" style="${style}">${label}</a></p>`;
    }
    case "promo": {
      const title = substitute(escapeHtml(block.title), vars, true).trim();
      const body = block.text.trim() ? formatRichText(block.text, vars) : "";
      const code = escapeHtml(block.code.trim());
      const url = resolveUrl(block.url, vars);
      if (!title && !body && !code && !url) return "";
      return `<div class="code-box" style="border:2px solid #D4AF37;border-radius:12px;padding:20px;text-align:center;margin:24px 0;background:#fffbf0;">
${title ? `<h2 style="margin:0 0 8px 0;color:#1f2937;">${title}</h2>` : ""}
${body}
${code ? `<p style="margin:8px 0;font-family:'Courier New',monospace;font-size:26px;font-weight:700;letter-spacing:4px;color:#A6892A;">${code}</p>` : ""}
${url ? `<p style="margin:8px 0 0 0;"><a href="${escapeHtml(url)}" style="color:#A6892A;font-weight:600;">Claim offer</a></p>` : ""}
</div>`;
    }
    case "events": {
      const items = ctx.events.slice(0, block.limit);
      if (items.length === 0) return "";
      const title = substitute(escapeHtml(block.title), vars, true).trim();
      const rows = items
        .map(
          (e) => `<tr>
<td style="padding:10px 0;border-bottom:1px solid #e5e7eb;">
<a href="${escapeHtml(e.url)}" style="color:#111827;font-weight:600;text-decoration:none;">${escapeHtml(e.title)}</a><br>
<span style="color:#6b7280;font-size:14px;">${escapeHtml(e.when)}</span>
</td>
</tr>`
        )
        .join("\n");
      return `<div style="margin:24px 0;">
${title ? `<h2 style="margin:0 0 8px 0;color:#1f2937;">${title}</h2>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>
</div>`;
    }
    case "divider":
      return `<div class="divider" style="height:1px;background-color:#e5e7eb;margin:32px 0;"></div>`;
  }
}

export function renderCampaignBodyHtml(
  blocks: CampaignBlock[],
  ctx: CampaignRenderContext
): string {
  const preheader = ctx.preheader?.trim()
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(
        substitute(ctx.preheader.trim(), ctx.vars, false)
      )}</div>`
    : "";
  const body = blocks
    .map((b) => renderBlock(b, ctx))
    .filter(Boolean)
    .join("\n");
  const address = ctx.footer.address
    ? `<br>${escapeHtml(ctx.footer.address)}`
    : "";
  const footer = `<p style="margin:32px 0 0 0;font-size:12px;color:#9ca3af;line-height:1.6;">
You are receiving this because you subscribed to updates from ${escapeHtml(ctx.footer.orgName)}.${address}<br>
<a href="${escapeHtml(ctx.footer.unsubscribeUrl)}" style="color:#9ca3af;">Unsubscribe</a>
</p>`;
  return `${preheader}\n${body}\n${footer}`;
}

export function renderCampaignSubject(subject: string, vars: CampaignMergeVars): string {
  return substitute(subject, vars, false).replace(/[\r\n]+/g, " ").trim();
}
