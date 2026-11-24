'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useToast } from '@/contexts/toast-context';
import {
  useAdminCompanyProfileQuery,
  useUpdateCompanyProfileMutation,
  useUploadCompanyLogoMutation,
  useClearCompanyLogoMutation,
} from '@/hooks/useCompanyProfile';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import { useCatalogActionPermissions, isStorefrontOrgSession } from '@/hooks/useAdminPermission';
import { useAuthStore } from '@/store/authStore';
import { isDemoPlanId } from '@/lib/subscriptionPlans';
import { isPlatformAdminActor } from '@/lib/auth/permissions';
import { tenantDashboardOrigin, tenantSlugFromHost } from '@/lib/tenantDomain';
import CompanyLoginLink from '@/components/Protected/admin/components/CompanyLoginLink';
import SigninBackgroundSection from './SigninBackgroundSection';
import {
  downloadCompanyWorkspaceExport,
  requestCompanyWorkspaceOffboard,
  saveWorkspaceExportFile,
} from '@/services/companyWorkspace';
import { getAdminCompanyProfileWithLifecycle } from '@/services/companyProfile';
import { useQueryClient } from '@tanstack/react-query';
import { companyProfileKeys } from '@/hooks/useCompanyProfile';
import AdminHowToGuideModal, {
  AdminHowToGuideButton,
  COMPANY_PROFILE_GUIDE_STEPS,
} from '@/components/Protected/admin/components/AdminHowToGuideModal';

const emptyForm = {
  organizationSlug: '',
  legalName: '',
  tradingName: '',
  supportEmail: '',
  billingEmail: '',
  replyToEmail: '',
  phone: '',
  website: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  country: '',
  postalCode: '',
  taxId: '',
  bankName: '',
  bankAccountName: '',
  bankAccountNumber: '',
  bankRoutingOrIban: '',
  bankCurrency: '',
  invoiceFooterNote: '',
  receiptFooterNote: '',
  letterheadColor: '',
};

