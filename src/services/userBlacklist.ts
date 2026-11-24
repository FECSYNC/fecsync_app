import { api, unwrap, type MaybeWrapped } from "@/utils/api";

export type UserBlacklistType = "email" | "phone";
export type UserBlacklistSource = "manual" | "hard_delete";

export type UserBlacklistEntry = {
  _id: string;
  orgId: string;
  type: UserBlacklistType;
  value: string;
  reason: string | null;
  source: UserBlacklistSource;
  createdBy: string | null;
  createdByName?: string | null;
  updatedBy?: string | null;
  updatedByName?: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

const BASE = "/api/admin/user-blacklist";

export async function listUserBlacklist(): Promise<{
  entries: UserBlacklistEntry[];
  orgId: string;
}> {
  const raw = await api<
    MaybeWrapped<{ entries: UserBlacklistEntry[]; orgId: string }>
  >(BASE, { method: "GET", credentials: "include" });
  const data = unwrap(raw);
  return {
    entries: Array.isArray(data?.entries) ? data.entries : [],
    orgId: data?.orgId ? String(data.orgId) : "",
  };
}

export async function addUserBlacklistEntry(payload: {
  type: UserBlacklistType;
  value: string;
  reason?: string;
}): Promise<UserBlacklistEntry> {
  const raw = await api<MaybeWrapped<{ entry: UserBlacklistEntry }>>(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include",
  });
  const data = unwrap(raw);
  if (!data?.entry) throw new Error("Failed to add blacklist entry");
  return data.entry;
}

export async function removeUserBlacklistEntry(id: string): Promise<void> {
  const raw = await api<MaybeWrapped<{ deleted: boolean }>>(`${BASE}/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  const data = unwrap(raw);
  if (!data?.deleted) throw new Error("Failed to remove blacklist entry");
}
