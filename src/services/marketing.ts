/**
 * Admin Guest Marketing Automation API client (Growth+).
 */
import { api, unwrap, type MaybeWrapped } from "@/utils/api";
import type {
  GuestSurveyDto,
  GuestSurveyResponseDto,
  MarketingAutomationSettingsDto,
  MarketingOverviewDto,
} from "@/lib/marketing/types";
import type { MarketingLeadRow } from "@/lib/marketing/segments";
import type {
  CampaignAction,
  MarketingCampaignDto,
  MarketingCampaignInput,
} from "@/lib/marketing/campaigns/types";

export type MarketingSendRow = {
  id: string;
  toEmail: string;
  kind: string;
  status: string;
  skipReason: string | null;
  createdAt: string;
};

export type MarketingAutomationsDto = {
  newsletterEnabled: boolean;
  welcomeEnabled: boolean;
  welcomeFromNewsletter: boolean;
  birthdayEnabled: boolean;
  reengagementEnabled: boolean;
  postVisitSurveyEnabled: boolean;
  welcomeDelayHours: number;
  birthdayDaysAhead: number;
  reengagementInactiveDays: number;
  reengagementCooldownDays: number;
  postVisitDelayHours: number;
  defaultSurveyId: string | null;
  updatedAt: string;
};

const BASE = "/api/admin/marketing";

export const marketingKeys = {
  all: ["admin", "marketing"] as const,
  overview: (locationId: string) =>
    [...marketingKeys.all, "overview", locationId] as const,
  settings: (locationId: string) =>
    [...marketingKeys.all, "settings", locationId] as const,
  automations: (locationId: string) =>
    [...marketingKeys.all, "automations", locationId] as const,
  leads: (q: string) => [...marketingKeys.all, "leads", q] as const,
  sends: (kind: string) => [...marketingKeys.all, "sends", kind] as const,
  surveys: () => [...marketingKeys.all, "surveys"] as const,
  survey: (id: string) => [...marketingKeys.all, "survey", id] as const,
  surveyResponses: (id: string) =>
    [...marketingKeys.all, "surveyResponses", id] as const,
  campaigns: () => [...marketingKeys.all, "campaigns"] as const,
  campaign: (id: string) => [...marketingKeys.all, "campaign", id] as const,
};

function locQuery(locationId?: string | null) {
  return locationId ? `?locationId=${encodeURIComponent(locationId)}` : "";
}

export async function getMarketingOverview(locationId?: string | null) {
  const res = await api<MaybeWrapped<{ overview: MarketingOverviewDto }>>(
    `${BASE}/overview${locQuery(locationId)}`,
    { method: "GET", credentials: "include" }
  );
  return unwrap(res).overview;
}

export async function getMarketingSettings(locationId?: string | null) {
  const res = await api<MaybeWrapped<{ settings: MarketingAutomationSettingsDto }>>(
    `${BASE}/settings${locQuery(locationId)}`,
    { method: "GET", credentials: "include" }
  );
  return unwrap(res).settings;
}

export async function patchMarketingSettings(
  body: Partial<MarketingAutomationSettingsDto> & { locationId?: string | null }
) {
  const res = await api<MaybeWrapped<{ settings: MarketingAutomationSettingsDto }>>(
    `${BASE}/settings`,
    {
      method: "PATCH",
      credentials: "include",
      body: JSON.stringify(body),
    }
  );
  return unwrap(res).settings;
}

export async function getMarketingAutomations(locationId?: string | null) {
  const res = await api<MaybeWrapped<{ automations: MarketingAutomationsDto }>>(
    `${BASE}/automations${locQuery(locationId)}`,
    { method: "GET", credentials: "include" }
  );
  return unwrap(res).automations;
}

export async function patchMarketingAutomations(
  body: Partial<MarketingAutomationsDto> & { locationId?: string | null }
) {
  const res = await api<MaybeWrapped<{ automations: MarketingAutomationsDto }>>(
    `${BASE}/automations`,
    {
      method: "PATCH",
      credentials: "include",
      body: JSON.stringify(body),
    }
  );
  return unwrap(res).automations;
}

export async function postMarketingTestSend(kind: string) {
  const res = await api<MaybeWrapped<{ sent: boolean; toEmail: string }>>(
    `${BASE}/automations/test-send`,
    {
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ kind }),
    }
  );
  return unwrap(res);
}

export async function listMarketingLeads(q?: string) {
  const qs = q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
  const res = await api<MaybeWrapped<{ leads: MarketingLeadRow[] }>>(
    `${BASE}/leads${qs}`,
    { method: "GET", credentials: "include" }
  );
  return unwrap(res).leads;
}

export async function patchLeadConsent(guestProfileId: string, optedIn: boolean) {
  const res = await api<
    MaybeWrapped<{ guestProfileId: string; optedIn: boolean }>
  >(`${BASE}/leads/${guestProfileId}/consent`, {
    method: "PATCH",
    credentials: "include",
    body: JSON.stringify({ optedIn }),
  });
  return unwrap(res);
}

export async function listMarketingSends(kind?: string) {
  const qs = kind?.trim() ? `?kind=${encodeURIComponent(kind.trim())}` : "";
  const res = await api<MaybeWrapped<{ sends: MarketingSendRow[] }>>(
    `${BASE}/sends${qs}`,
    { method: "GET", credentials: "include" }
  );
  return unwrap(res).sends;
}

