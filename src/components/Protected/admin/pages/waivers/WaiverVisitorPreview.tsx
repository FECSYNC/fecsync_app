"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import WaiverGuestFlow from "@/components/waivers/WaiverGuestFlow";
import type { GuestField, GuestFlowSession } from "@/components/waivers/guestFlowTypes";
import {
  type DraftField,
  fieldsToJson,
} from "@/components/Protected/admin/pages/waivers/WaiverFieldDesigner";
import { useAdminCompanyProfileQuery } from "@/hooks/useCompanyProfile";
import { sanitizeWaiverHtml } from "@/lib/waivers/sanitizeHtml";
import { getWaiverSettings, waiverDeskQueryOptions, waiverKeys } from "@/services/waivers";

const DEFAULT_SETTINGS: GuestFlowSession["settings"] = {
  ageOfMajorityYears: 18,
  allowAdultSelfSign: true,
  allowGroupSigning: true,
  maxMinorsPerGuardianSession: 8,
  requireGuardianForMinors: true,
  requireIntentCheckbox: true,
  allowTypedSignature: true,
  allowDrawnSignature: true,
  optionalWitness: false,
};

function guestFields(fields: DraftField[]): GuestField[] {
  return fieldsToJson(fields).map((row) => ({
    id: String(row.id),
    type: String(row.type),
    label: String(row.label),
    required: row.required === true,
    options: Array.isArray(row.options)
      ? row.options.filter((option): option is string => typeof option === "string")
      : [],
    help: typeof row.help === "string" ? row.help : "",
    mapsTo: typeof row.mapsTo === "string" ? row.mapsTo : "",
    section: typeof row.section === "string" ? row.section : "",
    ...(typeof row.row === "string" && row.row ? { row: row.row } : {}),
  }));
}

