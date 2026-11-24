/**
 * Rich-text document model for newsletter text blocks (TipTap / ProseMirror JSON).
 * Pure + client-safe: the composer edits it, the server sanitises and renders it.
 * Only the node / mark / attribute allow-list below ever reaches an email.
 */

export const MERGE_TAG_NAMES = [
  "guestFirstName",
  "orgName",
  "websiteUrl",
  "bookUrl",
  "monthName",
] as const;

export type MergeTagName = (typeof MERGE_TAG_NAMES)[number];

export const MERGE_TAG_LABELS: Record<MergeTagName, string> = {
  guestFirstName: "First name",
  orgName: "Company name",
  websiteUrl: "Website link",
  bookUrl: "Booking link",
  monthName: "Month",
};

export type RichMark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "underline" }
  | { type: "strike" }
  | { type: "link"; attrs: { href: string } }
  | { type: "textStyle"; attrs: { color: string } };

export type RichTextAlign = "left" | "center" | "right" | "justify";

export type RichNode =
  | { type: "paragraph"; attrs?: { textAlign?: RichTextAlign | null }; content?: RichNode[] }
  | {
      type: "heading";
      attrs: { level: 2 | 3; textAlign?: RichTextAlign | null };
      content?: RichNode[];
    }
  | { type: "bulletList"; content: RichNode[] }
  | { type: "orderedList"; attrs?: { start?: number }; content: RichNode[] }
  | { type: "listItem"; content: RichNode[] }
  | { type: "blockquote"; content: RichNode[] }
  | { type: "horizontalRule" }
  | { type: "hardBreak"; marks?: RichMark[] }
  | { type: "text"; text: string; marks?: RichMark[] }
  | { type: "mergeTag"; attrs: { tag: MergeTagName }; marks?: RichMark[] };

export type RichDoc = { type: "doc"; content: RichNode[] };

export const EMPTY_RICH_DOC: RichDoc = { type: "doc", content: [{ type: "paragraph" }] };

const ALIGNS: RichTextAlign[] = ["left", "center", "right", "justify"];
const MAX_NODES = 4000;
const MAX_DEPTH = 10;
const MAX_TEXT = 20_000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

