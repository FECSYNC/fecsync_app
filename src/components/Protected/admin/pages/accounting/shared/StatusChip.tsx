"use client";

const STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  pending_approval: "bg-amber-50 text-amber-800",
  approved: "bg-sky-50 text-sky-800",
  posted: "bg-emerald-50 text-emerald-800",
  reversed: "bg-purple-50 text-purple-800",
  void: "bg-stone-100 text-stone-600",
  open: "bg-emerald-50 text-emerald-800",
  closed: "bg-stone-100 text-stone-700",
  locked: "bg-red-50 text-red-700",
  submitted: "bg-amber-50 text-amber-800",
  rejected: "bg-red-50 text-red-700",
  paid: "bg-emerald-50 text-emerald-800",
  partially_paid: "bg-sky-50 text-sky-800",
  overdue: "bg-red-50 text-red-700",
  sent: "bg-sky-50 text-sky-800",
  in_progress: "bg-amber-50 text-amber-800",
  completed: "bg-emerald-50 text-emerald-800",
  unmatched: "bg-amber-50 text-amber-800",
  matched: "bg-sky-50 text-sky-800",
  reconciled: "bg-emerald-50 text-emerald-800",
  excluded: "bg-stone-100 text-stone-600",
  pending: "bg-amber-50 text-amber-800",
  processing: "bg-sky-50 text-sky-800",
  skipped: "bg-stone-100 text-stone-600",
  failed: "bg-red-50 text-red-700",
  active: "bg-emerald-50 text-emerald-800",
  archived: "bg-stone-100 text-stone-600",
};

function labelize(status: string) {
  return status.replace(/_/g, " ");
}

export default function StatusChip({
  status,
  className = "",
}: {
  status: string;
  className?: string;
}) {
  const key = status.toLowerCase();
  const style = STYLES[key] ?? "bg-gray-100 text-gray-700";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${style} ${className}`}
    >
      {labelize(key)}
    </span>
  );
}
