import { api, unwrap, type MaybeWrapped } from "@/utils/api";
import { compressImageFile } from "@/utils/imageUpload";
import { UPLOAD_REQUEST_TIMEOUT_MS } from "@/services/upload";
import type {
  PublicTailorDto,
  PublicTailorListResult,
  TailorAdminInput,
  TailorProfileDto,
  TailorSelfInput,
  TailorStatus,
} from "@/lib/tailors.shared";

type ListResponse = { tailors: TailorProfileDto[] };
type OneResponse = { tailor: TailorProfileDto; message?: string };
type PortfolioResponse = {
  tailor: TailorProfileDto;
  url: string;
  message?: string;
};
type PublicListResponse = PublicTailorListResult;
type PublicOneResponse = { tailor: PublicTailorDto };

export type PublicTailorReviewDto = {
  _id: string;
  rating: number;
  comment: string;
  /** Present on POST response only — omitted from public GET list. */
  jobId?: string;
  createdAt?: string;
  authorName?: string;
};

export type PublicTailorReviewsResult = {
  reviews: PublicTailorReviewDto[];
  avgRating: number;
  reviewCount: number;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type PublicTailorQuery = {
  q?: string;
  specialty?: string;
  location?: string;
  country?: string;
  city?: string;
  page?: number;
  limit?: number;
};

/** Public storefront listing — approved only. */
export async function getPublicTailors(
  opts: PublicTailorQuery = {}
): Promise<PublicTailorListResult> {
  const params = new URLSearchParams();
  if (opts.q?.trim()) params.set("q", opts.q.trim());
  if (opts.specialty?.trim()) params.set("specialty", opts.specialty.trim());
  if (opts.location?.trim()) params.set("location", opts.location.trim());
  if (opts.country?.trim()) params.set("country", opts.country.trim());
  if (opts.city?.trim()) params.set("city", opts.city.trim());
  if (opts.page) params.set("page", String(opts.page));
  if (opts.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  const raw = await api<MaybeWrapped<PublicListResponse>>(
    `/api/tailors${qs ? `?${qs}` : ""}`,
    { method: "GET" }
  );
  const data = unwrap(raw);
  return {
    items: data?.items ?? [],
    page: data?.page ?? opts.page ?? 1,
    limit: data?.limit ?? opts.limit ?? 12,
    total: data?.total ?? 0,
    totalPages: data?.totalPages ?? 1,
  };
}

/** Public storefront detail by slug — approved only. */
export async function getPublicTailorBySlug(
  slug: string
): Promise<PublicTailorDto> {
  const raw = await api<MaybeWrapped<PublicOneResponse>>(
    `/api/tailors/${encodeURIComponent(slug)}`,
    { method: "GET" }
  );
  const data = unwrap(raw);
  if (!data?.tailor) throw new Error("Tailor not found");
  return data.tailor;
}

/** Public reviews for an approved tailor profile. */
export async function getPublicTailorReviews(
  slug: string,
  opts?: { page?: number; limit?: number }
): Promise<PublicTailorReviewsResult> {
  const params = new URLSearchParams();
  if (opts?.page) params.set("page", String(opts.page));
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  const raw = await api<MaybeWrapped<PublicTailorReviewsResult>>(
    `/api/tailors/${encodeURIComponent(slug)}/reviews${qs ? `?${qs}` : ""}`,
    { method: "GET" }
  );
  const data = unwrap(raw);
  return {
    reviews: data?.reviews ?? [],
    avgRating: data?.avgRating ?? 0,
    reviewCount: data?.reviewCount ?? 0,
    page: data?.page ?? opts?.page ?? 1,
    limit: data?.limit ?? opts?.limit ?? 20,
    total: data?.total ?? 0,
    totalPages: data?.totalPages ?? 1,
  };
}

/** Customer review after completed job — updates public profile ratings. */
export async function submitTailorReview(input: {
  slug: string;
  jobId: string;
  rating: number;
  comment?: string;
}): Promise<PublicTailorReviewDto> {
  const raw = await api<MaybeWrapped<{ review: PublicTailorReviewDto }>>(
    `/api/tailors/${encodeURIComponent(input.slug)}/reviews`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId: input.jobId,
        rating: input.rating,
        comment: input.comment,
      }),
      credentials: "include",
    }
  );
  const data = unwrap(raw);
  if (!data?.review) throw new Error("Could not submit review");
  return data.review;
}

