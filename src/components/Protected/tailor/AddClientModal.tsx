'use client';

import { useEffect, useState } from 'react';
import { Upload, X } from 'lucide-react';
import { useToast } from '@/contexts/toast-context';
import { useCreateTailorClientMutation } from '@/hooks/useMeasurementCampaigns';
import type { TailorClientInput } from '@/lib/measurementCampaigns.shared';

type AddClientModalProps = {
  open: boolean;
  onClose: () => void;
  remaining?: number;
  onSaved?: () => void;
};

type FormState = TailorClientInput & {
  heightUnit: 'ft' | 'cm';
  weightUnit: 'lb' | 'kg';
  heightFt: string;
  heightIn: string;
  heightCm: string;
  weight: string;
  bodyShape: string;
};

const BODY_SHAPES: Record<'male' | 'female', string[]> = {
  male: ['Rectangle', 'Inverted triangle', 'Oval', 'Trapezoid', 'Triangle'],
  female: ['Hourglass', 'Pear', 'Apple', 'Rectangle', 'Inverted triangle'],
};

const emptyForm = (): FormState => ({
  name: '',
  email: '',
  phone: '',
  gender: undefined,
  garmentOccasion: '',
  notes: '',
  heightUnit: 'ft',
  weightUnit: 'lb',
  heightFt: '',
  heightIn: '',
  heightCm: '',
  weight: '',
  bodyShape: '',
});

function parseVcf(text: string): { name?: string; phone?: string } {
  const nameMatch = text.match(/^FN:(.+)$/im);
  const phoneMatch = text.match(/^TEL(?:;[^:]*)?:(.+)$/im);
  return {
    name: nameMatch?.[1]?.trim().replace(/\\,/g, ','),
    phone: phoneMatch?.[1]?.trim(),
  };
}

