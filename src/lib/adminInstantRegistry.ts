import type { ComponentType } from 'react';

/**
 * Sidebar leaf routes that paint instantly (shell first, page chunk second).
 * Keep titles short — used in the optimistic overlay chrome.
 */
export type AdminInstantMeta = {
  title: string;
  eyebrow?: string;
  /** Dynamic import of the real page component (default export). */
  load: () => Promise<{ default: ComponentType }>;
};

type PageMod = { default: ComponentType };

export const ADMIN_INSTANT_REGISTRY: Record<string, AdminInstantMeta> = {
  '/admin': {
    title: 'Dashboard',
    eyebrow: 'Admin',
    load: () =>
      import('@/components/Protected/admin/pages/AdminDashboard') as Promise<PageMod>,
  },
  '/admin/products': {
    title: 'Menu items',
    eyebrow: 'Food sales',
    load: () =>
      import(
        '@/components/Protected/admin/pages/products/ProductsPage'
      ) as Promise<PageMod>,
  },
  '/admin/categories': {
    title: 'Categories',
    eyebrow: 'Food sales',
    load: () =>
      import(
        '@/components/Protected/admin/pages/categories/CategoriesPage'
      ) as Promise<PageMod>,
  },
  '/admin/fabrics': {
    title: 'Fabrics',
    eyebrow: 'Food sales',
    load: () =>
      import(
        '@/components/Protected/admin/pages/fabrics/FabricsPage'
      ) as Promise<PageMod>,
  },
  '/admin/orders': {
    title: 'Orders',
    eyebrow: 'Operations',
    load: () =>
      import(
        '@/components/Protected/admin/pages/orders/OrdersPage'
      ) as Promise<PageMod>,
  },
  '/admin/customizations': {
    title: 'Customizations',
    eyebrow: 'Operations',
    load: () =>
      import(
        '@/components/Protected/admin/pages/customizations/CustomizationsPage'
      ) as Promise<PageMod>,
  },
  '/admin/deliveries': {
    title: 'Deliveries',
    eyebrow: 'Operations',
    load: () =>
      import(
        '@/components/Protected/admin/pages/deliveries/DeliveriesPage'
      ) as Promise<PageMod>,
  },
  '/admin/reviews': {
    title: 'Reviews',
    eyebrow: 'Operations',
    load: () =>
      import(
        '@/components/Protected/admin/pages/reviews/ReviewsPage'
      ) as Promise<PageMod>,
  },
  '/admin/bookings': {
    title: 'Bookings',
    eyebrow: 'Bookings',
    load: () =>
      import(
        '@/components/Protected/admin/pages/bookings/BookingsListShellPage'
      ) as Promise<PageMod>,
  },
  '/admin/bookings/calendar': {
    title: 'Calendar',
    eyebrow: 'Bookings',
    load: () =>
      import(
        '@/components/Protected/admin/pages/bookings/BookingsCalendarPage'
      ) as Promise<PageMod>,
  },
  '/admin/parties': {
    title: 'Parties',
    eyebrow: 'Parties',
    load: () =>
      import(
        '@/components/Protected/admin/pages/parties/PartiesListPage'
      ) as Promise<PageMod>,
  },
  '/admin/ticketing': {
    title: 'Ticket products',
    eyebrow: 'Ticketing',
    load: () =>
      import(
        '@/components/Protected/admin/pages/ticketing/TicketingProductsPage'
      ) as Promise<PageMod>,
  },
  '/admin/ticketing/categories': {
    title: 'Booking category',
    eyebrow: 'Ticketing',
    load: () =>
      import(
        '@/components/Protected/admin/pages/ticketing/BookingCategoriesPage'
      ) as Promise<PageMod>,
  },
  '/admin/ticketing/sessions': {
    title: 'Sessions',
    eyebrow: 'Ticketing',
    load: () =>
      import(
        '@/components/Protected/admin/pages/ticketing/TicketingSessionsPage'
      ) as Promise<PageMod>,
  },
  '/admin/ticketing/add-ons': {
    title: 'Add-ons',
    eyebrow: 'Ticketing',
    load: () =>
      import(
        '@/components/Protected/admin/pages/ticketing/TicketingAddOnsPage'
      ) as Promise<PageMod>,
  },
  '/admin/ticketing/passes': {
    title: 'Passes',
    eyebrow: 'Ticketing',
    load: () =>
      import(
        '@/components/Protected/admin/pages/ticketing/TicketingPassesPage'
      ) as Promise<PageMod>,
  },
  '/admin/ticketing/resources': {
    title: 'Resources',
    eyebrow: 'Ticketing',
    load: () =>
      import(
        '@/components/Protected/admin/pages/ticketing/TicketingResourcesPage'
      ) as Promise<PageMod>,
  },
  '/admin/booking-packages': {
    title: 'Booking packages',
    eyebrow: 'Ticketing',
    load: () =>
      import(
        '@/components/Protected/admin/pages/booking-packages/BookingPackagesPage'
      ) as Promise<PageMod>,
  },
  '/admin/booking-accounts': {
    title: 'Companies',
    eyebrow: 'Sales',
    load: () =>
      import(
        '@/components/Protected/admin/pages/bookingAccounts/BookingAccountsPage'
      ) as Promise<PageMod>,
  },
  '/admin/booking-invoices': {
    title: 'Invoices',
    eyebrow: 'Sales',
    load: () =>
      import(
        '@/components/Protected/admin/pages/bookings/BookingInvoicesListPage'
      ) as Promise<PageMod>,
  },
  '/admin/booking-payments': {
    title: 'Payments',
    eyebrow: 'Sales',
    load: () =>
      import(
        '@/components/Protected/admin/pages/bookings/BookingPaymentsListPage'
      ) as Promise<PageMod>,
  },
  '/admin/ticketing/settings': {
    title: 'Ticketing settings',
    eyebrow: 'Settings',
    load: () =>
      import(
        '@/components/Protected/admin/pages/ticketing/TicketingSettingsPage'
      ) as Promise<PageMod>,
  },
  '/admin/ticketing/products/new': {
    title: 'Create product',
    eyebrow: 'Ticketing',
    load: () =>
      import(
        '@/components/Protected/admin/pages/ticketing/TicketingProductCreatePage'
      ) as Promise<PageMod>,
  },
  '/admin/tailors': {
    title: 'Tailor profiles',
    eyebrow: 'Tailors',
    load: () =>
      import(
        '@/components/Protected/admin/pages/tailors/TailorsPage'
      ) as Promise<PageMod>,
  },
  '/admin/tailoring-jobs': {
    title: 'Tailoring jobs',
    eyebrow: 'Tailors',
    load: () =>
      import(
        '@/components/Protected/admin/pages/tailoring-jobs/AdminTailoringJobsPage'
      ) as Promise<PageMod>,
  },
  '/admin/ai-chats': {
    title: 'Conversations',
    eyebrow: 'AI Chats',
    load: () =>
      import(
        '@/components/Protected/admin/pages/ai-chats/AiChatsPage'
      ) as Promise<PageMod>,
  },
  '/admin/ai-settings': {
    title: 'Assistant settings',
    eyebrow: 'AI Chats',
    load: () =>
      import(
        '@/components/Protected/admin/pages/ai-settings/AiSettingsPage'
      ) as Promise<PageMod>,
  },
  '/admin/users': {
    title: 'Users',
    eyebrow: 'Admin',
    load: () =>
      import(
        '@/components/Protected/admin/pages/users/UsersPermissionsPage'
      ) as Promise<PageMod>,
  },
  '/admin/registered-companies': {
    title: 'Company workspaces',
    eyebrow: 'Admin',
    load: () =>
      import(
        '@/components/Protected/admin/pages/registered-companies/RegisteredCompaniesPage'
      ) as Promise<PageMod>,
  },
  '/admin/venues': {
    title: 'Venues',
    eyebrow: 'Locations',
    load: () =>
      import(
        '@/components/Protected/admin/pages/venues/VenuesPage'
      ) as Promise<PageMod>,
  },
  '/admin/hq': {
    title: 'Enterprise HQ',
    eyebrow: 'Workspace settings',
    load: () =>
      import(
        '@/components/Protected/admin/pages/hq/HqDashboardPage'
      ) as Promise<PageMod>,
  },
  '/admin/company-profile': {
    title: 'Company profile',
    eyebrow: 'Workspace settings',
    load: () =>
      import(
        '@/components/Protected/admin/pages/company-profile/CompanyProfilePage'
      ) as Promise<PageMod>,
  },
  '/admin/billing': {
    title: 'Billing',
    eyebrow: 'Workspace settings',
    load: () =>
      import(
        '@/components/Protected/admin/pages/billing/BillingPage'
      ) as Promise<PageMod>,
  },
  '/admin/payouts': {
    title: 'Payouts',
    eyebrow: 'Workspace settings',
    load: () =>
      import(
        '@/components/Protected/admin/pages/payouts/PayoutsPage'
      ) as Promise<PageMod>,
  },
  '/admin/homepage-content': {
    title: 'Homepage',
    eyebrow: 'Workspace settings',
    load: () =>
      import(
        '@/components/Protected/admin/pages/homepage-content/HomepageContentPage'
      ) as Promise<PageMod>,
  },
  '/admin/ad-banners': {
    title: 'Ad banners',
    eyebrow: 'Workspace settings',
    load: () =>
      import(
        '@/components/Protected/admin/pages/ad-banners/AdBannersPage'
      ) as Promise<PageMod>,
  },
  '/admin/tax-settings': {
    title: 'Tax',
    eyebrow: 'Workspace settings',
    load: () =>
      import(
        '@/components/Protected/admin/pages/tax-settings/TaxSettingsPage'
      ) as Promise<PageMod>,
  },
  // Accounting pages intentionally omitted from the instant registry: Turbopack
  // analyzes every import() target when AdminLayout loads this module, which
  // pulled Prisma into the client graph and stalled /admin. They use normal
  // App Router navigation instead.
  '/admin/shipping-settings': {
    title: 'Shipping',
    eyebrow: 'Workspace settings',
    load: () =>
      import(
        '@/components/Protected/admin/pages/shipping-settings/ShippingSettingsPage'
      ) as Promise<PageMod>,
  },
  '/admin/memberships/plans': {
    title: 'Create plan',
    eyebrow: 'Memberships',
    load: () =>
      import(
        '@/components/Protected/admin/pages/memberships/MembershipPlansPage'
      ) as Promise<PageMod>,
  },
  '/admin/memberships/categories': {
    title: 'Membership categories',
    eyebrow: 'Memberships',
    load: () =>
      import(
        '@/components/Protected/admin/pages/memberships/MembershipCategoriesPage'
      ) as Promise<PageMod>,
  },
  '/admin/memberships/members': {
    title: 'Members',
    eyebrow: 'Memberships',
    load: () =>
      import(
        '@/components/Protected/admin/pages/memberships/MembershipMembersPage'
      ) as Promise<PageMod>,
  },
  '/admin/memberships/redeem': {
    title: 'Redeem desk',
    eyebrow: 'Memberships',
    load: () =>
      import(
        '@/components/Protected/admin/pages/memberships/MembershipRedeemPage'
      ) as Promise<PageMod>,
  },
  '/admin/memberships/eligibility': {
    title: 'Eligibility',
    eyebrow: 'Memberships',
    load: () =>
      import(
        '@/components/Protected/admin/pages/memberships/MembershipEligibilityPage'
      ) as Promise<PageMod>,
  },
  '/admin/memberships/settings': {
    title: 'Settings',
    eyebrow: 'Memberships',
    load: () =>
      import(
        '@/components/Protected/admin/pages/memberships/MembershipSettingsPage'
      ) as Promise<PageMod>,
  },
  '/admin/memberships/reports': {
    title: 'Reports',
    eyebrow: 'Memberships',
    load: () =>
      import(
        '@/components/Protected/admin/pages/memberships/MembershipReportsPage'
      ) as Promise<PageMod>,
  },
  '/admin/waivers': {
    title: 'Waivers',
    eyebrow: 'Waivers',
    load: () =>
      import(
        '@/components/Protected/admin/pages/waivers/WaiversHomePage'
      ) as Promise<PageMod>,
  },
  '/admin/waivers/verify': {
    title: 'Verify',
    eyebrow: 'Waivers',
    load: () =>
      import(
        '@/components/Protected/admin/pages/waivers/WaiverVerifyPage'
      ) as Promise<PageMod>,
  },
  '/admin/waivers/new': {
    title: 'Sign on-site',
    eyebrow: 'Waivers',
    load: () =>
      import(
        '@/components/Protected/admin/pages/waivers/WaiverOnsitePage'
      ) as Promise<PageMod>,
  },
  '/admin/waivers/templates': {
    title: 'Template',
    eyebrow: 'Waivers',
    load: () =>
      import(
        '@/components/Protected/admin/pages/waivers/WaiverTemplatesPage'
      ) as Promise<PageMod>,
  },
  '/admin/waivers/forms': {
    title: 'Forms',
    eyebrow: 'Waivers',
    load: () =>
      import(
        '@/components/Protected/admin/pages/waivers/WaiverTemplatesPage'
      ) as Promise<PageMod>,
  },
  '/admin/waivers/forms/responses': {
    title: 'Responses',
    eyebrow: 'Waivers',
    load: () =>
      import(
        '@/components/Protected/admin/pages/waivers/WaiverResponsesPage'
      ) as Promise<PageMod>,
  },
  '/admin/waivers/import': {
    title: 'Import',
    eyebrow: 'Waivers',
    load: () =>
      import(
        '@/components/Protected/admin/pages/waivers/WaiverImportPage'
      ) as Promise<PageMod>,
  },
  '/admin/waivers/signage': {
    title: 'Signage',
    eyebrow: 'Waivers',
    load: () =>
      import(
        '@/components/Protected/admin/pages/waivers/WaiverSignagePage'
      ) as Promise<PageMod>,
  },
  '/admin/waivers/kiosk': {
    title: 'Kiosk',
    eyebrow: 'Waivers',
    load: () =>
      import(
        '@/components/Protected/admin/pages/waivers/WaiverKioskPage'
      ) as Promise<PageMod>,
  },
  '/admin/waivers/settings': {
    title: 'Settings',
    eyebrow: 'Waivers',
    load: () =>
      import(
        '@/components/Protected/admin/pages/waivers/WaiverSettingsPage'
      ) as Promise<PageMod>,
  },
  '/admin/waivers/compliance': {
    title: 'Compliance guides',
    eyebrow: 'Waivers',
    load: () =>
      import(
        '@/components/Protected/admin/pages/waivers/WaiverCompliancePage'
      ) as Promise<PageMod>,
  },
  '/admin/marketing': {
    title: 'Marketing',
    eyebrow: 'Marketing',
    load: () =>
      import(
        '@/components/Protected/admin/pages/marketing/MarketingOverviewPage'
      ) as Promise<PageMod>,
  },
};

export function getAdminInstantMeta(href: string): AdminInstantMeta | null {
  return ADMIN_INSTANT_REGISTRY[href] ?? null;
}

export const ADMIN_INSTANT_HREFS = Object.keys(ADMIN_INSTANT_REGISTRY);
