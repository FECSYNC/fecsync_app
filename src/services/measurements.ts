import { api, unwrap, type MaybeWrapped } from "@/utils/api";
import type {
  MeasurementProfileDto,
  MeasurementProfileInput,
  MeasurementProfileUpdateInput,
  MeasurementCategoryPatchInput,
  MeasurementAiScanInput,
  MeasurementAiScanResult,
} from "@/lib/measurements.shared";

type ListResponse = {
  profiles: MeasurementProfileDto[];
  page?: number;
  totalPages?: number;
};
type OneResponse = { profile: MeasurementProfileDto; message?: string };

export async function getMyMeasurementProfiles(): Promise<
  MeasurementProfileDto[]
> {
  const all: MeasurementProfileDto[] = [];
  let page = 1;
  let totalPages = 1;
  const MAX_PAGES = 50;

  do {
    const raw = await api<MaybeWrapped<ListResponse>>(
      `/api/measurement-profiles?limit=50&page=${page}`,
      { method: "GET", credentials: "include" }
    );
    const data = unwrap(raw);
    all.push(...(data?.profiles ?? []));
    totalPages = Math.max(1, data?.totalPages ?? 1);
    page += 1;
  } while (page <= totalPages && page <= MAX_PAGES);

  return all;
}

export async function createMeasurementProfile(
  payload: MeasurementProfileInput
): Promise<MeasurementProfileDto> {
  const raw = await api<MaybeWrapped<OneResponse>>(
    "/api/measurement-profiles",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
    }
  );
  const data = unwrap(raw);
  if (!data?.profile) throw new Error("Failed to create measurement profile");
  return data.profile;
}

export async function updateMeasurementProfile(
  id: string,
  payload: MeasurementProfileUpdateInput
): Promise<MeasurementProfileDto> {
  const raw = await api<MaybeWrapped<OneResponse>>(
    `/api/measurement-profiles/${id}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
    }
  );
  const data = unwrap(raw);
  if (!data?.profile) throw new Error("Failed to update measurement profile");
  return data.profile;
}

export async function deleteMeasurementProfile(id: string): Promise<void> {
  await api(`/api/measurement-profiles/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
}

export async function setDefaultMeasurementProfile(
  id: string
): Promise<MeasurementProfileDto> {
  const raw = await api<MaybeWrapped<OneResponse>>(
    `/api/measurement-profiles/${id}/default`,
    { method: "PATCH", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.profile) throw new Error("Failed to set default profile");
  return data.profile;
}

export async function patchMeasurementProfileCategory(
  id: string,
  payload: MeasurementCategoryPatchInput
): Promise<MeasurementProfileDto> {
  const raw = await api<MaybeWrapped<OneResponse>>(
    `/api/measurement-profiles/${id}/category`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
    }
  );
  const data = unwrap(raw);
  if (!data?.profile) {
    throw new Error("Failed to update category measurements");
  }
  return data.profile;
}

export async function runMeasurementAiScan(
  id: string,
  payload: {
    frontImage: string;
    backImage: string;
    sideImage: string;
    campaignSlug?: string;
    inviteToken?: string;
  }
): Promise<MeasurementAiScanResult> {
  const raw = await api<
    MaybeWrapped<MeasurementAiScanResult & { message?: string }>
  >(`/api/measurement-profiles/${id}/ai-scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include",
  });
  const data = unwrap(raw);
  if (!data?.profile) throw new Error("Failed to analyze photos");
  return data;
}
