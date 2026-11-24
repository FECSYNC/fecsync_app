"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import WaiverTabBar from "@/components/Protected/admin/pages/waivers/WaiverTabBar";
import { openWaiverPanel, useWaiverPanel, type WaiverPanelId } from "@/components/Protected/admin/pages/waivers/waiverPanel";

const WaiverTemplatesPage = dynamic(
  () => import("@/components/Protected/admin/pages/waivers/WaiverTemplatesPage"),
  { ssr: false, loading: () => <PanelLoading label="Loading…" /> }
);
const WaiverSignagePage = dynamic(
  () => import("@/components/Protected/admin/pages/waivers/WaiverSignagePage"),
  { ssr: false, loading: () => <PanelLoading label="Loading signage…" /> }
);
const WaiverKioskPage = dynamic(
  () => import("@/components/Protected/admin/pages/waivers/WaiverKioskPage"),
  { ssr: false, loading: () => <PanelLoading label="Loading kiosk…" /> }
);
const WaiverSettingsPage = dynamic(
  () => import("@/components/Protected/admin/pages/waivers/WaiverSettingsPage"),
  { ssr: false, loading: () => <PanelLoading label="Loading settings…" /> }
);

const TITLES: Record<WaiverPanelId, string> = {
  template: "Template",
  forms: "Forms",
  signage: "Signage",
  kiosk: "Kiosk",
  settings: "Settings",
};

function PanelLoading({ label }: { label: string }) {
  return <p className="text-sm text-stone-500">{label}</p>;
}

function PanelBody({ panel }: { panel: WaiverPanelId }) {
  if (panel === "template") return <WaiverTemplatesPage mode="documents" embedded />;
  if (panel === "forms") return <WaiverTemplatesPage mode="forms" embedded />;
  if (panel === "signage") return <WaiverSignagePage embedded />;
  if (panel === "kiosk") return <WaiverKioskPage embedded />;
  return <WaiverSettingsPage embedded />;
}

/** Covers the admin content column. The sidebar stays put. */
export default function WaiverSectionModal() {
  const panel = useWaiverPanel();

  useEffect(() => {
    if (!panel) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        openWaiverPanel(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panel]);

  if (!panel || typeof document === "undefined") return null;

  const node: ReactNode = (
    <div className="fixed inset-0 z-[45] flex flex-col lg:left-64" role="dialog" aria-modal="true" aria-labelledby="waiver-section-title">
      <button type="button" className="absolute inset-0 bg-stone-900/40" aria-label="Close" onClick={() => openWaiverPanel(null)} />
      <div className="relative z-[1] flex h-full w-full flex-col overflow-hidden bg-stone-50 shadow-xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 bg-white px-4 py-3 sm:px-6">
          <h2 id="waiver-section-title" className="text-base font-semibold text-stone-900">
            {TITLES[panel]}
          </h2>
          <button
            type="button"
            className="inline-flex h-9 items-center gap-2 rounded-md px-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
            aria-label="Close"
            title="Close"
            onClick={() => openWaiverPanel(null)}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Close
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
          <WaiverTabBar />
          <PanelBody panel={panel} />
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
