'use client';

import { fieldClass } from '../ticketing/ticketingUi';

export const STAFF_CHANNELS = [
  {
    value: 'walk_in' as const,
    label: 'At venue (walk-in)',
    hint: 'Guest is at the park / front desk.',
  },
  {
    value: 'phone' as const,
    label: 'Phone',
    hint: 'Guest called in — you take the booking for them.',
  },
  {
    value: 'pos' as const,
    label: 'POS / front desk',
    hint: 'Counter sale on a till or POS terminal.',
  },
];

export type StaffChannel = (typeof STAFF_CHANNELS)[number]['value'];
export type HolderType = 'guest' | 'company';

export type BookingAccountOption = {
  id: string;
  name: string;
};

type Props = {
  staffChannel: StaffChannel;
  onChannel: (c: StaffChannel) => void;
  holderType: HolderType;
  onHolderType: (h: HolderType) => void;
  name: string;
  onName: (v: string) => void;
  email: string;
  onEmail: (v: string) => void;
  phone: string;
  onPhone: (v: string) => void;
  accountId: string;
  onAccountId: (v: string) => void;
  accounts: BookingAccountOption[];
  accountsLoading?: boolean;
  /** Company / B2B holder requires booking_accounts:read (or write). */
  allowCompanyHolder?: boolean;
};

/**
 * Details-tab holder: origin channel + Guest vs Company + contact fields.
 * Marketing opt-ins omitted — no Guest CRM marketing flags in schema.
 */
export default function BookingHolderForm({
  staffChannel,
  onChannel,
  holderType,
  onHolderType,
  name,
  onName,
  email,
  onEmail,
  phone,
  onPhone,
  accountId,
  onAccountId,
  accounts,
  accountsLoading,
  allowCompanyHolder = true,
}: Props) {
  const holderOptions = (
    [
      { value: 'guest' as const, label: 'Guest' },
      ...(allowCompanyHolder
        ? [{ value: 'company' as const, label: 'Company' }]
        : []),
    ] as const
  );

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm font-medium text-stone-800">
          How was this booking taken?
        </p>
        {STAFF_CHANNELS.map((c) => (
          <label
            key={c.value}
            className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-3 text-sm ${
              staffChannel === c.value
                ? 'border-[#D4AF37] bg-[#D4AF37]/10'
                : 'border-stone-200 hover:bg-stone-50'
            }`}
          >
            <input
              type="radio"
              className="mt-1"
              name="staffChannel"
              checked={staffChannel === c.value}
              onChange={() => onChannel(c.value)}
            />
            <span>
              <span className="block font-medium text-stone-900">{c.label}</span>
              <span className="mt-0.5 block text-xs text-stone-500">{c.hint}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-stone-800">Booking holder</p>
        <div className="flex flex-wrap gap-3">
          {holderOptions.map((h) => (
            <label
              key={h.value}
              className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                holderType === h.value
                  ? 'border-[#D4AF37] bg-[#D4AF37]/10'
                  : 'border-stone-200 hover:bg-stone-50'
              }`}
            >
              <input
                type="radio"
                name="holderType"
                checked={holderType === h.value}
                onChange={() => {
                  onHolderType(h.value);
                  if (h.value === 'guest') onAccountId('');
                }}
              />
              {h.label}
            </label>
          ))}
        </div>
        <p className="text-xs text-stone-500">
          These fields are for the guest or B2B company on the booking — not your
          staff login.
        </p>
      </div>

      {allowCompanyHolder && holderType === 'company' ? (
        <label className="block text-sm font-medium text-stone-800">
          Company account
          <select
            className={`${fieldClass} mt-1`}
            value={accountId}
            onChange={(e) => onAccountId(e.target.value)}
            disabled={accountsLoading}
          >
            <option value="">
              {accountsLoading ? 'Loading accounts…' : 'Select company'}
            </option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs font-normal text-stone-500">
            B2B booking company (corporate client), not your SaaS tenant.
          </span>
        </label>
      ) : null}

      <div className="space-y-3">
        <label className="block text-sm font-medium text-stone-800">
          {holderType === 'company' ? 'Contact name (optional)' : 'Guest name'}
          <input
            className={`${fieldClass} mt-1`}
            placeholder="e.g. Jane Guest"
            value={name}
            onChange={(e) => onName(e.target.value)}
            autoComplete="name"
          />
        </label>
        <label className="block text-sm font-medium text-stone-800">
          Email
          <input
            className={`${fieldClass} mt-1`}
            placeholder="guest@email.com"
            type="email"
            value={email}
            onChange={(e) => onEmail(e.target.value)}
            autoComplete="email"
          />
        </label>
        <label className="block text-sm font-medium text-stone-800">
          Phone
          <input
            className={`${fieldClass} mt-1`}
            placeholder="+1…"
            value={phone}
            onChange={(e) => onPhone(e.target.value)}
            autoComplete="tel"
          />
        </label>
        {holderType === 'guest' ? (
          <p className="text-xs text-stone-500">
            {staffChannel === 'phone'
              ? 'Phone bookings need an email or phone number (or a company account).'
              : 'Walk-in / POS: name is enough at the desk. Add email or phone if you will send a payment link or confirmation.'}
          </p>
        ) : (
          <p className="text-xs text-stone-500">
            Optional override contact on the booking. The company account covers
            billing when left blank.
          </p>
        )}
      </div>
    </div>
  );
}

export function initialStaffChannel(raw: string | null): StaffChannel {
  if (raw === 'phone' || raw === 'pos' || raw === 'walk_in') return raw;
  return 'walk_in';
}
