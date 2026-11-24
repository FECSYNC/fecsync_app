'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/contexts/toast-context';
import {
  cancelMyMembership,
  getMyMembership,
  getMyMembershipCard,
  linkMyGuestProfile,
  listMyMemberships,
  meMembershipKeys,
  reactivateMyMembership,
  renewMyMembership,
  signMyMembershipAgreement,
  updateMyMembershipCard,
  upgradeMyMembership,
  type CancelAlternative,
  type MyMembershipDetail,
} from '@/services/memberships';
import {
  htmlToPlainText,
  isEmptyMembershipHtml,
  sanitizeMembershipHtml,
} from '@/lib/memberships/richText';

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

function StatusPill({ status, cancelAtPeriodEnd }: { status: string; cancelAtPeriodEnd?: boolean }) {
  const tone =
    status === 'active'
      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
      : status === 'past_due'
        ? 'bg-amber-50 text-amber-800 border-amber-200'
        : status === 'pending'
          ? 'bg-sky-50 text-sky-800 border-sky-200'
          : 'bg-stone-100 text-stone-700 border-stone-200';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}>
      {status.replace('_', ' ')}
      {cancelAtPeriodEnd ? ' · ends at period end' : ''}
    </span>
  );
}

export default function ProfileMembershipsSection() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: meMembershipKeys.list(),
    queryFn: listMyMemberships,
  });
  const memberships = query.data?.memberships ?? [];
  const linked = query.data?.linked ?? false;

  return (
    <div className="space-y-6 px-3 py-4 sm:px-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-[#D4AF37]">
          Membership dashboard
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-stone-900">My memberships</h1>
        <p className="mt-1 text-sm text-stone-600">
          Track visits, plan details, renewals, and payment history for park memberships
          linked to this account. Existing customer emails are matched automatically when
          the park sells or invites you.
        </p>
      </div>

      {query.isLoading ? (
        <p className="text-sm text-stone-500">Loading memberships…</p>
      ) : query.isError ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {errMessage(query.error, 'Could not load memberships')}
        </p>
      ) : selectedId ? (
        <MembershipDetail id={selectedId} onBack={() => setSelectedId(null)} />
      ) : (
        <>
          {memberships.length === 0 ? (
            <p className="rounded-lg border border-stone-200 bg-white p-6 text-sm text-stone-500">
              {linked
                ? 'No memberships on your linked guest profile yet. Ask the park desk to sell a plan to your profile.'
                : 'No park membership is linked to this account yet. If the desk used the same email as this login, refresh after they sell or invite you. Otherwise use the link form below, or ask the park to send a dashboard invite.'}
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <DashStat
                  label="Active plans"
                  value={String(
                    memberships.filter((m) => m.status === 'active').length
                  )}
                />
                <DashStat
                  label="Needs attention"
                  value={String(
                    memberships.filter((m) =>
                      ['past_due', 'pending', 'paused'].includes(m.status)
                    ).length
                  )}
                />
                <DashStat
                  label="Total memberships"
                  value={String(memberships.length)}
                />
              </div>
              <ul className="divide-y divide-stone-100 overflow-hidden rounded-lg border border-stone-200 bg-white">
                {memberships.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-medium text-stone-900">{m.plan.name}</p>
                      <p className="text-xs text-stone-500">
                        {m.customMembershipId} · {m.homeLocation?.name ?? 'Home venue'} · renews/ends{' '}
                        {formatDate(m.currentPeriodEnd)}
                        {m.remainingEntries != null ? ` · ${m.remainingEntries} visits left` : ''}
                      </p>
                      <div className="mt-1">
                        <StatusPill status={m.status} cancelAtPeriodEnd={m.cancelAtPeriodEnd} />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedId(m.id)}
                      className="rounded-md bg-[#D4AF37] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#c4a030]"
                    >
                      Open dashboard
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <LinkGuestProfileForm />
        </>
      )}
    </div>
  );
}

function DashStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-gradient-to-br from-white to-amber-50/50 px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-stone-900">{value}</p>
    </div>
  );
}

