"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlignLeft,
  Calendar,
  CheckSquare,
  ChevronDown,
  FileText,
  Camera,
  GripVertical,
  Mail,
  MapPin,
  PenLine,
  Phone,
  Plus,
  CircleDot,
  Clock,
  Code,
  EyeOff,
  Globe,
  Hash,
  Heading,
  SeparatorHorizontal,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Trash2,
  Type,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { fieldClass } from "@/components/Protected/admin/pages/ticketing/ticketingUi";
import {
  CLAUSE_LABEL_MAX,
  FIELD_TYPES,
  MAX_WAIVER_FIELDS,
  canShareFieldRow,
  cleanFieldRowKey,
  fieldLabelLimit,
  fieldMapsToGuest,
  groupFieldIndexes,
  normalizeFieldOptions,
  normalizeSharedRows,
} from "@/lib/waivers/presentation";

export type DraftField = {
  id: string;
  section: string;
  type: string;
  label: string;
  required: boolean;
  options: string;
  help: string;
  mapsTo: string;
  /** Set when this question sits on the same row as its neighbors. */
  row?: string;
};

type ClauseStatement = {
  id: string;
  label: string;
  required: boolean;
};

type ChoiceRow = {
  id: string;
  label: string;
};

function isChoiceType(type: string): boolean {
  return type === "select" || type === "radio" || type === "checkbox";
}

