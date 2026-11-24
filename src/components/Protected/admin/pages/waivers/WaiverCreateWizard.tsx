"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  btnPrimaryClass,
  btnSecondaryClass,
  fieldClass,
} from "@/components/Protected/admin/pages/ticketing/ticketingUi";
import WaiverFieldDesigner, {
  type DraftField,
  fieldsToJson,
} from "@/components/Protected/admin/pages/waivers/WaiverFieldDesigner";
import WaiverVisitorPreview from "@/components/Protected/admin/pages/waivers/WaiverVisitorPreview";
import { READY_MADE_GUEST_WAIVER_ID, WAIVER_STARTERS } from "@/components/Protected/admin/pages/waivers/waiverStarters";
import { openWaiverPanel } from "@/components/Protected/admin/pages/waivers/waiverPanel";
import { createWaiverTemplate, waiverKeys } from "@/services/waivers";
import { fieldMapsToGuest, normalizeSharedRows, MAX_WAIVER_FIELDS } from "@/lib/waivers/presentation";
import { useHqLocationFilter } from "@/hooks/useHqLocationFilter";

const STEPS = ["Start", "Agreement", "Questions"] as const;

const KIND_LABELS: Record<string, string> = {
  liability_waiver: "Liability waiver",
  membership_contract: "Membership contract",
  booking_agreement: "Booking agreement",
  custom_form: "Custom form",
  inquiry: "Inquiry",
  event_form: "Event form",
  product_addon_form: "Product add-on form",
};

const DOCUMENT_KINDS = ["liability_waiver", "membership_contract", "booking_agreement"];
const FORM_KINDS = ["custom_form", "inquiry", "event_form", "product_addon_form"];

/** True when the agreement is only paragraphs and line breaks. */
export function isSimpleAgreement(html: string): boolean {
  return !/<(?!\/?(p|br)\b)[a-z]/i.test(html);
}

/** Turns a simple agreement into the sentences an admin can edit. */
export function plainAgreement(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/<\/?p>/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .trim();
}

