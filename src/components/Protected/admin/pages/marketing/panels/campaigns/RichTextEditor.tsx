"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Eraser,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Palette,
  Pilcrow,
  Quote,
  Redo2,
  Sparkles,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import {
  isAllowedHref,
  MERGE_TAG_LABELS,
  MERGE_TAG_NAMES,
  richDocTextLength,
  type RichDoc,
} from "@/lib/marketing/campaigns/richText";
import { editorDomToRichDoc, mergeChipHtml, richDocToEditorHtml } from "./richTextDom";
import "./campaignEditor.css";

const COLORS = [
  { value: "#111827", label: "Ink" },
  { value: "#4b5563", label: "Slate" },
  { value: "#a6892a", label: "Gold" },
  { value: "#b91c1c", label: "Red" },
  { value: "#c2410c", label: "Orange" },
  { value: "#047857", label: "Green" },
  { value: "#1d4ed8", label: "Blue" },
  { value: "#7c3aed", label: "Purple" },
];

type ToolState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  block: string;
  ul: boolean;
  ol: boolean;
  center: boolean;
  right: boolean;
  link: string | null;
};

const EMPTY_STATE: ToolState = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  block: "p",
  ul: false,
  ol: false,
  center: false,
  right: false,
  link: null,
};

type Popover = "link" | "color" | "tags" | null;

function exec(command: string, value?: string) {
  // execCommand is deprecated but remains the only native, undo-aware editing API.
  document.execCommand(command, false, value);
}

