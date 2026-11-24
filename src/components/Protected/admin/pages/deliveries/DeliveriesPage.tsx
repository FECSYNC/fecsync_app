'use client';

import { useMemo, useState } from 'react';
import DeliveriesTable from './DeliveriesTable';
import DeliveryFilters from './DeliveryFilters';
import DeliveryStats from './DeliveryStats';
import { useCatalogActionPermissions } from '@/hooks/useAdminPermission';
import { useShipmentsQuery } from '@/hooks/useShipments';
import type { ShipmentDto } from '@/services/shipping';
import { P } from '@/lib/auth/permissions';
import { useAuthStore } from '@/store/authStore';

function inDateRange(iso: string | undefined | null, range: string): boolean {
  if (!range || !iso) return true;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return true;
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  if (range === 'today') return now - t < day;
  if (range === 'week') return now - t < 7 * day;
  if (range === 'month') return now - t < 31 * day;
  if (range === 'quarter') return now - t < 92 * day;
  return true;
}

export default function DeliveriesPage() {
  const { canManageDeliveries } = useCatalogActionPermissions();
  const can = useAuthStore((s) => s.can);
  const [filters, setFilters] = useState({
    status: '',
    dateRange: '',
    search: '',
  });

  const { data, isPending, isFetching, error, refetch } = useShipmentsQuery({
    status: filters.status || undefined,
    page: 1,
    limit: 100,
    enabled: can(P.DeliveriesRead),
  });

  const items = useMemo(() => data?.items ?? [], [data?.items]);

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return items.filter((row: ShipmentDto) => {
      if (!inDateRange(row.updatedAt || row.createdAt, filters.dateRange)) {
        return false;
      }
      if (!q) return true;
      return (
        row.id.toLowerCase().includes(q) ||
        row.orderId.toLowerCase().includes(q) ||
        (row.customerName || '').toLowerCase().includes(q) ||
        (row.trackingNumber || '').toLowerCase().includes(q) ||
        (row.courierName || '').toLowerCase().includes(q)
      );
    });
  }, [items, filters.search, filters.dateRange]);

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-start">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Deliveries</h1>
          <p className="text-sm sm:text-base text-gray-600">
            Live courier tracking for your organization (same Shipment records as
            order panels and customer tracking). Without company-wide view, you
            only see shipments for orders you placed. Order payment status stays
            on Orders — this page is shipment status only.
            {canManageDeliveries
              ? ' Book, retry, and cancel from a delivery or order detail.'
              : ' Viewing requires deliveries:read; manage requires deliveries:manage.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="w-full sm:w-auto shrink-0 px-3 py-2 text-sm rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50 disabled:opacity-50"
        >
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <DeliveryStats items={items} total={data?.total ?? items.length} />
      <DeliveryFilters filters={filters} onFiltersChange={setFilters} />

      {error && (
        <p className="text-red-600 text-sm">
          Failed to load shipments.{' '}
          {error instanceof Error ? error.message : 'Try refresh.'}
        </p>
      )}

      <DeliveriesTable
        deliveries={filtered}
        loading={isPending && !(data?.items?.length)}
        canManage={canManageDeliveries}
      />
    </div>
  );
}
