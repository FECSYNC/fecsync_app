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
  Globe,
  Link2,
  Mail,
  Newspaper,
  PartyPopper,
  RefreshCw,
  Tag,
} from "lucide-react";
import {
  useMarketingSettings,
  usePatchMarketingSettings,
} from "@/hooks/useMarketing";
import type { MarketingAutomationSettingsDto } from "@/lib/marketing/types";

type FormState = {
  newsletterEnabled: boolean;
  fromName: string;
  replyToEmail: string;
  websiteCtaUrl: string;
  partyCategorySlug: string;
  promoCodeOrUrl: string;
};

const INTEGRATIONS = [
  {
    id: "campaign_monitor",
    name: "Campaign Monitor",
    hint: "ESP sync is not live in this build.",
  },
  {
    id: "salesforce",
    name: "Salesforce",
    hint: "CRM sync is not live in this build.",
  },
  {
    id: "roller_connect",
    name: "ROLLER Connect",
    hint: "Partner connector not configured.",
  },
  {
    id: "t2_connect",
    name: "T2 Connect",
    hint: "Partner connector not configured.",
  },
  {
    id: "patch_retention",
    name: "Patch Retention",
    hint: "Retention sync is not live in this build.",
  },
] as const;

function fromDto(data: MarketingAutomationSettingsDto): FormState {
  return {
    newsletterEnabled: data.newsletterEnabled,
    fromName: data.fromName ?? "",
    replyToEmail: data.replyToEmail ?? "",
    websiteCtaUrl: data.websiteCtaUrl ?? "",
    partyCategorySlug: data.partyCategorySlug ?? "",
    promoCodeOrUrl: data.promoCodeOrUrl ?? "",
  };
}

