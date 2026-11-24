"use client";

import { useCallback, useState } from "react";
import { api, unwrap, type MaybeWrapped } from "@/utils/api";
import { useToast } from "@/contexts/toast-context";

type PlatformUserRow = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  accountSuspended: boolean;
  memberships: Array<{
    orgId: string;
    orgName: string;
    rolePreset: string;
    status: string;
  }>;
};

/**
 * FECSYNC storefront: soft-suspend any user account.
 * Never deletes users, memberships, orders, or company data.
 */
export default function PlatformAccountSuspendPanel() {
  const { addToast } = useToast();
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<PlatformUserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async () => {
    const query = q.trim();
    if (query.length < 2) {
      setError("Enter at least 2 characters (email or name).");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const raw = await api<MaybeWrapped<{ users: PlatformUserRow[] }>>(
        `/api/admin/platform-accounts?q=${encodeURIComponent(query)}`
      );
      const data = unwrap(raw);
      setUsers(Array.isArray(data?.users) ? data.users : []);
    } catch (err) {
      setUsers([]);
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }, [q]);

  const patch = useCallback(
    async (userId: string, action: "suspend" | "unsuspend") => {
      setBusyId(userId);
      setError(null);
      try {
        await api("/api/admin/platform-accounts", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, action }),
        });
        setUsers((prev) =>
          prev.map((u) =>
            u.id === userId
              ? { ...u, accountSuspended: action === "suspend" }
              : u
          )
        );
        addToast(
          action === "suspend"
            ? "Account suspended (records kept)."
            : "Suspension removed — account can sign in again.",
          "success"
        );
      } catch (err) {
        addToast(
          err instanceof Error ? err.message : "Could not update account",
          "error"
        );
      } finally {
        setBusyId(null);
      }
    },
    [addToast]
  );

  return (
    <section className="rounded-xl border border-stone-200 bg-white px-5 py-5 space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-stone-900">
          Suspend a user account
        </h2>
        <p className="text-sm text-stone-600 leading-relaxed">
          Soft-lock any user across the platform. They cannot use app features
          until you unsuspend. Orders, memberships, and company data are never
          deleted.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void search();
          }}
          placeholder="Search email or name"
          className="min-w-[16rem] flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900"
        />
        <button
          type="button"
          disabled={loading}
          onClick={() => void search()}
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-800 disabled:opacity-50"
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </div>
      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {users.length > 0 ? (
        <ul className="divide-y divide-stone-100 border border-stone-200 rounded-lg">
          {users.map((u) => {
            const name = [u.firstName, u.lastName].filter(Boolean).join(" ");
            const orgs = u.memberships
              .map((m) => `${m.orgName} (${m.rolePreset})`)
              .join(", ");
            return (
              <li
                key={u.id}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-stone-900 truncate">
                    {name || u.email}
                    {u.accountSuspended ? (
                      <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-800">
                        Suspended
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-stone-500 truncate">{u.email}</p>
                  {orgs ? (
                    <p className="text-xs text-stone-500 mt-0.5 truncate">
                      {orgs}
                    </p>
                  ) : null}
                </div>
                <div className="shrink-0">
                  {u.accountSuspended ? (
                    <button
                      type="button"
                      disabled={busyId === u.id}
                      onClick={() => void patch(u.id, "unsuspend")}
                      className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-900 disabled:opacity-50"
                    >
                      {busyId === u.id ? "Working…" : "Unsuspend"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busyId === u.id}
                      onClick={() => void patch(u.id, "suspend")}
                      className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-900 disabled:opacity-50"
                    >
                      {busyId === u.id ? "Working…" : "Suspend"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
