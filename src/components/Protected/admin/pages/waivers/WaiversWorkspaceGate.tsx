'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useAuthStore } from '@/store/authStore';
import { isAdminPageAllowed, isStorefrontOrgSession } from '@/hooks/useAdminPermission';

/**
 * Digital Waivers run on registered company workspaces only (staff APIs deny the
 * storefront org). The storefront seat sees this notice instead of failing lists.
 */
export default function WaiversWorkspaceGate({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const can = useAuthStore((s) => s.can);
  if (!isStorefrontOrgSession(user)) return <>{children}</>;

  const canSeeCompanies = isAdminPageAllowed('/admin/registered-companies', can, user).allowed;
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold text-stone-900">Waivers</h1>
        <p className="mt-1 text-sm text-stone-600">
          Digital waivers for a company&apos;s parks — templates, guest signing, kiosk, and desk checks.
        </p>
      </div>
      <div className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-950">
        <p className="font-semibold">Wrong workspace for this feature</p>
        <p>
          Waivers run inside a registered company workspace on the Growth or Enterprise plan. The
          FECSYNC storefront does not hold waivers. Sign in as that company&apos;s admin to manage
          its waivers.
        </p>
        <div className="flex flex-wrap gap-3 pt-1">
          {canSeeCompanies ? (
            <Link
              href="/admin/registered-companies"
              className="inline-flex h-10 items-center justify-center rounded-lg bg-[#D4AF37] px-4 text-sm font-semibold text-stone-900 shadow-sm hover:bg-[#c4a030]"
            >
              Company workspaces
            </Link>
          ) : null}
          <Link
            href="/register-company"
            className="inline-flex h-10 items-center justify-center rounded-lg border border-amber-400 bg-white px-4 text-sm font-semibold text-amber-950"
          >
            Register a company
          </Link>
        </div>
      </div>
    </div>
  );
}
