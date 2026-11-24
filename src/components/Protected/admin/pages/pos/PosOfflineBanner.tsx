"use client";

import { useCallback, useEffect, useState } from "react";
import { syncPosOffline } from "@/services/pos";
import {
  discardOfflineQueueEntry,
  listOfflineQueue,
  pendingOfflineCount,
  updateOfflineQueueEntry,
  type OfflineQueueEntry,
} from "./PosOfflineQueue";

type Props = {
  offlineEnabled: boolean;
  locationId: string;
  deviceId: string;
};

type BannerMode = "online" | "offline" | "syncing" | "conflict";

export default function PosOfflineBanner({ offlineEnabled, locationId, deviceId }: Props) {
  const [online, setOnline] = useState(true);
  const [mode, setMode] = useState<BannerMode>("online");
  const [queue, setQueue] = useState<OfflineQueueEntry[]>([]);

  const refresh = useCallback(() => {
    setQueue(listOfflineQueue());
    const conflicts = listOfflineQueue().some((r) => r.status === "conflict");
    const pending = pendingOfflineCount();
    if (!online) setMode("offline");
    else if (conflicts) setMode("conflict");
    else if (pending > 0) setMode("syncing");
    else setMode("online");
  }, [online]);

  useEffect(() => {
    if (!offlineEnabled) return;
    setOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    const on = () => {
      setOnline(true);
      refresh();
    };
    const off = () => {
      setOnline(false);
      refresh();
    };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    refresh();
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [offlineEnabled, refresh]);

  useEffect(() => {
    if (!offlineEnabled || !online || !locationId || !deviceId) return;
    const pending = listOfflineQueue().filter(
      (r) =>
        (r.status === "queued" || r.status === "failed") &&
        r.locationId === locationId &&
        r.deviceId === deviceId
    );
    if (pending.length === 0) {
      refresh();
      return;
    }
    let cancelled = false;
    (async () => {
      setMode("syncing");
      for (const entry of pending) {
        if (cancelled) break;
        updateOfflineQueueEntry(entry.clientMutationId, { status: "syncing" });
        try {
          const { mutation } = await syncPosOffline({
            locationId: entry.locationId,
            deviceId: entry.deviceId,
            clientMutationId: entry.clientMutationId,
            payload: { lines: entry.lines, total: entry.total, amount: entry.total },
          });
          const status = mutation.status === "applied" ? "applied" : "conflict";
          updateOfflineQueueEntry(entry.clientMutationId, {
            status,
            serverError: mutation.error ?? undefined,
          });
        } catch (err) {
          updateOfflineQueueEntry(entry.clientMutationId, {
            status: "failed",
            serverError: err instanceof Error ? err.message : "Sync failed",
          });
        }
      }
      refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [offlineEnabled, online, locationId, deviceId, refresh]);

  if (!offlineEnabled) return null;

  const styles: Record<BannerMode, string> = {
    online: "bg-emerald-50 text-emerald-900 border-emerald-200",
    offline: "bg-amber-50 text-amber-950 border-amber-200",
    syncing: "bg-sky-50 text-sky-950 border-sky-200",
    conflict: "bg-red-50 text-red-900 border-red-200",
  };

  const labels: Record<BannerMode, string> = {
    online: "Online — live catalog and admissions",
    offline: "Offline — cash merch/food only; admissions need a connection",
    syncing: "Syncing offline sales…",
    conflict: "Sync conflict — review queued sales below",
  };

  const conflicts = queue.filter((r) => r.status === "conflict" || r.status === "failed");

  return (
    <div className="space-y-2">
      <div className={`rounded-lg border px-3 py-2 text-sm font-medium ${styles[mode]}`}>
        {labels[mode]}
      </div>
      {conflicts.length > 0 ? (
        <ul className="space-y-1 rounded-lg border border-red-200 bg-white p-2 text-xs text-stone-700">
          {conflicts.map((row) => (
            <li key={row.clientMutationId} className="flex items-start justify-between gap-2">
              <span>
                {row.clientMutationId.slice(0, 8)}… — {row.serverError ?? "Conflict"}
              </span>
              <span className="flex shrink-0 gap-2">
                {row.status === "failed" ? (
                  <button
                    type="button"
                    className="text-sky-800 underline"
                    onClick={() => {
                      updateOfflineQueueEntry(row.clientMutationId, {
                        status: "queued",
                        serverError: undefined,
                      });
                      refresh();
                    }}
                  >
                    Retry
                  </button>
                ) : null}
                <button
                  type="button"
                  className="text-red-700 underline"
                  onClick={() => {
                    discardOfflineQueueEntry(row.clientMutationId);
                    refresh();
                  }}
                >
                  Discard
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
