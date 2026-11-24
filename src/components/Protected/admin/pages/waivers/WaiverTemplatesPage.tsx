"use client";

import { useEffect, useState } from "react";
import AdminPendingLink from "@/components/Protected/admin/components/AdminPendingLink";
import { openWaiverPanel } from "@/components/Protected/admin/pages/waivers/waiverPanel";
import WaiverCreateWizard from "@/components/Protected/admin/pages/waivers/WaiverCreateWizard";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import WaiverSubnav from "@/components/Protected/admin/pages/waivers/WaiverSubnav";
import {
  btnPrimaryClass,
  btnSecondaryClass,
  fieldClass,
} from "@/components/Protected/admin/pages/ticketing/ticketingUi";
import {
  createWaiverRequirement,
  deleteWaiverRequirement,
  listWaiverRequirements,
  listWaiverTemplates,
  updateWaiverTemplate,
  waiverDeskQueryOptions,
  waiverKeys,
  type WaiverTemplateDto,
} from "@/services/waivers";
import { useHqLocationFilter } from "@/hooks/useHqLocationFilter";
import { P } from "@/lib/auth/permissions";
import { useAuthStore } from "@/store/authStore";
import { api, unwrap, type MaybeWrapped } from "@/utils/api";

const KIND_LABELS: Record<string, string> = {
  liability_waiver: "Liability waiver",
  membership_contract: "Membership contract",
  booking_agreement: "Booking agreement",
  custom_form: "Custom form",
  inquiry: "Inquiry",
  event_form: "Event form",
  product_addon_form: "Product add-on form",
};

