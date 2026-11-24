import { api, unwrap, type MaybeWrapped } from "@/utils/api";

export type CompanyProfile = {
  orgId: string;
  displayName: string;
  /** Unique workspace key (Organization.slug); editable by company admins. */
  organizationSlug: string | null;
  legalName: string | null;
  tradingName: string | null;
  logoUrl: string | null;
  logoPublicId: string | null;
  /** Staff sign-in page background; set via upload/clear endpoints only. */
  signinBackgroundUrl?: string | null;
  signinBackgroundPublicId?: string | null;
  supportEmail: string | null;
  billingEmail: string | null;
  replyToEmail: string | null;
  phone: string | null;
  website: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  taxId: string | null;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountLast4: string | null;
  /** Always null on read — write-only; see hasBankRoutingOrIban. */
  bankRoutingOrIban: string | null;
  bankCurrency: string | null;
  hasBankAccount: boolean;
  hasBankRoutingOrIban: boolean;
  invoiceFooterNote: string | null;
  receiptFooterNote: string | null;
  letterheadColor: string | null;
  publicLogo: boolean;
  publicPhone: boolean;
  publicSupportEmail: boolean;
  publicWebsite: boolean;
  publicAddress: boolean;
  embedOrigins: string[];
  completeness: number;
  createdAt: string | null;
  updatedAt: string | null;
};

export type CompanyProfileUpdatePayload = Partial<{
  organizationSlug: string | null;
  legalName: string | null;
  tradingName: string | null;
  logoUrl: string | null;
  logoPublicId: string | null;
  supportEmail: string | null;
  billingEmail: string | null;
  replyToEmail: string | null;
  phone: string | null;
  website: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  taxId: string | null;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankRoutingOrIban: string | null;
  bankCurrency: string | null;
  clearBank: boolean;
  invoiceFooterNote: string | null;
  receiptFooterNote: string | null;
  letterheadColor: string | null;
  publicLogo: boolean;
  publicPhone: boolean;
  publicSupportEmail: boolean;
  publicWebsite: boolean;
  publicAddress: boolean;
  embedOrigins: string[];
}>;

type ProfileResponse = {
  profile: CompanyProfile;
  workspaceLifecycle?: {
    offboardRequestedAt: string | null;
    offboardedAt: string | null;
  } | null;
  message?: string;
  wrote?: boolean;
};

export type CompanyProfileWriteResult = {
  profile: CompanyProfile;
  wrote: boolean;
};

export type CompanyProfileWithLifecycle = {
  profile: CompanyProfile;
  workspaceLifecycle: {
    offboardRequestedAt: string | null;
    offboardedAt: string | null;
  } | null;
};

export async function getAdminCompanyProfile(): Promise<CompanyProfile> {
  const bundled = await getAdminCompanyProfileWithLifecycle();
  return bundled.profile;
}

export async function getAdminCompanyProfileWithLifecycle(): Promise<CompanyProfileWithLifecycle> {
  const raw = await api<MaybeWrapped<ProfileResponse>>(
    "/api/admin/company-profile",
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.profile) {
    throw new Error("Failed to load company profile");
  }
  return {
    profile: data.profile,
    workspaceLifecycle: data.workspaceLifecycle ?? null,
  };
}

export async function updateCompanyProfile(
  payload: CompanyProfileUpdatePayload
): Promise<CompanyProfileWriteResult> {
  const raw = await api<MaybeWrapped<ProfileResponse>>(
    "/api/admin/company-profile",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
    }
  );
  const data = unwrap(raw);
  if (!data?.profile) {
    throw new Error("Failed to update company profile");
  }
  return {
    profile: data.profile,
    wrote: data.wrote !== false,
  };
}

export async function uploadCompanyLogo(file: File): Promise<CompanyProfile> {
  const form = new FormData();
  form.append("file", file);
  const raw = await api<MaybeWrapped<ProfileResponse>>(
    "/api/admin/company-profile/logo",
    {
      method: "POST",
      body: form,
      credentials: "include",
    }
  );
  const data = unwrap(raw);
  if (!data?.profile) {
    throw new Error("Failed to upload company logo");
  }
  return data.profile;
}

export async function clearCompanyLogo(): Promise<CompanyProfile> {
  const raw = await api<MaybeWrapped<ProfileResponse>>(
    "/api/admin/company-profile/logo",
    {
      method: "DELETE",
      credentials: "include",
    }
  );
  const data = unwrap(raw);
  if (!data?.profile) {
    throw new Error("Failed to clear company logo");
  }
  return data.profile;
}

export async function uploadSigninBackground(file: File): Promise<CompanyProfile> {
  const form = new FormData();
  form.append("file", file);
  const raw = await api<MaybeWrapped<ProfileResponse>>(
    "/api/admin/company-profile/signin-background",
    {
      method: "POST",
      body: form,
      credentials: "include",
    }
  );
  const data = unwrap(raw);
  if (!data?.profile) {
    throw new Error("Failed to upload sign-in background");
  }
  return data.profile;
}

export async function clearSigninBackground(): Promise<CompanyProfile> {
  const raw = await api<MaybeWrapped<ProfileResponse>>(
    "/api/admin/company-profile/signin-background",
    {
      method: "DELETE",
      credentials: "include",
    }
  );
  const data = unwrap(raw);
  if (!data?.profile) {
    throw new Error("Failed to remove sign-in background");
  }
  return data.profile;
}
