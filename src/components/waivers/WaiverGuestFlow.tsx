"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import SignaturePad from "@/components/waivers/SignaturePad";
import WaiverDocumentScan from "@/components/waivers/WaiverDocumentScan";
import type { GuestField, GuestFlowSession, GuestSignBody } from "@/components/waivers/guestFlowTypes";
import type { ExtractedGuest } from "@/lib/waivers/extractGuestDocument";
import { guestFlowStructure } from "@/lib/waivers/guestFlowLayout";
import { namesMatch } from "@/lib/waivers/guestCaptureRules";
import { clausePrompt, groupFieldIndexes, sliderBounds, splitClauseLabel } from "@/lib/waivers/presentation";
import { sanitizeWaiverHtml } from "@/lib/waivers/sanitizeHtml";

const GOLD = "#D4AF37";

const FILL_CHOICES = [
  {
    id: "scan" as const,
    title: "Scan ID or document",
    help: "Photo of an ID card or a typed details page — we read either",
  },
  {
    id: "document" as const,
    title: "Scan a printed document",
    help: "Photo of typed details from a phone, computer screen, or printed page",
  },
  {
    id: "manual" as const,
    title: "Fill manually",
    help: "Type your details the usual way",
  },
];

type FillChoice = "manual" | "scan" | "document";