export default function WaiverTemplatesPage({
  mode,
  embedded = false,
}: {
  mode: "documents" | "forms";
  embedded?: boolean;
}) {
  const qc = useQueryClient();
  const can = useAuthStore((s) => s.can);
  const canWrite = can(P.WaiversWrite);
  const canExport = can(P.WaiversExport);
  const { locationId } = useHqLocationFilter();
  const [extraForm, setExtraForm] = useState(false);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const parkKey = locationId || "all";

  const list = useQuery({
    queryKey: [...waiverKeys.templates(mode === "forms" ? "all" : mode), parkKey],
    queryFn: () => listWaiverTemplates(mode === "forms" ? "all" : mode),
    enabled: mode === "forms",
    ...waiverDeskQueryOptions,
  });

  const templates = (list.data ?? []).filter(
    (row) => row.status !== "archived" && !row.archivedAt && !hiddenIds.includes(row.id)
  );

  return (
    <div className={embedded ? "" : "mx-auto max-w-5xl px-4 py-6"}>
      {embedded ? null : (
        <h1 className="text-2xl font-semibold text-stone-900">
          {mode === "forms" ? "Forms" : "Template"}
        </h1>
      )}
      <p className="mt-1 text-sm text-stone-600">
        {mode === "forms"
          ? "Every waiver and form you save is listed here. The Actions menu opens the designer, responses, export, and remove."
          : "Start from the ready-made guest waiver, or pick another template. Next takes you through the agreement and the questions. Saving adds it to Forms."}
      </p>
      {embedded ? null : <WaiverSubnav />}
      {mode === "forms" ? (
        <>
          <CreatedFormsTable
            templates={templates}
            loading={list.isLoading}
            failed={list.isError}
            error={list.isError ? (list.error instanceof Error ? list.error.message : "Could not load forms") : ""}
            canWrite={canWrite}
            canExport={canExport}
            onRemove={async (id) => {
              setHiddenIds((current) => (current.includes(id) ? current : [...current, id]));
              try {
                await updateWaiverTemplate(id, { status: "archived" });
                try {
                  window.dispatchEvent(new Event("harewa:waivers-changed"));
                } catch {
                  /* ignore */
                }
                await Promise.all([
                  qc.invalidateQueries({ queryKey: [...waiverKeys.all, "templates"] }),
                  qc.invalidateQueries({ queryKey: waiverKeys.requirements() }),
                  qc.invalidateQueries({ queryKey: waiverKeys.kiosks() }),
                  qc.invalidateQueries({
                    queryKey: ["admin", "memberships", "attachable-forms"],
                  }),
                ]);
              } catch (err) {
                setHiddenIds((current) => current.filter((item) => item !== id));
                throw err;
              }
            }}
          />
          <WaiverRequiredPanel templates={templates} canWrite={canWrite} templatesLoading={list.isLoading} />
          {canWrite ? (
            <div className="mt-8">
              <button type="button" className={btnSecondaryClass} onClick={() => setExtraForm((open) => !open)}>
                {extraForm ? "Hide inquiry and event form" : "Create an inquiry or event form"}
              </button>
              {extraForm ? (
                <div className="mt-4">
                  <WaiverCreateWizard mode="forms" />
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <div className="mb-8">
          <WaiverCreateWizard mode={mode} />
        </div>
      )}

    </div>
  );
}

const REQUIRE_LABELS: Record<string, string> = {
  all_admissions: "All admissions",
  admission_product: "A ticket",
  membership_plan: "A membership",
  party_package: "A party package",
  pos_product: "A POS product",
};

function WaiverRequiredPanel({
  templates,
  canWrite,
  templatesLoading,
}: {
  templates: WaiverTemplateDto[];
  canWrite: boolean;
  templatesLoading: boolean;
}) {
  const qc = useQueryClient();
  const { locationId, parkLocked } = useHqLocationFilter();
  const [targetType, setTargetType] = useState("all_admissions");
  const [targetId, setTargetId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const needsCatalog = targetType === "admission_product" || targetType === "membership_plan" || targetType === "pos_product";
  const published = templates.filter(
    (row) =>
      row.status === "published" &&
      !row.archivedAt &&
      (!locationId || !row.locationId || row.locationId === locationId)
  );

  const requirements = useQuery({
    queryKey: [...waiverKeys.requirements(), locationId || "all"],
    queryFn: listWaiverRequirements,
    ...waiverDeskQueryOptions,
  });
  const targets = useQuery({
    queryKey: ["waiver-targets", targetType, locationId || "all"],
    queryFn: async () => {
      const raw = await api<MaybeWrapped<{ targets: { id: string; name: string; locationId?: string | null }[]; help?: string }>>(
        `/api/admin/waivers/targets?type=${encodeURIComponent(targetType)}`,
        { method: "GET", credentials: "include" }
      );
      return unwrap(raw);
    },
    enabled: needsCatalog,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const names = useQuery({
    queryKey: ["waiver-target-names"],
    queryFn: async () => {
      const types = ["admission_product", "membership_plan", "pos_product"] as const;
      const lists = await Promise.all(
        types.map(async (type) => {
          const raw = await api<MaybeWrapped<{ targets: { id: string; name: string }[] }>>(
            `/api/admin/waivers/targets?type=${type}`,
            { method: "GET", credentials: "include" }
          );
          return unwrap(raw)?.targets ?? [];
        })
      );
      return new Map(lists.flat().map((row) => [row.id, row.name]));
    },
  });

  const addReq = useMutation({
    mutationFn: () =>
      createWaiverRequirement({
        templateId,
        locationId: locationId || null,
        targetType,
        targetId: targetType === "all_admissions" ? null : targetId || null,
        enforcement: "block",
      }),
    onSuccess: async () => {
      setTargetId("");
      await qc.invalidateQueries({ queryKey: waiverKeys.requirements() });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("harewa:waivers-changed"));
      }
    },
  });
  const removeReq = useMutation({
    mutationFn: (id: string) => deleteWaiverRequirement(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: waiverKeys.requirements() });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("harewa:waivers-changed"));
      }
    },
  });

  const catalog = (targets.data?.targets ?? []).filter(
    (row) => !locationId || !row.locationId || row.locationId === locationId
  );
  const needsId = targetType !== "all_admissions";

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash !== "#requirements") return;
    const el = document.getElementById("requirements");
    if (!el) return;
    const t = window.setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <section
      id="requirements"
      className="mt-8 scroll-mt-24 rounded-lg border border-stone-200 bg-white p-4"
    >
      <h2 className="text-base font-semibold text-stone-900">Required before entry</h2>
      <p className="mt-1 text-sm text-stone-600">
        After a form is published, choose where guests must sign it. Booking emails and the desk use this list. Saving a draft does not turn it on.
      </p>
      {templatesLoading ? (
        <p className="mt-3 text-sm text-stone-500">Loading published forms…</p>
      ) : published.length === 0 ? (
        <p className="mt-3 text-sm text-stone-600">Publish a form from its editor before you can require it.</p>
      ) : canWrite ? (
        <form
          className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            if (parkLocked && !locationId) return;
            if (needsId && !targetId.trim()) return;
            addReq.mutate();
          }}
        >
          <select className={fieldClass} value={templateId} onChange={(e) => setTemplateId(e.target.value)} required aria-label="Published form">
            <option value="">Published form</option>
            {published.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
          <select
            className={fieldClass}
            value={targetType}
            aria-label="Where it is required"
            onChange={(e) => {
              setTargetType(e.target.value);
              setTargetId("");
            }}
          >
            {Object.entries(REQUIRE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {needsId && targets.isLoading ? (
            <span className="self-center text-sm text-stone-500">Loading…</span>
          ) : needsId && catalog.length > 0 ? (
            <select className={fieldClass} value={targetId} onChange={(e) => setTargetId(e.target.value)} required aria-label="Product or plan">
              <option value="">Choose one</option>
              {catalog.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          ) : needsId ? (
            <input
              className={fieldClass}
              placeholder={targetType === "party_package" ? "Party package id" : "Product or plan id"}
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              required
              aria-label="Product or plan id"
            />
          ) : (
            <span className="self-center text-sm text-stone-500">Every admission at this company</span>
          )}
          <button className={btnPrimaryClass} type="submit" disabled={addReq.isPending || (parkLocked && !locationId)}>
            {addReq.isPending ? "Saving…" : "Require"}
          </button>
        </form>
      ) : null}
      {needsId && !targets.isLoading && catalog.length === 0 && published.length > 0 && canWrite ? (
        <p className="mt-2 text-xs text-stone-500">
          {targetType === "party_package"
            ? "Enter the party package id from Parties."
            : "No named list is available yet. Enter the id from Tickets or Memberships."}
        </p>
      ) : null}
      {addReq.isError ? (
        <p className="mt-2 text-sm text-red-700">{addReq.error instanceof Error ? addReq.error.message : "Could not save this rule"}</p>
      ) : null}
      {removeReq.isError ? (
        <p className="mt-2 text-sm text-red-700">{removeReq.error instanceof Error ? removeReq.error.message : "Could not remove this rule"}</p>
      ) : null}
      {requirements.isError ? (
        <p className="mt-2 text-sm text-red-700">
          {requirements.error instanceof Error ? requirements.error.message : "Could not load entry rules"}
        </p>
      ) : null}
      <ul className="mt-4 text-sm">
        {(requirements.data ?? []).map((req) => {
          const named = req.targetId ? names.data?.get(req.targetId) : "";
          const where = REQUIRE_LABELS[req.targetType] ?? req.targetType;
          return (
            <li key={req.id} className="flex items-center justify-between gap-3 border-t border-stone-100 py-2">
              <span>
                <span className="font-medium text-stone-900">{req.templateName}</span>
                <span className="text-stone-600"> · {named || where}</span>
              </span>
              {parkLocked && !req.locationId ? (
                <span className="text-xs text-stone-500">Company-wide</span>
              ) : canWrite ? (
                <button type="button" className="text-sm text-red-700 underline" onClick={() => removeReq.mutate(req.id)}>
                  Remove
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {!requirements.isLoading && !requirements.isError && (requirements.data ?? []).length === 0 ? (
        <p className="mt-3 text-sm text-stone-500">No entry rules yet. Guests can still sign from a link, a sign, or the kiosk.</p>
      ) : null}
    </section>
  );
}

function CreatedFormsTable({
  templates,
  loading,
  failed,
  error,
  canWrite,
  canExport,
  onRemove,
}: {
  templates: WaiverTemplateDto[];
  loading: boolean;
  failed: boolean;
  error: string;
  canWrite: boolean;
  canExport: boolean;
  onRemove: (id: string) => Promise<void>;
}) {
  const [removeError, setRemoveError] = useState("");

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-stone-600">{loading ? "Loading forms…" : `${templates.length} saved`}</p>
        {canWrite ? (
          <button type="button" className={btnPrimaryClass} onClick={() => openWaiverPanel("template")}>
            Create a waiver
          </button>
        ) : null}
      </div>
      {error ? <p className="mb-3 text-sm text-red-700">{error}</p> : null}
      {removeError ? <p className="mb-3 text-sm text-red-700">{removeError}</p> : null}
      {loading ? <p className="text-sm text-stone-500">Loading…</p> : null}
      {!loading && !failed && templates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-8 text-center">
          <p className="font-medium text-stone-800">No forms yet</p>
          <p className="mt-1 text-sm text-stone-600">Create a waiver and it will show up in this table.</p>
        </div>
      ) : null}
      {templates.length > 0 ? (
        <div className="rounded-lg border border-stone-200">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-stone-500">
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((row, index) => (
                <tr key={row.id} className="border-b border-stone-100">
                  <td className="px-3 py-2 text-stone-500">{index + 1}</td>
                  <td className="px-3 py-2 font-medium text-stone-900">{row.name}</td>
                  <td className="px-3 py-2">{KIND_LABELS[row.kind] ?? row.kind}</td>
                  <td className="px-3 py-2 capitalize">
                    {row.status}
                    {row.publishedVersion != null ? ` · v${row.publishedVersion}` : ""}
                  </td>
                  <td className="px-3 py-2">
                    <details className="relative">
                      <summary className="cursor-pointer list-none rounded border border-stone-300 bg-white px-2 py-1 text-xs font-semibold text-stone-800 [&::-webkit-details-marker]:hidden">
                        Actions
                      </summary>
                      <div className="absolute right-0 z-20 mt-1 min-w-44 rounded-md border border-stone-200 bg-white py-1 shadow-lg">
                        <AdminPendingLink
                          href={`/admin/waivers/templates/${row.id}`}
                          cornerSpinner={false}
                          className="block px-3 py-1.5 text-xs text-stone-800 hover:bg-stone-50"
                        >
                          Edit
                        </AdminPendingLink>
                        <AdminPendingLink
                          href={`/admin/waivers/forms/responses?templateId=${encodeURIComponent(row.id)}`}
                          cornerSpinner={false}
                          className="block px-3 py-1.5 text-xs text-stone-800 hover:bg-stone-50"
                        >
                          Responses
                        </AdminPendingLink>
                        {canExport ? (
                          <a
                            className="block px-3 py-1.5 text-xs text-stone-800 hover:bg-stone-50"
                            href={`/api/admin/waivers/export?type=responses&templateId=${encodeURIComponent(row.id)}`}
                          >
                            Export responses
                          </a>
                        ) : null}
                        {canWrite ? (
                          <button
                            type="button"
                            className="block w-full px-3 py-1.5 text-left text-xs text-red-700 hover:bg-red-50"
                            onClick={() => {
                              if (!window.confirm(`Remove “${row.name}”? Signed waivers stay on record. New guests will not see this form.`)) {
                                return;
                              }
                              setRemoveError("");
                              void onRemove(row.id).catch((err: unknown) => {
                                setRemoveError(err instanceof Error ? err.message : "Could not remove this form");
                              });
                            }}
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
