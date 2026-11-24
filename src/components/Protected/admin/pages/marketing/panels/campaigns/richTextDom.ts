/**
 * Browser-only bridge between the contentEditable editor DOM and the RichDoc model.
 * The server re-sanitises every document, so this only needs to be faithful, not trusted.
 */
import {
  isAllowedHref,
  MERGE_TAG_LABELS,
  MERGE_TAG_NAMES,
  type MergeTagName,
  type RichDoc,
  type RichMark,
  type RichNode,
  type RichTextAlign,
} from "@/lib/marketing/campaigns/richText";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── RichDoc → editor HTML ────────────────────────────────────────────────────

export function mergeChipHtml(tag: MergeTagName): string {
  return `<span data-merge-tag="${tag}" contenteditable="false" class="nl-merge-chip">${esc(
    MERGE_TAG_LABELS[tag]
  )}</span>`;
}

function marksHtml(inner: string, marks: RichMark[] | undefined): string {
  let out = inner;
  for (const m of marks ?? []) {
    if (m.type === "bold") out = `<strong>${out}</strong>`;
    else if (m.type === "italic") out = `<em>${out}</em>`;
    else if (m.type === "underline") out = `<u>${out}</u>`;
    else if (m.type === "strike") out = `<s>${out}</s>`;
    else if (m.type === "textStyle") out = `<font color="${esc(m.attrs.color)}">${out}</font>`;
  }
  const link = marks?.find((m) => m.type === "link");
  if (link && link.type === "link") out = `<a href="${esc(link.attrs.href)}">${out}</a>`;
  return out;
}

function inlineHtml(nodes: RichNode[] | undefined): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === "text") return marksHtml(esc(n.text), n.marks);
      if (n.type === "mergeTag") return marksHtml(mergeChipHtml(n.attrs.tag), n.marks);
      if (n.type === "hardBreak") return "<br>";
      return "";
    })
    .join("");
}

function alignAttr(attrs: { textAlign?: RichTextAlign | null } | undefined): string {
  return attrs?.textAlign && attrs.textAlign !== "left" ? ` style="text-align:${attrs.textAlign}"` : "";
}

function blocksHtml(nodes: RichNode[] | undefined): string {
  return (nodes ?? [])
    .map((n) => {
      switch (n.type) {
        case "paragraph":
          return `<p${alignAttr(n.attrs)}>${inlineHtml(n.content) || "<br>"}</p>`;
        case "heading": {
          const tag = n.attrs.level === 3 ? "h3" : "h2";
          return `<${tag}${alignAttr(n.attrs)}>${inlineHtml(n.content) || "<br>"}</${tag}>`;
        }
        case "bulletList":
          return `<ul>${blocksHtml(n.content)}</ul>`;
        case "orderedList":
          return `<ol>${blocksHtml(n.content)}</ol>`;
        case "listItem": {
          const only = n.content.length === 1 && n.content[0]!.type === "paragraph" ? n.content[0] : null;
          return `<li>${only && only.type === "paragraph" ? inlineHtml(only.content) || "<br>" : blocksHtml(n.content)}</li>`;
        }
        case "blockquote":
          return `<blockquote>${blocksHtml(n.content)}</blockquote>`;
        case "horizontalRule":
          return "<hr>";
        default:
          return "";
      }
    })
    .join("");
}

export function richDocToEditorHtml(doc: RichDoc): string {
  return blocksHtml(doc.content) || "<p><br></p>";
}

// ── Editor DOM → RichDoc ─────────────────────────────────────────────────────

