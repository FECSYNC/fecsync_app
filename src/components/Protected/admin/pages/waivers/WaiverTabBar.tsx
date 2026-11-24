"use client";

import { usePathname } from "next/navigation";
import { openWaiverPanel, useWaiverPanel, type WaiverPanelId } from "@/components/Protected/admin/pages/waivers/waiverPanel";
import { isAdminPageAllowed } from "@/hooks/useAdminPermission";
import { useAuthStore } from "@/store/authStore";

const TABS: { id: WaiverPanelId | "waivers"; href: string; label: string; active: (path: string) => boolean }[] = [
  {
    id: "waivers",
    href: "/admin/waivers",
    label: "Waivers",
    active: (path) =>
      path === "/admin/waivers" ||
      path.startsWith("/admin/waivers/records") ||
      path.startsWith("/admin/waivers/guests") ||
      path.startsWith("/admin/waivers/verify") ||
      path.startsWith("/admin/waivers/new") ||
      path.startsWith("/admin/waivers/import") ||
      path.startsWith("/admin/waivers/forms/responses") ||
      path.startsWith("/admin/waivers/compliance"),
  },
  {
    id: "template",
    href: "/admin/waivers/templates",
    label: "Template",
    active: (path) => path.startsWith("/admin/waivers/templates"),
  },
  {
    id: "forms",
    href: "/admin/waivers/forms",
    label: "Forms",
    active: (path) => path === "/admin/waivers/forms",
  },
  {
    id: "signage",
    href: "/admin/waivers/signage",
    label: "Signage",
    active: (path) => path.startsWith("/admin/waivers/signage"),
  },
  {
    id: "kiosk",
    href: "/admin/waivers/kiosk",
    label: "Kiosk",
    active: (path) => path.startsWith("/admin/waivers/kiosk"),
  },
  {
    id: "settings",
    href: "/admin/waivers/settings",
    label: "Settings",
    active: (path) => path.startsWith("/admin/waivers/settings"),
  },
];

export default function WaiverTabBar() {
  const path = usePathname() || "";
  const panel = useWaiverPanel();
  const user = useAuthStore((s) => s.user);
  const can = useAuthStore((s) => s.can);
  const tabs = TABS.filter((tab) => isAdminPageAllowed(tab.href, can, user).allowed);

  return (
    <nav className="mb-6" aria-label="Waivers">
      <div className="flex flex-wrap gap-2" role="tablist">
        {tabs.map((tab) => {
          const selected = panel ? panel === tab.id : tab.active(path);
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`rounded-full px-3 py-1 text-sm ${
                selected
                  ? "bg-[#D4AF37] font-semibold text-stone-950"
                  : "bg-stone-100 text-stone-700 hover:bg-stone-200"
              }`}
              onClick={() => openWaiverPanel(tab.id === "waivers" ? null : tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
