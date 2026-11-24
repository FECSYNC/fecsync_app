'use client';

/**
 * Shared membership card print view (Feature 08 Phase 3).
 * Prefer this single component for admin / future Check-In / POS print.
 */
export type MembershipCardPrintProps = {
  card: {
    customMembershipId?: unknown;
    barcodeOrCode?: unknown;
    qrPayload?: unknown;
    memberName?: unknown;
    photoUrl?: unknown;
    planName?: unknown;
    status?: unknown;
    homeLocationName?: unknown;
    orgBrand?: {
      companyName?: unknown;
      logoUrl?: unknown;
    };
  };
};

export default function MembershipCardPrint({
  card,
}: MembershipCardPrintProps) {
  const companyName =
    typeof card.orgBrand?.companyName === 'string'
      ? card.orgBrand.companyName
      : 'Membership';
  const logoUrl =
    typeof card.orgBrand?.logoUrl === 'string' ? card.orgBrand.logoUrl : null;
  const memberName =
    typeof card.memberName === 'string' ? card.memberName : 'Member';
  const customId =
    typeof card.customMembershipId === 'string'
      ? card.customMembershipId
      : '';
  const code =
    typeof card.barcodeOrCode === 'string' && card.barcodeOrCode
      ? card.barcodeOrCode
      : customId;
  const qr =
    typeof card.qrPayload === 'string' ? card.qrPayload : customId;
  const planName =
    typeof card.planName === 'string' ? card.planName : '';
  const physicalPassMessage =
    typeof card.physicalPassMessage === 'string'
      ? card.physicalPassMessage
      : '';
  const planImageUrl =
    typeof card.planImageUrl === 'string' ? card.planImageUrl : null;
  const photoUrl =
    typeof card.photoUrl === 'string' ? card.photoUrl : null;
  const home =
    typeof card.homeLocationName === 'string' ? card.homeLocationName : null;

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .membership-card-print, .membership-card-print * {
            visibility: visible !important;
          }
          .membership-card-print {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
        }
      `}</style>
      <article className="membership-card-print border-2 border-stone-800 bg-white p-6 text-stone-900">
        <header className="mb-4 flex items-center gap-3 border-b border-stone-300 pb-3">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="h-10 w-10 object-contain" />
          ) : null}
          <div>
            <p className="text-xs uppercase tracking-wide text-stone-500">
              {companyName}
            </p>
            <h1 className="text-xl font-semibold">{memberName}</h1>
          </div>
        </header>
        <div className="flex gap-4">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoUrl}
              alt=""
              className="h-28 w-28 object-cover"
            />
          ) : (
            <div className="flex h-28 w-28 items-center justify-center bg-stone-100 text-xs text-stone-400">
              Photo
            </div>
          )}
          <div className="space-y-1 text-sm">
            <p>
              <span className="text-stone-500">Membership ID</span>
              <br />
              <span className="font-mono text-base font-semibold">{customId}</span>
            </p>
            <p>
              <span className="text-stone-500">Code</span>
              <br />
              <span className="font-mono">{code}</span>
            </p>
            {planName ? <p>Plan: {planName}</p> : null}
            {physicalPassMessage ? (
              <p className="text-sm text-stone-700">{physicalPassMessage}</p>
            ) : null}
            {home ? <p>Home venue: {home}</p> : null}
            {typeof card.status === 'string' ? (
              <p>Status: {card.status}</p>
            ) : null}
          </div>
          {planImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={planImageUrl}
              alt=""
              className="h-20 w-20 object-cover"
            />
          ) : null}
        </div>
        <footer className="mt-4 border-t border-stone-200 pt-3">
          <p className="text-xs text-stone-500">Scan / QR payload</p>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-snug text-stone-700">
            {qr}
          </pre>
        </footer>
      </article>
    </>
  );
}
