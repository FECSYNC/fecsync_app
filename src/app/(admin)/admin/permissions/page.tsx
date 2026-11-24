import { redirect } from 'next/navigation';

/** Alias for Step 6.2 permission settings UI (`/admin/users`). */
export default function AdminPermissionsAliasPage() {
  redirect('/admin/users');
}
