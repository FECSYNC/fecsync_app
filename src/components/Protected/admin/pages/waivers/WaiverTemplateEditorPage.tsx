"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import WaiverSubnav from "@/components/Protected/admin/pages/waivers/WaiverSubnav";
import {
  btnPrimaryClass,
  fieldClass,
} from "@/components/Protected/admin/pages/ticketing/ticketingUi";
import WaiverFieldDesigner, {
  fieldsFromJson,
  fieldsToJson,
} from "@/components/Protected/admin/pages/waivers/WaiverFieldDesigner";
import {
  agreementHtml,
  isSimpleAgreement,
  plainAgreement,
} from "@/components/Protected/admin/pages/waivers/WaiverCreateWizard";
import {
  DISPLAY_LABELS,
  DISPLAY_MODES,
  fieldMapsToGuest,
  LAYOUT_IDS,
  LAYOUT_LABELS,
  type WaiverDisplayMode,
  type WaiverLayoutId,
} from "@/lib/waivers/presentation";
import WaiverVisitorPreview from "@/components/Protected/admin/pages/waivers/WaiverVisitorPreview";
import { useHqLocationFilter } from "@/hooks/useHqLocationFilter";
import {
  createWaiverVersion,
  getWaiverTemplate,
  publishWaiverTemplate,
  updateWaiverTemplate,
  waiverKeys,
} from "@/services/waivers";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import type { DraftField } from "@/components/Protected/admin/pages/waivers/WaiverFieldDesigner";
import { getAdminVenueLocation, venueLocationKeys } from "@/services/venueLocations";

function withSavedTools(
  rows: DraftField[],
  draft: { allowDocumentExtract: boolean; allowTypedSignature: boolean | null; allowDrawnSignature: boolean | null },
  kind: string | undefined
): DraftField[] {
  const next = [...rows];
  if (draft.allowDocumentExtract && !next.some((field) => field.type === "photo_reader")) {
    next.unshift({
      id: "photo_reader",
      section: "guest",
      type: "photo_reader",
      label: "Photo reader",
      required: false,
      options: "",
      help: "",
      mapsTo: "",
    });
  }
  const signatureOff = draft.allowTypedSignature === false && draft.allowDrawnSignature === false;
  if (kind !== "inquiry" && !signatureOff && !next.some((field) => field.type === "signature")) {
    const row: DraftField = {
      id: "signature",
      section: "guest",
      type: "signature",
      label: "E-signature",
      required: true,
      options: "",
      help: "",
      mapsTo: "",
    };
    const clauseAt = next.findIndex((field) => field.type === "clause");
    if (clauseAt >= 0) next.splice(clauseAt, 0, row);
    else next.push(row);
  }
  return next;
}

function isLayout(value: string): value is WaiverLayoutId {
  return (LAYOUT_IDS as readonly string[]).includes(value);
}

function isDisplay(value: string): value is WaiverDisplayMode {
  return (DISPLAY_MODES as readonly string[]).includes(value);
}

