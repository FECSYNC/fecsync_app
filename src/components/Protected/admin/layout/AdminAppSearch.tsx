'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useToast } from '@/contexts/toast-context';
import { useAuthStore } from '@/store/authStore';
import { isStorefrontOrgSession } from '@/hooks/useAdminPermission';
import {
  isVisibleNavGroup,
  planLockedNavMessage,
  useAccountingSearchApps,
  useVisibleAdminNav,
} from '@/hooks/useVisibleAdminNav';
import AdminPendingLink from '@/components/Protected/admin/components/AdminPendingLink';
import { navigateAdminRoute } from '@/lib/adminInstantNav';

type SearchableApp = {
  key: string;
  name: string;
  href: string;
  /** Group / section breadcrumb, e.g. "Online Booking · Ticketing". */
  context: string;
  demoLocked: boolean;
  upgrade: boolean;
};

const WORD_SPLIT = /[\s\-/&·,()]+/;

function words(value: string): string[] {
  return value.toLowerCase().split(WORD_SPLIT).filter(Boolean);
}

/**
 * Prefix-only ranking (no mid-word substring hits):
 * 0 = app name starts with the query, 1 = every typed word starts a word in
 * the name, 2 = same but also counting group/section words (3+ chars only so
 * a single letter doesn't dump a whole group).
 */
function matchRank(app: SearchableApp, query: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  if (app.name.toLowerCase().startsWith(q)) return 0;
  const tokens = q.split(/\s+/).filter(Boolean);
  const nameWords = words(app.name);
  const everyToken = (pool: string[]) =>
    tokens.every((t) => pool.some((w) => w.startsWith(t)));
  if (everyToken(nameWords)) return 1;
  if (q.replace(/\s+/g, '').length >= 3 && everyToken([...nameWords, ...words(app.context)])) {
    return 2;
  }
  return null;
}

function highlight(name: string, query: string): ReactNode {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return name;
  const whole = query.trim().toLowerCase();
  if (name.toLowerCase().startsWith(whole)) {
    return (
      <>
        <span className="font-semibold text-gray-900">{name.slice(0, whole.length)}</span>
        {name.slice(whole.length)}
      </>
    );
  }
  return name.split(/(\s+)/).map((part, i) => {
    const lower = part.toLowerCase();
    const hit = tokens
      .filter((t) => lower.startsWith(t))
      .sort((a, b) => b.length - a.length)[0];
    if (!hit) return <span key={i}>{part}</span>;
    return (
      <span key={i}>
        <span className="font-semibold text-gray-900">{part.slice(0, hit.length)}</span>
        {part.slice(hit.length)}
      </span>
    );
  });
}

export default function AdminAppSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const { addToast } = useToast();
  const user = useAuthStore((s) => s.user);
  const navigation = useVisibleAdminNav();
  const accountingApps = useAccountingSearchApps();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const apps = useMemo<SearchableApp[]>(() => {
    const hqLocked =
      user?.enterpriseHqEnabled !== true && !isStorefrontOrgSession(user);
    const list: SearchableApp[] = [];
    for (const item of navigation) {
      if (!isVisibleNavGroup(item)) {
        const demoLocked = Boolean(item.demoLocked);
        list.push({
          key: item.href,
          name: item.name,
          href: item.href,
          context: '',
          demoLocked,
          upgrade: demoLocked,
        });
        continue;
      }
      let section: string | null = null;
      for (const child of item.children) {
        if (child.section) section = child.section;
        const demoLocked = Boolean(child.demoLocked);
        list.push({
          key: `${item.name}:${child.href}`,
          name: child.name,
          href: child.href,
          context: section ? `${item.name} · ${section}` : item.name,
          demoLocked,
          upgrade: demoLocked || (child.href === '/admin/hq' && hqLocked),
        });
      }
    }
    // Accounting features live as in-app tabs (not sidebar children).
    for (const app of accountingApps) {
      if (list.some((x) => x.href === app.href)) continue;
      list.push(app);
    }
    return list;
  }, [navigation, user, accountingApps]);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    return apps
      .map((app, order) => ({ app, order, rank: matchRank(app, query) }))
      .filter((r): r is { app: SearchableApp; order: number; rank: number } => r.rank != null)
      .sort((a, b) => a.rank - b.rank || a.order - b.order)
      .map((r) => r.app);
  }, [apps, query]);

  const showPanel = open && query.trim().length > 0;

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  useEffect(() => {
    setOpen(false);
    setQuery('');
  }, [pathname]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '');
      const shortcut =
        (event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey)) ||
        (event.key === '/' && !typing);
      if (!shortcut) return;
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
      setOpen(true);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const afterSelect = (app: SearchableApp) => {
    if (app.demoLocked) addToast(planLockedNavMessage(app.href), 'info');
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  };

  const selectWithKeyboard = (app: SearchableApp) => {
    navigateAdminRoute(router, app.href);
    afterSelect(app);
  };

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1 sm:max-w-sm">
      <div className="relative">
        <svg
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              if (query) setQuery('');
              else inputRef.current?.blur();
              setOpen(false);
              return;
            }
            if (!showPanel || results.length === 0) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActiveIndex((i) => (i + 1) % results.length);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActiveIndex((i) => (i - 1 + results.length) % results.length);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const app = results[activeIndex] ?? results[0];
              if (app) selectWithKeyboard(app);
            }
          }}
          placeholder="Search apps…"
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="admin-app-search-results"
          aria-activedescendant={
            showPanel && results[activeIndex]
              ? `admin-app-search-${activeIndex}`
              : undefined
          }
          aria-label="Search dashboard apps and features"
          className="w-full rounded-md border border-stone-300 bg-stone-50 py-1.5 pl-8 pr-12 text-xs font-medium text-stone-800 placeholder:text-stone-400 focus:border-[#D4AF37] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#D4AF37] [&::-webkit-search-cancel-button]:hidden"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-stone-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-stone-400 sm:inline">
          Ctrl K
        </kbd>
      </div>

      {showPanel ? (
        <div className="absolute left-0 z-50 mt-1.5 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg sm:w-full sm:min-w-[20rem]">
          {results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-500">
              No apps start with &ldquo;{query.trim()}&rdquo;
            </p>
          ) : (
            <ul
              id="admin-app-search-results"
              role="listbox"
              className="max-h-80 overflow-y-auto py-1"
            >
              {results.map((app, index) => {
                const active = index === activeIndex;
                return (
                  <li
                    key={app.key}
                    id={`admin-app-search-${index}`}
                    role="option"
                    aria-selected={active}
                    ref={(el) => {
                      itemRefs.current[index] = el;
                    }}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    <AdminPendingLink
                      href={app.href}
                      onNavigate={() => afterSelect(app)}
                      title={app.demoLocked ? planLockedNavMessage(app.href) : undefined}
                      className={`flex w-full min-w-0 items-center justify-between gap-2 px-4 py-2 text-sm ${
                        active ? 'bg-[#D4AF37]/15' : 'hover:bg-gray-50'
                      }`}
                      trailing={
                        app.upgrade ? (
                          <span className="shrink-0 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-900">
                            Upgrade
                          </span>
                        ) : null
                      }
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-gray-700">
                          {highlight(app.name, query)}
                        </span>
                        {app.context ? (
                          <span className="block truncate text-[11px] text-gray-400">
                            {app.context}
                          </span>
                        ) : null}
                      </span>
                    </AdminPendingLink>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
