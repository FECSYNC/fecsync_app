export const orderTabs = [
  { id: 'pending', label: 'Pending', count: 0 },
  { id: 'initiated', label: 'Initiated', count: 0 },
  { id: 'paid', label: 'Paid', count: 0 },
  { id: 'shipped', label: 'Shipped', count: 0 },
  { id: 'delivered', label: 'Delivered', count: 0 }
];

export type OrderTabId = 'pending' | 'initiated' | 'paid' | 'shipped' | 'delivered';

/**
 * Admin tabs have no dedicated "shipping" column.
 * Auto-booked `shipping` stays under Paid (needs ops attention / live pulse).
 * Courier-progress `shipped` stays under Shipped.
 * Profile customer tabs intentionally group `shipping` under Shipped (in-progress
 * delivery) — different audience, not a desync.
 */
export function orderMatchesAdminTab(
  status: string | undefined | null,
  tab: OrderTabId
): boolean {
  if (!status) return false;
  if (tab === 'paid') {
    return status === 'paid' || status === 'shipping';
  }
  if (tab === 'shipped') {
    return status === 'shipped';
  }
  return status === tab;
}
