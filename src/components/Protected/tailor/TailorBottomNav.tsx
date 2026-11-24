'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  Megaphone,
  Bell,
  Briefcase,
  User,
} from 'lucide-react';
import { useNotificationsQuery } from '@/hooks/useNotifications';

const NAV: {
  href: string;
  label: string;
  icon: typeof Home;
  showBadge?: boolean;
}[] = [
  { href: '/tailor/home', label: 'Home', icon: Home },
  { href: '/tailor/jobs', label: 'Jobs', icon: Briefcase },
  { href: '/tailor/campaigns', label: 'Campaigns', icon: Megaphone },
  { href: '/tailor/notifications', label: 'Alerts', icon: Bell, showBadge: true },
  { href: '/tailor/dashboard', label: 'Profile', icon: User },
];

export default function TailorBottomNav() {
  const pathname = usePathname();
  const { data: notifications = [] } = useNotificationsQuery();
  const unread = notifications.filter((n) => !n.read).length;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 backdrop-blur md:hidden"
      aria-label="Tailor workspace"
    >
      <ul className="mx-auto flex max-w-lg items-stretch justify-between px-1 py-1">
        {NAV.map(({ href, label, icon: Icon, showBadge }) => {
          const active =
            pathname === href ||
            (href === '/tailor/home'
              ? pathname === '/tailor'
              : pathname.startsWith(href));
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                className={`relative flex flex-col items-center gap-0.5 rounded-lg px-0.5 py-2 text-[9px] min-[360px]:text-[10px] font-semibold uppercase tracking-wide transition ${
                  active
                    ? 'text-[#D4AF37]'
                    : 'text-stone-500 hover:text-stone-800'
                }`}
              >
                <Icon size={18} strokeWidth={active ? 2.25 : 1.75} />
                {showBadge && unread > 0 ? (
                  <span className="absolute right-2 top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-0.5 text-[8px] font-bold text-white">
                    {unread > 9 ? '9+' : unread}
                  </span>
                ) : null}
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
