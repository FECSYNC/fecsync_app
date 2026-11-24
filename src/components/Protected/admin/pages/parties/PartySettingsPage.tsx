'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  BellRing,
  Building2,
  CalendarClock,
  Check,
  CircleAlert,
  Clock,
  PackageOpen,
  RotateCcw,
  Undo2,
  UsersRound,
  Wallet,
  X,
} from 'lucide-react';
import { useToast } from '@/contexts/toast-context';
import { useHqLocationFilter } from '@/hooks/useHqLocationFilter';
import { usePartySettingsQuery, usePatchPartySettingsMutation } from '@/hooks/useParties';
import {
  adminPartyKeys,
  getAdminPartySettings,
  partyFieldErrors,
  type PartySettingsDto,
  type PartySettingsValues,
} from '@/services/adminParties';
import {
  FieldError,
  PartiesErrorBanner,
  PartiesPageHeader,
  PartyScopeBanner,
  centsToInput,
  formatCents,
  inputToCents,
  useActiveVenues,
  usePartyCatalogPermissions,
} from './partiesUi';
import PartiesLiveStatus from './PartiesLiveStatus';
import { partyErrorMessage } from './partyFormat';

type Key = keyof PartySettingsValues;
type Form = Record<Key, string>;
type Kind = 'int' | 'bool' | 'money' | 'percent' | 'mode' | 'days';

type FieldDef = {
  key: Key;
  label: string;
  kind: Kind;
  help?: string;
  unit?: string;
  /** Field only matters when this returns true (shown dimmed otherwise). */
  activeWhen?: (f: Form) => boolean;
  inactiveHint?: string;
};

const SECTIONS: Array<{ id: string; title: string; blurb: string; icon: ReactNode; fields: FieldDef[] }> = [
  {
    id: 'deposits',
    title: 'Deposits',
    blurb: 'What guests pay up front to hold a party.',
    icon: <Wallet className="h-4 w-4" />,
    fields: [
      { key: 'defaultDepositPercent', label: 'Deposit as % of total', kind: 'percent', unit: '%', help: 'Leave empty to use a fixed amount instead.' },
      { key: 'defaultDepositFixedCents', label: 'Or a fixed deposit', kind: 'money', help: 'Use a percent or a fixed amount, not both.' },
      { key: 'depositDueMode', label: 'Deposit is due', kind: 'mode' },
      {
        key: 'depositDaysBefore',
        label: 'Days before the party',
        kind: 'int',
        unit: 'days',
        activeWhen: (f) => f.depositDueMode === 'days_before_event',
        inactiveHint: 'Used when the deposit is due “days before the event”.',
      },
      { key: 'requireDepositToConfirm', label: 'Require the deposit to confirm', kind: 'bool', help: 'Parties stay reserved until the deposit is paid.' },
      {
        key: 'allowConfirmWithoutDeposit',
        label: 'Staff can confirm without deposit',
        kind: 'bool',
        help: 'Staff must give a reason. Useful for trusted repeat customers.',
      },
    ],
  },
  {
    id: 'balance',
    title: 'Balance & reminders',
    blurb: 'When the rest is due and how guests are reminded.',
    icon: <CalendarClock className="h-4 w-4" />,
    fields: [
      { key: 'balanceDueMode', label: 'Balance is due', kind: 'mode' },
      {
        key: 'balanceDaysBefore',
        label: 'Days before the party',
        kind: 'int',
        unit: 'days',
        activeWhen: (f) => f.balanceDueMode === 'days_before_event',
        inactiveHint: 'Used when the balance is due “days before the event”.',
      },
      { key: 'sendBalanceReminder', label: 'Email balance reminders', kind: 'bool', help: 'Sent automatically before the balance is due.' },
      {
        key: 'balanceReminderDaysBefore',
        label: 'Remind guests',
        kind: 'days',
        help: 'Days before the due date.',
        activeWhen: (f) => f.sendBalanceReminder === '1',
        inactiveHint: 'Turn on balance reminders to choose when they go out.',
      },
    ],
  },
  {
    id: 'packages',
    title: 'Package defaults',
    blurb: 'Starting values for new party packages.',
    icon: <PackageOpen className="h-4 w-4" />,
    fields: [
      { key: 'defaultPartyDurationMinutes', label: 'Party length', kind: 'int', unit: 'min' },
      { key: 'defaultMinKids', label: 'Minimum kids', kind: 'int', unit: 'kids' },
      { key: 'defaultMaxKids', label: 'Maximum kids', kind: 'int', unit: 'kids' },
      { key: 'defaultIncludedAdults', label: 'Included adults', kind: 'int', unit: 'adults' },
    ],
  },
  {
    id: 'guests',
    title: 'Guests, food & hosts',
    blurb: 'What hosts can do online, and the cutoffs that protect your team.',
    icon: <UsersRound className="h-4 w-4" />,
    fields: [
      { key: 'allowOnlinePartyBooking', label: 'Online party booking', kind: 'bool', help: 'Guests can book parties from your booking pages.' },
      { key: 'allowHostEditGuestList', label: 'Hosts edit their guest list', kind: 'bool' },
      { key: 'allowHostEditFood', label: 'Hosts edit food', kind: 'bool' },
      { key: 'invitationExpiresHours', label: 'Invitations expire after', kind: 'int', unit: 'hours' },
      { key: 'foodOrderCutoffMinutes', label: 'Food cutoff before start', kind: 'int', unit: 'min', help: 'Later changes need a staff override.' },
      { key: 'hostCancelCutoffHours', label: 'Host can cancel until', kind: 'int', unit: 'hours before', help: 'After this, hosts must contact the venue.' },
    ],
  },
];
const ALL_FIELDS = SECTIONS.flatMap((s) => s.fields);
const FIELD = Object.fromEntries(ALL_FIELDS.map((f) => [f.key, f])) as Record<Key, FieldDef>;

