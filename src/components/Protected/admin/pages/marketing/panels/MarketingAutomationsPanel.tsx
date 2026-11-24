"use client";

import {
  FormEvent,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { motion } from "framer-motion";
import {
  Cake,
  ClipboardList,
  Mail,
  RefreshCw,
  Sparkles,
  Send,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useMarketingAutomations,
  usePatchMarketingAutomations,
} from "@/hooks/useMarketing";
import {
  postMarketingTestSend,
  type MarketingAutomationsDto,
} from "@/services/marketing";
import { notifyMarketingChange } from "@/lib/marketingSync";

type FormState = {
  welcomeEnabled: boolean;
  birthdayEnabled: boolean;
  reengagementEnabled: boolean;
  postVisitSurveyEnabled: boolean;
  welcomeDelayHours: string;
  birthdayDaysAhead: string;
  reengagementInactiveDays: string;
  postVisitDelayHours: string;
};

function fromDto(data: MarketingAutomationsDto): FormState {
  return {
    welcomeEnabled: data.welcomeEnabled,
    birthdayEnabled: data.birthdayEnabled,
    reengagementEnabled: data.reengagementEnabled,
    postVisitSurveyEnabled: data.postVisitSurveyEnabled,
    welcomeDelayHours: String(data.welcomeDelayHours),
    birthdayDaysAhead: String(data.birthdayDaysAhead),
    reengagementInactiveDays: String(data.reengagementInactiveDays),
    postVisitDelayHours: String(data.postVisitDelayHours),
  };
}

function formsEqual(a: FormState, b: FormState) {
  return (
    a.welcomeEnabled === b.welcomeEnabled &&
    a.birthdayEnabled === b.birthdayEnabled &&
    a.reengagementEnabled === b.reengagementEnabled &&
    a.postVisitSurveyEnabled === b.postVisitSurveyEnabled &&
    a.welcomeDelayHours === b.welcomeDelayHours &&
    a.birthdayDaysAhead === b.birthdayDaysAhead &&
    a.reengagementInactiveDays === b.reengagementInactiveDays &&
    a.postVisitDelayHours === b.postVisitDelayHours
  );
}

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

function ToggleRow({
  title,
  hint,
  checked,
  onChange,
  icon,
  delay,
}: {
  title: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  icon: ReactNode;
  delay: number;
}) {
  return (
    <motion.label
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay, ease: [0.22, 1, 0.36, 1] }}
      className="flex cursor-pointer items-start gap-3 rounded-2xl border border-stone-200/90 bg-white p-3.5 shadow-sm shadow-stone-900/5 transition hover:border-[#D4AF37]/40"
    >
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#D4AF37]/15 text-[#8a7020] ring-1 ring-[#D4AF37]/25">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-stone-900">
          {title}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-stone-500">
          {hint}
        </span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        onClick={(e) => {
          e.preventDefault();
          onChange(!checked);
        }}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${
          checked ? "bg-[#D4AF37]" : "bg-stone-300"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
            checked ? "left-[1.375rem]" : "left-0.5"
          }`}
        />
      </button>
    </motion.label>
  );
}

const fieldClass =
  "mt-1.5 w-full rounded-xl border-0 bg-stone-50 px-3.5 py-2.5 text-sm text-stone-900 ring-1 ring-stone-200/90 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/55";

export default function MarketingAutomationsPanel() {
  const {
    data,
    isLoading,
    isFetching,
    dataUpdatedAt,
    refetch,
    error,
  } = useMarketingAutomations(null);
  const save = usePatchMarketingAutomations();
  const qc = useQueryClient();
  const testSend = useMutation({
    mutationFn: (kind: string) => postMarketingTestSend(kind),
    onSuccess: () => {
      notifyMarketingChange(qc);
    },
  });

  const [note, setNote] = useState<{
    tone: "ok" | "err" | "info";
    text: string;
  } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [form, setForm] = useState<FormState>({
    welcomeEnabled: true,
    birthdayEnabled: true,
    reengagementEnabled: true,
    postVisitSurveyEnabled: true,
    welcomeDelayHours: "24",
    birthdayDaysAhead: "14",
    reengagementInactiveDays: "90",
    postVisitDelayHours: "24",
  });

  // Live server → form when the desk is clean (don't clobber in-progress edits).
  useEffect(() => {
    if (!data || dirty) return;
    const next = fromDto(data);
    setForm((prev) => (formsEqual(prev, next) ? prev : next));
  }, [data, dirty]);

  function patchForm(patch: Partial<FormState>) {
    setDirty(true);
    setNote(null);
    setForm((f) => ({ ...f, ...patch }));
  }

  const activeCount = useMemo(() => {
    return [
      form.welcomeEnabled,
      form.birthdayEnabled,
      form.reengagementEnabled,
      form.postVisitSurveyEnabled,
    ].filter(Boolean).length;
  }, [form]);

  const syncing = isFetching && !isLoading;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const welcomeDelayHours = Number(form.welcomeDelayHours);
    const birthdayDaysAhead = Number(form.birthdayDaysAhead);
    const reengagementInactiveDays = Number(form.reengagementInactiveDays);
    const postVisitDelayHours = Number(form.postVisitDelayHours);
    if (
      ![
        welcomeDelayHours,
        birthdayDaysAhead,
        reengagementInactiveDays,
        postVisitDelayHours,
      ].every((n) => Number.isFinite(n) && n >= 0)
    ) {
      setNote({
        tone: "err",
        text: "Timing fields must be valid numbers of 0 or greater.",
      });
      return;
    }
    save.mutate(
      {
        welcomeEnabled: form.welcomeEnabled,
        birthdayEnabled: form.birthdayEnabled,
        reengagementEnabled: form.reengagementEnabled,
        postVisitSurveyEnabled: form.postVisitSurveyEnabled,
        welcomeDelayHours,
        birthdayDaysAhead,
        reengagementInactiveDays,
        postVisitDelayHours,
      },
      {
        onSuccess: () => {
          setDirty(false);
          setNote({
            tone: "ok",
            text: "Saved. Overview KPIs and related desks refresh automatically.",
          });
        },
        onError: (err) =>
          setNote({
            tone: "err",
            text:
              err instanceof Error ? err.message : "Could not save automations",
          }),
      }
    );
  }

  function discardLocal() {
    if (!data) return;
    setForm(fromDto(data));
    setDirty(false);
    setNote({ tone: "info", text: "Local edits discarded — back in sync." });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-xl">
          <p className="text-sm leading-relaxed text-stone-600">
            Promotional sends only go to guests with marketing opt-in. The cron
            worker runs{" "}
            <code className="rounded bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-700">
              /api/cron/marketing-automations
            </code>
            .
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LiveChip syncing={syncing} />
          {dataUpdatedAt ? (
            <span className="text-[11px] text-stone-400">
              Updated {new Date(dataUpdatedAt).toLocaleTimeString()}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-[11px] font-medium text-stone-700 shadow-sm transition hover:border-[#D4AF37]/50 disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2.5">
        <div className="flex min-w-[8rem] items-center gap-2.5 rounded-xl border border-stone-200/90 bg-white px-3 py-2.5 shadow-sm">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#D4AF37]/15 text-[#8a7020] ring-1 ring-[#D4AF37]/25">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-500">
              Active
            </p>
            <p className="text-lg font-semibold tabular-nums text-stone-900">
              {activeCount}
              <span className="text-sm font-medium text-stone-400"> / 4</span>
            </p>
          </div>
        </div>
        {dirty ? (
          <div className="flex items-center rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
            Unsaved changes
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {(error as Error).message || "Failed to load automations"}
        </p>
      ) : null}

      {isLoading && !data ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-2xl bg-stone-100"
              style={{ opacity: 1 - i * 0.1 }}
            />
          ))}
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-5">
          <section className="space-y-2.5">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
              Campaigns
            </h3>
            <ToggleRow
              title="Welcome email"
              hint="Send after newsletter signup or first guest capture."
              checked={form.welcomeEnabled}
              onChange={(v) => patchForm({ welcomeEnabled: v })}
              icon={<Mail className="h-4 w-4" strokeWidth={2} />}
              delay={0.02}
            />
            <ToggleRow
              title="Birthday campaign"
              hint="Reach opted-in guests ahead of their birthday."
              checked={form.birthdayEnabled}
              onChange={(v) => patchForm({ birthdayEnabled: v })}
              icon={<Cake className="h-4 w-4" strokeWidth={2} />}
              delay={0.06}
            />
            <ToggleRow
              title="Re-engagement"
              hint="Nudge guests who have been inactive for a while."
              checked={form.reengagementEnabled}
              onChange={(v) => patchForm({ reengagementEnabled: v })}
              icon={<Sparkles className="h-4 w-4" strokeWidth={2} />}
              delay={0.1}
            />
            <ToggleRow
              title="Post-visit survey invite"
              hint="Invite feedback after a visit; uses your default survey."
              checked={form.postVisitSurveyEnabled}
              onChange={(v) => patchForm({ postVisitSurveyEnabled: v })}
              icon={<ClipboardList className="h-4 w-4" strokeWidth={2} />}
              delay={0.14}
            />
          </section>

          <section className="overflow-hidden rounded-2xl border border-stone-200/90 bg-gradient-to-br from-stone-50 via-white to-[#D4AF37]/10 shadow-sm">
            <div className="border-b border-stone-100 px-4 py-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                Timing
              </h3>
              <p className="mt-0.5 text-xs text-stone-500">
                These windows also drive overview KPI queues (birthdays,
                re-engagement).
              </p>
            </div>
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <label className="block text-sm font-medium text-stone-800">
                Welcome delay (hours)
                <input
                  inputMode="numeric"
                  className={fieldClass}
                  value={form.welcomeDelayHours}
                  onChange={(e) =>
                    patchForm({ welcomeDelayHours: e.target.value })
                  }
                />
              </label>
              <label className="block text-sm font-medium text-stone-800">
                Birthday days ahead
                <input
                  inputMode="numeric"
                  className={fieldClass}
                  value={form.birthdayDaysAhead}
                  onChange={(e) =>
                    patchForm({ birthdayDaysAhead: e.target.value })
                  }
                />
              </label>
              <label className="block text-sm font-medium text-stone-800">
                Re-engagement inactive days
                <input
                  inputMode="numeric"
                  className={fieldClass}
                  value={form.reengagementInactiveDays}
                  onChange={(e) =>
                    patchForm({ reengagementInactiveDays: e.target.value })
                  }
                />
              </label>
              <label className="block text-sm font-medium text-stone-800">
                Post-visit delay (hours)
                <input
                  inputMode="numeric"
                  className={fieldClass}
                  value={form.postVisitDelayHours}
                  onChange={(e) =>
                    patchForm({ postVisitDelayHours: e.target.value })
                  }
                />
              </label>
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="submit"
              className="rounded-xl bg-[#D4AF37] px-4 py-2.5 text-sm font-semibold text-stone-900 shadow-sm shadow-[#D4AF37]/25 transition hover:brightness-105 disabled:opacity-50"
              disabled={save.isPending || !dirty}
            >
              {save.isPending ? "Saving…" : "Save automations"}
            </button>
            {dirty ? (
              <button
                type="button"
                className="rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
                onClick={discardLocal}
                disabled={save.isPending}
              >
                Discard
              </button>
            ) : null}
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-medium text-stone-800 transition hover:border-[#D4AF37]/50 disabled:opacity-50"
              disabled={testSend.isPending}
              onClick={() =>
                testSend.mutate("welcome", {
                  onSuccess: (r) =>
                    setNote({
                      tone: r.sent ? "ok" : "err",
                      text: r.sent
                        ? `Test welcome sent to ${r.toEmail}`
                        : "Mail is not configured for this workspace",
                    }),
                  onError: (err) =>
                    setNote({
                      tone: "err",
                      text:
                        err instanceof Error
                          ? err.message
                          : "Test send failed",
                    }),
                })
              }
            >
              <Send className="h-3.5 w-3.5" />
              {testSend.isPending ? "Sending…" : "Test welcome to my email"}
            </button>
          </div>

          {note ? (
            <p
              className={`rounded-xl px-4 py-3 text-sm ${
                note.tone === "ok"
                  ? "border border-emerald-200 bg-emerald-50 text-emerald-900"
                  : note.tone === "err"
                    ? "border border-red-200 bg-red-50 text-red-700"
                    : "border border-stone-200 bg-stone-50 text-stone-700"
              }`}
            >
              {note.text}
            </p>
          ) : null}
        </form>
      )}
    </div>
  );
}
