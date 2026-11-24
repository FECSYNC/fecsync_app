"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Cake,
  ClipboardList,
  Mail,
  MessageSquareHeart,
  Newspaper,
  RefreshCw,
  Send,
  Sparkles,
  UserPlus,
  Users,
} from "lucide-react";
import MarketingTabBar, {
  MARKETING_TAB_META,
  marketingTabFromPathname,
  marketingTabFromSearchParam,
  type MarketingTabId,
} from "@/components/Protected/admin/pages/marketing/MarketingTabBar";
import MarketingDeskModal from "@/components/Protected/admin/pages/marketing/MarketingDeskModal";
import MarketingNewsletterPanel from "@/components/Protected/admin/pages/marketing/panels/MarketingNewsletterPanel";
import MarketingCampaignsPanel from "@/components/Protected/admin/pages/marketing/panels/MarketingCampaignsPanel";
import MarketingAutomationsPanel from "@/components/Protected/admin/pages/marketing/panels/MarketingAutomationsPanel";
import MarketingSurveysPanel from "@/components/Protected/admin/pages/marketing/panels/MarketingSurveysPanel";
import MarketingSettingsPanel from "@/components/Protected/admin/pages/marketing/panels/MarketingSettingsPanel";
import AdminPendingLink from "@/components/Protected/admin/components/AdminPendingLink";
import { useMarketingCrossTabSync, useMarketingOverview } from "@/hooks/useMarketing";
import type { MarketingOverviewDto } from "@/lib/marketing/types";
import { useAuthStore } from "@/store/authStore";
import { isStorefrontOrgSession } from "@/hooks/useAdminPermission";

type MetricDef = {
  key: string;
  label: string;
  hint: string;
  icon: ReactNode;
  openTab?: Exclude<MarketingTabId, "overview">;
  getValue: (data: MarketingOverviewDto) => number;
};

const METRICS: MetricDef[] = [
  {
    key: "leads",
    label: "Opted-in leads",
    hint: "Newsletter consent",
    icon: <UserPlus className="h-4 w-4" strokeWidth={2} />,
    openTab: "newsletter",
    getValue: (d) => d.optedInLeadCount,
  },
  {
    key: "campaigns",
    label: "Newsletter campaigns",
    hint: "Scheduled or sending",
    icon: <Newspaper className="h-4 w-4" strokeWidth={2} />,
    openTab: "campaigns",
    getValue: (d) => d.campaignActiveCount,
  },
  {
    key: "newsletterSent",
    label: "Newsletters sent",
    hint: "Last 30 days",
    icon: <Send className="h-4 w-4" strokeWidth={2} />,
    openTab: "campaigns",
    getValue: (d) => d.newsletterSentLast30Days,
  },
  {
    key: "welcome",
    label: "Welcome emails sent",
    hint: "Automation sends",
    icon: <Mail className="h-4 w-4" strokeWidth={2} />,
    openTab: "automations",
    getValue: (d) => d.welcomeSentCount,
  },
  {
    key: "birthdays",
    label: "Birthdays upcoming",
    hint: "Window from settings",
    icon: <Cake className="h-4 w-4" strokeWidth={2} />,
    openTab: "automations",
    getValue: (d) => d.birthdayUpcomingCount,
  },
  {
    key: "reengage",
    label: "Re-engagement queue",
    hint: "Lapsed guests",
    icon: <Sparkles className="h-4 w-4" strokeWidth={2} />,
    openTab: "automations",
    getValue: (d) => d.reengagementQueueCount,
  },
  {
    key: "surveys",
    label: "Surveys published",
    hint: "Live guest surveys",
    icon: <ClipboardList className="h-4 w-4" strokeWidth={2} />,
    openTab: "surveys",
    getValue: (d) => d.surveyPublishedCount,
  },
  {
    key: "responses",
    label: "Survey responses",
    hint: "All-time submissions",
    icon: <MessageSquareHeart className="h-4 w-4" strokeWidth={2} />,
    openTab: "surveys",
    getValue: (d) => d.surveyResponseCount,
  },
];

