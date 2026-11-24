'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, Suspense } from 'react';
import { useAuthStore } from '@/store/authStore';
import { defaultPathForSession, signInHref } from '@/utils/authRedirect';

function UnauthorizedContent() {
  const router = useRouter();
  const search = useSearchParams();
  const { user, hasHydratedAuth, isStaff } = useAuthStore();

  const from = useMemo(() => search.get('from') || '/', [search]);
  const denied = useMemo(() => search.get('denied'), [search]);
  const isPermissionDenied = denied === 'permission';
  const reason = useMemo(
    () =>
      search.get('reason') ||
      (isPermissionDenied
        ? 'You do not have permission to open this page.'
        : 'This area is for administrators.'),
    [search, isPermissionDenied]
  );

  useEffect(() => {
    if (!hasHydratedAuth) return;

    if (!user) {
      // Give cookie hydrate a beat after AdminLayout bounced here — immediate
      // sign-in replace fought a still-valid session under slow /me compile.
      const t = window.setTimeout(() => {
        if (useAuthStore.getState().user) return;
        router.replace(signInHref(from));
      }, 2500);
      return () => window.clearTimeout(t);
    }

    // Staff missing a specific permission stay on this page (Step 6.3).
    // Role-mismatch (client on admin) still redirects staff away from the
    // client-facing 403 copy.
    if (isStaff() && !isPermissionDenied) {
      router.replace(defaultPathForSession(user));
    }
  }, [user, hasHydratedAuth, router, from, isStaff, isPermissionDenied]);

  const staffHome = defaultPathForSession(user);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-xl">
        <div className="relative rounded-2xl bg-white/90 backdrop-blur-xl shadow-xl ring-1 ring-black/5 border border-gray-200">
          <div className="absolute inset-x-0 -top-[2px] h-[2px] bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 rounded-t-2xl" />

          <div className="p-8 md:p-10 text-center">
            <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold bg-amber-50 text-amber-700 ring-1 ring-amber-200 mb-5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
              {isPermissionDenied
                ? '403 • Missing permission'
                : '403 • User account detected'}
            </div>

            <div className="mx-auto mb-6 flex h-32 w-32 items-center justify-center">
              <Image
                src="/unauthorized.png"
                alt="Unauthorized Access"
                width={128}
                height={128}
                className=""
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
                priority
              />
            </div>

            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-gray-900">
              {isPermissionDenied
                ? 'Permission Required'
                : 'Admin Access Required'}
            </h1>

            <p className="mt-3 text-gray-600 leading-relaxed">
              {reason}
              {!isPermissionDenied && (
                <>
                  {' '}
                  You&apos;re signed in as a{' '}
                  <span className="font-medium">user</span>.
                </>
              )}
              {from && (
                <>
                  {' '}
                  You tried to open{' '}
                  <span className="font-mono text-sm px-1.5 py-0.5 rounded bg-gray-100 text-gray-800">
                    {from}
                  </span>
                  .
                </>
              )}
            </p>

            <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {isPermissionDenied && isStaff() ? (
                <>
                  <Link
                    href={staffHome}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#D4AF37] hover:bg-[#B8941F] text-white font-semibold px-5 py-3 transition-colors whitespace-nowrap text-sm md:text-base"
                  >
                    Back to Admin
                  </Link>
                  <Link
                    href="/home"
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-white border border-gray-300 text-gray-800 hover:bg-gray-50 font-semibold px-5 py-3 transition-colors whitespace-nowrap text-sm md:text-base"
                  >
                    Go to Home
                  </Link>
                </>
              ) : (
                <>
                  <Link
                    href="/home"
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#D4AF37] hover:bg-[#B8941F] text-white font-semibold px-5 py-3 transition-colors whitespace-nowrap text-sm md:text-base"
                  >
                    Go to Home
                  </Link>
                  <Link
                    href={{ pathname: '/signin', query: { returnTo: from || '/' } }}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-white border border-gray-300 text-gray-800 hover:bg-gray-50 font-semibold px-5 py-3 transition-colors whitespace-nowrap text-sm md:text-base"
                  >
                    Sign in as Admin
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-gray-500">
          If you believe this is an error, please contact your workspace administrator.
        </p>
      </div>
    </div>
  );
}

export default function UnauthorizedPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
          <div className="text-gray-600">Loading...</div>
        </div>
      }
    >
      <UnauthorizedContent />
    </Suspense>
  );
}
