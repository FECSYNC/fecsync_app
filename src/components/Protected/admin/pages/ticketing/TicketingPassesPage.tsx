'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useToast } from '@/contexts/toast-context';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import {
  useTicketingProductsQuery,
  usePatchProductExpiryMutation,
} from '@/hooks/useTicketing';
import { useHqLocationFilter } from '@/hooks/useHqLocationFilter';
import AdminPendingLink from '@/components/Protected/admin/components/AdminPendingLink';
import AdminHowToGuideModal, {
  AdminHowToGuideButton,
  TICKETING_PASSES_GUIDE_STEPS,
} from '@/components/Protected/admin/components/AdminHowToGuideModal';
import { warmAdminInstantPage } from '@/lib/adminInstantNav';
import { btnPrimaryClass, btnSecondaryClass, fieldClass } from './ticketingUi';

export default function TicketingPassesPage() {
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const canWrite = can(P.TicketingPassesWrite) || can(P.TicketingWrite);
  const { scopedLocationId } = useHqLocationFilter();
  const [guideOpen, setGuideOpen] = useState(false);

  // Prefetch-aligned key (no locationId) → instant cache hit; filter client-side.
  const passesQuery = useTicketingProductsQuery({
    type: 'pass',
    includeArchived: false,
  });
  const passes = useMemo(() => {
    const rows = passesQuery.data ?? [];
    if (!scopedLocationId) return rows;
    return rows.filter((p) => p.locationId === scopedLocationId);
  }, [passesQuery.data, scopedLocationId]);

  const expiryMutation = usePatchProductExpiryMutation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [days, setDays] = useState('');

  // Warm create-product chunk while the operator is on Passes (avoids 2–3 clicks).
  useEffect(() => {
    warmAdminInstantPage('/admin/ticketing/products/new');
  }, []);

  const showInitialLoading =
    passesQuery.isPending && !(passesQuery.data?.length);

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
          <h1 className="mt-2 text-2xl font-semibold text-stone-900">Passes</h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            Pass-type products and default expiry days. Open the guide if you
            are doing this for the first time.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <AdminHowToGuideButton onClick={() => setGuideOpen(true)} />
          {canWrite ? (
            <AdminPendingLink
              href="/admin/ticketing/products/new?type=pass"
              pendingLabel="Opening…"
              className={`${btnPrimaryClass} shrink-0`}
            >
              Create pass product
            </AdminPendingLink>
          ) : null}
        </div>
      </div>

      <AdminHowToGuideModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="Passes"
        subtitle="Follow these steps in order — written for first-time admins."
        steps={TICKETING_PASSES_GUIDE_STEPS}
      />

      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Venue</th>
              <th className="px-4 py-3 font-semibold">Default expiry (days)</th>
              <th className="px-4 py-3 font-semibold">Published</th>
              <th className="px-4 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {showInitialLoading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-stone-500">
                  Loading…
                </td>
              </tr>
            ) : passes.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-stone-500">
                  No pass products yet. Create a product with type Pass.
                </td>
              </tr>
            ) : (
              passes.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3 font-medium">{p.name}</td>
                  <td className="px-4 py-3">{p.location?.name ?? '—'}</td>
                  <td className="px-4 py-3">
                    {editingId === p.id ? (
                      <input
                        type="number"
                        min={0}
                        value={days}
                        onChange={(e) => setDays(e.target.value)}
                        className={`${fieldClass} w-28`}
                      />
                    ) : (
                      p.defaultPassExpiryDays ?? '—'
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {p.published ? 'Yes' : 'No'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <AdminPendingLink
                        href={`/admin/ticketing/products/${p.id}`}
                        pendingLabel="Opening…"
                        className={btnSecondaryClass}
                      >
                        Edit product
                      </AdminPendingLink>
                      {canWrite ? (
                        editingId === p.id ? (
                          <>
                            <button
                              type="button"
                              className={btnPrimaryClass}
                              onClick={() => {
                                expiryMutation.mutate(
                                  {
                                    productId: p.id,
                                    defaultPassExpiryDays:
                                      days === '' ? null : Number(days),
                                  },
                                  {
                                    onSuccess: () => {
                                      addToast('Expiry saved', 'success');
                                      setEditingId(null);
                                    },
                                    onError: (err: Error) =>
                                      addToast(
                                        err.message || 'Save failed',
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
                          <button
                            type="button"
                            className={btnSecondaryClass}
                            onClick={() => {
                              setEditingId(p.id);
                              setDays(
                                p.defaultPassExpiryDays == null
                                  ? ''
                                  : String(p.defaultPassExpiryDays)
                              );
                            }}
                          >
                            Edit expiry
                          </button>
                        )
                      ) : null}
                    </div>
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