function useAnimatedInt(value: number) {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);

  useEffect(() => {
    const from = prev.current;
    const to = value;
    prev.current = value;
    if (from === to) {
      setDisplay(to);
      return;
    }
    const start = performance.now();
    const duration = 420;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return display;
}

function LiveBadge({
  updatedAt,
  syncing,
}: {
  updatedAt?: number;
  syncing: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-200/80">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
      </span>
      {syncing ? "Syncing…" : "Live"}
      {updatedAt ? (
        <span className="font-normal text-emerald-700/80">
          · updated {new Date(updatedAt).toLocaleTimeString()}
        </span>
      ) : null}
    </span>
  );
}

function MetricCard({
  label,
  hint,
  value,
  icon,
  index,
  onOpen,
}: {
  label: string;
  hint: string;
  value: number;
  icon: ReactNode;
  index: number;
  onOpen?: () => void;
}) {
  const animated = useAnimatedInt(value);
  const interactive = Boolean(onOpen);

  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#D4AF37]/15 text-[#8a7020] ring-1 ring-[#D4AF37]/25">
          {icon}
        </span>
        {interactive ? (
          <ArrowRight className="h-4 w-4 text-stone-300 transition group-hover:translate-x-0.5 group-hover:text-[#A6892A]" />
        ) : null}
      </div>
      <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
        {label}
      </p>
      <p className="mt-1 font-semibold text-3xl tabular-nums tracking-tight text-stone-900">
        {animated.toLocaleString()}
      </p>
      <p className="mt-1 text-xs text-stone-500">{hint}</p>
    </>
  );

  const className =
    "group relative overflow-hidden rounded-2xl border border-stone-200/90 bg-white/95 p-4 text-left shadow-sm shadow-stone-900/5 transition hover:-translate-y-0.5 hover:border-[#D4AF37]/45 hover:shadow-md hover:shadow-[#D4AF37]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]/55";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.32,
        delay: 0.04 * index,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      {interactive ? (
        <button type="button" onClick={onOpen} className={`${className} w-full`}>
          {inner}
        </button>
      ) : (
        <div className={className}>{inner}</div>
      )}
    </motion.div>
  );
}

function MetricSkeleton({ label, index }: { label: string; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: 0.03 * index }}
      className="rounded-2xl border border-stone-200/90 bg-white/90 p-4 shadow-sm"
    >
      <div className="h-9 w-9 animate-pulse rounded-xl bg-stone-200" />
      <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
        {label}
      </p>
      <div className="mt-2 h-8 w-20 animate-pulse rounded-lg bg-stone-200" />
      <div className="mt-2 h-3 w-28 animate-pulse rounded bg-stone-100" />
    </motion.div>
  );
}

function BridgeCard({
  title,
  description,
  status,
  href,
  cta,
  delay,
  icon,
}: {
  title: string;
  description: string;
  status: ReactNode;
  href: string;
  cta: string;
  delay: number;
  icon: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, delay, ease: [0.22, 1, 0.36, 1] }}
      className="relative overflow-hidden rounded-2xl border border-stone-200/90 bg-gradient-to-br from-white via-stone-50/80 to-[#D4AF37]/10 p-5 shadow-sm shadow-stone-900/5"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#8a7020] shadow-sm ring-1 ring-stone-200/80">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-stone-900">{title}</h2>
          <p className="mt-1 text-sm text-stone-600">{description}</p>
          <div className="mt-3">{status}</div>
          <AdminPendingLink
            href={href}
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#8a7020] transition hover:text-stone-900"
          >
            {cta}
            <ArrowRight className="h-3.5 w-3.5" />
          </AdminPendingLink>
        </div>
      </div>
    </motion.div>
  );
}

