'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { Loader2, Upload, X } from 'lucide-react';
import {
  CAMPAIGN_STATUSES,
  DEFAULT_CAMPAIGN_CATEGORIES,
  type CampaignInput,
  type MeasurementCampaignDto,
} from '@/lib/measurementCampaigns.shared';
import { uploadCampaignMedia } from '@/services/measurementCampaigns';
import { useToast } from '@/contexts/toast-context';
import { useMyTailorQuery } from '@/hooks/useTailors';
import { softGateBlockedMessage } from '@/utils/planLimitSoftGate';

type CampaignFormModalProps = {
  open: boolean;
  onClose: () => void;
  initial?: MeasurementCampaignDto | null;
  onSubmit: (payload: CampaignInput) => Promise<void>;
  busy?: boolean;
  /** Remaining campaign slots; Infinity/null = unlimited. */
  remainingCampaigns?: number | null;
  planLimit?: number | null;
  /** Mirrors usage API planResolved for toast copy. */
  planResolved?: string | null;
  /** False when unpaid / approve-without-plan. */
  billingEntitled?: boolean;
};

function toDateInput(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function emptyForm(): CampaignInput {
  const today = new Date().toISOString().slice(0, 10);
  return {
    name: '',
    category: 'Other',
    description: '',
    eventDate: '',
    venue: '',
    startDate: today,
    expiryDate: '',
    status: 'draft',
    instructions: '',
    sponsoredScansPerInvitee: 0,
    logoUrl: '',
    coverImageUrl: '',
  };
}

export default function CampaignFormModal({
  open,
  onClose,
  initial,
  onSubmit,
  busy,
  remainingCampaigns = null,
  planLimit = null,
  planResolved = null,
  billingEntitled,
}: CampaignFormModalProps) {
  const { addToast } = useToast();
  const { data: tailor } = useMyTailorQuery();
  /** Only lock Active once we know the profile is not approved (avoid flicker while loading). */
  const publishBlocked = tailor != null && tailor.status !== 'approved';
  const createBlocked =
    !initial &&
    remainingCampaigns != null &&
    Number.isFinite(remainingCampaigns) &&
    remainingCampaigns <= 0;
  const unarchiveBlocked =
    initial?.status === 'archived' &&
    remainingCampaigns != null &&
    Number.isFinite(remainingCampaigns) &&
    remainingCampaigns <= 0;
  const zeroCap = planLimit === 0;
  const planUsage = { billingEntitled, planResolved };
  const campaignsBlockedMsg = softGateBlockedMessage(planUsage, 'campaigns', {
    atLimit: true,
    zeroCap,
  });
  const [form, setForm] = useState<CampaignInput>(emptyForm());
  const [customCategory, setCustomCategory] = useState('');
  const [extraCategories, setExtraCategories] = useState<string[]>([]);
  const [uploading, setUploading] = useState<'logo' | 'cover' | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setForm({
        name: initial.name,
        category: initial.category,
        description: initial.description ?? '',
        eventDate: toDateInput(initial.eventDate),
        venue: initial.venue ?? '',
        startDate: toDateInput(initial.startDate),
        expiryDate: toDateInput(initial.expiryDate),
        // Keep expired as expired — do not silently rewrite to archived on edit.
        status: initial.status,
        instructions: initial.instructions ?? '',
        sponsoredScansPerInvitee: initial.sponsoredScansPerInvitee,
        logoUrl: initial.logoUrl ?? '',
        coverImageUrl: initial.coverImageUrl ?? '',
      });
      setExtraCategories(initial.customCategories ?? []);
    } else {
      setForm(emptyForm());
      setExtraCategories([]);
    }
    setCustomCategory('');
    setUploading(null);
  }, [open, initial]);

  if (!open) return null;

  const categories = [
    ...DEFAULT_CAMPAIGN_CATEGORIES,
    ...extraCategories.filter(
      (c) => !(DEFAULT_CAMPAIGN_CATEGORIES as readonly string[]).includes(c)
    ),
  ];

  const uploadImage = async (kind: 'logo' | 'cover', file: File | null) => {
    if (!file) return;
    setUploading(kind);
    try {
      const url = await uploadCampaignMedia(file, kind);
      setForm((prev) =>
        kind === 'logo'
          ? { ...prev, logoUrl: url }
          : { ...prev, coverImageUrl: url }
      );
      addToast(
        kind === 'logo' ? 'Logo uploaded' : 'Cover image uploaded',
        'success'
      );
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Upload failed',
        'error'
      );
    } finally {
      setUploading(null);
    }
  };

  const imageField = (
    kind: 'logo' | 'cover',
    label: string,
    url: string | undefined,
    inputRef: RefObject<HTMLInputElement | null>
  ) => (
    <div className="block text-sm">
      <span className="font-medium text-stone-800">{label}</span>
      {url ? (
        <div className="mt-2 overflow-hidden rounded-xl border border-stone-200 bg-stone-50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={label}
            className="h-24 w-full object-contain bg-white"
          />
        </div>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null;
          void uploadImage(kind, file);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        disabled={uploading !== null || busy}
        onClick={() => inputRef.current?.click()}
        className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-stone-200 px-3 py-2.5 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-50"
      >
        {uploading === kind ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <Upload size={16} />
        )}
        {url ? 'Replace image' : 'Upload'}
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="campaign-form-title"
        className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between border-b border-stone-100 px-5 py-4">
          <div>
            <h2
              id="campaign-form-title"
              className="text-lg font-semibold text-stone-900"
            >
              {initial ? 'Edit campaign' : 'Create campaign'}
            </h2>
            <p className="mt-1 text-xs text-stone-500">
              {initial
                ? 'Update campaign details. AI scans are charged separately.'
                : createBlocked
                  ? billingEntitled === false || zeroCap
                    ? campaignsBlockedMsg
                    : `Campaign limit reached${planLimit != null ? ` (${planLimit})` : ''} on your company plan.`
                  : remainingCampaigns != null && Number.isFinite(remainingCampaigns)
                    ? `${remainingCampaigns} campaign slot${remainingCampaigns === 1 ? '' : 's'} remaining on your company plan. AI scans are charged separately.`
                    : 'Campaigns count toward your company plan. AI scans are charged separately.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-stone-500 hover:bg-stone-100"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <form
          id="campaign-form"
          className="overflow-y-auto px-5 py-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!initial && createBlocked) {
              addToast(
                campaignsBlockedMsg ??
                  `Plan limit reached for campaigns on the ${planResolved ?? 'current'} plan`,
                'error'
              );
              return;
            }
            if (
              initial?.status === 'archived' &&
              form.status !== 'archived' &&
              unarchiveBlocked
            ) {
              addToast(
                campaignsBlockedMsg ??
                  `Plan limit reached for campaigns on the ${planResolved ?? 'current'} plan`,
                'error'
              );
              return;
            }
            if (form.status === 'active' && publishBlocked) {
              addToast(
                'Your tailor profile must be approved before publishing a campaign',
                'error'
              );
              return;
            }
            void onSubmit(form);
          }}
        >
          <label className="block text-sm">
            <span className="font-medium text-stone-800">
              Campaign name <span className="text-red-500">*</span>
            </span>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Toni + Mary Wedding 2026"
              className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5"
            />
          </label>

          <div className="block text-sm">
            <span className="font-medium text-stone-800">Category</span>
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5"
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <div className="mt-2 flex gap-2">
              <input
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                placeholder="Add your own category"
                className="flex-1 rounded-xl border border-stone-200 px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() => {
                  const trimmed = customCategory.trim();
                  if (!trimmed) return;
                  setExtraCategories((prev) =>
                    prev.includes(trimmed) ? prev : [...prev, trimmed]
                  );
                  setForm({ ...form, category: trimmed });
                  setCustomCategory('');
                }}
                className="rounded-xl border border-stone-200 px-3 py-2 text-sm font-medium"
              >
                Add
              </button>
            </div>
          </div>

          <label className="block text-sm">
            <span className="font-medium text-stone-800">Description</span>
            <textarea
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              rows={3}
              className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5"
            />
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium text-stone-800">Event date</span>
              <input
                type="date"
                value={form.eventDate}
                onChange={(e) =>
                  setForm({ ...form, eventDate: e.target.value })
                }
                className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-stone-800">Venue</span>
              <input
                value={form.venue}
                onChange={(e) => setForm({ ...form, venue: e.target.value })}
                className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium text-stone-800">
                Start date <span className="text-red-500">*</span>
              </span>
              <input
                required
                type="date"
                value={form.startDate}
                onChange={(e) =>
                  setForm({ ...form, startDate: e.target.value })
                }
                className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-stone-800">Expiry date</span>
              <input
                type="date"
                value={form.expiryDate}
                onChange={(e) =>
                  setForm({ ...form, expiryDate: e.target.value })
                }
                className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5"
              />
            </label>
          </div>

          <label className="block text-sm">
            <span className="font-medium text-stone-800">Status</span>
            <select
              value={form.status}
              onChange={(e) => {
                const next = e.target.value as CampaignInput['status'];
                if (next === 'active' && publishBlocked) {
                  addToast(
                    'Your tailor profile must be approved before publishing a campaign',
                    'error'
                  );
                  return;
                }
                if (
                  initial?.status === 'archived' &&
                  next !== 'archived' &&
                  unarchiveBlocked
                ) {
                  addToast(
                    campaignsBlockedMsg ??
                      `Plan limit reached for campaigns on the ${planResolved ?? 'current'} plan`,
                    'error'
                  );
                  return;
                }
                setForm({ ...form, status: next });
              }}
              className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5"
            >
              {CAMPAIGN_STATUSES.filter(
                (s) => s !== 'expired' || form.status === 'expired'
              ).map((s) => (
                <option
                  key={s}
                  value={s}
                  disabled={
                    (s === 'active' && publishBlocked) ||
                    s === 'expired' ||
                    (initial?.status === 'archived' &&
                      s !== 'archived' &&
                      unarchiveBlocked)
                  }
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                  {s === 'active' && publishBlocked ? ' (approval required)' : ''}
                  {s === 'expired' ? ' (set by expiry date)' : ''}
                  {initial?.status === 'archived' &&
                  s !== 'archived' &&
                  unarchiveBlocked
                    ? ' (plan limit)'
                    : ''}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-stone-500">
              {unarchiveBlocked
                ? 'This campaign is archived and your plan has no free slots. Archive another campaign first to restore it.'
                : publishBlocked
                ? 'Draft and archived are available now. Active publishing unlocks after your tailor profile is approved.'
                : 'Set to Active to open the public join link for customers. Past expiry dates move Active campaigns to Expired automatically.'}
            </p>
          </label>

          <label className="block text-sm">
            <span className="font-medium text-stone-800">
              Instructions for participants
            </span>
            <textarea
              value={form.instructions}
              onChange={(e) =>
                setForm({ ...form, instructions: e.target.value })
              }
              rows={4}
              placeholder="Tell invitees how to submit measurements…"
              className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5"
            />
          </label>

          <label className="block text-sm">
            <span className="font-medium text-stone-800">
              Sponsored AI scans per invitee
            </span>
            <input
              type="number"
              min={0}
              max={100}
              value={form.sponsoredScansPerInvitee}
              onChange={(e) =>
                setForm({
                  ...form,
                  sponsoredScansPerInvitee: Number(e.target.value) || 0,
                })
              }
              className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5"
            />
            <p className="mt-1 text-xs text-stone-500">
              How many AI scans each newly invited or joining person can use from
              this campaign&apos;s credit wallet. Set 0 for none. Existing
              participants keep their current allocation.
            </p>
          </label>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {imageField('logo', 'Campaign logo', form.logoUrl, logoInputRef)}
            {imageField(
              'cover',
              'Cover image',
              form.coverImageUrl,
              coverInputRef
            )}
          </div>
        </form>

        <div className="flex justify-end gap-2 border-t border-stone-100 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="campaign-form"
            disabled={
              busy ||
              uploading !== null ||
              createBlocked ||
              (Boolean(initial) &&
                initial?.status === 'archived' &&
                form.status !== 'archived' &&
                unarchiveBlocked)
            }
            className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy
              ? 'Saving…'
              : initial
                ? 'Save changes'
                : createBlocked
                  ? 'Limit reached'
                  : 'Create campaign'}
          </button>
        </div>
      </div>
    </div>
  );
}
