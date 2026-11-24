"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  marketingKeys,
  getMarketingOverview,
  getMarketingSettings,
  patchMarketingSettings,
  getMarketingAutomations,
  patchMarketingAutomations,
  listMarketingLeads,
  listMarketingSends,
  listMarketingSurveys,
  listMarketingCampaigns,
} from "@/services/marketing";
import { ADMIN_MARKETING_LIVE_MS } from "@/utils/adminLiveRefresh";
import { useEffect } from "react";
import { notifyMarketingChange, subscribeMarketingChange } from "@/lib/marketingSync";
import { invalidateMarketingQueries } from "@/utils/invalidateMarketingQueries";

const liveOpts = {
  staleTime: 8_000,
  refetchInterval: ADMIN_MARKETING_LIVE_MS,
  refetchIntervalInBackground: false as const,
  refetchOnWindowFocus: true,
  retry: 1,
};

/** Refresh marketing data when another tab changes it (campaigns, leads, settings…). */
export function useMarketingCrossTabSync() {
  const qc = useQueryClient();
  useEffect(
    () => subscribeMarketingChange(() => invalidateMarketingQueries(qc)),
    [qc]
  );
}

export function useMarketingOverview(
  locationId?: string | null,
  opts?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: marketingKeys.overview(locationId || "org"),
    queryFn: () => getMarketingOverview(locationId || null),
    enabled: opts?.enabled !== false,
    ...liveOpts,
  });
}

export function useMarketingSettings(locationId?: string | null) {
  return useQuery({
    queryKey: marketingKeys.settings(locationId || "org"),
    queryFn: () => getMarketingSettings(locationId || null),
    ...liveOpts,
    placeholderData: (previous) => previous,
  });
}

export function usePatchMarketingSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: patchMarketingSettings,
    onSuccess: () => {
      notifyMarketingChange(qc);
    },
  });
}

export function useMarketingAutomations(locationId?: string | null) {
  return useQuery({
    queryKey: marketingKeys.automations(locationId || "org"),
    queryFn: () => getMarketingAutomations(locationId || null),
    ...liveOpts,
    placeholderData: (previous) => previous,
  });
}

export function usePatchMarketingAutomations() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: patchMarketingAutomations,
    onSuccess: () => {
      notifyMarketingChange(qc);
    },
  });
}

export function useMarketingLeads(q?: string) {
  return useQuery({
    queryKey: marketingKeys.leads(q ?? ""),
    queryFn: () => listMarketingLeads(q),
    ...liveOpts,
    placeholderData: (previous) => previous,
  });
}

export function useMarketingSends(kind?: string) {
  return useQuery({
    queryKey: marketingKeys.sends(kind ?? ""),
    queryFn: () => listMarketingSends(kind),
    ...liveOpts,
  });
}

export function useMarketingCampaigns(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: marketingKeys.campaigns(),
    queryFn: () => listMarketingCampaigns(),
    enabled: opts?.enabled !== false,
    ...liveOpts,
    placeholderData: (previous) => previous,
  });
}

export function useMarketingSurveys() {
  return useQuery({
    queryKey: marketingKeys.surveys(),
    queryFn: () => listMarketingSurveys(),
    ...liveOpts,
    placeholderData: (previous) => previous,
  });
}
