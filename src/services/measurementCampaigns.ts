import { api, unwrap, type MaybeWrapped } from "@/utils/api";
import { compressImageFile } from "@/utils/imageUpload";
import { UPLOAD_REQUEST_TIMEOUT_MS } from "@/services/upload";
import type {
  CampaignInput,
  CampaignParticipantDto,
  CampaignParticipantsTreeDto,
  InviteParticipantsInput,
  MeasurementCampaignDto,
  TailorClientDto,
  TailorClientInput,
  TailorCreditsSummaryDto,
} from "@/lib/measurementCampaigns.shared";

const CAMPAIGNS = "/api/tailor/campaigns";
const CLIENTS = "/api/tailor/clients";

export type CampaignListResult = {
  campaigns: MeasurementCampaignDto[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  /** Org plan campaign cap (MAX_SAFE_INTEGER = unlimited). */
  planLimit: number;
  /** Org-wide campaign count for plan meters (not filter-scoped). */
  planUsed: number;
  /** Resolved plan id for UI toast copy (matches assertWithinPlanLimit). */
  planResolved?: string | null;
  /** False when approve-without-plan / unpaid — soft-gates must not say “starter cap”. */
  billingEntitled?: boolean;
};

export type TailorClientListResult = {
  clients: TailorClientDto[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  /** Org plan tailor-client cap (MAX_SAFE_INTEGER = unlimited). */
  planLimit: number;
  /** Org-wide client count for plan meters (not per-tailor page total). */
  planUsed: number;
  planResolved?: string | null;
  /** False when approve-without-plan / unpaid — soft-gates must not say “starter cap”. */
  billingEntitled?: boolean;
};

export async function listCampaigns(params?: {
  page?: number;
  limit?: number;
  q?: string;
  status?: string;
  category?: string;
  sort?: string;
}): Promise<CampaignListResult> {
  const sp = new URLSearchParams();
  if (params?.page) sp.set("page", String(params.page));
  if (params?.limit) sp.set("limit", String(params.limit));
  if (params?.q) sp.set("q", params.q);
  if (params?.status) sp.set("status", params.status);
  if (params?.category) sp.set("category", params.category);
  if (params?.sort) sp.set("sort", params.sort);
  const qs = sp.toString();
  const raw = await api<MaybeWrapped<CampaignListResult>>(
    `${CAMPAIGNS}${qs ? `?${qs}` : ""}`
  );
  return unwrap(raw);
}

export async function getCampaign(id: string): Promise<MeasurementCampaignDto> {
  const raw = await api<MaybeWrapped<{ campaign: MeasurementCampaignDto }>>(
    `${CAMPAIGNS}/${id}`
  );
  return unwrap(raw).campaign;
}

export async function createCampaign(
  payload: CampaignInput
): Promise<MeasurementCampaignDto> {
  const raw = await api<MaybeWrapped<{ campaign: MeasurementCampaignDto }>>(
    CAMPAIGNS,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  return unwrap(raw).campaign;
}

export async function uploadCampaignMedia(
  file: File,
  kind: "logo" | "cover"
): Promise<string> {
  const prepared = await compressImageFile(file);
  const form = new FormData();
  form.append("file", prepared);
  form.append("kind", kind);
  const raw = await api<MaybeWrapped<{ url: string }>>(
    `${CAMPAIGNS}/media`,
    { method: "POST", body: form },
    { timeout: UPLOAD_REQUEST_TIMEOUT_MS }
  );
  return unwrap(raw).url;
}

export async function updateCampaign(
  id: string,
  payload: CampaignInput
): Promise<MeasurementCampaignDto> {
  const raw = await api<MaybeWrapped<{ campaign: MeasurementCampaignDto }>>(
    `${CAMPAIGNS}/${id}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  return unwrap(raw).campaign;
}

export async function archiveCampaign(
  id: string
): Promise<MeasurementCampaignDto> {
  const raw = await api<MaybeWrapped<{ campaign: MeasurementCampaignDto }>>(
    `${CAMPAIGNS}/${id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "archive" }),
    }
  );
  return unwrap(raw).campaign;
}

export async function deleteCampaign(id: string): Promise<void> {
  await api(`${CAMPAIGNS}/${id}`, { method: "DELETE" });
}

export async function listCampaignParticipants(
  campaignId: string
): Promise<CampaignParticipantDto[]> {
  const raw = await api<MaybeWrapped<{ participants: CampaignParticipantDto[] }>>(
    `${CAMPAIGNS}/${campaignId}/participants`
  );
  return unwrap(raw).participants;
}

export async function listCampaignParticipantsTree(
  campaignId: string
): Promise<CampaignParticipantsTreeDto> {
  const raw = await api<MaybeWrapped<CampaignParticipantsTreeDto>>(
    `${CAMPAIGNS}/${campaignId}/participants?view=tree`
  );
  const data = unwrap(raw);
  if (
    !data ||
    !Array.isArray(data.coordinators) ||
    !Array.isArray(data.direct) ||
    !data.stats ||
    typeof data.stats !== "object"
  ) {
    throw new Error("Invalid participants tree response");
  }
  return {
    coordinators: data.coordinators,
    direct: data.direct,
    stats: {
      invited: Number(data.stats.invited) || 0,
      accepted: Number(data.stats.accepted) || 0,
      completed: Number(data.stats.completed) || 0,
      pending: Number(data.stats.pending) || 0,
      completionPercent: Number(data.stats.completionPercent) || 0,
      coordinators: Number(data.stats.coordinators) || 0,
      members: Number(data.stats.members) || 0,
      direct: Number(data.stats.direct) || 0,
    },
  };
}

export async function inviteCampaignParticipants(
  campaignId: string,
  payload: InviteParticipantsInput
): Promise<{ invited: number; participants: CampaignParticipantDto[] }> {
  const raw = await api<
    MaybeWrapped<{ invited: number; participants: CampaignParticipantDto[] }>
  >(`${CAMPAIGNS}/${campaignId}/participants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "invite", ...payload }),
  });
  return unwrap(raw);
}

export async function sendCampaignReminders(
  campaignId: string
): Promise<{ reminded: number }> {
  const raw = await api<MaybeWrapped<{ reminded: number }>>(
    `${CAMPAIGNS}/${campaignId}/participants`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remind" }),
    }
  );
  return unwrap(raw);
}

export async function allocateCampaignScans(
  campaignId: string,
  payload: {
    participantIds?: string[];
    scansEach: number;
    everyone?: boolean;
  }
): Promise<{ updated: number }> {
  const raw = await api<MaybeWrapped<{ updated: number }>>(
    `${CAMPAIGNS}/${campaignId}/participants`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "allocate-scans", ...payload }),
    }
  );
  return unwrap(raw);
}

export async function listTailorClients(params?: {
  page?: number;
  limit?: number;
}): Promise<TailorClientListResult> {
  const sp = new URLSearchParams();
  if (params?.page) sp.set("page", String(params.page));
  if (params?.limit) sp.set("limit", String(params.limit));
  const qs = sp.toString();
  const raw = await api<MaybeWrapped<TailorClientListResult>>(
    `${CLIENTS}${qs ? `?${qs}` : ""}`
  );
  return unwrap(raw);
}

export async function createTailorClient(
  payload: TailorClientInput
): Promise<TailorClientDto> {
  const raw = await api<MaybeWrapped<{ client: TailorClientDto }>>(CLIENTS, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return unwrap(raw).client;
}

export async function deleteTailorClient(id: string): Promise<void> {
  await api(`${CLIENTS}/${id}`, { method: "DELETE" });
}

export async function getTailorCreditsSummary(): Promise<TailorCreditsSummaryDto> {
  const raw = await api<MaybeWrapped<{ summary: TailorCreditsSummaryDto }>>(
    `${CAMPAIGNS}/credits`
  );
  return unwrap(raw).summary;
}

export async function downloadCampaignParticipantsExport(
  campaignId: string
): Promise<{ filename: string; blob: Blob }> {
  const res = await fetch(
    `${typeof window !== "undefined" ? window.location.origin : ""}${CAMPAIGNS}/${campaignId}/participants/export`,
    {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    }
  );
  if (!res.ok) {
    let message = "Export failed";
    try {
      const json = (await res.json()) as { message?: string };
      if (json.message) message = json.message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match?.[1] ?? "campaign-participants.csv";
  const blob = await res.blob();
  return { filename, blob };
}

export async function downloadAllCampaignParticipantsExport(): Promise<{
  filename: string;
  blob: Blob;
}> {
  const res = await fetch(
    `${typeof window !== "undefined" ? window.location.origin : ""}${CAMPAIGNS}/participants/export`,
    {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    }
  );
  if (!res.ok) {
    let message = "Export failed";
    try {
      const json = (await res.json()) as { message?: string };
      if (json.message) message = json.message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match?.[1] ?? "all-campaign-participants.csv";
  const blob = await res.blob();
  return { filename, blob };
}

import type {
  PublicCampaignDto,
  CustomerCampaignParticipationDto,
  CoordinatorInviteeDto,
} from "@/lib/measurementCampaigns.shared";

export type { PublicCampaignDto };

export type MyCampaignParticipationsResult = {
  participations: CustomerCampaignParticipationDto[];
  emailVerificationRequired?: boolean;
};

export async function listMyCampaignParticipations(): Promise<MyCampaignParticipationsResult> {
  const raw = await api<
    MaybeWrapped<{
      participations: CustomerCampaignParticipationDto[];
      emailVerificationRequired?: boolean;
    }>
  >("/api/campaigns/my", {
    method: "GET",
    credentials: "include",
  });
  const data = unwrap(raw);
  return {
    participations: data.participations ?? [],
    emailVerificationRequired: data.emailVerificationRequired,
  };
}

export async function getPublicCampaign(
  slug: string,
  opts?: { inviteToken?: string; groupToken?: string }
): Promise<PublicCampaignDto> {
  const params = new URLSearchParams();
  if (opts?.inviteToken?.trim()) {
    params.set("invite", opts.inviteToken.trim());
  }
  if (opts?.groupToken?.trim()) {
    params.set("group", opts.groupToken.trim());
  }
  const qs = params.toString();
  const raw = await api<MaybeWrapped<{ campaign: PublicCampaignDto }>>(
    `/api/campaigns/join/${slug}${qs ? `?${qs}` : ""}`,
    {
      method: "GET",
      credentials: "include",
    }
  );
  return unwrap(raw).campaign;
}

export async function joinCampaign(
  slug: string,
  payload?: {
    fullName?: string;
    measurementProfileId?: string;
    inviteToken?: string;
    groupToken?: string;
  }
): Promise<{
  participantId: string;
  campaignId: string;
  campaignName: string;
  completed?: boolean;
  alreadyCompleted?: boolean;
}> {
  const raw = await api<
    MaybeWrapped<{
      participantId: string;
      campaignId: string;
      campaignName: string;
      completed?: boolean;
      alreadyCompleted?: boolean;
    }>
  >(`/api/campaigns/join/${slug}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: payload?.measurementProfileId ? "complete" : undefined,
      fullName: payload?.fullName,
      measurementProfileId: payload?.measurementProfileId,
      inviteToken: payload?.inviteToken,
      groupToken: payload?.groupToken,
    }),
  });
  return unwrap(raw);
}

