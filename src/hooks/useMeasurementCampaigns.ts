import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  allocateCampaignScans,
  archiveCampaign,
  createCampaign,
  createTailorClient,
  deleteCampaign,
  deleteTailorClient,
  getCampaign,
  inviteCampaignParticipants,
  joinCampaign,
  listCampaignParticipants,
  listCampaignParticipantsTree,
  listCampaigns,
  listTailorClients,
  sendCampaignReminders,
  updateCampaign,
  getPublicCampaign,
  getTailorCreditsSummary,
  listMyCampaignParticipations,
  getCoordinatorInvitees,
  inviteCoordinatorMembers,
  downloadCampaignParticipantsExport,
  downloadAllCampaignParticipantsExport,
  type CampaignListResult,
  type TailorClientListResult,
  type CoordinatorInviteMembersPayload,
} from "@/services/measurementCampaigns";
import { invalidateBillingUsageQueries } from "@/hooks/useBilling";
import type {
  CampaignInput,
  InviteParticipantsInput,
  TailorClientInput,
  TailorCreditsSummaryDto,
  CustomerCampaignParticipationDto,
} from "@/lib/measurementCampaigns.shared";
import { measurementKeys } from "@/hooks/useMeasurements";
import { notificationKeys } from "@/hooks/useNotifications";

export const campaignKeys = {
  all: ["measurement-campaigns"] as const,
  list: (filters: Record<string, unknown>) =>
    [...campaignKeys.all, "list", filters] as const,
  detail: (id: string) => [...campaignKeys.all, "detail", id] as const,
  participants: (id: string) =>
    [...campaignKeys.all, "participants", id] as const,
  participantsTree: (id: string) =>
    [...campaignKeys.all, "participants", id, "tree"] as const,
  credits: () => [...campaignKeys.all, "credits"] as const,
  public: (slug: string, authed: boolean, inviteToken?: string, groupToken?: string) =>
    [
      ...campaignKeys.all,
      "public",
      slug,
      authed ? "authed" : "anon",
      inviteToken ?? "",
      groupToken ?? "",
    ] as const,
  mine: () => [...campaignKeys.all, "mine"] as const,
  coordinatorInvitees: (participantId: string) =>
    [...campaignKeys.all, "coordinator-invitees", participantId] as const,
};

export const tailorClientKeys = {
  all: ["tailor-clients"] as const,
  list: (page: number) => [...tailorClientKeys.all, "list", page] as const,
};

export function useCampaignsQuery(
  filters: {
    page?: number;
    q?: string;
    status?: string;
    category?: string;
    sort?: string;
  },
  options?: { enabled?: boolean }
) {
  return useQuery<CampaignListResult>({
    queryKey: campaignKeys.list(filters),
    queryFn: () => listCampaigns(filters),
    staleTime: 30_000,
    enabled: options?.enabled !== false,
    retry: false,
  });
}

export function useCampaignQuery(id: string, enabled = true) {
  return useQuery({
    queryKey: campaignKeys.detail(id),
    queryFn: () => getCampaign(id),
    enabled: Boolean(id) && enabled,
    retry: false,
  });
}

export function useCampaignParticipantsQuery(
  campaignId: string,
  enabled = true,
  options?: { refetchInterval?: number | false }
) {
  return useQuery({
    queryKey: campaignKeys.participants(campaignId),
    queryFn: () => listCampaignParticipants(campaignId),
    enabled: Boolean(campaignId) && enabled,
    retry: false,
    refetchInterval: options?.refetchInterval,
  });
}

export function useCampaignParticipantsTreeQuery(
  campaignId: string,
  enabled = true,
  options?: { refetchInterval?: number | false }
) {
  return useQuery({
    queryKey: campaignKeys.participantsTree(campaignId),
    queryFn: () => listCampaignParticipantsTree(campaignId),
    enabled: Boolean(campaignId) && enabled,
    retry: false,
    refetchInterval: options?.refetchInterval,
  });
}

export function usePublicCampaignQuery(
  slug: string,
  authed = false,
  inviteToken?: string,
  groupToken?: string
) {
  return useQuery({
    queryKey: campaignKeys.public(slug, authed, inviteToken, groupToken),
    queryFn: () =>
      getPublicCampaign(slug, {
        inviteToken,
        groupToken,
      }),
    enabled: Boolean(slug),
  });
}

