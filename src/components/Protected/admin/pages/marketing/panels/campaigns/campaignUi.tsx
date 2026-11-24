"use client";

import type { CampaignScheduleKind, CampaignStatus } from "@/lib/marketing/campaigns/types";

const STATUS_STYLE: Record<CampaignStatus, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-stone-100 text-stone-700 ring-stone-200" },
  scheduled: { label: "Scheduled", cls: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  sending: { label: "Sending", cls: "bg-sky-50 text-sky-800 ring-sky-200" },
  sent: { label: "Sent", cls: "bg-[#D4AF37]/15 text-[#8a7020] ring-[#D4AF37]/30" },
  paused: { label: "Paused", cls: "bg-amber-50 text-amber-900 ring-amber-200/80" },
  archived: { label: "Archived", cls: "bg-stone-100 text-stone-500 ring-stone-200" },
};

export function CampaignStatusChip({ status }: { status: CampaignStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${s.cls}`}
    >
      {status === "sending" ? (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" />
      ) : null}
      {s.label}
    </span>
  );
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export function describeSchedule(c: {
  scheduleKind: CampaignScheduleKind;
  dayOfMonth: number | null;
  sendHour: number;
  timezone: string;
  sendAt: string | null;
}): string {
  if (c.scheduleKind === "monthly") {
    const day = c.dayOfMonth ?? 1;
    return `Every month on the ${ordinal(day)} at ${String(c.sendHour).padStart(2, "0")}:00 (${c.timezone})`;
  }
  if (c.sendAt) return `Once on ${new Date(c.sendAt).toLocaleString()}`;
  return "One-off — no send time set";
}
