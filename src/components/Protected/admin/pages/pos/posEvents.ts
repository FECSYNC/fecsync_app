/**
 * POS realtime bus — same-tab CustomEvent + cross-tab BroadcastChannel.
 * Keep Terminal, Check-in, Capacity, Tabs, Tills, Sales, Guest, and Setup aligned
 * without a full page reload.
 *
 * Park preference across admin apps still uses hqLocationContextSync / React Query.
 */

export type PosEventType =
  | "pos:checkin"
  | "pos:capacity"
  | "pos:till"
  | "pos:sale"
  | "pos:guest"
  | "pos:tab"
  | "pos:catalog"
  | "pos:station";

export type PosEventDetail = {
  locationId?: string | null;
  deviceId?: string | null;
  at?: number;
};

const EVENT_TYPES: PosEventType[] = [
  "pos:checkin",
  "pos:capacity",
  "pos:till",
  "pos:sale",
  "pos:guest",
  "pos:tab",
  "pos:catalog",
  "pos:station",
];

const CHANNEL_NAME = "harewa.pos.events";
const STORAGE_FALLBACK_KEY = "harewa.pos.event.bus";

type BusPayload = {
  type: PosEventType;
  detail: PosEventDetail;
};

let channel: BroadcastChannel | null = null;
let channelBound = false;

function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return null;
  }
  if (!channel) {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
    } catch {
      channel = null;
    }
  }
  return channel;
}

function ensureChannelRelay(): void {
  if (channelBound || typeof window === "undefined") return;
  const ch = getChannel();
  if (!ch) return;
  channelBound = true;
  ch.onmessage = (event: MessageEvent<BusPayload>) => {
    const payload = event.data;
    if (!payload?.type || !EVENT_TYPES.includes(payload.type)) return;
    window.dispatchEvent(
      new CustomEvent<PosEventDetail>(payload.type, {
        detail: payload.detail ?? {},
      })
    );
  };
}

export function emitPosEvent(type: PosEventType, detail: PosEventDetail = {}): void {
  if (typeof window === "undefined") return;
  ensureChannelRelay();
  const full: PosEventDetail = { ...detail, at: detail.at ?? Date.now() };
  window.dispatchEvent(new CustomEvent<PosEventDetail>(type, { detail: full }));

  const payload: BusPayload = { type, detail: full };
  const ch = getChannel();
  if (ch) {
    try {
      ch.postMessage(payload);
    } catch {
      /* ignore closed channel */
    }
  } else {
    // Safari private / no BroadcastChannel — kick sister tabs via storage.
    try {
      localStorage.setItem(STORAGE_FALLBACK_KEY, JSON.stringify(payload));
      localStorage.removeItem(STORAGE_FALLBACK_KEY);
    } catch {
      /* ignore quota */
    }
  }
}

export function onPosEvent(
  type: PosEventType | PosEventType[],
  handler: (detail: PosEventDetail) => void
): () => void {
  if (typeof window === "undefined") return () => undefined;
  ensureChannelRelay();
  const types = Array.isArray(type) ? type : [type];
  const listener = (event: Event) => {
    const custom = event as CustomEvent<PosEventDetail>;
    handler(custom.detail ?? {});
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_FALLBACK_KEY || !event.newValue) return;
    try {
      const payload = JSON.parse(event.newValue) as BusPayload;
      if (!payload?.type || !types.includes(payload.type)) return;
      handler(payload.detail ?? {});
    } catch {
      /* ignore */
    }
  };
  for (const t of types) window.addEventListener(t, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    for (const t of types) window.removeEventListener(t, listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Subscribe to every POS sync channel (sell-pad catch-all). */
export function onAnyPosEvent(
  handler: (type: PosEventType, detail: PosEventDetail) => void
): () => void {
  const unsubs = EVENT_TYPES.map((type) =>
    onPosEvent(type, (detail) => handler(type, detail))
  );
  return () => {
    for (const u of unsubs) u();
  };
}
