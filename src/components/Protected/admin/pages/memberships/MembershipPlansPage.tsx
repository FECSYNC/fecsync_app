'use client';

import { FormEvent, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import AdminPendingLink from '@/components/Protected/admin/components/AdminPendingLink';
import { useToast } from '@/contexts/toast-context';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import AdminRouteLoading from '@/components/Protected/admin/components/AdminRouteLoading';
import { AdminHowToGuideButton } from '@/components/Protected/admin/components/AdminHowToGuideButton';
import { DeferredMembershipsGuideModal } from '@/components/Protected/admin/pages/memberships/DeferredMembershipsGuideModal';
import { MEMBERSHIPS_PLANS_GUIDE_STEPS } from '@/components/Protected/admin/pages/memberships/membershipsGuides';
import {
  btnPrimaryClass,
  fieldClass,
} from '@/components/Protected/admin/pages/ticketing/ticketingUi';
import { ADMIN_LIST_STALE_MS } from '@/lib/adminListCache';
import { ADMIN_MEMBERSHIPS_MODAL_LIVE_MS } from '@/utils/adminLiveRefresh';
import {
  archiveMembershipPlan,
  createMembershipPlan,
  listAttachableForms,
  listMembershipPlans,
  membershipKeys,
  updateMembershipPlan,
  type MembershipPlanDto,
} from '@/services/memberships';
import type { MembershipPlanVariation } from '@/lib/memberships/types';
import { uploadCatalogImages } from '@/services/upload';
import { notifyMembershipChange } from '@/lib/membershipsSync';
import { useMembershipPlanModalLive } from '@/hooks/useMembershipPlanModalLive';
import MembershipProductMultiSelect, {
  membershipPickerTicketsKey,
  prefetchMembershipPlanProductPicker,
} from '@/components/Protected/admin/pages/memberships/MembershipProductMultiSelect';
import type { AdmissionProductDto } from '@/services/ticketing';
import MembershipFormMultiSelect, {
  prefetchMembershipPlanFormPicker,
} from '@/components/Protected/admin/pages/memberships/MembershipFormMultiSelect';
import MembershipReportingCategoryField from '@/components/Protected/admin/pages/memberships/MembershipReportingCategoryField';
import MembershipOverrideTaxField from '@/components/Protected/admin/pages/memberships/MembershipOverrideTaxField';
import MembershipWaiverField, {
  WAIVER_SETTINGS_HREF,
} from '@/components/Protected/admin/pages/memberships/MembershipWaiverField';
import MembershipAlternateAddressFields from '@/components/Protected/admin/pages/memberships/MembershipAlternateAddressFields';
import MembershipCancellationTermsEditor from '@/components/Protected/admin/pages/memberships/MembershipCancellationTermsEditor';
import MembershipInstructionsEditor from '@/components/Protected/admin/pages/memberships/MembershipInstructionsEditor';
import MembershipTermsEditor from '@/components/Protected/admin/pages/memberships/MembershipTermsEditor';
import {
  EMPTY_ALTERNATE_ADDRESS,
  formatAlternateAddressPreview,
  parseAlternateAddress,
  serializeAlternateAddress,
  validateAlternateAddress,
  type AlternateAddressDetails,
} from '@/lib/memberships/alternateAddress';
import {
  listAdminVenueLocations,
  venueLocationKeys,
} from '@/services/venueLocations';
import {
  listParkMarketplaceAccounts,
  marketplaceKeys,
} from '@/services/marketplace';
import { isStorefrontOrgSession } from '@/services/auth';
import {
  CANCELLATION_TERMS_PLAIN_MAX,
  INSTRUCTIONS_PLAIN_MAX,
  TERMS_AND_CONDITIONS_PLAIN_MAX,
  htmlToPlainText,
  isEmptyMembershipHtml,
  sanitizeCancellationTermsForWrite,
  sanitizeInstructionsForWrite,
  sanitizeTermsAndConditionsForWrite,
  toMembershipRichTextEditorHtml,
} from '@/lib/memberships/richText';
import {
  normalizeReportingCategory,
  sanitizeReportingCategoryForWrite,
} from '@/lib/memberships/reportingCategory';

type FormState = {
  name: string;
  description: string;
  categoryId: string;
  detailedDescription: string;
  enableDetailedDescription: boolean;
  physicalPassMessage: string;
  enablePhysicalPassMessage: boolean;
  imageUrl: string;
  enableImage: boolean;
  tagsInput: string;
  membershipType: 'single' | 'group';
  variations: MembershipPlanVariation[];
  currency: string;
  entriesPerPeriod: string;
  discountPercent: string;
  guestCount: string;
  perkFlags: string;
  freeProductRefs: string;
  addOnProductIds: string[];
  upgradeGroupKey: string;
  pauseAllowed: boolean;
  daysValidFromPurchase: string;
  daysValidFromRedemption: string;
  redemptionStartsAt: string;
  redemptionEndsAt: string;
  enableCustomRedemptionDescription: boolean;
  customRedemptionDescription: string;
  salesStartsAt: string;
  salesEndsAt: string;
  addOnsEnabled: boolean;
  enableAlternateAddress: boolean;
  alternateAddressDetails: AlternateAddressDetails;
  agreementRequired: boolean;
  enableCancellationTerms: boolean;
  cancellationTerms: string;
  formsEnabled: boolean;
  formIds: string[];
  hideFromOnlineSales: boolean;
  enableInstructions: boolean;
  instructions: string;
  enableReportingCategory: boolean;
  reportingCategory: string;
  overrideTax: boolean;
  /** `default` follows Tax Settings. `0` is no tax. */
  overrideTaxChoice: string;
  enableTerms: boolean;
  termsAndConditions: string;
  ticketHolderCaptured: boolean;
  customTicketIdCaptured: boolean;
  waiverRequired: boolean;
};

function emptyVariation(name = ''): MembershipPlanVariation {
  return {
    name,
    sell: true,
    price: '',
    frequency: 'one_time',
    payments: null,
    intervalCount: 1,
    intervalUnit: 'month',
  };
}

const emptyForm = (): FormState => ({
  name: '',
  description: '',
  categoryId: '',
  detailedDescription: '',
  enableDetailedDescription: false,
  physicalPassMessage: '',
  enablePhysicalPassMessage: false,
  imageUrl: '',
  enableImage: false,
  tagsInput: '',
  membershipType: 'single',
  variations: [emptyVariation()],
  currency: 'USD',
  entriesPerPeriod: '',
  discountPercent: '',
  guestCount: '',
  perkFlags: '',
  freeProductRefs: '',
  addOnProductIds: [],
  upgradeGroupKey: '',
  pauseAllowed: true,
  daysValidFromPurchase: '',
  daysValidFromRedemption: '',
  redemptionStartsAt: '',
  redemptionEndsAt: '',
  enableCustomRedemptionDescription: false,
  customRedemptionDescription: '',
  salesStartsAt: '',
  salesEndsAt: '',
  addOnsEnabled: false,
  enableAlternateAddress: false,
  alternateAddressDetails: EMPTY_ALTERNATE_ADDRESS(),
  agreementRequired: false,
  enableCancellationTerms: false,
  cancellationTerms: '',
  formsEnabled: false,
  formIds: [],
  hideFromOnlineSales: false,
  enableInstructions: false,
  instructions: '',
  enableReportingCategory: false,
  reportingCategory: '',
  overrideTax: false,
  overrideTaxChoice: 'default',
  enableTerms: false,
  termsAndConditions: '',
  ticketHolderCaptured: false,
  customTicketIdCaptured: false,
  waiverRequired: false,
});

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(value: string): string | null {
  if (!value.trim()) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function planToForm(plan: MembershipPlanDto): FormState {
  const e = plan.entitlements ?? {};
  const variations =
    plan.variations?.length > 0
      ? plan.variations
      : [
          {
            name: plan.name,
            sell: true,
            price: plan.price,
            frequency:
              plan.billing === 'recurring'
                ? ('recurring' as const)
                : ('one_time' as const),
            payments: null,
            intervalCount: plan.intervalCount ?? 1,
            intervalUnit: plan.intervalUnit ?? 'month',
          },
        ];
  return {
    name: plan.name,
    description: plan.description ?? '',
    categoryId: plan.categoryId ?? '',
    detailedDescription: plan.detailedDescription ?? '',
    enableDetailedDescription: Boolean(plan.detailedDescription),
    physicalPassMessage: plan.physicalPassMessage ?? '',
    enablePhysicalPassMessage: Boolean(plan.physicalPassMessage),
    imageUrl: plan.imageUrl ?? '',
    enableImage: Boolean(plan.imageUrl),
    tagsInput: (plan.tags ?? []).join(', '),
    membershipType: plan.membershipType ?? (plan.familyAllowed ? 'group' : 'single'),
    variations,
    currency: plan.currency,
    entriesPerPeriod:
      e.entriesPerPeriod != null ? String(e.entriesPerPeriod) : '',
    discountPercent: e.discountPercent != null ? String(e.discountPercent) : '',
    guestCount: e.guestCount != null ? String(e.guestCount) : '',
    perkFlags: Array.isArray(e.perkFlags) ? e.perkFlags.join(', ') : '',
    freeProductRefs: Array.isArray(e.freeProductRefs)
      ? e.freeProductRefs.join(', ')
      : '',
    addOnProductIds: Array.isArray(e.addOnProductIds)
      ? e.addOnProductIds.filter((x): x is string => typeof x === 'string')
      : [],
    upgradeGroupKey: plan.upgradeGroupKey ?? '',
    pauseAllowed: plan.pauseAllowed,
    daysValidFromPurchase:
      plan.daysValidFromPurchase != null
        ? String(plan.daysValidFromPurchase)
        : '',
    daysValidFromRedemption:
      plan.daysValidFromRedemption != null
        ? String(plan.daysValidFromRedemption)
        : '',
    redemptionStartsAt: toLocalInput(plan.redemptionStartsAt),
    redemptionEndsAt: toLocalInput(plan.redemptionEndsAt),
    enableCustomRedemptionDescription: Boolean(
      plan.customRedemptionDescription
    ),
    customRedemptionDescription: plan.customRedemptionDescription ?? '',
    salesStartsAt: toLocalInput(plan.salesStartsAt),
    salesEndsAt: toLocalInput(plan.salesEndsAt),
    addOnsEnabled: plan.addOnsEnabled,
    enableAlternateAddress: Boolean(plan.alternateAddress),
    alternateAddressDetails: parseAlternateAddress(plan.alternateAddress),
    agreementRequired: plan.agreementRequired,
    enableCancellationTerms: !isEmptyMembershipHtml(plan.cancellationTerms),
    cancellationTerms: toMembershipRichTextEditorHtml(plan.cancellationTerms),
    formsEnabled: plan.formsEnabled,
    formIds: Array.isArray(e.formIds)
      ? e.formIds.filter((x): x is string => typeof x === 'string')
      : Array.isArray(e.attachedForms)
        ? e.attachedForms
            .map((row) =>
              row && typeof row === 'object' && typeof row.id === 'string'
                ? row.id
                : ''
            )
            .filter(Boolean)
        : [],
    hideFromOnlineSales: plan.hideFromOnlineSales,
    enableInstructions: !isEmptyMembershipHtml(plan.instructions),
    instructions: toMembershipRichTextEditorHtml(plan.instructions),
    enableReportingCategory: Boolean(plan.reportingCategory),
    reportingCategory: plan.reportingCategory ?? '',
    overrideTax: plan.overrideTax,
    overrideTaxChoice: (() => {
      const rate = e.overrideTaxRate;
      if (!plan.overrideTax || rate == null || rate === '') return 'default';
      const n = Number(rate);
      if (!Number.isFinite(n) || n < 0) return 'default';
      if (n === 0) return '0';
      return String(Math.round(n * 100) / 100);
    })(),
    enableTerms: !isEmptyMembershipHtml(plan.termsAndConditions),
    termsAndConditions: toMembershipRichTextEditorHtml(plan.termsAndConditions),
    ticketHolderCaptured: e.ticketHolderCaptured === true,
    customTicketIdCaptured: e.customTicketIdCaptured === true,
    waiverRequired: e.waiverRequired === true,
  };
}

function sectionTitle(title: string, hint?: string) {
  return (
    <div className="border-b border-stone-200 pb-2">
      <h3 className="text-base font-semibold text-stone-900">{title}</h3>
      {hint ? <p className="mt-0.5 text-xs text-stone-500">{hint}</p> : null}
    </div>
  );
}

function optionRow(props: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description: ReactNode;
  children?: ReactNode;
  locked?: boolean;
  /** Show “linked” badge without disabling the control. */
  showLinked?: boolean;
}) {
  return (
    <div className="border-b border-stone-100 py-3 last:border-b-0">
      <label className="flex cursor-pointer gap-3">
        <input
          type="checkbox"
          className="mt-1"
          checked={props.checked}
          disabled={props.locked}
          onChange={(e) => props.onChange(e.target.checked)}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-sm font-medium text-stone-800">
            {props.label}
            {props.locked || props.showLinked ? (
              <span className="text-[10px] uppercase tracking-wide text-stone-400">
                linked
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block text-xs text-stone-500">
            {props.description}
          </span>
        </span>
      </label>
      {props.checked && props.children ? (
        <div className="mt-2 pl-7">{props.children}</div>
      ) : null}
    </div>
  );
}

export default function MembershipPlansPage() {
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);
  const hasHydratedAuth = useAuthStore((s) => s.hasHydratedAuth);
  const canWrite = can(P.MembershipsWrite) || can(P.MembershipsAdmin);
  const canRead = can(P.MembershipsRead) || canWrite;
  const canUpload = can(P.UploadsWrite);
  const canReadPayouts = can(P.PayoutsRead);
  const storefront = isStorefrontOrgSession(user);
  const qc = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<MembershipPlanDto | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [guideOpen, setGuideOpen] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [staleRemotePlan, setStaleRemotePlan] = useState(false);

  const plansQuery = useQuery({
    queryKey: membershipKeys.plans(showArchived),
    queryFn: () => listMembershipPlans({ includeArchived: showArchived }),
    enabled: hasHydratedAuth && canRead,
    staleTime: modalOpen ? 0 : ADMIN_LIST_STALE_MS,
    placeholderData: (prev) => prev,
    refetchInterval: modalOpen ? ADMIN_MEMBERSHIPS_MODAL_LIVE_MS : false,
    refetchIntervalInBackground: false,
  });

  const parkAccountsQuery = useQuery({
    queryKey: marketplaceKeys.parkAccounts(),
    queryFn: listParkMarketplaceAccounts,
    enabled: hasHydratedAuth && canReadPayouts && !storefront,
    staleTime: 60_000,
  });

  const live = useMembershipPlanModalLive({
    enabled: hasHydratedAuth,
    modalOpen,
    canRead,
  });

  useEffect(() => {
    if (!plansQuery.isError) return;
    const err = plansQuery.error;
    const msg =
      err instanceof Error ? err.message : 'Failed to load membership plans';
    addToast(msg, 'error');
  }, [plansQuery.isError, plansQuery.error, addToast]);

  // Warm Add-ons picker as soon as Plans is open so the first modal paint is instant.
  useEffect(() => {
    if (!canRead) return;
    prefetchMembershipPlanProductPicker(qc);
  }, [canRead, qc]);

  useEffect(() => {
    if (!modalOpen) return;
    // Warm Online Booking + plans + forms + venues (Alternate address copy).
    prefetchMembershipPlanProductPicker(qc);
    prefetchMembershipPlanFormPicker(qc);
    void qc.prefetchQuery({
      queryKey: venueLocationKeys.list('all'),
      queryFn: () => listAdminVenueLocations({ scope: 'all' }),
      staleTime: ADMIN_LIST_STALE_MS,
    });
  }, [modalOpen, qc]);

  // Create mode: keep pause / agreement linked to Memberships → Settings in realtime.
  useEffect(() => {
    if (!modalOpen || editing || !live.settings) return;
    setForm((f) => {
      let next = f;
      if (live.liveSettingsLink.pauseAllowed) {
        next = { ...next, pauseAllowed: live.settings!.allowPause };
      }
      if (live.liveSettingsLink.agreementRequired) {
        next = {
          ...next,
          agreementRequired: live.settings!.requireAgreementBeforeActive,
        };
      }
      return next;
    });
  }, [
    modalOpen,
    editing,
    live.settings,
    live.liveSettingsLink.pauseAllowed,
    live.liveSettingsLink.agreementRequired,
  ]);

  // Concurrent edit: another tab/session updated this plan while the modal is open.
  useEffect(() => {
    if (!modalOpen || !editing) {
      setStaleRemotePlan(false);
      return;
    }
    const remote =
      live.plans.find((p) => p.id === editing.id) ??
      (plansQuery.data ?? []).find((p) => p.id === editing.id);
    if (!remote) return;
    if (remote.updatedAt !== editing.updatedAt) {
      setStaleRemotePlan(true);
    }
  }, [modalOpen, editing, live.plans, plansQuery.data]);

  const selectedFreeProductIds = useMemo(() => {
    return new Set(
      form.freeProductRefs
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    );
  }, [form.freeProductRefs]);

  const orphanFreeProductRefs = useMemo(() => {
    const known = new Set(live.products.map((p) => p.id));
    return Array.from(selectedFreeProductIds).filter((id) => !known.has(id));
  }, [selectedFreeProductIds, live.products]);

  function toggleFreeProductRef(id: string) {
    setForm((f) => {
      const set = new Set(
        f.freeProductRefs
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      );
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...f, freeProductRefs: Array.from(set).join(', ') };
    });
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const entitlements: Record<string, unknown> = {};
      if (form.entriesPerPeriod.trim()) {
        entitlements.entriesPerPeriod = Number(form.entriesPerPeriod);
      }
      if (form.discountPercent.trim()) {
        entitlements.discountPercent = Number(form.discountPercent);
      }
      if (form.guestCount.trim()) {
        entitlements.guestCount = Number(form.guestCount);
      }
      if (form.perkFlags.trim()) {
        entitlements.perkFlags = form.perkFlags
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
      if (form.freeProductRefs.trim()) {
        entitlements.freeProductRefs = form.freeProductRefs
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
      // When the ticket catalog is cached, drop archived / unknown refs so save
      // is not rejected. If TicketingRead is denied (no cache), keep ids and let
      // the API validate.
      const pickerTickets = qc.getQueryData<AdmissionProductDto[]>(
        membershipPickerTicketsKey()
      );
      const pickerPlans =
        qc.getQueryData<MembershipPlanDto[]>(membershipKeys.plans(false)) ??
        [];
      let cleanedAddOns = form.addOnsEnabled ? [...form.addOnProductIds] : [];
      if (form.addOnsEnabled && pickerTickets !== undefined) {
        const knownAddOnIds = new Set<string>([
          ...pickerTickets
            .filter((p) => !p.archivedAt)
            .map((p) => p.id),
          ...pickerPlans
            .filter((p) => !p.archivedAt && p.id !== editing?.id)
            .map((p) => `membership:${p.id}`),
        ]);
        cleanedAddOns = cleanedAddOns.filter((id) => knownAddOnIds.has(id));
      }
      entitlements.addOnProductIds = cleanedAddOns;
      const addOnsEnabled = Boolean(
        form.addOnsEnabled && cleanedAddOns.length > 0
      );
      let formsEnabled = form.formsEnabled;
      let cleanedFormIds = form.formsEnabled ? [...form.formIds] : [];
      if (form.formsEnabled) {
        let catalog =
          qc.getQueryData<{ id: string; name: string }[]>(
            membershipKeys.attachableForms()
          ) ?? [];
        if (!catalog.length) {
          catalog = await listAttachableForms();
        }
        const known = new Set(catalog.map((f) => f.id));
        // Only prune when catalog loaded; otherwise let the API validate.
        if (catalog.length) {
          cleanedFormIds = cleanedFormIds.filter((id) => known.has(id));
        }
        formsEnabled = cleanedFormIds.length > 0;
        entitlements.formIds = cleanedFormIds;
        const byId = new Map(catalog.map((f) => [f.id, f.name]));
        entitlements.attachedForms = cleanedFormIds.map((id) => ({
          id,
          name: byId.get(id) ?? id,
        }));
      } else {
        entitlements.formIds = [];
        entitlements.attachedForms = [];
      }
      if (form.overrideTax && form.overrideTaxChoice !== 'default') {
        const rate = Number(form.overrideTaxChoice);
        if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
          throw new Error('Override tax rate must be between 0 and 100');
        }
        entitlements.overrideTaxRate = Math.round(rate * 100) / 100;
      } else {
        // null = follow Tax Settings when override is on with "default",
        // or when override is off entirely.
        entitlements.overrideTaxRate = null;
      }
      entitlements.ticketHolderCaptured = form.ticketHolderCaptured;
      entitlements.customTicketIdCaptured = form.customTicketIdCaptured;
      entitlements.waiverRequired = form.waiverRequired;

      let alternateAddress: string | null = null;
      if (form.enableAlternateAddress) {
        const addrErr = validateAlternateAddress(form.alternateAddressDetails);
        if (addrErr) throw new Error(addrErr);
        alternateAddress = serializeAlternateAddress(
          form.alternateAddressDetails
        );
        if (!alternateAddress) {
          throw new Error(
            'Alternate address Name and Address are required when enabled'
          );
        }
      }

      const variations = form.variations
        .filter((v) => v.name.trim())
        .map((v) => ({
          ...v,
          name: v.name.trim(),
          price: v.price,
          payments: v.payments?.trim() || null,
        }));
      if (!variations.length) {
        throw new Error('Add at least one membership variation');
      }

      const tags = form.tagsInput
        .split(/[,]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const body: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        categoryId: form.categoryId.trim() || null,
        currency: form.currency.trim() || 'USD',
        entitlements,
        membershipType: form.membershipType,
        familyAllowed: form.membershipType === 'group',
        upgradeGroupKey: form.upgradeGroupKey.trim() || null,
        agreementRequired: form.agreementRequired,
        pauseAllowed: form.pauseAllowed,
        detailedDescription: form.enableDetailedDescription
          ? form.detailedDescription.trim() || null
          : null,
        physicalPassMessage: form.enablePhysicalPassMessage
          ? form.physicalPassMessage.trim() || null
          : null,
        imageUrl: form.enableImage ? form.imageUrl.trim() || null : null,
        tags,
        variations,
        daysValidFromPurchase: form.daysValidFromPurchase.trim()
          ? Number(form.daysValidFromPurchase)
          : null,
        daysValidFromRedemption: form.daysValidFromRedemption.trim()
          ? Number(form.daysValidFromRedemption)
          : null,
        redemptionStartsAt: localInputToIso(form.redemptionStartsAt),
        redemptionEndsAt: localInputToIso(form.redemptionEndsAt),
        customRedemptionDescription: form.enableCustomRedemptionDescription
          ? form.customRedemptionDescription.trim() || null
          : null,
        salesStartsAt: localInputToIso(form.salesStartsAt),
        salesEndsAt: localInputToIso(form.salesEndsAt),
        hideFromOnlineSales: form.hideFromOnlineSales,
        addOnsEnabled,
        alternateAddress,
        cancellationTerms: (() => {
          if (!form.enableCancellationTerms) return null;
          if (isEmptyMembershipHtml(form.cancellationTerms)) {
            throw new Error(
              'Cancellation terms text is required when the option is enabled'
            );
          }
          const plain = htmlToPlainText(form.cancellationTerms);
          if (plain.length > CANCELLATION_TERMS_PLAIN_MAX) {
            throw new Error(
              `Cancellation terms must be at most ${CANCELLATION_TERMS_PLAIN_MAX} characters`
            );
          }
          return sanitizeCancellationTermsForWrite(form.cancellationTerms);
        })(),
        formsEnabled,
        instructions: (() => {
          if (!form.enableInstructions) return null;
          if (isEmptyMembershipHtml(form.instructions)) {
            throw new Error(
              'Instructions text is required when the option is enabled'
            );
          }
          const plain = htmlToPlainText(form.instructions);
          if (plain.length > INSTRUCTIONS_PLAIN_MAX) {
            throw new Error(
              `Instructions must be at most ${INSTRUCTIONS_PLAIN_MAX} characters`
            );
          }
          return sanitizeInstructionsForWrite(form.instructions);
        })(),
        reportingCategory: (() => {
          if (!form.enableReportingCategory) return null;
          const code = sanitizeReportingCategoryForWrite(
            form.reportingCategory
          );
          if (!code) {
            throw new Error(
              'Reporting category GL code is required when the option is enabled'
            );
          }
          return code;
        })(),
        overrideTax: form.overrideTax,
        termsAndConditions: (() => {
          if (!form.enableTerms) return null;
          if (isEmptyMembershipHtml(form.termsAndConditions)) {
            throw new Error(
              'Terms and conditions text is required when the option is enabled'
            );
          }
          const plain = htmlToPlainText(form.termsAndConditions);
          if (plain.length > TERMS_AND_CONDITIONS_PLAIN_MAX) {
            throw new Error(
              `Terms and conditions must be at most ${TERMS_AND_CONDITIONS_PLAIN_MAX} characters`
            );
          }
          return sanitizeTermsAndConditionsForWrite(form.termsAndConditions);
        })(),
      };

      if (editing) return updateMembershipPlan(editing.id, body);
      return createMembershipPlan(body);
    },
    onSuccess: (plan) => {
      const action = editing ? 'update' : 'create';
      addToast(editing ? 'Plan updated' : 'Plan created', 'success');
      setEditing(null);
      setForm(emptyForm());
      setModalOpen(false);
      setStaleRemotePlan(false);
      notifyMembershipChange(qc, {
        kind: 'plan',
        action,
        id: plan.id,
      });
    },
    onError: (err: Error) => addToast(err.message || 'Save failed', 'error'),
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => archiveMembershipPlan(id),
    onSuccess: (_data, id) => {
      addToast('Plan archived', 'success');
      notifyMembershipChange(qc, {
        kind: 'plan',
        action: 'delete',
        id,
      });
    },
    onError: (err: Error) => addToast(err.message || 'Archive failed', 'error'),
  });

  function openCreate() {
    prefetchMembershipPlanProductPicker(qc);
    prefetchMembershipPlanFormPicker(qc);
    setEditing(null);
    live.resetSettingsLink('create');
    const seeded = emptyForm();
    if (live.settings) {
      seeded.pauseAllowed = live.settings.allowPause;
      seeded.agreementRequired = live.settings.requireAgreementBeforeActive;
    }
    setForm(seeded);
    setStaleRemotePlan(false);
    setModalOpen(true);
  }

  function startEdit(plan: MembershipPlanDto) {
    prefetchMembershipPlanProductPicker(qc);
    prefetchMembershipPlanFormPicker(qc);
    setEditing(plan);
    live.resetSettingsLink('edit');
    setForm(planToForm(plan));
    setStaleRemotePlan(false);
    setModalOpen(true);
  }

  function reloadFromRemote() {
    if (!editing) return;
    const remote =
      live.plans.find((p) => p.id === editing.id) ??
      (plansQuery.data ?? []).find((p) => p.id === editing.id);
    if (!remote) {
      addToast('Plan no longer available — closed the editor', 'error');
      closeModal();
      return;
    }
    setEditing(remote);
    setForm(planToForm(remote));
    setStaleRemotePlan(false);
    addToast('Reloaded latest plan from Memberships', 'success');
  }

  function closeModal() {
    if (saveMutation.isPending) return;
    setModalOpen(false);
    setEditing(null);
    setForm(emptyForm());
    setStaleRemotePlan(false);
  }

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeModal();
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close only while open
  }, [modalOpen, saveMutation.isPending]);

  function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    if (!canWrite) return;
    saveMutation.mutate();
  }

  function updateVariation(
    index: number,
    patch: Partial<MembershipPlanVariation>
  ) {
    setForm((f) => ({
      ...f,
      variations: f.variations.map((v, i) =>
        i === index ? { ...v, ...patch } : v
      ),
    }));
  }

  if (!hasHydratedAuth) {
    return <AdminRouteLoading label="Opening plans…" />;
  }

  if (!canRead) {
    return (
      <div className="p-6 text-sm text-stone-600">
        You do not have permission to view Memberships.
      </div>
    );
  }

  const plans = plansQuery.data ?? [];
  const showListSpinner = plansQuery.isLoading && plans.length === 0;

  const parkPayoutGap = useMemo(() => {
    const parks = parkAccountsQuery.data ?? [];
    if (!parks.length) return null;
    const sellableLocIds = new Set(
      plans
        .filter(
          (p) =>
            !p.archivedAt && !p.hideFromOnlineSales && Boolean(p.locationId)
        )
        .map((p) => p.locationId as string)
    );
    const blocked = parks.find(
      (p) =>
        p.isFranchise && !p.chargeReady && sellableLocIds.has(p.locationId)
    );
    return blocked
      ? { locationId: blocked.locationId, locationName: blocked.locationName }
      : null;
  }, [parkAccountsQuery.data, plans]);

  const editingParkNotReady = useMemo(() => {
    if (!editing?.locationId || form.hideFromOnlineSales) return null;
    const park = (parkAccountsQuery.data ?? []).find(
      (p) => p.locationId === editing.locationId
    );
    if (park?.isFranchise && !park.chargeReady) {
      return {
        locationId: park.locationId,
        locationName: park.locationName,
      };
    }
    return null;
  }, [
    editing?.locationId,
    form.hideFromOnlineSales,
    parkAccountsQuery.data,
  ]);

  return (
    <div className="space-y-8 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#D4AF37]">
            Memberships
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-stone-900">Plans</h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            Guest park membership products. Sell &amp; billing run under
            Memberships → Members.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canWrite ? (
            <button
              type="button"
              className={btnPrimaryClass}
              onClick={openCreate}
            >
              Create membership plan
            </button>
          ) : null}
          <AdminHowToGuideButton onClick={() => setGuideOpen(true)} />
        </div>
      </header>

      {guideOpen ? (
        <DeferredMembershipsGuideModal
          open={guideOpen}
          onClose={() => setGuideOpen(false)}
          title="Membership plans"
          subtitle="Guest park Memberships catalog — Growth+. Sell & billing live under Members."
          steps={MEMBERSHIPS_PLANS_GUIDE_STEPS}
        />
      ) : null}

      {canReadPayouts && parkPayoutGap ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Publish OK; park payouts not ready — online pay blocked until Connect
          on{' '}
          <Link
            href={`/admin/payouts?locationId=${encodeURIComponent(parkPayoutGap.locationId)}`}
            className="font-semibold underline"
          >
            /admin/payouts
          </Link>
          {parkPayoutGap.locationName
            ? ` (${parkPayoutGap.locationName})`
            : ''}
          .
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-stone-800">Membership plans</h2>
        <label className="inline-flex items-center gap-2 text-sm text-stone-600">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived
        </label>
      </div>

      {showListSpinner ? (
        <p className="text-sm text-stone-500">Loading plans…</p>
      ) : plans.length === 0 ? (
        <div className="border border-dashed border-stone-300 bg-white px-4 py-10 text-center">
          <p className="text-sm text-stone-500">No membership plans yet.</p>
          {canWrite ? (
            <button
              type="button"
              className={`${btnPrimaryClass} mt-4`}
              onClick={openCreate}
            >
              Create membership plan
            </button>
          ) : null}
        </div>
      ) : (
        <div className="overflow-x-auto border border-stone-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Billing</th>
                <th className="px-4 py-3 font-medium">Price</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {plans.map((plan) => {
                const altPreview = formatAlternateAddressPreview(
                  plan.alternateAddress
                );
                return (
                <tr key={plan.id} className="align-middle">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {plan.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={plan.imageUrl}
                          alt=""
                          className="h-10 w-10 rounded object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded bg-stone-100 text-xs text-stone-400">
                          —
                        </div>
                      )}
                      <div>
                        <p className="font-medium text-stone-900">{plan.name}</p>
                        {plan.categoryName ? (
                          <p className="text-xs text-stone-500">
                            {plan.categoryName}
                            {plan.reportingCategory
                              ? ` · GL ${plan.reportingCategory}`
                              : ''}
                          </p>
                        ) : plan.reportingCategory ? (
                          <p className="text-xs text-stone-500">
                            GL {plan.reportingCategory}
                          </p>
                        ) : null}
                        {plan.addOnsEnabled &&
                        Array.isArray(plan.entitlements?.addOnProductIds) &&
                        plan.entitlements.addOnProductIds.length > 0 ? (
                          <p className="mt-0.5 text-[11px] font-medium text-[#8a7020]">
                            {plan.entitlements.addOnProductIds.length} add-on
                            {plan.entitlements.addOnProductIds.length === 1
                              ? ''
                              : 's'}
                          </p>
                        ) : null}
                        {altPreview ? (
                          <p
                            className="mt-0.5 max-w-xs truncate text-[11px] text-stone-500"
                            title={altPreview}
                          >
                            Alt: {altPreview}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 capitalize text-stone-700">
                    {plan.membershipType}
                  </td>
                  <td className="px-4 py-3 text-stone-700">
                    {plan.billing}
                    {plan.intervalCount && plan.intervalUnit
                      ? ` · every ${plan.intervalCount} ${plan.intervalUnit}`
                      : ''}
                  </td>
                  <td className="px-4 py-3 text-stone-700">
                    {plan.price} {plan.currency}
                  </td>
                  <td className="px-4 py-3">
                    {plan.archivedAt ? (
                      <span className="text-xs text-stone-500">Archived</span>
                    ) : plan.hideFromOnlineSales ? (
                      <span className="text-xs text-amber-700">Hidden online</span>
                    ) : (
                      <span className="text-xs text-emerald-700">Active</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canWrite && !plan.archivedAt ? (
                      <div className="inline-flex gap-2">
                        <button
                          type="button"
                          className="rounded border border-stone-300 px-3 py-1.5 text-xs text-stone-700"
                          onClick={() => startEdit(plan)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="rounded border border-stone-300 px-3 py-1.5 text-xs text-stone-700"
                          disabled={archiveMutation.isPending}
                          onClick={() => {
                            if (confirm(`Archive “${plan.name}”?`)) {
                              archiveMutation.mutate(plan.id);
                            }
                          }}
                        >
                          Archive
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && canWrite ? (
        <div
          className="fixed inset-0 z-[45] flex flex-col bg-stone-900/40 lg:left-64"
          role="dialog"
          aria-modal="true"
          aria-labelledby="membership-plan-modal-title"
        >
          <div className="absolute inset-0" aria-hidden onClick={closeModal} />
          <div
            className="relative z-[1] flex h-full w-full flex-col overflow-hidden bg-stone-50 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 bg-white px-4 py-3 sm:px-6">
              <h2
                id="membership-plan-modal-title"
                className="text-base font-semibold text-stone-900"
              >
                {editing ? `Edit “${editing.name}”` : 'Create membership plan'}
              </h2>
              <button
                type="button"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Close"
                disabled={saveMutation.isPending}
                onClick={closeModal}
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
              {staleRemotePlan ? (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <span>
                    This plan was updated elsewhere. Reload to sync before saving,
                    or continue to overwrite.
                  </span>
                  <button
                    type="button"
                    className="rounded border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-900"
                    onClick={reloadFromRemote}
                  >
                    Reload latest
                  </button>
                </div>
              ) : null}
              {(live.categoriesFetching ||
                live.settingsFetching ||
                live.productsFetching) &&
              modalOpen ? (
                <p className="mb-3 text-xs text-stone-400">
                  Syncing linked Memberships data…
                </p>
              ) : null}
              <form
                onSubmit={onSubmit}
                className="space-y-8 rounded-lg border border-stone-200 bg-white p-4 sm:p-6"
              >
{/* ——— Content ——— */}
          <section className="space-y-4">
            {sectionTitle(
              'Content',
              'Name, descriptions, image, and tags shown to guests and staff.'
            )}
            <label className="block text-sm">
              <span className="flex justify-between text-stone-700">
                <span>
                  Name <span className="text-red-600">*</span>
                </span>
                <span className="text-xs text-stone-400">
                  {form.name.length} / 75
                </span>
              </span>
              <input
                className={fieldClass}
                value={form.name}
                maxLength={75}
                onChange={(e) => {
                  const name = e.target.value;
                  setForm((f) => ({
                    ...f,
                    name,
                    variations:
                      f.variations.length === 1 &&
                      (!f.variations[0]?.name ||
                        f.variations[0]?.name === f.name)
                        ? [{ ...f.variations[0]!, name }]
                        : f.variations,
                  }));
                }}
                required
              />
            </label>
            <label className="block text-sm">
              <span className="text-stone-700">Membership category</span>
              <select
                className={fieldClass}
                value={form.categoryId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, categoryId: e.target.value }))
                }
              >
                <option value="">None</option>
                {form.categoryId &&
                !live.categories.some((c) => c.id === form.categoryId) ? (
                  <option value={form.categoryId}>
                    {editing?.categoryName
                      ? `${editing.categoryName} (unavailable)`
                      : 'Previous category (unavailable)'}
                  </option>
                ) : null}
                {live.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-stone-500">
                Live from Memberships → Membership categories (not shop Catalog
                categories). Updates automatically when categories change.
              </span>
            </label>
            <label className="block text-sm">
              <span className="flex justify-between text-stone-700">
                <span>Description</span>
                <span className="text-xs text-stone-400">
                  {form.description.length} / 150
                </span>
              </span>
              <p className="mb-1 text-xs text-stone-500">
                Provide a clear description to help guests when purchasing this
                product.
              </p>
              <textarea
                className={fieldClass}
                rows={3}
                maxLength={150}
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
              />
            </label>

            {optionRow({
              checked: form.enableDetailedDescription,
              onChange: (v) =>
                setForm((f) => ({ ...f, enableDetailedDescription: v })),
              label: 'Provide a detailed description',
              description:
                'Longer product copy for the details page (plain text for now).',
              children: (
                <label className="block text-sm">
                  <span className="mb-1 flex justify-end text-xs text-stone-400">
                    {form.detailedDescription.length} / 4000
                  </span>
                  <textarea
                    className={fieldClass}
                    rows={4}
                    maxLength={4000}
                    value={form.detailedDescription}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        detailedDescription: e.target.value,
                      }))
                    }
                  />
                </label>
              ),
            })}

            {optionRow({
              checked: form.enablePhysicalPassMessage,
              onChange: (v) =>
                setForm((f) => ({ ...f, enablePhysicalPassMessage: v })),
              label: 'Customize physical pass message',
              description: 'Printed or wallet pass message for this membership.',
              children: (
                <textarea
                  className={fieldClass}
                  rows={2}
                  maxLength={500}
                  value={form.physicalPassMessage}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      physicalPassMessage: e.target.value,
                    }))
                  }
                />
              ),
            })}

            {optionRow({
              checked: form.enableImage,
              onChange: (v) => setForm((f) => ({ ...f, enableImage: v })),
              label: 'Image',
              description:
                'Choose an image to distinguish the membership for guests and staff.',
              children: (
                <div className="space-y-2">
                  <input
                    className={fieldClass}
                    placeholder="https://…"
                    value={form.imageUrl}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, imageUrl: e.target.value }))
                    }
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded border border-stone-300 px-3 py-1.5 text-xs text-stone-700">
                      {imageUploading ? 'Uploading…' : 'Upload file'}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={!canUpload || imageUploading}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          if (!file) return;
                          if (!canUpload) {
                            addToast(
                              'You need uploads:write to upload images',
                              'error'
                            );
                            return;
                          }
                          setImageUploading(true);
                          try {
                            const urls = await uploadCatalogImages(
                              [file],
                              'memberships'
                            );
                            const url = urls[0];
                            if (!url) throw new Error('Upload returned no URL');
                            setForm((f) => ({
                              ...f,
                              imageUrl: url,
                              enableImage: true,
                            }));
                          } catch (err) {
                            addToast(
                              err instanceof Error
                                ? err.message
                                : 'Upload failed',
                              'error'
                            );
                          } finally {
                            setImageUploading(false);
                          }
                        }}
                      />
                    </label>
                    {form.imageUrl ? (
                      <button
                        type="button"
                        className="rounded border border-stone-300 px-3 py-1.5 text-xs text-stone-700"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            imageUrl: '',
                            enableImage: false,
                          }))
                        }
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                  {form.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={form.imageUrl}
                      alt=""
                      className="h-24 w-auto rounded border border-stone-200 object-cover"
                    />
                  ) : null}
                </div>
              ),
            })}

            <label className="block text-sm">
              <span className="text-stone-700">Tags</span>
              <p className="mb-1 text-xs text-stone-500">
                Comma-separated tags to manage products across the platform.
              </p>
              <input
                className={fieldClass}
                placeholder="Type or enter tag…"
                value={form.tagsInput}
                onChange={(e) =>
                  setForm((f) => ({ ...f, tagsInput: e.target.value }))
                }
              />
            </label>
          </section>

          {/* ——— Membership details ——— */}
          <section className="space-y-4">
            {sectionTitle('Membership details')}
            <fieldset>
              <legend className="text-sm font-medium text-stone-800">
                Membership type <span className="text-red-600">*</span>
              </legend>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {(
                  [
                    {
                      value: 'single' as const,
                      label: 'Single',
                      desc: 'A membership for one person.',
                    },
                    {
                      value: 'group' as const,
                      label: 'Group',
                      desc: 'A membership for multiple people e.g. families, corporate groups, friends.',
                    },
                  ] as const
                ).map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex cursor-pointer gap-3 rounded border p-3 ${
                      form.membershipType === opt.value
                        ? 'border-[#D4AF37] bg-[#D4AF37]/5'
                        : 'border-stone-200'
                    }`}
                  >
                    <input
                      type="radio"
                      name="membershipType"
                      checked={form.membershipType === opt.value}
                      onChange={() =>
                        setForm((f) => ({ ...f, membershipType: opt.value }))
                      }
                    />
                    <span>
                      <span className="block text-sm font-medium text-stone-900">
                        {opt.label}
                      </span>
                      <span className="mt-0.5 block text-xs text-stone-500">
                        {opt.desc}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <h4 className="text-sm font-medium text-stone-800">
                Membership variations
              </h4>
              <p className="mt-0.5 text-xs text-stone-500">
                Create different types of memberships varying in the price,
                number of redemptions per day, or eligible products. The first
                sellable row drives billing.
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="px-2 py-2 font-medium">Name</th>
                      <th className="px-2 py-2 font-medium">Sell</th>
                      <th className="px-2 py-2 font-medium">
                        Price ({form.currency || 'USD'})
                      </th>
                      <th className="px-2 py-2 font-medium">Frequency</th>
                      <th className="px-2 py-2 font-medium">Payments</th>
                      <th className="px-2 py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {form.variations.map((v, i) => (
                      <tr key={i} className="border-t border-stone-100">
                        <td className="px-2 py-2">
                          <input
                            className={fieldClass}
                            value={v.name}
                            onChange={(e) =>
                              updateVariation(i, { name: e.target.value })
                            }
                            required
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="checkbox"
                            checked={v.sell}
                            onChange={(e) =>
                              updateVariation(i, { sell: e.target.checked })
                            }
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            className={fieldClass}
                            type="number"
                            min="0"
                            step="0.01"
                            value={v.price}
                            onChange={(e) =>
                              updateVariation(i, { price: e.target.value })
                            }
                            required
                          />
                        </td>
                        <td className="px-2 py-2">
                          <select
                            className={fieldClass}
                            value={v.frequency}
                            onChange={(e) =>
                              updateVariation(i, {
                                frequency: e.target.value as
                                  | 'one_time'
                                  | 'recurring',
                              })
                            }
                          >
                            <option value="one_time">One time</option>
                            <option value="recurring">Recurring</option>
                          </select>
                          {v.frequency === 'recurring' ? (
                            <div className="mt-1 flex gap-1">
                              <input
                                className={fieldClass}
                                type="number"
                                min={1}
                                value={v.intervalCount ?? 1}
                                onChange={(e) =>
                                  updateVariation(i, {
                                    intervalCount: Number(e.target.value) || 1,
                                  })
                                }
                              />
                              <select
                                className={fieldClass}
                                value={v.intervalUnit ?? 'month'}
                                onChange={(e) =>
                                  updateVariation(i, {
                                    intervalUnit: e.target
                                      .value as MembershipPlanVariation['intervalUnit'],
                                  })
                                }
                              >
                                <option value="day">Day</option>
                                <option value="week">Week</option>
                                <option value="month">Month</option>
                                <option value="year">Year</option>
                              </select>
                            </div>
                          ) : null}
                        </td>
                        <td className="px-2 py-2">
                          <input
                            className={fieldClass}
                            placeholder="—"
                            value={v.payments ?? ''}
                            onChange={(e) =>
                              updateVariation(i, {
                                payments: e.target.value || null,
                              })
                            }
                          />
                        </td>
                        <td className="px-2 py-2">
                          {form.variations.length > 1 ? (
                            <button
                              type="button"
                              className="text-xs text-stone-500 underline"
                              onClick={() =>
                                setForm((f) => ({
                                  ...f,
                                  variations: f.variations.filter(
                                    (_, j) => j !== i
                                  ),
                                }))
                              }
                            >
                              Remove
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                className="mt-2 text-sm text-[#D4AF37] underline"
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    variations: [...f.variations, emptyVariation(f.name)],
                  }))
                }
              >
                + Add variation
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="block text-sm">
                <span className="text-stone-700">Currency</span>
                <input
                  className={fieldClass}
                  value={form.currency}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, currency: e.target.value }))
                  }
                />
              </label>
              <label className="block text-sm">
                <span className="text-stone-700">Entries / period</span>
                <input
                  className={fieldClass}
                  type="number"
                  min="0"
                  value={form.entriesPerPeriod}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      entriesPerPeriod: e.target.value,
                    }))
                  }
                />
              </label>
              <label className="block text-sm">
                <span className="text-stone-700">Discount %</span>
                <input
                  className={fieldClass}
                  type="number"
                  min="0"
                  max="100"
                  value={form.discountPercent}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      discountPercent: e.target.value,
                    }))
                  }
                />
              </label>
              {form.membershipType === 'group' ? (
                <label className="block text-sm">
                  <span className="text-stone-700">Guest count</span>
                  <input
                    className={fieldClass}
                    type="number"
                    min="1"
                    value={form.guestCount}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, guestCount: e.target.value }))
                    }
                  />
                </label>
              ) : null}
              <label className="block text-sm">
                <span className="text-stone-700">Perk flags</span>
                <input
                  className={fieldClass}
                  list="membership-plan-perk-flags"
                  placeholder="vip, early_entry…"
                  value={form.perkFlags}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, perkFlags: e.target.value }))
                  }
                />
                <datalist id="membership-plan-perk-flags">
                  {live.perkFlags.map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
                <span className="mt-1 block text-xs text-stone-500">
                  Comma-separated. Suggestions refresh from other plans + venue
                  eligibility perks.
                </span>
              </label>
              <div className="block text-sm sm:col-span-2 lg:col-span-3">
                <span className="text-stone-700">Free product refs</span>
                <p className="mb-1 text-xs text-stone-500">
                  Catalog products included with this membership (redeem desk
                  checks these refs). List syncs live from Catalog → Products.
                </p>
                {live.products.length === 0 && !live.productsFetching ? (
                  <p className="rounded border border-dashed border-stone-200 px-3 py-2 text-xs text-stone-500">
                    No catalog products yet. Add products in Catalog, or paste
                    product ids below.
                  </p>
                ) : (
                  <div className="max-h-40 overflow-y-auto rounded border border-stone-200 bg-stone-50 p-2">
                    <ul className="space-y-1">
                      {live.products.map((p) => (
                        <li key={p.id}>
                          <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-800">
                            <input
                              type="checkbox"
                              checked={selectedFreeProductIds.has(p.id)}
                              onChange={() => toggleFreeProductRef(p.id)}
                            />
                            <span className="min-w-0 truncate">{p.name}</span>
                            <span className="shrink-0 font-mono text-[10px] text-stone-400">
                              {p.id.slice(0, 8)}…
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {orphanFreeProductRefs.length > 0 ? (
                  <p className="mt-1 text-xs text-amber-700">
                    Linked refs not in catalog (kept):{' '}
                    {orphanFreeProductRefs.join(', ')}
                    {' · '}
                    <button
                      type="button"
                      className="underline"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          freeProductRefs: Array.from(selectedFreeProductIds)
                            .filter((id) =>
                              live.products.some((p) => p.id === id)
                            )
                            .join(', '),
                        }))
                      }
                    >
                      Remove missing
                    </button>
                  </p>
                ) : null}
                <input
                  className={`${fieldClass} mt-2`}
                  placeholder="Or paste product ids, comma-separated"
                  value={form.freeProductRefs}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      freeProductRefs: e.target.value,
                    }))
                  }
                />
              </div>
              <label className="block text-sm">
                <span className="text-stone-700">Upgrade group key</span>
                <input
                  className={fieldClass}
                  list="membership-plan-upgrade-keys"
                  value={form.upgradeGroupKey}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      upgradeGroupKey: e.target.value,
                    }))
                  }
                />
                <datalist id="membership-plan-upgrade-keys">
                  {live.upgradeGroupKeys.map((k) => (
                    <option key={k} value={k} />
                  ))}
                </datalist>
                <span className="mt-1 block text-xs text-stone-500">
                  Plans that share a key can upgrade/downgrade together
                  (self-serve + billing). Suggestions update as plans change.
                </span>
              </label>
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-stone-700">
              <input
                type="checkbox"
                checked={form.pauseAllowed}
                onChange={(e) => {
                  live.setLiveSettingsLink((s) => ({
                    ...s,
                    pauseAllowed: false,
                  }));
                  setForm((f) => ({ ...f, pauseAllowed: e.target.checked }));
                }}
              />
              Pause allowed
              {live.liveSettingsLink.pauseAllowed && !editing ? (
                <span className="text-[10px] uppercase tracking-wide text-stone-400">
                  linked to settings
                </span>
              ) : null}
            </label>
            {live.liveSettingsLink.pauseAllowed && !editing ? (
              <p className="text-xs text-stone-500">
                Follows Memberships → Settings → Allow pause. Change the
                checkbox to override for this plan only.
              </p>
            ) : null}
          </section>

          {/* ——— Sales availability ——— */}
          <section className="space-y-4">
            {sectionTitle(
              'Sales availability',
              'Validity windows and when guests can buy this membership online.'
            )}
            <label className="block max-w-xs text-sm">
              <span className="text-stone-700">
                Days valid from date of purchase
              </span>
              <p className="mb-1 text-xs text-stone-500">
                The number of days this membership is valid from the date of
                purchase.
              </p>
              <div className="flex items-center gap-2">
                <input
                  className={fieldClass}
                  type="number"
                  min={1}
                  value={form.daysValidFromPurchase}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      daysValidFromPurchase: e.target.value,
                    }))
                  }
                />
                <span className="text-sm text-stone-600">days</span>
              </div>
            </label>
            <label className="block max-w-xs text-sm">
              <span className="text-stone-700">
                Days valid from date of redemption
              </span>
              <p className="mb-1 text-xs text-stone-500">
                The number of days this membership is valid from the date it has
                been redeemed.
              </p>
              <div className="flex items-center gap-2">
                <input
                  className={fieldClass}
                  type="number"
                  min={1}
                  value={form.daysValidFromRedemption}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      daysValidFromRedemption: e.target.value,
                    }))
                  }
                />
                <span className="text-sm text-stone-600">days</span>
              </div>
            </label>
            <div>
              <p className="text-sm font-medium text-stone-800">
                Redemption dates
              </p>
              <p className="mb-2 text-xs text-stone-500">
                Choose the dates a guest must visit to redeem.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="text-stone-600">From</span>
                  <input
                    type="datetime-local"
                    className={fieldClass}
                    value={form.redemptionStartsAt}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        redemptionStartsAt: e.target.value,
                      }))
                    }
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-stone-600">Until</span>
                  <input
                    type="datetime-local"
                    className={fieldClass}
                    value={form.redemptionEndsAt}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        redemptionEndsAt: e.target.value,
                      }))
                    }
                  />
                </label>
              </div>
              {optionRow({
                checked: form.enableCustomRedemptionDescription,
                onChange: (v) =>
                  setForm((f) => ({
                    ...f,
                    enableCustomRedemptionDescription: v,
                  })),
                label:
                  'Customise redemption description displayed on the product details page, email and ticket.',
                description: '',
                children: (
                  <input
                    className={fieldClass}
                    value={form.customRedemptionDescription}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        customRedemptionDescription: e.target.value,
                      }))
                    }
                  />
                ),
              })}
            </div>
            <div>
              <p className="text-sm font-medium text-stone-800">
                Online checkout sales period
              </p>
              <p className="mb-2 text-xs text-stone-500">
                Select the dates when a guest can purchase this membership in
                the online checkout.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="text-stone-600">From</span>
                  <input
                    type="datetime-local"
                    className={fieldClass}
                    value={form.salesStartsAt}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        salesStartsAt: e.target.value,
                      }))
                    }
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-stone-600">Until</span>
                  <input
                    type="datetime-local"
                    className={fieldClass}
                    value={form.salesEndsAt}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, salesEndsAt: e.target.value }))
                    }
                  />
                </label>
              </div>
            </div>
          </section>

          {/* ——— Additional options ——— */}
          <section className="space-y-1">
            {sectionTitle(
              'Additional options',
              'Optional checkout and back-office settings for this product.'
            )}
            {optionRow({
              checked: form.addOnsEnabled,
              onChange: (v) =>
                setForm((f) => ({
                  ...f,
                  addOnsEnabled: v,
                  addOnProductIds: v ? f.addOnProductIds : [],
                })),
              label: 'Add-ons',
              description:
                'Offer Online Booking products or other membership plans when guests purchase this membership online. The list stays live with Ticketing and Memberships.',
              children: (
                <MembershipProductMultiSelect
                  value={form.addOnProductIds}
                  onChange={(ids) =>
                    setForm((f) => ({ ...f, addOnProductIds: ids }))
                  }
                  enabled={form.addOnsEnabled}
                  warm={modalOpen}
                  excludePlanId={editing?.id}
                />
              ),
            })}
            {/* Keep picker queries warm even while Add-ons is unchecked. */}
            {modalOpen && !form.addOnsEnabled ? (
              <div className="hidden" aria-hidden>
                <MembershipProductMultiSelect
                  value={form.addOnProductIds}
                  onChange={() => {}}
                  enabled={false}
                  warm
                  excludePlanId={editing?.id}
                />
              </div>
            ) : null}
            {optionRow({
              checked: form.enableAlternateAddress,
              onChange: (v) =>
                setForm((f) => ({
                  ...f,
                  enableAlternateAddress: v,
                  alternateAddressDetails: v
                    ? f.alternateAddressDetails
                    : EMPTY_ALTERNATE_ADDRESS(),
                })),
              label: 'Alternate address',
              description:
                "Use a different guest-facing location when this membership isn't at your main park. Stays validated with Venues on save.",
              children: (
                <MembershipAlternateAddressFields
                  value={form.alternateAddressDetails}
                  onChange={(alternateAddressDetails) =>
                    setForm((f) => ({ ...f, alternateAddressDetails }))
                  }
                  disabled={saveMutation.isPending}
                  live={modalOpen}
                />
              ),
            })}
            {optionRow({
              checked: form.agreementRequired,
              onChange: (v) => {
                live.setLiveSettingsLink((s) => ({
                  ...s,
                  agreementRequired: false,
                }));
                setForm((f) => ({ ...f, agreementRequired: v }));
              },
              label: 'Booking agreement',
              description:
                'This product requires the guest to sign a booking agreement before purchase.',
            })}
            {optionRow({
              checked: form.enableCancellationTerms,
              onChange: (v) =>
                setForm((f) => ({
                  ...f,
                  enableCancellationTerms: v,
                  cancellationTerms: v ? f.cancellationTerms : '',
                })),
              label: 'Cancellation terms',
              description:
                'Tell guests how to cancel. Shown at checkout when they confirm subscription terms, and again on their profile. Supports bold, lists, and links.',
              children: (
                <MembershipCancellationTermsEditor
                  value={form.cancellationTerms}
                  disabled={saveMutation.isPending}
                  onChange={(cancellationTerms) =>
                    setForm((f) => ({ ...f, cancellationTerms }))
                  }
                />
              ),
            })}
            {optionRow({
              checked: form.formsEnabled,
              onChange: (v) =>
                setForm((f) => ({
                  ...f,
                  formsEnabled: v,
                  formIds: v ? f.formIds : [],
                })),
              label: 'Forms',
              description:
                'Capture extra guest details at purchase. Starter catalog forms plus published Digital Waivers forms stay live in this list.',
              children: (
                <MembershipFormMultiSelect
                  value={form.formIds}
                  onChange={(ids) =>
                    setForm((f) => ({ ...f, formIds: ids }))
                  }
                  enabled={form.formsEnabled}
                  warm={modalOpen}
                />
              ),
            })}
            {modalOpen && !form.formsEnabled ? (
              <div className="hidden" aria-hidden>
                <MembershipFormMultiSelect
                  value={form.formIds}
                  onChange={() => {}}
                  enabled={false}
                  warm
                />
              </div>
            ) : null}
            {optionRow({
              checked: form.hideFromOnlineSales,
              onChange: (v) =>
                setForm((f) => ({ ...f, hideFromOnlineSales: v })),
              label: 'Hide from online sales',
              description: 'This item is not available for purchase online.',
            })}
            {canReadPayouts && editingParkNotReady && !form.hideFromOnlineSales ? (
              <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                Publish OK; park payouts not ready — online pay blocked until
                Connect on{' '}
                <Link
                  href={`/admin/payouts?locationId=${encodeURIComponent(editingParkNotReady.locationId)}`}
                  className="font-semibold underline"
                >
                  /admin/payouts
                </Link>
                .
              </p>
            ) : null}
            {optionRow({
              checked: form.enableInstructions,
              onChange: (v) =>
                setForm((f) => ({
                  ...f,
                  enableInstructions: v,
                  instructions: v ? f.instructions : '',
                })),
              label: 'Instructions',
              description:
                'Show guests important information in their confirmation email and on their membership profile. Supports bold, lists, and links.',
              children: (
                <MembershipInstructionsEditor
                  value={form.instructions}
                  disabled={saveMutation.isPending}
                  onChange={(instructions) =>
                    setForm((f) => ({ ...f, instructions }))
                  }
                />
              ),
            })}
            {optionRow({
              checked: form.enableReportingCategory,
              onChange: (v) =>
                setForm((f) => ({
                  ...f,
                  enableReportingCategory: v,
                  reportingCategory: v ? f.reportingCategory : '',
                })),
              label: 'Reporting category',
              description:
                'Assign a General Ledger (GL) code for Memberships reports. Codes used on other plans appear here live.',
              children: (
                <MembershipReportingCategoryField
                  value={form.reportingCategory}
                  extraCodes={live.reportingCategories}
                  disabled={saveMutation.isPending}
                  fetching={live.plansFetching}
                  onChange={(reportingCategory) =>
                    setForm((f) => ({
                      ...f,
                      reportingCategory:
                        normalizeReportingCategory(reportingCategory),
                    }))
                  }
                />
              ),
            })}
            {optionRow({
              checked: form.overrideTax,
              onChange: (v) =>
                setForm((f) => ({
                  ...f,
                  overrideTax: v,
                  overrideTaxChoice: v ? f.overrideTaxChoice : 'default',
                })),
              label: 'Override tax',
              description:
                'Choose how tax applies to this membership. The default option stays live with Store settings → Tax.',
              children: (
                <MembershipOverrideTaxField
                  value={form.overrideTaxChoice}
                  disabled={saveMutation.isPending}
                  live={modalOpen}
                  onChange={(overrideTaxChoice) =>
                    setForm((f) => ({ ...f, overrideTaxChoice }))
                  }
                />
              ),
            })}
            {optionRow({
              checked: form.enableTerms,
              onChange: (v) =>
                setForm((f) => ({
                  ...f,
                  enableTerms: v,
                  termsAndConditions: v ? f.termsAndConditions : '',
                })),
              label: 'Terms and conditions',
              description:
                'Additional terms specific to this product. Shown on the membership agreement after your venue terms. Supports bold, lists, and links.',
              children: (
                <MembershipTermsEditor
                  value={form.termsAndConditions}
                  disabled={saveMutation.isPending}
                  onChange={(termsAndConditions) =>
                    setForm((f) => ({ ...f, termsAndConditions }))
                  }
                />
              ),
            })}
            {optionRow({
              checked: form.ticketHolderCaptured,
              onChange: (v) =>
                setForm((f) => ({ ...f, ticketHolderCaptured: v })),
              label: 'Ticket holder captured',
              description:
                'Only for names of each ticket holder when purchasing items in progression checkouts',
            })}
            {optionRow({
              checked: form.customTicketIdCaptured,
              onChange: (v) =>
                setForm((f) => ({ ...f, customTicketIdCaptured: v })),
              label: 'Custom ticket ID captured',
              description:
                'Prompt staff to capture a custom ticket ID for this product at POS.',
            })}
            {optionRow({
              checked: form.waiverRequired,
              onChange: (v) =>
                setForm((f) => ({ ...f, waiverRequired: v })),
              label: 'Waiver',
              description: (
                <>
                  Each guest is required to sign a waiver.{' '}
                  <AdminPendingLink
                    href={WAIVER_SETTINGS_HREF}
                    className="inline font-medium text-[#D4AF37] underline-offset-2 hover:underline"
                  >
                    Waiver settings
                  </AdminPendingLink>
                </>
              ),
              children: (
                <MembershipWaiverField
                  planId={editing?.id ?? null}
                  planName={form.name.trim() || editing?.name}
                  live={modalOpen && form.waiverRequired}
                />
              ),
            })}
          </section>

                    <div className="flex flex-wrap gap-2 border-t border-stone-200 pt-4">
            <button
              type="submit"
              className={btnPrimaryClass}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? <ButtonSpinner /> : null}
              {editing ? 'Save changes' : 'Create membership plan'}
            </button>
            <button
              type="button"
              className="rounded border border-stone-300 px-3 py-2 text-sm text-stone-700"
              disabled={saveMutation.isPending}
              onClick={closeModal}
            >
              Cancel
            </button>
          </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}


    </div>
  );
}