export default function AddClientModal({
  open,
  onClose,
  // Fail-closed when parent omits remaining (API still enforces).
  remaining = 0,
  onSaved,
}: AddClientModalProps) {
  const { addToast } = useToast();
  const createMut = useCreateTailorClientMutation();
  const [form, setForm] = useState<FormState>(emptyForm());
  const [slotsLeft, setSlotsLeft] = useState(remaining);
  const unlimited = !Number.isFinite(remaining) || remaining === Number.POSITIVE_INFINITY;

  useEffect(() => {
    if (!open) setForm(emptyForm());
    else setSlotsLeft(remaining);
  }, [open, remaining]);

  if (!open) return null;

  const shapes =
    form.gender === 'male' || form.gender === 'female'
      ? BODY_SHAPES[form.gender]
      : [];

  const buildPayload = (): TailorClientInput => {
    const vitals: NonNullable<TailorClientInput['vitals']> = {
      heightUnit: form.heightUnit,
      weightUnit: form.weightUnit,
    };
    if (form.heightUnit === 'ft') {
      if (form.heightFt.trim()) vitals.heightFt = Number(form.heightFt);
      if (form.heightIn.trim()) vitals.heightIn = Number(form.heightIn);
    } else if (form.heightCm.trim()) {
      vitals.heightCm = Number(form.heightCm);
    }
    if (form.weight.trim()) vitals.weight = Number(form.weight);
    if (form.bodyShape.trim()) vitals.bodyShape = form.bodyShape.trim();

    const hasMeasure =
      vitals.heightFt != null ||
      vitals.heightIn != null ||
      vitals.heightCm != null ||
      vitals.weight != null ||
      Boolean(vitals.bodyShape);

    return {
      name: form.name.trim(),
      email: form.email?.trim() || undefined,
      phone: form.phone?.trim() || undefined,
      gender: form.gender,
      garmentOccasion: form.garmentOccasion?.trim() || undefined,
      notes: form.notes?.trim() || undefined,
      vitals: hasMeasure ? vitals : undefined,
    };
  };

  const save = async (another: boolean) => {
    if (!form.name.trim()) {
      addToast('Name is required', 'error');
      return;
    }
    try {
      await createMut.mutateAsync(buildPayload());
      addToast('Client saved', 'success');
      onSaved?.();
      const nextRemaining = unlimited
        ? Number.POSITIVE_INFINITY
        : Math.max(0, slotsLeft - 1);
      setSlotsLeft(nextRemaining);
      if (another && (unlimited || nextRemaining > 0)) {
        setForm(emptyForm());
      } else {
        onClose();
      }
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Could not save client',
        'error'
      );
    }
  };

  const onVcf = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseVcf(text);
      if (!parsed.name && !parsed.phone) {
        addToast('No name or phone found in that contact file', 'error');
        return;
      }
      setForm((prev) => ({
        ...prev,
        name: parsed.name || prev.name,
        phone: parsed.phone || prev.phone,
      }));
      addToast('Contact details filled in — review and save', 'success');
    } catch {
      addToast('Could not read that file', 'error');
    }
  };

  const unitToggle = (
    value: string,
    options: string[],
    onPick: (next: string) => void
  ) => (
    <div className="flex rounded-lg border border-stone-200 p-0.5 text-xs">
      {options.map((u) => (
        <button
          key={u}
          type="button"
          onClick={() => onPick(u)}
          className={`rounded-md px-2.5 py-0.5 font-medium ${
            value === u ? 'bg-stone-900 text-white' : 'text-stone-600'
          }`}
        >
          {u}
        </button>
      ))}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-client-title"
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between px-5 pt-4">
          <h2 id="add-client-title" className="text-lg font-semibold text-stone-900">
            Add a client
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-stone-500 hover:bg-stone-100"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-stone-200 px-4 py-2.5 text-sm font-medium text-stone-800 hover:bg-stone-50">
              <Upload size={16} />
              Import .vcf file
              <input
                type="file"
                accept=".vcf,text/vcard,text/x-vcard"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  void onVcf(file);
                  e.target.value = '';
                }}
              />
            </label>
            <p className="mt-2 text-center text-xs text-stone-500">
              Export contacts as a .vcf file from your phone or Google Contacts.
              {unlimited
                ? ' Unlimited client slots on your company plan.'
                : ` You can add ${slotsLeft} more.`}
            </p>
          </div>

          <div className="relative py-1">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-stone-200" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-white px-2 text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                Or add manually
              </span>
            </div>
          </div>

          <label className="block text-sm">
            <span className="font-medium text-stone-800">Name</span>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5"
            />
          </label>

          <label className="block text-sm">
            <span className="font-medium text-stone-800">Email (optional)</span>
            <input
              type="email"
              value={form.email ?? ''}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="For campaign invites"
              className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5"
            />
          </label>

          <label className="block text-sm">
            <span className="font-medium text-stone-800">Phone (optional)</span>
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="e.g. +1 415 555 1234"
              className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5"
            />
          </label>

          <div className="block text-sm">
            <span className="font-medium text-stone-800">Gender</span>
            <div className="mt-2 flex gap-2">
              {(['male', 'female'] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() =>
                    setForm({
                      ...form,
                      gender: g,
                      bodyShape: '',
                    })
                  }
                  className={`flex-1 rounded-xl border px-3 py-2.5 capitalize ${
                    form.gender === g
                      ? 'border-stone-900 bg-stone-900 text-white'
                      : 'border-stone-200 text-stone-700'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          <label className="block text-sm">
            <span className="font-medium text-stone-800">
              Garment / occasion (optional)
            </span>
            <input
              value={form.garmentOccasion}
              onChange={(e) =>
                setForm({ ...form, garmentOccasion: e.target.value })
              }
              placeholder="e.g. wedding suit"
              className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5"
            />
          </label>

          <label className="block text-sm">
            <span className="font-medium text-stone-800">Notes (optional)</span>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Fabric preferences, deadlines, fit notes..."
              rows={3}
              className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5"
            />
          </label>

          <fieldset className="rounded-xl border border-stone-200 p-4 space-y-4">
            <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-stone-400">
              Vitals (optional)
            </legend>

            <div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-stone-800">Height</span>
                {unitToggle(form.heightUnit, ['ft', 'cm'], (u) =>
                  setForm({ ...form, heightUnit: u as 'ft' | 'cm' })
                )}
              </div>
              {form.heightUnit === 'ft' ? (
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <label className="flex items-center gap-2">
                    <input
                      inputMode="numeric"
                      value={form.heightFt}
                      onChange={(e) =>
                        setForm({ ...form, heightFt: e.target.value })
                      }
                      className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm"
                    />
                    <span className="text-sm text-stone-500">ft</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      inputMode="numeric"
                      value={form.heightIn}
                      onChange={(e) =>
                        setForm({ ...form, heightIn: e.target.value })
                      }
                      className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm"
                    />
                    <span className="text-sm text-stone-500">in</span>
                  </label>
                </div>
              ) : (
                <input
                  inputMode="numeric"
                  value={form.heightCm}
                  onChange={(e) =>
                    setForm({ ...form, heightCm: e.target.value })
                  }
                  placeholder="cm"
                  className="mt-2 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm"
                />
              )}
            </div>

            <div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-stone-800">Weight</span>
                {unitToggle(form.weightUnit, ['lb', 'kg'], (u) =>
                  setForm({ ...form, weightUnit: u as 'lb' | 'kg' })
                )}
              </div>
              <input
                inputMode="numeric"
                value={form.weight}
                onChange={(e) => setForm({ ...form, weight: e.target.value })}
                placeholder={form.weightUnit}
                className="mt-2 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <span className="text-sm font-medium text-stone-800">
                Body shape
              </span>
              {!shapes.length ? (
                <p className="mt-1 text-xs text-stone-500">
                  Select a gender above to see body shapes.
                </p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {shapes.map((shape) => (
                    <button
                      key={shape}
                      type="button"
                      onClick={() => setForm({ ...form, bodyShape: shape })}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                        form.bodyShape === shape
                          ? 'border-[#D4AF37] bg-[#FFF8E7] text-[#8A6D00]'
                          : 'border-stone-200 text-stone-700 hover:bg-stone-50'
                      }`}
                    >
                      {shape}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </fieldset>
        </div>

        <div className="flex justify-end gap-2 border-t border-stone-100 px-5 py-4">
          <button
            type="button"
            disabled={createMut.isPending || (!unlimited && slotsLeft <= 0)}
            onClick={() => void save(true)}
            className="rounded-xl border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
          >
            Save &amp; add another
          </button>
          <button
            type="button"
            disabled={createMut.isPending || (!unlimited && slotsLeft <= 0)}
            onClick={() => void save(false)}
            className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
