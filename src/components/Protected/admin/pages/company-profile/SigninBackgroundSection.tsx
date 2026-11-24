'use client';

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, ImagePlus, Lightbulb, RefreshCw, Trash2 } from 'lucide-react';
import { useToast } from '@/contexts/toast-context';
import {
  useClearSigninBackgroundMutation,
  useUploadSigninBackgroundMutation,
} from '@/hooks/useCompanyProfile';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import { useCompanyLoginUrl } from '@/components/Protected/admin/components/CompanyLoginLink';
import CompanySignInHero from '@/components/Public_C/auth/CompanySignInHero';
import { optimizeCatalogImageUrl } from '@/lib/catalogImages';
import {
  prepareWideImage,
  WIDE_IMAGE_MAX_UPLOAD_BYTES,
} from '@/utils/imageUpload';

const ACCEPT = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const ACCEPT_EXT = /\.(jpe?g|png|webp)$/i;
/** Source files are optimised in the browser before upload. */
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const RECOMMENDED_WIDTH = 1600;
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function isAcceptedImage(file: File): boolean {
  const type = (file.type || '').toLowerCase();
  if (ACCEPT.includes(type)) return true;
  // Windows sometimes leaves the type blank; the server sniffs the bytes.
  return (!type || type === 'application/octet-stream') && ACCEPT_EXT.test(file.name);
}

/** Resolve once the image is cached (or after a short timeout). */
function preloadImage(src: string, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve) => {
    const img = new window.Image();
    const done = () => resolve();
    const timer = window.setTimeout(done, timeoutMs);
    img.onload = img.onerror = () => {
      window.clearTimeout(timer);
      done();
    };
    img.src = src;
  });
}

type Props = {
  backgroundUrl: string | null;
  logoUrl: string | null;
  /** Saved `publicLogo` — the sign-in page hides the logo when it is off. */
  showLogo: boolean;
  name: string;
  accentColor: string | null;
  slug: string;
  disabled: boolean;
  onBusyChange?: (busy: boolean) => void;
};

