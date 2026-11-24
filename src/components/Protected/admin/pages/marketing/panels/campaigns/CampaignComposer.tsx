"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  Circle,
  Cloud,
  CloudOff,
  Copy,
  Inbox,
  Loader2,
  Lock,
  Pause,
  Play,
  Repeat,
  Send,
  Sparkles,
  Users,
} from "lucide-react";
import {
  getMarketingCampaign,
  marketingKeys,
  patchMarketingCampaign,
  postMarketingCampaignAction,
  postMarketingCampaignTestSend,
  previewMarketingCampaign,
  type MarketingCampaignDetail,
} from "@/services/marketing";
import { listAdminVenueLocations, venueLocationKeys } from "@/services/venueLocations";
import { broadcastMarketingChange } from "@/lib/marketingSync";
import { useAuthStore } from "@/store/authStore";
import { ApiError } from "@/utils/api";
import type {
  CampaignAction,
  CampaignAudience,
  CampaignBlock,
  CampaignScheduleKind,
  MarketingCampaignDto,
  MarketingCampaignInput,
} from "@/lib/marketing/campaigns/types";
import { richDocTextLength } from "@/lib/marketing/campaigns/richText";
import { nextMonthlyRun } from "@/lib/marketing/campaigns/schedule";
import { CampaignStatusChip } from "./campaignUi";
import BlockList from "./BlockList";
import PreviewPane from "./PreviewPane";
import TagInput, { fieldCls } from "./TagInput";

type FormState = {
  name: string;
  subject: string;
  preheader: string;
  blocks: CampaignBlock[];
  audience: CampaignAudience;
  locationId: string;
  scheduleKind: CampaignScheduleKind;
  sendAtLocal: string;
  dayOfMonth: number;
  sendHour: number;
  timezone: string;
};

type SaveState = "idle" | "saving" | "error" | "conflict";

const AUTOSAVE_MS = 1200;

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formFromCampaign(c: MarketingCampaignDto): FormState {
  return {
    name: c.name,
    subject: c.subject,
    preheader: c.preheader ?? "",
    blocks: c.blocks,
    audience: c.audience,
    locationId: c.locationId ?? "",
    scheduleKind: c.scheduleKind,
    sendAtLocal: toLocalInput(c.sendAt),
    dayOfMonth: c.dayOfMonth ?? 1,
    sendHour: c.sendHour,
    timezone: c.timezone,
  };
}

function formToInput(f: FormState): MarketingCampaignInput {
  return {
    name: f.name,
    subject: f.subject,
    preheader: f.preheader || null,
    blocks: f.blocks,
    audience: f.audience,
    locationId: f.locationId || null,
    scheduleKind: f.scheduleKind,
    sendAt: f.sendAtLocal ? new Date(f.sendAtLocal).toISOString() : null,
    dayOfMonth: f.scheduleKind === "monthly" ? f.dayOfMonth : null,
    sendHour: f.sendHour,
    timezone: f.timezone,
  };
}

function hasContent(blocks: CampaignBlock[]): boolean {
  return blocks.some((b) => {
    switch (b.type) {
      case "heading":
        return b.text.trim().length > 0;
      case "text":
        return richDocTextLength(b.doc) > 0;
      case "image":
        return b.url.trim().length > 0;
      case "button":
        return Boolean(b.label.trim() && b.url.trim());
      case "promo":
        return Boolean(b.title.trim() || b.text.trim() || b.code.trim());
      case "events":
        return true;
      case "divider":
        return false;
    }
  });
}

function timeZoneOptions(current: string): string[] {
  let zones: string[] = [];
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
    zones = intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    zones = [];
  }
  if (!zones.includes("UTC")) zones = ["UTC", ...zones];
  if (current && !zones.includes(current)) zones = [current, ...zones];
  return zones;
}

function suffix(n: number): string {
  const m = n % 100;
  if (m >= 11 && m <= 13) return `${n}th`;
  const last = n % 10;
  return `${n}${last === 1 ? "st" : last === 2 ? "nd" : last === 3 ? "rd" : "th"}`;
}