export function useTailorClientsQuery(
  page = 1,
  options?: { enabled?: boolean; refetchInterval?: number | false }
) {
  return useQuery<TailorClientListResult>({
    queryKey: tailorClientKeys.list(page),
    queryFn: () => listTailorClients({ page }),
    staleTime: 30_000,
    enabled: options?.enabled !== false,
    refetchInterval: options?.refetchInterval,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export function useCreateCampaignMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CampaignInput) => createCampaign(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: campaignKeys.all });
      invalidateBillingUsageQueries(qc);
    },
  });
}

export function useUpdateCampaignMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: CampaignInput }) =>
      updateCampaign(id, payload),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: campaignKeys.all });
      void qc.invalidateQueries({ queryKey: campaignKeys.detail(vars.id) });
      // Un-archive / status changes affect campaign quota.
      invalidateBillingUsageQueries(qc);
    },
  });
}

export function useArchiveCampaignMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => archiveCampaign(id),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: campaignKeys.all });
      void qc.invalidateQueries({ queryKey: campaignKeys.detail(id) });
      invalidateBillingUsageQueries(qc);
    },
  });
}

export function useDeleteCampaignMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteCampaign(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: campaignKeys.all });
      void qc.invalidateQueries({ queryKey: tailorClientKeys.all });
      invalidateBillingUsageQueries(qc);
    },
  });
}

function invalidateCampaignParticipants(qc: QueryClient, campaignId: string) {
  void qc.invalidateQueries({ queryKey: campaignKeys.participants(campaignId) });
  void qc.invalidateQueries({
    queryKey: campaignKeys.participantsTree(campaignId),
  });
}

/** Invalidate flat + tree participant caches for a campaign (join, invite, etc.). */
export function invalidateCampaignParticipantQueries(
  qc: QueryClient,
  campaignId: string
) {
  invalidateCampaignParticipants(qc, campaignId);
}

function invalidateCampaignNotificationQueries(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: notificationKeys.mine() });
}

export function useInviteParticipantsMutation(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: InviteParticipantsInput) =>
      inviteCampaignParticipants(campaignId, payload),
    onSuccess: () => {
      invalidateCampaignParticipants(qc, campaignId);
      void qc.invalidateQueries({ queryKey: campaignKeys.detail(campaignId) });
      void qc.invalidateQueries({ queryKey: campaignKeys.all });
      void qc.invalidateQueries({ queryKey: campaignKeys.mine() });
      void qc.invalidateQueries({ queryKey: campaignKeys.credits() });
      void qc.invalidateQueries({ queryKey: tailorClientKeys.all });
    },
  });
}

export function useSendRemindersMutation(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => sendCampaignReminders(campaignId),
    onSuccess: () => {
      invalidateCampaignParticipants(qc, campaignId);
    },
  });
}

export function useAllocateScansMutation(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      participantIds?: string[];
      scansEach: number;
      everyone?: boolean;
    }) => allocateCampaignScans(campaignId, payload),
    onSuccess: () => {
      invalidateCampaignParticipants(qc, campaignId);
      void qc.invalidateQueries({ queryKey: campaignKeys.detail(campaignId) });
      void qc.invalidateQueries({ queryKey: campaignKeys.all });
      void qc.invalidateQueries({ queryKey: campaignKeys.mine() });
      void qc.invalidateQueries({ queryKey: campaignKeys.credits() });
    },
  });
}

export function useCreateTailorClientMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: TailorClientInput) => createTailorClient(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tailorClientKeys.all });
      invalidateBillingUsageQueries(qc);
    },
  });
}

export function useDeleteTailorClientMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteTailorClient(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tailorClientKeys.all });
      invalidateBillingUsageQueries(qc);
    },
  });
}

