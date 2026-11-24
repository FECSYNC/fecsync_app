"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import MarketingTabBar, {
  type MarketingTabId,
} from "@/components/Protected/admin/pages/marketing/MarketingTabBar";
import {
  exportMarketingSurveyCsv,
  getMarketingSurvey,
  listMarketingSurveyResponses,
  patchMarketingSurvey,
  patchMarketingSettings,
  marketingKeys,
} from "@/services/marketing";
import { ADMIN_MARKETING_LIVE_MS } from "@/utils/adminLiveRefresh";
import { notifyMarketingChange } from "@/lib/marketingSync";
import { useMarketingCrossTabSync } from "@/hooks/useMarketing";

export default function SurveyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params?.id ?? "");
  const qc = useQueryClient();
  useMarketingCrossTabSync();
  const [defaultNote, setDefaultNote] = useState("");

  const survey = useQuery({
    queryKey: marketingKeys.survey(id),
    queryFn: () => getMarketingSurvey(id),
    enabled: Boolean(id),
    staleTime: 8_000,
    refetchInterval: ADMIN_MARKETING_LIVE_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const responses = useQuery({
    queryKey: marketingKeys.surveyResponses(id),
    queryFn: () => listMarketingSurveyResponses(id),
    enabled: Boolean(id),
    staleTime: 8_000,
    refetchInterval: ADMIN_MARKETING_LIVE_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const publish = useMutation({
    mutationFn: () => patchMarketingSurvey(id, { status: "published" }),
    onSuccess: () => {
      notifyMarketingChange(qc);
    },
  });

  const setDefault = useMutation({
    mutationFn: () => patchMarketingSettings({ defaultSurveyId: id }),
    onSuccess: () => {
      setDefaultNote("Set as the post-visit survey automation default.");
      notifyMarketingChange(qc);
    },
  });

  function openTab(tab: MarketingTabId) {
    if (tab === "overview") {
      router.push("/admin/marketing");
      return;
    }
    router.push(`/admin/marketing?tab=${tab}`);
  }

  async function onExport() {
    const csv = await exportMarketingSurveyCsv(id);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `survey-${id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const s = survey.data;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Link
        href="/admin/marketing?tab=surveys"
        className="text-sm text-[#9a7b1a] hover:underline"
      >
        ← Surveys
      </Link>
      <header className="mb-2 mt-2">
        <h1 className="text-2xl font-semibold text-stone-900">
          {s?.name ?? "Survey"}
        </h1>
        <p className="text-sm text-stone-500">Status: {s?.status ?? "…"}</p>
      </header>
      <MarketingTabBar active="surveys" onOpenTab={openTab} />

      <div className="mb-6 flex flex-wrap gap-2">
        {s?.status !== "published" ? (
          <button
            type="button"
            className="rounded-lg bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-stone-900"
            onClick={() => publish.mutate()}
            disabled={publish.isPending}
          >
            Publish
          </button>
        ) : null}
        <button
          type="button"
          className="rounded-lg border border-stone-300 px-4 py-2 text-sm"
          onClick={() => setDefault.mutate()}
          disabled={setDefault.isPending || !s}
        >
          Use for post-visit invites
        </button>
        <button
          type="button"
          className="rounded-lg border border-stone-300 px-4 py-2 text-sm"
          onClick={() => void onExport()}
        >
          Export CSV
        </button>
      </div>
      {defaultNote ? (
        <p className="mb-4 text-sm text-stone-600">{defaultNote}</p>
      ) : null}

      <h2 className="mb-2 font-semibold text-stone-800">Responses</h2>
      <div className="overflow-x-auto rounded-xl border border-stone-200">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-stone-50 text-stone-600">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Rating</th>
              <th className="px-3 py-2">Comment</th>
            </tr>
          </thead>
          <tbody>
            {(responses.data ?? []).map((r) => (
              <tr key={r.id} className="border-t border-stone-100">
                <td className="px-3 py-2">
                  {new Date(r.createdAt).toLocaleString()}
                </td>
                <td className="px-3 py-2">{r.rating ?? "—"}</td>
                <td className="px-3 py-2 max-w-md truncate">
                  {r.comment ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!responses.data?.length && !responses.isLoading ? (
          <p className="p-4 text-stone-500">No responses yet.</p>
        ) : null}
      </div>
    </div>
  );
}
