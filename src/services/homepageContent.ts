import { api, unwrap, type MaybeWrapped } from "@/utils/api";
import type {
  HomepageSectionDto,
  HomepageSectionKey,
} from "@/lib/homepageContent.shared";

type PublicHomepageResponse = {
  sections: HomepageSectionDto[];
  byKey: Partial<Record<HomepageSectionKey, HomepageSectionDto>>;
};

type AdminListResponse = {
  sections: HomepageSectionDto[];
};

type AdminSectionResponse = {
  section: HomepageSectionDto;
  message?: string;
};

export async function getPublicHomepageContent(): Promise<PublicHomepageResponse> {
  const raw = await api<MaybeWrapped<PublicHomepageResponse>>(
    "/api/homepage-content",
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  return {
    sections: data?.sections ?? [],
    byKey: data?.byKey ?? {},
  };
}

export async function getAdminHomepageSections(): Promise<HomepageSectionDto[]> {
  const raw = await api<MaybeWrapped<AdminListResponse>>(
    "/api/admin/homepage-content",
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  return data?.sections ?? [];
}

export async function getAdminHomepageSection(
  key: HomepageSectionKey
): Promise<HomepageSectionDto> {
  const raw = await api<MaybeWrapped<AdminSectionResponse>>(
    `/api/admin/homepage-content/${key}`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.section) {
    throw new Error("Homepage section not found");
  }
  return data.section;
}

export async function updateAdminHomepageSection(
  key: HomepageSectionKey,
  payload: {
    published?: boolean;
    content?: unknown;
    label?: string;
  }
): Promise<HomepageSectionDto> {
  const raw = await api<MaybeWrapped<AdminSectionResponse>>(
    `/api/admin/homepage-content/${key}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
    }
  );
  const data = unwrap(raw);
  if (!data?.section) {
    throw new Error("Failed to update homepage section");
  }
  return data.section;
}

export async function resetAdminHomepageSection(
  key: HomepageSectionKey
): Promise<HomepageSectionDto> {
  const raw = await api<MaybeWrapped<AdminSectionResponse>>(
    `/api/admin/homepage-content/${key}`,
    {
      method: "DELETE",
      credentials: "include",
    }
  );
  const data = unwrap(raw);
  if (!data?.section) {
    throw new Error("Failed to reset homepage section");
  }
  return data.section;
}
