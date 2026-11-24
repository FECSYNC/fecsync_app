import { User, Package, Shirt, Heart, Trash2, LogOut, Ruler, Scissors, Briefcase, Megaphone, Ticket, IdCard, PartyPopper, Receipt } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { permissionForProfileTab } from '@/lib/auth/permissions';

export type ProfileMenuItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  /** When set, navigates away from /profile?tab=… (e.g. tailor workspace). */
  href?: string;
  /** Show only for Find-a-Tailor providers. */
  tailorOnly?: boolean;
};

export const menuItems: ProfileMenuItem[] = [
  { id: 'orders', label: 'My Orders', icon: Package, active: true },
  { id: 'bookings', label: 'My Bookings', icon: Ticket, active: false },
  { id: 'parties', label: 'My Parties', icon: PartyPopper, active: false },
  { id: 'memberships', label: 'My Memberships', icon: IdCard, active: false },
  { id: 'billing', label: 'Billing', icon: Receipt, active: false },
  // Signed waivers stay on the email receipt. A profile tab would need an org picker
  // and must not become Venue Manager.
  { id: 'customizations', label: 'My Customizations', icon: Shirt, active: false },
  { id: 'measurements', label: 'My Measurements', icon: Ruler, active: false },
  { id: 'campaigns', label: 'Campaigns', icon: Megaphone, active: false },
  { id: 'tailoring-jobs', label: 'Tailoring Jobs', icon: Scissors, active: false },
  {
    id: 'tailor-workspace',
    label: 'Tailor workspace',
    icon: Briefcase,
    active: false,
    href: '/tailor/home',
    tailorOnly: true,
  },
  { id: 'wishlist', label: 'Wishlist', icon: Heart, active: false },
  { id: 'info', label: 'My info', icon: User, active: false },
  { id: 'logout', label: 'Logout', icon: LogOut, active: false },
  { id: 'delete-account', label: 'Delete Account', icon: Trash2, active: false }
];

export function profileMenuItemsForUser(
  isTailorProvider: boolean,
  can?: (permission: string) => boolean
): ProfileMenuItem[] {
  return menuItems.filter((item) => {
    if (item.tailorOnly && !isTailorProvider) return false;
    if (item.id === 'logout') return true;
    const perm = permissionForProfileTab(item.id);
    if (perm && can && !can(perm)) return false;
    return true;
  });
}

export const orderTabs = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending payment' },
  { id: 'paid', label: 'Paid' },
  { id: 'shipped', label: 'Shipped' },
  { id: 'delivered', label: 'Delivered' },
  { id: 'cancelled', label: 'Cancelled' },
] as const;
