'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/contexts/toast-context';
import {
  listPartyWaiverGaps,
  listWaiverTemplates,
  sendPartyWaiverChase,
  waiverDeskQueryOptions,
  waiverKeys,
} from '@/services/waivers';
import { waiverStatusLabel } from '@/components/Protected/admin/pages/waivers/WaiverStatusChip';
import { btnPrimaryClass, fieldClass } from './partiesUi';

/** Read-only waiver coverage from the Digital Waivers lib + the existing party chase request. No signing UI. */
export default function PartyWaiversTab({ bookingId, canChase }: { bookingId: string; canChase: boolean }) {
  const { addToast } = useToast();
  const qc = useQueryClient();
  const [templateId, setTemplateId] = useState('');
  const gaps = useQuery({
    queryKey: [...waiverKeys.all, 'party', bookingId],
    queryFn: () => listPartyWaiverGaps(bookingId),
    enabled: Boolean(bookingId),
    ...waiverDeskQueryOptions,
  });
  const templates = useQuery({
    queryKey: waiverKeys.templates('documents'),
    queryFn: () => listWaiverTemplates('documents'),
    enabled: canChase,
    ...waiverDeskQueryOptions,
  });
  const send = useMutation({
    mutationFn: () => sendPartyWaiverChase(bookingId, templateId),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: [...waiverKeys.all, 'party', bookingId] });
      if (data?.sent) addToast('Waiver link sent to the party contact.', 'success');
      else if (data?.url) addToast(`Link was not emailed. Copy it: ${data.url}`, 'success');
      else addToast(data?.skipped ?? 'No waiver link was sent.', 'error');
    },
    onError: (err: Error) => addToast(err.message || 'Could not send the waiver link.', 'error'),
  });
  const payload = gaps.data;
  if (gaps.isLoading) return <p className="text-sm text-stone-500">Loading waivers…</p>;
  if (gaps.error) {
    return (
      <p className="rounded-lg border border-stone-200 bg-white p-4 text-sm text-stone-600">
        Waiver status is not available to your role ({gaps.error instanceof Error ? gaps.error.message : 'no access'}).
      </p>
    );
  }
  if (!payload?.available) {
    return (
      <p className="rounded-lg border border-stone-200 bg-white p-4 text-sm text-stone-600">
        Digital waivers are not enabled for this company, or this party has no guest list yet. Waiver status shows as n/a.
      </p>
    );
  }
  return (
    <div className="space-y-3 rounded-lg border border-stone-200 bg-white p-4 text-sm">
      <p className="text-stone-600">
        Missing waivers: {payload.waiverMissingCount ?? payload.guests.filter((g) => !g.covered).length}. A named guest stays
        missing until a signed record is stored for that guest.
      </p>
      <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200">
        {payload.guests.map((guest) => (
          <li key={guest.partyGuestId} className="flex items-center justify-between px-3 py-2">
            <span>{guest.name || 'Guest'}</span>
            <span className="font-semibold text-[#D4AF37]">
              {waiverStatusLabel(guest.waiverStatus ?? (guest.covered ? 'valid' : 'missing'))}
            </span>
          </li>
        ))}
      </ul>
      {canChase ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (templateId) send.mutate();
          }}
        >
          <label className="text-xs text-stone-600">
            Waiver template
            <select className={`${fieldClass} mt-1`} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">Select</option>
              {(templates.data ?? [])
                .filter((t) => t.status === 'published' && !t.archivedAt)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </label>
          <button type="submit" className={btnPrimaryClass} disabled={!templateId || send.isPending}>
            Send waiver request (party chase)
          </button>
        </form>
      ) : null}
    </div>
  );
}