function newChoiceId(): string {
  return `opt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function rowsForChoice(field: { type: string; options: string }): ChoiceRow[] | null {
  if (!isChoiceType(field.type)) return null;
  const lines = choiceLines(field.options);
  if (field.type === "checkbox" && lines.length === 0) return [];
  const source = lines.length ? lines : ["", ""];
  return source.map((label) => ({ id: newChoiceId(), label }));
}

const TYPE_LABELS: Record<string, string> = {
  photo_reader: "Photo reader",
  signature: "E-signature",
  page_break: "Page Break",
  text: "Input",
  textarea: "Textarea",
  checkbox: "Checkbox",
  select: "Select",
  date: "Datepicker",
  email: "Email",
  phone: "Phone",
  clause: "Agreement they must accept",
  minor_repeater: "Children in the group",
  address: "Address",
  name: "Name",
  website: "Website",
  number: "Number",
  radio: "Radio",
  time: "Timepicker",
  section: "Section",
  html: "HTML",
  hidden: "Hidden Field",
  consent: "Consent",
  slider: "Slider",
  rating: "Rating",
};

const MAPS_TO_LABELS: Record<string, string> = {
  first_name: "Guest's first name",
  last_name: "Guest's last name",
  email: "Guest's email",
  phone: "Guest's phone",
  dob: "Guest's date of birth",
  emergency_name: "Emergency contact name",
  emergency_phone: "Emergency contact phone",
  address: "Street address",
  city: "City",
  state: "State or region",
  postal_code: "Postal code",
};

function FieldIcon({ type }: { type: string }) {
  const className = "h-4 w-4 shrink-0 text-stone-500";
  if (type === "email") return <Mail className={className} />;
  if (type === "phone") return <Phone className={className} />;
  if (type === "date") return <Calendar className={className} />;
  if (type === "address") return <MapPin className={className} />;
  if (type === "textarea") return <AlignLeft className={className} />;
  if (type === "checkbox") return <CheckSquare className={className} />;
  if (type === "select") return <ChevronDown className={className} />;
  if (type === "clause") return <FileText className={className} />;
  if (type === "minor_repeater") return <Users className={className} />;
  if (type === "text") return <UserRound className={className} />;
  if (type === "photo_reader") return <Camera className={className} />;
  if (type === "signature") return <PenLine className={className} />;
  if (type === "page_break") return <SeparatorHorizontal className={className} />;
  if (type === "name") return <UserRound className={className} />;
  if (type === "website") return <Globe className={className} />;
  if (type === "number") return <Hash className={className} />;
  if (type === "radio") return <CircleDot className={className} />;
  if (type === "time") return <Clock className={className} />;
  if (type === "section") return <Heading className={className} />;
  if (type === "html") return <Code className={className} />;
  if (type === "hidden") return <EyeOff className={className} />;
  if (type === "consent") return <ShieldCheck className={className} />;
  if (type === "slider") return <SlidersHorizontal className={className} />;
  if (type === "rating") return <Star className={className} />;
  return <Type className={className} />;
}

export function fieldsFromJson(value: unknown): DraftField[] {
  if (!Array.isArray(value)) return [];
  const rows = value.flatMap((field, index) => {
    const row = field && typeof field === "object" ? (field as Record<string, unknown>) : {};
    const type = typeof row.type === "string" ? row.type : "text";
    if (type === "currency" || type === "calculation") return [];
    return {
      id: typeof row.id === "string" ? row.id : `field_${index + 1}`,
      section:
        typeof row.section === "string" && row.section
          ? row.section
          : type === "clause"
            ? "agreement"
            : "guest",
      type,
      label: typeof row.label === "string" ? row.label : "",
      required: row.required === true,
      options: Array.isArray(row.options)
        ? row.options.filter((option): option is string => typeof option === "string").join("|")
        : "",
      help: typeof row.help === "string" ? row.help : "",
      mapsTo: typeof row.mapsTo === "string" ? row.mapsTo : "",
      row: cleanFieldRowKey(row.row),
    };
  });
  return normalizeSharedRows(rows);
}

export function fieldsToJson(fields: DraftField[]) {
  const rows = fields
    .filter((field) => field.type !== "currency" && field.type !== "calculation")
    .map((field) => {
      const options = normalizeFieldOptions(
        field.type,
        choiceLines(field.options)
          .slice(0, 30)
          .map((option) => option.slice(0, 120))
      );
      const section =
        field.type === "clause"
          ? "agreement"
          : field.section.trim() === "agreement"
            ? "guest"
            : field.section.trim() || "guest";
      const row: { type: string; row?: string } & Record<string, unknown> = {
        id: field.id.trim().slice(0, 40),
        type: field.type,
        label: field.label.trim().slice(0, fieldLabelLimit(field.type)),
        required: field.required,
        options,
        section,
      };
      const help = field.help.trim().slice(0, 300);
      if (help) row.help = help;
      if (fieldMapsToGuest(field.type) && field.mapsTo) {
        row.mapsTo = field.mapsTo;
      }
      const rowKey = canShareFieldRow(field.type) ? cleanFieldRowKey(field.row) : "";
      if (rowKey) row.row = rowKey;
      return row;
    });
  return normalizeSharedRows(rows).map((field) => {
    if (!field.row) {
      const { row: _unused, ...rest } = field;
      return rest;
    }
    return field;
  });
}

export function blankField(type: string, index: number): DraftField {
  const clause = type === "clause";
  return {
    id: `${clause ? "clause" : type}_${index}_${Math.random().toString(36).slice(2, 6)}`.slice(0, 40),
    section: clause ? "agreement" : "guest",
    type,
    label:
      type === "photo_reader"
        ? "Photo reader"
        : type === "signature"
          ? "E-signature"
          : type === "page_break"
            ? "Page Break"
            : type === "slider"
                ? "Slider"
                : type === "rating"
                  ? "Rating"
                  : type === "hidden"
                      ? "Hidden Field"
                      : type === "html"
                        ? "HTML"
                        : type === "consent"
                          ? "Consent"
                          : clause
                            ? "I have read this agreement and I agree to it."
                            : TYPE_LABELS[type] ?? "Question",
    required: clause || type === "minor_repeater" || type === "signature" || type === "consent",
    options: type === "slider" ? "0|100" : type === "rating" ? "5" : "",
    help: "",
    mapsTo: "",
    row: "",
  };
}

function choiceLines(options: string): string[] {
  return options
    .split("|")
    .map((option) => option.trim())
    .filter(Boolean);
}

/** Kinds of answers that can be stored on the guest record. */
function allowedMapsTo(type: string): string[] {
  if (type === "email") return ["email"];
  if (type === "phone") return ["phone"];
  if (type === "date") return ["dob"];
  if (type === "address") return ["address"];
  if (type === "text") {
    return [
      "first_name",
      "last_name",
      "email",
      "phone",
      "emergency_name",
      "emergency_phone",
      "address",
      "city",
      "state",
      "postal_code",
    ];
  }
  return [];
}

/** Fills the guest record when that slot is still free. */
function defaultMapsTo(type: string, fields: DraftField[], exceptIndex = -1): string {
  const taken = new Set(
    fields
      .filter((field, index) => index !== exceptIndex && field.mapsTo)
      .map((field) => field.mapsTo)
  );
  if (type === "email" && !taken.has("email")) return "email";
  if (type === "phone" && !taken.has("phone")) return "phone";
  if (type === "address" && !taken.has("address")) return "address";
  if (type === "date" && !taken.has("dob")) return "dob";
  return "";
}

export function describeDraftField(field: DraftField): string {
  if (field.type === "page_break") {
    const name = field.label.trim();
    const shown = !name || name.toLowerCase() === "page break" ? "unnamed" : name;
    return `Step name: ${shown}. Questions below this break use this name. Put a page break first to name the opening step.`;
  }
  const kind = TYPE_LABELS[field.type] ?? "Question";
  const choices = choiceLines(field.options);
  if ((field.type === "select" || field.type === "radio") && choices.length === 0) {
    return `${kind} · open settings and add the choices`;
  }
  if ((field.type === "select" || field.type === "radio" || field.type === "checkbox") && choices.length > 0) {
    return `${kind} · ${choices.length} ${choices.length === 1 ? "choice" : "choices"}`;
  }
  const linked = field.mapsTo ? MAPS_TO_LABELS[field.mapsTo] : "";
  return linked ? `${kind} · ${linked}` : kind;
}

export default function WaiverFieldDesigner({
  fields,
  onChange,
  disabled,
  omitTypes = [],
}: {
  fields: DraftField[];
  onChange: (fields: DraftField[]) => void;
  disabled?: boolean;
  omitTypes?: string[];
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [rowDrag, setRowDrag] = useState<{
    from: number;
    over: number;
    side: "before" | "left" | "right";
    x: number;
    y: number;
    width: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<DraftField | null>(null);
  const [clauseStatements, setClauseStatements] = useState<ClauseStatement[] | null>(null);
  const [openStatementId, setOpenStatementId] = useState<string | null>(null);
  const [choiceRows, setChoiceRows] = useState<ChoiceRow[] | null>(null);
  const [settingsError, setSettingsError] = useState("");
  const draggedAt = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const dragType = useRef<string | null>(null);
  const dragFrom = useRef<number | null>(null);
  const rowBoxes = useRef<{ left: number; right: number; top: number; bottom: number }[]>([]);
  const dragGhost = useRef({ offsetX: 0, offsetY: 0, width: 0, height: 0 });
  const dragScroller = useRef<HTMLElement | null>(null);
  const fieldsRef = useRef(fields);
  const onChangeRef = useRef(onChange);
  fieldsRef.current = fields;
  onChangeRef.current = onChange;
  const snapshotRef = useRef<DraftField | null>(null);
  const clauseSnapshot = useRef<DraftField[] | null>(null);
  const revertRef = useRef<() => void>(() => {});
  const offeredTypes = FIELD_TYPES.filter((type) => !omitTypes.includes(type));

  useEffect(() => {
    if (!fields.some((field) => field.type === "currency" || field.type === "calculation")) return;
    setEditing(null);
    setDraft(null);
    onChange(normalizeSharedRows(fields.filter((field) => field.type !== "currency" && field.type !== "calculation")));
  }, [fields, onChange]);

  useEffect(() => {
    if (!omitTypes.length) return;
    if (!fields.some((field) => omitTypes.includes(field.type))) return;
    onChange(normalizeSharedRows(fields.filter((field) => !omitTypes.includes(field.type))));
  }, [fields, omitTypes, onChange]);

  function moveField(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= fields.length || to >= fields.length) return;
    const copy = fields.map((field) => ({ ...field }));
    const [row] = copy.splice(from, 1);
    if (!row) return;
    row.row = "";
    copy.splice(to, 0, row);
    onChange(normalizeSharedRows(copy));
  }

  function renameField(index: number, label: string) {
    const field = fields[index];
    if (!field) return;
    onChange(
      fields.map((row, rowIndex) =>
        rowIndex === index ? { ...row, label: label.slice(0, fieldLabelLimit(row.type)) } : row
      )
    );
  }

  function insertField(type: string, index: number) {
    if (disabled || fields.length >= MAX_WAIVER_FIELDS) return;
    if (omitTypes.includes(type)) return;
    if ((type === "signature" || type === "photo_reader") && fields.some((field) => field.type === type)) return;
    const row = blankField(type, fields.length + 1);
    const used = new Set(fields.map((field) => field.id));
    let guard = 0;
    while (used.has(row.id) && guard < 6) {
      guard += 1;
      row.id = blankField(type, fields.length + guard + 1).id;
    }
    if (used.has(row.id)) row.id = `q_${Date.now().toString(36)}_${guard}`.slice(0, 40);
    if (type === "page_break") {
      const laterBreak = fields.slice(index).some((field) => field.type === "page_break");
      if (!laterBreak) row.label = "Submit";
    }
    const mapsTo = defaultMapsTo(type, fields);
    if (mapsTo) row.mapsTo = mapsTo;
    const copy = [...fields];
    copy.splice(Math.max(0, Math.min(index, copy.length)), 0, row);
    onChange(normalizeSharedRows(copy));
  }

  function openPicker() {
    if (disabled || fields.length >= MAX_WAIVER_FIELDS) return;
    setPicked([]);
    setPickerOpen(true);
  }

  function togglePicked(type: string) {
    const already =
      (type === "signature" || type === "photo_reader") && fields.some((field) => field.type === type);
    if (already || omitTypes.includes(type)) return;
    setPicked((current) => {
      if (current.includes(type)) return current.filter((item) => item !== type);
      if (fields.length + current.length >= MAX_WAIVER_FIELDS) return current;
      return [...current, type];
    });
  }

  function addPickedFields() {
    if (disabled || picked.length === 0) return;
    const next = [...fields];
    const used = new Set(next.map((field) => field.id));
    for (const type of picked) {
      if (next.length >= MAX_WAIVER_FIELDS) break;
      if (omitTypes.includes(type)) continue;
      if ((type === "signature" || type === "photo_reader") && next.some((field) => field.type === type)) continue;
      const row = blankField(type, next.length + 1);
      let guard = 0;
      while (used.has(row.id) && guard < 6) {
        guard += 1;
        row.id = blankField(type, next.length + guard + 1).id;
      }
      if (used.has(row.id)) row.id = `q_${Date.now().toString(36)}_${type}_${guard}`.slice(0, 40);
      used.add(row.id);
      const mapsTo = defaultMapsTo(type, next);
      if (mapsTo) row.mapsTo = mapsTo;
      next.push(row);
    }
    onChange(normalizeSharedRows(next));
    setPickerOpen(false);
    setPicked([]);
  }

  function pointerPoint(clientX: number, clientY: number): { x: number; y: number } {
    const scroller = dragScroller.current;
    if (!scroller) return { x: clientX, y: clientY + window.scrollY };
    const frame = scroller.getBoundingClientRect();
    return {
      x: clientX - frame.left + scroller.scrollLeft,
      y: clientY - frame.top + scroller.scrollTop,
    };
  }

  function locateDrop(clientX: number, clientY: number, from: number): { over: number; side: "before" | "left" | "right" } {
    const metrics = dragGhost.current;
    const origin = pointerPoint(clientX - metrics.offsetX, clientY - metrics.offsetY);
    const ghost = {
      left: origin.x,
      top: origin.y,
      right: origin.x + metrics.width,
      bottom: origin.y + metrics.height,
    };
    const ghostMidX = (ghost.left + ghost.right) / 2;
    const ghostMidY = (ghost.top + ghost.bottom) / 2;
    const boxes = rowBoxes.current;
    const list = fieldsRef.current;
    const verticalAt = () => {
      for (let cursor = 0; cursor < boxes.length; cursor += 1) {
        if (cursor === from) continue;
        if (ghostMidY < (boxes[cursor].top + boxes[cursor].bottom) / 2) return { over: cursor, side: "before" as const };
      }
      return { over: boxes.length, side: "before" as const };
    };
    let bestIndex = -1;
    let bestArea = 0;
    boxes.forEach((box, index) => {
      if (index === from) return;
      const width = Math.min(ghost.right, box.right) - Math.max(ghost.left, box.left);
      const height = Math.min(ghost.bottom, box.bottom) - Math.max(ghost.top, box.top);
      if (width <= 0 || height <= 0) return;
      const area = width * height;
      if (area > bestArea) {
        bestArea = area;
        bestIndex = index;
      }
    });
    if (bestIndex < 0) return verticalAt();
    const box = boxes[bestIndex];
    const verticalOverlap = Math.min(ghost.bottom, box.bottom) - Math.max(ghost.top, box.top);
    const moving = list[from];
    const target = list[bestIndex];
    const share = Boolean(moving && target && canShareFieldRow(moving.type) && canShareFieldRow(target.type));
    const key = target?.row ?? "";
    const occupied = key
      ? list.filter((field, fieldIndex) => fieldIndex !== from && field.row === key).length
      : 1;
    const boxMidX = (box.left + box.right) / 2;
    const neededOverlap = Math.max(18, Math.min(metrics.height, box.bottom - box.top) * 0.4);
    if (share && occupied < 3 && verticalOverlap >= neededOverlap) {
      return { over: bestIndex, side: ghostMidX < boxMidX ? "left" : "right" };
    }
    return verticalAt();
  }

  function commitPlacement(from: number, over: number, side: "before" | "left" | "right") {
    const list = fieldsRef.current.map((field) => ({ ...field }));
    const moving = list[from];
    if (!moving) return;
    if (side !== "before" && over >= 0 && over < list.length && over !== from) {
      const target = list[over];
      if (target && canShareFieldRow(moving.type) && canShareFieldRow(target.type)) {
        const rowId = target.row || `row_${Math.random().toString(36).slice(2, 8)}`;
        const occupied = list.filter((field, index) => index !== from && field.row === rowId).length;
        const size = target.row ? occupied : 1;
        if (size < 3) {
          list.splice(from, 1);
          let at = list.findIndex((field) => field.id === target.id);
          if (at < 0) at = Math.min(over, list.length);
          if (side === "right") at += 1;
          for (const field of list) {
            if (field.id === target.id || field.row === rowId) field.row = rowId;
          }
          moving.row = rowId;
          list.splice(Math.max(0, Math.min(at, list.length)), 0, moving);
          onChangeRef.current(normalizeSharedRows(list));
          return;
        }
      }
    }
    let at = over;
    if (from < over) at -= 1;
    if (side === "right") at += 1;
    at = Math.max(0, Math.min(at, list.length - 1));
    if (at === from) return;
    moving.row = "";
    const removed = list.splice(from, 1)[0];
    if (!removed) return;
    list.splice(at, 0, removed);
    onChangeRef.current(normalizeSharedRows(list));
  }

  function scrollingParent(node: HTMLElement | null): HTMLElement | null {
    let current = node?.parentElement ?? null;
    while (current) {
      const style = window.getComputedStyle(current);
      if (/(auto|scroll)/.test(style.overflowY) && current.scrollHeight > current.clientHeight + 8) return current;
      current = current.parentElement;
    }
    return null;
  }

  function beginRowDrag(index: number, event: React.PointerEvent<HTMLButtonElement>) {
    if (disabled || editing != null || event.button !== 0) return;
    const row = event.currentTarget.closest("[data-field-row]") as HTMLElement | null;
    const rect = row?.getBoundingClientRect();
    const rows = listRef.current?.querySelectorAll<HTMLElement>("[data-field-row]");
    if (!rect || !rows?.length) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const scroller = scrollingParent(listRef.current);
    dragScroller.current = scroller;
    const frame = scroller?.getBoundingClientRect();
    rowBoxes.current = Array.from(rows).map((node) => {
      const box = node.getBoundingClientRect();
      if (!scroller || !frame) {
        return {
          left: box.left,
          right: box.right,
          top: box.top + window.scrollY,
          bottom: box.bottom + window.scrollY,
        };
      }
      return {
        left: box.left - frame.left + scroller.scrollLeft,
        right: box.right - frame.left + scroller.scrollLeft,
        top: box.top - frame.top + scroller.scrollTop,
        bottom: box.bottom - frame.top + scroller.scrollTop,
      };
    });
    draggedAt.current = Date.now();
    dragGhost.current = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
    setRowDrag({
      from: index,
      over: index,
      side: "before",
      x: rect.left,
      y: rect.top,
      width: rect.width,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    });
  }

  useEffect(() => {
    if (!rowDrag) return;
    const origin = rowDrag;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    const move = (event: PointerEvent) => {
      const scroller = dragScroller.current;
      if (scroller) {
        const frame = scroller.getBoundingClientRect();
        if (event.clientY < frame.top + 56) scroller.scrollTop -= 14;
        else if (event.clientY > frame.bottom - 56) scroller.scrollTop += 14;
      } else {
        const edge = 56;
        if (event.clientY < edge) window.scrollBy(0, -14);
        else if (event.clientY > window.innerHeight - edge) window.scrollBy(0, 14);
      }
      setRowDrag((current) => {
        if (!current) return null;
        const drop = locateDrop(event.clientX, event.clientY, origin.from);
        return {
          ...current,
          x: event.clientX - current.offsetX,
          y: event.clientY - current.offsetY,
          over: drop.over,
          side: drop.side,
        };
      });
    };
    const cancel = () => setRowDrag(null);
    const finish = (event: PointerEvent) => {
      setRowDrag(null);
      const drop = locateDrop(event.clientX, event.clientY, origin.from);
      draggedAt.current = Date.now();
      commitPlacement(origin.from, drop.over, drop.side);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
    };
    // The listener stays for the whole gesture. `from` does not change until the pointer is released.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowDrag?.from]);

  function slotFromPointer(clientY: number): number {
    const rows = listRef.current?.querySelectorAll<HTMLElement>("[data-field-row]");
    if (!rows || rows.length === 0) return 0;
    for (let index = 0; index < rows.length; index += 1) {
      const rect = rows[index].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return index;
    }
    return rows.length;
  }

  function onListDragOver(event: React.DragEvent) {
    if (editing != null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = dragFrom.current == null ? "copy" : "move";
    setOverIndex(slotFromPointer(event.clientY));
  }

  function onListDrop(event: React.DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    const index = slotFromPointer(event.clientY);
    const plain = event.dataTransfer.getData("text/plain");
    const typed = event.dataTransfer.getData("application/x-waiver-field") || dragType.current || "";
    const type = typed || ((FIELD_TYPES as readonly string[]).includes(plain) ? plain : "");
    const fromRaw = event.dataTransfer.getData("application/x-waiver-index");
    let from: number | null = null;
    if (fromRaw !== "") {
      const parsed = Number(fromRaw);
      from = Number.isInteger(parsed) ? parsed : null;
    } else if (dragFrom.current != null) {
      from = dragFrom.current;
    } else if (/^\d+$/.test(plain)) {
      from = Number(plain);
    }
    setOverIndex(null);
    dragType.current = null;
    dragFrom.current = null;
    if (disabled) return;
    if (from != null) {
      moveField(from, from < index ? index - 1 : index);
      return;
    }
    if (type) insertField(type, index);
  }

  function statementsFor(index: number, current: DraftField): ClauseStatement[] {
    return fields
      .map((field, fieldIndex) => (fieldIndex === index ? { ...current, type: "clause" } : field))
      .filter((field) => field.type === "clause")
      .map((field) => ({ id: field.id, label: field.label, required: field.required }));
  }

  function openSettings(index: number) {
    setSettingsError("");
    const original = { ...fields[index] };
    snapshotRef.current = original;
    clauseSnapshot.current = original.type === "clause" ? fields.map((field) => ({ ...field })) : null;
    setDraft({ ...original });
    setClauseStatements(original.type === "clause" ? statementsFor(index, original) : null);
    setChoiceRows(rowsForChoice(original));
    setEditing(index);
  }

  function revertOpenDraft() {
    const snap = snapshotRef.current;
    if (editing == null || !snap) return;
    onChange(fields.map((field, index) => (index === editing ? snap : field)));
  }

  function restoreSettings() {
    if (clauseSnapshot.current) {
      onChange(clauseSnapshot.current.map((field) => ({ ...field })));
      clauseSnapshot.current = null;
      return;
    }
    revertOpenDraft();
  }

  revertRef.current = restoreSettings;

  function closeSettings(revert = true) {
    if (revert !== false) restoreSettings();
    else clauseSnapshot.current = null;
    snapshotRef.current = null;
    setEditing(null);
    setDraft(null);
    setClauseStatements(null);
    setOpenStatementId(null);
    setChoiceRows(null);
    setSettingsError("");
  }

  function updateDraft(next: DraftField) {
    setDraft(next);
    if (editing == null) return;
    onChange(fields.map((field, index) => (index === editing ? next : field)));
  }

  function writeChoiceRows(rows: ChoiceRow[]) {
    setChoiceRows(rows);
    if (!draft) return;
    updateDraft({
      ...draft,
      options: rows
        .map((row) => row.label.replaceAll("|", ""))
        .filter((label) => label.trim())
        .join("|"),
    });
  }

  function buildClauseFields(list: ClauseStatement[], source: DraftField[]): DraftField[] | null {
    const cleaned = list.map((statement) => ({
      ...statement,
      label: statement.label.slice(0, CLAUSE_LABEL_MAX),
    }));
    const existing = new Map(source.filter((field) => field.type === "clause").map((field) => [field.id, field]));
    const kept = new Set(cleaned.map((statement) => statement.id));
    const queue = cleaned.map((statement) => {
      const prior = existing.get(statement.id);
      if (prior) {
        return { ...prior, label: statement.label, required: statement.required, section: "agreement", type: "clause" };
      }
      const row = blankField("clause", source.length);
      return { ...row, id: statement.id, label: statement.label, required: statement.required, section: "agreement" };
    });
    const next: DraftField[] = [];
    let placed = 0;
    for (const field of source) {
      if (kept.has(field.id) && field.type !== "clause") continue;
      if (field.type !== "clause") {
        next.push(field);
        continue;
      }
      if (!kept.has(field.id)) continue;
      const row = queue[placed];
      if (!row) continue;
      next.push(row);
      placed += 1;
    }
    if (placed < queue.length) {
      let insertAt = next.length;
      for (let index = next.length - 1; index >= 0; index -= 1) {
        if (next[index]?.type === "clause") {
          insertAt = index + 1;
          break;
        }
      }
      if (!next.some((field) => field.type === "clause") && editing != null) insertAt = Math.min(editing, next.length);
      next.splice(insertAt, 0, ...queue.slice(placed));
    }
    if (next.length > MAX_WAIVER_FIELDS) return null;
    return next;
  }

  function commitClauseList(list: ClauseStatement[]) {
    if (!draft) return;
    const source = fieldsRef.current;
    const persisted = list.filter(
      (statement) => statement.label.trim() || source.some((field) => field.id === statement.id && field.type === "clause")
    );
    const next = buildClauseFields(persisted, source);
    if (!next) {
      setSettingsError(`A form can have at most ${MAX_WAIVER_FIELDS} fields.`);
      return;
    }
    setSettingsError("");
    setClauseStatements(list);
    const saved = normalizeSharedRows(next);
    fieldsRef.current = saved;
    onChangeRef.current(saved);
    const focusId = list.some((statement) => statement.id === draft.id) ? draft.id : list[0]?.id;
    if (!focusId) return;
    const index = next.findIndex((field) => field.id === focusId);
    const row = next[index];
    if (!row || index < 0) return;
    setEditing(index);
    setDraft({ ...row });
  }

  function updateClauseStatement(id: string, patch: Partial<ClauseStatement>) {
    const list = (clauseStatements ?? []).map((statement) => (statement.id === id ? { ...statement, ...patch } : statement));
    commitClauseList(list);
  }

  function addClauseStatement() {
    if (editing == null || !draft) return;
    const list = clauseStatements ?? statementsFor(editing, draft);
    const pending = list.filter((statement) => !fields.some((field) => field.id === statement.id)).length;
    if (fields.length + pending >= MAX_WAIVER_FIELDS) {
      setSettingsError(`A form can have at most ${MAX_WAIVER_FIELDS} fields.`);
      return;
    }
    let id = "";
    do {
      id = `clause_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`.slice(0, 40);
    } while (fields.some((field) => field.id === id) || list.some((statement) => statement.id === id));
    setSettingsError("");
    setOpenStatementId(id);
    commitClauseList([...list, { id, label: "", required: true }]);
  }

  function moveClauseStatement(fromId: string, toId: string) {
    if (!fromId || fromId === toId || !clauseStatements) return;
    const from = clauseStatements.findIndex((row) => row.id === fromId);
    const to = clauseStatements.findIndex((row) => row.id === toId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...clauseStatements];
    const [row] = next.splice(from, 1);
    if (!row) return;
    next.splice(to, 0, row);
    commitClauseList(next);
  }

  function applyClauseStatements(): boolean {
    if (editing == null || !draft || !clauseStatements) return false;
    const cleaned = clauseStatements.map((statement) => ({
      ...statement,
      label: statement.label.trim().slice(0, CLAUSE_LABEL_MAX),
    }));
    if (cleaned.length === 0 || cleaned.some((statement) => !statement.label)) {
      setSettingsError("Write what the guest should see on every statement.");
      return false;
    }
    const next = buildClauseFields(cleaned, fieldsRef.current);
    if (!next) {
      setSettingsError(`A form can have at most ${MAX_WAIVER_FIELDS} fields.`);
      return false;
    }
    onChange(normalizeSharedRows(next));
    closeSettings(false);
    return true;
  }

  function applySettings(): boolean {
    if (editing == null || !draft || editing < 0 || editing >= fields.length) return false;
    if (draft.type === "clause" && clauseStatements) {
      return applyClauseStatements();
    }
    const label = draft.label.trim().slice(0, fieldLabelLimit(draft.type));
    if (!label) {
      setSettingsError("Write the words the guest should see.");
      return false;
    }
    const keepsChoices = draft.type === "select" || draft.type === "checkbox" || draft.type === "radio";
    const choices = keepsChoices
      ? (choiceRows ?? rowsForChoice(draft) ?? []).map((row) => row.label.replaceAll("|", "").trim()).filter(Boolean)
      : [];
    if ((draft.type === "select" || draft.type === "radio") && choices.length === 0) {
      setSettingsError("Add at least one choice. Otherwise the guest has nothing to pick.");
      return false;
    }
    if (new Set(choices.map((choice) => choice.toLowerCase())).size !== choices.length) {
      setSettingsError("Each choice must be different.");
      return false;
    }
    if (choices.length > 30) {
      setSettingsError("Use at most 30 choices. Remove the extra lines, then apply.");
      return false;
    }
    if (choices.some((choice) => choice.length > 120)) {
      setSettingsError("Each choice must be 120 characters or fewer.");
      return false;
    }
    const options =
      draft.type === "slider" || draft.type === "rating"
        ? normalizeFieldOptions(draft.type, choiceLines(draft.options)).join("|")
        : choices.join("|");
    const allowed = allowedMapsTo(draft.type);
    const mapsTo = allowed.includes(draft.mapsTo) ? draft.mapsTo : "";
    if (mapsTo && fields.some((field, index) => index !== editing && field.mapsTo === mapsTo)) {
      setSettingsError(
        `Another question is already saved as ${MAPS_TO_LABELS[mapsTo] ?? "that answer"}. Pick a different one, or leave it as just a question.`
      );
      return false;
    }
    const next: DraftField = {
      ...draft,
      label,
      help: draft.help.trim().slice(0, 300),
      options,
      section: draft.type === "clause" ? "agreement" : draft.section === "agreement" ? "guest" : draft.section,
      mapsTo,
    };
    onChange(normalizeSharedRows(fields.map((field, index) => (index === editing ? next : field))));
    closeSettings(false);
    return true;
  }

  function shiftQuestion(direction: -1 | 1) {
    if (editing == null) return;
    const target = editing + direction;
    if (target < 0 || target >= fields.length) return;
    const snapshot = clauseSnapshot.current;
    if (snapshot && editing < snapshot.length && target < snapshot.length) {
      const copy = snapshot.map((field) => ({ ...field }));
      const [row] = copy.splice(editing, 1);
      if (row) {
        row.row = "";
        copy.splice(target, 0, row);
        clauseSnapshot.current = normalizeSharedRows(copy);
      }
    }
    moveField(editing, target);
    setEditing(target);
  }

  useEffect(() => {
    if (editing == null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      revertRef.current();
      snapshotRef.current = null;
      setEditing(null);
      setDraft(null);
      setClauseStatements(null);
      setOpenStatementId(null);
      setChoiceRows(null);
      setSettingsError("");
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [editing]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setPickerOpen(false);
      setPicked([]);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [pickerOpen]);

  const stepBreaks = fields
    .map((field, index) => ({ field, index }))
    .filter((row) => row.field.type === "page_break");
  const lastBreakIndex = stepBreaks.length ? stepBreaks[stepBreaks.length - 1].index : -1;

  return (
    <div>
      <div className="mb-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-400">Step names</p>
        {stepBreaks.length ? (
          <div className="divide-y divide-stone-200 overflow-hidden rounded-lg border border-stone-200 bg-white">
            {stepBreaks.map(({ field, index }, breakIndex) => {
              const last = breakIndex === stepBreaks.length - 1;
              return (
                <label key={field.id} className="flex items-center gap-3 px-3">
                  <span className="w-4 shrink-0 text-xs tabular-nums text-stone-400">{breakIndex + 1}</span>
                  <input
                    className="w-full border-0 bg-transparent py-2.5 text-sm text-stone-900 outline-none placeholder:text-stone-400"
                    maxLength={fieldLabelLimit("page_break")}
                    placeholder={last ? "Submit" : "Step name"}
                    aria-label={`Step ${breakIndex + 1} name`}
                    value={field.label}
                    onChange={(event) => {
                      const next = event.target.value;
                      renameField(index, next.trim() ? next : last ? "Submit" : "Page Break");
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                  />
                </label>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-stone-500">One step. Add a page break when you want another.</p>
        )}
      </div>
      <div
        ref={listRef}
        className="min-h-40 rounded-lg border border-dashed border-stone-300 bg-stone-50/60 p-2 sm:p-3"
        onDragOver={onListDragOver}
        onDrop={onListDrop}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node)) return;
          setOverIndex(null);
        }}
      >
        <button
          type="button"
          className="mb-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-stone-300 bg-white px-4 py-4 text-sm font-medium tracking-wide text-stone-600 hover:border-[#D4AF37] hover:text-stone-900 disabled:opacity-50"
          disabled={disabled || fields.length >= MAX_WAIVER_FIELDS}
          onClick={openPicker}
        >
          <Plus className="h-4 w-4" />
          Insert form fields
        </button>
        {fields.length === 0 ? (
          <p className="px-2 py-4 text-center text-sm text-stone-500">
            No questions yet. The guest will see them in this order.
          </p>
        ) : (
          <p className="mb-2 px-1 text-xs text-stone-500">
            Drag a question sideways onto another and they share that row evenly, up to three across. On a phone they stack one under another. Drag above or below to stack them on every screen. The gold space shows where it will land.
          </p>
        )}
        <div className="grid gap-2">
          {groupFieldIndexes(fields).map((indexes) => {
            const draggedLabel = fields[rowDrag?.from ?? -1]?.label || "question";
            const beside =
              rowDrag != null &&
              rowDrag.side !== "before" &&
              indexes.includes(rowDrag.over) &&
              rowDrag.over !== rowDrag.from;
            const columns = indexes.length + (beside ? 1 : 0);
            const gridClass =
              columns >= 3
                ? "grid grid-cols-1 items-stretch gap-2 sm:grid-cols-3"
                : columns === 2
                  ? "grid grid-cols-1 items-stretch gap-2 sm:grid-cols-2"
                  : "grid gap-2";
            return (
              <div key={indexes.map((index) => fields[index]?.id ?? index).join("-")} className={gridClass}>
                {indexes.map((index) => {
                  const field = fields[index];
                  const moving = rowDrag?.from === index;
                  const placeBefore =
                    rowDrag != null &&
                    rowDrag.side === "before" &&
                    rowDrag.over === index &&
                    (rowDrag.from < rowDrag.over ? rowDrag.over - 1 : rowDrag.over) !== rowDrag.from;
                  const placeLeft = beside && rowDrag.side === "left" && rowDrag.over === index;
                  const placeRight = beside && rowDrag.side === "right" && rowDrag.over === index;
                  const stepNumber = stepBreaks.findIndex((row) => row.index === index) + 1;
                  const isLastStep = index === lastBreakIndex;
                  return (
                    <Fragment key={field.id}>
                      {placeBefore ? (
                        <div className="col-span-full flex h-14 items-center rounded-lg border-2 border-dashed border-[#D4AF37] bg-[#D4AF37]/15 px-3 text-sm font-medium text-stone-700 transition-all duration-200 ease-out motion-reduce:transition-none">
                          Place {draggedLabel} here
                        </div>
                      ) : null}
                      {placeLeft ? (
                        <div className="flex min-h-16 items-center justify-center rounded-lg border-2 border-dashed border-[#D4AF37] bg-[#D4AF37]/15 px-2 text-center text-xs font-medium text-stone-700">
                          Place {draggedLabel} here
                        </div>
                      ) : null}
                      {field.type === "page_break" ? (
                        <div
                          data-field-row
                          className={`col-span-full flex items-center gap-2 px-1 py-1 ${moving ? "opacity-40" : ""}`}
                        >
                          <button
                            type="button"
                            aria-label={`Move page break ${stepNumber}`}
                            className="cursor-grab touch-none rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700 active:cursor-grabbing"
                            onPointerDown={(event) => beginRowDrag(index, event)}
                          >
                            <GripVertical className="h-4 w-4" />
                          </button>
                          <span className="h-0 w-6 shrink-0 border-t-4 border-dashed border-[#D4AF37]" />
                          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-[#8A7020]">
                            Page break
                          </span>
                          <span className="min-w-0 truncate text-sm text-stone-700">
                            {field.label.trim() || (isLastStep ? "Submit" : `Step ${stepNumber}`)}
                          </span>
                          <span className="h-0 min-w-8 flex-1 border-t-4 border-dashed border-[#D4AF37]" />
                          <button
                            type="button"
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                            aria-label={`Settings for page break ${stepNumber}`}
                            disabled={disabled}
                            onClick={() => openSettings(index)}
                          >
                            <Settings className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                      <div
                        data-field-row
                        className={`flex min-w-0 items-center gap-2 rounded-lg border border-stone-200 bg-white px-2 py-3 shadow-sm transition-shadow duration-200 sm:gap-3 sm:px-3 motion-reduce:transition-none ${
                          moving ? "border-dashed border-[#D4AF37] opacity-40 shadow-none" : ""
                        } ${
                          !moving && overIndex === index
                            ? "shadow-[inset_0_3px_0_0_#D4AF37]"
                            : !moving && overIndex === fields.length && index === fields.length - 1
                              ? "shadow-[inset_0_-3px_0_0_#D4AF37]"
                              : ""
                        }`}
                      >
                        <button
                          type="button"
                          aria-label={`Move ${field.label || "question"}`}
                          className="cursor-grab touch-none rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700 active:cursor-grabbing"
                          onPointerDown={(event) => beginRowDrag(index, event)}
                        >
                          <GripVertical className="h-4 w-4" />
                        </button>
                        <FieldIcon type={field.type} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-stone-900">
                            {field.label || "Untitled question"}
                            {field.required ? <span className="text-red-600"> *</span> : null}
                          </p>
                          <p className="truncate text-xs text-stone-500">{describeDraftField(field)}</p>
                        </div>
                        <button
                          type="button"
                          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100 hover:text-stone-800"
                          aria-label={`Settings for ${field.label || "question"}`}
                          disabled={disabled}
                          onClick={() => openSettings(index)}
                        >
                          <Settings className="h-4 w-4" />
                        </button>
                      </div>
                      )}
                      {placeRight ? (
                        <div className="flex min-h-16 items-center justify-center rounded-lg border-2 border-dashed border-[#D4AF37] bg-[#D4AF37]/15 px-2 text-center text-xs font-medium text-stone-700">
                          Place {draggedLabel} here
                        </div>
                      ) : null}
                    </Fragment>
                  );
                })}
              </div>
            );
          })}
          {rowDrag &&
          rowDrag.side === "before" &&
          rowDrag.over === fields.length &&
          (rowDrag.from < rowDrag.over ? rowDrag.over - 1 : rowDrag.over) !== rowDrag.from ? (
            <div className="flex h-14 items-center rounded-lg border-2 border-dashed border-[#D4AF37] bg-[#D4AF37]/15 px-3 text-sm font-medium text-stone-700">
              Place {fields[rowDrag.from]?.label || "question"} here
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-stone-300 bg-white px-4 py-4 text-sm font-medium tracking-wide text-stone-600 hover:border-[#D4AF37] hover:text-stone-900 disabled:opacity-50"
          disabled={disabled || fields.length >= MAX_WAIVER_FIELDS}
          onClick={openPicker}
        >
          <Plus className="h-4 w-4" />
          Insert form fields
        </button>
      </div>

      {rowDrag && fields[rowDrag.from] && typeof document !== "undefined"
        ? createPortal(
            <div
              className={`pointer-events-none fixed z-[80] flex items-center gap-2 px-2 py-3 shadow-2xl sm:gap-3 sm:px-3 ${
                fields[rowDrag.from].type === "page_break"
                  ? "rounded-md bg-stone-800 text-white"
                  : "rounded-lg border border-stone-200 border-l-4 border-l-[#D4AF37] bg-white"
              }`}
              style={{ left: rowDrag.x, top: rowDrag.y, width: rowDrag.width }}
            >
              <GripVertical className={`h-4 w-4 ${fields[rowDrag.from].type === "page_break" ? "text-white/70" : "text-stone-400"}`} />
              {fields[rowDrag.from].type === "page_break" ? (
                <p className="min-w-0 flex-1 truncate text-sm text-white/90">
                  Page break · {fields[rowDrag.from].label || "Step"}
                </p>
              ) : (
                <>
                  <FieldIcon type={fields[rowDrag.from].type} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-stone-900">
                      {fields[rowDrag.from].label || "Untitled question"}
                      {fields[rowDrag.from].required ? <span className="text-red-600"> *</span> : null}
                    </p>
                    <p className="truncate text-xs text-stone-500">{describeDraftField(fields[rowDrag.from])}</p>
                  </div>
                </>
              )}
              <Settings className={`h-4 w-4 ${fields[rowDrag.from].type === "page_break" ? "text-white/70" : "text-stone-400"}`} />
            </div>,
            document.body
          )
        : null}

      {pickerOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[60] flex items-end justify-center bg-stone-900/40 p-0 sm:items-center sm:p-4 lg:left-64"
              onClick={() => {
                setPickerOpen(false);
                setPicked([]);
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="waiver-insert-fields-title"
                className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-xl bg-white shadow-xl sm:rounded-xl"
                onClick={(event) => event.stopPropagation()}
              >
                <header className="flex items-start gap-3 border-b border-stone-200 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <h3 id="waiver-insert-fields-title" className="text-base font-semibold text-stone-900">
                      Insert form fields
                    </h3>
                    <p className="mt-1 text-sm text-stone-600">
                      Choose every question you want. They are added at the bottom, and you can reorder them after.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100"
                    aria-label="Close"
                    onClick={() => {
                      setPickerOpen(false);
                      setPicked([]);
                    }}
                  >
                    <X className="h-5 w-5" />
                  </button>
                </header>
                <div className="grid grid-cols-2 gap-2 overflow-y-auto px-4 py-4 sm:grid-cols-3 md:grid-cols-4">
                  {offeredTypes.map((type) => {
                    const onForm =
                      (type === "signature" || type === "photo_reader") &&
                      fields.some((field) => field.type === type);
                    const selected = picked.includes(type);
                    const full = !selected && fields.length + picked.length >= MAX_WAIVER_FIELDS;
                    return (
                      <button
                        key={type}
                        type="button"
                        disabled={onForm || full}
                        aria-pressed={selected}
                        onClick={() => togglePicked(type)}
                        className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-3 text-center text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
                          selected
                            ? "border-[#D4AF37] bg-[#D4AF37]/10 text-stone-900 ring-1 ring-[#D4AF37]"
                            : "border-stone-200 bg-white text-stone-800 hover:border-[#D4AF37]"
                        }`}
                      >
                        <FieldIcon type={type} />
                        <span>{TYPE_LABELS[type] ?? type}</span>
                        {onForm ? <span className="text-[10px] text-stone-500">Already on this form</span> : null}
                      </button>
                    );
                  })}
                </div>
                <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-200 px-4 py-3">
                  <p className="text-sm text-stone-600">
                    {picked.length === 0 ? "None selected" : `${picked.length} selected`}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-800"
                      onClick={() => {
                        setPickerOpen(false);
                        setPicked([]);
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="rounded-md bg-[#D4AF37] px-3 py-2 text-sm font-semibold text-stone-950 disabled:opacity-50"
                      disabled={picked.length === 0}
                      onClick={addPickedFields}
                    >
                      Add to form
                    </button>
                  </div>
                </footer>
              </div>
            </div>,
            document.body
          )
        : null}

      {editing != null && draft && typeof document !== "undefined"
        ? createPortal(
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-stone-900/40 p-0 sm:items-center sm:p-4 lg:left-64"
          onClick={() => {
            applySettings();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="waiver-field-settings-title"
            className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-xl bg-white shadow-xl sm:rounded-xl"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.target instanceof HTMLTextAreaElement) return;
              event.preventDefault();
              event.stopPropagation();
              applySettings();
            }}
          >
            <header className="flex items-center gap-3 border-b border-stone-200 px-4 py-3">
              <FieldIcon type={draft.type} />
              <h3 id="waiver-field-settings-title" className="min-w-0 flex-1 truncate text-base font-semibold text-stone-900">
                Question settings
              </h3>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100"
                aria-label="Close"
                onClick={() => {
                  applySettings();
                }}
              >
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="grid gap-4 overflow-y-auto px-4 py-4">
              {draft.type === "clause" && clauseStatements ? (
                <div className="grid gap-3">
                  <p className="text-sm text-stone-600">
                    Each option is a checkbox on the agreement. Start with a short title and a colon, such as SAFETY RULES: I confirm that I have read the rules.
                  </p>
                  {clauseStatements.map((statement, statementIndex) => {
                    const open = openStatementId === statement.id;
                    return (
                      <div
                        key={statement.id}
                        className="rounded-xl border border-stone-200 bg-white shadow-sm"
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          moveClauseStatement(event.dataTransfer.getData("text/plain"), statement.id);
                        }}
                      >
                        <div className="flex items-center gap-2 px-3 py-3">
                          <button
                            type="button"
                            draggable
                            aria-label={`Reorder option ${statementIndex + 1}`}
                            className="cursor-grab text-stone-400 active:cursor-grabbing"
                            onDragStart={(event) => {
                              event.dataTransfer.setData("text/plain", statement.id);
                              event.dataTransfer.effectAllowed = "move";
                            }}
                          >
                            <GripVertical className="h-4 w-4" />
                          </button>
                          <input
                            id={`clause-statement-${statement.id}`}
                            className={`${fieldClass} min-w-0 flex-1`}
                            maxLength={CLAUSE_LABEL_MAX}
                            placeholder={statementIndex === 0 ? "SAFETY RULES: I confirm that I have read the rules." : "LEGAL RIGHTS: By signing, I understand…"}
                            aria-label="What should the guest see?"
                            value={statement.label}
                            onChange={(event) => updateClauseStatement(statement.id, { label: event.target.value })}
                          />
                          <input
                            type="checkbox"
                            className="h-4 w-4 shrink-0 accent-[#D4AF37]"
                            checked={statement.required}
                            aria-label="The guest must tick this before they can sign."
                            title="The guest must tick this before they can sign."
                            onChange={(event) => updateClauseStatement(statement.id, { required: event.target.checked })}
                          />
                          <button
                            type="button"
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-red-500 hover:bg-red-50 disabled:opacity-30"
                            aria-label={`Remove option ${statementIndex + 1}`}
                            disabled={clauseStatements.length < 2}
                            onClick={() =>
                              commitClauseList(clauseStatements.filter((row) => row.id !== statement.id))
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100"
                            aria-label={open ? "Hide the full statement" : "Edit the full statement"}
                            aria-expanded={open}
                            onClick={() => setOpenStatementId(open ? null : statement.id)}
                          >
                            <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
                          </button>
                        </div>
                        {open ? (
                          <div className="border-t border-stone-200 px-3 py-3">
                            <label className="text-sm font-medium text-stone-800" htmlFor={`clause-statement-full-${statement.id}`}>
                              What should the guest see?
                              <textarea
                                id={`clause-statement-full-${statement.id}`}
                                className={`${fieldClass} mt-1 min-h-24`}
                                maxLength={CLAUSE_LABEL_MAX}
                                value={statement.label}
                                onChange={(event) => updateClauseStatement(statement.id, { label: event.target.value })}
                              />
                            </label>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-dashed border-stone-300 bg-stone-50 px-3 py-4 text-sm font-medium tracking-wide text-stone-500 hover:border-[#D4AF37] hover:text-stone-800"
                    onClick={addClauseStatement}
                  >
                    <Plus className="h-4 w-4" />
                    ADD OPTION
                  </button>
                </div>
              ) : (
              <label className="text-sm font-medium text-stone-800">
                {draft.type === "page_break" ? "Step name" : "What should the guest see?"}
                <input
                  className={`${fieldClass} mt-1`}
                  maxLength={200}
                  placeholder={draft.type === "page_break" ? "Name this step" : undefined}
                  value={draft.label}
                  onChange={(event) =>
                    updateDraft({
                      ...draft,
                      label:
                        draft.type === "page_break" && !event.target.value.trim()
                          ? editing === lastBreakIndex
                            ? "Submit"
                            : "Page Break"
                          : event.target.value,
                    })
                  }
                />
              </label>
              )}
              {draft.type === "clause" ? null : (
              <label className="text-sm font-medium text-stone-800">
                {draft.type === "hidden"
                  ? "Value saved with the form"
                  : draft.type === "html" || draft.type === "section"
                    ? "Text the guest reads"
                    : "Extra help, if they might be unsure"}
                <textarea
                  className={`${fieldClass} mt-1 min-h-20`}
                  maxLength={300}
                  placeholder={
                    draft.type === "hidden"
                      ? "This is stored with the answer. The guest does not see it."
                      : "Optional. Shown under the question."
                  }
                  value={draft.help}
                  onChange={(event) => updateDraft({ ...draft, help: event.target.value })}
                />
              </label>
              )}
              <label className="text-sm font-medium text-stone-800">
                What kind of answer is this?
                <select
                  className={`${fieldClass} mt-1`}
                  value={draft.type}
                  onChange={(event) => {
                    const type = event.target.value;
                    if (
                      (type === "signature" || type === "photo_reader") &&
                      fields.some((field, index) => field.type === type && index !== editing)
                    ) {
                      setSettingsError("This waiver already has that block. Remove the other one first.");
                      return;
                    }
                    const allowed = allowedMapsTo(type);
                    const auto = defaultMapsTo(type, fields, editing ?? -1);
                    const keepsChoices = type === "select" || type === "checkbox" || type === "radio";
                    const options = keepsChoices
                      ? draft.options
                      : type === "slider"
                        ? "0|100"
                        : type === "rating"
                        ? "5"
                        : "";
                    setSettingsError("");
                    const nextDraft = {
                      ...draft,
                      type,
                      mapsTo: allowed.includes(draft.mapsTo) ? draft.mapsTo : allowed.includes(auto) ? auto : "",
                      options,
                      required:
                        type === "photo_reader" ||
                        type === "page_break" ||
                        type === "section" ||
                        type === "html" ||
                        type === "hidden"
                          ? false
                          : type === "consent" || type === "clause"
                            ? true
                            : draft.required,
                      section: type === "clause" ? "agreement" : draft.section === "agreement" ? "guest" : draft.section,
                    };
                    if (type === "clause" && !clauseSnapshot.current) {
                      clauseSnapshot.current = fieldsRef.current.map((field) => ({ ...field }));
                    }
                    updateDraft(nextDraft);
                    if (type === "clause" && editing != null) setClauseStatements(statementsFor(editing, nextDraft));
                    else setClauseStatements(null);
                    setChoiceRows(rowsForChoice(nextDraft));
                  }}
                >
                  {offeredTypes.map((type) => (
                    <option key={type} value={type}>
                      {TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </label>
              {draft.type === "photo_reader" ||
              draft.type === "page_break" ||
              draft.type === "section" ||
              draft.type === "html" ||
              draft.type === "hidden" ||
              draft.type === "clause" ? null : (
              <label className="flex items-start gap-2 text-sm text-stone-800">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={draft.required}
                  onChange={(event) => updateDraft({ ...draft, required: event.target.checked })}
                />
                <span>
                  {draft.type === "signature"
                    ? "The guest must sign before they can finish. Uncheck this to let them skip the signature."
                    : "The guest must complete this before they can sign."}
                </span>
              </label>
              )}
              {isChoiceType(draft.type) && choiceRows ? (
                <div className="grid gap-3">
                  <p className="text-sm text-stone-600">
                    {draft.type === "checkbox"
                      ? "With no options, the guest sees one box to tick. Add options when they should tick one of several boxes."
                      : draft.type === "select"
                        ? "The guest opens a menu and picks one. Add every choice that should be in that menu."
                        : "The guest sees every choice on the page and picks one."}
                  </p>
                  {choiceRows.map((row, rowIndex) => (
                    <div
                      key={row.id}
                      className="flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-3 shadow-sm"
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        const fromId = event.dataTransfer.getData("text/plain");
                        if (!fromId || fromId === row.id) return;
                        const from = choiceRows.findIndex((item) => item.id === fromId);
                        const to = rowIndex;
                        if (from < 0 || from === to) return;
                        const next = [...choiceRows];
                        const [moved] = next.splice(from, 1);
                        next.splice(to, 0, moved);
                        writeChoiceRows(next);
                      }}
                    >
                      <button
                        type="button"
                        draggable
                        aria-label={`Reorder option ${rowIndex + 1}`}
                        className="cursor-grab text-stone-400 active:cursor-grabbing"
                        onDragStart={(event) => {
                          event.dataTransfer.setData("text/plain", row.id);
                          event.dataTransfer.effectAllowed = "move";
                        }}
                      >
                        <GripVertical className="h-4 w-4" />
                      </button>
                      <input
                        className={`${fieldClass} min-w-0 flex-1`}
                        maxLength={120}
                        placeholder={`Option ${rowIndex + 1}`}
                        aria-label={`Option ${rowIndex + 1}`}
                        value={row.label}
                        onChange={(event) => {
                          const next = choiceRows.map((item) =>
                            item.id === row.id ? { ...item, label: event.target.value.replaceAll("|", "") } : item
                          );
                          writeChoiceRows(next);
                        }}
                      />
                      <button
                        type="button"
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-red-500 hover:bg-red-50 disabled:opacity-30"
                        aria-label={`Remove option ${rowIndex + 1}`}
                        disabled={draft.type !== "checkbox" && choiceRows.length < 2}
                        onClick={() => writeChoiceRows(choiceRows.filter((item) => item.id !== row.id))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-dashed border-stone-300 bg-stone-50 px-3 py-4 text-sm font-medium tracking-wide text-stone-500 hover:border-[#D4AF37] hover:text-stone-800 disabled:opacity-40"
                    disabled={choiceRows.length >= 30}
                    onClick={() => {
                      if (choiceRows.length >= 30) {
                        setSettingsError("Use at most 30 choices.");
                        return;
                      }
                      setSettingsError("");
                      writeChoiceRows([...choiceRows, { id: newChoiceId(), label: "" }]);
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    ADD OPTION
                  </button>
                </div>
              ) : null}
              {draft.type === "slider" ? (
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-sm font-medium text-stone-800">
                    Lowest
                    <input
                      className={`${fieldClass} mt-1`}
                      inputMode="decimal"
                      value={draft.options.split("|")[0] ?? "0"}
                      onChange={(event) =>
                        updateDraft({
                          ...draft,
                          options: `${event.target.value}|${draft.options.split("|")[1] ?? "100"}`,
                        })
                      }
                    />
                  </label>
                  <label className="text-sm font-medium text-stone-800">
                    Highest
                    <input
                      className={`${fieldClass} mt-1`}
                      inputMode="decimal"
                      value={draft.options.split("|")[1] ?? "100"}
                      onChange={(event) =>
                        updateDraft({
                          ...draft,
                          options: `${draft.options.split("|")[0] ?? "0"}|${event.target.value}`,
                        })
                      }
                    />
                  </label>
                </div>
              ) : null}
              {draft.type === "rating" ? (
                <label className="text-sm font-medium text-stone-800">
                  Number of stars
                  <input
                    className={`${fieldClass} mt-1`}
                    inputMode="numeric"
                    value={draft.options || "5"}
                    onChange={(event) =>
                      updateDraft({ ...draft, options: event.target.value.replace(/\D/g, "").slice(0, 2) })
                    }
                  />
                </label>
              ) : null}
              {allowedMapsTo(draft.type).length > 0 ? (
                <label className="text-sm font-medium text-stone-800">
                  Save this answer as
                  <select
                    className={`${fieldClass} mt-1`}
                    value={allowedMapsTo(draft.type).includes(draft.mapsTo) ? draft.mapsTo : ""}
                    onChange={(event) => updateDraft({ ...draft, mapsTo: event.target.value })}
                  >
                    <option value="">Just a question on the form</option>
                    {allowedMapsTo(draft.type).map((key) => (
                      <option key={key} value={key}>
                        {MAPS_TO_LABELS[key] ?? key}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-xs font-normal text-stone-500">
                    Use this when the answer is the guest&apos;s name, email, phone, or address. Leave it as a question if it is only for this waiver.
                  </span>
                </label>
              ) : (
                <p className="text-sm text-stone-600">
                  {draft.type === "photo_reader"
                    ? "Guests can photograph an ID or a printed form, or type the answers. Remove this block to turn the photo reader off."
                    : draft.type === "signature"
                      ? "Guests type their legal name and draw a signature. Remove this block to turn the e-signature off. Uncheck required if they may skip it."
                      : draft.type === "page_break"
                        ? "Questions above this break stay on the current step. Questions below it start the next step. Rename this break to name that next step. The photo reader and e-signature stay where you place them."
                        : draft.type === "section"
                          ? "This is a heading for the questions that follow. It is not an answer."
                          : draft.type === "html"
                            ? "This note is shown to the guest. It is not an answer."
                            : draft.type === "hidden"
                              ? "The guest does not see this. The value above is saved with their form."
                              : draft.type === "consent"
                                  ? "The guest must tick this before they can continue, when it is required."
                      : draft.type === "clause"
                        ? "The guest ticks this themselves. It is not filled in from a photo."
                        : "This answer stays on the waiver. It is not saved as the guest's name, email, or phone."}
                </p>
              )}
              {settingsError ? <p className="text-sm text-red-700">{settingsError}</p> : null}
            </div>
            <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-200 px-4 py-3">
              <button
                type="button"
                className="text-sm text-red-700 underline"
                onClick={() => {
                  onChange(normalizeSharedRows(fields.filter((_, index) => index !== editing)));
                  closeSettings(false);
                }}
              >
                Remove this question
              </button>
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  className="rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-800 disabled:opacity-40"
                  disabled={editing === 0}
                  onClick={() => shiftQuestion(-1)}
                >
                  Move up
                </button>
                <button
                  type="button"
                  className="rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-800 disabled:opacity-40"
                  disabled={editing >= fields.length - 1}
                  onClick={() => shiftQuestion(1)}
                >
                  Move down
                </button>
                <button
                  type="button"
                  className="rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-800"
                  onClick={() => closeSettings()}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded-md bg-[#D4AF37] px-3 py-2 text-sm font-semibold text-stone-950 disabled:opacity-50"
                  disabled={
                    draft.type === "clause"
                      ? !clauseStatements?.length || clauseStatements.some((statement) => !statement.label.trim())
                      : !draft.label.trim()
                  }
                  onClick={applySettings}
                >
                  Apply
                </button>
              </div>
            </footer>
          </div>
        </div>,
        document.body
        )
        : null}
    </div>
  );
}