function PhotoFillChoices({
  mode,
  onChange,
  panel,
  eyebrow = "",
  title = "How do you want to complete your details?",
}: {
  mode: FillChoice | null;
  onChange: (mode: FillChoice | null) => void;
  panel?: ReactNode;
  eyebrow?: string;
  title?: string;
}) {
  return (
    <div className="space-y-4">
      {eyebrow ? (
        <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: GOLD }}>
          {eyebrow}
        </p>
      ) : null}
      <h3 className="text-2xl font-bold uppercase leading-tight tracking-tight text-stone-900 sm:text-3xl">
        {title}
      </h3>
      <p className="max-w-2xl text-sm leading-6 text-stone-600">
        Choose one option below. You can scan an ID, scan a typed page, or type everything yourself.
      </p>
      <div className="space-y-3" role="radiogroup" aria-label="How do you want to complete your details?">
        {FILL_CHOICES.map((option) => {
          const selected = mode === option.id;
          return (
            <div
              key={option.id}
              className={`rounded-2xl border text-left transition ${
                selected
                  ? "border-[#D4AF37] bg-[#D4AF37]/10 shadow-sm"
                  : "border-stone-200 bg-white hover:border-stone-300"
              }`}
            >
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                aria-expanded={selected}
                onClick={() => onChange(selected ? null : option.id)}
                className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left"
              >
                <span>
                  <span className="block text-base font-semibold text-stone-900">{option.title}</span>
                  <span className="mt-1 block text-sm leading-5 text-stone-500">{option.help}</span>
                </span>
                <span
                  className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${
                    selected ? "border-[#D4AF37] bg-white text-stone-900" : "border-stone-200 bg-stone-50 text-stone-400"
                  }`}
                  aria-hidden
                >
                  <svg className={`h-4 w-4 transition ${selected ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                      clipRule="evenodd"
                    />
                  </svg>
                </span>
              </button>
              {selected && panel ? <div className="mx-3 mb-3 rounded-xl border border-stone-200 bg-white p-4">{panel}</div> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const DIAL_CODES = [
  { code: "US", dial: "+1", label: "United States (+1)" },
  { code: "CA", dial: "+1", label: "Canada (+1)" },
  { code: "GB", dial: "+44", label: "United Kingdom (+44)" },
  { code: "MX", dial: "+52", label: "Mexico (+52)" },
  { code: "AU", dial: "+61", label: "Australia (+61)" },
  { code: "DE", dial: "+49", label: "Germany (+49)" },
  { code: "FR", dial: "+33", label: "France (+33)" },
  { code: "IN", dial: "+91", label: "India (+91)" },
];

type BlockId = "venue" | "email" | "fill" | "details" | "agreement";

const STEP_LABELS: Record<BlockId, string> = {
  venue: "Your park",
  email: "Email",
  fill: "Photo",
  details: "Your details",
  agreement: "Agreement",
};

type QuestionPage = { title: string; help: string; fields: GuestField[] };

function displayStepName(label: string, isLast: boolean): string {
  const name = label.trim();
  if (!name || name.toLowerCase() === "page break") return isLast ? "Submit" : "";
  return name;
}

/** Each page break is one step. Questions above the first break stay on that first step. */
function pagesFromBreaks(fields: GuestField[]): QuestionPage[] | null {
  const breakCount = fields.filter((field) => field.type === "page_break").length;
  if (!breakCount) return null;
  const pages: QuestionPage[] = [];
  let current: GuestField[] = [];
  let title = "";
  let help = "";
  let breakIndex = -1;
  for (const field of fields) {
    if (field.type === "currency" || field.type === "calculation") continue;
    if (field.type === "page_break") {
      if (breakIndex >= 0) {
        pages.push({ title, help, fields: current });
        current = [];
      }
      breakIndex += 1;
      title = displayStepName(field.label, breakIndex === breakCount - 1);
      help = field.help?.trim() ?? "";
      continue;
    }
    current.push(field);
  }
  if (breakIndex >= 0) pages.push({ title, help, fields: current });
  return pages.length ? pages : null;
}

function StepRail({
  steps,
  current,
  onPick,
}: {
  steps: { key: string; label: string; enabled: boolean }[];
  current: number;
  onPick: (index: number) => void;
}) {
  return (
    <ol className="mb-5 flex gap-1 overflow-x-auto rounded-[2rem] bg-stone-800 px-2 py-3 text-white">
      {steps.map((step, index) => {
        const active = index === current;
        const done = index < current;
        return (
          <li key={step.key} className="min-w-[4.75rem] flex-1">
            <button
              type="button"
              disabled={!step.enabled}
              onClick={() => {
                if (step.enabled) onPick(index);
              }}
              className="flex w-full flex-col items-center gap-1 px-1 py-1 disabled:cursor-default"
            >
              <span
                className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ${
                  active
                    ? "bg-[#D4AF37] text-stone-950 ring-4 ring-[#D4AF37]/35"
                    : done
                      ? "bg-stone-100 text-stone-900"
                      : "bg-stone-600 text-white"
                }`}
              >
                {index + 1}
              </span>
              {step.label ? (
                <span
                  className={`w-full text-center text-[11px] font-semibold uppercase leading-tight tracking-wide ${
                    active ? "text-[#D4AF37]" : "text-stone-100"
                  }`}
                >
                  {step.label}
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function guestPicture(page: QuestionPage): boolean {
  return page.fields.some(
    (field) =>
      field.type === "text" ||
      field.type === "email" ||
      field.type === "phone" ||
      field.type === "date" ||
      field.type === "address" ||
      field.type === "minor_repeater" ||
      (field.type === "section" && field.id !== "typed_name")
  );
}

function effectiveSig(session: GuestFlowSession) {
  return {
    allowTyped:
      session.template.allowTypedSignature ?? session.settings.allowTypedSignature,
    allowDrawn:
      session.template.allowDrawnSignature ?? session.settings.allowDrawnSignature,
  };
}

function clauseFields(fields: GuestField[]) {
  return fields.filter((f) => f.type === "clause");
}

function detailFields(fields: GuestField[]) {
  return fields.filter((f) => f.type !== "clause" && f.section !== "sign");
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map((part) => Number(part));
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

function venueToday(timeZone?: string): { year: number; month: number; day: number } {
  const now = new Date();
  const fallback = { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  const zone = timeZone?.trim();
  if (!zone) return fallback;
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const bag: Record<string, string> = {};
    for (const part of fmt.formatToParts(now)) {
      if (part.type !== "literal") bag[part.type] = part.value;
    }
    const year = Number(bag.year);
    const month = Number(bag.month);
    const day = Number(bag.day);
    if (!year || !month || !day) return fallback;
    return { year, month, day };
  } catch {
    return fallback;
  }
}

function ageInYears(iso: string, timeZone?: string): number | null {
  if (!validIsoDate(iso)) return null;
  const [year, month, day] = iso.split("-").map((part) => Number(part));
  const today = venueToday(timeZone);
  let age = today.year - year;
  if (today.month < month || (today.month === month && today.day < day)) age -= 1;
  return age;
}

function minorNameParts(fullName: string): { first: string; last: string } {
  const splitAt = fullName.indexOf(" ");
  return {
    first: (splitAt < 0 ? fullName : fullName.slice(0, splitAt)).trim(),
    last: splitAt < 0 ? "" : fullName.slice(splitAt + 1).trim(),
  };
}

const SAFETY_CAPTIONS = [
  "No running",
  "No double bouncing",
  "No double flips",
  "No diving",
  "Be aware",
  "Know limits",
  "6 & under zones",
];

type PictureStep = { key: string; label: string; kind: "venue" | "email" | "page" | "agreement"; pageIndex?: number };

function FieldRows({
  fields,
  spanFull,
  renderItem,
}: {
  fields: GuestField[];
  spanFull: boolean;
  renderItem: (field: GuestField) => ReactNode;
}) {
  const groups = groupFieldIndexes(fields);
  return (
    <>
      {groups.map((indexes) => {
        const first = fields[indexes[0]];
        const count = indexes.length;
        const columns =
          count >= 3
            ? "grid grid-cols-1 items-stretch gap-3 sm:grid-cols-3"
            : count === 2
              ? "grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2"
              : "";
        const wide = count > 1 || first?.type === "photo_reader";
        return (
          <div
            key={indexes.map((index) => fields[index]?.id ?? index).join(":")}
            className={[columns, spanFull && wide ? "sm:col-span-2" : ""].filter(Boolean).join(" ")}
          >
            {indexes.map((index) => (
              <div key={fields[index]?.id ?? index} className="min-w-0">
                {renderItem(fields[index])}
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

function layoutClass(layoutId: string, displayMode: string): string {
  const structure = guestFlowStructure(layoutId, displayMode);
  const parts = ["waiver-guest-flow"];
  if (structure.compact) parts.push("text-lg");
  if (structure.checklist) parts.push("waiver-checklist");
  if (structure.cards) parts.push("space-y-3");
  return parts.join(" ");
}

export default function WaiverGuestFlow({
  session,
  mode = "live",
  busy = false,
  error = "",
  onLocaleChange,
  onSubmit,
  onDecline,
  onExtractBackup,
}: {
  session: GuestFlowSession;
  mode?: "live" | "preview";
  busy?: boolean;
  error?: string;
  onLocaleChange?: (locale: string) => void;
  onSubmit?: (body: GuestSignBody) => Promise<void>;
  onDecline?: (body: GuestSignBody) => Promise<void>;
  onExtractBackup?: (jpegDataUrl: string) => Promise<ExtractedGuest | null>;
}) {
  const sig = effectiveSig(session);
  const clauses = clauseFields(session.template.fields);
  const details = detailFields(session.template.fields);
  const hasClauses = clauses.length > 0;
  const structure = guestFlowStructure(session.template.layoutId, session.template.displayMode);
  const displayMode = structure.displayMode;
  const isMulti = structure.oneBlockAtATime;
  const isAccordion = structure.accordion;
  const showFill = session.template.allowDocumentExtract === true && !details.some((field) => field.type === "photo_reader");
  const hasSignatureField =
    session.template.signatureRequired &&
    session.template.fields.some((field) => field.type === "signature");

  const blocks: BlockId[] = useMemo(() => {
    const list: BlockId[] = ["venue"];
    if (showFill) list.push("fill");
    list.push("details", "agreement");
    return list;
  }, [showFill]);
  const questionPages = useMemo(
    () => pagesFromBreaks(session.template.fields),
    [session.template.fields]
  );
  const paged = questionPages != null;
  const stepped = isMulti && !paged;
  const pictureForm = structure.layoutId === "wizard" && paged && questionPages != null;
  const pictureRail: PictureStep[] = useMemo(() => {
    if (!pictureForm || !questionPages) return [];
    const firstReal = session.template.fields.find(
      (field) => field.type !== "currency" && field.type !== "calculation"
    );
    const leading = firstReal != null && firstReal.type !== "page_break";
    const pages = questionPages.map((page, index) => ({
      key: `page-${index}`,
      label: page.title,
      kind: "page" as const,
      pageIndex: index,
    }));
    const park: PictureStep[] = [
      { key: "venue", label: "Location", kind: "venue" },
      { key: "email", label: "Email", kind: "email" },
    ];
    if (leading && pages.length) return [pages[0], ...park, ...pages.slice(1)];
    return [...park, ...pages];
  }, [pictureForm, questionPages, session.template.fields]);

  const [step, setStep] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [railAt, setRailAt] = useState(0);
  useEffect(() => {
    setRailAt((current) => {
      const max = Math.max(pictureRail.length - 1, 0);
      return current > max ? max : current;
    });
  }, [pictureRail.length]);
  useEffect(() => {
    if (!questionPages) return;
    setPageIndex((current) => {
      const last = Math.max(questionPages.length - 1, 0);
      return current > last ? last : current;
    });
  }, [questionPages]);
  const [openSection, setOpenSection] = useState<BlockId>("venue");
  const [venueOk, setVenueOk] = useState(false);
  const [email, setEmail] = useState(session.signingContext.lockedEmail ?? "");
  const [entryMode, setEntryMode] = useState<FillChoice | null>(null);
  const [fillMethod, setFillMethod] = useState<"manual" | "scan" | "document">("manual");
  const [extractedIds, setExtractedIds] = useState<Record<string, boolean>>({});
  const [photoIdentity, setPhotoIdentity] = useState({ first: false, last: false, dob: false });
  const [addressManual, setAddressManual] = useState<Record<string, boolean>>({});
  const [scannedMinors, setScannedMinors] = useState<{ fullName: string; dateOfBirth: string }[]>([]);
  const [filledLabels, setFilledLabels] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [addressAnswers, setAddressAnswers] = useState<
    Record<string, { line1: string; line2: string; city: string; state: string; postal: string }>
  >({});
  const [identity, setIdentity] = useState({
    firstName: "",
    lastName: "",
    dateOfBirth: "",
  });
  const [dialQuery, setDialQuery] = useState("");
  const [phoneDials, setPhoneDials] = useState<Record<string, string>>({});
  const [dateParts, setDateParts] = useState<Record<string, { y: string; m: string; d: string }>>({});
  const [minorMode, setMinorMode] = useState<"solo" | "minors">(
    pictureForm && session.template.fields.some((field) => field.type === "minor_repeater") ? "minors" : "solo"
  );
  const [minors, setMinors] = useState<{ fullName: string; dateOfBirth: string }[]>(
    pictureForm && session.template.fields.some((field) => field.type === "minor_repeater")
      ? [{ fullName: "", dateOfBirth: "" }]
      : []
  );
  const [parkNote, setParkNote] = useState(false);
  const [guardian, setGuardian] = useState({
    fullName: "",
    dateOfBirth: "",
    relationship: "",
    email: "",
    phone: "",
  });
  const [acceptedClauses, setAcceptedClauses] = useState<Record<string, boolean>>({});
  const [intent, setIntent] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [drawnSvg, setDrawnSvg] = useState<string | null>(null);
  const [witness, setWitness] = useState("");
  const [extraAnswers, setExtraAnswers] = useState<Record<string, Record<string, string>>>({});
  const [localError, setLocalError] = useState("");
  const clauseRefs = useRef<Record<string, HTMLLabelElement | null>>({});

  const requiredClauseCount = clauses.filter((c) => c.required).length;
  const checkedAny = clauses.filter((c) => acceptedClauses[c.id]).length;

  function setAnswer(id: string, value: string) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  const hasMappedFirst = details.some((field) => field.mapsTo === "first_name");
  const hasMappedLast = details.some((field) => field.mapsTo === "last_name");
  const hasMappedDob = details.some((field) => field.mapsTo === "dob");

  function adultFromFields(): { firstName: string; lastName: string; fullName: string } {
    let first = identity.firstName;
    let last = identity.lastName;
    for (const field of details) {
      if (field.mapsTo === "first_name") first = answers[field.id] ?? "";
      if (field.mapsTo === "last_name") last = answers[field.id] ?? "";
    }
    if (!first && !last) {
      return { firstName: "", lastName: "", fullName: "" };
    }
    return { firstName: first, lastName: last, fullName: `${first} ${last}`.trim() };
  }

  function extraFormPayload(): Record<string, Record<string, unknown>> {
    const forms: Record<string, Record<string, unknown>> = {};
    for (const form of session.extraForms) {
      const bag: Record<string, unknown> = { ...(extraAnswers[form.templateId] ?? {}) };
      for (const field of form.fields) {
        const slot = `${form.templateId}:${field.id}`;
        if (field.type === "phone") {
          const national = String(bag[field.id] ?? "").replace(/\D/g, "");
          const dial = phoneDials[slot] ?? "+1";
          bag[field.id] = national ? `${dial}${national}` : "";
        }
        if (field.type === "address") {
          const addr = addressAnswers[slot];
          const filled =
            addr &&
            [addr.line1, addr.line2, addr.city, addr.state, addr.postal].some((part) => part.trim());
          if (filled && addr) bag[field.id] = addr;
          else delete bag[field.id];
        }
        if (field.type === "hidden") bag[field.id] = (field.help ?? "").slice(0, 2000);
        if (field.type === "slider" && !String(bag[field.id] ?? "").trim()) {
          bag[field.id] = String(sliderBounds(field.options).min);
        }
      }
      forms[form.templateId] = bag;
    }
    return forms;
  }

  function buildBody(declined = false): GuestSignBody {
    const adult = adultFromFields();
    const dobField = details.find((f) => f.mapsTo === "dob");
    const dob = dobField ? answers[dobField.id] ?? "" : identity.dateOfBirth;
    const emailField = details.find((f) => f.mapsTo === "email");
    const phoneField = details.find((f) => f.mapsTo === "phone");
    const payloadAnswers: Record<string, unknown> = { ...answers };
    for (const field of details) {
      if (field.type !== "phone") continue;
      const national = (answers[field.id] ?? "").replace(/[^\d]/g, "");
      const dial = phoneDials[field.id] ?? "+1";
      payloadAnswers[field.id] = national ? `${dial}${national}` : "";
    }
    for (const field of details) {
      if (field.type === "hidden") payloadAnswers[field.id] = (field.help ?? "").slice(0, 2000);
      if (field.type === "slider" && !String(payloadAnswers[field.id] ?? "").trim()) {
        payloadAnswers[field.id] = String(sliderBounds(field.options).min);
      }
    }
    if (session.signingContext.lockedEmail) {
      for (const field of details) {
        if (field.mapsTo === "email") payloadAnswers[field.id] = session.signingContext.lockedEmail;
      }
    }
    for (const [id, addr] of Object.entries(addressAnswers)) {
      if (id.includes(":")) continue;
      const filled = [addr.line1, addr.line2, addr.city, addr.state, addr.postal].some((part) =>
        part.trim()
      );
      if (filled) payloadAnswers[id] = addr;
    }
    const personEmail =
      session.signingContext.lockedEmail ||
      (emailField ? String(payloadAnswers[emailField.id] ?? "") : "") ||
      email;
    const personPhone = phoneField ? String(payloadAnswers[phoneField.id] ?? "") : "";
    const people: Record<string, unknown>[] = [];
    const completeMinors = minors.filter((row) => row.fullName.trim() && row.dateOfBirth);
    const coveredMinors = (declined ? completeMinors : minors).filter((row) => {
      if (!declined) return true;
      const age = ageInYears(row.dateOfBirth, session.timeZone);
      return age != null && age >= 0 && age < session.settings.ageOfMajorityYears;
    });
    const guardianSession = minorMode === "minors" && coveredMinors.length > 0;
    const guardianName = adult.fullName || guardian.fullName;
    const guardianDob = dobField ? dob : guardian.dateOfBirth;
    if (guardianSession) {
      for (const m of coveredMinors) {
        people.push({
          fullName: m.fullName,
          dateOfBirth: m.dateOfBirth,
        });
      }
    } else {
      people.push({
        fullName: adult.fullName,
        firstName: adult.firstName,
        lastName: adult.lastName,
        dateOfBirth: dob,
        email: personEmail,
        phone: personPhone,
        adultConfirmed: true,
      });
    }
    return {
      locale: session.locale,
      templateVersionId: session.template.versionId,
      contentSha256: session.template.contentSha256,
      declined,
      people,
      guardian: guardianSession
        ? {
            fullName: guardianName,
            firstName: adult.firstName,
            lastName: adult.lastName,
            dateOfBirth: guardianDob,
            relationship: pictureForm ? guardian.relationship || "Guardian" : guardian.relationship,
            email: personEmail || guardian.email,
            phone: personPhone,
          }
        : undefined,
      answers: payloadAnswers,
      forms: extraFormPayload(),
      acceptedClauses,
      intentAccepted: requiredClauseCount === 0 ? intent : undefined,
      typedName: sig.allowTyped ? typedName : undefined,
      drawnSignatureSvg: sig.allowDrawn && drawnSvg ? drawnSvg : undefined,
      witnessName: witness || undefined,
      fillMethod,
    };
  }

  function nationalPhone(storageId: string, raw: string): string {
    const compact = raw.replace(/[^\d+]/g, "");
    if (compact.startsWith("+")) {
      const known = [...new Set(DIAL_CODES.map((row) => row.dial))]
        .filter((dial) => compact.startsWith(dial))
        .sort((a, b) => b.length - a.length)[0];
      const dial = known || (compact.startsWith("+1") ? "+1" : compact.match(/^\+\d{1,3}/)?.[0] || "+1");
      setPhoneDials((prev) => ({ ...prev, [storageId]: dial }));
      return compact.slice(dial.length);
    }
    return compact.replace(/\D/g, "");
  }

  function applyExtract(parsed: ExtractedGuest, method: "scan" | "document") {
    setFillMethod(method);
    setFilledLabels(parsed.labels);
    setLocalError("");
    const nextExtracted: Record<string, boolean> = {};
    const nextAnswers = { ...answers };
    const nextExtra: Record<string, Record<string, string>> = { ...extraAnswers };
    if (!hasMappedFirst && parsed.firstName) setIdentity((prev) => ({ ...prev, firstName: parsed.firstName }));
    if (!hasMappedLast && parsed.lastName) setIdentity((prev) => ({ ...prev, lastName: parsed.lastName }));
    if (!hasMappedDob && parsed.dateOfBirth) setIdentity((prev) => ({ ...prev, dateOfBirth: parsed.dateOfBirth }));
    if (parsed.email && !session.signingContext.lockedEmail) setEmail(parsed.email);
    const legal = `${parsed.firstName} ${parsed.lastName}`.trim();
    if (parsed.firstName && parsed.lastName) setTypedName(legal);
    else if (legal) setTypedName((prev) => (prev.trim() ? prev : legal));

    const writeField = (field: GuestField, storageId: string, bag: Record<string, string>) => {
      const slot = field.mapsTo || "";
      if (field.type === "clause" || field.type === "minor_repeater" || field.type === "photo_reader" || field.type === "signature" || field.type === "page_break") return;
      if (field.type === "address") {
        if (!(parsed.address || parsed.city || parsed.state || parsed.postal)) return;
        setAddressAnswers((prev) => ({
          ...prev,
          [storageId]: {
            line1: parsed.address,
            line2: "",
            city: parsed.city,
            state: parsed.state,
            postal: parsed.postal,
          },
        }));
        setAddressManual((prev) => ({ ...prev, [storageId]: true }));
        nextExtracted[storageId] = true;
        return;
      }
      let value = "";
      if (field.type === "phone" && (slot === "phone" || slot === "emergency_phone")) {
        const source = slot === "emergency_phone" ? parsed.emergencyPhone : parsed.phone;
        if (!source) return;
        value = nationalPhone(storageId, source);
      } else if (slot === "first_name") value = parsed.firstName;
      else if (slot === "last_name") value = parsed.lastName;
      else if (slot === "dob") value = parsed.dateOfBirth;
      else if (slot === "phone") value = parsed.phone;
      else if (slot === "email" && !session.signingContext.lockedEmail) value = parsed.email;
      else if (slot === "emergency_name") value = parsed.emergencyName;
      else if (slot === "emergency_phone") value = parsed.emergencyPhone;
      else if (slot === "city") value = parsed.city;
      else if (slot === "state") value = parsed.state;
      else if (slot === "postal_code") value = parsed.postal;
      else if (slot === "address") {
        value = [parsed.address, parsed.city, parsed.state, parsed.postal].filter(Boolean).join(", ");
      }
      if (!value) return;
      bag[field.id] = value;
      nextExtracted[storageId] = true;
    };

    for (const field of details) writeField(field, field.id, nextAnswers);
    for (const form of session.extraForms) {
      const bag = { ...(nextExtra[form.templateId] ?? {}) };
      for (const field of form.fields) writeField(field, `${form.templateId}:${field.id}`, bag);
      nextExtra[form.templateId] = bag;
    }
    setAnswers(nextAnswers);
    setExtraAnswers(nextExtra);
    setExtractedIds(nextExtracted);
    setPhotoIdentity({
      first: !hasMappedFirst && Boolean(parsed.firstName),
      last: !hasMappedLast && Boolean(parsed.lastName),
      dob: !hasMappedDob && Boolean(parsed.dateOfBirth),
    });
    const remembered = parsed.minors
      .filter((row) => row.firstName || row.lastName)
      .map((row) => ({
        fullName: `${row.firstName} ${row.lastName}`.trim(),
        dateOfBirth: row.dateOfBirth,
      }));
    setScannedMinors(remembered);
    const hasMinorField = details.some((field) => field.type === "minor_repeater");
    if (remembered.length && hasMinorField) {
      setMinorMode("minors");
      setMinors(remembered);
      setGuardian((prev) => ({
        ...prev,
        fullName: parsed.firstName && parsed.lastName ? legal : prev.fullName.trim() || legal,
        dateOfBirth: prev.dateOfBirth || parsed.dateOfBirth,
        email: prev.email.trim() ? prev.email : parsed.email,
        phone: prev.phone.trim() ? prev.phone : parsed.phone,
      }));
    } else if (minorMode === "minors") {
      setMinors(remembered);
    }
  }

  function isAnswerGap(field: GuestField, value: string): boolean {
    const text = value.trim();
    if (field.type === "number") {
      if (!text) return field.required;
      return !Number.isFinite(Number(text));
    }
    if (field.type === "time") {
      if (!text) return field.required;
      return !/^(\d{2}:\d{2})(?::\d{2})?$/.test(text);
    }
    if (field.type === "website") {
      if (!text) return field.required;
      return /\s/.test(text);
    }
    if (field.type === "rating") {
      if (!text) return field.required;
      const max = Math.min(10, Math.max(1, Number(field.options[0]) || 5));
      const score = Number(text);
      return !Number.isInteger(score) || score < 1 || score > max;
    }
    if (
      !field.required ||
      field.type === "clause" ||
      field.type === "minor_repeater" ||
      field.type === "photo_reader" ||
      field.type === "signature" ||
      field.type === "page_break" ||
      field.type === "section" ||
      field.type === "html" ||
      field.type === "hidden" ||
      field.type === "calculation" ||
      field.type === "currency" ||
      field.type === "slider"
    ) {
      return false;
    }
    return !text;
  }

  function finishGaps(): { id: string; label: string }[] {
    return details
      .filter((field) => {
        if (field.type === "address") {
          if (!field.required) return false;
          const addr = addressAnswers[field.id];
          const parts = [addr?.line1, addr?.city, addr?.state, addr?.postal].map((part) => part?.trim() ?? "");
          if (pictureForm) return parts.some((part) => !part);
          return !parts.some(Boolean);
        }
        if (field.mapsTo === "first_name" && !hasMappedFirst) return field.required && !identity.firstName.trim();
        return isAnswerGap(field, answers[field.id] ?? "");
      })
      .map((field) => ({ id: field.id, label: field.label }));
  }

  function extraGaps(): { id: string; label: string; domId: string }[] {
    const gaps: { id: string; label: string; domId: string }[] = [];
    for (const form of session.extraForms) {
      const bag = extraAnswers[form.templateId] ?? {};
      for (const field of form.fields) {
        const domId = `guest-field-${form.templateId}-${field.id}`;
        if (field.type === "address") {
          if (!field.required) continue;
          const addr = addressAnswers[`${form.templateId}:${field.id}`];
          if (!addr || ![addr.line1, addr.city, addr.state, addr.postal].some((part) => part.trim())) {
            gaps.push({ id: field.id, label: field.label, domId });
          }
          continue;
        }
        if (isAnswerGap(field, bag[field.id] ?? "")) gaps.push({ id: field.id, label: field.label, domId });
      }
    }
    return gaps;
  }

  function validateAgreement(): boolean {
    for (const clause of clauses) {
      if (clause.required && !acceptedClauses[clause.id]) {
        setLocalError(`Accept "${clausePrompt(clause.label)}" to continue`);
        jumpToGap(clause.id);
        window.setTimeout(() => {
          clauseRefs.current[clause.id]?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 50);
        return false;
      }
    }
    if (session.template.signatureRequired && requiredClauseCount === 0 && session.settings.requireIntentCheckbox && !intent) {
      setLocalError("Confirm that you intend to sign this agreement");
      if (pictureForm && pictureRail.length) setRailAt(pictureRail.length - 1);
      return false;
    }
    const signatureFields = hasSignatureField
      ? session.template.fields.filter((field) => field.type === "signature")
      : [];
    const mustSign = !session.template.signatureRequired
      ? false
      : signatureFields.length
        ? signatureFields.some((field) => field.required)
        : sig.allowTyped || sig.allowDrawn;
    if (mustSign && sig.allowTyped && !typedName.trim()) {
      setLocalError("Type your legal name");
      jumpToGap(session.template.fields.some((field) => field.id === "typed_name") ? "typed_name" : signatureFields[0]?.id ?? "");
      return false;
    }
    const adult = adultFromFields();
    if (
      mustSign &&
      sig.allowTyped &&
      typedName.trim() &&
      adult.firstName &&
      adult.lastName &&
      !namesMatch(typedName, adult.firstName, adult.lastName)
    ) {
      setLocalError("Typed name must match the adult first and last name");
      jumpToGap(session.template.fields.some((field) => field.id === "typed_name") ? "typed_name" : signatureFields[0]?.id ?? "");
      return false;
    }
    if (mustSign && sig.allowDrawn && !drawnSvg) {
      setLocalError("Draw your signature");
      jumpToGap(signatureFields[0]?.id ?? "");
      return false;
    }
    return true;
  }

  async function handleSubmit(e: FormEvent, declined = false) {
    e.preventDefault();
    if (mode === "preview") return;
    setLocalError("");
    if (!declined && pictureForm) {
      const value = (session.signingContext.lockedEmail ?? email).trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        setLocalError("Enter an email address to continue");
        const emailAt = pictureRail.findIndex((step) => step.kind === "email");
        if (emailAt >= 0) setRailAt(emailAt);
        return;
      }
    }
    if (!declined && !validateAgreement()) return;
    if (
      !declined &&
      stepped &&
      (session.signingContext.bookingLabel || session.signingContext.productLabel) &&
      !venueOk
    ) {
      setLocalError('Confirm "Yes, this is my park" to continue');
      return;
    }
    if (!declined) {
      const minorProblem = pictureMinorProblem();
      if (minorProblem) {
        setLocalError(minorProblem);
        const minorField = session.template.fields.find((field) => field.type === "minor_repeater");
        if (minorField) jumpToGap(minorField.id);
        return;
      }
    }
    if (!declined && pictureForm) {
      const dobField = details.find((field) => field.mapsTo === "dob");
      const dob = dobField ? (answers[dobField.id] ?? "") : identity.dateOfBirth;
      const ageProblem = signerAgeProblem(dob);
      if (ageProblem) {
        setLocalError(ageProblem);
        if (dobField) jumpToGap(dobField.id);
        return;
      }
    }
    if (!declined) {
      const gaps = finishGaps();
      if (gaps.length) {
        setLocalError(`Finish "${gaps[0].label}" before you sign`);
        jumpToGap(gaps[0].id);
        return;
      }
      const extra = extraGaps();
      if (extra.length) {
        setLocalError(`Finish "${extra[0].label}" before you sign`);
        if (pictureForm && pictureRail.length) setRailAt(pictureRail.length - 1);
        else if (paged && questionPages) setPageIndex(Math.max(questionPages.length - 1, 0));
        else if (stepped) {
          const index = blocks.indexOf("agreement");
          if (index >= 0) setStep(index);
        }
        window.setTimeout(() => {
          document.getElementById(extra[0].domId)?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 50);
        return;
      }
    }
    const body = buildBody(declined);
    if (declined && onDecline) await onDecline(body);
    else if (onSubmit) await onSubmit(body);
  }

  function nextStep() {
    const id = blocks[step];
    if (id === "venue" && stepped && (session.signingContext.bookingLabel || session.signingContext.productLabel) && !venueOk) {
      setLocalError('Confirm "Yes, this is my park" to continue');
      return;
    }
    setLocalError("");
    setStep((s) => Math.min(s + 1, blocks.length - 1));
  }

  function prevStep() {
    setLocalError("");
    setStep((s) => Math.max(0, s - 1));
  }

  function stepMove(className = "") {
    return (
      <div className={`flex flex-wrap gap-2 ${className}`}>
        {step > 0 ? (
          <button type="button" className="rounded border border-stone-300 px-4 py-2" onClick={prevStep}>
            Back
          </button>
        ) : null}
        <button type="button" className="rounded px-4 py-2 text-white" style={{ background: GOLD }} onClick={nextStep}>
          Continue
        </button>
      </div>
    );
  }

  function jumpToGap(id: string) {
    if (!id) return;
    if (pictureForm && questionPages) {
      const index = questionPages.findIndex((page) => page.fields.some((field) => field.id === id));
      const railIndex = pictureRail.findIndex((step) => step.kind === "page" && step.pageIndex === index);
      if (railIndex >= 0) setRailAt(railIndex);
    } else if (paged && questionPages) {
      const index = questionPages.findIndex((page) => page.fields.some((field) => field.id === id));
      if (index >= 0) setPageIndex(index);
    } else if (stepped) {
      const index = blocks.indexOf("details");
      if (index >= 0) setStep(index);
    }
    if (isAccordion) setOpenSection("details");
    window.setTimeout(() => {
      document.getElementById(`guest-field-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  }

  const railStep = pictureRail[Math.min(railAt, Math.max(pictureRail.length - 1, 0))];
  const visitLabel = session.signingContext.productLabel || session.signingContext.bookingLabel || "This visit";

  function goRail(next: number) {
    setLocalError("");
    setRailAt(Math.max(0, Math.min(next, pictureRail.length - 1)));
  }

  function pictureMinorProblem(): string | null {
    if (!session.template.fields.some((field) => field.type === "minor_repeater")) return null;
    if (minorMode !== "minors") return null;
    if (!minors.length) return "Add at least one minor, or choose Just me";
    if (minors.length > 1 && !session.settings.allowGroupSigning) return "Group signing is turned off";
    if (minors.length > session.settings.maxMinorsPerGuardianSession) {
      return `A guardian can cover up to ${session.settings.maxMinorsPerGuardianSession} minors in one session`;
    }
    const incomplete = minors.some((row) => {
      const names = minorNameParts(row.fullName);
      return !names.first || !names.last || !validIsoDate(row.dateOfBirth);
    });
    if (incomplete) return "Add each minor's first and last name and date of birth, or choose Just me";
    const majority = session.settings.ageOfMajorityYears;
    for (const row of minors) {
      const age = ageInYears(row.dateOfBirth, session.timeZone);
      if (age == null || age < 0) return "Date of birth cannot be in the future";
      if (age >= majority) return "Adults sign separately from a guardian session";
    }
    return null;
  }

  function signerAgeProblem(dob: string): string | null {
    const age = ageInYears(dob, session.timeZone);
    if (age == null) return null;
    if (age < 0) return "Date of birth cannot be in the future";
    if (age < session.settings.ageOfMajorityYears) return "The signer must be an adult";
    return null;
  }

  function pictureBack() {
    goRail(railAt - 1);
  }

  function questionPageProblem(pageFields: GuestField[]): { message: string; focusId?: string } | null {
    const gaps = finishGaps().filter((gap) => pageFields.some((field) => field.id === gap.id));
    if (gaps.length) return { message: `Finish "${gaps[0].label}" to continue`, focusId: gaps[0].id };
    if (pageFields.some((field) => field.type === "minor_repeater")) {
      const minorProblem = pictureMinorProblem();
      if (minorProblem) return { message: minorProblem };
    }
    if (pageFields.some((field) => field.mapsTo === "dob")) {
      const dobField = pageFields.find((field) => field.mapsTo === "dob");
      const dob = dobField ? (answers[dobField.id] ?? "") : "";
      const ageProblem = signerAgeProblem(dob);
      if (ageProblem) return { message: ageProblem, focusId: dobField?.id };
    }
    const missed = pageFields.find((field) => field.type === "clause" && field.required && !acceptedClauses[field.id]);
    if (missed) return { message: `Accept "${clausePrompt(missed.label)}" to continue`, focusId: missed.id };
    const signatureField = pageFields.find((field) => field.type === "signature");
    const mustSign = Boolean(signatureField && signatureField.required && session.template.signatureRequired);
    if (mustSign && sig.allowDrawn && !drawnSvg) return { message: "Draw your signature", focusId: signatureField?.id };
    const typedOnItsOwnStep = session.template.fields.some((field) => field.id === "typed_name");
    const typedOnThisPage =
      pageFields.some((field) => field.id === "typed_name") ||
      (Boolean(signatureField) && !typedOnItsOwnStep);
    const typedRequired = pageFields.some((field) => field.id === "typed_name") ? sig.allowTyped : mustSign && sig.allowTyped;
    if (typedOnThisPage && typedRequired && !typedName.trim()) {
      return { message: "Type your legal name", focusId: typedOnItsOwnStep ? "typed_name" : signatureField?.id };
    }
    if (typedOnThisPage && sig.allowTyped && typedName.trim()) {
      const adult = adultFromFields();
      if (adult.firstName && adult.lastName && !namesMatch(typedName, adult.firstName, adult.lastName)) {
        return { message: "Typed name must match the adult first and last name", focusId: typedOnItsOwnStep ? "typed_name" : signatureField?.id };
      }
    }
    return null;
  }

  function pictureNext() {
    const current = pictureRail[Math.min(railAt, Math.max(pictureRail.length - 1, 0))];
    if (mode !== "preview" && current?.kind === "venue" && !venueOk) {
      setLocalError('Confirm "Yes, this is my park" to continue');
      return;
    }
    if (mode !== "preview" && current?.kind === "email") {
      const value = (session.signingContext.lockedEmail ?? email).trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        setLocalError("Enter an email address to continue");
        return;
      }
    }
    if (mode !== "preview" && current?.kind === "page" && questionPages) {
      const pageFields = questionPages[current.pageIndex ?? 0]?.fields ?? [];
      const problem = questionPageProblem(pageFields);
      if (problem) {
        setLocalError(problem.message);
        if (problem.focusId) {
          document.getElementById(`guest-field-${problem.focusId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        return;
      }
    }
    goRail(railAt + 1);
  }

  function visible(id: BlockId) {
    if (pictureForm && railStep) {
      if (id === "venue") return railStep.kind === "venue";
      if (id === "email") return railStep.kind === "email";
      if (id === "fill") return false;
      if (id === "details") return railStep.kind === "page";
      return railStep.kind === "agreement";
    }
    if (mode === "preview" && !paged && !pictureForm) return id !== "email";
    if (paged && questionPages) {
      const onLast = pageIndex >= Math.max(questionPages.length - 1, 0) && pageIndex < questionPages.length;
      if (id === "email") return false;
      if (id === "venue" || id === "fill") return pageIndex === 0;
      if (id === "details") return pageIndex < questionPages.length;
      return onLast;
    }
    if (stepped) return blocks[step] === id;
    if (isAccordion) return openSection === id;
    return true;
  }

  const shownPage =
    pictureForm && railStep?.kind === "page" ? (railStep.pageIndex ?? 0) : pageIndex;
  const shownFields =
    paged && questionPages && shownPage < questionPages.length ? questionPages[shownPage].fields : [];
  const signatureInQuestions = Boolean(
    paged && questionPages?.some((page) => page.fields.some((field) => field.type === "signature"))
  );
  const clausesInQuestions = Boolean(
    paged && questionPages?.some((page) => page.fields.some((field) => field.type === "clause"))
  );
  const firstLegalId =
    !pictureForm && questionPages
      ? questionPages
          .flatMap((page) => page.fields)
          .find((field) => field.type === "clause" || field.type === "signature")?.id
      : undefined;
  const guestStep = pictureForm && questionPages && shownPage < questionPages.length ? guestPicture(questionPages[shownPage]) : false;
  const lastPicture =
    pictureForm && railStep?.kind === "page" && questionPages != null && (railStep.pageIndex ?? 0) >= questionPages.length - 1;
  const safetyStep = pictureForm && shownFields.some((field) => field.id === "safety_rules");
  const guestAddress =
    pictureForm &&
    shownFields.some((field) => field.id === "guest_heading") &&
    !shownFields.some((field) => field.type === "address")
      ? session.template.fields.find((field) => field.type === "address")
      : undefined;
  const clausePageIndex =
    questionPages?.findIndex((page) => page.fields.some((field) => field.type === "clause")) ?? -1;
  const showPictureAgreement =
    pictureForm && (clausePageIndex >= 0 ? shownPage === clausePageIndex : lastPicture);
  const gridDetails = structure.gridFields;
  const agreementFirst = structure.agreementBeforeIdentity;
  const sectionChrome = structure.cards ? "rounded-lg border border-stone-200 p-4 shadow-sm" : "";
  const chooserOnThisPage =
    paged && questionPages && shownPage < questionPages.length
      ? questionPages[shownPage].fields.some((field) => field.type === "photo_reader")
      : details.some((field) => field.type === "photo_reader");
  const questionsOpen =
    mode === "preview" ||
    entryMode === "manual" ||
    chooserOnThisPage ||
    !(showFill && visible("fill"));

  function scanPanel(kind: "scan" | "document") {
    return (
      <div className="space-y-3">
        <WaiverDocumentScan
          key={kind}
          kind={kind}
          minorCap={session.settings.maxMinorsPerGuardianSession}
          onExtractBackup={onExtractBackup}
          onFailed={(message) => setLocalError(message)}
          onResult={(parsed) => applyExtract(parsed, kind)}
        />
        {filledLabels.length ? (
          <p className="text-sm text-stone-600">Filled from the photo: {filledLabels.join(", ")}</p>
        ) : null}
      </div>
    );
  }

  function renderField(field: GuestField, scope = "main") {
    const storageId = scope === "main" ? field.id : `${scope}:${field.id}`;
    const current =
      scope === "main" ? answers[field.id] ?? "" : extraAnswers[scope]?.[field.id] ?? "";
    const writeValue = (value: string) => {
      if (scope === "main") {
        setAnswer(field.id, value);
        return;
      }
      setExtraAnswers((prev) => ({
        ...prev,
        [scope]: { ...(prev[scope] ?? {}), [field.id]: value },
      }));
    };
    if (field.type === "page_break" || field.type === "currency" || field.type === "calculation") return null;
    if (field.type === "photo_reader") {
      const page = questionPages?.find((item) => item.fields.some((row) => row.id === field.id));
      const namedStep = page?.title && page.title !== "Your details" && !/^Step \d+$/.test(page.title);
      return (
        <div key={field.id} className="space-y-4 sm:col-span-2">
          <PhotoFillChoices
            mode={entryMode}
            onChange={setEntryMode}
            eyebrow={page?.help?.trim() || ""}
            title={namedStep ? page.title : field.label.trim() || "Photo reader"}
            panel={entryMode === "scan" || entryMode === "document" ? scanPanel(entryMode) : null}
          />
        </div>
      );
    }
    if (field.type === "clause") {
      const gap = Boolean(localError) && field.required && !acceptedClauses[field.id];
      const checked = acceptedClauses[field.id] === true;
      const copy = splitClauseLabel(field.label);
      return (
        <label
          key={field.id}
          ref={(el) => {
            clauseRefs.current[field.id] = el;
          }}
          className={`flex items-start gap-3 rounded-2xl border p-4 text-sm leading-relaxed text-stone-800 sm:col-span-2 ${
            gap
              ? "border-amber-500 bg-amber-50"
              : checked
                ? "border-[#D4AF37]/70 bg-[#D4AF37]/10"
                : "border-stone-200 bg-stone-50"
          }`}
        >
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 shrink-0 accent-[#D4AF37]"
            checked={checked}
            onChange={(e) => setAcceptedClauses((prev) => ({ ...prev, [field.id]: e.target.checked }))}
          />
          <span>
            {copy.title ? <strong className="font-semibold text-stone-950">{copy.title}: </strong> : null}
            {copy.body}
          </span>
        </label>
      );
    }
    if (field.type === "signature") {
      const typedOnItsOwnStep =
        pictureForm && session.template.fields.some((item) => item.id === "typed_name");
      const typed = sig.allowTyped && !typedOnItsOwnStep ? (
        <label className="block text-sm">
          <span className={pictureForm ? "text-xs font-semibold uppercase tracking-[0.14em] text-stone-500" : ""}>
            {pictureForm ? "Type your full legal name to confirm" : "Typed legal name"}
            {pictureForm ? "*" : ""}
          </span>
          <input className="mt-1 w-full rounded-2xl border border-stone-300 bg-white px-3 py-3" value={typedName} onChange={(e) => setTypedName(e.target.value)} />
        </label>
      ) : null;
      const drawn = sig.allowDrawn ? <SignaturePad disabled={busy} onChange={setDrawnSvg} /> : null;
      return (
        <div key={field.id} className={`space-y-3 sm:col-span-2 ${pictureForm ? "rounded-3xl border border-stone-200 bg-stone-50 p-4" : "rounded border border-stone-200 p-3"}`}>
          <p className={pictureForm ? "text-xs font-semibold uppercase tracking-[0.14em] text-stone-500" : "text-sm font-medium"}>
            {field.label}
            {pictureForm ? "*" : ""}
          </p>
          {field.help ? <p className="text-sm leading-6 text-stone-600">{field.help}</p> : null}
          {pictureForm ? (
            <>
              {drawn}
              {typed}
            </>
          ) : (
            <>
              {typed}
              {drawn}
            </>
          )}
        </div>
      );
    }
    if (field.type === "minor_repeater" && pictureForm) {
      if (minorMode !== "minors") return null;
      return (
        <div key={field.id} className="space-y-3 sm:col-span-2">
          {minors.map((minor, index) => {
            const splitAt = minor.fullName.indexOf(" ");
            const first = splitAt < 0 ? minor.fullName : minor.fullName.slice(0, splitAt);
            const last = splitAt < 0 ? "" : minor.fullName.slice(splitAt + 1);
            const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(minor.dateOfBirth);
            const year = iso?.[1] ?? "";
            const month = iso?.[2] ?? "";
            const day = iso?.[3] ?? "";
            const writeName = (nextFirst: string, nextLast: string) => {
              setMinors((rows) =>
                rows.map((row, rowIndex) =>
                  rowIndex === index ? { ...row, fullName: `${nextFirst} ${nextLast}`.trim() } : row
                )
              );
            };
            const writeDob = (next: { y: string; m: string; d: string }) => {
              const iso = `${next.y}-${next.m}-${next.d}`;
              const date =
                /^\d{4}$/.test(next.y) && /^\d{2}$/.test(next.m) && /^\d{2}$/.test(next.d) && validIsoDate(iso)
                  ? iso
                  : "";
              setMinors((rows) =>
                rows.map((row, rowIndex) => (rowIndex === index ? { ...row, dateOfBirth: date } : row))
              );
            };
            return (
              <div key={index} className="rounded-3xl border border-stone-200 bg-stone-50 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8a7030]">Minor {index + 1}</p>
                  <button
                    type="button"
                    className="text-sm font-semibold text-stone-700"
                    onClick={() => setMinors((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}
                  >
                    × Remove
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <input className="rounded-2xl border border-stone-200 bg-white px-3 py-3" placeholder="First name*" value={first} onChange={(e) => writeName(e.target.value, last)} />
                  <input className="rounded-2xl border border-stone-200 bg-white px-3 py-3" placeholder="Last name*" value={last} onChange={(e) => writeName(first, e.target.value)} />
                </div>
                <p className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Date of birth</p>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <select className="rounded-2xl border border-stone-200 bg-white px-3 py-3" value={month} onChange={(e) => writeDob({ y: year, m: e.target.value, d: day })}>
                    <option value="">Month*</option>
                    {MONTH_NAMES.map((name, monthIndex) => (
                      <option key={name} value={String(monthIndex + 1).padStart(2, "0")}>{name}</option>
                    ))}
                  </select>
                  <select className="rounded-2xl border border-stone-200 bg-white px-3 py-3" value={day} onChange={(e) => writeDob({ y: year, m: month, d: e.target.value })}>
                    <option value="">Day*</option>
                    {Array.from({ length: 31 }, (_, dayIndex) => String(dayIndex + 1).padStart(2, "0")).map((value) => (
                      <option key={value} value={value}>{Number(value)}</option>
                    ))}
                  </select>
                  <select className="rounded-2xl border border-stone-200 bg-white px-3 py-3" value={year} onChange={(e) => writeDob({ y: e.target.value, m: month, d: day })}>
                    <option value="">Year*</option>
                    {Array.from({ length: Math.max(1, session.settings.ageOfMajorityYears) + 1 }, (_, yearIndex) => String(venueToday(session.timeZone).year - yearIndex)).map((value) => (
                      <option key={value} value={value}>{value}</option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
          {minors.length < session.settings.maxMinorsPerGuardianSession &&
          (session.settings.allowGroupSigning || minors.length < 1) ? (
            <button
              type="button"
              className="w-full rounded-full border border-stone-200 bg-white px-4 py-3 text-sm font-semibold text-stone-900"
              onClick={() => setMinors((rows) => [...rows, { fullName: "", dateOfBirth: "" }])}
            >
              + Add a minor
            </button>
          ) : null}
        </div>
      );
    }
    if (field.type === "minor_repeater") {
      return (
        <div key={field.id} className="space-y-2 rounded border border-stone-200 p-3">
          <p className="text-sm font-medium">{field.label}</p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={minorMode === "solo"}
              onChange={() => {
                setMinorMode("solo");
                setMinors([]);
              }}
            />
            Just me
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={minorMode === "minors"}
              onChange={() => {
                setMinorMode("minors");
                setMinors(scannedMinors);
              }}
            />
            Me and minor(s)
          </label>
          {minorMode === "minors" ? (
            <div className="space-y-2">
              {minors.map((m, i) => (
                <div key={i} className="flex flex-col gap-1 sm:flex-row">
                  <input
                    className="flex-1 rounded border border-stone-300 px-2 py-2"
                    placeholder="Minor full name"
                    value={m.fullName}
                    onChange={(e) =>
                      setMinors((rows) =>
                        rows.map((row, j) => (j === i ? { ...row, fullName: e.target.value } : row))
                      )
                    }
                  />
                  <input
                    type="date"
                    className="rounded border border-stone-300 px-2 py-2"
                    value={m.dateOfBirth}
                    onChange={(e) =>
                      setMinors((rows) =>
                        rows.map((row, j) => (j === i ? { ...row, dateOfBirth: e.target.value } : row))
                      )
                    }
                  />
                </div>
              ))}
              {minors.length < session.settings.maxMinorsPerGuardianSession &&
              (session.settings.allowGroupSigning || minors.length < 1) ? (
                <button
                  type="button"
                  className="text-sm underline"
                  onClick={() => setMinors((rows) => [...rows, { fullName: "", dateOfBirth: "" }])}
                >
                  Add minor
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      );
    }
    if (field.type === "address") {
      const addr = addressAnswers[storageId] ?? {
        line1: "",
        line2: "",
        city: "",
        state: "",
        postal: "",
      };
      const setAddr = (patch: Partial<typeof addr>) =>
        setAddressAnswers((prev) => ({
          ...prev,
          [storageId]: { ...addr, ...patch },
        }));
      if (pictureForm) {
        return (
          <fieldset key={field.id} className="space-y-3 sm:col-span-2">
            <input className="w-full rounded-2xl border border-stone-200 bg-stone-50 px-3 py-3" placeholder={field.required ? "Street*" : "Street"} value={addr.line1} onChange={(e) => setAddr({ line1: e.target.value })} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-3" placeholder={field.required ? "City*" : "City"} value={addr.city} onChange={(e) => setAddr({ city: e.target.value })} />
              <input className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-3" placeholder={field.required ? "State*" : "State"} value={addr.state} onChange={(e) => setAddr({ state: e.target.value })} />
            </div>
            <input className="w-full rounded-2xl border border-stone-200 bg-stone-50 px-3 py-3" placeholder={field.required ? "Postal code*" : "Postal code"} value={addr.postal} onChange={(e) => setAddr({ postal: e.target.value })} />
            {field.help ? <p className="text-sm text-stone-600">{field.help}</p> : null}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-[#D4AF37]"
                checked={addressManual[storageId] !== false}
                onChange={(e) => setAddressManual((prev) => ({ ...prev, [storageId]: e.target.checked }))}
              />
              Enter address manually
            </label>
          </fieldset>
        );
      }
      return (
        <fieldset key={field.id} className="space-y-2 rounded border border-stone-200 p-3">
          <legend className="text-sm font-medium">{field.label}</legend>
          <input className="w-full rounded border px-2 py-2" placeholder="Street" value={addr.line1} onChange={(e) => setAddr({ line1: e.target.value })} />
          <input className="w-full rounded border px-2 py-2" placeholder="Apt / suite" value={addr.line2} onChange={(e) => setAddr({ line2: e.target.value })} />
          <div className="grid gap-2 sm:grid-cols-3">
            <input className="rounded border px-2 py-2" placeholder="City" value={addr.city} onChange={(e) => setAddr({ city: e.target.value })} />
            <input className="rounded border px-2 py-2" placeholder="State" value={addr.state} onChange={(e) => setAddr({ state: e.target.value })} />
            <input className="rounded border px-2 py-2" placeholder="Postal" value={addr.postal} onChange={(e) => setAddr({ postal: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={addressManual[storageId] === true}
              onChange={(e) => setAddressManual((prev) => ({ ...prev, [storageId]: e.target.checked }))}
            />
            Enter address manually
          </label>
        </fieldset>
      );
    }
    if (field.type === "date") {
      const stored = current;
      const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(stored);
      const parts = iso
        ? { y: iso[1], m: iso[2], d: iso[3] }
        : dateParts[storageId] ?? { y: "", m: "", d: "" };
      const write = (next: { y: string; m: string; d: string }) => {
        setDateParts((prev) => ({ ...prev, [storageId]: next }));
        if (/^\d{4}$/.test(next.y) && /^\d{2}$/.test(next.m) && /^\d{2}$/.test(next.d)) {
          const year = Number(next.y);
          const month = Number(next.m);
          const day = Number(next.d);
          const dt = new Date(Date.UTC(year, month - 1, day));
          const valid =
            dt.getUTCFullYear() === year &&
            dt.getUTCMonth() === month - 1 &&
            dt.getUTCDate() === day;
          writeValue(valid ? `${next.y}-${next.m}-${next.d}` : "");
        } else {
          writeValue("");
        }
      };
      if (pictureForm) {
        return (
          <div key={field.id} className="sm:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">{field.label}</p>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <select className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-3" value={parts.m} onChange={(e) => write({ ...parts, m: e.target.value })}>
                <option value="">Month*</option>
                {MONTH_NAMES.map((name, monthIndex) => (
                  <option key={name} value={String(monthIndex + 1).padStart(2, "0")}>{name}</option>
                ))}
              </select>
              <select className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-3" value={parts.d} onChange={(e) => write({ ...parts, d: e.target.value })}>
                <option value="">Day*</option>
                {Array.from({ length: 31 }, (_, dayIndex) => String(dayIndex + 1).padStart(2, "0")).map((value) => (
                  <option key={value} value={value}>{Number(value)}</option>
                ))}
              </select>
              <select
                className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-3"
                value={parts.y}
                onChange={(e) => write({ ...parts, y: e.target.value })}
              >
                <option value="">Year*</option>
                {Array.from({ length: 100 }, (_, yearIndex) => String(venueToday(session.timeZone).year - yearIndex)).map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </div>
          </div>
        );
      }
      return (
        <label key={field.id} className="block text-sm">
          {field.label}
          <div className="mt-1 flex gap-2">
            <select
              className="rounded border border-stone-300 px-2 py-2"
              value={parts.m}
              onChange={(e) => write({ ...parts, m: e.target.value })}
            >
              <option value="">Month</option>
              {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map((mo) => (
                <option key={mo} value={mo}>{mo}</option>
              ))}
            </select>
            <select
              className="rounded border border-stone-300 px-2 py-2"
              value={parts.d}
              onChange={(e) => write({ ...parts, d: e.target.value })}
            >
              <option value="">Day</option>
              {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0")).map((day) => (
                <option key={day} value={day}>{day}</option>
              ))}
            </select>
            <input
              className="w-24 rounded border border-stone-300 px-2 py-2"
              placeholder="Year"
              inputMode="numeric"
              value={parts.y}
              onChange={(e) => write({ ...parts, y: e.target.value.replace(/\D/g, "").slice(0, 4) })}
            />
          </div>
        </label>
      );
    }
    if (field.type === "checkbox" && field.options.length === 0) {
      const checked = current === "yes";
      return (
        <label key={field.id} className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => writeValue(e.target.checked ? "yes" : "")}
          />
          <span>{field.label}</span>
        </label>
      );
    }
    if (field.type === "phone") {
      const selectedDial = phoneDials[storageId] ?? "+1";
      const dials = DIAL_CODES.filter((row) =>
        `${row.label} ${row.dial}`.toLowerCase().includes(dialQuery.trim().toLowerCase())
      );
      const dialOptions = (dials.length ? dials : DIAL_CODES).some((row) => row.dial === selectedDial)
        ? dials.length
          ? dials
          : DIAL_CODES
        : DIAL_CODES;
      if (pictureForm) {
        return (
          <label key={field.id} className="block sm:col-span-2">
            <span className="sr-only">{field.label}</span>
            <span className="flex overflow-hidden rounded-2xl border border-stone-200 bg-stone-50">
              <select
                className="bg-[#D4AF37] px-3 py-3 text-sm font-semibold text-stone-950"
                aria-label="Country code"
                value={selectedDial}
                onChange={(e) => setPhoneDials((prev) => ({ ...prev, [storageId]: e.target.value }))}
              >
                {DIAL_CODES.map((row) => (
                  <option key={row.code} value={row.dial}>{row.code} {row.dial}</option>
                ))}
              </select>
              <input
                className="min-w-0 flex-1 bg-transparent px-3 py-3"
                placeholder="Phone*"
                value={current}
                onChange={(e) => writeValue(e.target.value)}
              />
            </span>
          </label>
        );
      }
      return (
        <label key={field.id} className="block text-sm">
          {field.label}
          <input
            className="mt-1 w-full rounded border border-stone-300 px-2 py-2"
            placeholder="Search country or dial code"
            value={dialQuery}
            onChange={(e) => setDialQuery(e.target.value)}
          />
          <div className="mt-1 flex gap-2">
            <select
              className="rounded border border-stone-300 px-2 py-2"
              value={selectedDial}
              onChange={(e) => setPhoneDials((prev) => ({ ...prev, [storageId]: e.target.value }))}
            >
              {dialOptions.map((row) => (
                <option key={row.code} value={row.dial}>{row.label}</option>
              ))}
            </select>
            <input
              className="min-w-0 flex-1 rounded border border-stone-300 px-2 py-2"
              value={current}
              onChange={(e) => writeValue(e.target.value)}
            />
          </div>
        </label>
      );
    }
    if (field.type === "section") {
      if (pictureForm && field.id === "typed_name" && sig.allowTyped) {
        return (
          <label key={field.id} className="block text-sm sm:col-span-2">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">
              {field.label}*
            </span>
            <input
              className="mt-1 w-full rounded-2xl border border-stone-300 bg-white px-3 py-3"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
            />
          </label>
        );
      }
      return (
        <div key={field.id} className="sm:col-span-2">
          <p className={pictureForm ? "text-xs font-semibold uppercase tracking-[0.14em] text-stone-500" : "text-base font-semibold text-stone-900"}>{field.label}</p>
          {field.help ? <p className="mt-1 text-sm text-stone-600">{field.help}</p> : null}
        </div>
      );
    }
    if (field.type === "html") {
      if (pictureForm && field.id === "safety_rules") {
        return (
          <div key={field.id} className="overflow-hidden rounded-3xl border border-stone-200 bg-white sm:col-span-2">
            <div className="bg-gradient-to-r from-[#D4AF37] to-stone-300 px-5 py-4 text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-800">Play safe</p>
              <h2 className="text-2xl font-bold uppercase text-stone-950">{field.label}</h2>
            </div>
            <div className="space-y-3 px-5 py-4">
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {SAFETY_CAPTIONS.map((caption) => (
                  <li key={caption} className="rounded-2xl border border-stone-200 bg-stone-50 px-2 py-3 text-center text-[11px] font-semibold uppercase tracking-wide text-stone-700">
                    {caption}
                  </li>
                ))}
              </ul>
              {field.help ? <p className="text-sm leading-6 text-stone-700">{field.help}</p> : null}
            </div>
          </div>
        );
      }
      return (
        <div key={field.id} className="sm:col-span-2 text-sm text-stone-700">
          {field.label ? <p className="font-medium text-stone-900">{field.label}</p> : null}
          {field.help ? <div dangerouslySetInnerHTML={{ __html: sanitizeWaiverHtml(field.help) }} /> : null}
        </div>
      );
    }
    if (field.type === "hidden") {
      if (mode !== "preview") return null;
      return (
        <p key={field.id} className="text-xs text-stone-500 sm:col-span-2">
          Saved with the form. Guests do not see this: {field.label}
          {field.help ? ` (${field.help})` : ""}
        </p>
      );
    }
    if (field.type === "consent") {
      return (
        <label key={field.id} className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={current === "yes"} onChange={(e) => writeValue(e.target.checked ? "yes" : "")} />
          <span>
            {field.label}
            {field.help ? <span className="mt-1 block text-xs text-stone-500">{field.help}</span> : null}
          </span>
        </label>
      );
    }
    if (field.type === "select") {
      return (
        <label key={field.id} className="block text-sm">
          {field.label}
          {field.help ? <span className="mt-1 block text-xs text-stone-500">{field.help}</span> : null}
          {field.options.length === 0 ? (
            <span className="mt-1 block text-xs text-stone-500">No choices yet. Add them in question settings.</span>
          ) : (
            <select className="mt-1 w-full rounded border border-stone-300 px-2 py-2" value={current} onChange={(e) => writeValue(e.target.value)}>
              <option value="">Select</option>
              {field.options.map((option, index) => (
                <option key={`${option}-${index}`} value={option}>{option}</option>
              ))}
            </select>
          )}
        </label>
      );
    }
    if (field.type === "radio" || (field.type === "checkbox" && field.options.length > 0)) {
      const multiple = field.type === "checkbox";
      return (
        <fieldset key={field.id} className="space-y-2 text-sm">
          <legend className="font-medium text-stone-900">{field.label}</legend>
          {field.help ? <p className="text-xs text-stone-500">{field.help}</p> : null}
          {field.options.map((option, index) => {
            const selected = current === option;
            return (
              <label
                key={`${option}-${index}`}
                className={`flex items-start gap-3 rounded-xl border p-3 ${
                  selected ? "border-[#D4AF37]/70 bg-[#D4AF37]/10" : "border-stone-200 bg-stone-50"
                }`}
              >
                <input
                  type={multiple ? "checkbox" : "radio"}
                  className="mt-1 h-4 w-4 shrink-0 accent-[#D4AF37]"
                  name={storageId}
                  checked={selected}
                  onChange={() => writeValue(selected && multiple ? "" : option)}
                />
                <span>{option}</span>
              </label>
            );
          })}
        </fieldset>
      );
    }
    if (field.type === "number") {
      return (
        <label key={field.id} className="block text-sm">
          {field.label}
          <span className="mt-1 flex items-center gap-2">
            <input
              className="w-full rounded border border-stone-300 px-2 py-2"
              inputMode="decimal"
              value={current}
              onChange={(e) => writeValue(e.target.value.replace(/[^0-9.-]/g, ""))}
            />
          </span>
        </label>
      );
    }
    if (field.type === "time") {
      return (
        <label key={field.id} className="block text-sm">
          {field.label}
          <input type="time" className="mt-1 w-full rounded border border-stone-300 px-2 py-2" value={current} onChange={(e) => writeValue(e.target.value)} />
        </label>
      );
    }
    if (field.type === "website") {
      return (
        <label key={field.id} className="block text-sm">
          {field.label}
          <input
            type="text"
            inputMode="url"
            autoComplete="url"
            className="mt-1 w-full rounded border border-stone-300 px-2 py-2"
            placeholder="https://"
            value={current}
            onChange={(e) => writeValue(e.target.value)}
          />
        </label>
      );
    }
    if (field.type === "slider") {
      const bounds = sliderBounds(field.options);
      const value = current || String(bounds.min);
      return (
        <label key={field.id} className="block text-sm">
          {field.label}
          <input
            type="range"
            className="mt-2 w-full"
            min={bounds.min}
            max={bounds.max}
            value={value}
            onChange={(e) => writeValue(e.target.value)}
          />
          <span className="text-xs text-stone-500">{value}</span>
        </label>
      );
    }
    if (field.type === "rating") {
      const max = Math.min(10, Math.max(1, Number(field.options[0]) || 5));
      return (
        <div key={field.id} className="text-sm">
          <p>{field.label}</p>
          <div className="mt-1 flex gap-1">
            {Array.from({ length: max }, (_, index) => {
              const score = String(index + 1);
              const on = Number(current) >= index + 1;
              return (
                <button
                  key={score}
                  type="button"
                  className={`text-lg ${on ? "text-[#D4AF37]" : "text-stone-300"}`}
                  aria-label={`${score} of ${max}`}
                  onClick={() => writeValue(score)}
                >
                  ★
                </button>
              );
            })}
          </div>
        </div>
      );
    }
    if (field.type === "textarea") {
      return (
        <label key={field.id} className="block text-sm">
          {field.label}
          <textarea className="mt-1 w-full rounded border border-stone-300 px-2 py-2" rows={3} value={current} onChange={(e) => writeValue(e.target.value)} />
        </label>
      );
    }
    const lockedEmail =
      scope === "main" && field.mapsTo === "email" ? session.signingContext.lockedEmail : null;
    if (pictureForm) {
      return (
        <label key={field.id} className="block text-sm">
          <span className="sr-only">{field.label}</span>
          <input
            className="w-full rounded-2xl border border-stone-200 bg-stone-50 px-3 py-3"
            type={field.type === "email" ? "email" : "text"}
            placeholder={`${field.label}${field.required ? "*" : ""}`}
            readOnly={Boolean(lockedEmail)}
            value={lockedEmail ?? current}
            onChange={(e) => writeValue(e.target.value)}
          />
        </label>
      );
    }
    return (
      <label key={field.id} className="block text-sm">
        {field.label}
        <input
          className="mt-1 w-full rounded border border-stone-300 px-2 py-2"
          type={field.type === "email" ? "email" : "text"}
          readOnly={Boolean(lockedEmail)}
          value={lockedEmail ?? current}
          onChange={(e) => writeValue(e.target.value)}
        />
      </label>
    );
  }

  function sectionToggle(id: BlockId, title: string) {
    if (!isAccordion) return null;
    return (
      <button
        type="button"
        className="mb-2 text-sm font-medium text-stone-800 underline"
        onClick={() => setOpenSection(id)}
      >
        {openSection === id ? "Hide" : "Show"} {title}
      </button>
    );
  }

  function extraFormBlocks() {
    const extraPhotoHost =
      !details.some((field) => field.type === "photo_reader") && !showFill
        ? session.extraForms.find((row) => row.fields.some((field) => field.type === "photo_reader"))?.templateId
        : undefined;
    return session.extraForms.map((form) => (
      <fieldset key={form.templateId} className="col-span-full space-y-2">
        <legend className="text-sm font-medium">{form.name}</legend>
        <FieldRows
          fields={form.fields.filter((field) => {
            if (field.type === "clause" || field.type === "minor_repeater" || field.type === "signature" || field.type === "page_break" || field.type === "currency" || field.type === "calculation") return false;
            if (field.type === "photo_reader" && form.templateId !== extraPhotoHost) return false;
            return true;
          })}
          spanFull={false}
          renderItem={(field) => {
            const marked = extractedIds[`${form.templateId}:${field.id}`] === true;
            return (
              <div key={field.id} id={`guest-field-${form.templateId}-${field.id}`} className={marked ? "rounded p-1 ring-1 ring-[#D4AF37]" : undefined}>
                {renderField(field, form.templateId)}
                {marked ? <p className="text-xs text-stone-500">From photo</p> : null}
              </div>
            );
          }}
        />
      </fieldset>
    ));
  }

  return (
    <form
      className={layoutClass(session.template.layoutId, displayMode)}
      data-layout={structure.layoutId}
      data-display={structure.displayMode}
      data-agreement-first={agreementFirst ? "true" : "false"}
      onSubmit={(e) => void handleSubmit(e, false)}
    >
      {session.locales.length > 1 && onLocaleChange ? (
        <label className="mb-4 block text-sm">
          Language
          <select
            className="mt-1 w-full rounded border border-stone-300 px-2 py-2"
            value={session.locale}
            onChange={(e) => onLocaleChange(e.target.value)}
          >
            {session.locales.map((row) => (
              <option key={row.locale} value={row.locale}>
                {row.title} ({row.locale})
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {pictureForm && pictureRail.length ? (
        <StepRail
          steps={pictureRail.map((item, index) => ({
            key: item.key,
            label: item.label,
            enabled: mode === "preview" || index <= railAt,
          }))}
          current={Math.min(railAt, Math.max(pictureRail.length - 1, 0))}
          onPick={(index) => {
            if (mode !== "preview" && index > railAt) return;
            goRail(index);
          }}
        />
      ) : paged && questionPages ? (
        <StepRail
          steps={questionPages.map((page, index) => ({
            key: `question-${index}`,
            label: page.title,
            enabled: mode === "preview" || index <= pageIndex,
          }))}
          current={Math.min(pageIndex, Math.max(questionPages.length - 1, 0))}
          onPick={(index) => {
            setLocalError("");
            setPageIndex(index);
          }}
        />
      ) : stepped || structure.numberedRail ? (
        <ol className="mb-4 flex flex-wrap gap-2 text-xs text-stone-600">
          {blocks.map((b, i) => (
            <li key={b} className={i === step ? "font-semibold text-stone-900" : ""}>
              {i + 1}. {STEP_LABELS[b]}
            </li>
          ))}
        </ol>
      ) : null}

      {visible("venue") && pictureForm ? (
        <section className="overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm">
          <div className="bg-stone-900 px-5 py-6 text-white sm:px-7">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#D4AF37]">Start here</p>
            <h2 className="mt-2 text-2xl font-bold uppercase leading-tight tracking-tight sm:text-3xl">
              Select your park so you can sign the correct waiver
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-stone-300">
              Each location manages its own guest waiver and inbox.
            </p>
          </div>
          <div className="space-y-4 px-5 py-6 sm:px-7">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8a7030]">Shared waiver link</p>
            <p className="text-base font-semibold text-stone-950">
              This link opens the waiver for {session.venueName} · {visitLabel}.
            </p>
            <p className="text-sm leading-6 text-stone-600">
              Confirm this is the location you’re visiting before you continue.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-full bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-stone-950"
                onClick={() => {
                  setVenueOk(true);
                  setParkNote(false);
                  goRail(railAt + 1);
                }}
              >
                Yes, this is my park
              </button>
              <button
                type="button"
                className="rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-800"
                onClick={() => setParkNote(true)}
              >
                Choose a different park
              </button>
            </div>
            {parkNote ? (
              <p className="text-sm text-stone-600">
                This waiver stays on {session.venueName}. Open that park’s own link to sign somewhere else.
              </p>
            ) : null}
            <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">
              Select location
              <select className="mt-2 w-full rounded-2xl border border-stone-200 bg-stone-50 px-3 py-3 text-sm font-medium normal-case tracking-normal text-stone-900" value={session.venueName} onChange={() => undefined}>
                <option>{session.venueName}</option>
              </select>
            </label>
            <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">
              Plan for this visit
              <select className="mt-2 w-full rounded-2xl border border-stone-200 bg-stone-50 px-3 py-3 text-sm font-medium normal-case tracking-normal text-stone-900" value={visitLabel} onChange={() => undefined}>
                <option>{visitLabel}</option>
              </select>
            </label>
          </div>
        </section>
      ) : null}

      {visible("venue") && !pictureForm && mode !== "preview" ? (
        <section className={`mb-6 space-y-2 ${sectionChrome}`}>
          {sectionToggle("venue", "Venue")}
          <h2 className="text-lg font-medium text-stone-900">{session.venueName}</h2>
          {session.signingContext.productLabel ? (
            <p className="text-sm text-stone-600">Product: {session.signingContext.productLabel}</p>
          ) : null}
          {session.signingContext.bookingLabel ? (
            <p className="text-sm text-stone-600">Booking: {session.signingContext.bookingLabel}</p>
          ) : null}
          {stepped && (session.signingContext.bookingLabel || session.signingContext.productLabel) ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={venueOk} onChange={(e) => setVenueOk(e.target.checked)} />
              Yes, this is my park
            </label>
          ) : null}
          {stepped && blocks[step] === "venue" ? stepMove() : null}
        </section>
      ) : null}

      {visible("email") && pictureForm ? (
        <section className="overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm">
          <div className="h-1 bg-gradient-to-r from-[#D4AF37] via-stone-200 to-[#D4AF37]" />
          <div className="space-y-4 px-5 py-6 sm:px-7">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8a7030]">Almost there</p>
            <h2 className="text-2xl font-bold uppercase leading-tight tracking-tight text-stone-950 sm:text-3xl">
              {session.venueName} · {visitLabel}
            </h2>
            <p className="inline-flex rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-stone-700">
              Signing for: {visitLabel}
            </p>
            <p className="text-sm leading-6 text-stone-600">Enter your email for your confirmation copy from this park only.</p>
            <input
              className="w-full rounded-2xl border border-stone-200 bg-stone-50 px-3 py-3"
              type="email"
              placeholder="Email address*"
              readOnly={Boolean(session.signingContext.lockedEmail)}
              value={session.signingContext.lockedEmail ?? email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <p className="text-sm text-stone-600">You must be 18 or older to sign this document.</p>
            <div className="flex justify-center">
              <button type="button" className="rounded-xl bg-[#D4AF37] px-8 py-3 text-sm font-semibold text-stone-950" onClick={pictureNext}>
                Continue
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {visible("email") && !pictureForm ? (
        <section className="mb-6">
          <label className="block text-sm">
            Email
            <input
              className="mt-1 w-full rounded border border-stone-300 px-2 py-2"
              type="email"
              readOnly={Boolean(session.signingContext.lockedEmail)}
              value={session.signingContext.lockedEmail ?? email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {stepped && blocks[step] === "email" ? stepMove("mt-3") : null}
        </section>
      ) : null}

      {visible("fill") && showFill ? (
        <section className="mb-6 space-y-4">
          <PhotoFillChoices
            mode={entryMode}
            onChange={setEntryMode}
            panel={entryMode === "scan" || entryMode === "document" ? scanPanel(entryMode) : null}
          />
          {finishGaps().length ? (
            <div className="text-sm">
              <p className="font-medium">Finish these next</p>
              <ul>
                {finishGaps().map((gap) => (
                  <li key={gap.id}>
                    <button type="button" className="underline" onClick={() => jumpToGap(gap.id)}>
                      {gap.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {stepped && blocks[step] === "fill" ? stepMove() : null}
        </section>
      ) : null}

      <div
        className={
          structure.splitSideBySide ? "flex flex-col gap-4 md:flex-row md:items-start" : undefined
        }
        data-split={structure.splitSideBySide ? "stack-narrow" : undefined}
      >
      {visible("details") ? (
        <section className={`mb-6 min-w-0 flex-1 ${agreementFirst ? "order-2" : ""} ${pictureForm ? "overflow-hidden rounded-3xl border border-stone-200 bg-white p-5 shadow-sm sm:p-7" : sectionChrome} ${gridDetails ? "grid gap-3 sm:grid-cols-2" : "space-y-3"}`}>
          {pictureForm ? <div className="h-1 -mx-5 -mt-5 bg-gradient-to-r from-[#D4AF37] via-stone-200 to-[#D4AF37] sm:-mx-7 sm:-mt-7" /> : null}
          {sectionToggle("details", "Details")}
          {pictureForm && questionPages && shownPage < questionPages.length && guestStep && !shownFields.some((field) => field.type === "photo_reader") ? (
            <div className="sm:col-span-2 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8a7030]">{questionPages[shownPage].title}</p>
              <h2 className="text-2xl font-bold uppercase leading-tight tracking-tight text-stone-950 sm:text-3xl">
                {session.venueName} · {visitLabel}
              </h2>
              <p className="inline-flex rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-stone-700">
                Signing for: {visitLabel}
              </p>
              {questionPages[shownPage].title === "Guest info" && session.template.fields.some((field) => field.type === "minor_repeater") ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="tablist" aria-label="Who is this waiver for">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={minorMode === "minors"}
                    className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${minorMode === "minors" ? "border-[#D4AF37] bg-white text-stone-950 shadow-sm" : "border-transparent bg-stone-100 text-stone-600"}`}
                    onClick={() => {
                      setMinorMode("minors");
                      setMinors((rows) => (rows.length ? rows : [{ fullName: "", dateOfBirth: "" }]));
                    }}
                  >
                    Me and minor(s)
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={minorMode === "solo"}
                    className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${minorMode === "solo" ? "border-[#D4AF37] bg-white text-stone-950 shadow-sm" : "border-transparent bg-stone-100 text-stone-600"}`}
                    onClick={() => {
                      setMinorMode("solo");
                      setMinors([]);
                    }}
                  >
                    Just me
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          {!pictureForm && paged && questionPages && pageIndex < questionPages.length && questionPages[pageIndex].help ? (
            <p className="text-xs text-stone-500 sm:col-span-2">{questionPages[pageIndex].help}</p>
          ) : null}
          {questionsOpen && !pictureForm && (!paged || pageIndex === 0) && (!hasMappedFirst || !hasMappedLast) ? (
            <div className="space-y-2 sm:col-span-2">
              {!hasMappedFirst ? (
                <input
                  className={`w-full rounded border px-2 py-2 ${photoIdentity.first ? "border-[#D4AF37] ring-1 ring-[#D4AF37]" : "border-stone-300"}`}
                  placeholder="First name"
                  value={identity.firstName}
                  onChange={(e) => setIdentity({ ...identity, firstName: e.target.value })}
                />
              ) : null}
              {!hasMappedLast ? (
                <input
                  className={`w-full rounded border px-2 py-2 ${photoIdentity.last ? "border-[#D4AF37] ring-1 ring-[#D4AF37]" : "border-stone-300"}`}
                  placeholder="Last name"
                  value={identity.lastName}
                  onChange={(e) => setIdentity({ ...identity, lastName: e.target.value })}
                />
              ) : null}
              {photoIdentity.first || photoIdentity.last ? (
                <p className="text-xs text-stone-500">From photo</p>
              ) : null}
            </div>
          ) : null}
          {questionsOpen && !pictureForm && (!paged || pageIndex === 0) && !hasMappedDob ? (
            <label className="block text-sm sm:col-span-2">
              Date of birth
              <input
                type="date"
                className={`mt-1 w-full rounded border px-2 py-2 ${photoIdentity.dob ? "border-[#D4AF37] ring-1 ring-[#D4AF37]" : "border-stone-300"}`}
                value={identity.dateOfBirth}
                onChange={(e) => setIdentity({ ...identity, dateOfBirth: e.target.value })}
              />
              {photoIdentity.dob ? <span className="text-xs text-stone-500">From photo</span> : null}
            </label>
          ) : null}
          {showPictureAgreement ? (
            <div className="prose prose-sm col-span-full max-w-none rounded-3xl border border-stone-200 bg-white px-5 py-4 text-center" dangerouslySetInnerHTML={{ __html: session.template.bodyHtml }} />
          ) : null}
          {safetyStep ? (
            <div className="col-span-full space-y-3">
              <p className="rounded-2xl bg-stone-800 px-4 py-3 text-center text-sm font-medium text-white">
                Please read the Agreement, tick every checkbox, then draw and type your signature. You cannot submit until this is complete.
              </p>
              <p className="inline-flex rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-stone-700">
                Signing for: {visitLabel}
              </p>
            </div>
          ) : null}
          <FieldRows
            fields={(
              paged && questionPages && shownPage < questionPages.length
                ? questionPages[shownPage].fields
                : details.filter(
                    (field) =>
                      field.type !== "signature" &&
                      field.type !== "page_break" &&
                      field.type !== "currency" &&
                      field.type !== "calculation"
                  )
            ).filter((field) => questionsOpen || field.type === "photo_reader")}
            spanFull={gridDetails}
            renderItem={(field) => (
              <div
                id={`guest-field-${field.id}`}
                key={field.id}
                className={extractedIds[field.id] ? "rounded p-1 ring-1 ring-[#D4AF37]" : undefined}
              >
                {field.id === firstLegalId ? (
                  <div className="prose prose-sm mb-3 max-w-none" dangerouslySetInnerHTML={{ __html: session.template.bodyHtml }} />
                ) : null}
                {renderField(field)}
                {extractedIds[field.id] ? <p className="text-xs text-stone-500">From photo</p> : null}
              </div>
            )}
          />
          {guestAddress ? (
            <div className="col-span-full space-y-3">
              <input
                className="w-full rounded-2xl border border-stone-200 bg-stone-50 px-3 py-3"
                placeholder="Street*"
                value={addressAnswers[guestAddress.id]?.line1 ?? ""}
                onChange={(e) =>
                  setAddressAnswers((prev) => ({
                    ...prev,
                    [guestAddress.id]: {
                      line1: e.target.value,
                      line2: prev[guestAddress.id]?.line2 ?? "",
                      city: prev[guestAddress.id]?.city ?? "",
                      state: prev[guestAddress.id]?.state ?? "",
                      postal: prev[guestAddress.id]?.postal ?? "",
                    },
                  }))
                }
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-[#D4AF37]"
                  checked={addressManual[guestAddress.id] !== false}
                  onChange={(e) => setAddressManual((prev) => ({ ...prev, [guestAddress.id]: e.target.checked }))}
                />
                Enter address manually
              </label>
            </div>
          ) : null}
          {pictureForm &&
          (safetyStep ||
            shownFields.some((field) => field.type === "clause" || field.type === "signature" || field.id === "typed_name")) ? (
            <p className="col-span-full text-center text-sm font-medium text-stone-600">
              {checkedAny} / {clauses.length} checkboxes complete
            </p>
          ) : null}
          {questionsOpen && minorMode === "minors" && !pictureForm ? (
            <fieldset className="col-span-full space-y-2 rounded border border-stone-200 p-3 sm:col-span-2">
              <legend className="text-sm font-medium">Guardian</legend>
              {hasMappedFirst && hasMappedLast ? null : (
                <input className="w-full rounded border px-2 py-2" placeholder="Guardian full name" value={guardian.fullName} onChange={(e) => setGuardian({ ...guardian, fullName: e.target.value })} />
              )}
              {hasMappedDob ? null : (
                <input type="date" className="w-full rounded border px-2 py-2" value={guardian.dateOfBirth} onChange={(e) => setGuardian({ ...guardian, dateOfBirth: e.target.value })} />
              )}
              <input className="w-full rounded border px-2 py-2" placeholder="Relationship" value={guardian.relationship} onChange={(e) => setGuardian({ ...guardian, relationship: e.target.value })} />
            </fieldset>
          ) : null}
          {pictureForm && lastPicture ? (
            <>
              {extraFormBlocks()}
              {requiredClauseCount === 0 && session.settings.requireIntentCheckbox && session.template.signatureRequired ? (
                <label className="col-span-full flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={intent} onChange={(e) => setIntent(e.target.checked)} />
                  I intend to sign this agreement electronically.
                </label>
              ) : null}
              {!hasSignatureField && (sig.allowTyped || sig.allowDrawn) && session.template.signatureRequired ? (
                <div className="col-span-full space-y-3">
                  {sig.allowTyped ? (
                    <label className="block text-sm">
                      Typed legal name
                      <input className="mt-1 w-full rounded border border-stone-300 px-2 py-2" value={typedName} onChange={(e) => setTypedName(e.target.value)} />
                    </label>
                  ) : null}
                  {sig.allowDrawn ? <SignaturePad disabled={busy} onChange={setDrawnSvg} /> : null}
                </div>
              ) : null}
              {session.settings.optionalWitness ? (
                <input className="col-span-full w-full rounded border border-stone-300 px-2 py-2" placeholder="Witness name (optional)" value={witness} onChange={(e) => setWitness(e.target.value)} />
              ) : null}
            </>
          ) : null}
          {pictureForm && railStep?.kind === "page" ? (
            <div className="col-span-full flex flex-col gap-3 sm:flex-row">
              <button type="button" className="rounded-xl border border-stone-300 bg-white px-5 py-3 text-sm font-semibold text-stone-800" onClick={pictureBack}>
                Previous
              </button>
              {lastPicture ? (
                mode === "preview" ? (
                  <div className="flex flex-col gap-2">
                    <button type="button" className="rounded-xl bg-[#D4AF37] px-5 py-3 text-sm font-semibold text-stone-950">
                      Submit
                    </button>
                    <p className="text-sm text-stone-500">Preview only — nothing is signed or saved.</p>
                  </div>
                ) : (
                  <>
                    <button
                      type="submit"
                      disabled={busy}
                      className="rounded-xl bg-[#D4AF37] px-5 py-3 text-sm font-semibold text-stone-950 disabled:opacity-50"
                    >
                      {busy ? "Saving…" : "Accept and continue"}
                    </button>
                    {session.template.kind === "liability_waiver" ? (
                      <button
                        type="button"
                        className="rounded-xl border border-stone-300 bg-white px-5 py-3 text-sm font-semibold text-stone-800 disabled:opacity-50"
                        disabled={busy}
                        onClick={(event) => void handleSubmit(event as unknown as FormEvent, true)}
                      >
                        Decline
                      </button>
                    ) : null}
                  </>
                )
              ) : (
                <button type="button" className="rounded-xl bg-[#D4AF37] px-5 py-3 text-sm font-semibold text-stone-950" onClick={pictureNext}>
                  Continue
                </button>
              )}
            </div>
          ) : null}
          {!pictureForm && paged && questionPages && pageIndex < questionPages.length - 1 ? (
            <div className="col-span-full flex flex-wrap gap-2">
              {pageIndex > 0 ? (
                <button type="button" className="rounded border border-stone-300 px-4 py-2" onClick={() => { setLocalError(""); setPageIndex((current) => Math.max(0, current - 1)); }}>
                  Back
                </button>
              ) : null}
              <button
                type="button"
                className="rounded px-4 py-2 text-white"
                style={{ background: GOLD }}
                onClick={() => {
                  if (mode !== "preview") {
                    const pageFields = questionPages?.[pageIndex]?.fields ?? [];
                    const problem = questionPageProblem(pageFields);
                    if (problem) {
                      setLocalError(problem.message);
                      if (problem.focusId) {
                        document.getElementById(`guest-field-${problem.focusId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                      }
                      return;
                    }
                  }
                  setLocalError("");
                  setPageIndex((current) => Math.min(current + 1, questionPages.length - 1));
                }}
              >
                Continue
              </button>
            </div>
          ) : null}
          {stepped && blocks[step] === "details" ? stepMove("col-span-full") : null}
        </section>
      ) : null}

      {visible("agreement") ? (
        <section className={`mb-6 min-w-0 flex-1 space-y-4 ${agreementFirst ? "order-1" : ""} ${pictureForm ? "" : sectionChrome}`}>
          {sectionToggle("agreement", "Agreement")}
          {pictureForm ? (
            <p className="rounded-2xl bg-stone-800 px-4 py-3 text-center text-sm font-medium text-white">
              Please read the Agreement, tick every checkbox, then draw and type your signature. You cannot submit until this is complete.
            </p>
          ) : null}
          {pictureForm ? (
            <p className="inline-flex rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-stone-700">
              Signing for: {visitLabel}
            </p>
          ) : null}
          {firstLegalId && !pictureForm ? null : (
            <div className={`prose prose-sm max-w-none ${pictureForm ? "rounded-3xl border border-stone-200 bg-white px-5 py-4 text-center" : ""}`} dangerouslySetInnerHTML={{ __html: session.template.bodyHtml }} />
          )}
          {hasClauses && !clausesInQuestions ? (
            <div className="relative">
              <div className={`space-y-3 ${clauses.length > 3 && checkedAny < clauses.length ? "max-h-[min(28rem,60vh)] overflow-y-auto pb-14" : ""}`}>
                {clauses.map((clause) => {
                  const gap = Boolean(localError) && clause.required && !acceptedClauses[clause.id];
                  const checked = acceptedClauses[clause.id] === true;
                  const copy = splitClauseLabel(clause.label);
                  return (
                    <label
                      key={clause.id}
                      ref={(el) => {
                        clauseRefs.current[clause.id] = el;
                      }}
                      className={`flex items-start gap-3 rounded-2xl border p-4 text-sm leading-relaxed text-stone-800 ${
                        gap
                          ? "border-amber-500 bg-amber-50"
                          : checked
                            ? "border-[#D4AF37]/70 bg-[#D4AF37]/10"
                            : "border-stone-200 bg-stone-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 shrink-0 accent-[#D4AF37]"
                        checked={checked}
                        onChange={(e) =>
                          setAcceptedClauses((prev) => ({ ...prev, [clause.id]: e.target.checked }))
                        }
                      />
                      <span>
                        {copy.title ? <strong className="font-semibold text-stone-950">{copy.title}: </strong> : null}
                        {copy.body}
                        {clause.help ? <span className="mt-1 block text-xs text-stone-500">{clause.help}</span> : null}
                      </span>
                    </label>
                  );
                })}
              </div>
              {clauses.length > 3 && checkedAny < clauses.length ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
                  <p className="pointer-events-auto rounded-full border border-[#D4AF37]/50 bg-[#FBF6E8] px-4 py-2 text-center text-sm font-semibold text-stone-900 shadow-md">
                    Scroll down. {checkedAny} / {clauses.length} checkboxes complete
                  </p>
                </div>
              ) : (
                <p className="text-center text-sm font-medium text-stone-600">
                  {checkedAny} / {clauses.length} checkboxes complete
                </p>
              )}
            </div>
          ) : requiredClauseCount === 0 && session.settings.requireIntentCheckbox && session.template.signatureRequired ? (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={intent} onChange={(e) => setIntent(e.target.checked)} />
              I intend to sign this agreement electronically.
            </label>
          ) : null}

          {hasSignatureField && !signatureInQuestions ? (
            session.template.fields
              .filter((field) => field.type === "signature")
              .map((field) => renderField(field))
          ) : !hasSignatureField && (sig.allowTyped || sig.allowDrawn) && session.template.signatureRequired ? (
            <div className="space-y-3">
              {sig.allowTyped ? (
                <label className="block text-sm">
                  Typed legal name
                  <input className="mt-1 w-full rounded border border-stone-300 px-2 py-2" value={typedName} onChange={(e) => setTypedName(e.target.value)} />
                </label>
              ) : null}
              {sig.allowDrawn ? <SignaturePad disabled={busy} onChange={setDrawnSvg} /> : null}
            </div>
          ) : null}

          {session.settings.optionalWitness ? (
            <input className="w-full rounded border border-stone-300 px-2 py-2" placeholder="Witness name (optional)" value={witness} onChange={(e) => setWitness(e.target.value)} />
          ) : null}

          {extraFormBlocks()}

          {pictureForm ? (
            <div className="flex flex-col gap-3 sm:flex-row">
              <button type="button" className="rounded-xl border border-stone-300 bg-white px-5 py-3 text-sm font-semibold text-stone-800" onClick={pictureBack}>
                Previous
              </button>
              {mode === "preview" ? (
                <div className="flex flex-col gap-2">
                  <button type="button" className="rounded-xl bg-[#D4AF37] px-5 py-3 text-sm font-semibold text-stone-950">
                    Submit
                  </button>
                  <p className="text-sm text-stone-500">Preview only — nothing is signed or saved.</p>
                </div>
              ) : (
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-xl bg-[#D4AF37] px-5 py-3 text-sm font-semibold text-stone-950 disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Accept and continue"}
                </button>
              )}
            </div>
          ) : paged && questionPages && pageIndex > 0 ? (
            <button type="button" className="rounded border border-stone-300 px-4 py-2" onClick={() => { setLocalError(""); setPageIndex((current) => Math.max(0, current - 1)); }}>
              Back
            </button>
          ) : stepped && step > 0 ? (
            <button type="button" className="rounded border border-stone-300 px-4 py-2" onClick={prevStep}>
              Back
            </button>
          ) : null}
          {pictureForm ? null : mode === "preview" ? (
            <div className="flex flex-col items-start gap-2">
              <button type="button" className="rounded px-4 py-2 text-sm font-semibold text-stone-950" style={{ background: GOLD }}>
                Submit
              </button>
              <p className="text-sm text-stone-500">Preview only — nothing is signed or saved.</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={busy}
                className="rounded px-4 py-2 text-white disabled:opacity-50"
                style={{ background: GOLD }}
              >
                {busy ? "Saving…" : "Sign agreement"}
              </button>
              {session.template.kind === "liability_waiver" ? (
                <button type="button" className="rounded border border-stone-300 px-4 py-2" disabled={busy} onClick={(e) => void handleSubmit(e as unknown as FormEvent, true)}>
                  Decline
                </button>
              ) : null}
            </div>
          )}
        </section>
      ) : null}
      </div>

      {(localError || error) && <p className="text-sm text-red-700">{localError || error}</p>}
    </form>
  );
}
