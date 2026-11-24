'use client';

import { ReactNode, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '@/contexts/toast-context';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import AdminPendingLink from '@/components/Protected/admin/components/AdminPendingLink';
import {
  listAdminVenueLocations,
  venueLocationKeys,
} from '@/services/venueLocations';
import { adminListQueryDefaults } from '@/lib/adminListCache';
import { withAdminListSnapshot } from '@/lib/adminListSnapshot';
import type {
  AdmissionProductType,
  CapacityResourceType,
  PriceBandInput,
} from '@/services/ticketing';
import {
  linkProductAddOn,
} from '@/services/ticketing';
import {
  listBookingCategories,
  bookingCategoryKeys,
} from '@/services/bookingCategories';
import { uploadCatalogImages, prefetchUploadSignatures } from '@/services/upload';
import { getCurrencyCode, getCurrencySymbol } from '@/utils/currency';
import {
  useCapacityResourcesQuery,
  useCreateCapacityResourceMutation,
  useCreateTicketSessionMutation,
  useCreateTicketingProductMutation,
  useTicketingProductsQuery,
  useTicketingSettingsQuery,
} from '@/hooks/useTicketing';
import { useAdminTaxSettingsQuery } from '@/hooks/useTaxSettings';
import { useHqLocationFilter } from '@/hooks/useHqLocationFilter';
import { BULK_SESSION_LIMIT } from '@/lib/ticketing/sessionLimits';
import AdminHowToGuideModal, {
  AdminHowToGuideButton,
  CREATE_TICKET_PRODUCT_GUIDE_STEPS,
} from '@/components/Protected/admin/components/AdminHowToGuideModal';
import {
  COMMON_PRICE_BAND_CODES,
  PRODUCT_RESOURCE_POLICY,
  PRODUCT_TYPE_GUIDANCE,
  PRODUCT_TYPE_OPTIONS,
  RESOURCE_TYPE_OPTIONS,
  btnDangerClass,
  btnPrimaryClass,
  btnSecondaryClass,
  fieldClass,
  filterResourcesForProductType,
  formatProductType,
  groupResourcesByType,
} from './ticketingUi';
import { ClockTimeInput } from '@/components/common/ClockTimeFields';
import {
  formatClockTime,
  isHour12,
  joinDateTimeLocal,
  parseHm,
} from '@/lib/timeClock';

type WizardStep =
  | 'basics'
  | 'venue'
  | 'pricing'
  | 'policies'
  | 'sessions'
  | 'review';

type PriceRow = {
  id: string;
  code: string;
  amount: string;
  minAge: string;
  maxAge: string;
};

type DraftSession = {
  id: string;
  label: string;
  startsAt: string;
  endsAt: string;
  capacity: string;
};

type SlotDateRow = {
  id: string;
  date: string;
  capacity: string;
};

/** How the admin attaches calendar days to a session time window. */
type SlotDateAddMethod = 'one' | 'range';

type SlotGroup = {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  defaultCapacity: string;
  dates: SlotDateRow[];
  /** One day at a time vs fill a date range (same start/end time). */
  dateAddMethod: SlotDateAddMethod;
  rangeStart: string;
  rangeEnd: string;
  weekdays: number[];
  singleDate: string;
};

const SLOT_WEEKDAYS = [
  { v: 1, label: 'Mon' },
  { v: 2, label: 'Tue' },
  { v: 3, label: 'Wed' },
  { v: 4, label: 'Thu' },
  { v: 5, label: 'Fri' },
  { v: 6, label: 'Sat' },
  { v: 0, label: 'Sun' },
];

function newRowId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `row_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function eachDateKey(start: string, end: string): string[] {
  const out: string[] = [];
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  if (![sy, sm, sd, ey, em, ed].every((n) => Number.isFinite(n))) return out;
  const cursor = new Date(sy, sm - 1, sd);
  const last = new Date(ey, em - 1, ed);
  let guard = 0;
  while (cursor <= last && guard < 400) {
    guard += 1;
    out.push(
      `${cursor.getFullYear()}-${pad2(cursor.getMonth() + 1)}-${pad2(cursor.getDate())}`
    );
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

function emptySlotGroup(partial?: Partial<SlotGroup>): SlotGroup {
  return {
    id: newRowId(),
    name: 'Morning Adventure',
    startTime: '09:00',
    endTime: '10:30',
    defaultCapacity: '20',
    dates: [],
    dateAddMethod: 'range',
    rangeStart: '',
    rangeEnd: '',
    weekdays: [1, 2, 3, 4, 5],
    singleDate: '',
    ...partial,
  };
}

function formatDayLabel(yyyyMmDd: string) {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  if (![y, m, d].every((n) => Number.isFinite(n))) return yyyyMmDd || '—';
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function flattenSlotGroups(groups: SlotGroup[]): DraftSession[] {
  const out: DraftSession[] = [];
  for (const g of groups) {
    const label = g.name.trim();
    for (const row of g.dates) {
      if (!row.date) continue;
      out.push({
        id: row.id,
        label,
        startsAt: joinDateTimeLocal(row.date, g.startTime),
        endsAt: joinDateTimeLocal(row.date, g.endTime),
        capacity: row.capacity.trim() || g.defaultCapacity,
      });
    }
  }
  return out;
}

function emptyPrice(code = 'adult'): PriceRow {
  return {
    id: newRowId(),
    code,
    amount: '',
    minAge: '',
    maxAge: '',
  };
}

function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-lg border border-stone-200 bg-white p-4 sm:p-5">
      <header className="space-y-1 border-b border-stone-100 pb-3">
        <h2 className="text-sm font-semibold text-stone-900">{title}</h2>
        {description ? (
          <p className="text-xs leading-relaxed text-stone-500">{description}</p>
        ) : null}
      </header>
      {children}
    </section>
  );
}

function wizardStepsFor(type: AdmissionProductType): {
  id: WizardStep;
  label: string;
  hint: string;
}[] {
  const base = [
    {
      id: 'basics' as const,
      label: 'Basics',
      hint: 'Type, name, media',
    },
    {
      id: 'venue' as const,
      label: 'Venue',
      hint: 'Where it runs',
    },
    {
      id: 'pricing' as const,
      label: 'Pricing',
      hint: 'What guests pay',
    },
    {
      id: 'policies' as const,
      label: 'Options',
      hint: 'Waiver, tax, publish',
    },
  ];
  const needsSessions =
    type === 'timed_session' ||
    type === 'party_package' ||
    type === 'group' ||
    type === 'camp_event';
  if (needsSessions) {
    return [
      ...base,
      {
        id: 'sessions',
        label: 'Schedule',
        hint: 'Bookable times',
      },
      {
        id: 'review',
        label: 'Review',
        hint: 'Create when ready',
      },
    ];
  }
  return [
    ...base,
    {
      id: 'review',
      label: 'Review',
      hint: 'Create when ready',
    },
  ];
}

export type TicketingProductCreatePageProps = {
  presentation?: 'page' | 'modal';
  onClose?: () => void;
  onCreated?: (product: { id: string; name: string }) => void;
  onBusyChange?: (busy: boolean) => void;
  preferLocationId?: string;
  preferType?: AdmissionProductType | '';
};

export default function TicketingProductCreatePage({
  presentation = 'page',
  onClose,
  onCreated,
  onBusyChange,
  preferLocationId,
  preferType,
}: TicketingProductCreatePageProps = {}) {
  const router = useRouter();
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const canWrite = can(P.TicketingProductsWrite) || can(P.TicketingWrite);
  const createMutation = useCreateTicketingProductMutation();
  const createResourceMutation = useCreateCapacityResourceMutation();
  const createSessionMutation = useCreateTicketSessionMutation();
  const isModal = presentation === 'modal';
  const [guideOpen, setGuideOpen] = useState(false);
  const currencyCode = getCurrencyCode();
  const currencySymbol = getCurrencySymbol();

  const [step, setStep] = useState<WizardStep>('basics');
  const [maxReachedStep, setMaxReachedStep] = useState<WizardStep>('basics');
  const [createdProductId, setCreatedProductId] = useState<string | null>(null);
  const [createdProductName, setCreatedProductName] = useState('');
  const [slotGroups, setSlotGroups] = useState<SlotGroup[]>(() => [
    emptySlotGroup(),
  ]);
  const [committing, setCommitting] = useState(false);

  const searchParams = useSearchParams();
  const [type, setType] = useState<AdmissionProductType>(() => {
    const fromPrefer = (preferType || '').trim();
    if (PRODUCT_TYPE_OPTIONS.some((o) => o.value === fromPrefer)) {
      return fromPrefer as AdmissionProductType;
    }
    const raw = isModal ? '' : (searchParams.get('type') || '').trim();
    return PRODUCT_TYPE_OPTIONS.some((o) => o.value === raw)
      ? (raw as AdmissionProductType)
      : 'timed_session';
  });
  // Party packages are created in the party package editor (one set of rules).
  useEffect(() => {
    if (type === 'party_package' && !isModal) router.replace('/admin/parties/packages/new');
  }, [type, isModal, router]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [pasteUrl, setPasteUrl] = useState('');
  const [uploadingImages, setUploadingImages] = useState(false);
  const {
    locationId,
    setLocationId,
    scopedLocationId,
  } = useHqLocationFilter(
    (
      preferLocationId ||
      (isModal ? '' : searchParams.get('locationId') || '')
    ).trim()
  );
  const [resourceId, setResourceId] = useState('');
  const [quickRoomName, setQuickRoomName] = useState('');
  const [quickRoomCapacity, setQuickRoomCapacity] = useState('20');
  const [quickResourceType, setQuickResourceType] =
    useState<CapacityResourceType>('party_room');
  /** Optional types: only open create form when admin asks (avoids load flicker). */
  const [createResourceOpen, setCreateResourceOpen] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [minGuests, setMinGuests] = useState('');
  const [maxGuests, setMaxGuests] = useState('');
  const [defaultPassExpiryDays, setDefaultPassExpiryDays] = useState('');
  const [waiverRequired, setWaiverRequired] = useState(false);
  const [taxExemptDefault, setTaxExemptDefault] = useState(false);
  const [published, setPublished] = useState(false);
  const [prices, setPrices] = useState<PriceRow[]>([emptyPrice('adult')]);
  const [addOnIds, setAddOnIds] = useState<string[]>([]);
  const [fieldError, setFieldError] = useState('');

  const wizardSteps = useMemo(() => wizardStepsFor(type), [type]);
  const stepIndex = wizardSteps.findIndex((s) => s.id === step);
  const maxReachedIndex = wizardSteps.findIndex((s) => s.id === maxReachedStep);
  const draftSessions = useMemo(
    () => flattenSlotGroups(slotGroups),
    [slotGroups]
  );

  const venuesKey = venueLocationKeys.list('all');
  const venuesQuery = useQuery({
    queryKey: venuesKey,
    queryFn: () => listAdminVenueLocations({ scope: 'all' }),
    ...adminListQueryDefaults,
    ...withAdminListSnapshot(venuesKey),
    placeholderData: (previous) => previous,
  });
  const venues = (venuesQuery.data ?? []).filter((v) => {
    if (v.status === 'archived') return false;
    if (scopedLocationId) return v.id === scopedLocationId;
    return true;
  });

  const resourcesQuery = useCapacityResourcesQuery(
    { locationId: locationId || undefined },
    Boolean(locationId)
  );
  const addOnsQuery = useTicketingProductsQuery(
    { type: 'add_on', locationId: locationId || undefined },
    Boolean(locationId) && type !== 'add_on'
  );
  const categoriesQuery = useQuery({
    queryKey: bookingCategoryKeys.list(false),
    queryFn: () => listBookingCategories({ includeArchived: false }),
    ...adminListQueryDefaults,
  });
  const categories = categoriesQuery.data ?? [];
  const taxQuery = useAdminTaxSettingsQuery(canWrite);
  const settingsQuery = useTicketingSettingsQuery(
    locationId || null,
    Boolean(locationId)
  );
  const timeFormat = settingsQuery.data?.timeFormat;
  const hour12 = isHour12(timeFormat);

  const typeGuide = PRODUCT_TYPE_GUIDANCE[type];
  const resourcePolicy = PRODUCT_RESOURCE_POLICY[type];
  const needsPartyResource = resourcePolicy.mode === 'required';
  const showResourceField = resourcePolicy.mode !== 'hidden';
  const showPassExpiry = type === 'pass';
  const showGuestBounds =
    type === 'group' || type === 'party_package' || type === 'camp_event';
  const needsSessionsAfter =
    type === 'timed_session' ||
    type === 'party_package' ||
    type === 'group' ||
    type === 'camp_event';

  const resources = useMemo(
    () =>
      (resourcesQuery.data ?? []).filter(
        (r) => !r.archivedAt && (!locationId || r.locationId === locationId)
      ),
    [resourcesQuery.data, locationId]
  );

  const resourceOptions = useMemo(
    () => filterResourcesForProductType(resources, type),
    [resources, type]
  );

  const resourceGroups = useMemo(
    () => groupResourcesByType(resourceOptions),
    [resourceOptions]
  );

  const hiddenByTypeFilter = resources.length - resourceOptions.length;

  // Wait until the venue resources query settles — empty `data` while loading
  // used to flash the "create resource" form, then hide it when rows arrived.
  const resourcesReady =
    Boolean(locationId) &&
    !resourcesQuery.isLoading &&
    (resourcesQuery.isFetched || resourcesQuery.isError);
  const noMatchingResources =
    resourcesReady && resourceOptions.length === 0;
  const showInlineCreateResource =
    showResourceField &&
    noMatchingResources &&
    (needsPartyResource || createResourceOpen);

  // Keep selection stable while the resources query refetches.
  useEffect(() => {
    if (!needsPartyResource || !locationId) return;
    if (resourceId && resourceOptions.some((r) => r.id === resourceId)) return;
    if (resourceOptions.length === 1) {
      setResourceId(resourceOptions[0].id);
    }
  }, [needsPartyResource, locationId, resourceOptions, resourceId]);

  useEffect(() => {
    if (needsPartyResource) setQuickResourceType('party_room');
    else setQuickResourceType('attraction');
  }, [needsPartyResource]);

  // Warm Cloudinary signature so the first image pick is faster.
  useEffect(() => {
    prefetchUploadSignatures('products', 1);
  }, []);

  const selectedAddOns = useMemo(
    () => (addOnsQuery.data ?? []).filter((a) => addOnIds.includes(a.id)),
    [addOnsQuery.data, addOnIds]
  );

  const taxSettings = taxQuery.data;
  const bookingSettings = settingsQuery.data;

  async function createResourceInline() {
    if (!locationId) {
      addToast('Select a venue first', 'error');
      return;
    }
    const resourceName = quickRoomName.trim();
    if (resourceName.length < 2) {
      addToast('Enter a resource name', 'error');
      return;
    }
    const capacity = Number(quickRoomCapacity);
    if (!Number.isInteger(capacity) || capacity < 1) {
      addToast('Enter a capacity of at least 1', 'error');
      return;
    }
    const resourceType =
      needsPartyResource &&
      quickResourceType !== 'room' &&
      quickResourceType !== 'party_room'
        ? 'party_room'
        : quickResourceType;
    try {
      const created = await createResourceMutation.mutateAsync({
        name: resourceName,
        type: resourceType,
        locationId,
        defaultCapacity: capacity,
      });
      setResourceId(created.id);
      setQuickRoomName('');
      setCreateResourceOpen(false);
      addToast(`“${created.name}” added and selected`, 'success');
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Could not create resource',
        'error'
      );
    }
  }

  function updatePrice(id: string, patch: Partial<PriceRow>) {
    setPrices((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row))
    );
  }

  function addPriceBand(code = '') {
    setPrices((prev) => [...prev, emptyPrice(code)]);
  }

  function removePriceBand(id: string) {
    setPrices((prev) => {
      if (prev.length <= 1) {
        addToast('At least one price band is required', 'error');
        return prev;
      }
      return prev.filter((row) => row.id !== id);
    });
  }

  function addCommonBand(code: string) {
    const exists = prices.some(
      (p) => p.code.trim().toLowerCase() === code.toLowerCase()
    );
    if (exists) {
      addToast(`${code} band already added`, 'info');
      return;
    }
    addPriceBand(code);
  }

  function onTypeChange(next: AdmissionProductType) {
    if (createdProductId) {
      addToast(
        'This product is already created. Start a new one to change type.',
        'info'
      );
      return;
    }
    if (next === type) return;

    // Keep progress so step cards stay clickable after a type change.
    // Remap to the farthest step that still exists for the new type.
    const previousMaxIndex = wizardSteps.findIndex(
      (s) => s.id === maxReachedStep
    );
    const nextSteps = wizardStepsFor(next);
    const nextIds = new Set(nextSteps.map((s) => s.id));
    let preservedMax: WizardStep = 'basics';
    for (let i = Math.max(0, previousMaxIndex); i >= 0; i--) {
      const id = wizardSteps[i]?.id;
      if (id && nextIds.has(id)) {
        preservedMax = id;
        break;
      }
    }
    // Switching onto a type that adds Schedule: if they already passed Options
    // (or further), unlock Schedule so they are not stuck re-clicking Continue.
    const hadPastPolicies =
      previousMaxIndex >=
      wizardSteps.findIndex((s) => s.id === 'policies');
    if (
      nextIds.has('sessions') &&
      hadPastPolicies &&
      (preservedMax === 'policies' || preservedMax === 'review')
    ) {
      preservedMax = 'sessions';
    }

    setType(next);
    setFieldError('');
    setStep('basics');
    setMaxReachedStep(preservedMax);
    setDraftSessions([]);
    if (next === 'add_on') setAddOnIds([]);
    const nextPolicy = PRODUCT_RESOURCE_POLICY[next];
    if (nextPolicy.mode === 'hidden') {
      setResourceId('');
    } else if (resourceId) {
      const stillAllowed = filterResourcesForProductType(
        resources,
        next
      ).some((r) => r.id === resourceId);
      if (!stillAllowed) setResourceId('');
    }
  }

  function goToStep(next: WizardStep) {
    const nextIdx = wizardSteps.findIndex((s) => s.id === next);
    if (nextIdx < 0) return;
    // Only allow current, previous, or already-reached steps.
    if (nextIdx > maxReachedIndex + 1) {
      addToast('Finish the current step before continuing.', 'info');
      return;
    }
    if (nextIdx > maxReachedIndex) {
      setMaxReachedStep(next);
    }
    setStep(next);
    setFieldError('');
  }

  function validateBasics(): boolean {
    if (name.trim().length < 2) {
      setFieldError('Enter a product name (at least 2 characters).');
      addToast('Product name is required', 'error');
      return false;
    }
    return true;
  }

  function validateVenue(): boolean {
    if (!locationId) {
      setFieldError('Select a venue for this product.');
      addToast('Venue is required', 'error');
      return false;
    }
    if (needsPartyResource && !resourceId) {
      setFieldError(
        'Party packages require a room or party room capacity resource.'
      );
      addToast(
        'Party packages require a room / party_room capacity resource',
        'error'
      );
      return false;
    }
    if (
      minGuests !== '' &&
      maxGuests !== '' &&
      Number(minGuests) > Number(maxGuests)
    ) {
      setFieldError('Min guests cannot exceed max guests.');
      addToast('Min guests cannot exceed max guests', 'error');
      return false;
    }
    return true;
  }

  function validatePricing(): boolean {
    const pricePayload: PriceBandInput[] = prices
      .filter((p) => p.code.trim() && p.amount.trim())
      .map((p) => ({
        code: p.code.trim(),
        amount: Number(p.amount),
        currency: currencyCode,
        minAge: p.minAge === '' ? null : Number(p.minAge),
        maxAge: p.maxAge === '' ? null : Number(p.maxAge),
      }));
    if (!pricePayload.length) {
      setFieldError('Add at least one price band with a label and amount.');
      addToast('Add at least one price band with amount > 0', 'error');
      return false;
    }
    if (pricePayload.some((p) => !(p.amount > 0))) {
      setFieldError('Each price amount must be greater than 0.');
      addToast('Each price amount must be greater than 0', 'error');
      return false;
    }
    const codes = pricePayload.map((p) => p.code.toLowerCase());
    if (new Set(codes).size !== codes.length) {
      setFieldError('Price band labels must be unique.');
      addToast('Duplicate price band labels are not allowed', 'error');
      return false;
    }
    return true;
  }

  async function createProductRecord(): Promise<string | null> {
    if (!validateBasics() || !validateVenue() || !validatePricing()) return null;

    const pricePayload: PriceBandInput[] = prices
      .filter((p) => p.code.trim() && p.amount.trim())
      .map((p) => ({
        code: p.code.trim(),
        amount: Number(p.amount),
        currency: currencyCode,
        minAge: p.minAge === '' ? null : Number(p.minAge),
        maxAge: p.maxAge === '' ? null : Number(p.maxAge),
      }));

    try {
      const product = await createMutation.mutateAsync({
        type,
        name: name.trim(),
        description: description.trim() || null,
        images,
        locationId,
        resourceId: resourceId || null,
        categoryId: categoryId || null,
        published,
        waiverRequired,
        taxExemptDefault,
        minGuests: minGuests === '' ? null : Number(minGuests),
        maxGuests: maxGuests === '' ? null : Number(maxGuests),
        defaultPassExpiryDays:
          defaultPassExpiryDays === ''
            ? null
            : Number(defaultPassExpiryDays),
        prices: pricePayload,
      });

      if (!product?.id) {
        throw new Error('Product was created but no id was returned');
      }

      let addOnFailures = 0;
      if (type !== 'add_on' && addOnIds.length) {
        const results = await Promise.allSettled(
          addOnIds.map((addOnProductId) =>
            linkProductAddOn(product.id, { addOnProductId })
          )
        );
        addOnFailures = results.filter((r) => r.status === 'rejected').length;
      }

      let sessionFailures = 0;
      let sessionsCreated = 0;
      if (draftSessions.length > 0) {
        if (draftSessions.length > BULK_SESSION_LIMIT) {
          throw new Error(
            `Too many timeslots (${draftSessions.length.toLocaleString()}). Max is ${BULK_SESSION_LIMIT.toLocaleString()} per create — narrow the date range or split across schedule runs.`
          );
        }
        try {
          const bulk = await createSessionMutation.mutateAsync({
            productId: product.id,
            resourceId: resourceId || null,
            capacity: Number(draftSessions[0]?.capacity) || 0,
            slots: draftSessions.map((s) => ({
              startsAt: new Date(s.startsAt).toISOString(),
              endsAt: new Date(s.endsAt).toISOString(),
              label: s.label.trim() || null,
              capacity: Number(s.capacity),
            })),
          });
          sessionsCreated =
            bulk.count ?? bulk.sessions?.length ?? draftSessions.length;
        } catch {
          sessionFailures = draftSessions.length;
        }
      }

      if (addOnFailures > 0 || sessionFailures > 0) {
        const parts: string[] = [];
        if (addOnFailures > 0) {
          parts.push(`${addOnFailures} add-on link(s) failed`);
        }
        if (sessionFailures > 0) {
          parts.push(
            `${sessionFailures} session(s) failed — open the product to retry schedule`
          );
        }
        addToast(
          `Product created. ${parts.join('; ')}.`,
          'info'
        );
        onCreated?.({ id: product.id, name: product.name });
        setCreatedProductId(product.id);
        setCreatedProductName(product.name);
        return product.id;
      }

      const slotNote =
        sessionsCreated > 0
          ? ` with ${sessionsCreated.toLocaleString()} timeslot${sessionsCreated === 1 ? '' : 's'}`
          : '';
      addToast(`Product created successfully${slotNote}`, 'success');
      onCreated?.({ id: product.id, name: product.name });
      if (isModal) {
        setCreatedProductId(product.id);
        setCreatedProductName(product.name);
      } else {
        router.push('/admin/ticketing');
      }
      return product.id;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not create product';
      setFieldError(message);
      addToast(message, 'error');
      return null;
    }
  }

  async function onContinue() {
    setFieldError('');
    if (createdProductId) {
      addToast('This product is already created.', 'info');
      return;
    }
    if (step === 'basics') {
      if (!validateBasics()) return;
      goToStep('venue');
      return;
    }
    if (step === 'venue') {
      if (!validateVenue()) return;
      goToStep('pricing');
      return;
    }
    if (step === 'pricing') {
      if (!validatePricing()) return;
      goToStep('policies');
      return;
    }
    if (step === 'policies') {
      goToStep(needsSessionsAfter ? 'sessions' : 'review');
      return;
    }
    if (step === 'sessions') {
      if (!validateSlotGroups()) return;
      if (draftSessions.length < 1) {
        setFieldError(
          'Add at least one day under a session, or skip if you will schedule later.'
        );
        addToast(
          'Attach days to a session first, or use Skip if you will schedule later',
          'error'
        );
        return;
      }
      goToStep('review');
    }
  }

  async function onCommitProduct() {
    if (createdProductId) return;
    if (!validateBasics() || !validateVenue() || !validatePricing()) {
      goToStep('basics');
      return;
    }
    if (
      needsSessionsAfter &&
      draftSessions.length < 1 &&
      published &&
      !window.confirm(
        'This product is marked Published but has no timeslots yet. Guests will not see bookable times. Create anyway?'
      )
    ) {
      return;
    }
    if (needsSessionsAfter && draftSessions.length > 0 && !validateSlotGroups()) {
      goToStep('sessions');
      return;
    }
    setCommitting(true);
    try {
      await createProductRecord();
    } finally {
      setCommitting(false);
    }
  }

  function updateSlotGroup(id: string, patch: Partial<SlotGroup>) {
    setSlotGroups((prev) =>
      prev.map((g) => (g.id === id ? { ...g, ...patch } : g))
    );
  }

  function addSlotGroup() {
    setSlotGroups((prev) => [
      ...prev,
      emptySlotGroup({
        name:
          prev.length === 0
            ? 'Morning Adventure'
            : prev.length === 1
              ? 'Afternoon Adventure'
              : `Session ${prev.length + 1}`,
        dateAddMethod: 'range',
      }),
    ]);
  }

  function removeSlotGroup(id: string) {
    setSlotGroups((prev) => {
      if (prev.length <= 1) {
        return [emptySlotGroup()];
      }
      return prev.filter((g) => g.id !== id);
    });
  }

  function removeSlotDate(groupId: string, dateId: string) {
    setSlotGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? { ...g, dates: g.dates.filter((d) => d.id !== dateId) }
          : g
      )
    );
  }

  function updateSlotDate(
    groupId: string,
    dateId: string,
    patch: Partial<SlotDateRow>
  ) {
    setSlotGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? {
              ...g,
              dates: g.dates.map((d) =>
                d.id === dateId ? { ...d, ...patch } : d
              ),
            }
          : g
      )
    );
  }

  function addSingleDateToGroup(groupId: string) {
    const group = slotGroups.find((g) => g.id === groupId);
    if (!group) return;
    const date = group.singleDate;
    if (!date) {
      addToast('Pick a date to add', 'error');
      return;
    }
    if (group.dates.some((d) => d.date === date)) {
      addToast('That date is already on this session', 'info');
      return;
    }
    const currentTotal = draftSessions.length;
    if (currentTotal >= BULK_SESSION_LIMIT) {
      addToast(
        `Timeslot limit reached (${BULK_SESSION_LIMIT.toLocaleString()}). Remove days or create the product, then add more from Schedule.`,
        'error'
      );
      return;
    }
    updateSlotGroup(groupId, {
      dates: [
        ...group.dates,
        {
          id: newRowId(),
          date,
          capacity: group.defaultCapacity,
        },
      ].sort((a, b) => a.date.localeCompare(b.date)),
      singleDate: '',
    });
    addToast('Day added to session', 'success');
  }

  function addDateRangeToGroup(groupId: string) {
    const group = slotGroups.find((g) => g.id === groupId);
    if (!group) return;
    const start = group.rangeStart;
    const end = group.rangeEnd || group.rangeStart;
    if (!start) {
      addToast('Choose a start date for the range', 'error');
      return;
    }
    if (end < start) {
      addToast('End date must be on or after start date', 'error');
      return;
    }
    if (!group.weekdays.length) {
      addToast('Select at least one weekday', 'error');
      return;
    }
    const existing = new Set(group.dates.map((d) => d.date));
    const added: SlotDateRow[] = [];
    const room = BULK_SESSION_LIMIT - draftSessions.length;
    if (room <= 0) {
      addToast(
        `Timeslot limit reached (${BULK_SESSION_LIMIT.toLocaleString()}). Remove days or finish create, then add more from Schedule.`,
        'error'
      );
      return;
    }
    let truncated = false;
    for (const key of eachDateKey(start, end)) {
      const [y, mo, d] = key.split('-').map(Number);
      const dow = new Date(y, mo - 1, d).getDay();
      if (!group.weekdays.includes(dow)) continue;
      if (existing.has(key)) continue;
      if (added.length >= room) {
        truncated = true;
        break;
      }
      existing.add(key);
      added.push({
        id: newRowId(),
        date: key,
        capacity: group.defaultCapacity,
      });
    }
    if (!added.length) {
      addToast(
        'No new matching days in that range (check weekdays / duplicates)',
        'info'
      );
      return;
    }
    updateSlotGroup(groupId, {
      dates: [...group.dates, ...added].sort((a, b) =>
        a.date.localeCompare(b.date)
      ),
    });
    if (truncated) {
      addToast(
        `Added ${added.length} day${added.length === 1 ? '' : 's'} (stopped at ${BULK_SESSION_LIMIT.toLocaleString()} timeslot limit)`,
        'info'
      );
    } else {
      addToast(
        `Added ${added.length} day${added.length === 1 ? '' : 's'} to ${group.name.trim() || 'session'}`,
        'success'
      );
    }
  }

  function validateSlotGroups(): boolean {
    for (const g of slotGroups) {
      if (!g.dates.length) continue;
      if (!g.name.trim()) {
        addToast('Every slot with dates needs a name', 'error');
        return false;
      }
      const start = parseHm(g.startTime);
      const end = parseHm(g.endTime);
      if (!start || !end) {
        addToast(`Set valid start/end times for “${g.name.trim()}”`, 'error');
        return false;
      }
      const startMin = start.hours * 60 + start.minutes;
      const endMin = end.hours * 60 + end.minutes;
      if (endMin <= startMin) {
        addToast(
          `“${g.name.trim()}” end time must be after start time`,
          'error'
        );
        return false;
      }
      if (!(Number(g.defaultCapacity) >= 0)) {
        addToast(`Capacity must be a non-negative number`, 'error');
        return false;
      }
    }
    return true;
  }

  const busy =
    createMutation.isPending ||
    createSessionMutation.isPending ||
    committing;

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  if (!canWrite) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold text-stone-900">Create product</h1>
        <p className="text-sm text-stone-600">
          You need <code className="text-xs">ticketing:write</code> to create
          products.
        </p>
        {isModal ? (
          <button
            type="button"
            className="text-sm text-[#D4AF37]"
            onClick={() => onClose?.()}
          >
            Close
          </button>
        ) : (
          <Link href="/admin/ticketing" className="text-sm text-[#D4AF37]">
            Back to products
          </Link>
        )}
      </div>
    );
  }

  const currentMeta = wizardSteps[stepIndex] ?? wizardSteps[0];

  return (
    <div
      className={
        isModal
          ? 'space-y-5 pb-8'
          : 'mx-auto max-w-3xl space-y-5 pb-24 sm:pb-8'
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {isModal ? (
            <button
              type="button"
              className="text-sm text-stone-500 hover:text-[#D4AF37] disabled:opacity-40"
              disabled={busy}
              onClick={() => onClose?.()}
            >
              ← Close
            </button>
          ) : (
            <Link
              href="/admin/ticketing"
              className="text-sm text-stone-500 hover:text-[#D4AF37]"
            >
              ← Products
            </Link>
          )}
          <h1 className="mt-2 text-2xl font-semibold text-stone-900">
            Create ticket product
          </h1>
          <p className="mt-1 text-sm text-stone-600">
            {createdProductId
              ? 'Your product is ready. Open it below or go back to the list.'
              : 'Set up what can be sold. Open the guide if you are doing this for the first time.'}
          </p>
        </div>
        {!createdProductId ? (
          <AdminHowToGuideButton onClick={() => setGuideOpen(true)} />
        ) : null}
      </div>

      <AdminHowToGuideModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="Create product"
        subtitle="Follow these steps in order — written for first-time admins."
        steps={CREATE_TICKET_PRODUCT_GUIDE_STEPS}
      />

      {/* Stepper */}
      <nav aria-label="Product setup steps" className="rounded-lg border border-stone-200 bg-white p-3">
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-stone-100">
          <div
            className="h-full rounded-full bg-[#D4AF37] transition-all duration-300"
            style={{
              width: `${createdProductId ? 100 : Math.max(8, (stepIndex / Math.max(1, wizardSteps.length - 1)) * 100)}%`,
            }}
          />
        </div>
        <ol className="flex flex-wrap gap-2">
          {wizardSteps.map((s, i) => {
            const reached = i <= maxReachedIndex;
            const active = s.id === step;
            const locked = i > maxReachedIndex || Boolean(createdProductId);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={locked && !active}
                  onClick={() => {
                    if (!createdProductId && i <= maxReachedIndex) goToStep(s.id);
                  }}
                  className={`rounded-md px-2.5 py-1.5 text-left text-xs transition ${
                    active
                      ? 'bg-[#D4AF37]/20 font-semibold text-stone-900 ring-1 ring-[#D4AF37]/50'
                      : reached && !createdProductId
                        ? 'bg-stone-50 text-stone-700 hover:bg-stone-100'
                        : 'cursor-not-allowed text-stone-400'
                  }`}
                >
                  <span className="block font-semibold">
                    {i + 1}. {s.label}
                  </span>
                  <span className="block text-[10px] font-normal opacity-80">
                    {s.hint}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="mt-2 text-xs text-stone-500">
          {createdProductId ? (
            <>Done — product created</>
          ) : (
            <>
              Step {stepIndex + 1} of {wizardSteps.length}:{' '}
              <span className="font-medium text-stone-800">{currentMeta.label}</span>
              {step === 'review' ? ' — check the summary, then create' : null}
            </>
          )}
        </p>
      </nav>

      <div className="space-y-4">
        {step === 'basics' ? (
        <>
        <FormSection
          title="Product type"
          description={typeGuide.summary}
        >
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase text-stone-500">
              Type *
            </span>
            <select
              required
              value={type}
              onChange={(e) =>
                onTypeChange(e.target.value as AdmissionProductType)
              }
              className={fieldClass}
            >
              {PRODUCT_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <p className="rounded-md bg-stone-50 px-3 py-2 text-xs text-stone-600 space-y-1">
            <span className="block">{resourcePolicy.typeHint}</span>
            <span className="block text-stone-500">
              Use Continue on each step. Your product is only created when you
              confirm on the final Review step.
            </span>
          </p>
        </FormSection>

        <FormSection
          title="Identity"
          description="Guest-facing name, optional catalog category, description, and media."
        >
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase text-stone-500">
              Name *
            </span>
            <input
              required
              minLength={2}
              maxLength={160}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={fieldClass}
              placeholder="e.g. Weekend trampoline session"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase text-stone-500">
              Category
            </span>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className={fieldClass}
            >
              <option value="">
                {categoriesQuery.isLoading
                  ? 'Loading categories…'
                  : categories.length
                    ? 'Select category (optional)'
                    : 'No categories available'}
              </option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {!categoriesQuery.isLoading && categories.length === 0 ? (
              <p className="text-xs text-stone-500">
                Optional.{' '}
                <Link
                  href="/admin/ticketing/categories"
                  className="text-[#D4AF37]"
                >
                  Create booking categories
                </Link>{' '}
                first.
              </p>
            ) : (
              <p className="text-xs text-stone-500">
                Optional folder from Online Booking → Booking category.
              </p>
            )}
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase text-stone-500">
              Description
            </span>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={fieldClass}
              placeholder="What guests get, age rules, what to bring…"
            />
          </label>

          <div className="space-y-2">
            <span className="text-xs font-semibold uppercase text-stone-500">
              Images
            </span>
            <p className="text-xs text-stone-500">
              Optional — you can finish this product without a photo. Large phone
              pictures can take up to a couple of minutes to compress and upload.
            </p>
            {images.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {images.map((url) => (
                  <div
                    key={url}
                    className="relative h-20 w-20 overflow-hidden rounded-md border border-stone-200"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                    <button
                      type="button"
                      className="absolute right-0.5 top-0.5 rounded bg-black/60 px-1.5 text-[10px] text-white"
                      aria-label="Remove image"
                      onClick={() =>
                        setImages((prev) => prev.filter((u) => u !== url))
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-stone-500">No images yet.</p>
            )}
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={uploadingImages}
              className={fieldClass}
              onChange={async (e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = '';
                if (!files.length) return;
                setUploadingImages(true);
                try {
                  const urls = await uploadCatalogImages(files, 'products');
                  setImages((prev) => [...prev, ...urls]);
                  addToast(
                    urls.length === 1
                      ? 'Image uploaded'
                      : `${urls.length} images uploaded`,
                    'success'
                  );
                } catch (err) {
                  addToast(
                    err instanceof Error
                      ? err.message
                      : 'Could not upload images',
                    'error'
                  );
                } finally {
                  setUploadingImages(false);
                }
              }}
            />
            {uploadingImages ? (
              <p className="text-xs text-stone-500" role="status">
                Compressing and uploading… large photos can take 1–2 minutes.
                You can keep filling in the form.
              </p>
            ) : null}
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="url"
                value={pasteUrl}
                onChange={(e) => setPasteUrl(e.target.value)}
                className={`${fieldClass} min-w-0 flex-1`}
                placeholder="Or paste image URL"
              />
              <button
                type="button"
                className={`${btnSecondaryClass} shrink-0`}
                onClick={() => {
                  const url = pasteUrl.trim();
                  if (!url) return;
                  setImages((prev) =>
                    prev.includes(url) ? prev : [...prev, url]
                  );
                  setPasteUrl('');
                }}
              >
                Add URL
              </button>
            </div>
          </div>
        </FormSection>
        </>
        ) : null}

        {step === 'venue' ? (
        <FormSection
          title="Venue & capacity"
          description={
            showResourceField
              ? resourcePolicy.venueHint
              : 'Products are location-scoped. This type does not reserve a room or attraction.'
          }
        >
          <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase text-stone-500">
                Venue *
              </span>
              <select
                required
                value={locationId}
                onChange={(e) => {
                  setLocationId(e.target.value);
                  setResourceId('');
                  setAddOnIds([]);
                  setCreateResourceOpen(false);
                  setQuickRoomName('');
                }}
                disabled={Boolean(scopedLocationId)}
                className={fieldClass}
              >
                <option value="">Select venue</option>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            {showResourceField ? (
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase text-stone-500">
                {resourcePolicy.fieldLabel}
                {needsPartyResource ? ' *' : ''}
              </span>
              <select
                value={resourceId}
                onChange={(e) => setResourceId(e.target.value)}
                className={fieldClass}
                disabled={!locationId}
                required={needsPartyResource}
              >
                <option value="">{resourcePolicy.placeholder}</option>
                {resourceGroups.map((group) => (
                  <optgroup key={group.type} label={group.label}>
                    {group.items.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} · cap {r.defaultCapacity}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {!locationId ? (
                <p className="text-xs text-stone-500">
                  Select a venue to see matching resources.
                </p>
              ) : resourcesQuery.isLoading && resourceOptions.length === 0 ? (
                <p className="text-xs text-stone-500">Loading resources…</p>
              ) : resourceOptions.length > 0 ? (
                <p className="text-xs text-stone-500">
                  {resourcePolicy.venueHint}
                </p>
              ) : (
                <p className="text-xs text-stone-500">
                  {needsPartyResource
                    ? 'No matching room yet — create one below to continue.'
                    : 'No resources at this venue yet. You can continue without one, or create one below.'}
                </p>
              )}
            </label>
            ) : (
              <p className="rounded-md bg-stone-50 px-3 py-2 text-xs text-stone-600 self-center">
                {resourcePolicy.typeHint}
              </p>
            )}
          </div>

          {showResourceField &&
          locationId &&
          resourcesReady &&
          noMatchingResources &&
          !needsPartyResource &&
          !createResourceOpen ? (
            <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-3">
              <p className="text-xs text-stone-600">
                Optional — attach a capacity resource later, or create one now
                for this venue.
              </p>
              <button
                type="button"
                className={`${btnSecondaryClass} mt-2`}
                onClick={() => setCreateResourceOpen(true)}
              >
                Create a resource
              </button>
            </div>
          ) : null}

          {showInlineCreateResource ? (
            <div className="rounded-lg border border-dashed border-[#D4AF37]/60 bg-[#D4AF37]/5 p-4 sm:p-5 space-y-4">
              <header className="space-y-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-stone-900">
                    {needsPartyResource
                      ? 'No party room at this venue'
                      : 'Create a resource'}
                  </h3>
                  {!needsPartyResource ? (
                    <button
                      type="button"
                      className="text-xs font-medium text-stone-500 hover:text-stone-800"
                      onClick={() => {
                        setCreateResourceOpen(false);
                        setQuickRoomName('');
                      }}
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
                <p className="text-xs leading-relaxed text-stone-600">
                  {needsPartyResource
                    ? hiddenByTypeFilter > 0
                      ? `${hiddenByTypeFilter} other resource(s) exist here, but party packages only use Room or Party room. Create one to continue.`
                      : 'Create a room for this party package, then it will be selected automatically.'
                    : 'Nothing is listed for this venue yet. Create a resource if you want to attach one, or continue without it.'}
                </p>
              </header>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-1 sm:col-span-2">
                  <span className="text-xs font-semibold uppercase text-stone-500">
                    Resource name *
                  </span>
                  <input
                    value={quickRoomName}
                    onChange={(e) => setQuickRoomName(e.target.value)}
                    className={fieldClass}
                    placeholder={
                      needsPartyResource
                        ? 'e.g. Party Room A'
                        : 'e.g. Main hall'
                    }
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-semibold uppercase text-stone-500">
                    Resource type *
                  </span>
                  <select
                    value={quickResourceType}
                    onChange={(e) =>
                      setQuickResourceType(
                        e.target.value as CapacityResourceType
                      )
                    }
                    className={fieldClass}
                  >
                    {(needsPartyResource
                      ? RESOURCE_TYPE_OPTIONS.filter(
                          (o) => o.value === 'room' || o.value === 'party_room'
                        )
                      : RESOURCE_TYPE_OPTIONS
                    ).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-semibold uppercase text-stone-500">
                    Default capacity *
                  </span>
                  <input
                    type="number"
                    min={1}
                    value={quickRoomCapacity}
                    onChange={(e) => setQuickRoomCapacity(e.target.value)}
                    className={fieldClass}
                    placeholder="e.g. 20"
                  />
                </label>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  className={btnPrimaryClass}
                  disabled={createResourceMutation.isPending}
                  onClick={() => void createResourceInline()}
                >
                  {createResourceMutation.isPending ? <ButtonSpinner /> : null}
                  Add &amp; select
                </button>
                <p className="text-xs text-stone-500">
                  Or open{' '}
                  <Link
                    href={`/admin/ticketing/resources${
                      needsPartyResource
                        ? `?type=party_room&locationId=${encodeURIComponent(locationId)}`
                        : `?locationId=${encodeURIComponent(locationId)}`
                    }`}
                    className="font-medium text-[#D4AF37]"
                  >
                    Resources
                  </Link>{' '}
                  for the full list.
                </p>
              </div>
            </div>
          ) : null}
          </div>

          {(showGuestBounds || type === 'timed_session') && (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase text-stone-500">
                  Min guests
                </span>
                <input
                  type="number"
                  min={0}
                  value={minGuests}
                  onChange={(e) => setMinGuests(e.target.value)}
                  className={fieldClass}
                  placeholder="Optional"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase text-stone-500">
                  Max guests
                </span>
                <input
                  type="number"
                  min={0}
                  value={maxGuests}
                  onChange={(e) => setMaxGuests(e.target.value)}
                  className={fieldClass}
                  placeholder="Optional"
                />
              </label>
            </div>
          )}

          {showPassExpiry ? (
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase text-stone-500">
                Default pass expiry (days)
              </span>
              <input
                type="number"
                min={0}
                value={defaultPassExpiryDays}
                onChange={(e) => setDefaultPassExpiryDays(e.target.value)}
                className={fieldClass}
                placeholder="e.g. 365"
              />
              <p className="text-xs text-stone-500">
                Applied when a pass credential is issued from this product.
              </p>
            </label>
          ) : null}
        </FormSection>
        ) : null}

        {step === 'pricing' ? (
        <FormSection
          title="Pricing"
          description={`Amounts use workspace currency ${currencyCode} (${currencySymbol}). Booking tax uses Tax settings; exempt products skip tax.`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-stone-500">
              Add bands guests can choose (adult, child, …). Remove any band you
              do not need.
            </p>
            <button
              type="button"
              className={btnSecondaryClass}
              onClick={() => addPriceBand('')}
            >
              + Add price band
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {COMMON_PRICE_BAND_CODES.map((code) => (
              <button
                key={code}
                type="button"
                className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-[11px] font-medium capitalize text-stone-700 hover:border-[#D4AF37]/60 hover:bg-[#D4AF37]/10"
                onClick={() => addCommonBand(code)}
              >
                + {code}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {prices.map((row, idx) => (
              <div
                key={row.id}
                className="rounded-md border border-stone-200 bg-stone-50/60 p-3"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                    Band {idx + 1}
                  </span>
                  <button
                    type="button"
                    className={btnDangerClass}
                    disabled={prices.length <= 1}
                    onClick={() => removePriceBand(row.id)}
                  >
                    Remove
                  </button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="block space-y-1 sm:col-span-1">
                    <span className="text-[10px] font-medium uppercase text-stone-500">
                      Label / code *
                    </span>
                    <input
                      value={row.code}
                      onChange={(e) =>
                        updatePrice(row.id, { code: e.target.value })
                      }
                      placeholder="adult"
                      className={fieldClass}
                      required
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[10px] font-medium uppercase text-stone-500">
                      Amount ({currencyCode}) *
                    </span>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-stone-400">
                        {currencySymbol}
                      </span>
                      <input
                        type="number"
                        min={0.01}
                        step="0.01"
                        value={row.amount}
                        onChange={(e) =>
                          updatePrice(row.id, { amount: e.target.value })
                        }
                        placeholder="0.00"
                        className={`${fieldClass} pl-7`}
                        required
                      />
                    </div>
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[10px] font-medium uppercase text-stone-500">
                      Min age
                    </span>
                    <input
                      type="number"
                      min={0}
                      value={row.minAge}
                      onChange={(e) =>
                        updatePrice(row.id, { minAge: e.target.value })
                      }
                      placeholder="—"
                      className={fieldClass}
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[10px] font-medium uppercase text-stone-500">
                      Max age
                    </span>
                    <input
                      type="number"
                      min={0}
                      value={row.maxAge}
                      onChange={(e) =>
                        updatePrice(row.id, { maxAge: e.target.value })
                      }
                      placeholder="—"
                      className={fieldClass}
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        </FormSection>
        ) : null}

        {step === 'policies' ? (
        <>
        <FormSection
          title="Tax, waivers & publish"
          description="Optional booking rules. You can change these later on the product page."
        >
          <div className="rounded-md border border-stone-100 bg-stone-50 px-3 py-2 text-xs text-stone-600">
            <p>
              Tax settings:{' '}
              {taxQuery.isLoading
                ? 'Loading…'
                : taxSettings?.enabled
                  ? `${taxSettings.label || 'Tax'} ${taxSettings.rate ?? 0}%`
                  : 'Disabled (no tax on bookings)'}
              {' · '}
              <Link href="/admin/tax-settings" className="text-[#D4AF37]">
                Configure
              </Link>
            </p>
            {locationId && bookingSettings ? (
              <p className="mt-1">
                Venue booking mode: {bookingSettings.defaultCreateMode}
                {bookingSettings.allowOnlinePayLater
                  ? ' · online pay-later allowed'
                  : ''}
                {' · '}
                <Link
                  href="/admin/ticketing/settings"
                  className="text-[#D4AF37]"
                >
                  Ticketing settings
                </Link>
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-3 text-sm text-stone-800 sm:flex-row sm:flex-wrap sm:gap-6">
            <label
              className="inline-flex items-center gap-2"
              title="Saved on this product. A booking confirmation can include a signing link when this ticket requires a waiver and a published template exists. The desk reports it missing until a requirement is set. Check-in does not block on it yet."
            >
              <input
                type="checkbox"
                checked={waiverRequired}
                onChange={(e) => setWaiverRequired(e.target.checked)}
              />
              Waiver required
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={taxExemptDefault}
                onChange={(e) => setTaxExemptDefault(e.target.checked)}
              />
              Tax exempt by default
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={published}
                onChange={(e) => setPublished(e.target.checked)}
              />
              Published (public booking)
            </label>
          </div>
        </FormSection>

        {type !== 'add_on' ? (
          <FormSection
            title="Link add-ons (optional)"
            description="Attach existing add-on products from this venue. You can add or remove links anytime later."
          >
            {!locationId ? (
              <p className="text-sm text-stone-500">Select a venue first.</p>
            ) : addOnsQuery.isLoading && !(addOnsQuery.data?.length) ? (
              <p className="text-sm text-stone-500">Loading add-ons…</p>
            ) : (addOnsQuery.data?.length ?? 0) === 0 ? (
              <p className="text-sm text-stone-500">
                No add-ons at this venue yet.{' '}
                <Link
                  href="/admin/ticketing/add-ons"
                  className="text-[#D4AF37]"
                >
                  Create an add-on
                </Link>{' '}
                (type: {formatProductType('add_on')}).
              </p>
            ) : (
              <>
                {selectedAddOns.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {selectedAddOns.map((a) => (
                      <span
                        key={a.id}
                        className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-2.5 py-1 text-xs text-stone-800"
                      >
                        {a.name}
                        <button
                          type="button"
                          className="rounded px-1 text-stone-400 hover:bg-stone-100 hover:text-red-700"
                          aria-label={`Remove ${a.name}`}
                          onClick={() =>
                            setAddOnIds((prev) =>
                              prev.filter((id) => id !== a.id)
                            )
                          }
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-stone-200 p-3">
                  {(addOnsQuery.data ?? []).map((a) => (
                    <label
                      key={a.id}
                      className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-1 text-sm text-stone-700 hover:bg-stone-50"
                    >
                      <input
                        type="checkbox"
                        checked={addOnIds.includes(a.id)}
                        onChange={(e) => {
                          setAddOnIds((prev) =>
                            e.target.checked
                              ? [...prev, a.id]
                              : prev.filter((id) => id !== a.id)
                          );
                        }}
                      />
                      <span className="truncate">{a.name}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </FormSection>
        ) : null}
        </>
        ) : null}

        {step === 'sessions' && !createdProductId ? (
          <FormSection
            title="Schedule"
            description="Create each session once (name + daily time), then attach the calendar days it runs. Guests book one of those days at that time."
          >
            <ol className="space-y-2 rounded-md border border-stone-200 bg-stone-50 px-3 py-3 text-xs text-stone-600 sm:px-4">
              <li>
                <span className="font-semibold text-stone-800">1.</span> Set the
                session name, start/end time, and capacity.
              </li>
              <li>
                <span className="font-semibold text-stone-800">2.</span> Choose
                how to add days — one date, or a whole date range.
              </li>
              <li>
                <span className="font-semibold text-stone-800">3.</span> Review
                the day list under the session. Add another session (e.g.
                Afternoon) if you need a second daily window.
              </li>
            </ol>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-stone-700">
                <span className="font-semibold text-stone-900">
                  {draftSessions.length}
                </span>{' '}
                bookable time
                {draftSessions.length === 1 ? '' : 's'} ready
                {slotGroups.length > 1
                  ? ` across ${slotGroups.length} sessions`
                  : ''}
              </p>
              <button
                type="button"
                className={btnSecondaryClass}
                onClick={addSlotGroup}
              >
                + Add another session
              </button>
            </div>

            <ul className="space-y-4">
              {slotGroups.map((g, index) => {
                const timeLabel = `${formatClockTime(
                  joinDateTimeLocal('2000-01-01', g.startTime),
                  timeFormat
                )} – ${formatClockTime(
                  joinDateTimeLocal('2000-01-01', g.endTime),
                  timeFormat
                )}`;
                const methodOne = g.dateAddMethod === 'one';
                return (
                  <li
                    key={g.id}
                    className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 bg-stone-50 px-4 py-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                          Session {index + 1}
                        </p>
                        <p className="text-sm font-medium text-stone-900">
                          {g.name.trim() || 'Untitled session'}
                          <span className="font-normal text-stone-500">
                            {' '}
                            · {timeLabel}
                            {g.dates.length > 0
                              ? ` · ${g.dates.length} day${g.dates.length === 1 ? '' : 's'}`
                              : ' · no days yet'}
                          </span>
                        </p>
                      </div>
                      <button
                        type="button"
                        className={btnDangerClass}
                        onClick={() => removeSlotGroup(g.id)}
                      >
                        Remove session
                      </button>
                    </div>

                    <div className="space-y-5 px-4 py-4">
                      <section className="space-y-3">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                          Step 1 — Session details
                        </h3>
                        <label className="block space-y-1">
                          <span className="text-[10px] font-semibold uppercase text-stone-500">
                            Session name
                          </span>
                          <input
                            type="text"
                            maxLength={120}
                            value={g.name}
                            onChange={(e) =>
                              updateSlotGroup(g.id, { name: e.target.value })
                            }
                            className={fieldClass}
                            placeholder="e.g. Morning Adventure"
                            aria-label="Session name"
                          />
                        </label>
                        <div className="flex flex-wrap items-end gap-3">
                          <label className="space-y-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">
                              Starts each day
                            </span>
                            <ClockTimeInput
                              value={g.startTime}
                              onChange={(startTime) =>
                                updateSlotGroup(g.id, { startTime })
                              }
                              hour12={hour12}
                              aria-label={`${g.name || 'Session'} start`}
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">
                              Ends each day
                            </span>
                            <ClockTimeInput
                              value={g.endTime}
                              onChange={(endTime) =>
                                updateSlotGroup(g.id, { endTime })
                              }
                              hour12={hour12}
                              aria-label={`${g.name || 'Session'} end`}
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">
                              Capacity
                            </span>
                            <input
                              type="number"
                              min={0}
                              value={g.defaultCapacity}
                              onChange={(e) =>
                                updateSlotGroup(g.id, {
                                  defaultCapacity: e.target.value,
                                })
                              }
                              className={`${fieldClass} w-24`}
                              aria-label="Default capacity"
                            />
                          </label>
                        </div>
                      </section>

                      <section className="space-y-3 border-t border-stone-100 pt-4">
                        <div>
                          <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                            Step 2 — Attach days
                          </h3>
                          <p className="mt-1 text-xs text-stone-600">
                            Pick one method. Both use the same start/end time
                            from Step 1 — you do not re-enter the clock for each
                            day.
                          </p>
                        </div>

                        <div
                          className="grid grid-cols-2 gap-1 rounded-md border border-stone-200 bg-stone-100 p-1"
                          role="tablist"
                          aria-label="How to add days"
                        >
                          <button
                            type="button"
                            role="tab"
                            aria-selected={methodOne}
                            className={`rounded px-3 py-2 text-left text-xs font-semibold transition ${
                              methodOne
                                ? 'bg-white text-stone-900 shadow-sm'
                                : 'text-stone-600 hover:text-stone-900'
                            }`}
                            onClick={() =>
                              updateSlotGroup(g.id, { dateAddMethod: 'one' })
                            }
                          >
                            One day
                            <span className="mt-0.5 block font-normal text-[11px] text-stone-500">
                              Manual — pick a single date
                            </span>
                          </button>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={!methodOne}
                            className={`rounded px-3 py-2 text-left text-xs font-semibold transition ${
                              !methodOne
                                ? 'bg-white text-stone-900 shadow-sm'
                                : 'text-stone-600 hover:text-stone-900'
                            }`}
                            onClick={() =>
                              updateSlotGroup(g.id, { dateAddMethod: 'range' })
                            }
                          >
                            Several days
                            <span className="mt-0.5 block font-normal text-[11px] text-stone-500">
                              Auto — fill a date range
                            </span>
                          </button>
                        </div>

                        {methodOne ? (
                          <div className="space-y-3 rounded-md border border-stone-200 bg-stone-50/80 p-3">
                            <p className="text-xs text-stone-600">
                              Use this when you only need a few specific dates
                              (e.g. a one-off event day).
                            </p>
                            <div className="flex flex-wrap items-end gap-2">
                              <label className="block min-w-[11rem] flex-1 space-y-1">
                                <span className="text-[10px] font-semibold uppercase text-stone-500">
                                  Date
                                </span>
                                <input
                                  type="date"
                                  value={g.singleDate}
                                  onChange={(e) =>
                                    updateSlotGroup(g.id, {
                                      singleDate: e.target.value,
                                    })
                                  }
                                  className={fieldClass}
                                />
                              </label>
                              <button
                                type="button"
                                className={btnPrimaryClass}
                                onClick={() => addSingleDateToGroup(g.id)}
                              >
                                Add this day
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-3 rounded-md border border-stone-200 bg-stone-50/80 p-3">
                            <p className="text-xs text-stone-600">
                              Use this for a week or season — e.g. every Mon–Fri
                              from 1 Sept to 30 Sept at {timeLabel}.
                            </p>
                            <div className="grid gap-2 sm:grid-cols-2">
                              <label className="block space-y-1">
                                <span className="text-[10px] font-semibold uppercase text-stone-500">
                                  From
                                </span>
                                <input
                                  type="date"
                                  value={g.rangeStart}
                                  onChange={(e) =>
                                    updateSlotGroup(g.id, {
                                      rangeStart: e.target.value,
                                    })
                                  }
                                  className={fieldClass}
                                />
                              </label>
                              <label className="block space-y-1">
                                <span className="text-[10px] font-semibold uppercase text-stone-500">
                                  To
                                </span>
                                <input
                                  type="date"
                                  value={g.rangeEnd}
                                  onChange={(e) =>
                                    updateSlotGroup(g.id, {
                                      rangeEnd: e.target.value,
                                    })
                                  }
                                  className={fieldClass}
                                />
                              </label>
                            </div>
                            <div>
                              <span className="text-[10px] font-semibold uppercase text-stone-500">
                                Repeat on
                              </span>
                              <div className="mt-1.5 flex flex-wrap gap-1.5">
                                {SLOT_WEEKDAYS.map((d) => {
                                  const on = g.weekdays.includes(d.v);
                                  return (
                                    <button
                                      key={d.v}
                                      type="button"
                                      className={
                                        on ? btnPrimaryClass : btnSecondaryClass
                                      }
                                      onClick={() =>
                                        updateSlotGroup(g.id, {
                                          weekdays: on
                                            ? g.weekdays.filter(
                                                (w) => w !== d.v
                                              )
                                            : [...g.weekdays, d.v].sort(),
                                        })
                                      }
                                    >
                                      {d.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                            <button
                              type="button"
                              className={btnPrimaryClass}
                              onClick={() => addDateRangeToGroup(g.id)}
                            >
                              Generate days in range
                            </button>
                          </div>
                        )}
                      </section>

                      <section className="space-y-2 border-t border-stone-100 pt-4">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                          Step 3 — Days on this session
                          {g.dates.length > 0 ? ` (${g.dates.length})` : ''}
                        </h3>
                        {g.dates.length === 0 ? (
                          <p className="rounded-md border border-dashed border-stone-200 bg-stone-50 px-3 py-4 text-sm text-stone-500">
                            No days attached yet. Use Step 2 above — either{' '}
                            <strong>One day</strong> or{' '}
                            <strong>Several days</strong>.
                          </p>
                        ) : (
                          <ul className="divide-y divide-stone-100 overflow-hidden rounded-md border border-stone-200">
                            {g.dates.map((row) => (
                              <li
                                key={row.id}
                                className="flex flex-wrap items-center gap-2 bg-white px-3 py-2"
                              >
                                <input
                                  type="date"
                                  value={row.date}
                                  onChange={(e) =>
                                    updateSlotDate(g.id, row.id, {
                                      date: e.target.value,
                                    })
                                  }
                                  className={`${fieldClass} max-w-[11rem]`}
                                  aria-label={`Date for ${g.name}`}
                                />
                                <span className="min-w-0 flex-1 text-xs text-stone-600 sm:text-sm">
                                  {formatDayLabel(row.date)}
                                  <span className="text-stone-400">
                                    {' '}
                                    · {timeLabel}
                                  </span>
                                </span>
                                <label className="flex items-center gap-1 text-[10px] font-semibold uppercase text-stone-500">
                                  Cap
                                  <input
                                    type="number"
                                    min={0}
                                    value={row.capacity}
                                    onChange={(e) =>
                                      updateSlotDate(g.id, row.id, {
                                        capacity: e.target.value,
                                      })
                                    }
                                    className={`${fieldClass} w-20`}
                                    aria-label="Capacity for day"
                                  />
                                </label>
                                <button
                                  type="button"
                                  className={btnDangerClass}
                                  onClick={() => removeSlotDate(g.id, row.id)}
                                  aria-label="Remove day"
                                >
                                  Remove
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>
                    </div>
                  </li>
                );
              })}
            </ul>
          </FormSection>
        ) : null}

        {step === 'review' ? (
          createdProductId ? (
            <FormSection
              title="Product created"
              description="You're done. Open the product or return to the list."
            >
              <div className="space-y-3 text-sm text-stone-700">
                <p>
                  <span className="font-semibold text-stone-900">
                    {createdProductName}
                  </span>{' '}
                  ({formatProductType(type)})
                  {published
                    ? ' is published.'
                    : ' is unpublished (staff can still book it).'}
                </p>
                {needsSessionsAfter ? (
                  <p>
                    Timeslots created:{' '}
                    <span className="font-medium">{draftSessions.length}</span>
                    {draftSessions.length < 1
                      ? ' — add sessions before selling online.'
                      : '.'}
                  </p>
                ) : null}
                <p className="text-sm text-stone-600">
                  No guest is booked yet. When someone buys this, a booking
                  appears under All bookings. Staff can also sell it as walk-in
                  / phone.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/admin/ticketing/products/${createdProductId}`}
                    className={btnPrimaryClass}
                  >
                    Open product
                  </Link>
                  {needsSessionsAfter ? (
                    <Link
                      href={`/admin/ticketing/sessions?productId=${createdProductId}`}
                      className={btnSecondaryClass}
                    >
                      Manage schedule
                    </Link>
                  ) : null}
                  <AdminPendingLink
                    href="/admin/bookings/new"
                    className={btnSecondaryClass}
                  >
                    Create booking
                  </AdminPendingLink>
                  {isModal ? (
                    <button
                      type="button"
                      className={btnSecondaryClass}
                      onClick={() => onClose?.()}
                    >
                      Back to products
                    </button>
                  ) : (
                    <Link href="/admin/ticketing" className={btnSecondaryClass}>
                      Back to products
                    </Link>
                  )}
                </div>
              </div>
            </FormSection>
          ) : (
            <FormSection
              title="Review & create"
              description="One tap creates the product and any timeslots you added. You can edit everything afterward."
            >
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-semibold uppercase text-stone-500">
                    Name
                  </dt>
                  <dd className="mt-0.5 font-medium text-stone-900">
                    {name.trim() || '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase text-stone-500">
                    Type
                  </dt>
                  <dd className="mt-0.5 text-stone-800">
                    {formatProductType(type)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase text-stone-500">
                    Venue
                  </dt>
                  <dd className="mt-0.5 text-stone-800">
                    {venues.find((v) => v.id === locationId)?.name || '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase text-stone-500">
                    Price bands
                  </dt>
                  <dd className="mt-0.5 text-stone-800">
                    {prices.filter((p) => p.code.trim() && p.amount.trim()).length}{' '}
                    ·{' '}
                    {published ? 'Published' : 'Unpublished'}
                    {waiverRequired ? ' · Waiver' : ''}
                  </dd>
                </div>
                {needsSessionsAfter ? (
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-semibold uppercase text-stone-500">
                      Schedule
                    </dt>
                    <dd className="mt-0.5 text-stone-800">
                      {draftSessions.length > 0
                        ? `${draftSessions.length} bookable time${draftSessions.length === 1 ? '' : 's'} across ${slotGroups.filter((g) => g.dates.length > 0).length} session${slotGroups.filter((g) => g.dates.length > 0).length === 1 ? '' : 's'} ready to create`
                        : 'No schedule yet (you can add sessions after create)'}
                    </dd>
                  </div>
                ) : null}
                {selectedAddOns.length > 0 ? (
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-semibold uppercase text-stone-500">
                      Add-ons
                    </dt>
                    <dd className="mt-0.5 text-stone-800">
                      {selectedAddOns.map((a) => a.name).join(', ')}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </FormSection>
          )
        ) : null}

        {fieldError ? (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {fieldError}
          </p>
        ) : null}

        {!createdProductId ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-stone-200 bg-white/95 px-4 py-3 backdrop-blur sm:static sm:z-auto sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
          <div className="mx-auto flex max-w-3xl flex-wrap gap-3">
            {stepIndex > 0 ? (
              <button
                type="button"
                className={btnSecondaryClass}
                disabled={busy}
                onClick={() => {
                  const prev = wizardSteps[stepIndex - 1];
                  if (prev) setStep(prev.id);
                }}
              >
                Back
              </button>
            ) : null}
            {step === 'sessions' ? (
              <>
                <button
                  type="button"
                  className={btnPrimaryClass}
                  disabled={busy || draftSessions.length < 1}
                  onClick={() => void onContinue()}
                >
                  Continue to Review
                </button>
                <button
                  type="button"
                  className={btnSecondaryClass}
                  disabled={busy}
                  onClick={() => {
                    if (
                      draftSessions.length < 1 &&
                      !window.confirm(
                        'Continue without timeslots? Guests will not have bookable times until you add some later.'
                      )
                    ) {
                      return;
                    }
                    goToStep('review');
                  }}
                >
                  Skip schedule
                </button>
              </>
            ) : step === 'review' ? (
              <button
                type="button"
                className={btnPrimaryClass}
                disabled={busy}
                onClick={() => void onCommitProduct()}
              >
                {busy ? <ButtonSpinner /> : null}
                {committing || createMutation.isPending
                  ? 'Creating…'
                  : 'Create product'}
              </button>
            ) : (
              <button
                type="button"
                className={btnPrimaryClass}
                disabled={busy}
                onClick={() => void onContinue()}
              >
                {busy ? <ButtonSpinner /> : null}
                Continue
              </button>
            )}
            <Link href="/admin/ticketing" className={btnSecondaryClass}>
              Cancel
            </Link>
          </div>
        </div>
        ) : null}
      </div>
    </div>
  );
}
