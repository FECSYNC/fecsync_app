'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Loader2,
  Shield,
  Sparkles,
  X,
} from 'lucide-react';
import {
  AI_SCAN_POSE_IDS,
  AI_SCAN_POSE_LABELS,
  type AiScanPoseId,
} from '@/lib/measurements.shared';
import { DEFAULT_CAMPAIGN_JOIN_PRIVACY } from '@/lib/measurementCampaigns.shared';
import { useMeasurementAiScanMutation } from '@/hooks/useMeasurements';
import { useToast } from '@/contexts/toast-context';

const MAX_FILE_BYTES = 4 * 1024 * 1024;

const POSE_HINTS: Record<AiScanPoseId, string> = {
  front: 'Stand straight, arms slightly away from your body, facing the camera.',
  back: 'Turn around so your full back is visible, same posture as the front photo.',
  side: 'Stand sideways with your full profile visible from head to toe.',
};

type Step = 'privacy' | 'capture' | 'review' | 'success';

type Props = {
  open: boolean;
  onClose: () => void;
  profileId?: string;
  profileLabel?: string;
  onComplete?: () => void;
  /** When set, one sponsored scan is consumed on successful analyze. */
  campaignSlug?: string;
  inviteToken?: string;
  sponsoredScansRemaining?: number;
  /** Require a sponsored scan credit (campaign submit modal). */
  requireSponsoredScan?: boolean;
};

async function readFileAsDataUrl(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('Photo is too large — use a smaller image (max 4 MB)');
  }
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose a JPEG or PNG photo');
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read photo'));
    reader.readAsDataURL(file);
  });
}

