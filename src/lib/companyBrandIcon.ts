/** Letter tile used as a company's tab icon until it uploads a logo. Client-safe. */
export function companyInitialIconDataUrl(name: string): string {
  const letter = (name.match(/[A-Za-z0-9]/)?.[0] ?? '?').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0B1F2A"/><text x="16" y="22" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="#fff" text-anchor="middle">${letter}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Tab icon for a company: its logo, else the letter tile. */
export function companyTabIconUrl(brand: { name: string; logoUrl: string | null }): string {
  return brand.logoUrl ?? companyInitialIconDataUrl(brand.name);
}
