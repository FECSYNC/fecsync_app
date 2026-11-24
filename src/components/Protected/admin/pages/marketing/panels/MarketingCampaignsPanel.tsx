"use client";

import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  CalendarClock,
  Mail,
  Newspaper,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
} from "lucide-react";
import { useMarketingCampaigns } from "@/hooks/useMarketing";
import {
  archiveMarketingCampaign,
  createMarketingCampaign,
  postMarketingCampaignAction,
} from "@/services/marketing";
import { notifyMarketingChange } from "@/lib/marketingSync";
import {
  starterMonthlyBlocks,
  type MarketingCampaignDto,
} from "@/lib/marketing/campaigns/types";
import CampaignComposer from "./campaigns/CampaignComposer";
import { CampaignStatusChip, describeSchedule } from "./campaigns/campaignUi";

function StatPill({ label, value, icon }: { label: string; value: number; icon: ReactNode }) {
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

function issueLabel(windowKey: string): string {
  const m = windowKey.match(/^(\d{4})-(\d{2})$/);
  if (!m) return "Last send";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 15));
  return `${d.toLocaleString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })} issue`;
}

function CampaignCard({
  campaign,
  index,
  onEdit,
}: {
  campaign: MarketingCampaignDto;
  index: number;
  onEdit: () => void;
}) {
  const qc = useQueryClient();
  const quick = useMutation({
    mutationFn: async (a: "pause" | "resume" | "archive") =>
      a === "archive"
        ? archiveMarketingCampaign(campaign.id)
        : postMarketingCampaignAction(campaign.id, a),
    onSettled: () => notifyMarketingChange(qc, { kind: "campaign", id: campaign.id }),
  });
  const w = campaign.lastWindow;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.24, delay: Math.min(index * 0.03, 0.2) }}
      className="rounded-2xl border border-stone-200/90 bg-white p-4 shadow-sm shadow-stone-900/5 transition hover:border-[#D4AF37]/45"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-semibold text-stone-900">{campaign.name}</h3>
            <CampaignStatusChip status={campaign.status} />
          </div>
          <p className="mt-0.5 truncate text-sm text-stone-600">
            {campaign.subject || <span className="italic text-stone-400">No subject yet</span>}
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="h-3.5 w-3.5" />
              {describeSchedule(campaign)}
            </span>
            <span>{campaign.locationName ?? "All parks"}</span>
            {campaign.nextRunAt &&
            (campaign.status === "scheduled" || campaign.status === "sending") ? (
              <span className="font-medium text-emerald-700">
                Next: {new Date(campaign.nextRunAt).toLocaleString()}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-800 transition hover:border-[#D4AF37]/50"
          >
            <Pencil className="h-3 w-3" />
            {campaign.status === "sent" ? "View" : "Edit"}
          </button>
          {campaign.status === "scheduled" || campaign.status === "sending" ? (
            <button
              type="button"
              disabled={quick.isPending}
              onClick={() => quick.mutate("pause")}
              className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-900 transition hover:bg-amber-100 disabled:opacity-50"
            >
              <Pause className="h-3 w-3" /> Pause
            </button>
          ) : null}
          {campaign.status === "paused" ? (
            <button
              type="button"
              disabled={quick.isPending}
              onClick={() => quick.mutate("resume")}
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-900 transition hover:bg-emerald-100 disabled:opacity-50"
            >
              <Play className="h-3 w-3" /> Resume
            </button>
          ) : null}
          {campaign.status !== "sending" ? (
            <button
              type="button"
              aria-label="Archive"
              disabled={quick.isPending}
              onClick={() => {
                if (window.confirm(`Archive “${campaign.name}”? Delivery history is kept.`)) {
                  quick.mutate("archive");
                }
              }}
              className="rounded-lg border border-stone-200 bg-white p-1.5 text-stone-500 transition hover:border-red-200 hover:text-red-600 disabled:opacity-50"
            >
              <Archive className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>
      {w ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3 text-xs">
          <span className="font-semibold text-stone-600">{issueLabel(w.windowKey)}</span>
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800 ring-1 ring-emerald-200">
            {w.sent.toLocaleString()} sent
          </span>
          {w.skipped ? (
            <span className="rounded-full bg-stone-100 px-2 py-0.5 font-medium text-stone-600 ring-1 ring-stone-200">
              {w.skipped.toLocaleString()} skipped
            </span>
          ) : null}
          {w.failed ? (
            <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700 ring-1 ring-red-200">
              {w.failed.toLocaleString()} failed
            </span>
          ) : null}
        </div>
      ) : null}
      {quick.isError ? (
        <p className="mt-2 text-xs text-red-700">{(quick.error as Error).message}</p>
      ) : null}
    </motion.div>
  );
}

export default function MarketingCampaignsPanel() {
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "draft" | "sent">("all");
  const campaigns = useMarketingCampaigns();

  const create = useMutation({
    mutationFn: () =>
      createMarketingCampaign({
        name: "Monthly newsletter",
        subject: "{{monthName}} at {{orgName}}",
        preheader: "What’s on this month, plus a subscriber offer",
        blocks: starterMonthlyBlocks(),
        scheduleKind: "monthly",
        dayOfMonth: 1,
        sendHour: 9,
      }),
    onSuccess: (c) => {
      notifyMarketingChange(qc, { kind: "campaign", id: c.id });
      setEditingId(c.id);
    },
  });

  if (editingId) {
    return (
      <CampaignComposer
        key={editingId}
        campaignId={editingId}
        onBack={() => setEditingId(null)}
        onOpenCampaign={setEditingId}
      />
    );
  }

  const allRows = campaigns.data?.campaigns ?? [];
  const needle = q.trim().toLowerCase();
  const rows = allRows.filter((r) => {
    if (needle && !`${r.name} ${r.subject}`.toLowerCase().includes(needle)) return false;
    if (filter === "active") return r.status === "scheduled" || r.status === "sending" || r.status === "paused";
    if (filter === "draft") return r.status === "draft";
    if (filter === "sent") return r.status === "sent";
    return true;
  });
  const mailConfigured = campaigns.data?.mailConfigured ?? true;
  const monthlyActive = allRows.filter(
    (r) => r.scheduleKind === "monthly" && (r.status === "scheduled" || r.status === "sending")
  ).length;
  const sentThisIssue = allRows.reduce((sum, r) => sum + (r.lastWindow?.sent ?? 0), 0);
  const filters = [
    { id: "all", label: "All", count: allRows.length },
    {
      id: "active",
      label: "Live",
      count: allRows.filter((r) => ["scheduled", "sending", "paused"].includes(r.status)).length,
    },
    { id: "draft", label: "Drafts", count: allRows.filter((r) => r.status === "draft").length },
    { id: "sent", label: "Sent", count: allRows.filter((r) => r.status === "sent").length },
  ] as const;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-sm text-stone-600">
          Write a newsletter once and send it to opted-in guests — one-off or automatically every
          month. Upcoming events and the month name refresh for each issue.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void campaigns.refetch()}
            disabled={campaigns.isFetching}
            className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-[11px] font-medium text-stone-700 shadow-sm transition hover:border-[#D4AF37]/50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${campaigns.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => create.mutate()}
            disabled={create.isPending}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-stone-900 shadow-sm shadow-[#D4AF37]/35 transition hover:brightness-105 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {create.isPending ? "Creating…" : "New newsletter"}
          </button>
        </div>
      </div>

      {!mailConfigured ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-950">
          Outgoing email (SMTP) is not configured on this server, so sends will be recorded as
          failed. Set NOTIFICATION_EMAIL_USER / TEAM_EMAIL_USER credentials first.
        </p>
      ) : null}
      {create.isError ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {(create.error as Error).message}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2.5">
        <StatPill
          label="Campaigns"
          value={allRows.length}
          icon={<Newspaper className="h-3.5 w-3.5" strokeWidth={2} />}
        />
        <StatPill
          label="Monthly active"
          value={monthlyActive}
          icon={<CalendarClock className="h-3.5 w-3.5" strokeWidth={2} />}
        />
        <StatPill
          label="Sent (latest issues)"
          value={sentThisIssue}
          icon={<Send className="h-3.5 w-3.5" strokeWidth={2} />}
        />
      </div>

      {allRows.length > 0 ? (
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative block min-w-0 flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search campaigns"
              aria-label="Search campaigns"
              className="w-full rounded-xl border-0 bg-stone-50 py-2 pl-9 pr-3 text-sm ring-1 ring-stone-200/90 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/55"
            />
          </label>
          <div className="flex flex-wrap gap-1 rounded-xl border border-stone-200/80 bg-white p-1 shadow-sm" role="tablist">
            {filters.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  filter === f.id ? "bg-[#D4AF37] text-stone-900 shadow-sm" : "text-stone-600 hover:bg-stone-100"
                }`}
              >
                {f.label}
                <span className={`tabular-nums ${filter === f.id ? "text-stone-800" : "text-stone-400"}`}>{f.count}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        <AnimatePresence initial={false}>
          {rows.map((c, i) => (
            <CampaignCard key={c.id} campaign={c} index={i} onEdit={() => setEditingId(c.id)} />
          ))}
        </AnimatePresence>
        {campaigns.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-stone-100" />
            ))}
          </div>
        ) : null}
        {!campaigns.isLoading && allRows.length > 0 && rows.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-stone-300 px-4 py-8 text-center text-sm text-stone-500">
            No campaigns match this filter.
          </p>
        ) : null}
        {!campaigns.isLoading && allRows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-stone-300 px-4 py-10 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#D4AF37]/15 text-[#8a7020] ring-1 ring-[#D4AF37]/25">
              <Mail className="h-5 w-5" />
            </div>
            <p className="mt-3 font-medium text-stone-900">No newsletters yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">
              Start from the monthly template — it includes upcoming events, an offer block, and a
              booking button you can edit.
            </p>
          </div>
        ) : null}
        {campaigns.isError ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {(campaigns.error as Error).message || "Could not load campaigns"}
          </p>
        ) : null}
      </div>
    </div>
  );
}