export async function listMarketingSurveys() {
  const res = await api<MaybeWrapped<{ surveys: GuestSurveyDto[] }>>(
    `${BASE}/surveys`,
    { method: "GET", credentials: "include" }
  );
  return unwrap(res).surveys;
}

export async function createMarketingSurvey(body: {
  name: string;
  questions?: unknown;
  thankYouMessage?: string | null;
  promoUrl?: string | null;
}) {
  const res = await api<MaybeWrapped<{ survey: GuestSurveyDto }>>(
    `${BASE}/surveys`,
    {
      method: "POST",
      credentials: "include",
      body: JSON.stringify(body),
    }
  );
  return unwrap(res).survey;
}

export async function getMarketingSurvey(id: string) {
  const res = await api<MaybeWrapped<{ survey: GuestSurveyDto }>>(
    `${BASE}/surveys/${id}`,
    { method: "GET", credentials: "include" }
  );
  return unwrap(res).survey;
}

export async function patchMarketingSurvey(
  id: string,
  body: Partial<GuestSurveyDto>
) {
  const res = await api<MaybeWrapped<{ survey: GuestSurveyDto }>>(
    `${BASE}/surveys/${id}`,
    {
      method: "PATCH",
      credentials: "include",
      body: JSON.stringify(body),
    }
  );
  return unwrap(res).survey;
}

export async function listMarketingSurveyResponses(id: string) {
  const res = await api<MaybeWrapped<{ responses: GuestSurveyResponseDto[] }>>(
    `${BASE}/surveys/${id}/responses`,
    { method: "GET", credentials: "include" }
  );
  return unwrap(res).responses;
}

export async function exportMarketingSurveyCsv(id: string): Promise<string> {
  const res = await fetch(`/api/admin/marketing/surveys/${id}/export`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Export failed");
  return res.text();
}

export type MarketingCampaignDetail = MarketingCampaignDto & { audienceCount: number };

export type MarketingCampaignPreview = {
  subject: string;
  preheader: string;
  fromName: string;
  html: string;
  audienceCount: number;
  eventCount: number;
};

export async function uploadMarketingCampaignImage(file: File) {
  const form = new FormData();
  form.append("file", file);
  const res = await api<MaybeWrapped<{ url: string; width: number | null; height: number | null }>>(
    `${BASE}/campaigns/images`,
    { method: "POST", credentials: "include", body: form },
    { timeout: 60_000 }
  );
  return unwrap(res);
}

export async function listMarketingCampaigns() {
  const res = await api<
    MaybeWrapped<{ campaigns: MarketingCampaignDto[]; mailConfigured: boolean }>
  >(`${BASE}/campaigns`, { method: "GET", credentials: "include" });
  return unwrap(res);
}

export async function getMarketingCampaign(id: string) {
  const res = await api<MaybeWrapped<{ campaign: MarketingCampaignDetail }>>(
    `${BASE}/campaigns/${id}`,
    { method: "GET", credentials: "include" }
  );
  return unwrap(res).campaign;
}

export async function createMarketingCampaign(body: MarketingCampaignInput) {
  const res = await api<MaybeWrapped<{ campaign: MarketingCampaignDto }>>(
    `${BASE}/campaigns`,
    { method: "POST", credentials: "include", body: JSON.stringify(body) }
  );
  return unwrap(res).campaign;
}

export async function patchMarketingCampaign(id: string, body: MarketingCampaignInput) {
  const res = await api<MaybeWrapped<{ campaign: MarketingCampaignDto }>>(
    `${BASE}/campaigns/${id}`,
    { method: "PATCH", credentials: "include", body: JSON.stringify(body) }
  );
  return unwrap(res).campaign;
}

export async function archiveMarketingCampaign(id: string) {
  const res = await api<MaybeWrapped<{ archived: boolean }>>(
    `${BASE}/campaigns/${id}`,
    { method: "DELETE", credentials: "include" }
  );
  return unwrap(res);
}

export async function postMarketingCampaignAction(
  id: string,
  action: CampaignAction | "duplicate"
) {
  const res = await api<MaybeWrapped<{ campaign: MarketingCampaignDto }>>(
    `${BASE}/campaigns/${id}/actions`,
    { method: "POST", credentials: "include", body: JSON.stringify({ action }) }
  );
  return unwrap(res).campaign;
}

export async function postMarketingCampaignTestSend(id: string) {
  const res = await api<MaybeWrapped<{ sent: boolean; toEmail: string }>>(
    `${BASE}/campaigns/${id}/test-send`,
    { method: "POST", credentials: "include" }
  );
  return unwrap(res);
}

export async function previewMarketingCampaign(body: MarketingCampaignInput) {
  const res = await api<MaybeWrapped<{ preview: MarketingCampaignPreview }>>(
    `${BASE}/campaigns/preview`,
    { method: "POST", credentials: "include", body: JSON.stringify(body) }
  );
  return unwrap(res).preview;
}

export async function subscribePublicNewsletter(body: {
  orgSlug: string;
  email: string;
  firstName?: string;
  lastName?: string;
  /** Must be true — server rejects missing consent. */
  consent: true;
}) {
  const res = await api<MaybeWrapped<{ success: boolean }>>(
    "/api/public/marketing/newsletter",
    {
      method: "POST",
      credentials: "include",
      body: JSON.stringify(body),
    }
  );
  return unwrap(res);
}
