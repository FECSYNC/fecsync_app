/**
 * MembershipPlan.reportingCategory — GL-style reporting codes.
 * Shared by admin typeahead + merchandising write path.
 */

export const REPORTING_CATEGORY_MAX = 80;

/** Codes visible on the ROLLER reporting-category picker. */
export const STANDARD_REPORTING_CATEGORIES = [
  'BIRTHDAY',
  'CONCESSIONS',
  'EVENT',
  'F&B',
  'FLIGHT',
  'JUMP',
  'MOVIE',
  'NOISE',
] as const;

/** Normalize for storage / compare (uppercase, trim, collapse spaces). */
export function normalizeReportingCategory(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .slice(0, REPORTING_CATEGORY_MAX);
}

export function isStandardReportingCategory(code: string): boolean {
  const n = normalizeReportingCategory(code);
  return (STANDARD_REPORTING_CATEGORIES as readonly string[]).includes(n);
}

/**
 * Write-path sanitizer. Empty → null. Allows letters, digits, &, -, _, /, space.
 */
export function sanitizeReportingCategoryForWrite(
  raw: unknown
): string | null {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string') {
    throw new Error('reportingCategory must be a string');
  }
  const code = normalizeReportingCategory(raw);
  if (!code) return null;
  if (code.length > REPORTING_CATEGORY_MAX) {
    throw new Error(
      `reportingCategory is too long (max ${REPORTING_CATEGORY_MAX})`
    );
  }
  if (!/^[A-Z0-9][A-Z0-9 &\-_/]*$/.test(code)) {
    throw new Error(
      'reportingCategory must start with a letter or number and use only A–Z, 0–9, spaces, &, -, _, /'
    );
  }
  return code;
}

export function mergeReportingCategoryOptions(
  extra: string[] | undefined
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...STANDARD_REPORTING_CATEGORIES, ...(extra ?? [])]) {
    const code = normalizeReportingCategory(raw);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out.sort((a, b) => a.localeCompare(b));
}
