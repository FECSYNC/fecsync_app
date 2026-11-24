"use client";

import Link from "next/link";
import {
  FormEvent,
  useDeferredValue,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  ClipboardList,
  FileEdit,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMarketingSurveys } from "@/hooks/useMarketing";
import {
  createMarketingSurvey,
  marketingKeys,
  patchMarketingSurvey,
} from "@/services/marketing";
import type { GuestSurveyDto } from "@/lib/marketing/types";
import { notifyMarketingChange } from "@/lib/marketingSync";

type StatusFilter = "all" | "draft" | "published" | "archived";

function LiveChip({ syncing }: { syncing: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-200/80">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
      </span>
      {syncing ? "Syncing…" : "Live"}
    </span>
  );
}

function StatPill({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: ReactNode;
}) {
  return (
    <div className="flex min-w-[7.5rem] flex-1 items-center gap-2.5 rounded-xl border border-stone-200/90 bg-white px-3 py-2.5 shadow-sm shadow-stone-900/5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#D4AF37]/15 text-[#8a7020] ring-1 ring-[#D4AF37]/25">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-500">
          {label}
        </p>
        <p className="text-lg font-semibold tabular-nums leading-tight text-stone-900">
          {value.toLocaleString()}
        </p>
      </div>
    </div>
  );
}

function statusChip(status: string) {
  if (status === "published") {
    return "bg-emerald-50 text-emerald-800 ring-emerald-200";
  }
  if (status === "archived") {
    return "bg-stone-100 text-stone-600 ring-stone-200";
  }
  return "bg-amber-50 text-amber-900 ring-amber-200/80";
}

