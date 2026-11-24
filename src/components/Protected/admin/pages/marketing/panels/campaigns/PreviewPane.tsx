"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Loader2, Monitor, Smartphone } from "lucide-react";
import type { MarketingCampaignPreview } from "@/services/marketing";

type Device = "desktop" | "mobile";
const DEVICE_WIDTH: Record<Device, number> = { desktop: 640, mobile: 375 };

export default function PreviewPane({
  preview,
  loading,
  error,
}: {
  preview: MarketingCampaignPreview | undefined;
  loading: boolean;
  error: string | null;
}) {
  const [device, setDevice] = useState<Device>("desktop");
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [stageWidth, setStageWidth] = useState(480);
  const [contentHeight, setContentHeight] = useState(900);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setStageWidth(entry!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const width = DEVICE_WIDTH[device];
  const scale = Math.min(1, (stageWidth - 16) / width);

  const measure = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    const h = doc?.documentElement?.scrollHeight ?? doc?.body?.scrollHeight;
    if (h && h > 0) setContentHeight(h);
    doc?.querySelectorAll("img").forEach((img) => {
      if (!img.complete) img.addEventListener("load", () => measure(), { once: true });
    });
  }, []);

  useEffect(() => {
    // Re-measure after fonts/images settle in the frame.
    const t = window.setTimeout(measure, 350);
    return () => window.clearTimeout(t);
  }, [preview?.html, device, measure]);

  const initial = (preview?.fromName ?? "?").trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="overflow-hidden rounded-2xl border border-stone-200/90 bg-white shadow-sm shadow-stone-900/5">
      <div className="flex items-center justify-between gap-2 border-b border-stone-200/80 px-3 py-2">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400">
          Live preview
          {loading ? <Loader2 className="h-3 w-3 animate-spin text-[#A6892A]" /> : null}
        </p>
        <div className="inline-flex rounded-lg bg-stone-100 p-0.5" role="radiogroup" aria-label="Preview device">
          {(
            [
              { id: "desktop", icon: <Monitor className="h-3.5 w-3.5" />, label: "Desktop" },
              { id: "mobile", icon: <Smartphone className="h-3.5 w-3.5" />, label: "Mobile" },
            ] as const
          ).map((d) => (
            <button
              key={d.id}
              type="button"
              role="radio"
              aria-checked={device === d.id}
              title={d.label}
              onClick={() => setDevice(d.id)}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition ${
                device === d.id ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-800"
              }`}
            >
              {d.icon}
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-start gap-3 border-b border-stone-100 bg-stone-50/70 px-3 py-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#D4AF37]/20 text-sm font-semibold text-[#7a6318]">
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-semibold text-stone-900">{preview?.fromName ?? "…"}</p>
            <span className="shrink-0 text-[11px] text-stone-400">now</span>
          </div>
          <p className="truncate text-sm font-medium text-stone-800">{preview?.subject || "(no subject)"}</p>
          <p className="truncate text-xs text-stone-500">
            {preview?.preheader || "Add preview text — it shows here in the inbox."}
          </p>
        </div>
      </div>

      <div ref={stageRef} className="bg-[repeating-linear-gradient(45deg,#fafaf9,#fafaf9_10px,#f5f5f4_10px,#f5f5f4_20px)] p-2">
        {error ? (
          <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>
        ) : preview ? (
          <div
            className="mx-auto overflow-hidden rounded-xl bg-white shadow-md ring-1 ring-stone-200 transition-[width] duration-300"
            style={{ width: width * scale, height: contentHeight * scale }}
          >
            <iframe
              ref={frameRef}
              title="Newsletter preview"
              sandbox="allow-same-origin"
              srcDoc={preview.html}
              onLoad={measure}
              scrolling="no"
              style={{
                width,
                height: contentHeight,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
                border: 0,
                display: "block",
              }}
            />
          </div>
        ) : (
          <div className="mx-auto h-[560px] max-w-[640px] animate-pulse rounded-xl bg-white" />
        )}
      </div>
    </div>
  );
}