function toHex(color: string): string | null {
  const c = color.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(c)) return c;
  if (/^#[0-9a-f]{3}$/.test(c)) return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
  const m = c.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("")}`;
}

function withMark(marks: RichMark[], mark: RichMark): RichMark[] {
  return [...marks.filter((m) => m.type !== mark.type), mark];
}

const BLOCK_TAGS = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "BLOCKQUOTE", "HR"]);

function inlineFrom(node: Node, marks: RichMark[], out: RichNode[]) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent ?? "").replace(/\u00a0/g, " ").replace(/[\r\n]+/g, " ");
    if (text) out.push(marks.length ? { type: "text", text, marks } : { type: "text", text });
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as HTMLElement;
  const tag = el.tagName;
  if (tag === "BR") {
    out.push({ type: "hardBreak" });
    return;
  }
  const mergeTag = el.getAttribute("data-merge-tag") as MergeTagName | null;
  if (mergeTag) {
    if (MERGE_TAG_NAMES.includes(mergeTag)) {
      out.push(
        marks.length
          ? { type: "mergeTag", attrs: { tag: mergeTag }, marks }
          : { type: "mergeTag", attrs: { tag: mergeTag } }
      );
    }
    return;
  }
  let next = marks;
  if (tag === "B" || tag === "STRONG") next = withMark(next, { type: "bold" });
  if (tag === "I" || tag === "EM") next = withMark(next, { type: "italic" });
  if (tag === "U") next = withMark(next, { type: "underline" });
  if (tag === "S" || tag === "STRIKE" || tag === "DEL") next = withMark(next, { type: "strike" });
  if (tag === "A") {
    const href = el.getAttribute("href") ?? "";
    if (isAllowedHref(href)) next = withMark(next, { type: "link", attrs: { href } });
  }
  const style = el.style;
  const color = toHex(el.getAttribute("color") ?? style?.color ?? "");
  if (color) next = withMark(next, { type: "textStyle", attrs: { color } });
  const weight = style?.fontWeight;
  if (weight === "bold" || Number(weight) >= 600) next = withMark(next, { type: "bold" });
  if (style?.fontStyle === "italic") next = withMark(next, { type: "italic" });
  const deco = style?.textDecorationLine || style?.textDecoration || "";
  if (deco.includes("underline")) next = withMark(next, { type: "underline" });
  if (deco.includes("line-through")) next = withMark(next, { type: "strike" });
  el.childNodes.forEach((child) => inlineFrom(child, next, out));
}

function alignOf(el: HTMLElement): RichTextAlign | null {
  const a = (el.style?.textAlign || el.getAttribute("align") || "").toLowerCase();
  return a === "center" || a === "right" || a === "justify" ? (a as RichTextAlign) : null;
}

function trimInline(nodes: RichNode[]): RichNode[] {
  while (nodes.length && nodes[nodes.length - 1]!.type === "hardBreak") nodes.pop();
  return nodes;
}

function paragraph(content: RichNode[], align: RichTextAlign | null): RichNode {
  const c = trimInline(content);
  return {
    type: "paragraph",
    ...(align ? { attrs: { textAlign: align } } : {}),
    ...(c.length ? { content: c } : {}),
  };
}

function blocksFrom(parent: Node, inheritedAlign: RichTextAlign | null = null): RichNode[] {
  const out: RichNode[] = [];
  let run: RichNode[] = [];
  const flush = () => {
    if (run.some((n) => n.type !== "hardBreak" && !(n.type === "text" && !n.text.trim()))) {
      out.push(paragraph(run, inheritedAlign));
    }
    run = [];
  };
  parent.childNodes.forEach((child) => {
    if (child.nodeType !== Node.ELEMENT_NODE || !BLOCK_TAGS.has((child as HTMLElement).tagName)) {
      inlineFrom(child, [], run);
      return;
    }
    flush();
    const el = child as HTMLElement;
    const align = alignOf(el) ?? inheritedAlign;
    switch (el.tagName) {
      case "P": {
        const content: RichNode[] = [];
        el.childNodes.forEach((c) => inlineFrom(c, [], content));
        out.push(paragraph(content, align));
        break;
      }
      case "DIV": {
        const hasBlocks = Array.from(el.children).some((c) => BLOCK_TAGS.has(c.tagName));
        if (hasBlocks) {
          out.push(...blocksFrom(el, align));
        } else {
          const content: RichNode[] = [];
          el.childNodes.forEach((c) => inlineFrom(c, [], content));
          out.push(paragraph(content, align));
        }
        break;
      }
      case "H1":
      case "H2":
      case "H3":
      case "H4":
      case "H5":
      case "H6": {
        const content: RichNode[] = [];
        el.childNodes.forEach((c) => inlineFrom(c, [], content));
        const c = trimInline(content);
        out.push({
          type: "heading",
          attrs: { level: el.tagName === "H1" || el.tagName === "H2" ? 2 : 3, ...(align ? { textAlign: align } : {}) },
          ...(c.length ? { content: c } : {}),
        });
        break;
      }
      case "UL":
      case "OL": {
        const items: RichNode[] = [];
        el.childNodes.forEach((li) => {
          if (li.nodeType !== Node.ELEMENT_NODE) return;
          const content = blocksFrom(li);
          items.push({ type: "listItem", content: content.length ? content : [{ type: "paragraph" }] });
        });
        if (items.length) {
          out.push(el.tagName === "OL" ? { type: "orderedList", content: items } : { type: "bulletList", content: items });
        }
        break;
      }
      case "LI": {
        out.push(...blocksFrom(el, align));
        break;
      }
      case "BLOCKQUOTE": {
        const content = blocksFrom(el, align);
        if (content.length) out.push({ type: "blockquote", content });
        break;
      }
      case "HR":
        out.push({ type: "horizontalRule" });
        break;
    }
  });
  flush();
  return out;
}

export function editorDomToRichDoc(root: HTMLElement): RichDoc {
  const content = blocksFrom(root);
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}
