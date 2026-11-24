"use client";

import AdminPendingLink from "@/components/Protected/admin/components/AdminPendingLink";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import WaiverSubnav from "@/components/Protected/admin/pages/waivers/WaiverSubnav";
import { cancelWaiverRequests, getWaiverRecord, resendWaiverRecord, voidWaiverRecord, waiverKeys } from "@/services/waivers";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";

export default function WaiverRecordDetailPage() {
  const params = useParams<{ id: string }>();
  const query = useQuery({
    queryKey: waiverKeys.record(params.id),
    queryFn: () => getWaiverRecord(params.id),
    enabled: Boolean(params.id),
  });
  const record = query.data;
  const can = useAuthStore((s) => s.can);
  const canVoid = can(P.WaiversVoid);
  const canWrite = can(P.WaiversWrite);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-semibold text-stone-900">Waiver record</h1>
      <WaiverSubnav />
      {query.isLoading ? <p className="text-sm text-stone-500">Loading…</p> : null}
      {query.isError ? (
        <p className="text-sm text-red-700">
          {query.error instanceof Error ? query.error.message : "Could not load this record"}
        </p>
      ) : null}
      {record ? (
        <div className="space-y-3 text-sm text-stone-800">
          <p className="font-mono">{record.publicRef}</p>
          <p>
            <AdminPendingLink className="text-[#D4AF37]" cornerSpinner={false} href={`/admin/waivers/guests/${record.guest.id}`}>
              {record.guest.firstName} {record.guest.lastName}
            </AdminPendingLink>
            {" · "}
            {record.status} · {record.channel}
          </p>
          <p>
            {record.template.name}
            {record.version != null ? ` · version ${record.version}` : ""} at {record.location.name}
          </p>
          {record.voidReason ? <p>Voided: {record.voidReason}</p> : null}
          <p>Signed {record.signedAt ? new Date(record.signedAt).toLocaleString() : "—"}</p>
          <p>Expires {record.expiresAt ? new Date(record.expiresAt).toLocaleString() : "No expiry"}</p>
          {record.fillMethod ? <p>Fill method: {record.fillMethod}</p> : null}
          <ul className="list-disc pl-5">
            {record.signers.map((signer) => (
              <li key={signer.id}>
                {signer.fullName} · {signer.role}
                {signer.isMinor ? " · minor" : ""}
              </li>
            ))}
          </ul>
          <ul className="list-disc pl-5">
            {record.signatures.map((sig) => (
              <li key={sig.id}>
                {sig.typedName || (sig.hasDrawnSignature ? "Drawn signature" : "Agreement only")} · {sig.timezone} · intent{" "}
                {sig.intentAccepted ? "yes" : "no"}
                {sig.witnessName ? ` · ${sig.witnessName}` : ""}
                {Array.isArray(sig.acceptedClauses) && sig.acceptedClauses.length ? (
                  <span>
                    {" "}
                    · clauses:{" "}
                    {sig.acceptedClauses.map((c) => c.label).join("; ")}
                  </span>
                ) : null}
                {sig.drawnSignatureSvg ? (
                  <span
                    className="mt-2 block h-24 w-56"
                    dangerouslySetInnerHTML={{ __html: sig.drawnSignatureSvg }}
                  />
                ) : null}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2 print:hidden">
            <button type="button" className="rounded border border-stone-300 px-3 py-2" onClick={() => window.print()}>
              Print
            </button>
            {canVoid ? (
              <button
                type="button"
                className="rounded border border-stone-300 px-3 py-2"
                onClick={() => {
                  const reason = window.prompt("Reason for voiding this waiver");
                  if (!reason) return;
                  voidWaiverRecord(params.id, reason).then(() => query.refetch());
                }}
              >
                Void
              </button>
            ) : null}
            {canWrite ? (
              <button
                type="button"
                className="rounded border border-stone-300 px-3 py-2"
                onClick={() => {
                  cancelWaiverRequests(params.id).then((result) => {
                    window.alert(
                      result ? `Cancelled ${result.cancelled} outstanding link${result.cancelled === 1 ? "" : "s"}.` : "Could not cancel"
                    );
                  });
                }}
              >
                Cancel outstanding links
              </button>
            ) : null}
            {canWrite ? (
              <button
                type="button"
                className="rounded border border-stone-300 px-3 py-2"
                onClick={() => {
                  resendWaiverRecord(params.id).then((result) => {
                    if (result?.url) window.prompt("New signing link", result.url);
                  });
                }}
              >
                Resend link
              </button>
            ) : null}
          </div>
          {(record.forms ?? []).map((form) => (
            <div key={form.id}>
              <p className="font-medium">{form.name}</p>
              <ul className="list-disc pl-5">
                {Object.entries(form.answers).map(([key, value]) => (
                  <li key={key}>
                    {key}: {typeof value === "string" ? value : ""}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
