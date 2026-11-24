"use client";

import AdminPendingLink from "@/components/Protected/admin/components/AdminPendingLink";
import { ACTIVITY_ENTITY_TYPE_LABELS } from "@/lib/models/ActivityLog";

export type ActivityLogRow = {
  _id?: string;
  action?: string;
  description?: string;
  entityType?: string;
  createdAt?: string;
  user?: { email?: string; username?: string } | string | null;
};

interface RecentActivityPanelProps {
  entries: ActivityLogRow[];
}

function actorLabel(user: ActivityLogRow["user"]): string {
  if (!user) return "System";
  if (typeof user === "string") {
    return user.trim() === "---" ? "---" : user;
  }
  return user.email || user.username || "User";
}

function entityLabel(entityType?: string, action?: string): string {
  if (action && /venue location/i.test(action)) return "Venue";
  if (!entityType) return "";
  if (entityType === "Session") return "Sign-in";
  if (entityType === "Membership") return "Team";
  if (entityType === "FashionChat") return "AI chat";
  if (entityType === "PartyBooking") return "Party";
  const mapped =
    ACTIVITY_ENTITY_TYPE_LABELS[entityType as keyof typeof ACTIVITY_ENTITY_TYPE_LABELS];
  return mapped ?? entityType;
}

export default function RecentActivityPanel({ entries }: RecentActivityPanelProps) {
  if (!entries.length) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900">Recent activity</h2>
        <p className="text-sm text-gray-500 mt-2">
          Order updates, catalog edits, venue creates, team changes, and sign-in
          events appear here as they are recorded.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex items-center justify-between gap-4 mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Recent activity</h2>
        <AdminPendingLink
          href="/admin/orders"
          className="text-sm text-[#B8860B] hover:text-[#8B6914] font-medium"
        >
          View orders
        </AdminPendingLink>
      </div>
      <ul className="divide-y divide-gray-100">
        {entries.slice(0, 8).map((row) => {
          const kind = entityLabel(row.entityType, row.action);
          return (
            <li key={String(row._id)} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {row.action || 'Event'}
                  </p>
                  {row.description && (
                    <p className="text-sm text-gray-600 mt-0.5">{row.description}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">
                    {actorLabel(row.user)}
                    {kind ? ` · ${kind}` : ''}
                  </p>
                </div>
                {row.createdAt && (
                  <time className="text-xs text-gray-400 shrink-0">
                    {new Date(row.createdAt).toLocaleString()}
                  </time>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
