"use client";

import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Copy,
  ExternalLink,
  Mail,
  RefreshCw,
  Search,
  UserPlus,
  Users,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import { marketingKeys, patchLeadConsent } from "@/services/marketing";
import type { MarketingLeadRow } from "@/lib/marketing/segments";
import { useMarketingLeads } from "@/hooks/useMarketing";
import { notifyMarketingChange } from "@/lib/marketingSync";

type ConsentFilter = "all" | "opted_in" | "opted_out";

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

function initials(first: string, last: string) {
  const a = first.trim().charAt(0);
  const b = last.trim().charAt(0);
  const s = `${a}${b}`.toUpperCase();
  return s || "?";
}

function guestName(row: MarketingLeadRow) {
  const name = `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim();
  return name || "Guest";
}

export default function MarketingNewsletterPanel() {
  const { user } = useAuthStore();
  const [q, setQ] = useState("");
  const deferredQ = useDeferredValue(q.trim());
  const [filter, setFilter] = useState<ConsentFilter>("all");
  const [, startFilterTransition] = useTransition();
  const [copied, setCopied] = useState<"url" | "embed" | null>(null);
  const leads = useMarketingLeads(deferredQ);
  const qc = useQueryClient();

  const publicUrl = useMemo(() => {
    const slug = user?.organizationSlug?.trim();
    if (!slug || typeof window === "undefined") return "";
    return `${window.location.origin}/${slug}/newsletter`;
  }, [user?.organizationSlug]);

  const embedSnippet = useMemo(
    () =>
      publicUrl
        ? `<iframe src="${publicUrl}" title="Newsletter signup" style="width:100%;min-height:420px;border:0;"></iframe>`
        : "",
    [publicUrl]
  );

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(null), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);

  async function copyText(kind: "url" | "embed", text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
    } catch {
      setCopied(null);
    }
  }

  const toggle = useMutation({
    mutationFn: ({ id, optedIn }: { id: string; optedIn: boolean }) =>
      patchLeadConsent(id, optedIn),
    onMutate: async ({ id, optedIn }) => {
      await qc.cancelQueries({ queryKey: marketingKeys.all });
      const key = marketingKeys.leads(deferredQ);
      const prev = qc.getQueryData<MarketingLeadRow[]>(key);
      if (prev) {
        qc.setQueryData<MarketingLeadRow[]>(
          key,
          prev.map((row) =>
            row.id === id ? { ...row, marketingEmailOptIn: optedIn } : row
          )
        );
      }
      return { prev, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev && ctx.key) {
        qc.setQueryData(ctx.key, ctx.prev);
      }
    },
    onSettled: () => {
      notifyMarketingChange(qc);
    },
  });

  const rows = leads.data ?? [];
  const filtered = useMemo(() => {
    if (filter === "opted_in") return rows.filter((r) => r.marketingEmailOptIn);
    if (filter === "opted_out") return rows.filter((r) => !r.marketingEmailOptIn);
    return rows;
  }, [rows, filter]);

  const optedInCount = rows.filter((r) => r.marketingEmailOptIn).length;
  const newsletterCount = rows.filter((r) => r.newsletterSubscribedAt).length;
  const syncing = leads.isFetching && !leads.isLoading;
  const searching = deferredQ !== q.trim();

  const filters: { id: ConsentFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "opted_in", label: "Opted in" },
    { id: "opted_out", label: "Opted out" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-stone-600">
          Capture promotional opt-ins without a waiver. New public signups appear
          here automatically.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <LiveChip syncing={syncing || searching} />
          <button
            type="button"
            onClick={() => void leads.refetch()}
            disabled={leads.isFetching}
            className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-[11px] font-medium text-stone-700 shadow-sm transition hover:border-[#D4AF37]/50 disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${leads.isFetching ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2.5">
        <StatPill
          label="In view"
          value={rows.length}
          icon={<Users className="h-3.5 w-3.5" strokeWidth={2} />}
        />
        <StatPill
          label="Opted in"
          value={optedInCount}
          icon={<Mail className="h-3.5 w-3.5" strokeWidth={2} />}
        />
        <StatPill
          label="Newsletter"
          value={newsletterCount}
          icon={<UserPlus className="h-3.5 w-3.5" strokeWidth={2} />}
        />
      </div>

      {publicUrl ? (
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="overflow-hidden rounded-2xl border border-[#D4AF37]/35 bg-gradient-to-br from-[#D4AF37]/12 via-[#faf8f4] to-white shadow-sm shadow-stone-900/5"
        >
          <div className="border-b border-[#D4AF37]/20 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#A6892A]">
              Public capture
            </p>
            <p className="mt-0.5 text-sm text-stone-600">
              Share the page or embed it on your company website.
            </p>
          </div>
          <div className="space-y-4 p-4">
            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                  Public URL
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <a
                    href={publicUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium text-stone-700 transition hover:border-[#D4AF37]/50"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Open
                  </a>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium text-stone-800 transition hover:border-[#D4AF37]/50"
                    onClick={() => void copyText("url", publicUrl)}
                  >
                    {copied === "url" ? (
                      <Check className="h-3 w-3 text-emerald-600" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                    {copied === "url" ? "Copied" : "Copy link"}
                  </button>
                </div>
              </div>
              <code className="block break-all rounded-xl bg-white/90 px-3 py-2.5 text-xs text-stone-700 ring-1 ring-stone-200/80">
                {publicUrl}
              </code>
            </div>
            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                  Embed snippet
                </span>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium text-stone-800 transition hover:border-[#D4AF37]/50"
                  onClick={() => void copyText("embed", embedSnippet)}
                >
                  {copied === "embed" ? (
                    <Check className="h-3 w-3 text-emerald-600" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  {copied === "embed" ? "Copied" : "Copy snippet"}
                </button>
              </div>
              <pre className="overflow-x-auto rounded-xl bg-white/90 p-3 text-[11px] leading-relaxed text-stone-700 ring-1 ring-stone-200/80">
                {embedSnippet}
              </pre>
            </div>
          </div>
        </motion.section>
      ) : (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-950">
          Set a company slug in Company profile to unlock the public newsletter
          URL and embed snippet.
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block min-w-0 flex-1 sm:max-w-md">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <input
            type="search"
            placeholder="Search name or email"
            className="w-full rounded-xl border-0 bg-stone-50 py-2.5 pr-3 pl-10 text-sm text-stone-900 ring-1 ring-stone-200/90 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/55"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search leads"
          />
        </label>
        <div
          className="flex flex-wrap gap-1 rounded-xl border border-stone-200/80 bg-white p-1 shadow-sm"
          role="tablist"
          aria-label="Consent filter"
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

      <div className="overflow-hidden rounded-2xl border border-stone-200/90 bg-white shadow-sm shadow-stone-900/5">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-stone-100 bg-stone-50/90 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">
                <th className="px-4 py-3">Guest</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Opt-in</th>
                <th className="px-4 py-3">Subscribed</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence initial={false}>
                {filtered.map((row, index) => {
                  const pending =
                    toggle.isPending && toggle.variables?.id === row.id;
                  return (
                    <motion.tr
                      key={row.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{
                        duration: 0.22,
                        delay: Math.min(index * 0.02, 0.2),
                      }}
                      className="border-t border-stone-100 transition hover:bg-[#D4AF37]/[0.04]"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-100 text-[11px] font-semibold text-stone-600 ring-1 ring-stone-200/80">
                            {initials(row.firstName, row.lastName)}
                          </span>
                          <span className="font-medium text-stone-900">
                            {guestName(row)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-stone-600">
                        {row.email ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={row.marketingEmailOptIn}
                          disabled={toggle.isPending}
                          onClick={() =>
                            toggle.mutate({
                              id: row.id,
                              optedIn: !row.marketingEmailOptIn,
                            })
                          }
                          className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 transition disabled:opacity-60 ${
                            row.marketingEmailOptIn
                              ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                              : "bg-stone-100 text-stone-600 ring-stone-200"
                          }`}
                        >
                          <span
                            className={`relative h-4 w-7 rounded-full transition ${
                              row.marketingEmailOptIn
                                ? "bg-emerald-500"
                                : "bg-stone-300"
                            }`}
                          >
                            <span
                              className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition ${
                                row.marketingEmailOptIn
                                  ? "left-3.5"
                                  : "left-0.5"
                              }`}
                            />
                          </span>
                          {pending
                            ? "…"
                            : row.marketingEmailOptIn
                              ? "Yes"
                              : "No"}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-stone-500">
                        {row.newsletterSubscribedAt
                          ? new Date(
                              row.newsletterSubscribedAt
                            ).toLocaleDateString()
                          : "—"}
                      </td>
                    </motion.tr>
                  );
                })}
              </AnimatePresence>
            </tbody>
          </table>
        </div>

        {leads.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-11 animate-pulse rounded-xl bg-stone-100"
                style={{ opacity: 1 - i * 0.12 }}
              />
            ))}
          </div>
        ) : null}

        {!leads.isLoading && filtered.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#D4AF37]/15 text-[#8a7020] ring-1 ring-[#D4AF37]/25">
              <Mail className="h-5 w-5" />
            </div>
            <p className="mt-3 font-medium text-stone-900">
              {deferredQ || filter !== "all"
                ? "No matching leads"
                : "No leads yet"}
            </p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">
              {deferredQ || filter !== "all"
                ? "Try another search or clear the consent filter."
                : "Share the public URL or embed the signup form — new opt-ins land here in real time."}
            </p>
          </div>
        ) : null}

        {leads.isError ? (
          <p className="border-t border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {(leads.error as Error)?.message || "Could not load leads"}
          </p>
        ) : null}
      </div>
    </div>
  );
}