const MODES = [
  { value: 'at_booking', label: 'At booking' },
  { value: 'days_before_event', label: 'Days before' },
  { value: 'on_arrival', label: 'On arrival' },
];

const SOURCE: Record<string, { label: string; className: string }> = {
  schema_default: { label: 'Built-in', className: 'bg-stone-100 text-stone-500' },
  org_default: { label: 'Company default', className: 'bg-sky-50 text-sky-700' },
  venue_override: { label: 'Venue override', className: 'bg-[#D4AF37]/20 text-[#7a5f10]' },
};

const fieldBase =
  'h-10 w-full rounded-lg border border-stone-200 bg-white px-3 text-sm text-stone-900 shadow-sm transition placeholder:text-stone-400 focus:border-[#D4AF37] focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/30 disabled:cursor-not-allowed disabled:bg-stone-50 disabled:text-stone-400';
const primaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-stone-950 shadow-sm transition hover:bg-[#c4a030] disabled:cursor-not-allowed disabled:opacity-60';
const ghostBtn =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:bg-stone-50 disabled:opacity-50';

function Spin({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return <span className={`inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} aria-hidden />;
}

function toForm(values: PartySettingsValues): Form {
  const out = {} as Form;
  for (const key of Object.keys(values) as Key[]) {
    const v = values[key];
    if (key === 'defaultDepositFixedCents') out[key] = centsToInput(v as number | null);
    else if (key === 'balanceReminderDaysBefore') out[key] = (v as number[]).join(', ');
    else if (typeof v === 'boolean') out[key] = v ? '1' : '';
    else out[key] = v == null ? '' : String(v);
  }
  return out;
}

function fromForm(def: FieldDef, raw: string): unknown {
  switch (def.kind) {
    case 'bool':
      return raw === '1';
    case 'money':
      return inputToCents(raw);
    case 'percent':
      return raw.trim() === '' ? null : Number(raw);
    case 'days':
      return parseDays(raw);
    case 'int':
      return Number(raw);
    default:
      return raw;
  }
}

function parseDays(raw: string): number[] {
  return [...new Set(raw.split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n >= 0))].sort((a, b) => b - a);
}

function modeSentence(mode: string, days: string, what: string) {
  if (mode === 'at_booking') return `${what} at booking`;
  if (mode === 'on_arrival') return `${what} on arrival`;
  const n = Number(days) || 0;
  return `${what} ${n} day${n === 1 ? '' : 's'} before the party`;
}

/** Plain-English summary of the policy as it stands in the form (updates while typing). */
function policySummary(f: Form): string[] {
  const pct = f.defaultDepositPercent.trim();
  const fixed = inputToCents(f.defaultDepositFixedCents);
  const deposit = pct ? `${pct}% deposit` : fixed ? `${formatCents(fixed)} deposit` : 'No deposit';
  const lines = [
    pct || fixed ? `${modeSentence(f.depositDueMode, f.depositDaysBefore, `Guests pay a ${deposit.toLowerCase()}`)}.` : 'No deposit is taken up front.',
    `${modeSentence(f.balanceDueMode, f.balanceDaysBefore, 'The balance is due')}.`,
  ];
  if (f.requireDepositToConfirm === '1' && (pct || fixed)) {
    lines.push(`Parties confirm once the deposit is paid${f.allowConfirmWithoutDeposit === '1' ? ' (staff can override with a reason)' : ''}.`);
  }
  if (f.sendBalanceReminder === '1') {
    const days = parseDays(f.balanceReminderDaysBefore);
    lines.push(days.length ? `Reminders go out ${days.join(', ')} day${days.length === 1 && days[0] === 1 ? '' : 's'} before the due date.` : 'Balance reminders are on, but no days are set.');
  }
  lines.push(
    f.allowOnlinePartyBooking === '1' ? 'Guests can book parties online.' : 'Parties are booked by staff only.',
    `Food locks ${f.foodOrderCutoffMinutes || 0} min before start; hosts can cancel until ${f.hostCancelCutoffHours || 0}h before.`
  );
  return lines;
}

/* ───────────────────────────── inputs ───────────────────────────── */

function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'bg-emerald-500' : 'bg-stone-300'}`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

function DaysEditor({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const days = parseDays(value);
  const [draft, setDraft] = useState('');
  const add = () => {
    const n = Number(draft);
    if (!Number.isInteger(n) || n < 0) return;
    onChange([...new Set([...days, n])].sort((a, b) => b - a).join(', '));
    setDraft('');
  };
  return (
    <div className={`flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2 py-1.5 shadow-sm ${disabled ? 'bg-stone-50 opacity-60' : ''}`}>
      {days.map((d) => (
        <span key={d} className="inline-flex items-center gap-1 rounded-full bg-[#D4AF37]/15 px-2 py-0.5 text-xs font-semibold text-[#7a5f10]">
          {d} day{d === 1 ? '' : 's'}
          {!disabled ? (
            <button
              type="button"
              onClick={() => onChange(days.filter((x) => x !== d).join(', '))}
              className="rounded-full p-0.5 hover:bg-[#D4AF37]/30"
              aria-label={`Remove ${d} days`}
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </span>
      ))}
      {!disabled ? (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          placeholder={days.length ? 'Add…' : 'e.g. 7, then Enter'}
          className="w-24 border-0 bg-transparent px-1 text-sm focus:outline-none"
          aria-label="Add reminder day"
        />
      ) : null}
    </div>
  );
}

function FieldInput({ def, form, setValue, disabled }: { def: FieldDef; form: Form; setValue: (k: Key, v: string) => void; disabled: boolean }) {
  const value = form[def.key];
  if (def.kind === 'mode') {
    return (
      <div className="inline-flex w-full rounded-lg border border-stone-200 bg-stone-50 p-0.5" role="radiogroup" aria-label={def.label}>
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={value === m.value}
            disabled={disabled}
            onClick={() => setValue(def.key, m.value)}
            className={`flex-1 rounded-md px-2 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed ${
              value === m.value ? 'bg-white text-stone-900 shadow-sm ring-1 ring-[#D4AF37]/50' : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
    );
  }
  if (def.kind === 'days') return <DaysEditor value={value} onChange={(v) => setValue(def.key, v)} disabled={disabled} />;
  const prefix = def.kind === 'money' ? '$' : null;
  return (
    <div className="relative">
      {prefix ? <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-stone-400">{prefix}</span> : null}
      <input
        disabled={disabled}
        inputMode={def.kind === 'money' || def.kind === 'percent' ? 'decimal' : 'numeric'}
        value={value}
        onChange={(e) => setValue(def.key, e.target.value.replace(def.kind === 'int' ? /[^\d]/g : /[^\d.]/g, ''))}
        placeholder={def.kind === 'percent' || def.kind === 'money' ? 'Not set' : '0'}
        className={`${fieldBase} tabular-nums ${prefix ? 'pl-7' : ''} ${def.unit ? 'pr-20' : ''}`}
      />
      {def.unit ? (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-stone-400">{def.unit}</span>
      ) : null}
    </div>
  );
}

/* ───────────────────────────── page ───────────────────────────── */

export default function PartySettingsPage() {
  const qc = useQueryClient();
  const { addToast } = useToast();
  const { canSettings } = usePartyCatalogPermissions();
  const { scopedLocationId, scopedLocationName, locationScoped } = useHqLocationFilter();
  const { venues } = useActiveVenues(scopedLocationId);
  const [venueId, setVenueId] = useState('');
  const effectiveVenue = scopedLocationId || venueId || null;
  // Company default is always loaded (same cache the desk warms). A venue only overrides a few
  // fields, so it paints instantly as the venue's placeholder while the overrides load.
  const orgQuery = usePartySettingsQuery(null);
  const venuePlaceholder = useMemo<PartySettingsDto | undefined>(() => {
    const org = orgQuery.data;
    if (!effectiveVenue || !org) return undefined;
    return { ...org, locationId: effectiveVenue, venueOverrideId: null };
  }, [orgQuery.data, effectiveVenue]);
  const settingsQuery = usePartySettingsQuery(effectiveVenue, venuePlaceholder);
  const patchMutation = usePatchPartySettingsMutation();
  const data = settingsQuery.data;
  const checkingVenue = Boolean(effectiveVenue && settingsQuery.isPlaceholderData);

  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [resetting, setResetting] = useState<Key | null>(null);
  const [remoteChanged, setRemoteChanged] = useState(false);
  /** Server values the form was last seeded from. */
  const baseline = useRef<Form | null>(null);

  const dirtyKeys = useMemo(() => {
    if (!form || !baseline.current) return [] as Key[];
    const base = baseline.current;
    return ALL_FIELDS.filter((f) => form[f.key] !== base[f.key]).map((f) => f.key);
  }, [form]);
  const dirty = dirtyKeys.length > 0;

  // Seed / re-seed from the server. Background refetches never wipe unsaved edits —
  // they raise a "changed elsewhere" notice instead.
  const seededFor = useRef<string | null | undefined>(undefined);
  /** True while the form shows the company-default placeholder for a venue. */
  const fromPlaceholder = useRef(false);
  useEffect(() => {
    if (!data) return;
    const next = toForm(data.values);
    const venueChanged = seededFor.current !== effectiveVenue;
    const unchanged = baseline.current && JSON.stringify(next) === JSON.stringify(baseline.current);
    if (venueChanged || !dirty) {
      seededFor.current = effectiveVenue;
      baseline.current = next;
      setForm(next);
      setRemoteChanged(false);
    } else if (fromPlaceholder.current && !settingsQuery.isPlaceholderData) {
      // Real venue values landed while the user was already editing the placeholder:
      // rebase their edits onto the venue's actual values instead of flagging a conflict.
      const edits = Object.fromEntries(dirtyKeys.map((k) => [k, form![k]]));
      baseline.current = next;
      setForm({ ...next, ...edits });
    } else if (!unchanged) {
      setRemoteChanged(true);
    }
    fromPlaceholder.current = settingsQuery.isPlaceholderData;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, effectiveVenue, settingsQuery.isPlaceholderData]);

  const setValue = (k: Key, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const loadLatest = () => {
    if (!data) return;
    const next = toForm(data.values);
    baseline.current = next;
    setForm(next);
    setRemoteChanged(false);
    setErrors({});
  };

  const discard = () => {
    if (!baseline.current) return;
    setForm(baseline.current);
    setErrors({});
  };

  const warmVenue = (id: string | null) =>
    void qc
      .prefetchQuery({ queryKey: adminPartyKeys.settings(id), queryFn: () => getAdminPartySettings(id), staleTime: 30_000 })
      .catch(() => undefined);

  const switchVenue = (id: string) => {
    if (id === venueId) return;
    if (dirty && !window.confirm('Discard your unsaved changes and switch?')) return;
    setErrors({});
    setVenueId(id);
  };

  const conflict = Boolean(form && form.defaultDepositPercent.trim() && inputToCents(form.defaultDepositFixedCents));
  const pctBad = Boolean(form && form.defaultDepositPercent.trim() && !(Number(form.defaultDepositPercent) >= 0 && Number(form.defaultDepositPercent) <= 100));

  const applySaved = (saved: PartySettingsDto) => {
    qc.setQueryData(adminPartyKeys.settings(effectiveVenue), saved);
    const next = toForm(saved.values);
    baseline.current = next;
    setForm(next);
    setRemoteChanged(false);
  };

  const onSave = async () => {
    if (!form || !dirty) return;
    if (conflict) return addToast('Use a deposit percent or a fixed amount, not both', 'error');
    if (pctBad) return addToast('The deposit percent must be between 0 and 100', 'error');
    const values: Record<string, unknown> = {};
    for (const key of dirtyKeys) values[key] = fromForm(FIELD[key], form[key]);
    setErrors({});
    try {
      const saved = await patchMutation.mutateAsync({ locationId: effectiveVenue, values: values as Partial<PartySettingsValues> });
      applySaved(saved);
      addToast(effectiveVenue ? 'Venue settings saved' : 'Company defaults saved — every venue without an override uses them now', 'success');
    } catch (err) {
      setErrors(partyFieldErrors(err));
      addToast(partyErrorMessage(err, 'Could not save settings'), 'error');
    }
  };

  const onReset = async (key: Key) => {
    if (!effectiveVenue) return;
    setResetting(key);
    try {
      const saved = await patchMutation.mutateAsync({ locationId: effectiveVenue, resetFields: [key] });
      // Keep other unsaved edits; only this field follows the company default again.
      const next = toForm(saved.values);
      qc.setQueryData(adminPartyKeys.settings(effectiveVenue), saved);
      if (baseline.current) baseline.current = { ...baseline.current, [key]: next[key] };
      setForm((f) => (f ? { ...f, [key]: next[key] } : f));
      addToast(`${FIELD[key].label}: back to the company default`, 'success');
    } catch (err) {
      addToast(partyErrorMessage(err, 'Could not reset the field'), 'error');
    } finally {
      setResetting(null);
    }
  };

  const overrideCount = data ? (Object.values(data.sources) as string[]).filter((s) => s === 'venue_override').length : 0;
  const venueName = venues.find((v) => v.id === effectiveVenue)?.name;
  const firstLoad = !form || !data;
  const canEdit = canSettings;

  return (
    <div className="space-y-5 pb-4">
      <PartiesPageHeader
        title="Party settings"
        description={
          <div className="space-y-1">
            <p>Company-wide rules for deposits, balances and what hosts can do. Override any field for a single venue.</p>
            <PartiesLiveStatus
              fetching={settingsQuery.isFetching}
              updatedAt={settingsQuery.dataUpdatedAt}
              failed={Boolean(settingsQuery.error)}
              onRefresh={() => void settingsQuery.refetch()}
            />
          </div>
        }
      />
      <PartyScopeBanner locationScoped={locationScoped} locationName={scopedLocationName} />
      <PartiesErrorBanner error={settingsQuery.error} />

      {/* Scope */}
      <section className="rounded-xl border border-stone-200 bg-white p-3 shadow-sm">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">You are editing</p>
        <div className="flex flex-wrap gap-2">
          {!scopedLocationId ? (
            <button
              type="button"
              onMouseEnter={() => warmVenue(null)}
              onClick={() => switchVenue('')}
              aria-pressed={!venueId}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                !venueId ? 'border-[#D4AF37] bg-[#D4AF37]/10 text-stone-900' : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300'
              }`}
            >
              <Building2 className="h-4 w-4" />
              Company default
              <span className="text-xs font-normal text-stone-500">all venues</span>
            </button>
          ) : null}
          {venues.map((v) => {
            const active = effectiveVenue === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onMouseEnter={() => warmVenue(v.id)}
                onClick={() => switchVenue(v.id)}
                disabled={Boolean(scopedLocationId)}
                aria-pressed={active}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition disabled:cursor-default ${
                  active ? 'border-[#D4AF37] bg-[#D4AF37]/10 text-stone-900' : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300'
                }`}
              >
                {active && (checkingVenue || (settingsQuery.isFetching && !data)) ? <Spin className="h-3.5 w-3.5 text-[#D4AF37]" /> : null}
                {v.name}
                {active && overrideCount ? (
                  <span className="rounded-full bg-[#D4AF37]/25 px-1.5 text-[11px] font-semibold text-[#7a5f10]">{overrideCount} override{overrideCount === 1 ? '' : 's'}</span>
                ) : null}
              </button>
            );
          })}
        </div>
        {effectiveVenue ? (
          <p className="mt-2 text-xs text-stone-500">
            Changes here apply only to {venueName ?? 'this venue'}. Fields you don&apos;t change keep following the company default.
          </p>
        ) : null}
      </section>

      {remoteChanged ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
          <span className="inline-flex items-center gap-2">
            <BellRing className="h-4 w-4" />
            These settings were changed elsewhere (another tab or teammate).
          </span>
          <button type="button" className="font-semibold underline" onClick={loadLatest}>
            Load latest (discards your edits)
          </button>
        </div>
      ) : null}

      {firstLoad ? (
        <div className="space-y-4" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-4 rounded-2xl border border-stone-200 bg-white p-5">
              <div className="h-4 w-40 animate-pulse rounded bg-stone-200" />
              <div className="grid gap-4 sm:grid-cols-2">
                {Array.from({ length: 4 }).map((__, j) => (
                  <div key={j} className="space-y-2">
                    <div className="h-3 w-28 animate-pulse rounded bg-stone-100" />
                    <div className="h-10 animate-pulse rounded-lg bg-stone-100" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="space-y-4">
            {checkingVenue ? (
              <p className="flex items-center gap-2 rounded-lg bg-[#D4AF37]/10 px-3 py-2 text-xs text-stone-700">
                <Spin className="h-3.5 w-3.5 text-[#D4AF37]" />
                Showing the company defaults while {venueName ?? 'this venue'}&apos;s overrides load — you can start editing.
              </p>
            ) : null}
            {SECTIONS.map((section) => (
              <section key={section.id} className="rounded-2xl border border-stone-200 bg-white shadow-sm">
                <header className="flex items-center gap-3 border-b border-stone-100 px-5 py-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#D4AF37]/15 text-[#8a6d12]">{section.icon}</span>
                  <div>
                    <h2 className="text-sm font-semibold text-stone-900">{section.title}</h2>
                    <p className="text-xs text-stone-500">{section.blurb}</p>
                  </div>
                </header>
                <div className="grid gap-x-6 gap-y-5 p-5 md:grid-cols-2">
                  {section.fields.map((f) => {
                    const source = SOURCE[data.sources[f.key]] ?? SOURCE.schema_default!;
                    const overridden = data.sources[f.key] === 'venue_override';
                    const changed = dirtyKeys.includes(f.key);
                    const active = f.activeWhen ? f.activeWhen(form) : true;
                    const bool = f.kind === 'bool';
                    return (
                      <div
                        key={f.key}
                        className={`relative space-y-1.5 rounded-lg ${changed ? 'before:absolute before:-left-3 before:top-1 before:h-[calc(100%-0.5rem)] before:w-0.5 before:rounded-full before:bg-[#D4AF37]' : ''} ${
                          active ? '' : 'opacity-50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <label className="text-sm font-medium text-stone-800">
                            {f.label}
                            {changed ? <span className="ml-1.5 text-[11px] font-semibold text-[#8a6d12]">• edited</span> : null}
                          </label>
                          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${source.className}`}>{source.label}</span>
                        </div>
                        {bool ? (
                          <div className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-stone-50/60 px-3 py-2">
                            <span className="text-xs text-stone-500">{f.help ?? (form[f.key] === '1' ? 'On' : 'Off')}</span>
                            <Toggle
                              on={form[f.key] === '1'}
                              onChange={(v) => setValue(f.key, v ? '1' : '')}
                              disabled={!canEdit}
                              label={f.label}
                            />
                          </div>
                        ) : (
                          <>
                            <FieldInput def={f} form={form} setValue={setValue} disabled={!canEdit || !active} />
                            {!active && f.inactiveHint ? (
                              <p className="text-xs text-stone-500">{f.inactiveHint}</p>
                            ) : f.help ? (
                              <p className="text-xs text-stone-500">{f.help}</p>
                            ) : null}
                          </>
                        )}
                        {f.key === 'defaultDepositFixedCents' && conflict ? (
                          <p className="flex items-center gap-1 text-xs font-medium text-red-700">
                            <CircleAlert className="h-3.5 w-3.5" />
                            Clear either the percent or the fixed amount.
                          </p>
                        ) : null}
                        {f.key === 'defaultDepositPercent' && pctBad ? (
                          <p className="flex items-center gap-1 text-xs font-medium text-red-700">
                            <CircleAlert className="h-3.5 w-3.5" />
                            Must be between 0 and 100.
                          </p>
                        ) : null}
                        <FieldError message={errors[f.key]} />
                        {effectiveVenue && overridden && canEdit ? (
                          <button
                            type="button"
                            onClick={() => void onReset(f.key)}
                            disabled={resetting === f.key}
                            className="inline-flex items-center gap-1 text-xs font-medium text-[#8a6d12] hover:underline disabled:opacity-60"
                          >
                            {resetting === f.key ? <Spin className="h-3 w-3" /> : <RotateCcw className="h-3 w-3" />}
                            Use company default
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          {/* Live policy summary */}
          <aside className="h-fit space-y-3 rounded-2xl border border-[#D4AF37]/40 bg-gradient-to-b from-[#D4AF37]/10 to-white p-4 shadow-sm xl:sticky xl:top-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-stone-900">
              <Clock className="h-4 w-4 text-[#8a6d12]" />
              Your party policy
            </h3>
            <p className="text-xs text-stone-500">{effectiveVenue ? `For ${venueName ?? 'this venue'}` : 'Company default'} · updates as you edit</p>
            <ul className="space-y-2 text-sm text-stone-700">
              {policySummary(form).map((line) => (
                <li key={line} className="flex gap-2">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      )}

      {/* Sticky save bar */}
      {canEdit && dirty ? (
        <div className="sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white/95 px-4 py-3 shadow-[0_12px_30px_-12px_rgba(28,25,23,0.45)] backdrop-blur">
          <span className="text-sm text-stone-700">
            <strong>{dirtyKeys.length}</strong> unsaved change{dirtyKeys.length === 1 ? '' : 's'}
            {effectiveVenue ? ` for ${venueName ?? 'this venue'}` : ' to the company default'}
          </span>
          <div className="flex gap-2">
            <button type="button" className={ghostBtn} onClick={discard} disabled={patchMutation.isPending}>
              <Undo2 className="h-4 w-4" />
              Discard
            </button>
            <button
              type="button"
              className={primaryBtn}
              onClick={() => void onSave()}
              disabled={patchMutation.isPending || conflict || pctBad || checkingVenue}
            >
              {(patchMutation.isPending && !resetting) || checkingVenue ? <Spin className="h-4 w-4" /> : <Check className="h-4 w-4" />}
              {checkingVenue ? 'Loading venue…' : patchMutation.isPending && !resetting ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