export function useJoinCampaignMutation(slug: string) {
  const qc = useQueryClient();
  const invalidatePublic = () => {
    void qc.invalidateQueries({ queryKey: campaignKeys.all });
    void qc.invalidateQueries({
      predicate: (query) =>
        query.queryKey[0] === campaignKeys.all[0] &&
        query.queryKey[1] === "public" &&
        query.queryKey[2] === slug,
    });
  };
  return useMutation({
    mutationFn: (payload?: {
      fullName?: string;
      measurementProfileId?: string;
      inviteToken?: string;
      groupToken?: string;
    }) => joinCampaign(slug, payload),
    onSuccess: (result) => {
      invalidatePublic();
      void qc.invalidateQueries({ queryKey: campaignKeys.mine() });
      void qc.invalidateQueries({ queryKey: measurementKeys.all });
      invalidateCampaignNotificationQueries(qc);
      void qc.invalidateQueries({ queryKey: tailorClientKeys.all });
      void qc.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === campaignKeys.all[0] &&
          query.queryKey[1] === "coordinator-invitees",
      });
      if (result?.campaignId) {
        invalidateCampaignParticipantQueries(qc, result.campaignId);
        void qc.invalidateQueries({
          queryKey: campaignKeys.detail(result.campaignId),
        });
        void qc.invalidateQueries({ queryKey: campaignKeys.credits() });
      }
    },
    onError: (error) => {
      const msg = error instanceof Error ? error.message : "";
      // Join may have committed before complete failed — refresh participant state.
      if (
        msg.includes("Joined the campaign, but measurements were not submitted") ||
        msg.includes("Database temporarily unavailable") ||
        msg.includes("temporarily unavailable")
      ) {
        invalidatePublic();
        void qc.invalidateQueries({ queryKey: campaignKeys.mine() });
        void qc.invalidateQueries({ queryKey: measurementKeys.all });
        invalidateCampaignNotificationQueries(qc);
        void qc.invalidateQueries({ queryKey: tailorClientKeys.all });
        void qc.invalidateQueries({ queryKey: campaignKeys.credits() });
        void qc.invalidateQueries({
          predicate: (query) =>
            query.queryKey[0] === campaignKeys.all[0] &&
            query.queryKey[1] === "participants",
        });
        void qc.invalidateQueries({
          predicate: (query) =>
            query.queryKey[0] === campaignKeys.all[0] &&
            query.queryKey[1] === "coordinator-invitees",
        });
      }
    },
  });
}

export function useMyCampaignParticipationsQuery(enabled = true) {
  return useQuery({
    queryKey: campaignKeys.mine(),
    queryFn: () => listMyCampaignParticipations(),
    staleTime: 15_000,
    enabled,
    retry: false,
  });
}

export function useTailorCreditsQuery(enabled = true) {
  return useQuery<TailorCreditsSummaryDto>({
    queryKey: campaignKeys.credits(),
    queryFn: () => getTailorCreditsSummary(),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

export function useExportCampaignParticipantsMutation() {
  return useMutation({
    mutationFn: (campaignId: string) =>
      downloadCampaignParticipantsExport(campaignId),
  });
}

export function useExportAllCampaignParticipantsMutation() {
  return useMutation({
    mutationFn: () => downloadAllCampaignParticipantsExport(),
  });
}

export function useCoordinatorInviteesQuery(
  participantId: string,
  enabled = true,
  options?: { refetchInterval?: number | false }
) {
  return useQuery({
    queryKey: campaignKeys.coordinatorInvitees(participantId),
    queryFn: () => getCoordinatorInvitees(participantId),
    enabled: Boolean(participantId) && enabled,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    refetchInterval: options?.refetchInterval,
    retry: false,
  });
}

export function useInviteCoordinatorMembersMutation(participantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CoordinatorInviteMembersPayload) =>
      inviteCoordinatorMembers(participantId, payload),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: campaignKeys.mine() });
      void qc.invalidateQueries({
        queryKey: campaignKeys.coordinatorInvitees(participantId),
      });
      if (result.campaignId) {
        invalidateCampaignParticipantQueries(qc, result.campaignId);
        void qc.invalidateQueries({
          queryKey: campaignKeys.detail(result.campaignId),
        });
      } else {
        void qc.invalidateQueries({
          predicate: (query) =>
            query.queryKey[0] === campaignKeys.all[0] &&
            query.queryKey[1] === "participants",
        });
      }
      void qc.invalidateQueries({ queryKey: campaignKeys.all });
      void qc.invalidateQueries({ queryKey: campaignKeys.credits() });
      void qc.invalidateQueries({ queryKey: notificationKeys.mine() });
      void qc.invalidateQueries({ queryKey: tailorClientKeys.all });
    },
  });
}
