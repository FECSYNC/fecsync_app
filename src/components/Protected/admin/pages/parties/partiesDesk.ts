'use client';

import { createContext, useContext } from 'react';

/** Parties sub-pages that open as an in-place desk modal (no route change). */
export type PartiesDeskPanel = 'packages' | 'rooms' | 'menu' | 'balances' | 'run-sheets' | 'settings';

export const PARTIES_DESK_TABS: Array<{ href: string; label: string; panel: PartiesDeskPanel | null }> = [
  { href: '/admin/parties', label: 'Parties', panel: null },
  { href: '/admin/parties/packages', label: 'Packages', panel: 'packages' },
  { href: '/admin/parties/rooms', label: 'Rooms', panel: 'rooms' },
  { href: '/admin/parties/menu', label: 'Menu', panel: 'menu' },
  { href: '/admin/parties/balances', label: 'Balances', panel: 'balances' },
  { href: '/admin/parties/run-sheets', label: 'Run sheets', panel: 'run-sheets' },
  { href: '/admin/parties/settings', label: 'Party settings', panel: 'settings' },
];

export type PartiesDeskApi = {
  panel: PartiesDeskPanel | null;
  openPanel: (panel: PartiesDeskPanel) => void;
  closePanel: () => void;
  warmPanel: (panel: PartiesDeskPanel) => void;
};

/** Provided by the /admin/parties layout. Null outside it (tabs fall back to plain links). */
export const PartiesDeskContext = createContext<PartiesDeskApi | null>(null);

/** True for content rendered inside the desk modal (hides the duplicate page sub-nav). */
export const PartiesInDeskContext = createContext(false);

export function usePartiesDesk(): PartiesDeskApi | null {
  return useContext(PartiesDeskContext);
}

export function useInPartiesDesk(): boolean {
  return useContext(PartiesInDeskContext);
}
