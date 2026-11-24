/** Build a same-origin accounting CSV export URL (cookie auth). */
export function accountingCsvUrl(
  path: string,
  params: Record<string, string | number | boolean | null | undefined> = {}
): string {
  const base = path.startsWith("/") ? path : `/api/admin/accounting/${path}`;
  const sp = new URLSearchParams();
  sp.set("format", "csv");
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  return `${base}?${sp.toString()}`;
}

export function openAccountingCsv(
  path: string,
  params: Record<string, string | number | boolean | null | undefined> = {}
) {
  const url = accountingCsvUrl(path, params);
  window.open(url, "_blank", "noopener,noreferrer");
}