export type CoordinatorInviteesResult = {
  invitees: CoordinatorInviteeDto[];
  groupJoinPath: string;
  shareToken: string;
  stats: {
    total: number;
    completed: number;
    accepted: number;
    invited: number;
  };
};

export type CoordinatorInviteMembersPayload =
  | {
      action: "invite";
      members: Array<{ fullName: string; email?: string }>;
      coordinatorGroupLabel?: string;
    }
  | {
      action: "set-group-label";
      coordinatorGroupLabel: string;
    };

export async function getCoordinatorInvitees(
  participantId: string
): Promise<CoordinatorInviteesResult> {
  const raw = await api<MaybeWrapped<CoordinatorInviteesResult>>(
    `/api/campaigns/my/${participantId}/invitees`,
    {
      method: "GET",
      credentials: "include",
    }
  );
  return unwrap(raw);
}

export async function inviteCoordinatorMembers(
  participantId: string,
  payload: CoordinatorInviteMembersPayload
): Promise<{
  invited: number;
  invitees: CoordinatorInviteeDto[];
  coordinatorGroupLabel?: string;
  campaignId?: string;
}> {
  const raw = await api<
    MaybeWrapped<{
      invited: number;
      invitees: CoordinatorInviteeDto[];
      coordinatorGroupLabel?: string;
      campaignId?: string;
    }>
  >(`/api/campaigns/my/${participantId}/invitees`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  return unwrap(raw);
}

export async function getCoordinatorGroupLink(
  participantId: string
): Promise<{ groupJoinPath: string; shareToken: string }> {
  const raw = await api<
    MaybeWrapped<{ groupJoinPath: string; shareToken: string }>
  >(`/api/campaigns/my/${participantId}/group-link`, {
    method: "GET",
    credentials: "include",
  });
  return unwrap(raw);
}
