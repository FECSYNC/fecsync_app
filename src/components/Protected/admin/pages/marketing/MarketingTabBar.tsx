"use client";

export type MarketingTabId =
  | "overview"
  | "newsletter"
  | "campaigns"
  | "automations"
  | "surveys"
  | "settings";

export const MARKETING_TAB_META: {
  id: MarketingTabId;
  label: string;
  title: string;
  subtitle: string;
}[] = [
  {
    id: "overview",
    label: "Overview",
    title: "Marketing overview",
    subtitle: "KPIs and bridges to Memberships / Waivers.",
  },
  {
    id: "newsletter",
    label: "Newsletter",
    title: "Newsletter & leads",
    subtitle: "Public signup without a waiver. Opt-in list for promotional mail.",
  },
  {
    id: "campaigns",
    label: "Campaigns",
    title: "Newsletter campaigns",
    subtitle: "Compose newsletters and send them once or automatically every month.",
  },
  {
    id: "automations",
    label: "Automations",
    title: "Automations",
    subtitle: "Welcome, birthday, re-engagement, and post-visit survey invites.",
  },
  {
    id: "surveys",
    label: "Surveys",
    title: "Guest surveys",
    subtitle: "Draft and publish post-visit surveys.",
  },
  {
    id: "settings",
    label: "Settings",
    title: "Marketing settings",
    subtitle: "From name, CTAs, newsletter capture, and integration honesty.",
  },
];

type Props = {
  active: MarketingTabId;
  /** Opens a desk modal for non-overview tabs (no route change). */
  onOpenTab: (id: MarketingTabId) => void;
};

export default function MarketingTabBar({ active, onOpenTab }: Props) {
  return (
    <nav
      className="mb-7 flex flex-wrap gap-1.5 rounded-2xl border border-stone-200/80 bg-white/80 p-1.5 shadow-sm shadow-stone-900/5 backdrop-blur-sm"
      aria-label="Marketing sections"
    >
      {MARKETING_TAB_META.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onOpenTab(tab.id)}
            aria-current={isActive ? "page" : undefined}
            className={`rounded-xl px-3.5 py-2 text-sm font-medium transition ${
              isActive
                ? "bg-[#D4AF37] text-stone-900 shadow-sm shadow-[#D4AF37]/35"
                : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}

export function marketingTabFromSearchParam(
  raw: string | null | undefined
): MarketingTabId | null {
  if (!raw) return null;
  const id = raw.trim().toLowerCase();
  if (
    id === "newsletter" ||
    id === "campaigns" ||
    id === "automations" ||
    id === "surveys" ||
    id === "settings"
  ) {
    return id;
  }
  if (id === "overview") return null;
  return null;
}

/** Map legacy leaf paths → desk tab (sidebar deep links). */
export function marketingTabFromPathname(pathname: string): MarketingTabId | null {
  const norm =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;
  if (norm === "/admin/marketing/newsletter") return "newsletter";
  if (norm === "/admin/marketing/campaigns") return "campaigns";
  if (norm === "/admin/marketing/automations") return "automations";
  if (norm === "/admin/marketing/surveys") return "surveys";
  if (norm === "/admin/marketing/settings") return "settings";
  return null;
}
