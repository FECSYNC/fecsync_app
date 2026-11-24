"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Copy,
  GripVertical,
  Heading as HeadingIcon,
  Image as ImageIcon,
  Loader2,
  Minus,
  MousePointerClick,
  Plus,
  Tag,
  Ticket,
  Trash2,
  Type,
  UploadCloud,
} from "lucide-react";
import { uploadMarketingCampaignImage } from "@/services/marketing";
import {
  emptyBlock,
  newBlockId,
  type BlockAlign,
  type CampaignBlock,
  type CampaignBlockType,
} from "@/lib/marketing/campaigns/types";
import { richDocTextLength } from "@/lib/marketing/campaigns/richText";
import RichTextEditor from "./RichTextEditor";
import TagInput, { fieldCls } from "./TagInput";

export const BLOCK_META: Record<
  CampaignBlockType,
  { label: string; hint: string; icon: ReactNode }
> = {
  heading: { label: "Heading", hint: "Big headline", icon: <HeadingIcon className="h-4 w-4" /> },
  text: { label: "Rich text", hint: "Formatted paragraphs, lists, links", icon: <Type className="h-4 w-4" /> },
  image: { label: "Image", hint: "Photo or banner", icon: <ImageIcon className="h-4 w-4" /> },
  button: { label: "Button", hint: "Call to action", icon: <MousePointerClick className="h-4 w-4" /> },
  promo: { label: "Offer", hint: "Promo code or deal", icon: <Tag className="h-4 w-4" /> },
  events: { label: "Upcoming events", hint: "Auto-filled from ticketing", icon: <Ticket className="h-4 w-4" /> },
  divider: { label: "Divider", hint: "Thin separator line", icon: <Minus className="h-4 w-4" /> },
};

const PALETTE_ORDER: CampaignBlockType[] = ["text", "heading", "image", "button", "promo", "events", "divider"];

function blockSummary(b: CampaignBlock): string {
  switch (b.type) {
    case "heading":
      return b.text || "Empty heading";
    case "text":
      return richDocTextLength(b.doc) > 0 ? "Formatted text" : "Empty text";
    case "image":
      return b.url ? b.alt || "Image" : "No image yet";
    case "button":
      return b.label || "Button";
    case "promo":
      return b.title || b.code || "Offer";
    case "events":
      return `${b.title || "Upcoming events"} · up to ${b.limit}`;
    case "divider":
      return "Line";
  }
}

function AlignPicker({
  value,
  onChange,
  disabled,
}: {
  value: BlockAlign;
  onChange: (v: BlockAlign) => void;
  disabled?: boolean;
}) {
  const opts: { v: BlockAlign; icon: ReactNode; label: string }[] = [
    { v: "left", icon: <AlignLeft className="h-3.5 w-3.5" />, label: "Left" },
    { v: "center", icon: <AlignCenter className="h-3.5 w-3.5" />, label: "Centre" },
    { v: "right", icon: <AlignRight className="h-3.5 w-3.5" />, label: "Right" },
  ];
  return (
    <div className="inline-flex rounded-lg bg-stone-100 p-0.5" role="radiogroup" aria-label="Alignment">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          title={o.label}
          disabled={disabled}
          onClick={() => onChange(o.v)}
          className={`inline-flex h-7 w-8 items-center justify-center rounded-md transition ${
            value === o.v ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-800"
          }`}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}

export function BlockPalette({
  onPick,
  compact = false,
}: {
  onPick: (t: CampaignBlockType) => void;
  compact?: boolean;
}) {
  return (
    <div className={`grid gap-1.5 ${compact ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-4"}`}>
      {PALETTE_ORDER.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onPick(t)}
          className="group flex items-start gap-2 rounded-xl border border-stone-200 bg-white p-2.5 text-left transition hover:-translate-y-0.5 hover:border-[#D4AF37]/60 hover:shadow-md hover:shadow-[#D4AF37]/10"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#D4AF37]/12 text-[#8a7020] ring-1 ring-[#D4AF37]/25 transition group-hover:bg-[#D4AF37]/20">
            {BLOCK_META[t].icon}
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-stone-800">{BLOCK_META[t].label}</span>
            {!compact ? (
              <span className="block truncate text-[11px] text-stone-500">{BLOCK_META[t].hint}</span>
            ) : null}
          </span>
        </button>
      ))}
    </div>
  );
}

