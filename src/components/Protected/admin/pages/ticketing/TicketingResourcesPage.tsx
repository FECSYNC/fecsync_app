'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '@/contexts/toast-context';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import {
  listAdminVenueLocations,
  venueLocationKeys,
} from '@/services/venueLocations';
import type { CapacityResourceType } from '@/services/ticketing';
import {
  useCapacityResourcesQuery,
  useCreateCapacityResourceMutation,
  usePatchCapacityResourceMutation,
} from '@/hooks/useTicketing';
import { useHqLocationFilter } from '@/hooks/useHqLocationFilter';
import AdminHowToGuideModal, {
  AdminHowToGuideButton,
  TICKETING_RESOURCES_GUIDE_STEPS,
} from '@/components/Protected/admin/components/AdminHowToGuideModal';
import { ADMIN_LIST_STALE_MS } from '@/lib/adminListCache';
import {
  RESOURCE_TYPE_GUIDANCE,
  RESOURCE_TYPE_OPTIONS,
  btnPrimaryClass,
  btnSecondaryClass,
  btnDangerClass,
  fieldClass,
  formatResourceType,
} from './ticketingUi';

const RESOURCE_TYPE_VALUES = new Set(
  RESOURCE_TYPE_OPTIONS.map((o) => o.value)
);