export default function CompanyProfilePage() {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const { canReadCompanyProfile, canWriteCompanyProfile } =
    useCatalogActionPermissions();
  const canManage = canWriteCompanyProfile;
  const canView = canReadCompanyProfile;
  const user = useAuthStore((s) => s.user);
  const orgStatus = useAuthStore((s) => s.user?.orgStatus ?? null);
  const isPlatformAdmin = isPlatformAdminActor(user);
  const isStorefront = isStorefrontOrgSession(user);
  const publicFieldsLocked =
    !isStorefront && isDemoPlanId(user?.subscriptionPlan);
  const billingSoftHoldSession = useAuthStore(
    (s) => s.user?.billingSoftHold === true
  );
  const subscriptionStatus = useAuthStore(
    (s) => s.user?.subscriptionStatus ?? null
  );
  const subscriptionEndsAt = useAuthStore(
    (s) => s.user?.subscriptionEndsAt ?? null
  );
  // Align with server SSOT (`isSoftBillingHoldRow`) + /me flag.
  // Soft-hold is DB-active only — do not treat hard-suspended as soft-hold.
  const softBillingHold =
    billingSoftHoldSession ||
    (orgStatus === 'active' &&
      ((subscriptionStatus === 'past_due' && !subscriptionEndsAt) ||
        (Boolean(subscriptionEndsAt) &&
          new Date(subscriptionEndsAt as string).getTime() < Date.now() &&
          (subscriptionStatus === 'active' ||
            subscriptionStatus === 'trialing' ||
            subscriptionStatus === 'past_due'))));
  // Soft-hold session may still project active; allow export/offboard UI.
  const canWorkspaceLifecycle =
    canManage &&
    isPlatformAdmin &&
    !isStorefront &&
    (orgStatus === 'active' || softBillingHold);
  const [exportBusy, setExportBusy] = useState(false);
  const [offboardBusy, setOffboardBusy] = useState(false);
  const [offboardRequestedAt, setOffboardRequestedAt] = useState<string | null>(
    null
  );
  const { data, isLoading, isError } = useAdminCompanyProfileQuery(canView);
  const updateMutation = useUpdateCompanyProfileMutation();
  const logoMutation = useUploadCompanyLogoMutation();
  const clearLogoMutation = useClearCompanyLogoMutation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [backgroundBusy, setBackgroundBusy] = useState(false);

  const [form, setForm] = useState(emptyForm);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [hasBankAccount, setHasBankAccount] = useState(false);
  const [hasBankRoutingOrIban, setHasBankRoutingOrIban] = useState(false);
  const [bankLast4, setBankLast4] = useState<string | null>(null);
  const [completeness, setCompleteness] = useState(0);
  const [guideOpen, setGuideOpen] = useState(false);
  const [publicFields, setPublicFields] = useState({
    publicLogo: true,
    publicPhone: false,
    publicSupportEmail: false,
    publicWebsite: false,
    publicAddress: false,
  });
  const [originsText, setOriginsText] = useState('');
  const savedSlug = data?.organizationSlug ?? '';
  const dashboardOrigin = tenantDashboardOrigin(
    form.organizationSlug.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  );
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);
  const hydratedOrgIdRef = useRef<string | null>(null);
  const appliedPublicKeyRef = useRef<string | null>(null);
  const publicFieldsRef = useRef(publicFields);
  const originsTextRef = useRef(originsText);
  publicFieldsRef.current = publicFields;
  originsTextRef.current = originsText;

  const publicServerKey = data
    ? JSON.stringify({
        publicLogo: data.publicLogo !== false,
        publicPhone: data.publicPhone === true,
        publicSupportEmail: data.publicSupportEmail === true,
        publicWebsite: data.publicWebsite === true,
        publicAddress: data.publicAddress === true,
        embedOrigins: data.embedOrigins ?? [],
      })
    : '';

  useEffect(() => {
    if (!data) return;
    // Full form hydrate once per org. Later query updates (logo upload/clear,
    // background refetch) must not wipe in-progress edits.
    const firstOrg = hydratedOrgIdRef.current !== orgId;
    if (firstOrg) {
      hydratedOrgIdRef.current = orgId;
      setForm({
        organizationSlug: data.organizationSlug ?? '',
        legalName: data.legalName ?? '',
        tradingName: data.tradingName ?? '',
        supportEmail: data.supportEmail ?? '',
        billingEmail: data.billingEmail ?? '',
        replyToEmail: data.replyToEmail ?? '',
        phone: data.phone ?? '',
        website: data.website ?? '',
        addressLine1: data.addressLine1 ?? '',
        addressLine2: data.addressLine2 ?? '',
        city: data.city ?? '',
        state: data.state ?? '',
        country: data.country ?? '',
        postalCode: data.postalCode ?? '',
        taxId: data.taxId ?? '',
        bankName: data.bankName ?? '',
        bankAccountName: data.bankAccountName ?? '',
        bankAccountNumber: '',
        bankRoutingOrIban: '',
        bankCurrency: data.bankCurrency ?? '',
        invoiceFooterNote: data.invoiceFooterNote ?? '',
        receiptFooterNote: data.receiptFooterNote ?? '',
        letterheadColor: data.letterheadColor ?? '',
      });
    }
    const localPublicKey = JSON.stringify({
      ...publicFieldsRef.current,
      embedOrigins: originsTextRef.current
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    });
    const localUntouched =
      appliedPublicKeyRef.current == null ||
      localPublicKey === appliedPublicKeyRef.current;
    if (firstOrg || (publicServerKey !== appliedPublicKeyRef.current && localUntouched)) {
      setPublicFields({
        publicLogo: data.publicLogo !== false,
        publicPhone: data.publicPhone === true,
        publicSupportEmail: data.publicSupportEmail === true,
        publicWebsite: data.publicWebsite === true,
        publicAddress: data.publicAddress === true,
      });
      setOriginsText((data.embedOrigins ?? []).join('\n'));
      appliedPublicKeyRef.current = publicServerKey;
    }
    setLogoUrl(data.logoUrl);
    setHasBankAccount(data.hasBankAccount);
    setHasBankRoutingOrIban(Boolean(data.hasBankRoutingOrIban));
    setBankLast4(data.bankAccountLast4);
    setCompleteness(data.completeness);
  }, [data, orgId, publicServerKey]);

  useEffect(() => {
    if (!canWorkspaceLifecycle) {
      setOffboardRequestedAt(null);
      return;
    }
    let cancelled = false;
    void getAdminCompanyProfileWithLifecycle()
      .then((bundled) => {
        if (cancelled) return;
        setOffboardRequestedAt(
          bundled.workspaceLifecycle?.offboardRequestedAt ?? null
        );
      })
      .catch(() => {
        /* profile query already surfaces load errors */
      });
    return () => {
      cancelled = true;
    };
  }, [canWorkspaceLifecycle, orgId]);

  const setField = (key: keyof typeof emptyForm, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) {
      addToast('You do not have permission to save company profile', 'error');
      return;
    }
    try {
      const payload: Record<string, string | null | boolean> = {
        organizationSlug: form.organizationSlug.trim() || null,
        legalName: form.legalName.trim() || null,
        tradingName: form.tradingName.trim() || null,
        supportEmail: form.supportEmail.trim() || null,
        billingEmail: form.billingEmail.trim() || null,
        replyToEmail: form.replyToEmail.trim() || null,
        phone: form.phone.trim() || null,
        website: form.website.trim() || null,
        addressLine1: form.addressLine1.trim() || null,
        addressLine2: form.addressLine2.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        country: form.country.trim() || null,
        postalCode: form.postalCode.trim() || null,
        taxId: form.taxId.trim() || null,
        bankName: form.bankName.trim() || null,
        bankAccountName: form.bankAccountName.trim() || null,
        bankCurrency: form.bankCurrency.trim() || null,
        invoiceFooterNote: form.invoiceFooterNote.trim() || null,
        receiptFooterNote: form.receiptFooterNote.trim() || null,
        letterheadColor: form.letterheadColor.trim() || null,
      };
      // Account number + routing/IBAN are write-only on GET (always blank in the
      // form after hydrate). Omit blanks to keep ciphertext; never infer clearBank
      // from empty secrets — use the Clear bank control for that.
      if (form.bankRoutingOrIban.trim()) {
        payload.bankRoutingOrIban = form.bankRoutingOrIban.trim();
      }
      if (form.bankAccountNumber.trim()) {
        payload.bankAccountNumber = form.bankAccountNumber.trim();
      }
      const { profile, wrote } = await updateMutation.mutateAsync(payload);
      setCompleteness(profile.completeness);
      setHasBankAccount(profile.hasBankAccount);
      setHasBankRoutingOrIban(Boolean(profile.hasBankRoutingOrIban));
      setBankLast4(profile.bankAccountLast4);
      setForm((prev) => ({
        ...prev,
        organizationSlug: profile.organizationSlug ?? prev.organizationSlug,
        bankAccountNumber: '',
        bankRoutingOrIban: '',
      }));
      addToast(
        wrote
          ? 'Company profile saved. Invoices, receipts, and emails will use this brand.'
          : 'Company profile unchanged',
        'success'
      );
      // A renamed slug moves the dashboard; follow it instead of lingering on the old host.
      const hostSlug = tenantSlugFromHost(window.location.host);
      const nextSlug = profile.organizationSlug?.trim().toLowerCase() || '';
      if (hostSlug && nextSlug && nextSlug !== hostSlug) {
        const nextOrigin = tenantDashboardOrigin(nextSlug, {
          protocol: window.location.protocol,
          port: window.location.port,
        });
        if (nextOrigin) {
          window.location.assign(`${nextOrigin}${window.location.pathname}`);
        }
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to save company profile';
      addToast(message, 'error');
    }
  };

  const handleSavePublic = async () => {
    if (publicFieldsLocked) {
      addToast(
        'Public category switches and embed origins stay locked on the Demo plan',
        'error'
      );
      return;
    }
    if (!canManage) {
      addToast('You do not have permission to save company profile', 'error');
      return;
    }
    const embedOrigins = originsText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    try {
      const { profile } = await updateMutation.mutateAsync({
        ...publicFields,
        embedOrigins,
      });
      setPublicFields({
        publicLogo: profile.publicLogo !== false,
        publicPhone: profile.publicPhone === true,
        publicSupportEmail: profile.publicSupportEmail === true,
        publicWebsite: profile.publicWebsite === true,
        publicAddress: profile.publicAddress === true,
      });
      setOriginsText((profile.embedOrigins ?? []).join('\n'));
      appliedPublicKeyRef.current = JSON.stringify({
        publicLogo: profile.publicLogo !== false,
        publicPhone: profile.publicPhone === true,
        publicSupportEmail: profile.publicSupportEmail === true,
        publicWebsite: profile.publicWebsite === true,
        publicAddress: profile.publicAddress === true,
        embedOrigins: profile.embedOrigins ?? [],
      });
      addToast('Public page settings saved', 'success');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to save public page settings';
      addToast(message, 'error');
    }
  };

  const handleLogo = async (file: File | null) => {
    if (!file || !canManage) return;
    try {
      const profile = await logoMutation.mutateAsync(file);
      setLogoUrl(profile.logoUrl);
      setCompleteness(profile.completeness);
      addToast('Company logo updated', 'success');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to upload logo';
      addToast(message, 'error');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleClearLogo = async () => {
    if (!canManage) return;
    try {
      const profile = await clearLogoMutation.mutateAsync();
      setLogoUrl(profile.logoUrl);
      setCompleteness(profile.completeness);
      addToast('Company logo removed', 'success');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to remove logo';
      addToast(message, 'error');
    }
  };

  const handleClearBank = async () => {
    if (!canManage) return;
    try {
      const { profile, wrote } = await updateMutation.mutateAsync({
        clearBank: true,
      });
      setHasBankAccount(profile.hasBankAccount);
      setHasBankRoutingOrIban(Boolean(profile.hasBankRoutingOrIban));
      setBankLast4(profile.bankAccountLast4);
      setForm((prev) => ({
        ...prev,
        bankName: '',
        bankAccountName: '',
        bankAccountNumber: '',
        bankRoutingOrIban: '',
        bankCurrency: '',
      }));
      setCompleteness(profile.completeness);
      addToast(
        wrote
          ? 'Bank details cleared'
          : 'No bank details on file to clear',
        wrote ? 'success' : 'info'
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to clear bank details';
      addToast(message, 'error');
    }
  };

  const handleExportWorkspace = async () => {
    if (!canWorkspaceLifecycle) {
      addToast('Only the company platform admin can export this workspace', 'error');
      return;
    }
    if (exportBusy || offboardBusy) return;
    setExportBusy(true);
    try {
      const payload = await downloadCompanyWorkspaceExport();
      saveWorkspaceExportFile(payload);
      addToast('Workspace export downloaded (redacted JSON)', 'success');
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Failed to export workspace',
        'error'
      );
    } finally {
      setExportBusy(false);
    }
  };

  const handleRequestOffboard = async () => {
    if (!canWorkspaceLifecycle) {
      addToast(
        'Only the company platform admin can request workspace offboard',
        'error'
      );
      return;
    }
    if (exportBusy || offboardBusy || offboardRequestedAt) return;
    setOffboardBusy(true);
    const confirmed = window.confirm(
      'Request workspace offboard? This notifies FECSYNC ops. Orders, payments, and users are not deleted. Download an export first if you need a copy of your data.'
    );
    if (!confirmed) {
      setOffboardBusy(false);
      return;
    }
    try {
      const result = await requestCompanyWorkspaceOffboard();
      setOffboardRequestedAt(result.offboardRequestedAt);
      void queryClient.invalidateQueries({ queryKey: companyProfileKeys.all });
      // FECSYNC dashboard offboard card — best-effort (company admin may lack access).
      void queryClient.invalidateQueries({
        queryKey: ['registered-companies-metrics'],
      });
      addToast(
        'Offboard requested — FECSYNC ops will follow up. No data was deleted.',
        'success'
      );
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Failed to request offboard',
        'error'
      );
    } finally {
      setOffboardBusy(false);
    }
  };

  if (orgStatus === 'pending' || (orgStatus === 'suspended' && !softBillingHold)) {
    const pending = orgStatus === 'pending';
    const opsHold =
      orgStatus === 'suspended' &&
      (subscriptionStatus || '').trim().toLowerCase() === 'ops_hold';
    return (
      <div className="max-w-3xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Company profile</h1>
          <p className="text-sm text-gray-600 mt-2">
            Legal identity and brand used on invoices, receipts, order emails, and
            printed documents for your company backend.
          </p>
        </div>
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            pending
              ? 'border-amber-200 bg-amber-50 text-amber-900'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {pending
            ? 'Your company is pending FECSYNC approval. Profile editing unlocks after approval.'
            : opsHold
              ? 'Your company is on an ops hold. Profile editing, export, and offboard are locked — contact the developers or IT team. Workspace records are kept.'
              : 'Your company is suspended for billing. Profile editing is locked until FECSYNC Approve or Set plan reactivates the organization.'}
        </div>
      </div>
    );
  }

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="w-10 h-10 border-4 border-[#D4AF37] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isError && !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Could not load company profile. Please refresh and try again.
      </div>
    );
  }

  const formDisabled =
    !canManage ||
    softBillingHold ||
    updateMutation.isPending ||
    logoMutation.isPending ||
    clearLogoMutation.isPending ||
    backgroundBusy;

  return (
    <div className="max-w-3xl">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Company profile</h1>
          <p className="text-sm text-gray-600 mt-2">
            Legal identity and brand for invoices, receipts, order emails, and
            printed documents. Open the guide if you are doing this for the
            first time.
          </p>
        </div>
        <AdminHowToGuideButton onClick={() => setGuideOpen(true)} />
      </div>

      <AdminHowToGuideModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="Company profile"
        subtitle="Follow these steps in order — written for first-time admins."
        steps={COMPANY_PROFILE_GUIDE_STEPS}
      />

      <div className="mb-6 rounded-2xl border border-gray-100 bg-white p-5">
        <div className="flex items-center justify-between gap-4 mb-2">
          <p className="text-sm font-semibold text-gray-900">Profile completeness</p>
          <p className="text-sm font-bold text-gray-900">{completeness}%</p>
        </div>
        <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full rounded-full bg-[#D4AF37] transition-all"
            style={{ width: `${completeness}%` }}
          />
        </div>
        {completeness < 60 && (
          <p className="mt-2 text-xs text-amber-700">
            Add legal name, logo, support email, address, and bank details so
            customer documents look complete.
          </p>
        )}
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <section className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-900">Identity</h2>
          <div className="flex flex-col sm:flex-row gap-4 items-start">
            <div className="w-24 h-24 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden shrink-0">
              {logoUrl ? (
                <Image
                  src={logoUrl}
                  alt="Company logo"
                  width={96}
                  height={96}
                  className="object-contain w-full h-full"
                  unoptimized
                />
              ) : (
                <span className="text-xs text-gray-400">No logo</span>
              )}
            </div>
            <div className="space-y-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => handleLogo(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                disabled={formDisabled || logoMutation.isPending || clearLogoMutation.isPending}
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-800 hover:border-[#D4AF37]/50 disabled:opacity-60"
              >
                {logoMutation.isPending ? <ButtonSpinner /> : null}
                Upload logo
              </button>
              {logoUrl ? (
                <button
                  type="button"
                  disabled={formDisabled || clearLogoMutation.isPending || logoMutation.isPending}
                  onClick={handleClearLogo}
                  className="ml-2 inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 hover:border-red-200 hover:text-red-700 disabled:opacity-60"
                >
                  {clearLogoMutation.isPending ? <ButtonSpinner /> : null}
                  Remove logo
                </button>
              ) : null}
              <p className="text-xs text-gray-500">JPEG, PNG, or WebP · max 5MB</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              id="legalName"
              label="Legal name"
              value={form.legalName}
              disabled={formDisabled}
              onChange={(v) => setField('legalName', v)}
            />
            <Field
              id="tradingName"
              label="Trading name"
              value={form.tradingName}
              disabled={formDisabled}
              onChange={(v) => setField('tradingName', v)}
            />
          </div>
          <div>
            <Field
              id="organizationSlug"
              label="Workspace slug"
              value={form.organizationSlug}
              disabled={formDisabled || isStorefront}
              onChange={(v) => setField('organizationSlug', v)}
              placeholder="acme-parks"
            />
            <p className="mt-1 text-xs text-gray-500">
              Unique lowercase key for this company. Generated on create; you can
              change it anytime (must stay unique across companies).
            </p>
            {!isStorefront && dashboardOrigin ? (
              <p className="mt-1 text-xs text-gray-700">
                Your dashboard address:{' '}
                <span className="font-medium text-gray-900 break-all">
                  {dashboardOrigin.replace(/^https?:\/\//, '')}
                </span>
                {form.organizationSlug.trim() !== savedSlug ? (
                  <span className="text-gray-500"> (after you save)</span>
                ) : null}
              </p>
            ) : null}
            {!isStorefront ? <CompanyLoginLink slug={savedSlug} variant="inline" /> : null}
          </div>
        </section>

        {!isStorefront ? (
          <SigninBackgroundSection
            backgroundUrl={data?.signinBackgroundUrl ?? null}
            logoUrl={logoUrl}
            showLogo={data?.publicLogo !== false}
            name={
              form.tradingName.trim() ||
              form.legalName.trim() ||
              data?.displayName ||
              ''
            }
            accentColor={form.letterheadColor.trim() || null}
            slug={savedSlug}
            disabled={
              !canManage ||
              softBillingHold ||
              updateMutation.isPending ||
              logoMutation.isPending ||
              clearLogoMutation.isPending
            }
            onBusyChange={setBackgroundBusy}
          />
        ) : null}

        <section className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-900">Contact</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              id="supportEmail"
              label="Support email"
              type="email"
              value={form.supportEmail}
              disabled={formDisabled}
              onChange={(v) => setField('supportEmail', v)}
            />
            <Field
              id="billingEmail"
              label="Billing email"
              type="email"
              value={form.billingEmail}
              disabled={formDisabled}
              onChange={(v) => setField('billingEmail', v)}
            />
            <Field
              id="replyToEmail"
              label="Reply-to email"
              type="email"
              value={form.replyToEmail}
              disabled={formDisabled}
              onChange={(v) => setField('replyToEmail', v)}
            />
            <Field
              id="phone"
              label="Phone"
              value={form.phone}
              disabled={formDisabled}
              onChange={(v) => setField('phone', v)}
            />
            <Field
              id="website"
              label="Website"
              value={form.website}
              disabled={formDisabled}
              onChange={(v) => setField('website', v)}
              placeholder="https://"
            />
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-900">Address</h2>
          <Field
            id="addressLine1"
            label="Address line 1"
            value={form.addressLine1}
            disabled={formDisabled}
            onChange={(v) => setField('addressLine1', v)}
          />
          <Field
            id="addressLine2"
            label="Address line 2"
            value={form.addressLine2}
            disabled={formDisabled}
            onChange={(v) => setField('addressLine2', v)}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              id="city"
              label="City"
              value={form.city}
              disabled={formDisabled}
              onChange={(v) => setField('city', v)}
            />
            <Field
              id="state"
              label="State / region"
              value={form.state}
              disabled={formDisabled}
              onChange={(v) => setField('state', v)}
            />
            <Field
              id="country"
              label="Country"
              value={form.country}
              disabled={formDisabled}
              onChange={(v) => setField('country', v)}
            />
            <Field
              id="postalCode"
              label="Postal code"
              value={form.postalCode}
              disabled={formDisabled}
              onChange={(v) => setField('postalCode', v)}
            />
          </div>
          <Field
            id="taxId"
            label="Tax ID (VAT / TIN)"
            value={form.taxId}
            disabled={formDisabled}
            onChange={(v) => setField('taxId', v)}
          />
        </section>

        <section className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Bank details</h2>
              <p className="text-xs text-gray-500 mt-1">
                Invoice and document display only — these fields do not move live
                card payouts. Full account numbers are encrypted; documents show
                last 4 digits only.
                {hasBankAccount && bankLast4
                  ? ` On file: •••• ${bankLast4}`
                  : ''}{' '}
                To receive online booking payments, complete{' '}
                <Link
                  href="/admin/payouts"
                  className="font-semibold text-stone-800 underline-offset-2 hover:underline"
                >
                  Payouts
                </Link>{' '}
                (Stripe Connect).
              </p>
            </div>
            {hasBankAccount && (
              <button
                type="button"
                disabled={formDisabled}
                onClick={handleClearBank}
                className="text-xs font-medium text-red-600 hover:underline disabled:opacity-60"
              >
                Clear bank
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              id="bankName"
              label="Bank name"
              value={form.bankName}
              disabled={formDisabled}
              onChange={(v) => setField('bankName', v)}
            />
            <Field
              id="bankAccountName"
              label="Account name"
              value={form.bankAccountName}
              disabled={formDisabled}
              onChange={(v) => setField('bankAccountName', v)}
            />
            <Field
              id="bankAccountNumber"
              label={
                hasBankAccount
                  ? 'New account number (leave blank to keep)'
                  : 'Account number'
              }
              value={form.bankAccountNumber}
              disabled={formDisabled}
              onChange={(v) => setField('bankAccountNumber', v)}
              autoComplete="off"
            />
            <Field
              id="bankRoutingOrIban"
              label={
                hasBankRoutingOrIban
                  ? 'New routing / IBAN (leave blank to keep)'
                  : 'Routing / IBAN'
              }
              value={form.bankRoutingOrIban}
              disabled={formDisabled}
              onChange={(v) => setField('bankRoutingOrIban', v)}
              autoComplete="off"
            />
            <Field
              id="bankCurrency"
              label="Currency"
              value={form.bankCurrency}
              disabled={formDisabled}
              onChange={(v) => setField('bankCurrency', v)}
              placeholder="NGN, USD, GBP…"
            />
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-900">Document footers</h2>
          <div>
            <label
              htmlFor="invoiceFooterNote"
              className="block text-sm font-medium text-gray-700 mb-1.5"
            >
              Invoice footer note
            </label>
            <textarea
              id="invoiceFooterNote"
              rows={3}
              value={form.invoiceFooterNote}
              disabled={formDisabled}
              onChange={(e) => setField('invoiceFooterNote', e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40 focus:border-[#D4AF37] disabled:opacity-60"
            />
          </div>
          <div>
            <label
              htmlFor="receiptFooterNote"
              className="block text-sm font-medium text-gray-700 mb-1.5"
            >
              Receipt footer note
            </label>
            <textarea
              id="receiptFooterNote"
              rows={3}
              value={form.receiptFooterNote}
              disabled={formDisabled}
              onChange={(e) => setField('receiptFooterNote', e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40 focus:border-[#D4AF37] disabled:opacity-60"
            />
          </div>
          <Field
            id="letterheadColor"
            label="Brand color (hex) — invoices, receipts, and your staff sign-in page"
            value={form.letterheadColor}
            disabled={formDisabled}
            onChange={(v) => setField('letterheadColor', v)}
            placeholder="#D4AF37"
          />
        </section>

        <section className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-900">
            Public category pages
          </h2>
          <p className="text-sm text-gray-600">
            Trading name is always shown. Choose which other company facts
            appear on a public category page, and which https websites may
            frame the embed.
          </p>
          {publicFieldsLocked ? (
            <p className="text-sm text-amber-900">
              These switches and embed origins stay locked on the Demo plan.
              Upgrade in Billing to save them. The rest of this profile can
              still be saved.
            </p>
          ) : null}
          <div className="space-y-2">
            {(
              [
                ['publicLogo', 'Show logo'],
                ['publicPhone', 'Show phone'],
                ['publicSupportEmail', 'Show support email'],
                ['publicWebsite', 'Show website'],
                ['publicAddress', 'Show address'],
              ] as const
            ).map(([key, label]) => (
              <label
                key={key}
                className="flex items-center gap-2 text-sm text-gray-800"
              >
                <input
                  type="checkbox"
                  checked={publicFields[key]}
                  disabled={formDisabled || publicFieldsLocked}
                  onChange={(e) =>
                    setPublicFields((prev) => ({
                      ...prev,
                      [key]: e.target.checked,
                    }))
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <div>
            <label
              htmlFor="embedOrigins"
              className="block text-sm font-medium text-gray-700 mb-1.5"
            >
              Embed origins
            </label>
            <textarea
              id="embedOrigins"
              rows={4}
              value={originsText}
              disabled={formDisabled || publicFieldsLocked}
              onChange={(e) => setOriginsText(e.target.value)}
              placeholder={'https://example.com\nhttps://booking.example.com'}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40 focus:border-[#D4AF37] disabled:opacity-60"
            />
            <p className="mt-1 text-xs text-gray-500">
              One https origin per line. No path and no wildcard. The Website
              above is also allowed when it starts with https://.
            </p>
          </div>
          <button
            type="button"
            disabled={formDisabled || publicFieldsLocked}
            onClick={() => void handleSavePublic()}
            className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-stone-950 disabled:opacity-60"
          >
            {updateMutation.isPending ? <ButtonSpinner /> : null}
            Save public fields
          </button>
        </section>

        {canWorkspaceLifecycle ? (
          <section className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
            <h2 className="text-sm font-semibold text-gray-900">
              Workspace export &amp; offboard
            </h2>
            <p className="text-sm text-gray-600">
              Download a redacted JSON export, or request soft offboard (no
              hard-delete). See the guide for what is included.
            </p>
            {softBillingHold ? (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                Billing is on soft-hold — profile edits are locked. You can still
                export your workspace or request offboard. Contact FECSYNC to
                reactivate full admin tools.
              </p>
            ) : null}
            {offboardRequestedAt ? (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                Offboard requested{' '}
                {new Date(offboardRequestedAt).toLocaleString()}. FECSYNC ops will
                follow up.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={exportBusy || offboardBusy}
                onClick={() => void handleExportWorkspace()}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-60"
              >
                {exportBusy ? <ButtonSpinner /> : null}
                Download workspace export
              </button>
              <button
                type="button"
                disabled={exportBusy || offboardBusy || Boolean(offboardRequestedAt)}
                onClick={() => void handleRequestOffboard()}
                className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-800 hover:bg-red-100 disabled:opacity-60"
              >
                {offboardBusy ? <ButtonSpinner /> : null}
                Request offboard
              </button>
            </div>
          </section>
        ) : null}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={formDisabled}
            className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-5 py-2.5 text-sm font-semibold text-black hover:brightness-95 disabled:opacity-60"
          >
            {updateMutation.isPending ? <ButtonSpinner /> : null}
            Save company profile
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  disabled,
  type = 'text',
  placeholder,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1.5">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40 focus:border-[#D4AF37] disabled:opacity-60"
      />
    </div>
  );
}
