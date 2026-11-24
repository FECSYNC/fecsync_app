/** Shared Harewa POS station-tool visual tokens. */
export const posField =
  "w-full rounded-xl bg-stone-50 px-3.5 py-2.5 text-sm text-stone-900 ring-1 ring-stone-200/90 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/55";

export const posPrimaryBtn =
  "rounded-xl bg-[#D4AF37] px-4 py-2.5 text-sm font-semibold text-stone-900 shadow-sm shadow-[#D4AF37]/25 transition hover:brightness-105 disabled:opacity-45";

export const posSoftBtn =
  "rounded-xl bg-white px-3.5 py-2.5 text-sm font-medium text-stone-800 ring-1 ring-stone-200 transition hover:ring-[#D4AF37]/60 disabled:opacity-45";

export const posDarkBtn =
  "rounded-xl bg-stone-900 px-3.5 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:opacity-45";

export const posGuideBtn =
  "rounded-full bg-[#D4AF37] px-3.5 py-1.5 text-[11px] font-semibold text-stone-900 shadow-sm shadow-[#D4AF37]/25 transition hover:brightness-105";

export function saleStatusTone(status: string): string {
  const s = status.toLowerCase();
  if (s === "completed" || s === "paid") {
    return "bg-emerald-50 text-emerald-800 ring-emerald-200";
  }
  if (s === "voided" || s === "refunded") {
    return "bg-stone-100 text-stone-600 ring-stone-200";
  }
  if (s.includes("pending") || s.includes("unpaid") || s.includes("open")) {
    return "bg-amber-50 text-amber-950 ring-amber-200";
  }
  return "bg-stone-100 text-stone-700 ring-stone-200";
}