export default function WaiverTemplateEditorPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const qc = useQueryClient();
  const can = useAuthStore((s) => s.can);
  const parkLocked = useAuthStore((s) => s.user?.parkLocked === true);
  const { locationId: headerLocationId, scopedLocationName } = useHqLocationFilter();
  const canAdmin = can(P.WaiversAdmin);
  const canWrite = can(P.WaiversWrite) || canAdmin;
  const query = useQuery({
    queryKey: waiverKeys.template(id),
    queryFn: () => getWaiverTemplate(id),
    enabled: Boolean(id),
    staleTime: 0,
    refetchOnMount: "always",
  });

  const draft = query.data?.versions.find((v) => v.status === "draft") ?? null;
  const [title, setTitle] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [locale, setLocale] = useState("en");
  const [extraLocale, setExtraLocale] = useState("");
  const [extraBody, setExtraBody] = useState("");
  const [fields, setFields] = useState<DraftField[]>([]);
  const [layoutId, setLayoutId] = useState<WaiverLayoutId>("classic");
  const [displayMode, setDisplayMode] = useState<WaiverDisplayMode>("single_page");
  const savedDisplayMode: WaiverDisplayMode = fields.some((field) => field.type === "page_break")
    ? "multi_step"
    : displayMode;
  const signatureChoice = ((): { allowTypedSignature: boolean | null; allowDrawnSignature: boolean | null } => {
    if (!fields.some((field) => field.type === "signature")) {
      return { allowTypedSignature: false, allowDrawnSignature: false };
    }
    const typed = draft?.allowTypedSignature ?? null;
    const drawn = draft?.allowDrawnSignature ?? null;
    if (typed === false && drawn === false) {
      return { allowTypedSignature: true, allowDrawnSignature: true };
    }
    return { allowTypedSignature: typed, allowDrawnSignature: drawn };
  })();
  const [guestPreviewOpen, setGuestPreviewOpen] = useState(false);
  const [agreementPlain, setAgreementPlain] = useState(true);
  const templateLocationId = query.data?.template.locationId ?? null;
  const pinnedVenue = useQuery({
    queryKey: venueLocationKeys.detail(templateLocationId || "none"),
    queryFn: () => getAdminVenueLocation(templateLocationId as string),
    enabled: guestPreviewOpen && Boolean(templateLocationId),
    staleTime: 60_000,
  });
  const previewVenue =
    (templateLocationId ? pinnedVenue.data?.name : null) || scopedLocationName || "Your park";
  const previewSettingsLocationId = templateLocationId || headerLocationId || null;
  const hydrated = useRef("");

  useEffect(() => {
    if (!draft) return;
    const token = [
      draft.id,
      draft.contentSha256,
      draft.title,
      draft.bodyHtml,
      draft.localeDefault,
      JSON.stringify(draft.fieldsJson),
      draft.layoutId,
      draft.displayMode,
      String(draft.allowDocumentExtract),
      String(draft.allowTypedSignature),
      String(draft.allowDrawnSignature),
    ].join("|");
    if (hydrated.current === token) return;
    hydrated.current = token;
    setTitle(draft.title);
    const simple = isSimpleAgreement(draft.bodyHtml);
    setAgreementPlain(simple);
    setBodyHtml(simple ? plainAgreement(draft.bodyHtml) : draft.bodyHtml);
    setLocale(draft.localeDefault);
    const extra = draft.locales.find((l) => l.locale !== draft.localeDefault);
    setExtraLocale(extra?.locale ?? "");
    setExtraBody(extra?.bodyHtml ?? "");
    setFields(withSavedTools(fieldsFromJson(draft.fieldsJson), draft, query.data?.template.kind));
    setLayoutId(isLayout(draft.layoutId) ? draft.layoutId : "classic");
    setDisplayMode(isDisplay(draft.displayMode) ? draft.displayMode : "single_page");
  }, [draft]);

  function draftBody() {
    const loc = locale.trim().toLowerCase();
    if (!/^[a-z]{2}(-[a-z]{2})?$/.test(loc)) {
      throw new Error("Language must be a short code such as en or es.");
    }
    const extra = extraLocale.trim().toLowerCase();
    if (extra && !/^[a-z]{2}(-[a-z]{2})?$/.test(extra)) {
      throw new Error("The additional language must be a short code such as es.");
    }
    const html = agreementPlain ? agreementHtml(bodyHtml) : bodyHtml;
    if (!html.trim()) throw new Error("Add the words the guest reads before saving.");
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
      if (!field.label.trim()) throw new Error("Every question needs words the guest can read. Open its gear and add them.");
      if (!field.mapsTo || !fieldMapsToGuest(field.type)) continue;
      if (seenAnswers.has(field.mapsTo)) {
        throw new Error(
          "Two questions are both saved as the same guest detail. Open each gear and keep that on only one question."
        );
      }
      seenAnswers.add(field.mapsTo);
    }
    const guestTitle = title.trim().slice(0, 160);
    if (!guestTitle) throw new Error("Add the name guests see on this agreement.");
    return {
      title: guestTitle,
      bodyHtml: html,
      localeDefault: loc,
      fieldsJson: fieldsToJson(fields),
      layoutId,
      displayMode: savedDisplayMode,
      allowDocumentExtract: fields.some((field) => field.type === "photo_reader"),
      allowTypedSignature: signatureChoice.allowTypedSignature,
      allowDrawnSignature: signatureChoice.allowDrawnSignature,
      locales: extra
        ? [
            {
              locale: extra,
              title: guestTitle,
              bodyHtml: extraBody.trim() ? extraBody : html,
              fieldsJson: fieldsToJson(fields),
            },
          ]
        : [],
    };
  }

  function refreshTemplateLists() {
    // Membership plan Forms picker listens for published form templates.
    try {
      window.dispatchEvent(new Event("harewa:waivers-changed"));
    } catch {
      /* ignore */
    }
    void qc.invalidateQueries({
      queryKey: ["admin", "memberships", "attachable-forms"],
    });
    return Promise.all([
      qc.invalidateQueries({ queryKey: waiverKeys.template(id), refetchType: "all" }),
      qc.invalidateQueries({ queryKey: [...waiverKeys.all, "templates"], refetchType: "all" }),
      qc.invalidateQueries({ queryKey: waiverKeys.requirements() }),
      qc.invalidateQueries({ queryKey: [...waiverKeys.all, "records"] }),
      qc.invalidateQueries({ queryKey: [...waiverKeys.all, "record"] }),
      qc.invalidateQueries({ queryKey: ["waiver-responses"] }),
    ]);
  }

  function draftPayload() {
    const draft = draftBody();
    // A published or archived template keeps its current name until publish copies the version title.
    if (query.data?.template.status !== "draft") return { draft };
    return { draft, name: draft.title.slice(0, 160) };
  }

  const save = useMutation({
    mutationFn: () => updateWaiverTemplate(id, draftPayload()),
    onSuccess: refreshTemplateLists,
  });

  const newVersion = useMutation({
    mutationFn: () => createWaiverVersion(id, {}),
    onSuccess: refreshTemplateLists,
  });

  const publish = useMutation({
    mutationFn: async () => {
      await updateWaiverTemplate(id, draftPayload());
      const versionId = draft?.id;
      return publishWaiverTemplate(id, versionId);
    },
    onSuccess: refreshTemplateLists,
  });

  function onSave(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  const versions = query.data?.versions ?? [];
  const orgDefaultLocked =
    parkLocked && query.data?.template != null && !query.data.template.locationId;
  const canEditDraft = canWrite && !orgDefaultLocked;
  const listHref = "/admin/waivers/forms";
  const listLabel = "Forms";
  const status = query.data?.template.status ?? "";
  const previewButtonClass =
    "inline-flex items-center justify-center rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-800 hover:border-[#D4AF37] hover:bg-[#D4AF37]/10";

  const previewProps = {
    title: title.trim() || "Untitled",
    venueName: previewVenue,
    kind: query.data?.template.kind ?? "liability_waiver",
    locale: locale === "es" ? "es" : locale || "en",
    bodyHtml: agreementPlain ? agreementHtml(bodyHtml) : bodyHtml,
    fields,
    layoutId,
    displayMode: savedDisplayMode,
    allowDocumentExtract: fields.some((field) => field.type === "photo_reader"),
    allowTypedSignature: signatureChoice.allowTypedSignature,
    allowDrawnSignature: signatureChoice.allowDrawnSignature,
    settingsLocationId: previewSettingsLocationId,
  };
  const alternateLocale =
    /^[a-z]{2}(-[a-z]{2})?$/.test(extraLocale.trim().toLowerCase()) &&
    extraLocale.trim().toLowerCase() !== (locale.trim().toLowerCase() || "en")
      ? {
          locale: extraLocale.trim().toLowerCase(),
          title: title.trim() || "Untitled",
          bodyHtml: extraBody.trim() ? extraBody : previewProps.bodyHtml,
        }
      : null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <Link href={listHref} className="text-sm font-medium text-stone-500 hover:text-stone-900">
        ← {listLabel}
      </Link>
      <div className="mt-3 flex flex-col gap-4 border-b border-stone-200 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-stone-900">
              {query.data?.template.name ?? "Template"}
            </h1>
            {status ? (
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${
                  status === "published"
                    ? "bg-[#D4AF37]/20 text-stone-900"
                    : status === "archived"
                      ? "bg-stone-200 text-stone-600"
                      : "bg-stone-100 text-stone-700"
                }`}
              >
                {status}
              </span>
            ) : null}
          </div>
          <p className="mt-1 max-w-xl text-sm text-stone-600">
            {status === "published"
              ? "This published version stays as it was. Start a new draft to change the words guests read."
              : "Guests cannot sign this until you publish it. Preview opens the page they would see."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {draft ? (
            <button type="button" className={previewButtonClass} onClick={() => setGuestPreviewOpen(true)}>
              Preview
            </button>
          ) : null}
          {draft && canEditDraft ? (
            <button className={btnPrimaryClass} type="submit" form="waiver-draft-form" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save draft"}
            </button>
          ) : null}
          {draft && canEditDraft && canAdmin ? (
            <button
              className={previewButtonClass}
              type="button"
              disabled={publish.isPending || save.isPending}
              onClick={() => publish.mutate()}
            >
              {publish.isPending ? "Publishing…" : "Publish"}
            </button>
          ) : null}
        </div>
      </div>

      {query.data?.template && canEditDraft ? (
        <label className="mt-4 flex items-start gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            className="mt-1 accent-[#D4AF37]"
            checked={query.data.template.requireResignOnPublish}
            onChange={(e) => {
              void updateWaiverTemplate(id, {
                requireResignOnPublish: e.target.checked,
              }).then(() => refreshTemplateLists());
            }}
          />
          Ask guests to sign again when a new version is published
        </label>
      ) : null}
      {draft && canEditDraft && !canAdmin ? (
        <p className="mt-3 text-xs text-stone-500">Publishing requires waiver admin.</p>
      ) : null}

      <div className="mt-4">
        <WaiverSubnav />
      </div>
      {query.isError ? (
        <p className="text-sm text-red-700">
          {query.error instanceof Error ? query.error.message : "Could not load template"}
        </p>
      ) : null}

      {orgDefaultLocked ? (
        <p className="mb-4 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">
          This template is company-wide. You can read it. Editing and publishing stay with a company-wide seat.
        </p>
      ) : null}

      {draft && canEditDraft ? (
        <form id="waiver-draft-form" onSubmit={onSave} className="mb-8 space-y-4">
          <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-stone-900">Agreement</h2>
            <p className="mt-1 text-sm text-stone-500">Draft version {draft.version}</p>
            <div className="mt-4 grid gap-4">
              <label className="text-sm font-medium text-stone-800">
                Name on the agreement
                <input className={`${fieldClass} mt-1 bg-white`} maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label className="text-sm font-medium text-stone-800">
                Language the guest reads
                {locale === "en" || locale === "es" ? (
                  <select className={`${fieldClass} mt-1 bg-white`} value={locale} onChange={(e) => setLocale(e.target.value)}>
                    <option value="en">English</option>
                    <option value="es">Spanish</option>
                  </select>
                ) : (
                  <input className={`${fieldClass} mt-1 bg-white`} value={locale} onChange={(e) => setLocale(e.target.value)} />
                )}
              </label>
              <label className="text-sm font-medium text-stone-800">
                Words the guest reads
                <textarea className={`${fieldClass} mt-1 min-h-40 bg-white`} value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} />
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm font-medium text-stone-800">
                  Second language
                  <input className={`${fieldClass} mt-1 bg-white`} placeholder="Optional, such as es" value={extraLocale} onChange={(e) => setExtraLocale(e.target.value)} />
                </label>
                <label className="text-sm font-medium text-stone-800">
                  Agreement in that language
                  <textarea className={`${fieldClass} mt-1 min-h-20 bg-white`} value={extraBody} onChange={(e) => setExtraBody(e.target.value)} />
                </label>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-stone-900">How guests move through it</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="text-sm font-medium text-stone-800">
                Layout
                <select
                  className={`${fieldClass} mt-1 bg-white`}
                  value={layoutId}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (!isLayout(next)) return;
                    setLayoutId(next);
                  }}
                >
                  {LAYOUT_IDS.map((layout) => (
                    <option key={layout} value={layout}>
                      {LAYOUT_LABELS[layout]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium text-stone-800">
                Movement
                <select
                  className={`${fieldClass} mt-1 bg-white`}
                  value={savedDisplayMode}
                  disabled={fields.some((field) => field.type === "page_break")}
                  onChange={(e) => {
                    if (isDisplay(e.target.value)) setDisplayMode(e.target.value);
                  }}
                >
                  {DISPLAY_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {DISPLAY_LABELS[mode]}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs font-normal text-stone-500">
                  A page break splits the form into steps. Without one, the movement you pick here is what guests get.
                </span>
              </label>
            </div>
            <p className="mt-3 text-sm text-stone-600">
              {LAYOUT_LABELS[layoutId]} · {DISPLAY_LABELS[savedDisplayMode]}
              {fields.some((field) => field.type === "photo_reader") ? " · photo reader on" : " · photo reader off"}
              {fields.some((field) => field.type === "signature") ? " · e-signature on" : " · e-signature off"}
            </p>
          </section>

          <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-stone-900">Questions</h2>
            <p className="mb-3 mt-1 text-sm text-stone-600">
              Rename each step in Step names, above the list. Insert a photo reader, an e-signature, a page break, or any other question below it.
            </p>
            <WaiverFieldDesigner
              fields={fields}
              onChange={setFields}
              omitTypes={query.data?.template.kind === "inquiry" ? ["signature"] : undefined}
            />
          </section>

          {save.isError || publish.isError ? (
            <p className="text-sm text-red-700">
              {(save.error ?? publish.error) instanceof Error
                ? ((save.error ?? publish.error) as Error).message
                : "Action failed"}
            </p>
          ) : null}
          {save.isSuccess && !publish.isSuccess ? (
            <p className="text-sm text-stone-700">Draft saved.</p>
          ) : null}
          {publish.isSuccess ? (
            <p className="text-sm text-stone-700">Published. Guests now sign this version.</p>
          ) : null}
        </form>
      ) : (
        <div className="mb-6 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-stone-600">No open draft. Start a new version to change the agreement.</p>
          {canEditDraft ? (
            <button className={`${btnPrimaryClass} mt-3`} type="button" onClick={() => newVersion.mutate()} disabled={newVersion.isPending}>
              {newVersion.isPending ? "Starting…" : "New draft version"}
            </button>
          ) : null}
          {newVersion.isError ? (
            <p className="mt-2 text-sm text-red-700">
              {newVersion.error instanceof Error ? newVersion.error.message : "Could not create version"}
            </p>
          ) : null}
        </div>
      )}

      <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-base font-semibold text-stone-900">Version history</h2>
        <ul className="divide-y divide-stone-200">
          {versions.map((v) => (
            <li key={v.id} className="py-3 text-sm first:pt-0 last:pb-0">
              <p className="font-medium text-stone-900">
                Version {v.version}
                <span className="ml-2 text-xs font-semibold uppercase tracking-wide text-stone-500">{v.status}</span>
                {query.data?.template.currentPublishedVersionId === v.id ? (
                  <span className="ml-2 text-xs font-semibold text-[#8a7030]">Current</span>
                ) : null}
              </p>
              <p className="mt-1 text-stone-600">
                {(isLayout(v.layoutId) ? LAYOUT_LABELS[v.layoutId] : v.layoutId) || "Classic"}
                {" · "}
                {(isDisplay(v.displayMode) ? DISPLAY_LABELS[v.displayMode] : v.displayMode) || "Single page"}
                {v.publishedAt ? ` · ${new Date(v.publishedAt).toLocaleString()}` : ""}
                {v.publishedByName ? ` · ${v.publishedByName}` : ""}
              </p>
              <p className="mt-1 text-stone-500">
                Languages: {v.locales.map((l) => l.locale).join(", ") || v.localeDefault}
              </p>
              <p className="mt-2 line-clamp-3 text-stone-700">
                {v.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <WaiverVisitorPreview
        open={guestPreviewOpen}
        onClose={() => setGuestPreviewOpen(false)}
        {...previewProps}
        loadSettings={!parkLocked || Boolean(previewSettingsLocationId)}
        alternate={alternateLocale}
      />
    </div>
  );
}