/** Stores the words the guest reads as paragraphs, without asking the admin to write HTML. */
export function agreementHtml(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<p>${escaped.replace(/\n\n+/g, "</p><p>").replace(/\n/g, "<br>")}</p>`;
}

export default function WaiverCreateWizard({
  mode,
  onDone,
}: {
  mode: "documents" | "forms";
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const { locationId, parkLocked, scopedLocationName } = useHqLocationFilter();
  const starters = WAIVER_STARTERS.filter((row) => row.mode === mode);
  const opening =
    mode === "documents"
      ? starters.find((row) => row.id === READY_MADE_GUEST_WAIVER_ID) ?? starters[0]
      : starters.find((row) => row.id !== READY_MADE_GUEST_WAIVER_ID) ?? starters[0];
  const [step, setStep] = useState(0);
  const [starterId, setStarterId] = useState(opening?.id ?? "");
  const starter = starters.find((row) => row.id === starterId) ?? opening;
  const [name, setName] = useState(starter?.title ?? "");
  const [kind, setKind] = useState(starter?.kind ?? "");
  const [bodyHtml, setBodyHtml] = useState(() => plainAgreement(starter?.bodyHtml ?? ""));
  const [locale, setLocale] = useState("en");
  const [fields, setFields] = useState<DraftField[]>(() =>
    (starter?.fields ?? []).map((field) => ({ ...field }))
  );
  const [layoutId, setLayoutId] = useState(starter?.id === READY_MADE_GUEST_WAIVER_ID ? "wizard" : "classic");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [flowOpen, setFlowOpen] = useState(false);
  const readyMade = starters.find((row) => row.id === READY_MADE_GUEST_WAIVER_ID);
  const clauseCount = fields.filter((field) => field.type === "clause").length;
  const questionCount = fields.filter(
    (field) => !["clause", "page_break", "section", "html"].includes(field.type)
  ).length;
  const parkLabel = scopedLocationName
    ? scopedLocationName
    : parkLocked
      ? "no park selected yet"
      : "the whole company";

  useEffect(() => {
    if (kind !== "inquiry") return;
    setFields((current) => {
      if (!current.some((field) => field.type === "signature")) return current;
      return normalizeSharedRows(current.filter((field) => field.type !== "signature"));
    });
  }, [kind]);

  function applyStarter(next: (typeof starters)[number], questionsStep: boolean) {
    setStarterId(next.id);
    setName(next.title);
    setKind(next.kind);
    setBodyHtml(plainAgreement(next.bodyHtml));
    setFields(next.fields.map((field) => ({ ...field })));
    setLayoutId(next.id === READY_MADE_GUEST_WAIVER_ID ? "wizard" : "classic");
    if (questionsStep) setStep(2);
  }

  function choose(id: string) {
    const next = starters.find((row) => row.id === id);
    if (!next) return;
    applyStarter(next, false);
  }

  function editReadyMade() {
    setFlowOpen(false);
    setStep(2);
  }

  function goToStep(index: number) {
    if (index > 1 && (!name.trim() || !bodyHtml.trim())) {
      setStep(1);
      return;
    }
    setStep(index);
  }

  const hasSignature = fields.some((field) => field.type === "signature");
  const signatureOverride: boolean | null = !hasSignature ? false : layoutId === "wizard" ? true : null;

  const create = useMutation({
    mutationFn: () => {
      const missingChoices = fields.find(
        (field) =>
          (field.type === "select" || field.type === "radio") &&
          !field.options.split("|").some((option) => option.trim())
      );
      if (missingChoices) {
        throw new Error(
          `"${missingChoices.label || "Select"}" needs at least one choice. Open its gear and add them.`
        );
      }
      const repeatedChoice = fields.find((field) => {
        if (field.type !== "select" && field.type !== "radio" && field.type !== "checkbox") return false;
        const seen = new Set<string>();
        for (const option of field.options.split("|")) {
          const key = option.trim().toLowerCase();
          if (!key) continue;
          if (seen.has(key)) return true;
          seen.add(key);
        }
        return false;
      });
      if (repeatedChoice) {
        throw new Error(`"${repeatedChoice.label || "This question"}" has the same choice twice. Open its gear and make each choice different.`);
      }
      const seenAnswers = new Set<string>();
      for (const field of fields) {
        if (!field.mapsTo || !fieldMapsToGuest(field.type)) continue;
        if (seenAnswers.has(field.mapsTo)) {
          throw new Error(
            `Two questions are both saved as the same guest detail. Open each gear and keep that on only one question.`
          );
        }
        seenAnswers.add(field.mapsTo);
      }
      const blank = fields.find((field) => !field.label.trim());
      if (blank) throw new Error("Every question needs words the guest can read. Open its gear and add them.");
      if (fields.length > MAX_WAIVER_FIELDS) {
        throw new Error(`A form can have at most ${MAX_WAIVER_FIELDS} questions and agreement lines.`);
      }
      const seenIds = new Set<string>();
      for (const field of fields) {
        const id = field.id.trim();
        if (!id) throw new Error("Every question needs an id. Open its gear and set one.");
        if (seenIds.has(id)) throw new Error(`Two questions use the id ${id}. Open each gear and make them different.`);
        seenIds.add(id);
      }
      return createWaiverTemplate({
        name: name.trim(),
        kind,
        locationId: locationId || null,
        title: name.trim(),
        bodyHtml: agreementHtml(bodyHtml),
        localeDefault: locale === "es" ? "es" : "en",
        fieldsJson: fieldsToJson(fields),
        layoutId,
        displayMode: fields.some((field) => field.type === "page_break") ? "multi_step" : "single_page",
        allowDocumentExtract: fields.some((field) => field.type === "photo_reader"),
        allowTypedSignature: signatureOverride,
        allowDrawnSignature: signatureOverride,
      });
    },
    onSuccess: async () => {
      try {
        window.dispatchEvent(new Event("harewa:waivers-changed"));
      } catch {
        /* ignore */
      }
      await Promise.all([
        qc.invalidateQueries({
          queryKey: [...waiverKeys.all, "templates"],
          refetchType: "all",
        }),
        qc.invalidateQueries({
          queryKey: ["admin", "memberships", "attachable-forms"],
        }),
      ]);
      const fresh = opening ?? starters[0];
      if (fresh) applyStarter(fresh, false);
      setStep(0);
      setLocale("en");
      setPreviewOpen(false);
      setFlowOpen(false);
      onDone?.();
      openWaiverPanel("forms");
    },
  });

  const blocked = parkLocked && !locationId;
  const previewLocale = locale === "es" ? "es" : "en";
  const previewTitle = name.trim() || "Untitled";
  const previewVenue = scopedLocationName || "Your park";

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4">
      <p className="text-sm font-medium text-stone-800">
        {mode === "forms" ? "Create a form" : "Create a waiver"}
      </p>
      <ol className="mt-3 flex flex-wrap gap-2">
        {STEPS.map((label, index) => (
          <li key={label}>
            <button
              type="button"
              onClick={() => goToStep(index)}
              className={`rounded-full px-3 py-1 text-sm ${
                step === index ? "bg-[#D4AF37] font-semibold text-stone-950" : "bg-stone-100 text-stone-700"
              }`}
            >
              {index + 1}. {label}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {starters.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => choose(row.id)}
              className={`rounded-lg border p-3 text-left ${
                starterId === row.id ? "border-[#D4AF37] ring-1 ring-[#D4AF37]" : "border-stone-200"
              }`}
            >
              <p className="font-medium text-stone-900">{row.title}</p>
              <p className="mt-1 text-sm text-stone-600">{row.summary}</p>
            </button>
          ))}
        </div>
        <p className="mt-3 text-sm text-stone-600">
          {starter
            ? `${starter.title} is loaded: ${questionCount} guest question${questionCount === 1 ? "" : "s"} and ${clauseCount} agreement line${clauseCount === 1 ? "" : "s"}. This draft saves to ${parkLabel}. Next opens the agreement and the questions. Preview opens the page a guest sees.`
            : "Choose one, then Next."}
        </p>
        </>
      ) : null}

      {step === 1 ? (
        <div className="mt-4 grid gap-3">
          <label className="text-sm font-medium text-stone-800">
            {mode === "forms" ? "Name of this form" : "Name of this waiver"}
            <input className={`${fieldClass} mt-1`} maxLength={160} value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="text-sm font-medium text-stone-800">
            What kind of document is this?
            <select className={`${fieldClass} mt-1`} value={kind} onChange={(e) => setKind(e.target.value)}>
              {(mode === "forms" ? FORM_KINDS : DOCUMENT_KINDS).map((value) => (
                <option key={value} value={value}>
                  {KIND_LABELS[value] ?? value}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-stone-800">
            Language the guest reads
            <select className={`${fieldClass} mt-1`} value={locale === "es" ? "es" : "en"} onChange={(e) => setLocale(e.target.value)}>
              <option value="en">English</option>
              <option value="es">Spanish</option>
            </select>
          </label>
          <label className="text-sm font-medium text-stone-800">
            Words the guest reads
            <textarea className={`${fieldClass} mt-1 min-h-28`} value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} />
          </label>
          <p className="text-xs text-stone-500">
            Write the agreement in normal sentences. This is what the guest reads before the questions. Preview opens that page.
          </p>
          <p className="text-xs text-stone-500">This draft saves to {parkLabel}.</p>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="mt-4">
          <p className="mb-3 text-sm text-stone-600">
            These are the questions the guest answers. Rename each step in Step names, above the list. A page break starts the next step.
          </p>
          <WaiverFieldDesigner
            fields={fields}
            onChange={setFields}
            omitTypes={kind === "inquiry" ? ["signature"] : undefined}
          />
        </div>
      ) : null}

      {blocked ? (
        <p className="mt-3 text-sm text-stone-600">
          Select a park in the header before creating a template. Company-wide drafts are limited to company-wide seats.
        </p>
      ) : null}
      {step === STEPS.length - 1 && (!name.trim() || !bodyHtml.trim()) ? (
        <p className="mt-3 text-sm text-stone-600">
          Go back and add a name plus the words the guest reads. Those are required before this draft can be saved.
        </p>
      ) : null}
      {create.isError ? (
        <p className="mt-3 text-sm text-red-700">
          {create.error instanceof Error ? create.error.message : "Could not create this draft"}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2 border-t border-stone-200 bg-white pt-3">
        <button type="button" className={btnSecondaryClass} onClick={() => setPreviewOpen(true)}>
          Preview
        </button>
        {starterId === READY_MADE_GUEST_WAIVER_ID ? (
          <button type="button" className={btnSecondaryClass} onClick={() => setFlowOpen(true)}>
            Preview guest steps
          </button>
        ) : null}
        {step > 0 ? (
          <button type="button" className={btnSecondaryClass} onClick={() => setStep((current) => current - 1)}>
            Back
          </button>
        ) : null}
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            className={btnPrimaryClass}
            disabled={step === 1 && (!name.trim() || !bodyHtml.trim())}
            onClick={() => setStep((current) => current + 1)}
          >
            Next
          </button>
        ) : (
          <button
            type="button"
            className={btnPrimaryClass}
            disabled={create.isPending || blocked || !name.trim() || !bodyHtml.trim()}
            onClick={() => create.mutate()}
          >
            {create.isPending ? "Saving draft…" : "Save draft"}
          </button>
        )}
      </div>
      <WaiverVisitorPreview
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title={previewTitle}
        venueName={previewVenue}
        kind={kind}
        locale={previewLocale}
        bodyHtml={agreementHtml(bodyHtml)}
        fields={fields}
        layoutId={layoutId}
        displayMode={fields.some((field) => field.type === "page_break") ? "multi_step" : "single_page"}
        allowDocumentExtract={fields.some((field) => field.type === "photo_reader")}
        allowTypedSignature={signatureOverride}
        allowDrawnSignature={signatureOverride}
        settingsLocationId={locationId || null}
        loadSettings={!parkLocked || Boolean(locationId)}
      />
      {readyMade ? (
        <WaiverVisitorPreview
          open={flowOpen}
          onClose={() => setFlowOpen(false)}
          onEdit={editReadyMade}
          title={previewTitle}
          venueName={previewVenue}
          kind={kind}
          locale={previewLocale}
          bodyHtml={agreementHtml(bodyHtml)}
          fields={fields}
          layoutId={layoutId}
          displayMode={fields.some((field) => field.type === "page_break") ? "multi_step" : "single_page"}
          allowDocumentExtract={fields.some((field) => field.type === "photo_reader")}
          allowTypedSignature={signatureOverride}
          allowDrawnSignature={signatureOverride}
          settingsLocationId={locationId || null}
          loadSettings={!parkLocked || Boolean(locationId)}
          quiet
        />
      ) : null}
    </div>
  );
}