export default function SigninBackgroundSection({
  backgroundUrl,
  logoUrl,
  showLogo,
  name,
  accentColor,
  slug,
  disabled,
  onBusyChange,
}: Props) {
  const { addToast } = useToast();
  const uploadMutation = useUploadSigninBackgroundMutation();
  const clearMutation = useClearSigninBackgroundMutation();
  const loginUrl = useCompanyLoginUrl(slug);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'optimising' | 'uploading'>('idle');
  const [dragOver, setDragOver] = useState(false);

  const uploading = phase !== 'idle' || uploadMutation.isPending;
  const busy = uploading || clearMutation.isPending;
  const locked = disabled || busy;

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  useEffect(
    () => () => {
      if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    },
    [pendingPreview]
  );

  const accent = accentColor && HEX_COLOR.test(accentColor) ? accentColor : null;
  const savedPreview = backgroundUrl ? optimizeCatalogImageUrl(backgroundUrl, 960) : null;
  const previewBackground = pendingPreview ?? savedPreview;

  const upload = async (file: File | null | undefined) => {
    if (!file || locked) return;
    if (!isAcceptedImage(file)) {
      addToast('Use a JPEG, PNG, or WebP image', 'error');
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      addToast('That photo is over 25MB. Choose a smaller image.', 'error');
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    setPhase('optimising');
    try {
      const prepared = await prepareWideImage(file);
      if (prepared.file.size > WIDE_IMAGE_MAX_UPLOAD_BYTES) {
        addToast(
          'This photo is still too large after optimising. Export it as a JPEG under 4MB and try again.',
          'error'
        );
        return;
      }
      const width = prepared.width;
      setPendingPreview(URL.createObjectURL(prepared.file));
      setPhase('uploading');
      const profile = await uploadMutation.mutateAsync(prepared.file);
      if (profile.signinBackgroundUrl) {
        await preloadImage(optimizeCatalogImageUrl(profile.signinBackgroundUrl, 960));
      }
      addToast(
        width !== null && width < RECOMMENDED_WIDTH
          ? `Background updated. This image is ${width}px wide — use ${RECOMMENDED_WIDTH}px or wider so it stays sharp on large screens.`
          : 'Sign-in background updated',
        width !== null && width < RECOMMENDED_WIDTH ? 'info' : 'success'
      );
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Failed to upload background',
        'error'
      );
    } finally {
      setPhase('idle');
      setPendingPreview(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async () => {
    if (locked || !backgroundUrl) return;
    if (
      !window.confirm(
        'Remove the sign-in background? Your sign-in page will go back to your brand colour.'
      )
    ) {
      return;
    }
    try {
      await clearMutation.mutateAsync();
      addToast('Sign-in background removed', 'success');
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Failed to remove background',
        'error'
      );
    }
  };

  const loginHost = loginUrl ? loginUrl.replace(/^https?:\/\//, '') : '';

  return (
    <section className="bg-white rounded-2xl border border-gray-100 p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Staff sign-in page</h2>
          <p className="mt-1 text-sm text-gray-600">
            Add a photo of your venue, park, or brand behind your logo on your
            team&apos;s sign-in page.
          </p>
        </div>
        {loginUrl ? (
          <a
            href={loginUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 hover:border-[#D4AF37]/50 hover:text-gray-900"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            Open sign-in page
          </a>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-5">
        <div className="md:col-span-3">
          <div
            onDragOver={(e) => {
              // Always claim the drop so the browser never navigates to the file.
              e.preventDefault();
              e.dataTransfer.dropEffect = locked ? 'none' : 'copy';
              if (!locked) setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (!locked) void upload(e.dataTransfer.files?.[0]);
            }}
            className={`overflow-hidden rounded-xl border bg-gray-50 shadow-sm transition ${
              dragOver ? 'border-[#D4AF37] ring-2 ring-[#D4AF37]/40' : 'border-gray-200'
            }`}
          >
            <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-3 py-2">
              <span className="flex gap-1" aria-hidden>
                <span className="h-2 w-2 rounded-full bg-gray-300" />
                <span className="h-2 w-2 rounded-full bg-gray-300" />
                <span className="h-2 w-2 rounded-full bg-gray-300" />
              </span>
              <span className="min-w-0 flex-1 truncate rounded-md bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">
                {loginHost || 'Your staff sign-in page'}
              </span>
            </div>
            <div className="relative flex aspect-[16/10]" aria-label="Sign-in page preview">
              <CompanySignInHero
                variant="preview"
                className="flex w-[55%]"
                brand={{
                  name: name || 'Your company',
                  logoUrl: showLogo ? logoUrl : null,
                  accentColor: accent,
                  backgroundUrl: previewBackground,
                }}
              />
              <div className="flex flex-1 flex-col justify-center gap-1.5 bg-white px-4" aria-hidden>
                <span className="mx-auto mb-1 h-2 w-16 rounded bg-gray-800/80" />
                <span className="h-4 rounded bg-gray-100" />
                <span className="h-4 rounded bg-gray-100" />
                <span
                  className="mt-1 h-4 rounded-full"
                  style={{ backgroundColor: accent ?? '#1f2937' }}
                />
              </div>
              {uploading ? (
                <div
                  role="status"
                  className="absolute inset-0 flex items-center justify-center bg-white/40 backdrop-blur-[1px]"
                >
                  <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-gray-800 shadow">
                    <ButtonSpinner className="h-3.5 w-3.5" />
                    {phase === 'optimising' ? 'Optimising photo…' : 'Uploading…'}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Live preview. Name and brand colour changes apply to the real page
            after you save the profile.
            {!showLogo && logoUrl
              ? ' Your logo is hidden because “Show logo” is off under Public category pages.'
              : ''}
          </p>
        </div>

        <div className="md:col-span-2 flex flex-col gap-3">
          <input
            ref={inputRef}
            type="file"
            accept={[...ACCEPT, '.jpg', '.jpeg', '.png', '.webp'].join(',')}
            className="hidden"
            onChange={(e) => void upload(e.target.files?.[0])}
          />
          {backgroundUrl ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={locked}
                onClick={() => inputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-3 py-2 text-sm font-semibold text-stone-950 hover:brightness-95 disabled:opacity-60"
              >
                {uploading ? (
                  <ButtonSpinner className="h-4 w-4" />
                ) : (
                  <RefreshCw className="h-4 w-4" aria-hidden />
                )}
                Replace photo
              </button>
              <button
                type="button"
                disabled={locked}
                onClick={() => void remove()}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 hover:border-red-200 hover:text-red-700 disabled:opacity-60"
              >
                {clearMutation.isPending ? (
                  <ButtonSpinner className="h-4 w-4" />
                ) : (
                  <Trash2 className="h-4 w-4" aria-hidden />
                )}
                Remove
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={locked}
              onClick={() => inputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 px-4 py-6 text-center transition hover:border-[#D4AF37]/60 hover:bg-[#D4AF37]/5 disabled:opacity-60 disabled:hover:border-gray-200 disabled:hover:bg-transparent"
            >
              {uploading ? (
                <ButtonSpinner className="h-6 w-6 text-[#D4AF37]" />
              ) : (
                <ImagePlus className="h-6 w-6 text-[#D4AF37]" aria-hidden />
              )}
              <span className="text-sm font-semibold text-gray-900">
                Upload a background photo
              </span>
              <span className="text-xs text-gray-500">
                Click to browse, or drop an image on the preview
              </span>
            </button>
          )}
          <p className="text-xs text-gray-500">
            JPEG, PNG, or WebP up to 25MB · large photos are optimised
            automatically
          </p>

          <div className="rounded-xl bg-gray-50 p-3 text-xs text-gray-600">
            <p className="mb-1.5 inline-flex items-center gap-1.5 font-semibold text-gray-800">
              <Lightbulb className="h-3.5 w-3.5 text-[#D4AF37]" aria-hidden />
              For the best result
            </p>
            <ul className="list-disc space-y-1 pl-4">
              <li>Landscape photo, at least 1600 × 1000 px.</li>
              <li>Keep the main subject near the centre — edges crop on smaller screens.</li>
              <li>We add a soft tint in your brand colour so your logo and name stay readable.</li>
              <li>Without a photo, the page uses your brand colour.</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
