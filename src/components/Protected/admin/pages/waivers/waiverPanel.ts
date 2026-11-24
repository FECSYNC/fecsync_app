"use client";

import { useSyncExternalStore } from "react";

/** In-page waiver sections. Opening one does not change the route. */
export type WaiverPanelId = "template" | "forms" | "signage" | "kiosk" | "settings";

let current: WaiverPanelId | null = null;
const listeners = new Set<() => void>();

export function getWaiverPanel(): WaiverPanelId | null {
  return current;
}

export function openWaiverPanel(next: WaiverPanelId | null) {
  if (current === next) return;
  current = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWaiverPanel(): WaiverPanelId | null {
  return useSyncExternalStore(subscribe, getWaiverPanel, () => null);
}