export default function MeasurementAiScanFlow({
  open,
  onClose,
  profileId,
  profileLabel,
  onComplete,
  campaignSlug,
  inviteToken,
  sponsoredScansRemaining = 0,
  requireSponsoredScan = false,
}: Props) {
  const { addToast } = useToast();
  const scanMut = useMeasurementAiScanMutation();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('privacy');
  const [poseIndex, setPoseIndex] = useState(0);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [images, setImages] = useState<Record<AiScanPoseId, string | null>>({
    front: null,
    back: null,
    side: null,
  });
  const [fieldsUpdated, setFieldsUpdated] = useState(0);
  const [scansLeft, setScansLeft] = useState<number | undefined>();

  const currentPose = AI_SCAN_POSE_IDS[poseIndex];
  const sponsoredBlocked =
    requireSponsoredScan &&
    (!campaignSlug || sponsoredScansRemaining <= 0);

  const reset = useCallback(() => {
    setStep('privacy');
    setPoseIndex(0);
    setPrivacyAccepted(false);
    setImages({ front: null, back: null, side: null });
    setFieldsUpdated(0);
    setScansLeft(undefined);
  }, []);

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const handleClose = () => {
    onClose();
  };

  const onPickFile = async (file: File | undefined) => {
    if (!file || !currentPose) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setImages((prev) => ({ ...prev, [currentPose]: dataUrl }));
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Could not use photo', 'error');
    }
  };

  const allCaptured = AI_SCAN_POSE_IDS.every((id) => Boolean(images[id]));

  const runAnalyze = () => {
    if (!profileId || !images.front || !images.back || !images.side) return;
    void scanMut
      .mutateAsync({
        id: profileId,
        payload: {
          frontImage: images.front,
          backImage: images.back,
          sideImage: images.side,
          ...(campaignSlug ? { campaignSlug, inviteToken } : {}),
        },
      })
      .then((result) => {
        setFieldsUpdated(result.fieldsUpdated);
        setScansLeft(result.scansRemaining);
        setStep('success');
        onComplete?.();
        if (result.sponsoredScanConsumed && result.scansRemaining != null) {
          addToast(
            `Scan complete — ${result.scansRemaining} sponsored scan${result.scansRemaining === 1 ? '' : 's'} left`,
            'success'
          );
        } else {
          addToast('Measurements updated from scan', 'success');
        }
      })
      .catch((err) => {
        addToast(
          err instanceof Error ? err.message : 'Could not analyze photos',
          'error'
        );
      });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-scan-title"
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between border-b border-stone-100 px-5 py-4">
          <div className="min-w-0 pr-3">
            <h2
              id="ai-scan-title"
              className="text-lg font-semibold text-stone-900"
            >
              AI body scan
            </h2>
            {profileLabel ? (
              <p className="mt-0.5 text-sm text-stone-500">{profileLabel}</p>
            ) : null}
            {campaignSlug && sponsoredScansRemaining > 0 ? (
              <p className="mt-1 text-xs font-medium text-[#8A6D00]">
                {sponsoredScansRemaining} sponsored scan
                {sponsoredScansRemaining === 1 ? '' : 's'} remaining
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="shrink-0 rounded-lg p-1 text-stone-500 hover:bg-stone-100"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {!profileId ? (
            <p className="text-sm text-stone-600">
              Select a measurement profile before running a scan.
            </p>
          ) : sponsoredBlocked ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              You have no sponsored AI scans left for this campaign. Enter
              measurements manually or ask your tailor for more credits.
            </p>
          ) : step === 'privacy' ? (
            <div className="space-y-4">
              <div className="flex gap-3 rounded-xl border border-[#E8DDB8] bg-[#FFF8E7] px-4 py-3 text-sm text-stone-800">
                <Shield
                  size={20}
                  className="mt-0.5 shrink-0 text-[#8A6D00]"
                  aria-hidden
                />
                <p>{DEFAULT_CAMPAIGN_JOIN_PRIVACY}</p>
              </div>
              <p className="text-sm text-stone-600">
                You will capture or upload three photos — front, back, and side —
                in fitted clothing against a plain background for best results.
              </p>
              {!requireSponsoredScan && !campaignSlug ? (
                <p className="text-xs text-stone-500">
                  This preview scan does not use campaign credits. Join a
                  measurement campaign for tailor-sponsored scans.
                </p>
              ) : null}
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-stone-200 px-4 py-3">
                <input
                  type="checkbox"
                  checked={privacyAccepted}
                  onChange={(e) => setPrivacyAccepted(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-stone-300 text-[#D4AF37] focus:ring-[#D4AF37]"
                />
                <span className="text-sm text-stone-700">
                  I understand my photos are used only for measurement estimation
                  and are not stored.
                </span>
              </label>
            </div>
          ) : step === 'capture' ? (
            <div className="space-y-4">
              <div className="flex items-center justify-center gap-2">
                {AI_SCAN_POSE_IDS.map((id, idx) => (
                  <span
                    key={id}
                    className={`h-2 w-8 rounded-full transition-colors ${
                      idx === poseIndex
                        ? 'bg-[#D4AF37]'
                        : images[id]
                          ? 'bg-emerald-400'
                          : 'bg-stone-200'
                    }`}
                    aria-hidden
                  />
                ))}
              </div>

              <div className="text-center">
                <p className="text-sm font-semibold text-stone-900">
                  {AI_SCAN_POSE_LABELS[currentPose]} view
                </p>
                <p className="mt-1 text-xs text-stone-500">
                  {POSE_HINTS[currentPose]}
                </p>
              </div>

              <div className="mx-auto flex aspect-[3/4] max-h-64 w-full max-w-xs items-center justify-center overflow-hidden rounded-2xl border border-dashed border-stone-300 bg-stone-50">
                {images[currentPose] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={images[currentPose]!}
                    alt={`${AI_SCAN_POSE_LABELS[currentPose]} preview`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <Camera size={40} className="text-stone-300" aria-hidden />
                )}
              </div>

              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  void onPickFile(file);
                  e.target.value = '';
                }}
              />

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-stone-900 py-2.5 text-sm font-medium text-white hover:bg-stone-800"
                >
                  <Camera size={16} aria-hidden />
                  {images[currentPose] ? 'Retake' : 'Capture'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (fileRef.current) {
                      fileRef.current.removeAttribute('capture');
                      fileRef.current.click();
                      fileRef.current.setAttribute('capture', 'environment');
                    }
                  }}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-stone-200 py-2.5 text-sm font-medium text-stone-800 hover:bg-stone-50"
                >
                  <ImagePlus size={16} aria-hidden />
                  Upload
                </button>
              </div>
            </div>
          ) : step === 'review' ? (
            <div className="space-y-4">
              <p className="text-sm text-stone-600">
                Review your three photos, then analyze to auto-fill upper and
                lower body measurements on your profile.
              </p>
              <div className="grid grid-cols-3 gap-2">
                {AI_SCAN_POSE_IDS.map((id) => (
                  <div key={id} className="space-y-1">
                    <div className="aspect-[3/4] overflow-hidden rounded-xl border border-stone-200 bg-stone-50">
                      {images[id] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={images[id]!}
                          alt={AI_SCAN_POSE_LABELS[id]}
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </div>
                    <p className="text-center text-[10px] font-medium uppercase tracking-wide text-stone-500">
                      {AI_SCAN_POSE_LABELS[id]}
                    </p>
                  </div>
                ))}
              </div>
              {scanMut.isPending ? (
                <p className="flex items-center justify-center gap-2 text-sm text-stone-600">
                  <Loader2 size={18} className="animate-spin" />
                  Analyzing photos…
                </p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-4 py-4 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <CheckCircle2 size={28} aria-hidden />
              </div>
              <p className="text-sm font-medium text-stone-900">
                Scan complete
              </p>
              <p className="text-sm text-stone-600">
                Updated {fieldsUpdated} measurement
                {fieldsUpdated === 1 ? '' : 's'} on your profile.
                {scansLeft != null
                  ? ` ${scansLeft} sponsored scan${scansLeft === 1 ? '' : 's'} left.`
                  : ''}
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-between gap-2 border-t border-stone-100 px-5 py-4">
          {step === 'privacy' ? (
            <>
              <button
                type="button"
                onClick={handleClose}
                className="rounded-xl border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!privacyAccepted || !profileId || sponsoredBlocked}
                onClick={() => setStep('capture')}
                className="inline-flex items-center gap-1 rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
              >
                Continue
                <ChevronRight size={16} aria-hidden />
              </button>
            </>
          ) : step === 'capture' ? (
            <>
              <button
                type="button"
                onClick={() => {
                  if (poseIndex === 0) setStep('privacy');
                  else setPoseIndex((i) => i - 1);
                }}
                className="inline-flex items-center gap-1 rounded-xl border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
              >
                <ChevronLeft size={16} aria-hidden />
                Back
              </button>
              {poseIndex < AI_SCAN_POSE_IDS.length - 1 ? (
                <button
                  type="button"
                  disabled={!images[currentPose]}
                  onClick={() => setPoseIndex((i) => i + 1)}
                  className="inline-flex items-center gap-1 rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
                >
                  Next
                  <ChevronRight size={16} aria-hidden />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!allCaptured}
                  onClick={() => setStep('review')}
                  className="inline-flex items-center gap-1 rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
                >
                  Review
                  <ChevronRight size={16} aria-hidden />
                </button>
              )}
            </>
          ) : step === 'review' ? (
            <>
              <button
                type="button"
                disabled={scanMut.isPending}
                onClick={() => {
                  setStep('capture');
                  setPoseIndex(0);
                }}
                className="rounded-xl border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
              >
                Retake photos
              </button>
              <button
                type="button"
                disabled={scanMut.isPending || !allCaptured}
                onClick={runAnalyze}
                className="inline-flex items-center gap-2 rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
              >
                {scanMut.isPending ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Analyzing…
                  </>
                ) : (
                  <>
                    <Sparkles size={16} className="text-[#D4AF37]" aria-hidden />
                    Analyze
                  </>
                )}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleClose}
              className="ml-auto rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
