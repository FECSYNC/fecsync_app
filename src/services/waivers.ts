/**
 * Admin Digital Waivers API client (Feature 05). Not shop orders.
 */
import { api, unwrap, type MaybeWrapped } from "@/utils/api";

export type WaiverTemplateDto = {
  id: string;
  orgId: string;
  locationId: string | null;
  kind: string;
  name: string;
  slug: string;
  status: string;
  currentPublishedVersionId: string | null;
  requireResignOnPublish: boolean;
  defaultExpiryRule: string | null;
  defaultExpiryDays: number | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  draftVersionId: string | null;
  publishedVersion: number | null;
};

export type WaiverVersionDto = {
  id: string;
  version: number;
  status: string;
  localeDefault: string;
  title: string;
  bodyHtml: string;
  fieldsJson: unknown;
  layoutId: string;
  displayMode: string;
  allowDocumentExtract: boolean;
  allowTypedSignature: boolean | null;
  allowDrawnSignature: boolean | null;
  contentSha256: string;
  publishedAt: string | null;
  publishedByName?: string | null;
  createdAt: string;
  locales: {
    id: string;
    locale: string;
    title: string;
    bodyHtml: string;
    fieldsJson: unknown;
    layoutId: string;
    displayMode: string;
    allowDocumentExtract: boolean;
  }[];
};

export type WaiverSettingsDto = {
  id: string;
  locationId: string | null;
  jurisdictionCode: string;
  ageOfMajorityYears: number;
  requireGuardianForMinors: boolean;
  allowAdultSelfSign: boolean;
  allowGroupSigning: boolean;
  maxMinorsPerGuardianSession: number;
  expiryRule: string;
  expiryDays: number | null;
  remindBeforeDays: number[];
  retentionYears: number;
  requireIntentCheckbox: boolean;
  allowTypedSignature: boolean;
  allowDrawnSignature: boolean;
  optionalWitness: boolean;
  blockCheckInWhenMissing: boolean;
  kioskRequireStaffPin: boolean;
  kioskSessionMinutes: number;
  defaultLocale: string;
  notifyEmail: string | null;
  persisted: boolean;
};

export type WaiverKioskDto = {
  id: string;
  locationId: string;
  name: string;
  code: string;
  status: string;
  templateIds: string[];
  deviceToken?: string;
  archivedAt: string | null;
};

const BASE = "/api/admin/waivers";

export const waiverDeskQueryOptions = {
  staleTime: 0,
  refetchOnMount: "always" as const,
  refetchOnWindowFocus: true,
  refetchInterval: 15_000,
  refetchIntervalInBackground: false,
};

export const waiverKeys = {
  all: ["admin", "waivers"] as const,
  records: (q: string, status: string) =>
    [...waiverKeys.all, "records", q, status] as const,
  templates: (group: string) => [...waiverKeys.all, "templates", group] as const,
  template: (id: string) => [...waiverKeys.all, "template", id] as const,
  settings: (locationId: string) =>
    [...waiverKeys.all, "settings", locationId] as const,
  kiosks: () => [...waiverKeys.all, "kiosks"] as const,
  guides: () => [...waiverKeys.all, "guides"] as const,
  requirements: () => [...waiverKeys.all, "requirements"] as const,
  record: (id: string) => [...waiverKeys.all, "record", id] as const,
};

export async function listWaiverRecords(opts?: {
  q?: string;
  status?: string;
  email?: string;
  phone?: string;
  templateId?: string;
  locationId?: string;
  channel?: string;
  from?: string;
  to?: string;
  expiringWithin?: string;
}) {
  const qs = new URLSearchParams();
  if (opts?.q) qs.set("q", opts.q);
  if (opts?.status) qs.set("status", opts.status);
  if (opts?.email) qs.set("email", opts.email);
  if (opts?.phone) qs.set("phone", opts.phone);
  if (opts?.templateId) qs.set("templateId", opts.templateId);
  if (opts?.locationId) qs.set("locationId", opts.locationId);
  if (opts?.channel) qs.set("channel", opts.channel);
  if (opts?.from) qs.set("from", opts.from);
  if (opts?.to) qs.set("to", opts.to);
  if (opts?.expiringWithin) qs.set("expiringWithin", opts.expiringWithin);
  const raw = await api<MaybeWrapped<{ records: unknown[] }>>(
    `${BASE}/records?${qs.toString()}`,
    { method: "GET", credentials: "include" }
  );
  return unwrap(raw)?.records ?? [];
}

