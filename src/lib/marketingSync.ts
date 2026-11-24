/**
 * Cross-tab sync for Guest Marketing (campaigns, leads, automations, surveys, settings).
 * Mirrors membershipsSync: BroadcastChannel + localStorage fallback. Polling still
 * covers changes made by other staff members or the delivery cron.
 */

import type { QueryClient } from "@tanstack/react-query";
import { invalidateMarketingQueries } from "@/utils/invalidateMarketingQueries";

export type MarketingSyncKind =
  | "campaign"
  | "lead"
  | "automation"
  | "survey"
  | "settings"
  | "all";

export type MarketingChangeMessage = {
  type: "marketing-changed";
  kind: MarketingSyncKind;
  id?: string;
  tabId?: string;
};

const CHANNEL = "harewa-marketing";
const STORAGE_KEY = "harewa-marketing-tick";

let tabId = "";
function getTabId() {
  if (tabId) return tabId;
  if (typeof window === "undefined") return "";
  tabId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `tab_${Math.random().toString(36).slice(2)}`;
  return tabId;
}

export function broadcastMarketingChange(msg: Omit<MarketingChangeMessage, "type" | "tabId">) {
  if (typeof window === "undefined") return;
  const payload: MarketingChangeMessage = { type: "marketing-changed", tabId: getTabId(), ...msg };
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(CHANNEL);
      channel.postMessage(payload);
      channel.close();
    }
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...payload, at: Date.now() }));
  } catch {
    /* ignore */
  }
}

export function subscribeMarketingChange(
  handler: (msg: MarketingChangeMessage) => void
): () => void {
  if (typeof window === "undefined") return () => {};
  let lastSig = "";
  let lastAt = 0;
  const deliver = (msg: MarketingChangeMessage) => {
    if (msg.tabId && msg.tabId === getTabId()) return;
    const sig = `${msg.kind}:${msg.id ?? ""}`;
    const now = Date.now();
    if (sig === lastSig && now - lastAt < 300) return;
    lastSig = sig;
    lastAt = now;
    handler(msg);
  };

  let channel: BroadcastChannel | null = null;
  const onMessage = (event: MessageEvent<MarketingChangeMessage>) => {
    if (event.data?.type === "marketing-changed") deliver(event.data);
  };
  try {
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(CHANNEL);
      channel.addEventListener("message", onMessage);
    }
  } catch {
    channel = null;
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      const parsed = JSON.parse(event.newValue) as MarketingChangeMessage;
      if (parsed?.type === "marketing-changed") deliver(parsed);
    } catch {
      /* ignore */
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    channel?.removeEventListener("message", onMessage);
    channel?.close();
    window.removeEventListener("storage", onStorage);
  };
}

/** Same-tab invalidate + cross-tab broadcast — use after every marketing mutation. */
export function notifyMarketingChange(
  queryClient: QueryClient,
  msg: Omit<MarketingChangeMessage, "type" | "tabId"> = { kind: "all" }
) {
  invalidateMarketingQueries(queryClient);
  broadcastMarketingChange(msg);
}