function formatInZone(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function relativeTime(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function Section({
  id,
  step,
  title,
  description,
  done,
  children,
}: {
  id: string;
  step: number;
  title: string;
  description: string;
  done: boolean;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-28 rounded-2xl border border-stone-200/90 bg-white p-4 shadow-sm shadow-stone-900/5 sm:p-5"
    >
      <header className="mb-4 flex items-start gap-3">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition ${
            done
              ? "bg-emerald-500 text-white shadow-sm shadow-emerald-500/30"
              : "bg-[#D4AF37]/15 text-[#8a7020] ring-1 ring-[#D4AF37]/30"
          }`}
        >
          {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : step}
        </span>
        <div className="min-w-0">
          <h3 className="font-semibold text-stone-900">{title}</h3>
          <p className="text-xs text-stone-500">{description}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <span className="mb-1 flex items-baseline justify-between gap-2">
      <span className="text-xs font-semibold text-stone-600">{children}</span>
      {hint ? <span className="text-[11px] text-stone-400">{hint}</span> : null}
    </span>
  );
}

function ChoiceCard({
  active,
  disabled,
  onClick,
  icon,
  title,
  text,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-1 items-start gap-2.5 rounded-xl border p-3 text-left transition disabled:opacity-60 ${
        active
          ? "border-[#D4AF37] bg-[#D4AF37]/[0.08] shadow-sm shadow-[#D4AF37]/15"
          : "border-stone-200 bg-white hover:border-[#D4AF37]/50"
      }`}
    >
      <span
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
          active ? "bg-[#D4AF37] text-stone-900" : "bg-stone-100 text-stone-500"
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-stone-900">{title}</span>
        <span className="block text-xs text-stone-500">{text}</span>
      </span>
    </button>
  );
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

export default function CampaignComposer({
  campaignId,
  onBack,
  onOpenCampaign,
}: {
  campaignId: string;
  onBack: () => void;
  onOpenCampaign?: (id: string) => void;
}) {
  const qc = useQueryClient();
  const parkLocked = useAuthStore((s) => s.user?.parkLocked === true);
  const now = useNow(15_000);

  const detail = useQuery({
    queryKey: marketingKeys.campaign(campaignId),
    queryFn: () => getMarketingCampaign(campaignId),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      if (s === "sending") return 4_000;
      if (s === "scheduled") return 15_000;
      return 20_000;
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const venues = useQuery({
    queryKey: venueLocationKeys.list("all"),
    queryFn: () => listAdminVenueLocations({ scope: "all" }),
    staleTime: 60_000,
  });
  const listCache = qc.getQueryData<{ mailConfigured: boolean }>(marketingKeys.campaigns());

  const [form, setForm] = useState<FormState | null>(null);
  const [savedJson, setSavedJson] = useState("");
  const [baseUpdatedAt, setBaseUpdatedAt] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [remoteChanged, setRemoteChanged] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const campaign = detail.data;
  const input = useMemo(() => (form ? formToInput(form) : null), [form]);
  const inputJson = useMemo(() => (input ? JSON.stringify(input) : ""), [input]);
  const dirty = Boolean(form) && inputJson !== savedJson;
  const readOnly =
    !campaign || campaign.status === "sent" || campaign.status === "sending" || campaign.status === "archived";

  // Refs so async flows (autosave, actions) always see the latest values.
  const latest = useRef({ input, inputJson, baseUpdatedAt, dirty });
  latest.current = { input, inputJson, baseUpdatedAt, dirty };

  const loadFrom = useCallback((c: MarketingCampaignDto) => {
    const next = formFromCampaign(c);
    setForm(next);
    setSavedJson(JSON.stringify(formToInput(next)));
    setBaseUpdatedAt(c.updatedAt);
    setRemoteChanged(false);
  }, []);

  // Server → form sync (initial load, other staff edits, cron status changes).
  useEffect(() => {
    if (!campaign) return;
    if (!form) {
      loadFrom(campaign);
      return;
    }
    if (campaign.updatedAt === baseUpdatedAt) return;
    if (!latest.current.dirty && saveState !== "saving") {
      loadFrom(campaign);
    } else {
      setRemoteChanged(true);
    }
  }, [campaign, form, baseUpdatedAt, saveState, loadFrom]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(t);
  }, [notice]);

  const syncAfterWrite = useCallback(
    (c: MarketingCampaignDto) => {
      setBaseUpdatedAt(c.updatedAt);
      qc.setQueryData(marketingKeys.campaign(campaignId), (prev: MarketingCampaignDetail | undefined) =>
        prev ? { ...c, audienceCount: prev.audienceCount } : prev
      );
      void qc.invalidateQueries({ queryKey: marketingKeys.campaigns() });
      void qc.invalidateQueries({ queryKey: [...marketingKeys.all, "overview"] });
      broadcastMarketingChange({ kind: "campaign", id: campaignId });
    },
    [qc, campaignId]
  );

  const save = useMutation({
    mutationFn: (vars: { body: MarketingCampaignInput; json: string; force?: boolean }) =>
      patchMarketingCampaign(campaignId, {
        ...vars.body,
        expectedUpdatedAt: vars.force ? null : latest.current.baseUpdatedAt,
      }),
    onMutate: () => {
      setSaveState("saving");
      setSaveError("");
    },
    onSuccess: (c, vars) => {
      setSavedJson(vars.json);
      setLastSavedAt(Date.now());
      setSaveState("idle");
      setRemoteChanged(false);
      syncAfterWrite(c);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        setSaveState("conflict");
        return;
      }
      setSaveState("error");
      setSaveError((err as Error).message || "Could not save");
    },
  });

  const flush = useCallback(
    async (force = false) => {
      const { input: body, inputJson: json, dirty: isDirty } = latest.current;
      if (!body || (!isDirty && !force)) return true;
      try {
        await save.mutateAsync({ body, json, force });
        return true;
      } catch {
        return false;
      }
    },
    [save]
  );

  // Autosave — debounced after the last keystroke.
  useEffect(() => {
    if (!dirty || readOnly || save.isPending || saveState === "conflict") return;
    const t = window.setTimeout(() => void flush(), AUTOSAVE_MS);
    return () => window.clearTimeout(t);
  }, [inputJson, dirty, readOnly, save.isPending, saveState, flush]);

  // Ctrl/Cmd+S saves immediately; warn before leaving with unsaved edits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flush();
      }
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (latest.current.dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [flush]);

  const [previewInput, setPreviewInput] = useState<MarketingCampaignInput | null>(null);
  useEffect(() => {
    if (!input) return;
    const t = window.setTimeout(() => setPreviewInput(input), 450);
    return () => window.clearTimeout(t);
  }, [input]);

  const preview = useQuery({
    queryKey: [...marketingKeys.all, "campaign-preview", campaignId, JSON.stringify(previewInput)],
    queryFn: () => previewMarketingCampaign(previewInput!),
    enabled: Boolean(previewInput),
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });

  const action = useMutation({
    mutationFn: async (a: CampaignAction | "duplicate") => {
      if (latest.current.dirty && !readOnly) {
        const ok = await flush();
        if (!ok) throw new Error("Save your changes first — the latest edit could not be saved");
      }
      return postMarketingCampaignAction(campaignId, a);
    },
    onSuccess: (c, a) => {
      if (a === "duplicate") {
        void qc.invalidateQueries({ queryKey: marketingKeys.campaigns() });
        broadcastMarketingChange({ kind: "campaign", id: c.id });
        if (onOpenCampaign) onOpenCampaign(c.id);
        else onBack();
        return;
      }
      syncAfterWrite(c);
      const text =
        a === "send_now"
          ? "Sending started — delivery continues in the background."
          : a === "schedule"
            ? `Scheduled — first send ${c.nextRunAt ? new Date(c.nextRunAt).toLocaleString() : "soon"}.`
            : a === "pause"
              ? "Paused. Nothing more will be sent until you resume."
              : "Resumed.";
      setNotice({ tone: "ok", text });
    },
    onError: (err) => setNotice({ tone: "error", text: (err as Error).message }),
  });

  const testSend = useMutation({
    mutationFn: async () => {
      if (latest.current.dirty && !readOnly) {
        const ok = await flush();
        if (!ok) throw new Error("Save your changes first — the latest edit could not be saved");
      }
      return postMarketingCampaignTestSend(campaignId);
    },
    onSuccess: (r) =>
      setNotice(
        r.sent
          ? { tone: "ok", text: `Test email sent to ${r.toEmail} — check your inbox.` }
          : { tone: "error", text: "Mail is not configured on this server, or the send failed." }
      ),
    onError: (err) => setNotice({ tone: "error", text: (err as Error).message }),
  });

  const goBack = async () => {
    if (latest.current.dirty && !readOnly) await flush();
    onBack();
  };

  if (detail.isError && !campaign) {
    return (
      <div className="space-y-3">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-stone-600">
          <ArrowLeft className="h-4 w-4" /> All campaigns
        </button>
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {(detail.error as Error).message || "Could not load campaign"}
        </p>
      </div>
    );
  }
  if (!form || !campaign) {
    return (
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-2xl bg-stone-100" />
          ))}
        </div>
        <div className="h-[520px] animate-pulse rounded-2xl bg-stone-100" />
      </div>
    );
  }

  const patch = (p: Partial<FormState>) => setForm((f) => (f ? { ...f, ...p } : f));
  const patchAudience = (p: Partial<CampaignAudience>) =>
    setForm((f) => (f ? { ...f, audience: { ...f.audience, ...p } } : f));

  const busy = action.isPending || testSend.isPending;
  const audienceCount = preview.data?.audienceCount ?? campaign.audienceCount;
  const venueList = (venues.data ?? []).filter((v) => !v.archivedAt);
  const sendAtDate = form.sendAtLocal ? new Date(form.sendAtLocal) : null;
  const sendAtFuture = Boolean(sendAtDate && sendAtDate.getTime() > now);

  const checks = {
    inbox: form.subject.trim().length > 0,
    content: hasContent(form.blocks),
    audience: audienceCount > 0,
    schedule: form.scheduleKind === "monthly" ? form.dayOfMonth >= 1 : sendAtFuture,
  };
  const readyToSend = checks.inbox && checks.content;
  const readyToSchedule = readyToSend && checks.schedule;

  const firstMonthly =
    form.scheduleKind === "monthly"
      ? (() => {
          try {
            return nextMonthlyRun({
              after: new Date(now),
              dayOfMonth: form.dayOfMonth,
              sendHour: form.sendHour,
              timezone: form.timezone,
            }).runAt;
          } catch {
            return null;
          }
        })()
      : null;
  const nextSendLabel =
    (campaign.status === "scheduled" || campaign.status === "sending") && campaign.nextRunAt
      ? formatInZone(new Date(campaign.nextRunAt), form.timezone)
      : form.scheduleKind === "monthly" && firstMonthly
        ? formatInZone(firstMonthly, form.timezone)
        : sendAtDate
          ? formatInZone(sendAtDate, Intl.DateTimeFormat().resolvedOptions().timeZone)
          : null;

  const canSchedule = campaign.status === "draft";
  const canPause = campaign.status === "scheduled" || campaign.status === "sending";
  const canSendNow = ["draft", "paused", "scheduled"].includes(campaign.status);

  const scrollTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const saveIndicator = readOnly ? (
    <span className="inline-flex items-center gap-1.5 text-xs text-stone-500">
      <Lock className="h-3.5 w-3.5" /> Read-only
    </span>
  ) : saveState === "saving" ? (
    <span className="inline-flex items-center gap-1.5 text-xs text-stone-500">
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
    </span>
  ) : saveState === "error" ? (
    <button
      type="button"
      onClick={() => void flush()}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 hover:underline"
      title={saveError}
    >
      <CloudOff className="h-3.5 w-3.5" /> Not saved — retry
    </button>
  ) : saveState === "conflict" ? (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
      <AlertTriangle className="h-3.5 w-3.5" /> Edit conflict
    </span>
  ) : dirty ? (
    <span className="inline-flex items-center gap-1.5 text-xs text-stone-500">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Unsaved changes
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700">
      <Cloud className="h-3.5 w-3.5" /> Saved{lastSavedAt ? ` · ${relativeTime(lastSavedAt, now)}` : ""}
    </span>
  );

  const steps = [
    { id: "nl-inbox", label: "Inbox", done: checks.inbox },
    { id: "nl-content", label: "Content", done: checks.content },
    { id: "nl-audience", label: "Audience", done: checks.audience },
    { id: "nl-schedule", label: "Schedule", done: checks.schedule },
  ];

  return (
    <div className="relative">
      {/* Sticky command bar */}
      <div className="sticky top-0 z-20 -mx-5 -mt-5 border-b border-stone-200/80 bg-white/95 px-5 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="button"
            onClick={() => void goBack()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-600 shadow-sm transition hover:border-[#D4AF37]/50 hover:text-stone-900"
            aria-label="Back to all campaigns"
            title="All campaigns"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <input
              value={form.name}
              disabled={readOnly}
              onChange={(e) => patch({ name: e.target.value })}
              aria-label="Campaign name"
              maxLength={120}
              className="w-full min-w-0 rounded-lg bg-transparent px-1.5 py-0.5 text-base font-semibold text-stone-900 transition hover:bg-stone-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50 disabled:hover:bg-transparent"
            />
            <div className="flex flex-wrap items-center gap-2 px-1.5">
              <CampaignStatusChip status={campaign.status} />
              {saveIndicator}
              {nextSendLabel && campaign.status !== "sent" ? (
                <span className="inline-flex items-center gap-1 text-xs text-stone-500">
                  <CalendarClock className="h-3.5 w-3.5" />
                  {campaign.status === "scheduled" || campaign.status === "sending" ? "Next send" : "Would send"}{" "}
                  {nextSendLabel}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => testSend.mutate()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-800 shadow-sm transition hover:border-[#D4AF37]/50 disabled:opacity-50"
            >
              {testSend.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Inbox className="h-3.5 w-3.5" />}
              Test to me
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => action.mutate("duplicate")}
              title="Duplicate"
              aria-label="Duplicate campaign"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-700 shadow-sm transition hover:border-[#D4AF37]/50 disabled:opacity-50"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
            {canPause ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => action.mutate("pause")}
                className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 transition hover:bg-amber-100 disabled:opacity-50"
              >
                <Pause className="h-3.5 w-3.5" /> Pause
              </button>
            ) : null}
            {campaign.status === "paused" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => action.mutate("resume")}
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900 transition hover:bg-emerald-100 disabled:opacity-50"
              >
                <Play className="h-3.5 w-3.5" /> Resume
              </button>
            ) : null}
            {canSendNow ? (
              <button
                type="button"
                disabled={busy || !readyToSend}
                title={readyToSend ? undefined : "Add a subject and some content first"}
                onClick={() => {
                  if (window.confirm(`Send this newsletter to ${audienceCount.toLocaleString()} guests now?`)) {
                    action.mutate("send_now");
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-stone-900 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-stone-800 disabled:opacity-40"
              >
                <Send className="h-3.5 w-3.5" /> Send now
              </button>
            ) : null}
            {canSchedule ? (
              <button
                type="button"
                disabled={busy || !readyToSchedule}
                title={readyToSchedule ? undefined : "Complete the checklist first"}
                onClick={() => action.mutate("schedule")}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#D4AF37] px-3 py-2 text-sm font-semibold text-stone-900 shadow-sm shadow-[#D4AF37]/35 transition hover:brightness-105 disabled:opacity-40"
              >
                <CalendarClock className="h-3.5 w-3.5" />
                {form.scheduleKind === "monthly" ? "Start monthly" : "Schedule"}
              </button>
            ) : null}
          </div>
        </div>

        <nav className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Composer steps">
          {steps.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => scrollTo(s.id)}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                s.done
                  ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100"
                  : "bg-stone-100 text-stone-600 ring-1 ring-stone-200 hover:bg-stone-200/70"
              }`}
            >
              {s.done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
              {i + 1}. {s.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="space-y-2.5 pt-4">
        <AnimatePresence>
          {notice ? (
            <motion.p
              key={notice.text}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={`rounded-xl px-4 py-2.5 text-sm ${
                notice.tone === "ok"
                  ? "border border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border border-red-200 bg-red-50 text-red-700"
              }`}
            >
              {notice.text}
            </motion.p>
          ) : null}
        </AnimatePresence>
        {saveState === "conflict" ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1">
              Someone else saved this campaign while you were editing. Choose which version to keep.
            </span>
            <button
              type="button"
              onClick={async () => {
                const fresh = await detail.refetch();
                if (fresh.data) loadFrom(fresh.data);
                setSaveState("idle");
              }}
              className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-amber-100"
            >
              Load their version
            </button>
            <button
              type="button"
              onClick={() => {
                setSaveState("idle");
                void flush(true);
              }}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
            >
              Keep mine
            </button>
          </div>
        ) : remoteChanged && saveState !== "saving" ? (
          <p className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-900">
            This campaign was updated elsewhere. Your next save will check for conflicts.
          </p>
        ) : null}
        {readOnly ? (
          <p className="flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm text-stone-700">
            <Lock className="h-4 w-4 shrink-0" />
            {campaign.status === "sending"
              ? "This issue is being delivered right now. Pause it to make changes."
              : "This campaign has been sent and is read-only. Duplicate it to reuse the content."}
          </p>
        ) : null}
        {listCache && listCache.mailConfigured === false ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-950">
            Outgoing email is not configured on this server — sends will be recorded as failed.
          </p>
        ) : null}
      </div>

      <div className="grid gap-5 pt-4 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
        <div className="space-y-4">
          <Section
            id="nl-inbox"
            step={1}
            title="Inbox"
            description="What guests see before they open the email."
            done={checks.inbox}
          >
            <div className="space-y-3">
              <label className="block">
                <Label hint={`${form.subject.length}/200`}>Subject line</Label>
                <TagInput
                  value={form.subject}
                  disabled={readOnly}
                  maxLength={200}
                  placeholder="{{monthName}} at {{orgName}} — what's new"
                  onChange={(subject) => patch({ subject })}
                  ariaLabel="Subject line"
                />
              </label>
              <label className="block">
                <Label hint="Shown next to the subject in most inboxes">Preview text</Label>
                <TagInput
                  value={form.preheader}
                  disabled={readOnly}
                  maxLength={200}
                  placeholder="New events, offers and more this month"
                  onChange={(preheader) => patch({ preheader })}
                  ariaLabel="Preview text"
                />
              </label>
            </div>
          </Section>

          <Section
            id="nl-content"
            step={2}
            title="Content"
            description="Build the email from blocks. Drag to reorder, hover between blocks to insert."
            done={checks.content}
          >
            <BlockList
              blocks={form.blocks}
              disabled={readOnly}
              onChange={(blocks) => patch({ blocks })}
            />
          </Section>

          <Section
            id="nl-audience"
            step={3}
            title="Audience"
            description="Only guests who opted in to marketing email are ever included."
            done={checks.audience}
          >
            <div className="space-y-3">
              <label className="block">
                <Label>Park</Label>
                <select
                  className={fieldCls}
                  value={form.locationId}
                  disabled={readOnly}
                  onChange={(e) => patch({ locationId: e.target.value })}
                >
                  {!parkLocked || !form.locationId ? (
                    <option value="" disabled={parkLocked}>
                      Whole company (all parks)
                    </option>
                  ) : null}
                  {venueList.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <ChoiceCard
                  active={form.audience.source === "all_opted_in"}
                  disabled={readOnly}
                  onClick={() => patchAudience({ source: "all_opted_in" })}
                  icon={<Users className="h-3.5 w-3.5" />}
                  title="Everyone opted in"
                  text="Guests who agreed to marketing email anywhere"
                />
                <ChoiceCard
                  active={form.audience.source === "newsletter"}
                  disabled={readOnly}
                  onClick={() => patchAudience({ source: "newsletter" })}
                  icon={<Sparkles className="h-3.5 w-3.5" />}
                  title="Newsletter sign-ups"
                  text="Only guests from your signup form"
                />
              </div>
              <div>
                <Label>Visited</Label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { v: null, l: "Any time" },
                    { v: 30, l: "Last 30 days" },
                    { v: 90, l: "Last 90 days" },
                    { v: 180, l: "Last 6 months" },
                    { v: 365, l: "Last 12 months" },
                  ].map((o) => (
                    <button
                      key={o.l}
                      type="button"
                      disabled={readOnly}
                      onClick={() => patchAudience({ visitedWithinDays: o.v })}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition ${
                        form.audience.visitedWithinDays === o.v
                          ? "bg-stone-900 text-white ring-stone-900"
                          : "bg-white text-stone-600 ring-stone-200 hover:ring-[#D4AF37]/50"
                      }`}
                    >
                      {o.l}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-stone-50 px-3 py-2.5 ring-1 ring-stone-200/90">
                <span>
                  <span className="block text-sm font-medium text-stone-800">Active members only</span>
                  <span className="block text-xs text-stone-500">Guests with a current membership</span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.audience.activeMembersOnly}
                  disabled={readOnly}
                  onClick={() => patchAudience({ activeMembersOnly: !form.audience.activeMembersOnly })}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                    form.audience.activeMembersOnly ? "bg-[#D4AF37]" : "bg-stone-300"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                      form.audience.activeMembersOnly ? "left-[22px]" : "left-0.5"
                    }`}
                  />
                </button>
              </label>
              <div className="flex items-center gap-3 rounded-xl bg-gradient-to-r from-[#D4AF37]/15 to-transparent px-4 py-3 ring-1 ring-[#D4AF37]/25">
                <Users className="h-5 w-5 text-[#8a7020]" />
                <div>
                  <p className="text-xl font-semibold tabular-nums text-stone-900">
                    {preview.isFetching && !preview.data ? "…" : audienceCount.toLocaleString()}
                  </p>
                  <p className="text-xs text-stone-600">
                    guest{audienceCount === 1 ? "" : "s"} will receive this · updates live as you filter
                  </p>
                </div>
                {preview.isFetching ? <Loader2 className="ml-auto h-4 w-4 animate-spin text-[#A6892A]" /> : null}
              </div>
            </div>
          </Section>

          <Section
            id="nl-schedule"
            step={4}
            title="Schedule"
            description="Send automatically every month, or once at a time you choose."
            done={checks.schedule}
          >
            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <ChoiceCard
                  active={form.scheduleKind === "monthly"}
                  disabled={readOnly}
                  onClick={() => patch({ scheduleKind: "monthly" })}
                  icon={<Repeat className="h-3.5 w-3.5" />}
                  title="Every month"
                  text="A fresh issue on the same day each month"
                />
                <ChoiceCard
                  active={form.scheduleKind === "once"}
                  disabled={readOnly}
                  onClick={() => patch({ scheduleKind: "once" })}
                  icon={<CalendarDays className="h-3.5 w-3.5" />}
                  title="Send once"
                  text="A one-off announcement"
                />
              </div>
              {form.scheduleKind === "monthly" ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block">
                    <Label>Day of month</Label>
                    <select
                      className={fieldCls}
                      value={form.dayOfMonth}
                      disabled={readOnly}
                      onChange={(e) => patch({ dayOfMonth: Number(e.target.value) })}
                    >
                      {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                        <option key={d} value={d}>
                          {suffix(d)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <Label>Time</Label>
                    <select
                      className={fieldCls}
                      value={form.sendHour}
                      disabled={readOnly}
                      onChange={(e) => patch({ sendHour: Number(e.target.value) })}
                    >
                      {Array.from({ length: 24 }, (_, h) => h).map((h) => (
                        <option key={h} value={h}>
                          {String(h).padStart(2, "0")}:00
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <Label>Timezone</Label>
                    <select
                      className={fieldCls}
                      value={form.timezone}
                      disabled={readOnly}
                      onChange={(e) => patch({ timezone: e.target.value })}
                    >
                      {timeZoneOptions(form.timezone).map((tz) => (
                        <option key={tz} value={tz}>
                          {tz.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : (
                <label className="block">
                  <Label hint="Your local time">Send at</Label>
                  <input
                    type="datetime-local"
                    className={fieldCls}
                    value={form.sendAtLocal}
                    disabled={readOnly}
                    min={toLocalInput(new Date(now).toISOString())}
                    onChange={(e) => patch({ sendAtLocal: e.target.value })}
                  />
                  {form.sendAtLocal && !sendAtFuture ? (
                    <span className="mt-1 block text-[11px] text-amber-700">
                      That time has passed — pick a future time, or use Send now.
                    </span>
                  ) : null}
                </label>
              )}
              <div className="rounded-xl bg-stone-50 px-4 py-3 text-sm text-stone-700 ring-1 ring-stone-200/80">
                {form.scheduleKind === "monthly" ? (
                  <>
                    Sends on the <strong>{suffix(form.dayOfMonth)}</strong> of every month at{" "}
                    <strong>{String(form.sendHour).padStart(2, "0")}:00</strong> ({form.timezone.replace(/_/g, " ")}).
                    {firstMonthly ? (
                      <span className="block text-xs text-stone-500">
                        First issue: {formatInZone(firstMonthly, form.timezone)} · “Month” and upcoming events
                        refresh for every issue, and nobody receives the same month twice.
                      </span>
                    ) : null}
                  </>
                ) : sendAtDate ? (
                  <>
                    Sends once on <strong>{sendAtDate.toLocaleString()}</strong>.
                  </>
                ) : (
                  "Pick a date and time, or use Send now to deliver immediately."
                )}
              </div>
            </div>
          </Section>
        </div>

        <aside className="space-y-3 lg:sticky lg:top-[132px] lg:max-h-[calc(92vh-170px)] lg:self-start lg:overflow-y-auto lg:pb-2">
          <PreviewPane
            preview={preview.data}
            loading={preview.isFetching}
            error={preview.isError ? (preview.error as Error).message : null}
          />
          {preview.data ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-stone-200/90 bg-white px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-400">Recipients</p>
                <p className="text-lg font-semibold tabular-nums text-stone-900">
                  {preview.data.audienceCount.toLocaleString()}
                </p>
              </div>
              <div className="rounded-xl border border-stone-200/90 bg-white px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-400">
                  Events on sale
                </p>
                <p className="text-lg font-semibold tabular-nums text-stone-900">{preview.data.eventCount}</p>
              </div>
            </div>
          ) : null}
          {campaign.lastWindow ? (
            <div className="rounded-xl border border-stone-200/90 bg-white px-3 py-2.5 text-xs text-stone-600">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-400">
                Latest delivery
              </p>
              <span className="mr-2 font-semibold text-emerald-700">{campaign.lastWindow.sent} sent</span>
              {campaign.lastWindow.skipped ? <span className="mr-2">{campaign.lastWindow.skipped} skipped</span> : null}
              {campaign.lastWindow.failed ? (
                <span className="font-semibold text-red-600">{campaign.lastWindow.failed} failed</span>
              ) : null}
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