export default function WaiverVisitorPreview({
  open,
  onClose,
  title,
  venueName,
  kind,
  locale,
  bodyHtml,
  fields,
  layoutId,
  displayMode,
  allowDocumentExtract,
  allowTypedSignature,
  allowDrawnSignature,
  settingsLocationId,
  loadSettings,
  alternate = null,
  quiet = false,
  onEdit,
  embedded = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  venueName: string;
  kind: string;
  locale: string;
  bodyHtml: string;
  fields: DraftField[];
  layoutId: string;
  displayMode: string;
  allowDocumentExtract: boolean;
  allowTypedSignature: boolean | null;
  allowDrawnSignature: boolean | null;
  settingsLocationId: string | null;
  loadSettings: boolean;
  alternate?: { locale: string; title: string; bodyHtml: string } | null;
  /** Hide the visitor title so the guest steps fill the dialog. */
  quiet?: boolean;
  /** Opens the form builder on the questions step. Does not save. */
  onEdit?: () => void;
  /** Renders beside the builder so label edits show up without opening the dialog. */
  embedded?: boolean;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [activeLocale, setActiveLocale] = useState(locale);

  const settingsQuery = useQuery({
    queryKey: waiverKeys.settings(settingsLocationId || "org"),
    queryFn: () => getWaiverSettings(settingsLocationId),
    enabled: (open || embedded) && loadSettings,
    ...waiverDeskQueryOptions,
  });
  const profile = useAdminCompanyProfileQuery(open || embedded);

  useEffect(() => {
    if (open) setActiveLocale(locale);
  }, [open, locale]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  if (!embedded && (!open || typeof document === "undefined")) return null;

  const saved = settingsQuery.data;
  const settings: GuestFlowSession["settings"] = saved
    ? {
        ageOfMajorityYears: saved.ageOfMajorityYears,
        allowAdultSelfSign: saved.allowAdultSelfSign,
        allowGroupSigning: saved.allowGroupSigning,
        maxMinorsPerGuardianSession: saved.maxMinorsPerGuardianSession,
        requireGuardianForMinors: saved.requireGuardianForMinors,
        requireIntentCheckbox: saved.requireIntentCheckbox,
        allowTypedSignature: saved.allowTypedSignature,
        allowDrawnSignature: saved.allowDrawnSignature,
        optionalWitness: saved.optionalWitness,
      }
    : DEFAULT_SETTINGS;
  const brandName = profile.data?.displayName?.trim() || venueName;
  const logoUrl = profile.data?.logoUrl?.trim() || null;
  const showingAlternate = Boolean(alternate && activeLocale === alternate.locale);
  const shownTitle = showingAlternate && alternate ? alternate.title : title;
  const shownBody = showingAlternate && alternate ? alternate.bodyHtml : bodyHtml;
  const locales = alternate
    ? [
        { locale, title },
        { locale: alternate.locale, title: alternate.title },
      ]
    : [{ locale, title }];
  const session: GuestFlowSession = {
    state: "form",
    channel: "online",
    brand: { name: brandName, logoUrl },
    venueName,
    locale: showingAlternate && alternate ? alternate.locale : locale,
    locales,
    template: {
      id: "preview",
      kind: kind || "liability_waiver",
      name: shownTitle,
      versionId: "preview",
      contentSha256: "preview",
      title: shownTitle,
      bodyHtml: sanitizeWaiverHtml(shownBody),
      fields: guestFields(fields),
      layoutId,
      displayMode,
      allowDocumentExtract,
      allowTypedSignature,
      allowDrawnSignature,
      signatureRequired: kind !== "inquiry",
    },
    extraForms: [],
    settings,
    signingContext: {
      lockedEmail: null,
      bookingLabel: null,
      productLabel: null,
    },
  };

  const flow = (
    <WaiverGuestFlow
      mode="preview"
      session={session}
      onLocaleChange={alternate ? setActiveLocale : undefined}
    />
  );

  if (embedded) {
    return (
      <div className="mt-4 overflow-hidden rounded-2xl border border-stone-200 bg-stone-50">
        <p className="border-b border-stone-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">
          Guest preview
        </p>
        <div className="max-h-[70vh] overflow-y-auto p-4">{flow}</div>
      </div>
    );
  }

  return createPortal(
    <div
      ref={shellRef}
      className="waiver-preview fixed inset-0 z-[70] flex flex-col lg:left-64"
      role="dialog"
      aria-modal="true"
      aria-label="Visitor preview"
    >
      <style>{`
        @keyframes waiverPreviewIn {
          from { opacity: 0; transform: translateX(28px); }
          to { opacity: 1; transform: none; }
        }
        @keyframes waiverPreviewRise {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: none; }
        }
        .waiver-preview-panel { animation: waiverPreviewIn 0.42s cubic-bezier(0.22, 1, 0.36, 1); }
        .waiver-preview-card { animation: waiverPreviewRise 0.55s cubic-bezier(0.22, 1, 0.36, 1) 0.06s both; }
        .waiver-preview .waiver-guest-flow input,
        .waiver-preview .waiver-guest-flow select,
        .waiver-preview .waiver-guest-flow textarea {
          border-radius: 0.75rem;
          background: #fff;
          transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
        }
        .waiver-preview .waiver-guest-flow input:focus,
        .waiver-preview .waiver-guest-flow select:focus,
        .waiver-preview .waiver-guest-flow textarea:focus {
          outline: none;
          border-color: #D4AF37;
          box-shadow: 0 0 0 4px rgba(212, 175, 55, 0.22);
        }
        .waiver-preview .waiver-guest-flow section {
          animation: waiverPreviewRise 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        .waiver-preview .waiver-guest-flow section:nth-of-type(2) { animation-delay: 0.08s; }
        .waiver-preview .waiver-guest-flow section:nth-of-type(3) { animation-delay: 0.14s; }
        .waiver-preview .waiver-guest-flow section:nth-of-type(4) { animation-delay: 0.2s; }
        @media (prefers-reduced-motion: reduce) {
          .waiver-preview-panel,
          .waiver-preview-card,
          .waiver-preview .waiver-guest-flow section {
            animation: none;
          }
        }
      `}</style>
      <div className="waiver-preview-panel relative z-[1] flex h-full w-full flex-col overflow-hidden bg-stone-100 shadow-2xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#D4AF37]/40 bg-white px-4 py-3 sm:px-6">
          <p className="text-sm text-stone-600">
            {quiet
              ? "Walk through each step. Nothing here is signed or saved."
              : "This is the page a visitor opens. Nothing you type here is saved."}
          </p>
          <div className="flex shrink-0 items-center gap-2">
          {onEdit ? (
            <button
              type="button"
              className="inline-flex h-9 items-center rounded-full bg-[#D4AF37] px-3 text-sm font-semibold text-stone-950"
              onClick={onEdit}
            >
              Edit template
            </button>
          ) : null}
          <button
            ref={closeRef}
            type="button"
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-stone-200 bg-white px-3 text-sm font-medium text-stone-800 transition hover:border-[#D4AF37] hover:bg-[#D4AF37]/10"
            aria-label="Close"
            title="Close"
            onClick={onClose}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Close
          </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[radial-gradient(ellipse_at_top,_rgba(212,175,55,0.16),_transparent_55%)]">
          <main className="mx-auto max-w-3xl px-3 py-6 sm:px-4 sm:py-10">
            <article className="waiver-preview-card overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-[0_20px_50px_-24px_rgba(28,25,23,0.45)]">
              <div className="h-1.5 bg-gradient-to-r from-[#D4AF37] via-[#f3e2a4] to-[#D4AF37]" />
              <div className="px-4 py-6 sm:px-8 sm:py-8">
                <header className={quiet ? "mb-4" : "mb-6"}>
                  {quiet ? null : (
                  <p className="inline-flex items-center rounded-full bg-[#D4AF37]/15 px-2.5 py-1 text-xs font-semibold tracking-wide text-stone-800">
                    Visitor preview
                  </p>
                  )}
                  {logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoUrl} alt="" className="mt-4 h-10 w-auto" />
                  ) : null}
                  {quiet ? null : (
                    <>
                  <p className="mt-4 text-sm text-stone-500">{brandName}</p>
                  <h1 className="mt-1 text-2xl font-semibold tracking-tight text-stone-950 sm:text-3xl">{shownTitle}</h1>
                    </>
                  )}
                </header>
                {flow}
              </div>
            </article>
          </main>
        </div>
      </div>
    </div>,
    document.body
  );
}
