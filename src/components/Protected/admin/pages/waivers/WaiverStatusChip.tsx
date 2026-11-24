const CHIP: Record<string, string> = {
  valid: "VALID",
  missing: "MISSING",
  expired: "EXPIRED",
  declined: "DECLINED",
  pending: "PENDING",
  minor_unsigned: "MINOR UNSIGNED",
  voided: "VOIDED",
  unavailable: "CHECK FAILED",
};

export default function WaiverStatusChip({ status }: { status: string }) {
  return (
    <span className="text-lg font-semibold text-[#D4AF37]">{CHIP[status] ?? status}</span>
  );
}

export function waiverStatusLabel(status: string): string {
  return CHIP[status] ?? status;
}
