"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import WaiverSubnav from "@/components/Protected/admin/pages/waivers/WaiverSubnav";
import { api, unwrap, type MaybeWrapped } from "@/utils/api";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { waiverDeskQueryOptions } from "@/services/waivers";

export default function WaiverResponsesPage() {
  const canExport = useAuthStore((s) => s.can)(P.WaiversExport);
  const templateId = useSearchParams().get("templateId")?.trim() || "";
  const query = useQuery({
    queryKey: ["waiver-responses", templateId],
    queryFn: async () => {
      const qs = templateId ? `?templateId=${encodeURIComponent(templateId)}` : "";
      const raw = await api<
        MaybeWrapped<{
          responses: {
            id: string;
            submittedAt: string;
            templateName: string;
            guestName: string;
            status: string;
            answers?: Record<string, string>;
          }[];
        }>
      >(`/api/admin/waivers/responses${qs}`, { method: "GET", credentials: "include" });
      return unwrap(raw)?.responses ?? [];
    },
    ...waiverDeskQueryOptions,
  });
  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="text-2xl font-semibold text-stone-900">Form responses</h1>
      <WaiverSubnav />
      {canExport ? (
        <p className="mb-3 text-sm">
          <a
            className="font-medium text-stone-800 underline"
            href={
              templateId
                ? `/api/admin/waivers/export?type=responses&templateId=${encodeURIComponent(templateId)}`
                : "/api/admin/waivers/export?type=responses"
            }
          >
            Export CSV
          </a>
        </p>
      ) : null}
      <ul className="text-sm">
        {(query.data ?? []).map((row) => (
          <li key={row.id} className="border-b border-stone-100 py-2">
            {row.templateName} · {row.guestName || "Guest"} · {row.status} ·{" "}
            {new Date(row.submittedAt).toLocaleString()}
            {row.answers && Object.keys(row.answers).length ? (
              <span className="mt-1 block text-stone-600">
                {Object.entries(row.answers)
                  .map(([key, value]) => `${key}: ${value}`)
                  .join(" · ")}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {!query.isLoading && (query.data ?? []).length === 0 ? (
        <p className="text-sm text-stone-600">No form responses yet.</p>
      ) : null}
    </div>
  );
}