export default function TicketingResourcesPage() {
  const searchParams = useSearchParams();
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const canWrite = can(P.TicketingResourcesWrite) || can(P.TicketingWrite);
  const [guideOpen, setGuideOpen] = useState(false);

  const prefType = searchParams.get('type');
  const prefLocationId = searchParams.get('locationId') ?? '';

  const [name, setName] = useState('');
  const [type, setType] = useState<CapacityResourceType>(
    prefType && RESOURCE_TYPE_VALUES.has(prefType as CapacityResourceType)
      ? (prefType as CapacityResourceType)
      : 'party_room'
  );
  const {
    locationId,
    setLocationId,
    scopedLocationId,
  } = useHqLocationFilter(prefLocationId);
  const [defaultCapacity, setDefaultCapacity] = useState('20');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState<CapacityResourceType>('attraction');
  const [editCapacity, setEditCapacity] = useState('');

  useEffect(() => {
    if (
      prefType &&
      RESOURCE_TYPE_VALUES.has(prefType as CapacityResourceType)
    ) {
      setType(prefType as CapacityResourceType);
    }
  }, [prefType]);

  useEffect(() => {
    if (prefLocationId && !scopedLocationId) {
      setLocationId(prefLocationId);
    }
  }, [prefLocationId, scopedLocationId, setLocationId]);

  const venuesQuery = useQuery({
    queryKey: venueLocationKeys.list('all'),
    queryFn: () => listAdminVenueLocations({ scope: 'all' }),
    staleTime: ADMIN_LIST_STALE_MS,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (previous) => previous,
  });
  // Prefetch-aligned key (no locationId) → instant cache hit; filter client-side.
  const resourcesQuery = useCapacityResourcesQuery({
    includeArchived,
  });
  const createMutation = useCreateCapacityResourceMutation();
  const patchMutation = usePatchCapacityResourceMutation();
  const venues = (venuesQuery.data ?? []).filter((v) => {
    if (v.status === 'archived') return false;
    if (scopedLocationId) return v.id === scopedLocationId;
    return true;
  });
  const resources = (resourcesQuery.data ?? []).filter((r) => {
    if (scopedLocationId) return r.locationId === scopedLocationId;
    if (locationId) return r.locationId === locationId;
    return true;
  });

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!canWrite) return;
    try {
      await createMutation.mutateAsync({
        name: name.trim(),
        type,
        locationId,
        defaultCapacity: Number(defaultCapacity),
      });
      addToast('Resource created', 'success');
      setName('');
      setDefaultCapacity('20');
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Could not create resource',
        'error'
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            href="/admin/ticketing"
            className="text-sm text-stone-500 hover:text-[#D4AF37]"
          >
            ← Products
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-stone-900">
            Capacity resources
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            Spaces at a venue (rooms, attractions, lanes) that products and
            sessions can hold capacity against. Open the guide if you are doing
            this for the first time.
          </p>
        </div>
        <AdminHowToGuideButton onClick={() => setGuideOpen(true)} />
      </div>

      <AdminHowToGuideModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="Capacity resources"
        subtitle="Follow these steps in order — written for first-time admins."
        steps={TICKETING_RESOURCES_GUIDE_STEPS}
      />

      {canWrite ? (
        <form
          onSubmit={onCreate}
          className="max-w-xl space-y-3 rounded-lg border border-stone-200 bg-white p-4"
        >
          <h2 className="text-sm font-semibold text-stone-800">Add resource</h2>
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase text-stone-500">
              Name *
            </span>
            <input
              required
              minLength={2}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Party Room A"
              className={fieldClass}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase text-stone-500">
                Type *
              </span>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as CapacityResourceType)}
                className={fieldClass}
              >
                {RESOURCE_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className="text-xs leading-relaxed text-stone-500">
                {RESOURCE_TYPE_GUIDANCE[type]}
              </p>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase text-stone-500">
                Venue *
              </span>
              <select
                required
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
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
          </div>
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase text-stone-500">
              Default capacity *
            </span>
            <input
              type="number"
              min={0}
              required
              value={defaultCapacity}
              onChange={(e) => setDefaultCapacity(e.target.value)}
              placeholder="e.g. 20"
              className={fieldClass}
            />
          </label>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className={btnPrimaryClass}
          >
            {createMutation.isPending ? <ButtonSpinner /> : null}
            Create resource
          </button>
        </form>
      ) : null}

      <label className="inline-flex items-center gap-2 text-sm text-stone-700">
        <input
          type="checkbox"
          checked={includeArchived}
          onChange={(e) => setIncludeArchived(e.target.checked)}
        />
        Include archived
      </label>

      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Type</th>
              <th className="px-4 py-3 font-semibold">Venue</th>
              <th className="px-4 py-3 font-semibold">Default capacity</th>
              <th className="px-4 py-3 font-semibold">Archived</th>
              <th className="px-4 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {resourcesQuery.isPending && !(resourcesQuery.data?.length) ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-stone-500">
                  Loading…
                </td>
              </tr>
            ) : resources.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-stone-500">
                  No resources yet.
                </td>
              </tr>
            ) : (
              resources.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 font-medium text-stone-900">
                    {editingId === r.id ? (
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className={fieldClass}
                      />
                    ) : (
                      r.name
                    )}
                  </td>
                  <td className="px-4 py-3 capitalize text-stone-600">
                    {editingId === r.id ? (
                      <select
                        value={editType}
                        onChange={(e) =>
                          setEditType(e.target.value as CapacityResourceType)
                        }
                        className={fieldClass}
                      >
                        {RESOURCE_TYPE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      formatResourceType(r.type)
                    )}
                  </td>
                  <td className="px-4 py-3 text-stone-600">
                    {r.location?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    {editingId === r.id ? (
                      <input
                        type="number"
                        value={editCapacity}
                        onChange={(e) => setEditCapacity(e.target.value)}
                        className={`${fieldClass} w-24`}
                      />
                    ) : (
                      r.defaultCapacity
                    )}
                  </td>
                  <td className="px-4 py-3">{r.archivedAt ? 'Yes' : 'No'}</td>
                  <td className="px-4 py-3">
                    {canWrite ? (
                      <div className="flex flex-wrap gap-2">
                        {editingId === r.id ? (
                          <>
                            <button
                              type="button"
                              className={btnPrimaryClass}
                              onClick={() => {
                                patchMutation.mutate(
                                  {
                                    id: r.id,
                                    payload: {
                                      name: editName.trim(),
                                      type: editType,
                                      defaultCapacity: Number(editCapacity),
                                    },
                                  },
                                  {
                                    onSuccess: () => {
                                      addToast('Resource updated', 'success');
                                      setEditingId(null);
                                    },
                                    onError: (err: Error) =>
                                      addToast(
                                        err.message || 'Update failed',
                                        'error'
                                      ),
                                  }
                                );
                              }}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className={btnSecondaryClass}
                              onClick={() => setEditingId(null)}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className={btnSecondaryClass}
                              onClick={() => {
                                setEditingId(r.id);
                                setEditName(r.name);
                                setEditType(r.type);
                                setEditCapacity(String(r.defaultCapacity));
                              }}
                            >
                              Edit
                            </button>
                            {!r.archivedAt ? (
                              <button
                                type="button"
                                className={btnDangerClass}
                                onClick={() => {
                                  if (!window.confirm(`Archive “${r.name}”?`)) {
                                    return;
                                  }
                                  patchMutation.mutate(
                                    { id: r.id, payload: { archive: true } },
                                    {
                                      onSuccess: () =>
                                        addToast('Resource archived', 'success'),
                                      onError: (err: Error) =>
                                        addToast(
                                          err.message || 'Archive failed',
                                          'error'
                                        ),
                                    }
                                  );
                                }}
                              >
                                Archive
                              </button>
                            ) : (
                              <button
                                type="button"
                                className={btnSecondaryClass}
                                onClick={() => {
                                  patchMutation.mutate(
                                    { id: r.id, payload: { unarchive: true } },
                                    {
                                      onSuccess: () =>
                                        addToast(
                                          'Resource restored',
                                          'success'
                                        ),
                                      onError: (err: Error) =>
                                        addToast(
                                          err.message || 'Restore failed',
                                          'error'
                                        ),
                                    }
                                  );
                                }}
                              >
                                Restore
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
