'use client';

import {
  Suspense,
  useEffect,
  useState,
  type ComponentType,
} from 'react';
import {
  getAdminInstantMeta,
  type AdminInstantMeta,
} from '@/lib/adminInstantRegistry';

function InstantShell({ meta }: { meta: AdminInstantMeta }) {
  return (
    <div className="space-y-6" aria-busy="true" aria-label={`Loading ${meta.title}`}>
      <div>
        {meta.eyebrow ? (
          <p className="text-xs font-medium uppercase tracking-wide text-[#D4AF37]">
            {meta.eyebrow}
          </p>
        ) : null}
        <h1 className="mt-1 text-2xl font-semibold text-stone-900">{meta.title}</h1>
      </div>
      <div className="flex min-h-[16rem] flex-col items-center justify-center gap-3 rounded-lg border border-stone-200 bg-white py-12">
        <div
          className="h-9 w-9 animate-spin rounded-full border-4 border-stone-200 border-t-[#D4AF37]"
          aria-hidden
        />
        <p className="text-sm text-stone-500">Loading {meta.title.toLowerCase()}…</p>
      </div>
    </div>
  );
}

/**
 * Shared instant entry for sidebar routes: paints chrome immediately, then
 * loads the real page module in the background.
 */
export default function AdminInstantHost({ href }: { href: string }) {
  const meta = getAdminInstantMeta(href);
  const [Page, setPage] = useState<ComponentType | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!meta) return;
    let cancelled = false;
    setFailed(false);
    void meta
      .load()
      .then((mod) => {
        if (!cancelled) setPage(() => mod.default);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [meta, href]);

  if (!meta) {
    return (
      <p className="text-sm text-stone-500">Page unavailable.</p>
    );
  }

  if (failed) {
    return (
      <div className="rounded-lg border border-stone-200 bg-white p-6 text-sm text-stone-600">
        Could not load {meta.title}. Refresh and try again.
      </div>
    );
  }

  if (Page) {
    return (
      <Suspense fallback={<InstantShell meta={meta} />}>
        <Page />
      </Suspense>
    );
  }

  return <InstantShell meta={meta} />;
}

/** Factory used by instant-nav loaders (one bound component per href). */
export function bindAdminInstantHost(href: string): ComponentType {
  return function BoundAdminInstantHost() {
    return <AdminInstantHost href={href} />;
  };
}
