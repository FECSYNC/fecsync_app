/**
 * Cross-tab + same-session sync for guest Memberships (Feature 08).
 * Mirrors catalogSync: BroadcastChannel + localStorage fallback; React Query
 * invalidation prefers active queries to avoid pooler stampedes.
 */

import type { QueryClient } from "@tanstack/react-query";
import { membershipKeys } from "@/services/memberships";

export type MembershipSyncKind =
  | "plan"
  | "category"
  | "settings"
  | "eligibility"
  | "member"
  | "guest"
  | "all";

export type MembershipChangeMessage = {
  type: "memberships-changed";
  kind: MembershipSyncKind;
  action: "create" | "update" | "delete" | "refresh";
  id?: string;
  tabId?: string;
};

const CHANNEL = "harewa-memberships";
const STORAGE_KEY = "harewa-memberships-tick";
const refetchActive = { refetchType: "active" as const };

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

export function broadcastMembershipChange(
  msg: Omit<MembershipChangeMessage, "type" | "tabId">
) {
  if (typeof window === "undefined") return;
  const payload: MembershipChangeMessage = {
    type: "memberships-changed",
    tabId: getTabId(),
    ...msg,
  };
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
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...payload, at: Date.now() })
    );
  } catch {
    /* ignore */
  }
}

export function subscribeMembershipChange(
  handler: (msg: MembershipChangeMessage) => void
): () => void {
  if (typeof window === "undefined") return () => {};

  let lastSig = "";
  let lastAt = 0;
  const deliver = (msg: MembershipChangeMessage) => {
    if (msg.tabId && msg.tabId === getTabId()) return;
    const sig = `${msg.kind}:${msg.action}:${msg.id ?? ""}`;
    const now = Date.now();
    if (sig === lastSig && now - lastAt < 400) return;
    lastSig = sig;
    lastAt = now;
    handler(msg);
  };

  let channel: BroadcastChannel | null = null;
  const onMessage = (event: MessageEvent<MembershipChangeMessage>) => {
    if (event.data?.type === "memberships-changed") deliver(event.data);
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
      const parsed = JSON.parse(event.newValue) as MembershipChangeMessage;
      if (parsed?.type === "memberships-changed") deliver(parsed);
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

function invalidatePrefix(
  queryClient: QueryClient,
  queryKey: readonly unknown[]
) {
  void queryClient.invalidateQueries({
    queryKey: [...queryKey],
    ...refetchActive,
  });
}

/**
 * SSOT for membership cache refresh across admin + guest surfaces that share
 * the `membershipKeys` / me-memberships prefixes.
 */
export function invalidateMembershipQueries(
  queryClient: QueryClient,
  kind: MembershipSyncKind = "all"
) {
  // Broad admin memberships tree — plans, categories, settings, eligibility,
  // members, guests all live under membershipKeys.all.
  invalidatePrefix(queryClient, membershipKeys.all);

  // Guest self-serve + profile memberships
  invalidatePrefix(queryClient, ["me", "memberships"]);
  invalidatePrefix(queryClient, ["profile", "memberships"]);

  // POS / redeem desks that may cache plan-backed lookups
  if (kind === "plan" || kind === "all" || kind === "eligibility") {
    invalidatePrefix(queryClient, ["pos", "memberships"]);
  }

  // Reports roll up by category / reportingCategory
  if (
    kind === "plan" ||
    kind === "category" ||
    kind === "member" ||
    kind === "all"
  ) {
    invalidatePrefix(queryClient, [...membershipKeys.all, "reports"]);
  }
}

/** Same-tab invalidate + cross-tab broadcast. */
export function notifyMembershipChange(
  queryClient: QueryClient,
  msg: Omit<MembershipChangeMessage, "type" | "tabId">
) {
  invalidateMembershipQueries(queryClient, msg.kind);
  broadcastMembershipChange(msg);
}