function ImageField({
  block,
  disabled,
  onChange,
}: {
  block: Extract<CampaignBlock, { type: "image" }>;
  disabled: boolean;
  onChange: (b: CampaignBlock) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);

  async function upload(file: File | undefined) {
    if (!file) return;
    setError("");
    if (!/^image\/(png|jpe?g|gif|webp)$/.test(file.type)) {
      setError("Use a PNG, JPG, GIF or WebP image");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Images must be 5 MB or smaller");
      return;
    }
    setUploading(true);
    try {
      const res = await uploadMarketingCampaignImage(file);
      onChange({ ...block, url: res.url, alt: block.alt || file.name.replace(/\.[a-z0-9]+$/i, "") });
    } catch (err) {
      setError((err as Error).message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => {
          if (disabled || !e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          if (disabled || !e.dataTransfer.files.length) return;
          e.preventDefault();
          setDragOver(false);
          void upload(e.dataTransfer.files[0]);
        }}
        className={`relative overflow-hidden rounded-xl border-2 border-dashed transition ${
          dragOver ? "border-[#D4AF37] bg-[#D4AF37]/10" : "border-stone-200 bg-stone-50/70"
        }`}
      >
        {block.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={block.url} alt={block.alt} className="max-h-56 w-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-1 px-4 py-7 text-center">
            <UploadCloud className="h-6 w-6 text-stone-400" />
            <p className="text-sm font-medium text-stone-700">Drop an image here</p>
            <p className="text-[11px] text-stone-500">PNG, JPG, GIF or WebP · up to 5 MB · 1200px wide looks sharpest</p>
          </div>
        )}
        {!disabled ? (
          <div className="absolute bottom-2 right-2 flex gap-1.5">
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/95 px-2.5 py-1.5 text-xs font-semibold text-stone-800 shadow ring-1 ring-stone-200 hover:bg-white disabled:opacity-60"
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
              {uploading ? "Uploading…" : block.url ? "Replace" : "Upload"}
            </button>
            {block.url ? (
              <button
                type="button"
                onClick={() => onChange({ ...block, url: "" })}
                className="rounded-lg bg-white/95 px-2.5 py-1.5 text-xs font-medium text-red-600 shadow ring-1 ring-stone-200 hover:bg-white"
              >
                Remove
              </button>
            ) : null}
          </div>
        ) : null}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={(e) => {
            void upload(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {error ? <p className="text-[11px] text-red-600">{error}</p> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          className={`${fieldCls} sm:col-span-2`}
          value={block.url}
          disabled={disabled}
          placeholder="…or paste an image URL (https://)"
          onChange={(e) => onChange({ ...block, url: e.target.value })}
        />
        <input
          className={fieldCls}
          value={block.alt}
          disabled={disabled}
          placeholder="Describe the image (alt text)"
          onChange={(e) => onChange({ ...block, alt: e.target.value })}
        />
        <TagInput
          value={block.href}
          disabled={disabled}
          placeholder="Link when clicked (optional)"
          tags={["bookUrl", "websiteUrl"]}
          onChange={(href) => onChange({ ...block, href })}
        />
      </div>
      <div className="flex items-center gap-2 text-xs text-stone-500">
        Alignment <AlignPicker value={block.align} disabled={disabled} onChange={(align) => onChange({ ...block, align })} />
      </div>
    </div>
  );
}

function BlockEditor({
  block,
  disabled,
  onChange,
}: {
  block: CampaignBlock;
  disabled: boolean;
  onChange: (next: CampaignBlock) => void;
}) {
  switch (block.type) {
    case "heading":
      return (
        <div className="space-y-2">
          <TagInput
            value={block.text}
            disabled={disabled}
            maxLength={200}
            placeholder="{{monthName}} at {{orgName}}"
            onChange={(text) => onChange({ ...block, text })}
          />
          <div className="flex items-center gap-2 text-xs text-stone-500">
            Alignment <AlignPicker value={block.align} disabled={disabled} onChange={(align) => onChange({ ...block, align })} />
          </div>
        </div>
      );
    case "text":
      return (
        <RichTextEditor value={block.doc} disabled={disabled} onChange={(doc) => onChange({ ...block, doc })} />
      );
    case "image":
      return <ImageField block={block} disabled={disabled} onChange={onChange} />;
    case "button":
      return (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <TagInput
              value={block.label}
              disabled={disabled}
              maxLength={80}
              placeholder="Button label"
              onChange={(label) => onChange({ ...block, label })}
            />
            <TagInput
              value={block.url}
              disabled={disabled}
              placeholder="{{bookUrl}} or https://…"
              tags={["bookUrl", "websiteUrl"]}
              onChange={(url) => onChange({ ...block, url })}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-stone-500">
            <span className="flex items-center gap-2">
              Alignment <AlignPicker value={block.align} disabled={disabled} onChange={(align) => onChange({ ...block, align })} />
            </span>
            <span className="flex items-center gap-2">
              Style
              <span className="inline-flex rounded-lg bg-stone-100 p-0.5">
                {(["solid", "outline"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange({ ...block, variant: v })}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition ${
                      block.variant === v ? "bg-white text-stone-900 shadow-sm" : "text-stone-500"
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </span>
            </span>
          </div>
        </div>
      );
    case "promo":
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <TagInput
            value={block.title}
            disabled={disabled}
            maxLength={200}
            placeholder="Offer title"
            onChange={(title) => onChange({ ...block, title })}
          />
          <input
            className={`${fieldCls} font-mono uppercase tracking-wider`}
            value={block.code}
            disabled={disabled}
            maxLength={60}
            placeholder="PROMO CODE (optional)"
            onChange={(e) => onChange({ ...block, code: e.target.value })}
          />
          <textarea
            className={`${fieldCls} min-h-[72px] sm:col-span-2`}
            value={block.text}
            disabled={disabled}
            maxLength={1000}
            placeholder="Offer details — e.g. 20% off weekday jump passes"
            onChange={(e) => onChange({ ...block, text: e.target.value })}
          />
          <TagInput
            className="sm:col-span-2"
            value={block.url}
            disabled={disabled}
            placeholder="Claim link (optional)"
            tags={["bookUrl", "websiteUrl"]}
            onChange={(url) => onChange({ ...block, url })}
          />
        </div>
      );
    case "events":
      return (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-[1fr_9rem]">
            <TagInput
              value={block.title}
              disabled={disabled}
              maxLength={200}
              placeholder="Section title"
              onChange={(title) => onChange({ ...block, title })}
            />
            <select
              className={fieldCls}
              value={block.limit}
              disabled={disabled}
              onChange={(e) => onChange({ ...block, limit: Number(e.target.value) })}
            >
              {[3, 4, 5, 6, 8, 10].map((n) => (
                <option key={n} value={n}>
                  Show {n}
                </option>
              ))}
            </select>
          </div>
          <p className="rounded-lg bg-sky-50 px-3 py-2 text-[11px] text-sky-900 ring-1 ring-sky-100">
            Refreshed on every send with ticket sessions on sale in the next 45 days. The section is
            hidden automatically when nothing is on sale.
          </p>
        </div>
      );
    case "divider":
      return <div className="h-px bg-stone-200" />;
  }
}

function InsertSlot({ onPick, disabled }: { onPick: (t: CampaignBlockType) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  if (disabled) return <div className="h-2" />;
  return (
    <div ref={ref} className="group relative flex h-5 items-center justify-center">
      <div className="absolute inset-x-6 h-px bg-transparent transition group-hover:bg-[#D4AF37]/40" />
      <button
        type="button"
        aria-label="Insert block here"
        onClick={() => setOpen((v) => !v)}
        className={`relative z-10 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-[#8a7020] ring-1 ring-[#D4AF37]/50 transition ${
          open ? "scale-110 opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100"
        }`}
      >
        <Plus className="h-3 w-3" />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full z-30 mt-1 w-[min(34rem,90vw)] rounded-2xl border border-stone-200 bg-white p-2 shadow-xl shadow-stone-900/10"
          >
            <BlockPalette
              compact
              onPick={(t) => {
                onPick(t);
                setOpen(false);
              }}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default function BlockList({
  blocks,
  disabled,
  onChange,
}: {
  blocks: CampaignBlock[];
  disabled: boolean;
  onChange: (next: CampaignBlock[]) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [justAdded, setJustAdded] = useState<string | null>(null);

  useEffect(() => {
    if (!justAdded) return;
    const t = window.setTimeout(() => setJustAdded(null), 1500);
    return () => window.clearTimeout(t);
  }, [justAdded]);

  const insertAt = (index: number, type: CampaignBlockType) => {
    const b = emptyBlock(type);
    const next = blocks.slice();
    next.splice(index, 0, b);
    onChange(next);
    setJustAdded(b.id);
  };
  const update = (index: number, b: CampaignBlock) => {
    const next = blocks.slice();
    next[index] = b;
    onChange(next);
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= blocks.length || from === to) return;
    const next = blocks.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    onChange(next);
  };
  const duplicate = (index: number) => {
    const copy = { ...structuredClone(blocks[index]!), id: newBlockId() } as CampaignBlock;
    const next = blocks.slice();
    next.splice(index + 1, 0, copy);
    onChange(next);
    setJustAdded(copy.id);
  };
  const remove = (index: number) => onChange(blocks.filter((_, i) => i !== index));

  return (
    <div>
      {blocks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50/60 p-4">
          <p className="mb-3 text-center text-sm text-stone-500">Start building — pick your first block</p>
          {!disabled ? <BlockPalette onPick={(t) => insertAt(0, t)} /> : null}
        </div>
      ) : null}
      {blocks.map((block, index) => {
        const isCollapsed = collapsed[block.id] === true;
        const meta = BLOCK_META[block.type];
        return (
          <div key={block.id}>
            <InsertSlot disabled={disabled} onPick={(t) => insertAt(index, t)} />
            <motion.div
              layout="position"
              initial={justAdded === block.id ? { opacity: 0, y: 8, scale: 0.98 } : false}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              onDragOver={(e) => {
                if (dragIndex === null) return;
                e.preventDefault();
                setOverIndex(index);
              }}
              onDrop={(e) => {
                if (dragIndex === null) return;
                e.preventDefault();
                move(dragIndex, index);
                setDragIndex(null);
                setOverIndex(null);
              }}
              className={`overflow-visible rounded-2xl border bg-white shadow-sm transition ${
                justAdded === block.id ? "border-[#D4AF37] shadow-[#D4AF37]/20" : "border-stone-200/90"
              } ${dragIndex === index ? "opacity-50" : ""} ${
                overIndex === index && dragIndex !== null && dragIndex !== index
                  ? "ring-2 ring-[#D4AF37]/60"
                  : ""
              }`}
            >
              <div className="flex items-center gap-2 px-3 py-2">
                {!disabled ? (
                  <span
                    draggable
                    onDragStart={(e) => {
                      setDragIndex(index);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", block.id);
                    }}
                    onDragEnd={() => {
                      setDragIndex(null);
                      setOverIndex(null);
                    }}
                    title="Drag to reorder"
                    className="cursor-grab rounded-md p-0.5 text-stone-300 transition hover:bg-stone-100 hover:text-stone-600 active:cursor-grabbing"
                  >
                    <GripVertical className="h-4 w-4" />
                  </span>
                ) : null}
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#D4AF37]/12 text-[#8a7020]">
                  {meta.icon}
                </span>
                <button
                  type="button"
                  onClick={() => setCollapsed((c) => ({ ...c, [block.id]: !isCollapsed }))}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">
                    {meta.label}
                  </span>
                  {isCollapsed ? (
                    <span className="truncate text-xs text-stone-400">— {blockSummary(block)}</span>
                  ) : null}
                  <ChevronDown
                    className={`ml-auto h-3.5 w-3.5 shrink-0 text-stone-400 transition ${isCollapsed ? "-rotate-90" : ""}`}
                  />
                </button>
                {!disabled ? (
                  <div className="flex items-center">
                    <button
                      type="button"
                      aria-label="Move up"
                      title="Move up"
                      disabled={index === 0}
                      onClick={() => move(index, index - 1)}
                      className="rounded-md p-1 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Move down"
                      title="Move down"
                      disabled={index === blocks.length - 1}
                      onClick={() => move(index, index + 1)}
                      className="rounded-md p-1 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Duplicate block"
                      title="Duplicate"
                      onClick={() => duplicate(index)}
                      className="rounded-md p-1 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Remove block"
                      title="Remove"
                      onClick={() => remove(index)}
                      className="rounded-md p-1 text-stone-400 transition hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : null}
              </div>
              {!isCollapsed ? (
                <div className="px-3 pb-3">
                  <BlockEditor block={block} disabled={disabled} onChange={(b) => update(index, b)} />
                </div>
              ) : null}
            </motion.div>
          </div>
        );
      })}
      {blocks.length > 0 && !disabled ? (
        <div className="mt-3 rounded-2xl border border-dashed border-stone-200 p-2.5">
          <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400">
            Add a block
          </p>
          <BlockPalette compact onPick={(t) => insertAt(blocks.length, t)} />
        </div>
      ) : null}
    </div>
  );
}