function LinkGuestProfileForm() {
  const qc = useQueryClient();
  const { addToast } = useToast();
  const [guestProfileId, setGuestProfileId] = useState('');
  const [orgId, setOrgId] = useState('');
  const link = useMutation({
    mutationFn: () =>
      linkMyGuestProfile({ guestProfileId: guestProfileId.trim(), orgId: orgId.trim() }),
    onSuccess: () => {
      addToast('Guest profile linked', 'success');
      setGuestProfileId('');
      setOrgId('');
      void qc.invalidateQueries({ queryKey: meMembershipKeys.all });
    },
    onError: (err) => addToast(errMessage(err, 'Could not link guest profile'), 'error'),
  });

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-stone-800">Link a park guest profile</h2>
      <p className="mt-1 text-xs text-stone-500">
        Enter the guest profile reference and park company reference from your membership receipt or the park desk.
        The guest profile email must match your account email.
      </p>
      <form
        className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          if (!guestProfileId.trim() || !orgId.trim()) return;
          link.mutate();
        }}
      >
        <input
          value={guestProfileId}
          onChange={(e) => setGuestProfileId(e.target.value)}
          placeholder="Guest profile reference"
          className="rounded-md border border-stone-300 px-3 py-2 text-sm focus:border-[#D4AF37] focus:outline-none"
        />
        <input
          value={orgId}
          onChange={(e) => setOrgId(e.target.value)}
          placeholder="Park company reference"
          className="rounded-md border border-stone-300 px-3 py-2 text-sm focus:border-[#D4AF37] focus:outline-none"
        />
        <button
          type="submit"
          disabled={link.isPending || !guestProfileId.trim() || !orgId.trim()}
          className="rounded-md bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {link.isPending ? 'Linking…' : 'Link'}
        </button>
      </form>
    </section>
  );
}

function MembershipDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const { addToast } = useToast();
  const detailQuery = useQuery({
    queryKey: meMembershipKeys.detail(id),
    queryFn: () => getMyMembership(id),
  });
  const [showCard, setShowCard] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [upgradePlanId, setUpgradePlanId] = useState('');
  const [cardSetup, setCardSetup] = useState<{
    clientSecret: string;
    setupIntentId: string;
  } | null>(null);
  const [cardMsg, setCardMsg] = useState<string | null>(null);

  const invalidate = () => void qc.invalidateQueries({ queryKey: meMembershipKeys.all });

  const renew = useMutation({
    mutationFn: () => renewMyMembership(id),
    onSuccess: (r) => {
      addToast(r.note ? `Renewal submitted — ${r.note}` : 'Renewal submitted', 'success');
      invalidate();
    },
    onError: (err) => addToast(errMessage(err, 'Could not renew'), 'error'),
  });
  const reactivate = useMutation({
    mutationFn: () => reactivateMyMembership(id),
    onSuccess: (r) => {
      addToast(r.note ? `Reactivation submitted — ${r.note}` : 'Reactivation submitted', 'success');
      invalidate();
    },
    onError: (err) => addToast(errMessage(err, 'Could not reactivate'), 'error'),
  });
  const upgrade = useMutation({
    mutationFn: () => upgradeMyMembership(id, upgradePlanId),
    onSuccess: (r) => {
      addToast(r.note ? `Upgrade submitted — ${r.note}` : 'Upgrade submitted', 'success');
      setUpgradePlanId('');
      invalidate();
    },
    onError: (err) => addToast(errMessage(err, 'Could not upgrade'), 'error'),
  });
  const updateCard = useMutation({
    mutationFn: () => updateMyMembershipCard(id),
    onSuccess: async (r) => {
      const secret = r.paymentMethod?.clientSecret;
      if (secret) {
        setCardSetup({
          clientSecret: secret,
          setupIntentId: r.paymentMethod.setupIntentId,
        });
        setCardMsg(null);
        addToast('Enter your card below to finish updating payment method.', 'info');
      } else {
        addToast(
          'Stripe SetupIntent created but no client secret was returned — contact the park.',
          'info'
        );
      }
    },
    onError: (err) => addToast(errMessage(err, 'Card update is not available'), 'error'),
  });
  const sign = useMutation({
    mutationFn: () => signMyMembershipAgreement(id),
    onSuccess: (r) => {
      addToast(r.membershipStatus === 'active' ? 'Agreement accepted — membership active' : 'Agreement accepted', 'success');
      invalidate();
    },
    onError: (err) => addToast(errMessage(err, 'Could not accept agreement'), 'error'),
  });

  if (detailQuery.isLoading) return <p className="text-sm text-stone-500">Loading membership…</p>;
  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div className="space-y-3">
        <button type="button" onClick={onBack} className="text-sm font-medium text-[#D4AF37]">
          ← Back
        </button>
        <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {errMessage(detailQuery.error, 'Membership not found')}
        </p>
      </div>
    );
  }

  const d = detailQuery.data;
  const m = d.membership;
  const cancellable =
    ['active', 'past_due', 'paused', 'pending'].includes(m.status) && !m.cancelAtPeriodEnd;
  const canReactivate = ['cancelled', 'expired', 'paused'].includes(m.status);
  const needsAgreement = m.status === 'pending' && !m.agreementSignedAt;
  const upgradePlans =
    m.status === 'active' && !m.cancelAtPeriodEnd ? (d.upgradePlans ?? []) : [];
  const canRenew =
    m.status === 'past_due' ||
    ((m.status === 'active' || m.status === 'pending') &&
      !m.hasLiveStripeSubscription &&
      !m.cancelAtPeriodEnd);

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="text-sm font-medium text-[#D4AF37]">
        ← Back to memberships
      </button>

      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-stone-900">{m.plan.name}</h2>
            <p className="text-xs text-stone-500">{m.customMembershipId}</p>
          </div>
          <StatusPill status={m.status} cancelAtPeriodEnd={m.cancelAtPeriodEnd} />
        </div>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <Row
            label="Home venue"
            value={m.homeLocation?.name ?? m.homeLocationId ?? '—'}
          />
          <Row label="Visit status" value={d.verify.visitStatus ?? '—'} />
          <Row label="Current period" value={`${formatDate(m.currentPeriodStart)} – ${formatDate(m.currentPeriodEnd)}`} />
          <Row
            label="Price"
            value={`${m.plan.currency} ${Number(m.plan.price).toFixed(2)} (${m.plan.billing})`}
          />
          <Row
            label="Visits remaining"
            value={d.verify.remainingEntries == null ? 'Unlimited / not tracked' : String(d.verify.remainingEntries)}
          />
          <Row label="Member discount" value={`${d.verify.discountPercent ?? 0}%`} />
          {m.plan.membershipType ? (
            <Row label="Membership type" value={m.plan.membershipType} />
          ) : null}
          {m.cancelAtPeriodEnd ? (
            <Row label="Access ends" value={formatDate(m.currentPeriodEnd)} />
          ) : null}
        </dl>
        {m.plan.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={m.plan.imageUrl}
            alt=""
            className="mt-3 h-24 w-auto rounded border border-stone-200 object-cover"
          />
        ) : null}
        {!isEmptyMembershipHtml(m.plan.instructions) ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            <p className="font-medium">Instructions</p>
            {/<[a-z][\s\S]*>/i.test(m.plan.instructions ?? '') ? (
              <div
                className="mt-1 prose prose-sm max-w-none text-amber-950 [&_a]:underline [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5"
                dangerouslySetInnerHTML={{
                  __html: sanitizeMembershipHtml(m.plan.instructions ?? ''),
                }}
              />
            ) : (
              <p className="mt-1 whitespace-pre-wrap">
                {htmlToPlainText(m.plan.instructions ?? '')}
              </p>
            )}
          </div>
        ) : null}
        {!isEmptyMembershipHtml(m.plan.cancellationTerms) ? (
          <div className="mt-3 rounded-md border border-stone-200 bg-stone-50 p-3 text-sm text-stone-800">
            <p className="font-medium">Cancellation terms</p>
            {/<[a-z][\s\S]*>/i.test(m.plan.cancellationTerms ?? '') ? (
              <div
                className="mt-1 prose prose-sm max-w-none text-stone-800 [&_a]:text-[#8a7020] [&_a]:underline [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5"
                dangerouslySetInnerHTML={{
                  __html: sanitizeMembershipHtml(m.plan.cancellationTerms ?? ''),
                }}
              />
            ) : (
              <p className="mt-1 whitespace-pre-wrap">
                {htmlToPlainText(m.plan.cancellationTerms ?? '')}
              </p>
            )}
          </div>
        ) : null}
        {m.plan.customRedemptionDescription?.trim() ? (
          <p className="mt-2 text-xs text-stone-500">
            {m.plan.customRedemptionDescription}
          </p>
        ) : null}
      </section>

      {needsAgreement ? (
        <section className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm">
          <p className="font-medium text-sky-900">Membership agreement required</p>
          <p className="mt-1 text-sky-800">
            Your membership stays pending until you accept the park membership terms. This is an electronic acceptance
            record, not a certified e-signature.
          </p>
          {(() => {
            const body =
              d.agreement?.storageRef?.trim() ||
              'I agree to the park membership terms, house rules, and recurring billing (if applicable).';
            const isHtml = /<[a-z][\s\S]*>/i.test(body);
            return (
              <div className="mt-3 max-h-48 overflow-y-auto rounded-md border border-sky-200 bg-white p-3 text-stone-800">
                {isHtml ? (
                  <div
                    className="prose prose-sm max-w-none text-stone-800 [&_a]:text-[#8a7020] [&_a]:underline [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5"
                    dangerouslySetInnerHTML={{
                      __html: sanitizeMembershipHtml(body),
                    }}
                  />
                ) : (
                  <p className="whitespace-pre-wrap">{body}</p>
                )}
              </div>
            );
          })()}
          {d.agreement?.honestyNote ? (
            <p className="mt-2 text-xs text-sky-700">{d.agreement.honestyNote}</p>
          ) : null}
          <button
            type="button"
            disabled={sign.isPending}
            onClick={() => sign.mutate()}
            className="mt-3 rounded-md bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {sign.isPending ? 'Saving…' : 'I accept the membership terms'}
          </button>
        </section>
      ) : null}

      {upgradePlans.length > 0 ? (
        <section className="rounded-lg border border-stone-200 bg-white p-4 text-sm">
          <p className="font-medium text-stone-900">Upgrade plan</p>
          <p className="mt-1 text-stone-600">
            Same upgrade group only — cross-group upgrades are blocked.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              className="rounded-md border border-stone-300 px-3 py-2 text-sm"
              value={upgradePlanId}
              onChange={(e) => setUpgradePlanId(e.target.value)}
            >
              <option value="">Choose a plan…</option>
              {upgradePlans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.currency} {Number(p.price).toFixed(2)}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!upgradePlanId || upgrade.isPending}
              onClick={() => upgrade.mutate()}
              className="rounded-md bg-[#D4AF37] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {upgrade.isPending ? 'Upgrading…' : 'Upgrade'}
            </button>
          </div>
        </section>
      ) : null}

      <section className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setShowCard((v) => !v)}
          className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-800 hover:border-[#D4AF37]"
        >
          {showCard ? 'Hide membership card' : 'Show membership card'}
        </button>
        {canRenew ? (
          <button
            type="button"
            disabled={renew.isPending}
            onClick={() => renew.mutate()}
            className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-800 hover:border-[#D4AF37] disabled:opacity-50"
          >
            {renew.isPending ? 'Renewing…' : 'Renew now'}
          </button>
        ) : null}
        {canReactivate ? (
          <button
            type="button"
            disabled={reactivate.isPending}
            onClick={() => reactivate.mutate()}
            className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-800 hover:border-[#D4AF37] disabled:opacity-50"
          >
            {reactivate.isPending
              ? m.status === 'paused'
                ? 'Resuming…'
                : 'Reactivating…'
              : m.status === 'paused'
                ? 'Resume membership'
                : 'Reactivate'}
          </button>
        ) : null}
        {m.plan.billing === 'recurring' && !canReactivate ? (
          <button
            type="button"
            disabled={updateCard.isPending}
            onClick={() => updateCard.mutate()}
            className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-800 hover:border-[#D4AF37] disabled:opacity-50"
          >
            Update payment card
          </button>
        ) : null}
        {cancellable && d.clickToCancelEnabled ? (
          <button
            type="button"
            onClick={() => setCancelOpen(true)}
            className="rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
          >
            Cancel membership
          </button>
        ) : null}
      </section>

      {cardSetup ? (
        <CardSetupForm
          clientSecret={cardSetup.clientSecret}
          onDone={(msg) => {
            setCardMsg(msg);
            setCardSetup(null);
            addToast(msg, 'success');
          }}
          onError={(msg) => {
            setCardMsg(msg);
            addToast(msg, 'error');
          }}
        />
      ) : null}
      {cardMsg ? <p className="text-xs text-stone-500">{cardMsg}</p> : null}

      {cancellable && !d.clickToCancelEnabled ? (
        <p className="text-xs text-stone-500">
          Online cancellation is turned off for this park — please contact the venue to cancel.
        </p>
      ) : null}

      {showCard ? <MembershipCardPanel id={id} /> : null}

      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-stone-900">Visit activity</h3>
        <p className="mt-1 text-xs text-stone-500">
          Redeems and entitlement usage at the park (most recent first).
        </p>
        {(d.activity?.length ?? 0) === 0 ? (
          <p className="mt-3 text-sm text-stone-500">No visits recorded yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-stone-100 text-sm">
            {(d.activity ?? []).map((e) => (
              <li key={e.id} className="flex flex-wrap justify-between gap-2 py-2">
                <div>
                  <p className="font-medium text-stone-800">
                    {e.kind.replace(/_/g, ' ')}
                    {e.qty > 1 ? ` ×${e.qty}` : ''}
                  </p>
                  <p className="text-xs text-stone-500">
                    {e.locationName ?? 'Venue'} · {e.source}
                    {e.remainingAfter != null
                      ? ` · ${e.remainingAfter} left after`
                      : ''}
                  </p>
                </div>
                <time className="text-xs text-stone-500">
                  {new Date(e.createdAt).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-stone-900">Payment history</h3>
        <p className="mt-1 text-xs text-stone-500">
          Membership billing attempts (desk collected, Stripe, pending).
        </p>
        {(d.paymentAttempts?.length ?? 0) === 0 ? (
          <p className="mt-3 text-sm text-stone-500">No payment attempts yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-stone-100 text-sm">
            {(d.paymentAttempts ?? []).map((p) => (
              <li key={p.id} className="flex flex-wrap justify-between gap-2 py-2">
                <div>
                  <p className="font-medium text-stone-800">
                    {p.currency} {Number(p.amount).toFixed(2)} · {p.status}
                  </p>
                  <p className="text-xs text-stone-500">
                    Attempt #{p.attemptNumber}
                    {p.errorMessage ? ` · ${p.errorMessage}` : ''}
                  </p>
                </div>
                <time className="text-xs text-stone-500">
                  {new Date(p.createdAt).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>

      {cancelOpen ? (
        <CancelFlow
          detail={d}
          onClose={() => setCancelOpen(false)}
          onDone={() => {
            setCancelOpen(false);
            invalidate();
          }}
        />
      ) : null}
    </div>
  );
}

function CardSetupForm({
  clientSecret,
  onDone,
  onError,
}: {
  clientSecret: string;
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stripeRef = useRef<{
    confirmSetup: (opts: {
      elements: unknown;
      confirmParams: { return_url: string };
      redirect: 'if_required';
    }) => Promise<{ error?: { message?: string } }>;
  } | null>(null);
  const elementsRef = useRef<unknown>(null);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const pk = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim();
      if (!pk) {
        onError(
          'Stripe publishable key is not configured — card entry unavailable. Contact the park.'
        );
        return;
      }
      try {
        const { loadStripe } = await import('@stripe/stripe-js');
        const stripe = await loadStripe(pk);
        if (!stripe || cancelled || !hostRef.current) return;
        const elements = stripe.elements({ clientSecret });
        const paymentElement = elements.create('payment');
        hostRef.current.innerHTML = '';
        paymentElement.mount(hostRef.current);
        stripeRef.current = stripe as typeof stripeRef.current;
        elementsRef.current = elements;
        if (!cancelled) setReady(true);
      } catch (err) {
        if (!cancelled) {
          onError(err instanceof Error ? err.message : 'Could not load card form');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientSecret, onError]);

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4 text-sm">
      <p className="font-medium text-stone-900">Confirm new card</p>
      <p className="mt-1 text-stone-600">
        Uses Stripe SetupIntent. Card details go to Stripe only — never to this app&apos;s API.
      </p>
      <div ref={hostRef} className="mt-3 rounded-md border border-stone-300 px-3 py-2" />
      <button
        type="button"
        disabled={!ready || pending}
        className="mt-3 rounded-md bg-[#D4AF37] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        onClick={async () => {
          if (!stripeRef.current || !elementsRef.current) {
            onError('Card form is not ready');
            return;
          }
          setPending(true);
          try {
            const result = await stripeRef.current.confirmSetup({
              elements: elementsRef.current,
              confirmParams: { return_url: window.location.href },
              redirect: 'if_required',
            });
            if (result.error) {
              onError(result.error.message || 'Card confirmation failed');
              return;
            }
            onDone('Card updated successfully');
          } catch (err) {
            onError(err instanceof Error ? err.message : 'Card confirmation failed');
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? 'Saving…' : ready ? 'Confirm card' : 'Loading form…'}
      </button>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-stone-500">{label}</dt>
      <dd className="text-stone-900">{value}</dd>
    </div>
  );
}

function MembershipCardPanel({ id }: { id: string }) {
  const cardQuery = useQuery({
    queryKey: meMembershipKeys.card(id),
    queryFn: () => getMyMembershipCard(id),
  });
  if (cardQuery.isLoading) return <p className="text-sm text-stone-500">Loading card…</p>;
  if (cardQuery.isError || !cardQuery.data) {
    return <p className="text-sm text-red-700">{errMessage(cardQuery.error, 'Could not load card')}</p>;
  }
  const { card, wallet } = cardQuery.data;
  const walletMessage = typeof wallet.message === 'string' ? wallet.message : null;
  const qrData = card.qrPayload || card.barcodeOrCode || card.customMembershipId;
  return (
    <section className="max-w-sm rounded-xl border border-[#D4AF37]/40 bg-gradient-to-br from-stone-900 to-stone-800 p-5 text-white">
      <p className="text-xs uppercase tracking-wide text-[#D4AF37]">
        {card.orgBrand.companyName ?? 'Park membership'}
      </p>
      <p className="mt-2 text-lg font-semibold">{card.memberName}</p>
      <p className="text-sm text-stone-300">{card.planName}</p>
      <p className="text-xs text-stone-400">{card.homeLocationName ?? ''}</p>
      {qrData ? (
        <div className="mt-4 flex justify-center rounded-md bg-white p-3">
          {/* Same QR helper pattern as booking tickets — scannable at the desk */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            width={160}
            height={160}
            alt="Membership QR code"
            src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(qrData)}`}
          />
        </div>
      ) : null}
      <div className="mt-3 rounded-md bg-white px-3 py-2 text-center font-mono text-base tracking-widest text-stone-900">
        {card.barcodeOrCode ?? card.customMembershipId}
      </div>
      <p className="mt-2 text-xs text-stone-300">
        Show this QR or membership code at the park entrance or desk — staff scan or type it to verify your membership.
      </p>
      <p className="mt-2 text-xs text-stone-400">
        {walletMessage ??
          'Apple / Google Wallet signed passes are not available yet — use this QR or membership code at the park.'}
      </p>
    </section>
  );
}

function CancelFlow({
  detail,
  onClose,
  onDone,
}: {
  detail: MyMembershipDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const { addToast } = useToast();
  const m = detail.membership;
  const [step, setStep] = useState<'alternatives' | 'confirm'>(
    detail.cancelAlternativesEnabled && detail.alternatives.length > 0 ? 'alternatives' : 'confirm'
  );
  const [alternatives, setAlternatives] = useState<CancelAlternative[]>(detail.alternatives);
  const [reason, setReason] = useState('');
  const [when, setWhen] = useState<'end_of_period' | 'immediate'>('end_of_period');

  const accept = useMutation({
    mutationFn: (alternativeId: string) =>
      cancelMyMembership(m.id, { when, confirm: true, alternativeId }),
    onSuccess: (r) => {
      if (!r.requiresAlternatives && r.alternativeApplied) {
        addToast(r.alternativeApplied.note ?? 'Offer applied — your membership continues', 'success');
        onDone();
      }
    },
    onError: (err) => addToast(errMessage(err, 'Could not apply offer'), 'error'),
  });

  const cancel = useMutation({
    mutationFn: () =>
      cancelMyMembership(m.id, {
        when,
        reason: reason.trim() || undefined,
        confirm: true,
        declineAlternatives: true,
      }),
    onSuccess: (r) => {
      if (r.requiresAlternatives) {
        setAlternatives(r.alternatives);
        setStep('alternatives');
        return;
      }
      addToast(
        when === 'end_of_period'
          ? `Cancellation scheduled — access continues until ${formatDate(m.currentPeriodEnd)}`
          : 'Membership cancelled'
      , 'success');
      onDone();
    },
    onError: (err) => addToast(errMessage(err, 'Could not cancel membership'), 'error'),
  });

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-semibold text-stone-900">Cancel membership</h3>
        <button type="button" onClick={onClose} className="text-sm text-stone-500 hover:text-stone-800">
          Close
        </button>
      </div>

      {step === 'alternatives' ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-stone-600">
            Before you go — the park has a few options that might suit you better.{' '}
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
              Beta
            </span>
          </p>
          <ul className="space-y-2">
            {alternatives.map((alt) => (
              <li
                key={alt.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-stone-200 px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-stone-900">{alt.name}</p>
                  <p className="text-xs text-stone-500">{describeAlternative(alt)}</p>
                </div>
                {alt.kind !== 'message' ? (
                  <button
                    type="button"
                    disabled={accept.isPending}
                    onClick={() => accept.mutate(alt.id)}
                    className="rounded-md bg-[#D4AF37] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Accept offer
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setStep('confirm')}
            className="text-sm font-medium text-stone-700 underline"
          >
            No thanks, continue to cancel
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <fieldset className="space-y-1 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="when"
                checked={when === 'end_of_period'}
                onChange={() => setWhen('end_of_period')}
              />
              At the end of the current period ({formatDate(m.currentPeriodEnd)}) — keep access until then
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="when" checked={when === 'immediate'} onChange={() => setWhen('immediate')} />
              Immediately — access ends now
            </label>
          </fieldset>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 500))}
            placeholder="Reason (optional)"
            rows={3}
            className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm focus:border-[#D4AF37] focus:outline-none"
          />
          <p className="text-xs text-stone-500">
            You will receive a confirmation email. Refunds, if any, follow the park&apos;s membership terms.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate()}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {cancel.isPending ? 'Cancelling…' : 'Confirm cancellation'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-stone-300 px-4 py-2 text-sm text-stone-700"
            >
              Keep membership
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function describeAlternative(alt: CancelAlternative): string {
  const c = alt.config;
  switch (alt.kind) {
    case 'pause_offer':
      return 'Pause your membership instead of cancelling.';
    case 'discount': {
      const credit = Number(c.creditMajor ?? c.amountMajor ?? 0);
      return credit > 0 ? `Receive ${credit.toFixed(2)} account credit to stay.` : 'Account credit to stay.';
    }
    case 'downgrade':
      return 'Switch to a lower-priced plan.';
    case 'message':
      return typeof c.message === 'string' ? c.message : 'A message from the park.';
    default:
      return '';
  }
}