export async function listWaiverTemplates(group: "documents" | "forms" | "all") {
  const qs = group === "all" ? "" : `?group=${group}`;
  const raw = await api<MaybeWrapped<{ templates: WaiverTemplateDto[] }>>(
    `${BASE}/templates${qs}`,
    { method: "GET", credentials: "include" }
  );
  return unwrap(raw)?.templates ?? [];
}

export async function createWaiverTemplate(body: Record<string, unknown>) {
  const raw = await api<MaybeWrapped<{ template: WaiverTemplateDto }>>(
    `${BASE}/templates`,
    { method: "POST", credentials: "include", body: JSON.stringify(body) }
  );
  const data = unwrap(raw);
  if (!data?.template) throw new Error("Could not create template");
  return data.template;
}

export async function getWaiverTemplate(id: string) {
  const raw = await api<
    MaybeWrapped<{ template: WaiverTemplateDto; versions: WaiverVersionDto[] }>
  >(`${BASE}/templates/${encodeURIComponent(id)}`, {
    method: "GET",
    credentials: "include",
  });
  const data = unwrap(raw);
  if (!data?.template) throw new Error("Template not found");
  return data;
}

export async function updateWaiverTemplate(id: string, body: Record<string, unknown>) {
  const raw = await api<MaybeWrapped<{ template: WaiverTemplateDto }>>(
    `${BASE}/templates/${encodeURIComponent(id)}`,
    { method: "PATCH", credentials: "include", body: JSON.stringify(body) }
  );
  const data = unwrap(raw);
  if (!data?.template) throw new Error("Could not update template");
  return data.template;
}

export async function createWaiverVersion(id: string, body: Record<string, unknown>) {
  const raw = await api<MaybeWrapped<{ version: WaiverVersionDto }>>(
    `${BASE}/templates/${encodeURIComponent(id)}/versions`,
    { method: "POST", credentials: "include", body: JSON.stringify(body) }
  );
  const data = unwrap(raw);
  if (!data?.version) throw new Error("Could not create version");
  return data.version;
}

export async function publishWaiverTemplate(id: string, versionId?: string) {
  const raw = await api<MaybeWrapped<{ template: WaiverTemplateDto }>>(
    `${BASE}/templates/${encodeURIComponent(id)}/publish`,
    {
      method: "POST",
      credentials: "include",
      body: JSON.stringify(versionId ? { versionId } : {}),
    }
  );
  const data = unwrap(raw);
  if (!data?.template) throw new Error("Could not publish");
  return data.template;
}

export type BlueprintImportResult = {
  mode: "preview" | "commit";
  written: boolean;
  published: boolean;
  fieldCount: number;
  layoutId: string;
  displayMode: string;
  presentationIncluded: boolean;
  errors: { row: number; column: string; message: string }[];
};

export async function downloadWaiverBlueprint(_format: "csv" | "xlsx") {
  throw new Error("Form questions are added in the form wizard, not from a spreadsheet.");
}

export async function importWaiverBlueprint(
  _templateId: string,
  _file: File,
  _mode: "preview" | "commit"
): Promise<BlueprintImportResult> {
  throw new Error("Form questions are added in the form wizard, not from a spreadsheet.");
}

export async function getWaiverSettings(locationId: string | null) {
  const qs = locationId ? `?locationId=${encodeURIComponent(locationId)}` : "";
  const raw = await api<MaybeWrapped<{ settings: WaiverSettingsDto }>>(
    `${BASE}/settings${qs}`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.settings) throw new Error("Could not load settings");
  return data.settings;
}

