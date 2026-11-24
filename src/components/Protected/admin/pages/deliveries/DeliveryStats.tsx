'use client';

import type { ShipmentDto } from '@/services/shipping';

export default function DeliveryStats({
  items,
  total,
}: {
  items: ShipmentDto[];
  total: number;
}) {
  const pendingLike = items.filter((s) =>
    ['pending', 'booked', 'picked_up'].includes(s.status)
  ).length;
  const inTransit = items.filter((s) =>
    ['in_transit', 'out_for_delivery'].includes(s.status)
  ).length;
  const delivered = items.filter((s) => s.status === 'delivered').length;
  const failed = items.filter((s) =>
    ['failed', 'cancelled'].includes(s.status)
  ).length;

  const stats = [
    {
      title: 'Shipments (API total)',
      value: String(total),
      hint:
        items.length < total
          ? `Loaded ${items.length} for this view`
          : undefined,
    },
    {
      title: 'Pending / booked',
      value: String(pendingLike),
      hint: 'Among loaded rows',
    },
    {
      title: 'In transit',
      value: String(inTransit),
      hint: 'Among loaded rows',
    },
    {
      title: 'Delivered',
      value: String(delivered),
      hint: failed
        ? `${failed} failed/cancelled (loaded)`
        : 'Among loaded rows',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {stats.map((stat) => (
        <div key={stat.title} className="bg-white p-6 rounded-lg shadow">
          <p className="text-sm font-medium text-gray-600">{stat.title}</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{stat.value}</p>
          {stat.hint ? (
            <p className="text-xs text-gray-500 mt-1">{stat.hint}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
