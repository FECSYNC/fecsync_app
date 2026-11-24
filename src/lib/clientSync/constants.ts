/** Bump when auth/storage/API contracts change (e.g. Mongo → Postgres). */
export const CLIENT_SYNC_VERSION =
  process.env.NEXT_PUBLIC_CLIENT_SYNC_VERSION ?? "1";

export const CLIENT_SYNC_STORAGE_KEY = "harewa-client-sync-state";

/** Keys cleared only on a major sync-version bump (migration / breaking change). */
export const LEGACY_SESSION_STORAGE_KEYS = [
  "auth-store",
  "auth-snapshot",
  "user",
  "harewa_fashion_chat_session",
  "harewa_fashion_chat_contact",
  "harewa_fashion_chat_messages",
] as const;

export const CLIENT_SYNC_EVENT = "harewa:client-sync";

export type ClientSyncMode = "soft" | "hard";

export type ClientSyncState = {
  syncVersion: string;
  devEpoch: string | null;
};

export type ClientSyncPayload = {
  syncVersion: string;
  devEpoch: string | null;
  isDev: boolean;
};
