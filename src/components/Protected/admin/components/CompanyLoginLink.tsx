'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, KeyRound } from 'lucide-react';
import { browserPublicOrigin, companyLoginUrl } from '@/lib/tenantDomain';
import { copyToClipboard } from '@/lib/copyToClipboard';

/** Browser-only: protocol/port come from the current page. */
export function useCompanyLoginUrl(slug: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const value = slug?.trim();
    if (!value) {
      setUrl(null);
      return;
    }
    const { protocol, port } = window.location;
    setUrl(companyLoginUrl(value, browserPublicOrigin(), { protocol, port }));
  }, [slug]);
  return url;
}

/** The company's own staff sign-in link with copy / open actions. */
export default function CompanyLoginLink({
  slug,
  variant = 'card',
  label = 'Staff sign-in link',
}: {
  slug: string | null | undefined;
  variant?: 'card' | 'inline';
  /** Inline variant prefix. */
  label?: string;
}) {
  const url = useCompanyLoginUrl(slug);
  const [copied, setCopied] = useState(false);
  if (!url) return null;

  const copy = async () => {
    if (await copyToClipboard(url)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } else {
      window.prompt(`Copy the ${label.toLowerCase()}`, url);
    }
  };

  const actions = (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? 'Copied' : 'Copy link'}
      </button>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
      >
        <ExternalLink className="h-3.5 w-3.5" />
        Open
      </a>
    </div>
  );

  if (variant === 'inline') {
    return (
      <div className="mt-2 flex flex-col gap-2 rounded-lg bg-gray-50 p-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0 text-xs text-gray-700">
          {label}:{' '}
          <span className="break-all font-medium text-gray-900">{url.replace(/^https?:\/\//, '')}</span>
        </p>
        {actions}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-700">
            <KeyRound className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">Your staff sign-in link</p>
            <p className="break-all text-sm text-gray-700">{url.replace(/^https?:\/\//, '')}</p>
            <p className="mt-0.5 text-xs text-gray-500">
              Share this with your team. It shows your company&apos;s name and logo, and only your
              staff can sign in through it.
            </p>
          </div>
        </div>
        {actions}
      </div>
    </div>
  );
}
