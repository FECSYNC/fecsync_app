'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useToast } from '@/contexts/toast-context';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import { AdminHowToGuideButton } from '@/components/Protected/admin/components/AdminHowToGuideButton';
import { DeferredMembershipsGuideModal } from '@/components/Protected/admin/pages/memberships/DeferredMembershipsGuideModal';
import { MEMBERSHIPS_REDEEM_GUIDE_STEPS } from '@/components/Protected/admin/pages/memberships/membershipsGuides';
import {
  btnPrimaryClass,
  fieldClass,
} from '@/components/Protected/admin/pages/ticketing/ticketingUi';
import { listAdminVenueLocations } from '@/services/venueLocations';
import {
  getMembershipCard,
  getMembershipWallet,
  redeemMembership,
  verifyMembershipBenefits,
  patchMembershipMedia,
} from '@/services/memberships';
import { uploadCatalogImages } from '@/services/upload';
import dynamic from 'next/dynamic';

const MembershipCardPrint = dynamic(
  () =>
    import(
      '@/components/Protected/admin/pages/memberships/MembershipCardPrint'
    ),
  { ssr: false }
);

type VerifyPayload = {
  guestMembershipId: string;
  visitStatus: string;
  blocked: boolean;
  blockReason: string | null;
  visitsExhausted: boolean;
  warnings: string[];
  remainingEntries: number | null;
  entriesUsed: number;
  entriesPerPeriod: number | null;
  discountPercent: number;
  perks: string[];
  status: string;
  familyAllowed: boolean;
  familyMembers: Array<{
    guestProfileId: string;
    role: string;
    firstName: string;
    lastName: string;
    photoUrl: string | null;
  }>;
  member: {
    customMembershipId: string;
    barcodeOrCode: string | null;
    qrPayload: string | null;
    photoUrl: string | null;
    firstName: string;
    lastName: string;
    guestPhotoUrl: string | null;
    homeLocationId: string;
  };
};