/** Accepts http(s), mailto, site-relative paths and merge tags (resolved at send time). */
export function isAllowedHref(raw: string): boolean {
  const v = raw.trim();
  if (!v || v.length > 1000) return false;
  if (/^https?:\/\//i.test(v) || /^mailto:/i.test(v)) return true;
  if (v.startsWith("/") && !v.startsWith("//")) return true;
  return /^\{\{(websiteUrl|bookUrl)\}\}/.test(v);
}

function sanitizeMarks(raw: unknown): RichMark[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: RichMark[] = [];
  const seen = new Set<string>();
  for (const m of raw.slice(0, 8)) {
    if (!isRecord(m) || typeof m.type !== "string" || seen.has(m.type)) continue;
    const attrs = isRecord(m.attrs) ? m.attrs : {};
    switch (m.type) {
      case "bold":
      case "italic":
      case "underline":
      case "strike":
        out.push({ type: m.type });
        seen.add(m.type);
        break;
      case "link": {
        const href = typeof attrs.href === "string" ? attrs.href.trim() : "";
        if (isAllowedHref(href)) {
          out.push({ type: "link", attrs: { href } });
          seen.add(m.type);
        }
        break;
      }
      case "textStyle": {
        const color = typeof attrs.color === "string" ? attrs.color.trim() : "";
        if (/^#[0-9a-f]{6}$/i.test(color)) {
          out.push({ type: "textStyle", attrs: { color: color.toLowerCase() } });
          seen.add(m.type);
        }
        break;
      }
    }
  }
  return out.length ? out : undefined;
}

function alignOf(attrs: Record<string, unknown>): RichTextAlign | null {
  return ALIGNS.includes(attrs.textAlign as RichTextAlign)
    ? (attrs.textAlign as RichTextAlign)
    : null;
}

type Budget = { nodes: number; text: number };

function sanitizeInline(raw: unknown, budget: Budget): RichNode[] {
  if (!Array.isArray(raw)) return [];
  const out: RichNode[] = [];
  for (const n of raw) {
    if (!isRecord(n) || budget.nodes >= MAX_NODES) continue;
    budget.nodes += 1;
    const marks = sanitizeMarks(n.marks);
    if (n.type === "text" && typeof n.text === "string" && n.text.length > 0) {
      const room = MAX_TEXT - budget.text;
      if (room <= 0) continue;
      const text = n.text.slice(0, room);
      budget.text += text.length;
      out.push(marks ? { type: "text", text, marks } : { type: "text", text });
    } else if (n.type === "hardBreak") {
      out.push({ type: "hardBreak" });
    } else if (n.type === "mergeTag") {
      const attrs = isRecord(n.attrs) ? n.attrs : {};
      const tag = attrs.tag as MergeTagName;
      if (MERGE_TAG_NAMES.includes(tag)) {
        out.push(marks ? { type: "mergeTag", attrs: { tag }, marks } : { type: "mergeTag", attrs: { tag } });
      }
    }
  }
  return out;
}

function sanitizeBlocks(raw: unknown, budget: Budget, depth: number): RichNode[] {
  if (!Array.isArray(raw) || depth > MAX_DEPTH) return [];
  const out: RichNode[] = [];
  for (const n of raw) {
    if (!isRecord(n) || budget.nodes >= MAX_NODES) continue;
    budget.nodes += 1;
    const attrs = isRecord(n.attrs) ? n.attrs : {};
    switch (n.type) {
      case "paragraph": {
        const align = alignOf(attrs);
        const content = sanitizeInline(n.content, budget);
        out.push({
          type: "paragraph",
          ...(align ? { attrs: { textAlign: align } } : {}),
          ...(content.length ? { content } : {}),
        });
        break;
      }
      case "heading": {
        const level = attrs.level === 3 ? 3 : 2;
        const align = alignOf(attrs);
        const content = sanitizeInline(n.content, budget);
        out.push({
          type: "heading",
          attrs: { level, ...(align ? { textAlign: align } : {}) },
          ...(content.length ? { content } : {}),
        });
        break;
      }
      case "bulletList":
      case "orderedList": {
        const items = sanitizeBlocks(n.content, budget, depth + 1).filter(
          (c) => c.type === "listItem"
        );
        if (!items.length) break;
        if (n.type === "orderedList") {
          const start = Math.trunc(Number(attrs.start));
          out.push({
            type: "orderedList",
            ...(Number.isFinite(start) && start > 1 ? { attrs: { start: Math.min(start, 999) } } : {}),
            content: items,
          });
        } else {
          out.push({ type: "bulletList", content: items });
        }
        break;
      }
      case "listItem":
      case "blockquote": {
        const content = sanitizeBlocks(n.content, budget, depth + 1);
        if (content.length) out.push({ type: n.type, content });
        break;
      }
      case "horizontalRule":
        out.push({ type: "horizontalRule" });
        break;
    }
  }
  return out;
}

/** Coerce untrusted JSON into an allow-listed document (never throws). */
export function sanitizeRichDoc(raw: unknown): RichDoc {
  if (!isRecord(raw) || raw.type !== "doc") return { ...EMPTY_RICH_DOC };
  const content = sanitizeBlocks(raw.content, { nodes: 0, text: 0 }, 0);
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

const TAG_RE = /\{\{(guestFirstName|orgName|websiteUrl|bookUrl|monthName)\}\}/g;

/** Inline text → text + mergeTag nodes, applying `marks` to each piece. */
function textWithTags(text: string, marks?: RichMark[]): RichNode[] {
  const out: RichNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TAG_RE)) {
    const i = m.index ?? 0;
    if (i > last) {
      out.push(marks ? { type: "text", text: text.slice(last, i), marks } : { type: "text", text: text.slice(last, i) });
    }
    const tag = m[1] as MergeTagName;
    out.push(marks ? { type: "mergeTag", attrs: { tag }, marks } : { type: "mergeTag", attrs: { tag } });
    last = i + m[0].length;
  }
  if (last < text.length) {
    out.push(marks ? { type: "text", text: text.slice(last), marks } : { type: "text", text: text.slice(last) });
  }
  return out;
}

/** Legacy plain text (blank-line paragraphs, **bold**, [label](url)) → document. */
export function richDocFromPlainText(text: string): RichDoc {
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!paragraphs.length) return { ...EMPTY_RICH_DOC };
  const token = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  return {
    type: "doc",
    content: paragraphs.map((p) => {
      const content: RichNode[] = [];
      p.split("\n").forEach((line, li) => {
        if (li > 0) content.push({ type: "hardBreak" });
        let last = 0;
        for (const m of line.matchAll(token)) {
          const i = m.index ?? 0;
          if (i > last) content.push(...textWithTags(line.slice(last, i)));
          if (m[1]) {
            content.push(...textWithTags(m[1], [{ type: "bold" }]));
          } else if (m[2] && m[3]) {
            const marks: RichMark[] | undefined = isAllowedHref(m[3])
              ? [{ type: "link", attrs: { href: m[3] } }]
              : undefined;
            content.push(...textWithTags(m[2], marks));
          }
          last = i + m[0].length;
        }
        if (last < line.length) content.push(...textWithTags(line.slice(last)));
      });
      return { type: "paragraph", ...(content.length ? { content } : {}) } as RichNode;
    }),
  };
}

/** Visible text length (merge tags count as one character) — used for "is it empty?" checks. */
export function richDocTextLength(doc: RichDoc): number {
  let n = 0;
  const walk = (nodes: RichNode[] | undefined) => {
    for (const node of nodes ?? []) {
      if (node.type === "text") n += node.text.trim().length;
      else if (node.type === "mergeTag") n += 1;
      else if ("content" in node) walk(node.content);
    }
  };
  walk(doc.content);
  return n;
}