export default function MarketingOverviewPage() {
  const user = useAuthStore((s) => s.user);
  const storefront = isStorefrontOrgSession(user);
  useMarketingCrossTabSync();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  /** Which pill stays highlighted (survives modal close). */
  const [activeTab, setActiveTab] = useState<MarketingTabId>("overview");
  /** Whether the desk modal is visible (independent of activeTab). */
  const [deskOpen, setDeskOpen] = useState(false);
  /** User closed the modal — don't auto-reopen from the still-present ?tab=. */
  const dismissedRef = useRef(false);

  const { data, isLoading, error, dataUpdatedAt, isFetching, refetch } =
    useMarketingOverview(null, {
      enabled: !storefront,
    });

  const syncUrl = useCallback(
    (next: MarketingTabId | null) => {
      const base = "/admin/marketing";
      if (!next || next === "overview") {
        router.replace(base, { scroll: false });
        return;
      }
      router.replace(`${base}?tab=${next}`, { scroll: false });
    },
    [router]
  );

  const openTab = useCallback(
    (id: MarketingTabId) => {
      dismissedRef.current = false;
      setActiveTab(id);
      if (id === "overview") {
        setDeskOpen(false);
        syncUrl(null);
        return;
      }
      setDeskOpen(true);
      syncUrl(id);
    },
    [syncUrl]
  );

  /** Close modal only — keep the last tab selected/highlighted + ?tab= in the URL. */
  const closePanel = useCallback(() => {
    dismissedRef.current = true;
    setDeskOpen(false);
  }, []);

  // Deep-link: ?tab=… or legacy /admin/marketing/newsletter paths.
  useEffect(() => {
    const fromQuery = marketingTabFromSearchParam(searchParams.get("tab"));
    const fromPath = marketingTabFromPathname(pathname || "");
    const next = fromQuery ?? fromPath;
    if (next) {
      setActiveTab(next);
      if (!dismissedRef.current) setDeskOpen(true);
      return;
    }
    dismissedRef.current = false;
    setActiveTab("overview");
    setDeskOpen(false);
  }, [searchParams, pathname]);

  const openPanelId: MarketingTabId | null =
    deskOpen && activeTab !== "overview" ? activeTab : null;
  const meta = MARKETING_TAB_META.find((t) => t.id === openPanelId);
  const syncing = isFetching && !isLoading;

  return (
    <div className="relative mx-auto max-w-5xl px-4 py-8">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-6 h-56 bg-[radial-gradient(ellipse_at_top,_rgba(212,175,55,0.16),_transparent_60%)]"
      />

      <header className="relative mb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#A6892A]">
              Guest marketing
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-stone-900">
              Marketing overview
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-600">
              Newsletter leads, automations, and surveys stay on this engine.
              Membership dunning and waiver expiry reminders live on their own
              desks — bridged below. Sections open as panels without a full page
              reload.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LiveBadge updatedAt={dataUpdatedAt || undefined} syncing={syncing} />
            <button
              type="button"
              onClick={() => void refetch()}
              disabled={isFetching}
              className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-[11px] font-medium text-stone-700 shadow-sm transition hover:border-[#D4AF37]/50 hover:text-stone-900 disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`}
              />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <MarketingTabBar active={activeTab} onOpenTab={openTab} />

      <AnimatePresence>
        {error ? (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {(error as Error).message || "Failed to load overview"}
          </motion.p>
        ) : null}
      </AnimatePresence>

      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {data
          ? METRICS.map((m, index) => (
              <MetricCard
                key={m.key}
                label={m.label}
                hint={m.hint}
                value={m.getValue(data)}
                icon={m.icon}
                index={index}
                onOpen={m.openTab ? () => openTab(m.openTab!) : undefined}
              />
            ))
          : isLoading
            ? METRICS.map((m, index) => (
                <MetricSkeleton key={m.key} label={m.label} index={index} />
              ))
            : null}
      </div>

      {data ? (
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <BridgeCard
            title="Memberships bridge"
            description="Past-due dunning stays on the Memberships engine — not duplicated here."
            delay={0.18}
            icon={<Users className="h-4 w-4" strokeWidth={2} />}
            status={
              <div className="flex flex-wrap gap-2">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${
                    data.membershipsDunning.dunningEnabled
                      ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                      : "bg-stone-100 text-stone-600 ring-stone-200"
                  }`}
                >
                  Dunning {data.membershipsDunning.dunningEnabled ? "on" : "off"}
                </span>
                <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-900 ring-1 ring-amber-200/80">
                  {data.membershipsDunning.pastDueCount.toLocaleString()} past due
                </span>
              </div>
            }
            href="/admin/memberships/settings"
            cta="Memberships settings"
          />
          <BridgeCard
            title="Waivers bridge"
            description="Expiry reminder windows stay on Digital Waivers — linked for one glance."
            delay={0.24}
            icon={<ClipboardList className="h-4 w-4" strokeWidth={2} />}
            status={
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-medium text-stone-700 ring-1 ring-stone-200">
                  Remind:{" "}
                  {data.waiverReminders.remindBeforeDays.join(", ") || "—"} days
                </span>
                <span className="inline-flex items-center rounded-full bg-[#D4AF37]/15 px-2.5 py-1 text-[11px] font-medium text-[#8a7020] ring-1 ring-[#D4AF37]/30">
                  {data.waiverReminders.sentLast30Days.toLocaleString()} reminders
                  (30d)
                </span>
              </div>
            }
            href="/admin/waivers/settings"
            cta="Waiver settings"
          />
        </div>
      ) : null}

      <MarketingDeskModal
        open={openPanelId === "newsletter"}
        title={meta?.title ?? "Newsletter"}
        subtitle={meta?.subtitle}
        onClose={closePanel}
      >
        <MarketingNewsletterPanel />
      </MarketingDeskModal>
      <MarketingDeskModal
        open={openPanelId === "campaigns"}
        title={
          MARKETING_TAB_META.find((t) => t.id === "campaigns")?.title ?? "Campaigns"
        }
        subtitle={
          MARKETING_TAB_META.find((t) => t.id === "campaigns")?.subtitle
        }
        onClose={closePanel}
        wide
      >
        <MarketingCampaignsPanel />
      </MarketingDeskModal>
      <MarketingDeskModal
        open={openPanelId === "automations"}
        title={
          MARKETING_TAB_META.find((t) => t.id === "automations")?.title ??
          "Automations"
        }
        subtitle={
          MARKETING_TAB_META.find((t) => t.id === "automations")?.subtitle
        }
        onClose={closePanel}
      >
        <MarketingAutomationsPanel />
      </MarketingDeskModal>
      <MarketingDeskModal
        open={openPanelId === "surveys"}
        title={
          MARKETING_TAB_META.find((t) => t.id === "surveys")?.title ?? "Surveys"
        }
        subtitle={
          MARKETING_TAB_META.find((t) => t.id === "surveys")?.subtitle
        }
        onClose={closePanel}
      >
        <MarketingSurveysPanel />
      </MarketingDeskModal>
      <MarketingDeskModal
        open={openPanelId === "settings"}
        title={
          MARKETING_TAB_META.find((t) => t.id === "settings")?.title ??
          "Settings"
        }
        subtitle={
          MARKETING_TAB_META.find((t) => t.id === "settings")?.subtitle
        }
        onClose={closePanel}
      >
        <MarketingSettingsPanel />
      </MarketingDeskModal>
    </div>
  );
}