export default function MembershipRedeemPage() {
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const canRedeem = can(P.MembershipsRedeem) || can(P.MembershipsAdmin);
  const canVerify =
    canRedeem ||
    can(P.MembershipsRead) ||
    can(P.MembershipsWrite) ||
    can(P.MembershipsSell) ||
    can(P.MembershipsBilling) ||
    can(P.MembershipsCancel);
  const canWrite =
    can(P.MembershipsWrite) ||
    can(P.MembershipsSell) ||
    can(P.MembershipsAdmin);

  const [query, setQuery] = useState('');
  const [locationId, setLocationId] = useState('');
  const [verify, setVerify] = useState<VerifyPayload | null>(null);
  const [selectedGuests, setSelectedGuests] = useState<string[]>([]);
  const [lastEventId, setLastEventId] = useState<string | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const [cardData, setCardData] = useState<Record<string, unknown> | null>(null);
  const [walletMsg, setWalletMsg] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const redeemIdempotencyRef = useRef<string | null>(null);

  const venuesQuery = useQuery({
    queryKey: ['admin', 'venue-locations', 'memberships-redeem'],
    queryFn: () => listAdminVenueLocations({ scope: 'all' }),
    enabled: canRedeem,
  });

  const venues = venuesQuery.data ?? [];

  const verifyMutation = useMutation({
    mutationFn: () =>
      verifyMembershipBenefits({
        query: query.trim(),
        locationId,
      }),
    onSuccess: (data) => {
      const v = data.verify as VerifyPayload;
      setVerify(v);
      setSelectedGuests(
        v.familyMembers?.length
          ? [v.familyMembers[0].guestProfileId]
          : []
      );
      setWalletMsg(null);
      redeemIdempotencyRef.current = null;
      addToast('Membership verified', 'success');
    },
    onError: (err: Error) => addToast(err.message || 'Verify failed', 'error'),
  });

  const redeemMutation = useMutation({
    mutationFn: () => {
      if (!redeemIdempotencyRef.current) {
        redeemIdempotencyRef.current = `desk:${verify!.guestMembershipId}:${crypto.randomUUID()}`;
      }
      return redeemMembership({
        guestMembershipId: verify!.guestMembershipId,
        locationId,
        guestProfileIds: selectedGuests,
        kind: 'visit',
        idempotencyKey: redeemIdempotencyRef.current,
      });
    },
    onSuccess: (data) => {
      redeemIdempotencyRef.current = null;
      const redeem = data.redeem as
        | {
            events?: Array<{ id: string }>;
            verify?: VerifyPayload;
            remainingEntries?: number | null;
          }
        | undefined;
      if (redeem?.events?.[0]?.id) setLastEventId(redeem.events[0].id);
      if (redeem?.verify) setVerify(redeem.verify as VerifyPayload);
      addToast(
        `Redeemed — remaining ${redeem?.remainingEntries ?? 'unlimited'}`,
        'success'
      );
    },
    onError: (err: Error) => addToast(err.message || 'Redeem failed', 'error'),
  });

  const undoMutation = useMutation({
    mutationFn: () =>
      redeemMembership({
        action: 'undo',
        usageEventId: lastEventId!,
      }),
    onSuccess: () => {
      setLastEventId(null);
      addToast('Redeem undone', 'success');
      if (verify) verifyMutation.mutate();
    },
    onError: (err: Error) => addToast(err.message || 'Undo failed', 'error'),
  });

  const photoUrl = useMemo(() => {
    if (!verify) return null;
    return verify.member.photoUrl || verify.member.guestPhotoUrl;
  }, [verify]);

  if (!canVerify) {
    return (
      <div className="p-6 text-sm text-stone-600">
        You do not have permission to use the Memberships redeem desk.
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#D4AF37]">
            Memberships
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-stone-900">
            Redeem desk
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            Verify benefits and redeem visits. Family / group redeem is beta.
            Multi-venue status: CURRENT / VISITING / INELIGIBLE.
          </p>
        </div>
        <AdminHowToGuideButton onClick={() => setGuideOpen(true)} />
      </header>

      {guideOpen ? (
        <DeferredMembershipsGuideModal
          open={guideOpen}
          onClose={() => setGuideOpen(false)}
          title="Memberships redeem desk"
          steps={MEMBERSHIPS_REDEEM_GUIDE_STEPS}
        />
      ) : null}

      <section className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <input
          className={fieldClass}
          placeholder="Custom ID, barcode, or membership id"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className={fieldClass}
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
        >
          <option value="">Acting venue…</option>
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={btnPrimaryClass}
          disabled={
            !canVerify ||
            !query.trim() ||
            !locationId ||
            verifyMutation.isPending
          }
          onClick={() => verifyMutation.mutate()}
        >
          {verifyMutation.isPending ? <ButtonSpinner /> : null}
          Verify
        </button>
      </section>

      {verify ? (
        <section className="space-y-4 border border-stone-200 bg-stone-50 p-4">
          <div className="flex flex-wrap items-start gap-4">
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoUrl}
                alt=""
                className="h-24 w-24 object-cover"
              />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center bg-stone-200 text-xs text-stone-500">
                No photo
              </div>
            )}
            <div className="min-w-0 flex-1 space-y-1 text-sm">
              <p className="text-lg font-semibold text-stone-900">
                {verify.member.firstName} {verify.member.lastName}
              </p>
              <p className="text-stone-600">
                ID {verify.member.customMembershipId} · status {verify.status}
              </p>
              <p className="font-medium text-stone-800">
                Venue label:{' '}
                <span
                  className={
                    verify.visitStatus === 'INELIGIBLE'
                      ? 'text-red-700'
                      : verify.visitStatus === 'VISITING'
                        ? 'text-amber-700'
                        : 'text-emerald-700'
                  }
                >
                  {verify.visitStatus}
                </span>
              </p>
              <p>
                Remaining:{' '}
                {verify.remainingEntries == null
                  ? 'Unlimited'
                  : `${verify.remainingEntries} / ${verify.entriesPerPeriod}`}{' '}
                (used {verify.entriesUsed})
              </p>
              <p>Discount: {verify.discountPercent}%</p>
              <p>
                Perks:{' '}
                {verify.perks.length ? verify.perks.join(', ') : 'None'}
              </p>
              {verify.blocked ? (
                <p className="text-red-700">
                  Blocked: {verify.blockReason}
                </p>
              ) : null}
              {verify.visitsExhausted ? (
                <p className="text-amber-800">
                  Visits exhausted for this period (discounts/perks may still apply).
                </p>
              ) : null}
              {verify.blockReason === 'photo_missing' ||
              (canWrite && !photoUrl) ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <label className="inline-flex cursor-pointer items-center gap-2 border border-stone-300 bg-white px-3 py-2">
                    {photoUploading ? 'Uploading…' : 'Upload member photo'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/heic"
                      className="hidden"
                      disabled={!canWrite || photoUploading}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file || !verify) return;
                        setPhotoUploading(true);
                        try {
                          const urls = await uploadCatalogImages(
                            [file],
                            'memberships'
                          );
                          const url = urls[0];
                          if (!url) throw new Error('Upload returned no URL');
                          await patchMembershipMedia(verify.guestMembershipId, {
                            photoUrl: url,
                            alsoUpdateGuestProfile: true,
                          });
                          addToast('Photo saved', 'success');
                          verifyMutation.mutate();
                        } catch (err) {
                          addToast(
                            err instanceof Error ? err.message : 'Upload failed',
                            'error'
                          );
                        } finally {
                          setPhotoUploading(false);
                        }
                      }}
                    />
                  </label>
                </div>
              ) : null}
              {verify.warnings?.map((w) => (
                <p key={w} className="text-amber-700">
                  {w}
                </p>
              ))}
            </div>
          </div>

          {verify.familyAllowed && verify.familyMembers?.length ? (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                Family / group (beta) — select guests to redeem
              </p>
              <div className="flex flex-wrap gap-2">
                {verify.familyMembers.map((m) => {
                  const checked = selectedGuests.includes(m.guestProfileId);
                  return (
                    <label
                      key={m.guestProfileId}
                      className="flex items-center gap-2 border border-stone-300 bg-white px-2 py-1 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setSelectedGuests((prev) =>
                            checked
                              ? prev.filter((id) => id !== m.guestProfileId)
                              : [...prev, m.guestProfileId]
                          );
                        }}
                      />
                      {m.firstName} {m.lastName} ({m.role})
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={btnPrimaryClass}
              disabled={
                !canRedeem ||
                verify.blocked ||
                verify.visitsExhausted ||
                (verify.remainingEntries !== null &&
                  verify.remainingEntries <= 0) ||
                !selectedGuests.length ||
                redeemMutation.isPending
              }
              onClick={() => redeemMutation.mutate()}
            >
              {redeemMutation.isPending ? <ButtonSpinner /> : null}
              Redeem visit
            </button>
            <button
              type="button"
              className="border border-stone-300 bg-white px-3 py-2 text-sm"
              disabled={!canRedeem || !lastEventId || undoMutation.isPending}
              onClick={() => undoMutation.mutate()}
            >
              Undo last redeem
            </button>
            <button
              type="button"
              className="border border-stone-300 bg-white px-3 py-2 text-sm"
              onClick={async () => {
                try {
                  const card = await getMembershipCard(
                    verify.guestMembershipId
                  );
                  setCardData(card);
                  setCardOpen(true);
                } catch (err) {
                  addToast(
                    err instanceof Error ? err.message : 'Card failed',
                    'error'
                  );
                }
              }}
            >
              Print card
            </button>
            <button
              type="button"
              className="border border-stone-300 bg-white px-3 py-2 text-sm"
              onClick={async () => {
                try {
                  const wallet = await getMembershipWallet(
                    verify.guestMembershipId
                  );
                  if (wallet.status === 'not_configured') {
                    setWalletMsg(
                      String(
                        wallet.message ||
                          'Wallet not configured — digital QR still available'
                      )
                    );
                  } else {
                    // Signing not shipped — never claim download success.
                    setWalletMsg(
                      'Wallet pass signing is not available — use the digital QR / membership code.'
                    );
                  }
                } catch (err) {
                  addToast(
                    err instanceof Error ? err.message : 'Wallet failed',
                    'error'
                  );
                }
              }}
            >
              Digital wallet
            </button>
          </div>

          {walletMsg ? (
            <p className="text-sm text-stone-600">{walletMsg}</p>
          ) : null}

          {verify.member.qrPayload ? (
            <div className="border border-dashed border-stone-300 bg-white p-3 text-xs text-stone-600">
              <p className="font-semibold text-stone-800">Digital card QR payload</p>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all">
                {verify.member.qrPayload}
              </pre>
              <p className="mt-1">
                Code: {verify.member.barcodeOrCode || verify.member.customMembershipId}
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      {cardOpen && cardData ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-auto bg-white p-4 shadow-lg">
            <div className="mb-3 flex justify-between gap-2">
              <h2 className="text-lg font-semibold">Membership card</h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={btnPrimaryClass}
                  onClick={() => window.print()}
                >
                  Print
                </button>
                <button
                  type="button"
                  className="border border-stone-300 px-3 py-2 text-sm"
                  onClick={() => setCardOpen(false)}
                >
                  Close
                </button>
              </div>
            </div>
            <div ref={printRef}>
              <MembershipCardPrint card={cardData} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
