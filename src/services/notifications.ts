import { api, unwrap, type MaybeWrapped } from "@/utils/api";

export type AppNotification = {
  _id: string;
  user?: string;
  title: string;
  message: string;
  type?:
    | "order"
    | "system"
    | "promo"
    | "alert"
    | "tailoring"
    | "campaign"
    | "booking"
    | "membership"
    | "waiver"
    | "pos"
    | "marketing_send"
    | "marketing_lead"
    | "survey_response"
    | "automation_run"
    | "party"
    | "accounting";
  read?: boolean;
  metadata?: {
    orderId?: string;
    jobId?: string;
    amount?: number;
    [key: string]: unknown;
  };
  createdAt?: string;
  updatedAt?: string;
};

const BASE = "/api/notification";

export async function getMyNotifications(): Promise<AppNotification[]> {
  // Align with refresh timeout — under Turbopack cold-compile, 20s+ is common;
  // aborting at 25s then retrying doubles load on an already-saturated server.
  const raw = await api<MaybeWrapped<{ notifications?: AppNotification[] } | AppNotification[]>>(
    BASE,
    { method: "GET", cache: "no-store" },
    { timeout: 45_000 }
  );
  const data = unwrap(raw);
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object" && Array.isArray(data.notifications)) {
    return data.notifications;
  }
  return [];
}

export async function markNotificationRead(id: string): Promise<void> {
  await api(BASE, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
}

export async function markAllNotificationsRead(): Promise<void> {
  await api(BASE, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ markAll: true }),
  });
}

export async function deleteNotification(id: string): Promise<void> {
  await api(BASE, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
}
