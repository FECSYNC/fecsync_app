"use client";

import {
  formatHm,
  joinDateTimeLocal,
  parseHm,
  splitDateTimeLocal,
} from "@/lib/timeClock";

const selectClass =
  "rounded-md border border-stone-300 bg-stone-50 px-2 py-2 text-sm text-stone-900 focus:border-[#D4AF37] focus:outline-none focus:ring-1 focus:ring-[#D4AF37] disabled:opacity-60";
const dateClass =
  "w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-900 focus:border-[#D4AF37] focus:outline-none focus:ring-1 focus:ring-[#D4AF37] disabled:opacity-60";

const HOURS_24 = Array.from({ length: 24 }, (_, i) => i);
const HOURS_12 = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

function hour24To12(hours24: number): { hour: number; period: "AM" | "PM" } {
  const period: "AM" | "PM" = hours24 >= 12 ? "PM" : "AM";
  const hour = hours24 % 12 || 12;
  return { hour, period };
}

function hour12To24(hour: number, period: "AM" | "PM"): number {
  if (period === "AM") return hour === 12 ? 0 : hour;
  return hour === 12 ? 12 : hour + 12;
}

export function ClockTimeInput({
  value,
  onChange,
  hour12,
  disabled,
  required,
  id,
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  hour12: boolean;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const parsed = parseHm(value);
  const hours24 = parsed?.hours ?? 9;
  const minutes = parsed?.minutes ?? 0;
  const as12 = hour24To12(hours24);

  function emit(nextHours24: number, nextMinutes: number) {
    onChange(formatHm(nextHours24, nextMinutes));
  }

  return (
    <div
      className={`flex min-w-0 items-center gap-1 ${className ?? ""}`}
      role="group"
      aria-label={ariaLabel ?? "Time"}
    >
      {hour12 ? (
        <select
          id={id}
          aria-label="Hour"
          required={required}
          disabled={disabled}
          className={selectClass}
          value={parsed ? String(as12.hour) : ""}
          onChange={(e) => {
            const hour = Number(e.target.value);
            if (!Number.isFinite(hour)) return;
            emit(hour12To24(hour, as12.period), minutes);
          }}
        >
          {!parsed ? <option value="">HH</option> : null}
          {HOURS_12.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
      ) : (
        <select
          id={id}
          aria-label="Hour"
          required={required}
          disabled={disabled}
          className={selectClass}
          value={parsed ? String(hours24) : ""}
          onChange={(e) => {
            const hour = Number(e.target.value);
            if (!Number.isFinite(hour)) return;
            emit(hour, minutes);
          }}
        >
          {!parsed ? <option value="">HH</option> : null}
          {HOURS_24.map((h) => (
            <option key={h} value={h}>
              {String(h).padStart(2, "0")}
            </option>
          ))}
        </select>
      )}
      <span className="text-stone-400" aria-hidden>
        :
      </span>
      <select
        aria-label="Minute"
        required={required}
        disabled={disabled}
        className={selectClass}
        value={parsed ? String(minutes) : ""}
        onChange={(e) => {
          const mins = Number(e.target.value);
          if (!Number.isFinite(mins)) return;
          emit(hours24, mins);
        }}
      >
        {!parsed ? <option value="">MM</option> : null}
        {MINUTES.map((m) => (
          <option key={m} value={m}>
            {String(m).padStart(2, "0")}
          </option>
        ))}
      </select>
      {hour12 ? (
        <select
          aria-label="AM or PM"
          required={required}
          disabled={disabled}
          className={selectClass}
          value={parsed ? as12.period : ""}
          onChange={(e) => {
            const period = e.target.value === "PM" ? "PM" : "AM";
            emit(hour12To24(as12.hour || 12, period), minutes);
          }}
        >
          {!parsed ? <option value="">—</option> : null}
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      ) : null}
    </div>
  );
}

export function ClockDateTimeInput({
  value,
  onChange,
  hour12,
  disabled,
  required,
  id,
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  hour12: boolean;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const { date, time } = splitDateTimeLocal(value);

  function setDate(nextDate: string) {
    if (!nextDate) {
      onChange("");
      return;
    }
    onChange(joinDateTimeLocal(nextDate, time || "09:00"));
  }

  function setTime(nextTime: string) {
    if (!date) {
      onChange("");
      return;
    }
    onChange(joinDateTimeLocal(date, nextTime));
  }

  return (
    <div
      className={`grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] ${className ?? ""}`}
      role="group"
      aria-label={ariaLabel ?? "Date and time"}
    >
      <input
        id={id}
        type="date"
        required={required}
        disabled={disabled}
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className={dateClass}
      />
      <ClockTimeInput
        value={time}
        onChange={setTime}
        hour12={hour12}
        disabled={disabled || !date}
        required={required}
        aria-label={ariaLabel ? `${ariaLabel} time` : "Time"}
      />
    </div>
  );
}