export async function getAdminTailors(opts?: {
  q?: string;
  status?: TailorStatus | "";
  page?: number;
  limit?: number;
}): Promise<TailorProfileDto[]> {
  const params = new URLSearchParams();
  if (opts?.q?.trim()) params.set("q", opts.q.trim());
  if (opts?.status) params.set("status", opts.status);
  params.set("page", String(opts?.page ?? 1));
  params.set("limit", String(opts?.limit ?? 50));
  const qs = params.toString();
  const raw = await api<MaybeWrapped<ListResponse>>(
    `/api/admin/tailors${qs ? `?${qs}` : ""}`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  return data?.tailors ?? [];
}

export async function getAdminTailor(id: string): Promise<TailorProfileDto> {
  const raw = await api<MaybeWrapped<OneResponse>>(
    `/api/admin/tailors/${id}`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.tailor) throw new Error("Failed to load tailor");
  return data.tailor;
}

export async function createAdminTailor(
  payload: TailorAdminInput
): Promise<TailorProfileDto> {
  const raw = await api<MaybeWrapped<OneResponse>>("/api/admin/tailors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include",
  });
  const data = unwrap(raw);
  if (!data?.tailor) throw new Error("Failed to create tailor");
  return data.tailor;
}

export async function updateAdminTailor(
  id: string,
  payload: TailorAdminInput
): Promise<TailorProfileDto> {
  const raw = await api<MaybeWrapped<OneResponse>>(
    `/api/admin/tailors/${id}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
    }
  );
  const data = unwrap(raw);
  if (!data?.tailor) throw new Error("Failed to update tailor");
  return data.tailor;
}

export async function patchAdminTailorStatus(
  id: string,
  status: TailorStatus
): Promise<TailorProfileDto> {
  const raw = await api<MaybeWrapped<OneResponse>>(
    `/api/admin/tailors/${id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
      credentials: "include",
    }
  );
  const data = unwrap(raw);
  if (!data?.tailor) throw new Error("Failed to update status");
  return data.tailor;
}

export async function getMyTailorProfile(): Promise<TailorProfileDto> {
  const raw = await api<MaybeWrapped<OneResponse>>("/api/tailor/me", {
    method: "GET",
    credentials: "include",
  });
  const data = unwrap(raw);
  if (!data?.tailor) throw new Error("Tailor profile not found");
  return data.tailor;
}

export async function updateMyTailorProfile(
  payload: TailorSelfInput
): Promise<TailorProfileDto> {
  const raw = await api<MaybeWrapped<OneResponse>>("/api/tailor/me", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include",
  });
  const data = unwrap(raw);
  if (!data?.tailor) throw new Error("Failed to update profile");
  return data.tailor;
}

export async function uploadTailorPortfolioImage(
  file: File
): Promise<{ tailor: TailorProfileDto; url: string }> {
  const prepared = await compressImageFile(file);
  const form = new FormData();
  form.append("file", prepared);
  const raw = await api<MaybeWrapped<PortfolioResponse>>(
    "/api/tailor/portfolio",
    {
      method: "POST",
      body: form,
      credentials: "include",
    },
    { timeout: UPLOAD_REQUEST_TIMEOUT_MS }
  );
  const data = unwrap(raw);
  if (!data?.tailor || !data.url) throw new Error("Upload failed");
  return { tailor: data.tailor, url: data.url };
}