function ToolButton({
  active,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-stone-600 transition ${
        active
          ? "bg-[#D4AF37]/20 text-[#7a6318] ring-1 ring-[#D4AF37]/40"
          : "hover:bg-stone-100 hover:text-stone-900"
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-0.5 h-5 w-px bg-stone-200" aria-hidden />;
}

export default function RichTextEditor({
  value,
  onChange,
  disabled,
  placeholder = "Write something your guests will love…",
}: {
  value: RichDoc;
  onChange: (doc: RichDoc) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const lastEmitted = useRef<string>("");
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [tools, setTools] = useState<ToolState>(EMPTY_STATE);
  const [open, setOpen] = useState<Popover>(null);
  const [href, setHref] = useState("");
  const [linkError, setLinkError] = useState("");
  const [empty, setEmpty] = useState(() => richDocTextLength(value) === 0);

  // Load / external sync (server reload) — never while the user is typing in it.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const incoming = JSON.stringify(value);
    if (incoming === lastEmitted.current) return;
    if (document.activeElement === root && lastEmitted.current) return;
    lastEmitted.current = incoming;
    root.innerHTML = richDocToEditorHtml(value);
    setEmpty(richDocTextLength(value) === 0);
  }, [value]);

  const emit = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const doc = editorDomToRichDoc(root);
    const json = JSON.stringify(doc);
    setEmpty(richDocTextLength(doc) === 0);
    if (json === lastEmitted.current) return;
    lastEmitted.current = json;
    onChangeRef.current(doc);
  }, []);

  const inEditor = (node: Node | null) => Boolean(node && rootRef.current?.contains(node));

  const refreshTools = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || !inEditor(sel.anchorNode)) return;
    let el: Node | null = sel.anchorNode;
    let block = "p";
    let link: string | null = null;
    let center = false;
    let right = false;
    while (el && el !== rootRef.current) {
      if (el.nodeType === Node.ELEMENT_NODE) {
        const e = el as HTMLElement;
        if (!link && e.tagName === "A") link = e.getAttribute("href");
        if (["H2", "H3", "BLOCKQUOTE", "P", "LI"].includes(e.tagName) && block === "p") {
          block = e.tagName.toLowerCase();
          const a = e.style.textAlign || e.getAttribute("align");
          center = a === "center";
          right = a === "right";
        }
      }
      el = el.parentNode;
    }
    setTools({
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
      underline: document.queryCommandState("underline"),
      strike: document.queryCommandState("strikeThrough"),
      ul: document.queryCommandState("insertUnorderedList"),
      ol: document.queryCommandState("insertOrderedList"),
      block,
      center,
      right,
      link,
    });
  }, []);

  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && inEditor(sel.anchorNode)) {
        savedRange.current = sel.getRangeAt(0).cloneRange();
        refreshTools();
      }
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [refreshTools]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /** Focus the editor and put the caret back where the user left it. */
  const restore = () => {
    const root = rootRef.current;
    if (!root) return;
    root.focus();
    const sel = window.getSelection();
    if (sel && savedRange.current && inEditor(savedRange.current.startContainer)) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
    exec("styleWithCSS", "false");
    exec("defaultParagraphSeparator", "p");
  };

  const run = (command: string, val?: string) => {
    restore();
    exec(command, val);
    emit();
    refreshTools();
  };

  const toggleBlock = (tag: "h2" | "h3" | "blockquote") =>
    run("formatBlock", tools.block === tag ? "<p>" : `<${tag}>`);

  function applyLink(raw = href) {
    const v = raw.trim();
    restore();
    if (!v || v === "https://") {
      exec("unlink");
    } else if (!isAllowedHref(v)) {
      setLinkError("Use a full https:// link, an email (mailto:) or a site path starting with /");
      return;
    } else {
      const sel = window.getSelection();
      if (sel && sel.isCollapsed && !tools.link) {
        const label = v.startsWith("{{") ? "Book now" : v;
        exec("insertHTML", `<a href="${v.replace(/"/g, "&quot;")}">${label.replace(/</g, "&lt;")}</a>&nbsp;`);
      } else {
        exec("createLink", v);
      }
    }
    emit();
    refreshTools();
    setOpen(null);
  }

  if (disabled) {
    return (
      <div className="nl-editor rounded-xl bg-white opacity-80 ring-1 ring-stone-200">
        <div
          className="nl-content"
          dangerouslySetInnerHTML={{ __html: richDocToEditorHtml(value) }}
        />
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      className="nl-editor relative rounded-xl bg-white ring-1 ring-stone-200/90 transition focus-within:ring-2 focus-within:ring-[#D4AF37]/55"
    >
      <div className="flex flex-wrap items-center gap-0.5 rounded-t-xl border-b border-stone-200/90 bg-stone-50/80 px-1.5 py-1">
        <ToolButton title="Undo (Ctrl+Z)" onClick={() => run("undo")}>
          <Undo2 className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title="Redo (Ctrl+Y)" onClick={() => run("redo")}>
          <Redo2 className="h-3.5 w-3.5" />
        </ToolButton>
        <Divider />
        <ToolButton title="Body text" active={tools.block === "p" || tools.block === "li"} onClick={() => run("formatBlock", "<p>")}>
          <Pilcrow className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title="Large heading" active={tools.block === "h2"} onClick={() => toggleBlock("h2")}>
          <Heading2 className="h-4 w-4" />
        </ToolButton>
        <ToolButton title="Small heading" active={tools.block === "h3"} onClick={() => toggleBlock("h3")}>
          <Heading3 className="h-4 w-4" />
        </ToolButton>
        <Divider />
        <ToolButton title="Bold (Ctrl+B)" active={tools.bold} onClick={() => run("bold")}>
          <Bold className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title="Italic (Ctrl+I)" active={tools.italic} onClick={() => run("italic")}>
          <Italic className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title="Underline (Ctrl+U)" active={tools.underline} onClick={() => run("underline")}>
          <UnderlineIcon className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title="Strikethrough" active={tools.strike} onClick={() => run("strikeThrough")}>
          <Strikethrough className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title="Text colour" onClick={() => setOpen(open === "color" ? null : "color")}>
          <Palette className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton
          title="Link (Ctrl+K)"
          active={Boolean(tools.link)}
          onClick={() => {
            setHref(tools.link || "https://");
            setLinkError("");
            setOpen(open === "link" ? null : "link");
          }}
        >
          <Link2 className="h-3.5 w-3.5" />
        </ToolButton>
        <Divider />
        <ToolButton title="Bulleted list" active={tools.ul} onClick={() => run("insertUnorderedList")}>
          <List className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title="Numbered list" active={tools.ol} onClick={() => run("insertOrderedList")}>
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title="Quote / callout" active={tools.block === "blockquote"} onClick={() => toggleBlock("blockquote")}>
          <Quote className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title="Divider line" onClick={() => run("insertHorizontalRule")}>
          <Minus className="h-3.5 w-3.5" />
        </ToolButton>
        <Divider />
        <ToolButton title="Align left" active={!tools.center && !tools.right} onClick={() => run("justifyLeft")}>
          <AlignLeft className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title="Align centre" active={tools.center} onClick={() => run("justifyCenter")}>
          <AlignCenter className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title="Align right" active={tools.right} onClick={() => run("justifyRight")}>
          <AlignRight className="h-3.5 w-3.5" />
        </ToolButton>
        <Divider />
        <ToolButton
          title="Clear formatting"
          onClick={() => {
            run("removeFormat");
            run("unlink");
          }}
        >
          <Eraser className="h-3.5 w-3.5" />
        </ToolButton>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen(open === "tags" ? null : "tags")}
          className="ml-auto inline-flex h-7 items-center gap-1 rounded-md bg-[#D4AF37]/15 px-2 text-xs font-semibold text-[#7a6318] ring-1 ring-[#D4AF37]/30 transition hover:bg-[#D4AF37]/25"
        >
          <Sparkles className="h-3.5 w-3.5" /> Personalise <ChevronDown className="h-3 w-3" />
        </button>
      </div>

      {open === "color" ? (
        <div className="absolute left-1.5 top-10 z-30 w-56 rounded-xl border border-stone-200 bg-white p-2.5 shadow-xl shadow-stone-900/10">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-400">Text colour</p>
          <div className="grid grid-cols-4 gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                title={c.label}
                aria-label={c.label}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  run("foreColor", c.value);
                  setOpen(null);
                }}
                className="h-8 rounded-lg ring-1 ring-stone-200 transition hover:scale-105"
                style={{ background: c.value }}
              />
            ))}
          </div>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              run("foreColor", "#374151");
              setOpen(null);
            }}
            className="mt-2 w-full rounded-lg border border-stone-200 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50"
          >
            Default colour
          </button>
        </div>
      ) : null}

      {open === "link" ? (
        <div className="absolute left-1.5 top-10 z-30 w-80 max-w-[calc(100%-0.75rem)] rounded-xl border border-stone-200 bg-white p-3 shadow-xl shadow-stone-900/10">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-400">
            Link the selected text
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              applyLink();
            }}
            className="flex gap-1.5"
          >
            <input
              autoFocus
              value={href}
              onChange={(e) => {
                setHref(e.target.value);
                setLinkError("");
              }}
              placeholder="https://…"
              className="min-w-0 flex-1 rounded-lg border-0 bg-stone-50 px-2.5 py-1.5 text-sm ring-1 ring-stone-200 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/55"
            />
            <button type="submit" className="rounded-lg bg-stone-900 px-3 text-xs font-semibold text-white hover:bg-stone-800">
              Apply
            </button>
          </form>
          {linkError ? <p className="mt-1.5 text-[11px] text-red-600">{linkError}</p> : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(["bookUrl", "websiteUrl"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyLink(`{{${t}}}`)}
                className="rounded-lg bg-[#D4AF37]/10 px-2 py-1 text-[11px] font-medium text-[#7a6318] ring-1 ring-[#D4AF37]/25 hover:bg-[#D4AF37]/20"
              >
                {MERGE_TAG_LABELS[t]}
              </button>
            ))}
            {tools.link ? (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyLink("")}
                className="ml-auto rounded-lg px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50"
              >
                Remove link
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {open === "tags" ? (
        <div className="absolute right-1.5 top-10 z-30 w-56 rounded-xl border border-stone-200 bg-white p-1.5 shadow-xl shadow-stone-900/10">
          <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-400">
            Insert for each guest
          </p>
          {MERGE_TAG_NAMES.map((t) => (
            <button
              key={t}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                run("insertHTML", `${mergeChipHtml(t)}&nbsp;`);
                setOpen(null);
              }}
              className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm text-stone-700 hover:bg-[#D4AF37]/10"
            >
              {MERGE_TAG_LABELS[t]}
              <code className="text-[10px] text-stone-400">{`{{${t}}}`}</code>
            </button>
          ))}
        </div>
      ) : null}

      <div className="relative">
        {empty ? (
          <p className="pointer-events-none absolute left-4 top-3.5 text-[0.9375rem] text-stone-400">{placeholder}</p>
        ) : null}
        <div
          ref={rootRef}
          className="nl-content"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Newsletter text"
          spellCheck
          onFocus={() => {
            exec("styleWithCSS", "false");
            exec("defaultParagraphSeparator", "p");
          }}
          onInput={emit}
          onBlur={emit}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
              e.preventDefault();
              setHref(tools.link || "https://");
              setLinkError("");
              setOpen("link");
            }
          }}
          onPaste={(e) => {
            // Paste as clean text so foreign styles never leak into guest emails.
            e.preventDefault();
            const text = e.clipboardData.getData("text/plain");
            const html = text
              .split(/\r?\n/)
              .map((line) => line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))
              .join("<br>");
            exec("insertHTML", html);
            emit();
          }}
        />
      </div>
    </div>
  );
}
