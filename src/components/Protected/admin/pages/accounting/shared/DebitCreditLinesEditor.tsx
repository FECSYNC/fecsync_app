"use client";

import AccountPicker from "./AccountPicker";
import MoneyInput from "./MoneyInput";
import MoneyCell from "./MoneyCell";

export type JournalLineDraft = {
  key: string;
  ledgerAccountId: string;
  description: string;
  debit: string;
  credit: string;
  locationId?: string;
};

function moneyToCents(v: string): number {
  const cleaned = v.trim();
  if (!cleaned) return 0;
  const neg = cleaned.startsWith("-");
  const [w, f = ""] = cleaned.replace("-", "").split(".");
  const whole = Number(w || "0");
  const frac = Number((f + "00").slice(0, 2));
  if (!Number.isFinite(whole) || !Number.isFinite(frac)) return 0;
  const cents = whole * 100 + frac;
  return neg ? -cents : cents;
}

function centsToDisplay(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return neg ? `-${s}` : s;
}

function newLine(): JournalLineDraft {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ledgerAccountId: "",
    description: "",
    debit: "",
    credit: "",
  };
}

export default function DebitCreditLinesEditor({
  lines,
  onChange,
  currency = "USD",
  disabled,
  className = "",
}: {
  lines: JournalLineDraft[];
  onChange: (lines: JournalLineDraft[]) => void;
  currency?: string;
  disabled?: boolean;
  className?: string;
}) {
  const rows = lines.length >= 2 ? lines : [newLine(), newLine()];
  const debitCents = rows.reduce((s, l) => s + moneyToCents(l.debit), 0);
  const creditCents = rows.reduce((s, l) => s + moneyToCents(l.credit), 0);
  const diff = debitCents - creditCents;
  const balanced = diff === 0 && debitCents > 0;

  const update = (key: string, patch: Partial<JournalLineDraft>) => {
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="overflow-x-auto rounded-2xl border border-gray-100">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Account</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2 text-right">Debit</th>
              <th className="px-3 py-2 text-right">Credit</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((line, idx) => (
              <tr key={line.key} className="border-t border-gray-50">
                <td className="px-3 py-2 align-top">
                  <AccountPicker
                    value={line.ledgerAccountId}
                    disabled={disabled}
                    label=""
                    onChange={(id) => update(line.key, { ledgerAccountId: id })}
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <input
                    type="text"
                    value={line.description}
                    disabled={disabled}
                    onChange={(e) =>
                      update(line.key, { description: e.target.value })
                    }
                    className="w-full min-w-[10rem] rounded-xl border border-gray-200 px-3 py-2 outline-none focus:border-[#D4AF37]"
                    placeholder={`Line ${idx + 1}`}
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <MoneyInput
                    value={line.debit}
                    currency={currency}
                    disabled={disabled || Boolean(line.credit)}
                    onChange={(debit) =>
                      update(line.key, { debit, credit: debit ? "" : line.credit })
                    }
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <MoneyInput
                    value={line.credit}
                    currency={currency}
                    disabled={disabled || Boolean(line.debit)}
                    onChange={(credit) =>
                      update(line.key, { credit, debit: credit ? "" : line.debit })
                    }
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <button
                    type="button"
                    disabled={disabled || rows.length <= 2}
                    onClick={() =>
                      onChange(rows.filter((r) => r.key !== line.key))
                    }
                    className="text-xs font-medium text-red-600 disabled:text-gray-300"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange([...rows, newLine()])}
          className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Add line
        </button>
        <div className="text-sm text-gray-700">
          <span className="mr-4">
            Debits: <MoneyCell value={centsToDisplay(debitCents)} currency={currency} />
          </span>
          <span className="mr-4">
            Credits:{" "}
            <MoneyCell value={centsToDisplay(creditCents)} currency={currency} />
          </span>
          {balanced ? (
            <span className="font-medium text-emerald-700">Balanced</span>
          ) : (
            <span className="font-medium text-amber-700">
              Out of balance by{" "}
              <MoneyCell value={centsToDisplay(Math.abs(diff))} currency={currency} />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export { moneyToCents, centsToDisplay, newLine as newJournalLineDraft };