export async function putWaiverSettings(body: Record<string, unknown>) {
  const raw = await api<MaybeWrapped<{ settings: WaiverSettingsDto }>>(
    `${BASE}/settings`,
    { method: "PUT", credentials: "include", body: JSON.stringify(body) }
  );
  const data = unwrap(raw);
  if (!data?.settings) throw new Error("Could not save settings");
  return data.settings;
}

export async function listKioskDevices() {
  const raw = await api<MaybeWrapped<{ devices: WaiverKioskDto[] }>>(
    `${BASE}/kiosk-devices`,
    { method: "GET", credentials: "include" }
  );
  return unwrap(raw)?.devices ?? [];
}

export async function createKioskDevice(body: Record<string, unknown>) {
  const raw = await api<MaybeWrapped<{ device: WaiverKioskDto }>>(
    `${BASE}/kiosk-devices`,
    { method: "POST", credentials: "include", body: JSON.stringify(body) }
  );
  const data = unwrap(raw);
  if (!data?.device) throw new Error("Could not create kiosk");
  return data.device;
}

export async function rotateKioskDevice(id: string) {
  const raw = await api<MaybeWrapped<{ device: WaiverKioskDto }>>(
    `${BASE}/kiosk-devices/${encodeURIComponent(id)}/rotate`,
    { method: "POST", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.device) throw new Error("Could not rotate kiosk token");
  return data.device;
}

export async function patchKioskDevice(id: string, body: Record<string, unknown>) {
  const raw = await api<MaybeWrapped<{ device: WaiverKioskDto }>>(
    `${BASE}/kiosk-devices/${encodeURIComponent(id)}`,
    { method: "PATCH", credentials: "include", body: JSON.stringify(body) }
  );
  const data = unwrap(raw);
  if (!data?.device) throw new Error("Could not update kiosk");
  return data.device;
}

export async function listComplianceGuides() {
  const raw = await api<
    MaybeWrapped<{
      guides: {
        id: string;
        title: string;
        disclaimer: string;
        sections: { heading: string; body: string; links?: { label: string; href: string }[] }[];
      }[];
      disclaimer: string;
    }>
  >(`${BASE}/compliance-guides`, { method: "GET", credentials: "include" });
  return unwrap(raw);
}

export async function listWaiverRequirements() {
  const raw = await api<
    MaybeWrapped<{
      requirements: {
        id: string;
        templateId: string;
        templateName: string;
        targetType: string;
        targetId: string | null;
        enforcement: string;
        locationId: string | null;
      }[];
    }>
  >(`${BASE}/requirements`, { method: "GET", credentials: "include" });
  return unwrap(raw)?.requirements ?? [];
}

export async function createWaiverRequirement(body: Record<string, unknown>) {
  const raw = await api<MaybeWrapped<{ requirement: { id: string } }>>(
    `${BASE}/requirements`,
    { method: "POST", credentials: "include", body: JSON.stringify(body) }
  );
  return unwrap(raw)?.requirement;
}

export async function deleteWaiverRequirement(id: string) {
  await api(`${BASE}/requirements/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });
}

export async function sendWaiverRequest(body: Record<string, unknown>) {
  const raw = await api<
    MaybeWrapped<{ url: string; token: string; status: string; requestId: string }>
  >(`${BASE}/requests`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = unwrap(raw);
  if (!data?.url) throw new Error("Could not create a signing link");
  return data;
}

export async function searchWaiverGuests(q: string) {
  const raw = await api<
    MaybeWrapped<{
      guests: {
        id: string;
        firstName: string;
        lastName: string;
        email: string | null;
        phone: string | null;
      }[];
    }>
  >(`${BASE}/guests/search?q=${encodeURIComponent(q)}`, {
    method: "GET",
    credentials: "include",
  });
  return unwrap(raw)?.guests ?? [];
}

export async function waiverSignageUrl(templateId: string, locationId: string) {
  const raw = await api<
    MaybeWrapped<{ url: string; token: string; svg?: string | null; logoUrl?: string | null; venueName?: string }>
  >(
    `${BASE}/templates/${encodeURIComponent(templateId)}/qr?locationId=${encodeURIComponent(locationId)}`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.url) throw new Error("Could not create signage");
  return data;
}

export async function bulkResendWaiverRecords(recordIds: string[]) {
  const raw = await api<MaybeWrapped<{ results: { id: string; ok: boolean; error?: string }[] }>>(
    `${BASE}/records/bulk`,
    {
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ action: "resend", recordIds }),
    }
  );
  return unwrap(raw);
}

export async function listPartyWaiverGaps(bookingId: string) {
  const raw = await api<
    MaybeWrapped<{
      available: boolean;
      waiverMissingCount?: number;
      guests: {
        partyGuestId: string;
        name: string | null;
        covered: boolean;
        waiverStatus?: string;
      }[];
    }>
  >(`${BASE}/party-chase?bookingId=${encodeURIComponent(bookingId)}`, {
    method: "GET",
    credentials: "include",
  });
  return unwrap(raw);
}

export async function sendPartyWaiverChase(bookingId: string, templateId: string) {
  const raw = await api<
    MaybeWrapped<{ available: boolean; sent: number; missing?: number; skipped?: string; url?: string }>
  >(`${BASE}/party-chase`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify({ bookingId, templateId }),
  });
  return unwrap(raw);
}

export async function getWaiverRecord(id: string) {
  const raw = await api<
    MaybeWrapped<{
      record: {
        publicRef: string;
        status: string;
        channel: string;
        signedAt: string | null;
        expiresAt: string | null;
        guest: { id: string; firstName: string; lastName: string };
        template: { name: string };
        location: { name: string };
        signers: { id: string; fullName: string; role: string; isMinor: boolean }[];
        signatures: {
          id: string;
          typedName: string | null;
          timezone: string;
          intentAccepted: boolean;
          hasDrawnSignature: boolean;
          drawnSignatureSvg?: string | null;
          witnessName?: string | null;
          contentSha256?: string;
          acceptedClauses?: { id: string; label: string }[] | null;
        }[];
        forms: { id: string; name: string; answers: Record<string, unknown> }[];
        fillMethod?: string | null;
        version?: number;
        voidReason?: string | null;
        voidedAt?: string | null;
      };
    }>
  >(`${BASE}/records/${encodeURIComponent(id)}`, {
    method: "GET",
    credentials: "include",
  });
  return unwrap(raw)?.record ?? null;
}

export async function voidWaiverRecord(id: string, reason: string) {
  const raw = await api<MaybeWrapped<{ status: string }>>(`${BASE}/records/${encodeURIComponent(id)}/void`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify({ reason }),
  });
  return unwrap(raw);
}

export async function cancelWaiverRequests(id: string) {
  const raw = await api<MaybeWrapped<{ cancelled: number }>>(`${BASE}/records/bulk`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify({ action: "cancel", recordId: id }),
  });
  return unwrap(raw);
}

export async function resendWaiverRecord(id: string) {
  const raw = await api<MaybeWrapped<{ url: string }>>(`${BASE}/records/${encodeURIComponent(id)}/resend`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify({}),
  });
  return unwrap(raw);
}

export async function evaluateWaiverGuest(
  guestProfileId: string,
  locationId: string,
  extra?: { admissionProductId?: string; membershipPlanId?: string }
) {
  const qs = new URLSearchParams({ guestProfileId, locationId });
  if (extra?.admissionProductId) qs.set("admissionProductId", extra.admissionProductId);
  if (extra?.membershipPlanId) qs.set("membershipPlanId", extra.membershipPlanId);
  const raw = await api<MaybeWrapped<{ evaluation: { status: string; missingRequirements: { reason: string; enforcement: string }[] } }>>(
    `${BASE}/evaluate?${qs.toString()}`,
    { method: "GET", credentials: "include" }
  );
  return unwrap(raw);
}
