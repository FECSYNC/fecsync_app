'use client';

import { useAuthStore } from '@/store/authStore';
import { ADMIN_DASHBOARD_QUICK_LINKS } from '@/lib/adminNav';
import { type Permission } from '@/lib/auth/permissions';
import { isAdminPageAllowed } from '@/hooks/useAdminPermission';
import AdminPendingLink from '@/components/Protected/admin/components/AdminPendingLink';

type QuickLink = {
  title: string;
  href: string;
  permission: Permission;
  description: string;
  count?: number | null;
};

const OPERATIONS_LINKS: QuickLink[] = [
  {
    title: 'Orders',
    href: '/admin/orders',
    permission: ADMIN_DASHBOARD_QUICK_LINKS.operations[0].permission,
    description: 'Fulfillment, status updates, and customer order details.',
  },
  {
    title: 'Customizations',
    href: '/admin/customizations',
    permission: ADMIN_DASHBOARD_QUICK_LINKS.operations[1].permission,
    description: 'Bespoke requests and custom order workflows.',
  },
  {
    title: 'Deliveries',
    href: '/admin/deliveries',
    permission: ADMIN_DASHBOARD_QUICK_LINKS.operations[2].permission,
    description: 'Track shipments and update delivery status.',
  },
  {
    title: 'Reviews',
    href: '/admin/reviews',
    permission: ADMIN_DASHBOARD_QUICK_LINKS.operations[3].permission,
    description: 'Guest feedback and moderation (read today; actions need moderate).',
  },
];

const CATALOG_LINKS: QuickLink[] = [
  {
    title: 'Menu items',
    href: '/admin/products',
    permission: ADMIN_DASHBOARD_QUICK_LINKS.catalog[0].permission,
    description: 'Park restaurant and food-vendor dishes for online sale.',
  },
  {
    title: 'Categories',
    href: '/admin/categories',
    permission: ADMIN_DASHBOARD_QUICK_LINKS.catalog[1].permission,
    description: 'Menu groups (mains, drinks, snacks, etc.).',
  },
  {
    title: 'Fabrics',
    href: '/admin/fabrics',
    permission: ADMIN_DASHBOARD_QUICK_LINKS.catalog[2].permission,
    description: 'Materials, swatches, and fabric stock.',
  },
];

export default function OperationsOverviewCards() {
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);

  const operations: QuickLink[] = OPERATIONS_LINKS;
  const catalog = CATALOG_LINKS.filter(
    (link) =>
      can(link.permission) && isAdminPageAllowed(link.href, can, user).allowed
  );
  const visibleOps = operations.filter((link) =>
    isAdminPageAllowed(link.href, can, user).allowed
  );

  if (visibleOps.length === 0 && catalog.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {visibleOps.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Operations</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5 gap-4">
            {visibleOps.map((link) => (
              <AdminPendingLink
                key={link.href}
                href={link.href}
                className="block w-full rounded-lg border border-gray-200 bg-white p-5 transition-colors hover:border-[#D4AF37]/40"
              >
                <p className="text-sm font-medium text-gray-900">
                  {link.title}
                  {typeof link.count === 'number' ? (
                    <span className="ml-2 text-[#B8960C]">({link.count})</span>
                  ) : null}
                </p>
                <p className="text-sm text-gray-500 mt-1">{link.description}</p>
              </AdminPendingLink>
            ))}
          </div>
        </section>
      )}
      {catalog.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Food sales</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {catalog.map((link) => (
              <AdminPendingLink
                key={link.href}
                href={link.href}
                className="block w-full rounded-lg border border-gray-200 bg-white p-5 transition-colors hover:border-[#D4AF37]/40"
              >
                <p className="text-sm font-medium text-gray-900">{link.title}</p>
                <p className="text-sm text-gray-500 mt-1">{link.description}</p>
              </AdminPendingLink>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
