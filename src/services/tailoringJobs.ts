import { api, unwrap, type MaybeWrapped } from "@/utils/api";
import { compressImageFile } from "@/utils/imageUpload";
import { UPLOAD_REQUEST_TIMEOUT_MS } from "@/services/upload";
import type {
  CreateTailoringJobInput,
  PatchTailoringJobInput,
  TailoringJobDto,
  TailoringJobStatus,
} from "@/lib/tailoringJobs.shared";

type ListResponse = { jobs: TailoringJobDto[] };
type OneResponse = { job: TailoringJobDto; message?: string };
type UploadResponse = { url: string; message?: string };

export async function getMyTailoringJobs(opts?: {
  status?: TailoringJobStatus;
}): Promise<TailoringJobDto[]> {
  const params = new URLSearchParams({ scope: "customer", limit: "50" });
  if (opts?.status) params.set("status", opts.status);
  const raw = await api<MaybeWrapped<ListResponse>>(
    `/api/tailoring-jobs?${params}`,
    { method: "GET", credentials: "include" }
  );
  return unwrap(raw)?.jobs ?? [];
}

export async function getTailorJobs(opts?: {
  status?: TailoringJobStatus;
}): Promise<TailoringJobDto[]> {
  const params = new URLSearchParams({ scope: "tailor", limit: "50" });
  if (opts?.status) params.set("status", opts.status);
  const raw = await api<MaybeWrapped<ListResponse>>(
    `/api/tailoring-jobs?${params}`,
    { method: "GET", credentials: "include" }
  );
  return unwrap(raw)?.jobs ?? [];
}

export async function cancelTailoringCheckout(
  jobId: string
): Promise<{ reverted: boolean; status: TailoringJobStatus }> {
  const raw = await api<
    MaybeWrapped<{ reverted: boolean; status: TailoringJobStatus }>
  >("/api/payment/tailoring/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId }),
    credentials: "include",
  });
  const data = unwrap(raw);
  if (!data) throw new Error("Failed to cancel checkout");
  return data;
}

export async function initiateTailoringPayment(jobId: string): Promise<string> {
  const raw = await api<
    MaybeWrapped<{ url?: string; sessionId?: string }>
  >("/api/payment/tailoring", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, type: "stripe-gateway" }),
    credentials: "include",
  });
  const data = unwrap(raw);
  const url = data?.url;
  if (!url) throw new Error("Missing checkout URL");
  return url;
}

export async function getAdminTailoringJobs(opts?: {
  q?: string;
  status?: TailoringJobStatus | "";
}): Promise<TailoringJobDto[]> {
  const params = new URLSearchParams({ limit: "50" });
  if (opts?.q?.trim()) params.set("q", opts.q.trim());
  if (opts?.status) params.set("status", opts.status);
  const qs = params.toString();
  const raw = await api<MaybeWrapped<ListResponse>>(
    `/api/admin/tailoring-jobs${qs ? `?${qs}` : ""}`,
    { method: "GET", credentials: "include" }
  );
  return unwrap(raw)?.jobs ?? [];
}

export async function getTailoringJob(id: string): Promise<TailoringJobDto> {
  const raw = await api<MaybeWrapped<OneResponse>>(
    `/api/tailoring-jobs/${id}`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.job) throw new Error("Job not found");
  return data.job;
}

export async function getAdminTailoringJob(
  id: string
): Promise<TailoringJobDto> {
  const raw = await api<MaybeWrapped<OneResponse>>(
    `/api/admin/tailoring-jobs/${id}`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.job) throw new Error("Job not found");
  return data.job;
}

export async function createTailoringJob(
  payload: CreateTailoringJobInput
): Promise<TailoringJobDto> {
  const raw = await api<MaybeWrapped<OneResponse>>("/api/tailoring-jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include",
  });
  const data = unwrap(raw);
  if (!data?.job) throw new Error("Failed to submit job");
  return data.job;
}

export async function patchTailoringJob(
  id: string,
  payload: PatchTailoringJobInput
): Promise<TailoringJobDto> {
  const raw = await api<MaybeWrapped<OneResponse>>(
    `/api/tailoring-jobs/${id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
    }
  );
  const data = unwrap(raw);
  if (!data?.job) throw new Error("Failed to update job");
  return data.job;
}

export async function patchAdminTailoringJob(
  id: string,
  payload: PatchTailoringJobInput
): Promise<TailoringJobDto> {
  const raw = await api<MaybeWrapped<OneResponse>>(
    `/api/admin/tailoring-jobs/${id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
    }
  );
  const data = unwrap(raw);
  if (!data?.job) throw new Error("Failed to update job");
  return data.job;
}

export async function uploadJobReferenceImage(file: File): Promise<string> {
  const prepared = await compressImageFile(file);
  const form = new FormData();
  form.append("file", prepared);
  const raw = await api<MaybeWrapped<UploadResponse>>(
    "/api/tailoring-jobs/reference-images",
    { method: "POST", body: form, credentials: "include" },
    { timeout: UPLOAD_REQUEST_TIMEOUT_MS }
  );
  const data = unwrap(raw);
  if (!data?.url) throw new Error("Upload failed");
  return data.url;
}