function formsEqual(a: FormState, b: FormState) {
  return (
    a.newsletterEnabled === b.newsletterEnabled &&
    a.fromName === b.fromName &&
    a.replyToEmail === b.replyToEmail &&
    a.websiteCtaUrl === b.websiteCtaUrl &&
    a.partyCategorySlug === b.partyCategorySlug &&
    a.promoCodeOrUrl === b.promoCodeOrUrl
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

function Field({
  label,
  hint,
  children,
  icon,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <label className="block">
      <span className="flex items-center gap-2 text-sm font-medium text-stone-800">
        {icon ? (
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#D4AF37]/15 text-[#8a7020] ring-1 ring-[#D4AF37]/25">
            {icon}
          </span>
        ) : null}
        {label}
      </span>
      {hint ? (
        <span className="mt-0.5 block text-xs text-stone-500">{hint}</span>
      ) : null}
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}

const fieldClass =
  "w-full rounded-xl border-0 bg-stone-50 px-3.5 py-2.5 text-sm text-stone-900 ring-1 ring-stone-200/90 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/55";

function looksLikeEmail(value: string) {
  if (!value.trim()) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function looksLikeUrl(value: string) {
  if (!value.trim()) return true;
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export default function MarketingSettingsPanel() {
  const {
    data,
    isLoading,
    isFetching,
    dataUpdatedAt,
    refetch,
    error,
  } = useMarketingSettings(null);
  const save = usePatchMarketingSettings();

  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState<{
    tone: "ok" | "err" | "info";
    text: string;
  } | null>(null);
  const [form, setForm] = useState<FormState>({
    newsletterEnabled: true,
    fromName: "",
    replyToEmail: "",
    websiteCtaUrl: "",
    partyCategorySlug: "",
    promoCodeOrUrl: "",
  });

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

  const syncing = isFetching && !isLoading;
  const emailOk = looksLikeEmail(form.replyToEmail);
  const urlOk = looksLikeUrl(form.websiteCtaUrl);

  const captureLabel = useMemo(
    () => (form.newsletterEnabled ? "Capture on" : "Capture off"),
    [form.newsletterEnabled]
  );

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!emailOk) {
      setNote({ tone: "err", text: "Reply-to email looks invalid." });
      return;
    }
    if (!urlOk) {
      setNote({
        tone: "err",
        text: "Website CTA URL must be a full http(s) link, or leave it blank.",
      });
      return;
    }
    save.mutate(
      {
        newsletterEnabled: form.newsletterEnabled,
        fromName: form.fromName.trim() || null,
        replyToEmail: form.replyToEmail.trim() || null,
        websiteCtaUrl: form.websiteCtaUrl.trim() || null,
        partyCategorySlug: form.partyCategorySlug.trim() || null,
        promoCodeOrUrl: form.promoCodeOrUrl.trim() || null,
      },
      {
        onSuccess: () => {
          setDirty(false);
          setNote({
            tone: "ok",
            text: "Saved. Newsletter, automations, and overview refresh from the same cache.",
          });
        },
        onError: (err) =>
          setNote({
            tone: "err",
            text:
              err instanceof Error ? err.message : "Could not save settings",
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
        <p className="max-w-xl text-sm leading-relaxed text-stone-600">
          Sender identity, CTAs, and newsletter capture for this company.
          Changes sync to automations and the public signup page.
        </p>
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
            <Newspaper className="h-3.5 w-3.5" />
          </span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-500">
              Newsletter
            </p>
            <p className="text-sm font-semibold text-stone-900">{captureLabel}</p>
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
          {(error as Error).message || "Failed to load settings"}
        </p>
      ) : null}

      {isLoading && !data ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-2xl bg-stone-100"
              style={{ opacity: 1 - i * 0.08 }}
            />
          ))}
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-5">
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden rounded-2xl border border-stone-200/90 bg-white shadow-sm"
          >
            <div className="border-b border-stone-100 bg-gradient-to-r from-[#D4AF37]/12 via-[#faf8f4] to-white px-4 py-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#A6892A]">
                Capture & sender
              </h3>
            </div>
            <div className="space-y-4 p-4">
              <div className="flex items-start justify-between gap-3 rounded-2xl border border-stone-200/90 bg-stone-50/60 p-3.5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-stone-900">
                    Newsletter capture enabled
                  </p>
                  <p className="mt-0.5 text-xs text-stone-500">
                    When off, the public signup page rejects new opt-ins.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.newsletterEnabled}
                  aria-label="Newsletter capture enabled"
                  onClick={() =>
                    patchForm({ newsletterEnabled: !form.newsletterEnabled })
                  }
                  className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${
                    form.newsletterEnabled ? "bg-[#D4AF37]" : "bg-stone-300"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
                      form.newsletterEnabled
                        ? "left-[1.375rem]"
                        : "left-0.5"
                    }`}
                  />
                </button>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="From name"
                  hint="Shown as the sender on promotional emails."
                  icon={<Mail className="h-3.5 w-3.5" />}
                >
                  <input
                    className={fieldClass}
                    value={form.fromName}
                    onChange={(e) => patchForm({ fromName: e.target.value })}
                    placeholder="Skyline360 Park"
                  />
                </Field>
                <Field
                  label="Reply-to email"
                  hint="Where guest replies should land."
                  icon={<Mail className="h-3.5 w-3.5" />}
                >
                  <input
                    className={`${fieldClass} ${!emailOk ? "ring-red-300 focus:ring-red-400" : ""}`}
                    type="email"
                    value={form.replyToEmail}
                    onChange={(e) =>
                      patchForm({ replyToEmail: e.target.value })
                    }
                    placeholder="hello@example.com"
                  />
                </Field>
              </div>
            </div>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.28,
              delay: 0.04,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="overflow-hidden rounded-2xl border border-stone-200/90 bg-gradient-to-br from-stone-50 via-white to-[#D4AF37]/10 shadow-sm"
          >
            <div className="border-b border-stone-100 px-4 py-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                CTAs & offers
              </h3>
              <p className="mt-0.5 text-xs text-stone-500">
                Used in automation templates and survey thank-you flows.
              </p>
            </div>
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <Field
                label="Website CTA URL"
                hint="Full https link preferred."
                icon={<Globe className="h-3.5 w-3.5" />}
              >
                <input
                  className={`${fieldClass} ${!urlOk ? "ring-red-300 focus:ring-red-400" : ""}`}
                  value={form.websiteCtaUrl}
                  onChange={(e) =>
                    patchForm({ websiteCtaUrl: e.target.value })
                  }
                  placeholder="https://…"
                />
              </Field>
              <Field
                label="Party category slug"
                hint="Public category path for party booking CTAs."
                icon={<PartyPopper className="h-3.5 w-3.5" />}
              >
                <input
                  className={fieldClass}
                  value={form.partyCategorySlug}
                  onChange={(e) =>
                    patchForm({ partyCategorySlug: e.target.value })
                  }
                  placeholder="birthday-parties"
                />
              </Field>
              <div className="sm:col-span-2">
                <Field
                  label="Default promo code or URL"
                  hint="Optional offer attached to welcome / survey thank-you."
                  icon={<Tag className="h-3.5 w-3.5" />}
                >
                  <input
                    className={fieldClass}
                    value={form.promoCodeOrUrl}
                    onChange={(e) =>
                      patchForm({ promoCodeOrUrl: e.target.value })
                    }
                    placeholder="WELCOME10 or https://…"
                  />
                </Field>
              </div>
            </div>
          </motion.section>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="submit"
              className="rounded-xl bg-[#D4AF37] px-4 py-2.5 text-sm font-semibold text-stone-900 shadow-sm shadow-[#D4AF37]/25 transition hover:brightness-105 disabled:opacity-50"
              disabled={save.isPending || !dirty || !emailOk || !urlOk}
            >
              {save.isPending ? "Saving…" : "Save settings"}
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

      <section className="overflow-hidden rounded-2xl border border-stone-200/90 bg-white shadow-sm">
        <div className="border-b border-stone-100 px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-stone-900">
            <Link2 className="h-4 w-4 text-[#8a7020]" />
            Integrations
          </h3>
          <p className="mt-0.5 text-xs text-stone-500">
            Honest status only — ESP / CRM sync is not live in this product yet.
          </p>
        </div>
        <ul className="divide-y divide-stone-100">
          {INTEGRATIONS.map((i, index) => (
            <motion.li
              key={i.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: 0.03 * index }}
              className="flex items-center justify-between gap-3 px-4 py-3.5"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-stone-900">{i.name}</p>
                <p className="text-xs text-stone-500">{i.hint}</p>
              </div>
              <span className="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold text-stone-600 ring-1 ring-stone-200">
                not_configured
              </span>
            </motion.li>
          ))}
        </ul>
      </section>
    </div>
  );
}
