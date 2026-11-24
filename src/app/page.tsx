/**
 * `/` is handled by `src/proxy.ts` (rewrite to `/home` for guests/clients,
 * redirect staff → `/admin`, tailor → `/tailor/home`).
 * This fallback only renders if the proxy matcher is bypassed.
 */
export default function RootPage() {
  return null;
}