export default function MarketingSurveysPanel() {
  const surveys = useMarketingSurveys();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const deferredQ = useDeferredValue(q.trim().toLowerCase());
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [, startFilterTransition] = useTransition();
  const [note, setNote] = useState<{ tone: "ok" | "err"; text: string } | null>(
    null
  );

  const create = useMutation({
    mutationFn: (surveyName: string) =>
      createMarketingSurvey({
        name: surveyName,
        questions: [
          { id: "rating", type: "rating", label: "How was your visit?" },
        ],
      }),
    onMutate: async (surveyName) => {
      await qc.cancelQueries({ queryKey: marketingKeys.surveys() });
      const prev = qc.getQueryData<GuestSurveyDto[]>(marketingKeys.surveys());
      const optimistic: GuestSurveyDto = {
        id: `temp-${Date.now()}`,
        orgId: "",
        locationId: null,
        name: surveyName,
        slug: "",
        status: "draft",
        questions: [],
        thankYouMessage: null,
        promoUrl: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      qc.setQueryData<GuestSurveyDto[]>(marketingKeys.surveys(), (old) => [
        optimistic,
        ...(old ?? []),
      ]);
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(marketingKeys.surveys(), ctx.prev);
      }
      setNote({
        tone: "err",
        text: err instanceof Error ? err.message : "Could not create survey",
      });
    },
    onSuccess: (created) => {
      setName("");
      setNote({
        tone: "ok",
        text: `Draft “${created.name}” created. Overview survey counts will refresh.`,
      });
    },
    onSettled: () => {
      notifyMarketingChange(qc);
    },
  });

  const publish = useMutation({
    mutationFn: (id: string) =>
      patchMarketingSurvey(id, { status: "published" }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: marketingKeys.surveys() });
      const prev = qc.getQueryData<GuestSurveyDto[]>(marketingKeys.surveys());
      qc.setQueryData<GuestSurveyDto[]>(marketingKeys.surveys(), (old) =>
        (old ?? []).map((s) =>
          s.id === id ? { ...s, status: "published" } : s
        )
      );
      return { prev };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(marketingKeys.surveys(), ctx.prev);
      }
      setNote({
        tone: "err",
        text: err instanceof Error ? err.message : "Could not publish survey",
      });
    },
    onSuccess: (s) => {
      setNote({
        tone: "ok",
        text: `“${s.name}” is published — post-visit invites can use it.`,
      });
    },
    onSettled: () => {
      notifyMarketingChange(qc);
    },
  });

  function onCreate(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || create.isPending) return;
    setNote(null);
    create.mutate(trimmed);
  }

  const rows = surveys.data ?? [];
  const filtered = useMemo(() => {
    return rows.filter((s) => {
      if (filter !== "all" && s.status !== filter) return false;
      if (!deferredQ) return true;
      return (
        s.name.toLowerCase().includes(deferredQ) ||
        s.slug.toLowerCase().includes(deferredQ)
      );
    });
  }, [rows, filter, deferredQ]);

  const draftCount = rows.filter((s) => s.status === "draft").length;
  const publishedCount = rows.filter((s) => s.status === "published").length;
  const syncing = surveys.isFetching && !surveys.isLoading;

  const filters: { id: StatusFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "draft", label: "Draft" },
    { id: "published", label: "Published" },
    { id: "archived", label: "Archived" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-xl text-sm leading-relaxed text-stone-600">
          Draft and publish post-visit surveys. Published surveys power
          automation invites and feed the overview response KPIs.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <LiveChip syncing={syncing} />
          {surveys.dataUpdatedAt ? (
            <span className="text-[11px] text-stone-400">
              Updated {new Date(surveys.dataUpdatedAt).toLocaleTimeString()}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void surveys.refetch()}
            disabled={surveys.isFetching}
            className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-[11px] font-medium text-stone-700 shadow-sm transition hover:border-[#D4AF37]/50 disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${surveys.isFetching ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2.5">
        <StatPill
          label="Total"
          value={rows.length}
          icon={<ClipboardList className="h-3.5 w-3.5" strokeWidth={2} />}
        />
        <StatPill
          label="Draft"
          value={draftCount}
          icon={<FileEdit className="h-3.5 w-3.5" strokeWidth={2} />}
        />
        <StatPill
          label="Published"
          value={publishedCount}
          icon={<ClipboardList className="h-3.5 w-3.5" strokeWidth={2} />}
        />
      </div>

      <form
        onSubmit={onCreate}
        className="overflow-hidden rounded-2xl border border-[#D4AF37]/35 bg-gradient-to-br from-[#D4AF37]/12 via-[#faf8f4] to-white p-4 shadow-sm"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#A6892A]">
          New survey
        </p>
        <p className="mt-0.5 text-xs text-stone-500">
          Starts as a draft with a default visit rating question.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            className="min-w-0 flex-1 rounded-xl border-0 bg-white px-3.5 py-2.5 text-sm text-stone-900 ring-1 ring-stone-200/90 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/55"
            placeholder="New survey name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="New survey name"
          />
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#D4AF37] px-4 py-2.5 text-sm font-semibold text-stone-900 shadow-sm shadow-[#D4AF37]/25 transition hover:brightness-105 disabled:opacity-50"
            disabled={create.isPending || !name.trim()}
          >
            <Plus className="h-4 w-4" />
            {create.isPending ? "Creating…" : "Create draft"}
          </button>
        </div>
      </form>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block min-w-0 flex-1 sm:max-w-md">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <input
            type="search"
            placeholder="Search surveys"
            className="w-full rounded-xl border-0 bg-stone-50 py-2.5 pr-3 pl-10 text-sm text-stone-900 ring-1 ring-stone-200/90 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/55"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search surveys"
          />
        </label>
        <div
          className="flex flex-wrap gap-1 rounded-xl border border-stone-200/80 bg-white p-1 shadow-sm"
          role="tablist"
          aria-label="Survey status filter"
        >
          {filters.map((f) => {
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => startFilterTransition(() => setFilter(f.id))}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  active
                    ? "bg-[#D4AF37] text-stone-900 shadow-sm"
                    : "text-stone-600 hover:bg-stone-100"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {note ? (
        <p
          className={`rounded-xl px-4 py-3 text-sm ${
            note.tone === "ok"
              ? "border border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {note.text}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-stone-200/90 bg-white shadow-sm shadow-stone-900/5">
        <ul className="divide-y divide-stone-100">
          <AnimatePresence initial={false}>
            {filtered.map((s, index) => {
              const isTemp = s.id.startsWith("temp-");
              const publishing =
                publish.isPending && publish.variables === s.id;
              return (
                <motion.li
                  key={s.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{
                    duration: 0.22,
                    delay: Math.min(index * 0.02, 0.2),
                  }}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 transition hover:bg-[#D4AF37]/[0.04]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {isTemp ? (
                        <span className="font-medium text-stone-900">
                          {s.name}
                        </span>
                      ) : (
                        <Link
                          href={`/admin/marketing/surveys/${s.id}`}
                          className="truncate font-medium text-stone-900 transition hover:text-[#8a7020]"
                        >
                          {s.name}
                        </Link>
                      )}
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ring-1 ${statusChip(s.status)}`}
                      >
                        {s.status}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-stone-500">
                      {s.slug
                        ? `/${s.slug}`
                        : "Saving…"}{" "}
                      · Updated{" "}
                      {new Date(s.updatedAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {s.status !== "published" && !isTemp ? (
                      <button
                        type="button"
                        className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-800 transition hover:border-[#D4AF37]/50 disabled:opacity-50"
                        disabled={publish.isPending}
                        onClick={() => publish.mutate(s.id)}
                      >
                        {publishing ? "Publishing…" : "Publish"}
                      </button>
                    ) : null}
                    {!isTemp ? (
                      <Link
                        href={`/admin/marketing/surveys/${s.id}`}
                        className="inline-flex items-center gap-1 rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-stone-800"
                      >
                        Open
                        <ArrowRight className="h-3 w-3" />
                      </Link>
                    ) : null}
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>

        {surveys.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-14 animate-pulse rounded-xl bg-stone-100"
                style={{ opacity: 1 - i * 0.15 }}
              />
            ))}
          </div>
        ) : null}

        {!surveys.isLoading && filtered.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#D4AF37]/15 text-[#8a7020] ring-1 ring-[#D4AF37]/25">
              <ClipboardList className="h-5 w-5" />
            </div>
            <p className="mt-3 font-medium text-stone-900">
              {deferredQ || filter !== "all"
                ? "No matching surveys"
                : "No surveys yet"}
            </p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">
              {deferredQ || filter !== "all"
                ? "Try another search or clear the status filter."
                : "Create a draft above — publish it when you’re ready for post-visit invites."}
            </p>
          </div>
        ) : null}

        {surveys.isError ? (
          <p className="border-t border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {(surveys.error as Error)?.message || "Could not load surveys"}
          </p>
        ) : null}
      </div>
    </div>
  );
}
