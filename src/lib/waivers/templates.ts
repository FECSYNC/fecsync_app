import { Prisma, type WaiverDocumentKind, type WaiverExpiryRule, type WaiverTemplateStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { ForbiddenError } from "@/lib/auth/http-error";
import { isValidId, requireId } from "@/lib/ids";
import { logActivityEntryAsync } from "@/lib/audit/activityLog";
import { detachTemplateFromKiosks } from "@/lib/waivers/kiosk";
import { sanitizeWaiverHtml } from "@/lib/waivers/sanitizeHtml";
import { waiverContentSha256 } from "@/lib/waivers/contentHash";
import {
  MAX_FIELD_HELP,
  MAX_WAIVER_FIELDS,
  canShareFieldRow,
  cleanFieldRowKey,
  fieldLabelLimit,
  fieldMapsToGuest,
  isFieldType,
  isMapsTo,
  normalizeFieldOptions,
  normalizeSharedRows,
  parseDisplayMode,
  storedFieldRequired,
  parseDocumentExtractFlag,
  parseLayoutId,
  parseSignatureOverride,
  type WaiverDisplayMode,
  type WaiverLayoutId,
} from "@/lib/waivers/presentation";
import {
  assertLocationInWaiverScope,
  assertMutableWaiverLocation,
  assertWaiversStaff,
  rethrowUniqueConflict,
  rejectClientOrgFields,
  requireActorVenueInScope,
  slugifyWaiverName,
  waiverListLocationWhere,
  DOCUMENT_KINDS,
  FORM_KINDS,
  type WaiversActor,
} from "@/lib/waivers/common";

const ALL_KINDS = new Set<string>([...DOCUMENT_KINDS, ...FORM_KINDS]);

export type WaiverLocaleInput = {
  locale: string;
  title: string;
  bodyHtml: string;
  /** null clears fields. undefined means this locale did not send fieldsJson. */
  fieldsJson?: Prisma.InputJsonValue | null;
  fieldsProvided?: boolean;
  layoutId?: WaiverLayoutId;
  displayMode?: WaiverDisplayMode;
  allowDocumentExtract?: boolean;
};

export type WaiverTemplateDto = {
  id: string;
  orgId: string;
  locationId: string | null;
  kind: WaiverDocumentKind;
  name: string;
  slug: string;
  status: WaiverTemplateStatus;
  currentPublishedVersionId: string | null;
  requireResignOnPublish: boolean;
  defaultExpiryRule: WaiverExpiryRule | null;
  defaultExpiryDays: number | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  draftVersionId: string | null;
  publishedVersion: number | null;
};

export type WaiverVersionDto = {
  id: string;
  version: number;
  status: WaiverTemplateStatus;
  localeDefault: string;
  title: string;
  bodyHtml: string;
  fieldsJson: unknown;
  layoutId: string;
  displayMode: string;
  allowDocumentExtract: boolean;
  allowTypedSignature: boolean | null;
  allowDrawnSignature: boolean | null;
  contentSha256: string;
  publishedAt: string | null;
  publishedByName?: string | null;
  createdAt: string;
  locales: {
    id: string;
    locale: string;
    title: string;
    bodyHtml: string;
    fieldsJson: unknown;
    layoutId: string;
    displayMode: string;
    allowDocumentExtract: boolean;
  }[];
};

function parseLocale(raw: string): string {
  const locale = raw.trim().toLowerCase();
  if (!/^[a-z]{2}(-[a-z]{2})?$/.test(locale)) {
    throw new Error("locale must look like en or es");
  }
  return locale;
}

function parseFields(raw: unknown): Prisma.InputJsonValue | null {
  if (raw == null) return null;
  if (!Array.isArray(raw)) throw new Error("fieldsJson must be an array or null");
  if (raw.length > MAX_WAIVER_FIELDS) {
    throw new Error(`A form can have at most ${MAX_WAIVER_FIELDS} fields`);
  }
  const seenIds = new Set<string>();
  const seenMapsTo = new Set<string>();
  const cleaned = raw.map((field, index) => {
    if (!field || typeof field !== "object") {
      throw new Error(`Field ${index + 1} is invalid`);
    }
    const f = field as Record<string, unknown>;
    const id = typeof f.id === "string" ? f.id.trim() : "";
    const label = typeof f.label === "string" ? f.label.trim() : "";
    const type = typeof f.type === "string" ? f.type.trim() : "text";
    if (type === "currency" || type === "calculation") return null;
    if (!id || id.length > 40 || !label) {
      throw new Error(`Field ${index + 1} needs an id and label`);
    }
    const labelLimit = fieldLabelLimit(type);
    if (label.length > labelLimit) {
      throw new Error(`Field ${index + 1} label is longer than ${labelLimit} characters`);
    }
    if (seenIds.has(id)) throw new Error(`Field id ${id} is duplicated`);
    seenIds.add(id);
    if (!isFieldType(type)) throw new Error(`Field type ${type} is not supported`);
    let options = Array.isArray(f.options)
      ? f.options
          .filter((o) => typeof o === "string")
          .map((o) => o.slice(0, 120))
          .slice(0, 30)
      : [];
    if ((type === "select" || type === "radio") && options.length === 0) {
      throw new Error(`Field ${index + 1} needs at least one choice`);
    }
    if (type === "select" || type === "radio" || type === "checkbox") {
      const seenChoices = new Set<string>();
      for (const option of options) {
        const key = option.trim().toLowerCase();
        if (!key) continue;
        if (seenChoices.has(key)) throw new Error(`Field ${index + 1} has a repeated choice`);
        seenChoices.add(key);
      }
    }
    options = normalizeFieldOptions(type, options);
    const sectionRaw = typeof f.section === "string" ? f.section.trim() : "";
    if (sectionRaw.length > 80) throw new Error(`Field ${index + 1} section is too long`);
    const section = sectionRaw || (type === "clause" ? "agreement" : "guest");
    let help = "";
    if (f.help != null && f.help !== "") {
      if (typeof f.help !== "string") throw new Error(`Field ${index + 1} help must be text`);
      help = f.help.trim();
      if (help.length > MAX_FIELD_HELP) {
        throw new Error(`Field ${index + 1} help is longer than ${MAX_FIELD_HELP} characters`);
      }
    }
    let mapsTo = "";
    if (f.mapsTo != null && f.mapsTo !== "") {
      if (typeof f.mapsTo !== "string" || !isMapsTo(f.mapsTo.trim())) {
        throw new Error(`Field ${index + 1} mapsTo is not supported`);
      }
      mapsTo = f.mapsTo.trim();
    }
    if (!fieldMapsToGuest(type) && mapsTo) {
      throw new Error(`Field ${index + 1} cannot map to guest data`);
    }
    if (mapsTo) {
      if (seenMapsTo.has(mapsTo)) {
        throw new Error(`Field ${index + 1} saves the same guest detail as another question`);
      }
      seenMapsTo.add(mapsTo);
    }
    const row: Record<string, unknown> = {
      id,
      type,
      label,
      required: storedFieldRequired(type, f.required === true),
      options,
      section,
    };
    if (help) row.help = help;
    if (mapsTo) row.mapsTo = mapsTo;
    const rowKey = canShareFieldRow(type) ? cleanFieldRowKey(f.row) : "";
    if (rowKey) row.row = rowKey;
    return row;
  }).filter((row) => row != null);
  const shared = normalizeSharedRows(
    cleaned.map((field) => ({
      ...field,
      type: String(field.type ?? ""),
      row: typeof field.row === "string" ? field.row : "",
    }))
  ).map((field) => {
    if (!field.row) {
      const { row: _unused, ...rest } = field;
      return rest;
    }
    return field;
  });
  return shared as unknown as Prisma.InputJsonValue;
}

function toTemplateDto(
  row: {
    id: string;
    orgId: string;
    locationId: string | null;
    kind: WaiverDocumentKind;
    name: string;
    slug: string;
    status: WaiverTemplateStatus;
    currentPublishedVersionId: string | null;
    requireResignOnPublish: boolean;
    defaultExpiryRule: WaiverExpiryRule | null;
    defaultExpiryDays: number | null;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    versions?: { id: string; status: WaiverTemplateStatus; version: number }[];
  }
): WaiverTemplateDto {
  const draft = row.versions?.find((v) => v.status === "draft") ?? null;
  const published =
    (row.currentPublishedVersionId
      ? row.versions?.find((v) => v.id === row.currentPublishedVersionId)
      : null) ??
    row.versions?.find((v) => v.status === "published") ??
    null;
  return {
    id: row.id,
    orgId: row.orgId,
    locationId: row.locationId,
    kind: row.kind,
    name: row.name,
    slug: row.slug,
    status: row.status,
    currentPublishedVersionId: row.currentPublishedVersionId,
    requireResignOnPublish: row.requireResignOnPublish,
    defaultExpiryRule: row.defaultExpiryRule,
    defaultExpiryDays: row.defaultExpiryDays,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    draftVersionId: draft?.id ?? null,
    publishedVersion: published?.version ?? null,
  };
}

async function uniqueSlug(orgId: string, name: string): Promise<string> {
  const base = slugifyWaiverName(name);
  for (let i = 0; i < 20; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const hit = await prisma.waiverTemplate.findFirst({
      where: { orgId, slug },
      select: { id: true },
    });
    if (!hit) return slug;
  }
  throw new Error("Could not allocate a unique slug");
}

export async function requireTemplate(
  actor: WaiversActor,
  templateId: string
) {
  const orgId = await assertWaiversStaff(actor);
  const id = requireId(templateId, "templateId");
  const row = await prisma.waiverTemplate.findFirst({
    where: { id, orgId },
  });
  if (!row) throw new ForbiddenError("Waiver template not found");
  await assertLocationInWaiverScope(actor, row.locationId);
  return row;
}

export async function listWaiverTemplates(
  actor: WaiversActor,
  opts?: { kinds?: WaiverDocumentKind[] }
): Promise<WaiverTemplateDto[]> {
  const orgId = await assertWaiversStaff(actor);
  const loc = await waiverListLocationWhere(actor);
  const rows = await prisma.waiverTemplate.findMany({
    where: {
      orgId,
      ...loc,
      ...(opts?.kinds?.length ? { kind: { in: opts.kinds } } : {}),
    },
    include: {
      versions: {
        select: { id: true, status: true, version: true },
        orderBy: { version: "desc" },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(toTemplateDto);
}

type PresentationDraft = {
  layoutId: WaiverLayoutId;
  displayMode: WaiverDisplayMode;
  allowDocumentExtract: boolean;
  allowTypedSignature: boolean | null;
  allowDrawnSignature: boolean | null;
};

type IncomingPresentation = {
  layoutId?: WaiverLayoutId;
  displayMode?: WaiverDisplayMode;
  allowDocumentExtract?: boolean;
  typedProvided: boolean;
  drawnProvided: boolean;
  allowTypedSignature?: boolean | null;
  allowDrawnSignature?: boolean | null;
};

type DraftBody = {
  title: string;
  bodyHtml: string;
  localeDefault: string;
  fieldsProvided: boolean;
  fieldsJson: Prisma.InputJsonValue | null;
  locales: WaiverLocaleInput[];
  presentation: PresentationDraft;
  incomingPresentation: IncomingPresentation;
};

type StoredPresentation = {
  layoutId?: string | null;
  displayMode?: string | null;
  allowDocumentExtract?: boolean | null;
  allowTypedSignature?: boolean | null;
  allowDrawnSignature?: boolean | null;
};

function hasOwn(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function readIncomingPresentation(body: Record<string, unknown>): IncomingPresentation {
  return {
    layoutId: hasOwn(body, "layoutId") ? parseLayoutId(body.layoutId) : undefined,
    displayMode: hasOwn(body, "displayMode") ? parseDisplayMode(body.displayMode) : undefined,
    allowDocumentExtract: hasOwn(body, "allowDocumentExtract")
      ? parseDocumentExtractFlag(body.allowDocumentExtract)
      : undefined,
    typedProvided: hasOwn(body, "allowTypedSignature"),
    drawnProvided: hasOwn(body, "allowDrawnSignature"),
    allowTypedSignature: hasOwn(body, "allowTypedSignature")
      ? parseSignatureOverride(body.allowTypedSignature, "allowTypedSignature")
      : undefined,
    allowDrawnSignature: hasOwn(body, "allowDrawnSignature")
      ? parseSignatureOverride(body.allowDrawnSignature, "allowDrawnSignature")
      : undefined,
  };
}

function resolvePresentation(
  incoming: IncomingPresentation,
  existing: StoredPresentation | null
): PresentationDraft {
  const layoutId = incoming.layoutId ?? parseLayoutId(existing?.layoutId || "classic");
  const displayMode =
    incoming.displayMode ??
    (existing?.displayMode ? parseDisplayMode(existing.displayMode) : "single_page");
  return {
    layoutId,
    displayMode,
    allowDocumentExtract:
      incoming.allowDocumentExtract ?? existing?.allowDocumentExtract ?? false,
    allowTypedSignature: incoming.typedProvided
      ? (incoming.allowTypedSignature ?? null)
      : (existing?.allowTypedSignature ?? null),
    allowDrawnSignature: incoming.drawnProvided
      ? (incoming.allowDrawnSignature ?? null)
      : (existing?.allowDrawnSignature ?? null),
  };
}

function storedFields(
  value: Prisma.InputJsonValue | null | undefined
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value == null) return Prisma.DbNull;
  return value;
}

function jsonOrNull(value: unknown): Prisma.InputJsonValue | null {
  if (value == null) return null;
  return value as Prisma.InputJsonValue;
}

function readDraft(body: Record<string, unknown>, fallbackTitle: string): DraftBody {
  const title =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim().slice(0, 200)
      : fallbackTitle;
  const bodyHtml = sanitizeWaiverHtml(
    typeof body.bodyHtml === "string" ? body.bodyHtml : ""
  );
  if (!bodyHtml) throw new Error("Agreement text is required");
  if (bodyHtml.length > 100_000) throw new Error("Agreement text is too long");
  const localeDefault = parseLocale(
    typeof body.localeDefault === "string" ? body.localeDefault : "en"
  );
  const fieldsProvided = Object.prototype.hasOwnProperty.call(body, "fieldsJson");
  const fieldsJson = fieldsProvided ? parseFields(body.fieldsJson) : null;
  const localesRaw = Array.isArray(body.locales) ? body.locales : [];
  const locales: WaiverLocaleInput[] = localesRaw.map((row) => {
    if (!row || typeof row !== "object") throw new Error("Invalid locale row");
    const r = row as Record<string, unknown>;
    const localeFieldsProvided = Object.prototype.hasOwnProperty.call(r, "fieldsJson");
    return {
      locale: parseLocale(String(r.locale ?? "")),
      title:
        typeof r.title === "string" && r.title.trim()
          ? r.title.trim().slice(0, 200)
          : title,
      bodyHtml: sanitizeWaiverHtml(typeof r.bodyHtml === "string" ? r.bodyHtml : ""),
      fieldsJson: localeFieldsProvided ? parseFields(r.fieldsJson) : undefined,
      fieldsProvided: localeFieldsProvided,
      layoutId: hasOwn(r, "layoutId") ? parseLayoutId(r.layoutId) : undefined,
      displayMode: hasOwn(r, "displayMode") ? parseDisplayMode(r.displayMode) : undefined,
      allowDocumentExtract: hasOwn(r, "allowDocumentExtract")
        ? parseDocumentExtractFlag(r.allowDocumentExtract)
        : undefined,
    };
  });
  for (const loc of locales) {
    if (!loc.bodyHtml) throw new Error(`Locale ${loc.locale} needs agreement text`);
  }
  const incomingPresentation = readIncomingPresentation(body);
  return {
    title,
    bodyHtml,
    localeDefault,
    fieldsProvided,
    fieldsJson,
    locales,
    incomingPresentation,
    presentation: resolvePresentation(incomingPresentation, null),
  };
}

/** Omitted fieldsJson keeps the stored form fields. Explicit null clears them. */
function resolveDraftFields(
  draft: DraftBody,
  existing: ({
    fieldsJson: Prisma.JsonValue | null;
    locales: { locale: string; fieldsJson: Prisma.JsonValue | null }[];
  } & StoredPresentation) | null
): DraftBody {
  const previous = new Map(
    (existing?.locales ?? []).map((row) => [row.locale, jsonOrNull(row.fieldsJson)])
  );
  const fieldsJson = draft.fieldsProvided
    ? draft.fieldsJson
    : jsonOrNull(existing?.fieldsJson ?? null);
  return {
    ...draft,
    fieldsJson,
    presentation: resolvePresentation(draft.incomingPresentation, existing),
    locales: draft.locales.map((row) => ({
      ...row,
      fieldsJson: row.fieldsProvided
        ? (row.fieldsJson ?? null)
        : (previous.get(row.locale) ?? null),
    })),
  };
}

async function writeLocales(
  db: Prisma.TransactionClient,
  orgId: string,
  versionId: string,
  draft: DraftBody
) {
  const rows = [
    {
      locale: draft.localeDefault,
      title: draft.title,
      bodyHtml: draft.bodyHtml,
      fieldsJson: draft.fieldsJson,
      layoutId: draft.presentation.layoutId,
      displayMode: draft.presentation.displayMode,
      allowDocumentExtract: draft.presentation.allowDocumentExtract,
    },
    ...draft.locales.filter((l) => l.locale !== draft.localeDefault),
  ];
  const seen = new Set<string>();
  const data: Prisma.WaiverTemplateLocaleCreateManyInput[] = [];
  for (const row of rows) {
    if (seen.has(row.locale)) throw new Error(`Duplicate locale ${row.locale}`);
    seen.add(row.locale);
    const layoutId = row.layoutId ?? draft.presentation.layoutId;
    const displayMode = row.displayMode ?? draft.presentation.displayMode;
    data.push({
      orgId,
      versionId,
      locale: row.locale,
      title: row.title,
      bodyHtml: row.bodyHtml,
      fieldsJson: storedFields(row.fieldsJson),
      layoutId,
      displayMode,
      allowDocumentExtract:
        row.allowDocumentExtract ?? draft.presentation.allowDocumentExtract,
    });
  }
  await db.waiverTemplateLocale.deleteMany({ where: { versionId } });
  if (data.length) {
    await db.waiverTemplateLocale.createMany({ data });
  }
}

function hashDraft(kind: string, draft: DraftBody): string {
  const presentation = draft.presentation;
  return waiverContentSha256({
    kind,
    bodyHtml: draft.bodyHtml,
    fieldsJson: draft.fieldsJson,
    layoutId: presentation.layoutId,
    displayMode: presentation.displayMode,
    allowDocumentExtract: presentation.allowDocumentExtract,
    allowTypedSignature: presentation.allowTypedSignature,
    allowDrawnSignature: presentation.allowDrawnSignature,
    locales: [
      {
        locale: draft.localeDefault,
        title: draft.title,
        bodyHtml: draft.bodyHtml,
        fieldsJson: draft.fieldsJson,
        layoutId: presentation.layoutId,
        displayMode: presentation.displayMode,
        allowDocumentExtract: presentation.allowDocumentExtract,
      },
      ...draft.locales
        .filter((l) => l.locale !== draft.localeDefault)
        .map((l) => ({
          locale: l.locale,
          title: l.title,
          bodyHtml: l.bodyHtml,
          fieldsJson: l.fieldsJson ?? null,
          layoutId: l.layoutId ?? presentation.layoutId,
          displayMode: l.displayMode ?? presentation.displayMode,
          allowDocumentExtract: l.allowDocumentExtract ?? presentation.allowDocumentExtract,
        })),
    ],
  });
}

function jsonRows(value: Prisma.InputJsonValue | null | undefined): Record<string, unknown>[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((row) => row && typeof row === "object" && !Array.isArray(row)) as Record<string, unknown>[];
}

/** Inquiry forms never collect an e-signature. A signature row would ask for a name the server does not store. */
function dropInquirySignature(draft: DraftBody, kind: string): DraftBody {
  if (kind !== "inquiry") return draft;
  const strip = (value: Prisma.InputJsonValue | null | undefined) => {
    const rows = jsonRows(value);
    if (!rows) return value ?? null;
    return rows.filter((row) => row.type !== "signature") as unknown as Prisma.InputJsonValue;
  };
  return {
    ...draft,
    fieldsJson: strip(draft.fieldsJson),
    locales: draft.locales.map((row) => ({
      ...row,
      fieldsJson: row.fieldsProvided ? strip(row.fieldsJson) : row.fieldsJson,
    })),
    presentation: {
      ...draft.presentation,
      allowTypedSignature: false,
      allowDrawnSignature: false,
    },
  };
}

function versionPresentationData(draft: DraftBody) {
  return {
    layoutId: draft.presentation.layoutId,
    displayMode: draft.presentation.displayMode,
    allowDocumentExtract: draft.presentation.allowDocumentExtract,
    allowTypedSignature: draft.presentation.allowTypedSignature,
    allowDrawnSignature: draft.presentation.allowDrawnSignature,
  };
}

export async function createWaiverTemplate(
  actor: WaiversActor,
  body: unknown
): Promise<WaiverTemplateDto> {
  const orgId = await assertWaiversStaff(actor);
  rejectClientOrgFields(body);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid template body");
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 160) : "";
  if (!name) throw new Error("Name is required");
  const kind = String(b.kind ?? "");
  if (!ALL_KINDS.has(kind)) throw new Error("Invalid document kind");
  let locationId: string | null = null;
  if (typeof b.locationId === "string" && b.locationId.trim()) {
    await requireActorVenueInScope(actor, b.locationId.trim());
    locationId = b.locationId.trim();
  }
  await assertMutableWaiverLocation(actor, locationId);
  if (typeof b.slug === "string" && b.slug.trim()) {
    const wanted = slugifyWaiverName(b.slug);
    const taken = await prisma.waiverTemplate.findFirst({
      where: { orgId, slug: wanted },
      select: { id: true },
    });
    if (taken) throw new Error("That slug is already used in this company");
  }
  const slug =
    typeof b.slug === "string" && b.slug.trim()
      ? slugifyWaiverName(b.slug)
      : await uniqueSlug(orgId, name);

  const draft = dropInquirySignature(resolveDraftFields(readDraft(b, name), null), kind);
  const sha = hashDraft(kind, draft);
  const createdById =
    actor.sub && isValidId(actor.sub) ? actor.sub : null;

  let template;
  try {
    template = await prisma.$transaction(async (tx) => {
    const created = await tx.waiverTemplate.create({
      data: {
        orgId,
        locationId,
        kind: kind as WaiverDocumentKind,
        name,
        slug,
        status: "draft",
        requireResignOnPublish: b.requireResignOnPublish === true,
        createdById,
        versions: {
          create: {
            orgId,
            version: 1,
            localeDefault: draft.localeDefault,
            status: "draft",
            title: draft.title,
            bodyHtml: draft.bodyHtml,
            fieldsJson: storedFields(draft.fieldsJson),
            ...versionPresentationData(draft),
            contentSha256: sha,
          },
        },
      },
      include: { versions: true },
    });
    const version = created.versions[0];
    if (!version) throw new Error("Draft version was not saved");
    await writeLocales(tx, orgId, version.id, draft);
    return created;
  });
  } catch (err) {
    rethrowUniqueConflict(err, "That slug is already used in this company");
  }

  await logActivityEntryAsync({
    actorSub: actor.sub,
    orgId,
    action: "waiver_template_create",
    entityType: "WaiverTemplate",
    entityId: template.id,
    description: `Created waiver template ${name}`,
  });

  return toTemplateDto(template);
}

export async function updateWaiverTemplate(
  actor: WaiversActor,
  templateId: string,
  body: unknown
): Promise<WaiverTemplateDto> {
  const template = await requireTemplate(actor, templateId);
  rejectClientOrgFields(body);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid template body");
  }
  const b = body as Record<string, unknown>;
  await assertMutableWaiverLocation(actor, template.locationId);
  const draftPayload = b.draft;
  if (template.status === "archived") {
    const metaKeys = [
      "name",
      "slug",
      "kind",
      "locationId",
      "requireResignOnPublish",
      "defaultExpiryRule",
      "defaultExpiryDays",
      "status",
    ];
    if (metaKeys.some((key) => key in b) || !draftPayload || typeof draftPayload !== "object") {
      throw new Error(
        "Archived templates stay read-only until you save a new draft and publish it"
      );
    }
  }

  const data: Prisma.WaiverTemplateUpdateInput = {};
  if (typeof b.name === "string" && b.name.trim()) {
    data.name = b.name.trim().slice(0, 160);
  }
  if (typeof b.requireResignOnPublish === "boolean") {
    data.requireResignOnPublish = b.requireResignOnPublish;
  }
  if (b.defaultExpiryRule === null) data.defaultExpiryRule = null;
  if (typeof b.defaultExpiryRule === "string") {
    const allowed = ["never", "days", "calendar_year", "visit", "until_date"];
    if (!allowed.includes(b.defaultExpiryRule)) throw new Error("Invalid expiry rule");
    data.defaultExpiryRule = b.defaultExpiryRule as WaiverExpiryRule;
  }
  if (b.defaultExpiryDays === null) data.defaultExpiryDays = null;
  if (b.defaultExpiryDays != null && b.defaultExpiryDays !== "") {
    const n = Number(b.defaultExpiryDays);
    if (!Number.isInteger(n) || n < 1 || n > 3650) {
      throw new Error("defaultExpiryDays must be 1–3650");
    }
    data.defaultExpiryDays = n;
  }
  let nextLocationId = template.locationId;
  if (b.locationId === null) {
    await assertMutableWaiverLocation(actor, null);
    data.location = { disconnect: true };
    nextLocationId = null;
  } else if (typeof b.locationId === "string" && b.locationId.trim()) {
    const venue = await requireActorVenueInScope(actor, b.locationId.trim());
    data.location = { connect: { id: venue.id } };
    nextLocationId = venue.id;
  }
  if (
    nextLocationId &&
    nextLocationId !== template.locationId
  ) {
    await assertTemplateVenueMove(template.orgId, template.id, nextLocationId);
  }
  const nextRule =
    data.defaultExpiryRule !== undefined
      ? data.defaultExpiryRule
      : template.defaultExpiryRule;
  const nextDays =
    data.defaultExpiryDays !== undefined
      ? data.defaultExpiryDays
      : template.defaultExpiryDays;
  if (nextRule === "days" && (nextDays == null || typeof nextDays !== "number")) {
    throw new Error("defaultExpiryDays is required when the expiry rule is days");
  }
  const archiving = b.status === "archived";
  if (archiving) {
    data.status = "archived";
    data.archivedAt = new Date();
  }

  let pendingDraft: DraftBody | null = null;
  let pendingVersionId: string | null = null;
  if (draftPayload && typeof draftPayload === "object") {
    const latest = await prisma.waiverTemplateVersion.findFirst({
      where: { templateId: template.id, orgId: template.orgId },
      orderBy: { version: "desc" },
      include: { locales: true },
    });
    if (!latest || latest.status !== "draft") {
      throw new Error("Create a new draft version before editing published text");
    }
    pendingDraft = dropInquirySignature(
      resolveDraftFields(
        readDraft(draftPayload as Record<string, unknown>, template.name),
        latest
      ),
      template.kind
    );
    pendingVersionId = latest.id;
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (pendingDraft && pendingVersionId) {
      const sha = hashDraft(template.kind, pendingDraft);
      await tx.waiverTemplateVersion.update({
        where: { id: pendingVersionId },
        data: {
          title: pendingDraft.title,
          bodyHtml: pendingDraft.bodyHtml,
          fieldsJson: storedFields(pendingDraft.fieldsJson),
          localeDefault: pendingDraft.localeDefault,
          ...versionPresentationData(pendingDraft),
          contentSha256: sha,
        },
      });
      await writeLocales(tx, template.orgId, pendingVersionId, pendingDraft);
    }
    const row = await tx.waiverTemplate.update({
      where: { id: template.id },
      data,
      include: {
        versions: {
          select: { id: true, status: true, version: true },
          orderBy: { version: "desc" },
        },
      },
    });
    if (archiving) {
      await detachTemplateFromKiosks(tx, template.orgId, template.id);
      await tx.waiverRequirement.deleteMany({
        where: { orgId: template.orgId, templateId: template.id },
      });
    }
    return row;
  });
  if (archiving) {
    await logActivityEntryAsync({
      actorSub: actor.sub,
      orgId: template.orgId,
      action: "waiver_template_archive",
      entityType: "WaiverTemplate",
      entityId: template.id,
      description: `Archived waiver template ${template.name}`,
    });
  }
  return toTemplateDto(updated);
}

async function assertTemplateVenueMove(
  orgId: string,
  templateId: string,
  nextLocationId: string
) {
  const stranded = await prisma.waiverRequirement.count({
    where: {
      orgId,
      templateId,
      OR: [{ locationId: null }, { locationId: { not: nextLocationId } }],
    },
  });
  if (stranded) {
    throw new Error(
      "Remove waiver requirements that are not for the new venue before moving this template"
    );
  }
  const kiosks = await prisma.waiverKioskDevice.findMany({
    where: { orgId, NOT: { locationId: nextLocationId } },
    select: { templateIds: true },
  });
  const linked = kiosks.some(
    (row) =>
      Array.isArray(row.templateIds) &&
      row.templateIds.includes(templateId)
  );
  if (linked) {
    throw new Error("Remove this template from other venues' kiosks before moving it");
  }
}

export async function createDraftVersion(
  actor: WaiversActor,
  templateId: string,
  body: unknown
): Promise<WaiverVersionDto> {
  const template = await requireTemplate(actor, templateId);
  await assertMutableWaiverLocation(actor, template.locationId);
  rejectClientOrgFields(body);
  const b =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const openDraft = await prisma.waiverTemplateVersion.findFirst({
    where: { templateId: template.id, status: "draft" },
  });
  if (openDraft) {
    throw new Error("A draft version already exists — edit or publish it first");
  }
  const latest = await prisma.waiverTemplateVersion.findFirst({
    where: { templateId: template.id },
    orderBy: { version: "desc" },
    include: { locales: true },
  });
  const seed = latest
    ? {
        title: latest.title,
        bodyHtml: latest.bodyHtml,
        localeDefault: latest.localeDefault,
        fieldsJson: latest.fieldsJson,
        locales: latest.locales
          .filter((l) => l.locale !== latest.localeDefault)
          .map((l) => ({
            locale: l.locale,
            title: l.title,
            bodyHtml: l.bodyHtml,
            fieldsJson: l.fieldsJson,
            layoutId: l.layoutId,
            displayMode: l.displayMode,
            allowDocumentExtract: l.allowDocumentExtract,
          })),
      }
    : { title: template.name, bodyHtml: "<p></p>", localeDefault: "en", fieldsJson: null, locales: [] };

  const merged = { ...seed, ...b, locales: b.locales ?? seed.locales };
  if (!merged.bodyHtml || merged.bodyHtml === "<p></p>") {
    merged.bodyHtml = seed.bodyHtml;
  }
  const draft = dropInquirySignature(
    resolveDraftFields(readDraft(merged, template.name), latest),
    template.kind
  );
  const sha = hashDraft(template.kind, draft);
  const next = (latest?.version ?? 0) + 1;
  let version;
  try {
    version = await prisma.$transaction(async (tx) => {
    const created = await tx.waiverTemplateVersion.create({
      data: {
        orgId: template.orgId,
        templateId: template.id,
        version: next,
        localeDefault: draft.localeDefault,
        status: "draft",
        title: draft.title,
        bodyHtml: draft.bodyHtml,
        fieldsJson: storedFields(draft.fieldsJson),
        ...versionPresentationData(draft),
        contentSha256: sha,
      },
    });
    await writeLocales(tx, template.orgId, created.id, draft);
    return created;
  });
  } catch (err) {
    rethrowUniqueConflict(
      err,
      "Someone else just saved a version. Reload and try again."
    );
  }
  const listed = await listTemplateVersions(actor, template.id);
  const created = listed.find((v) => v.id === version.id);
  if (!created) throw new Error("Draft version was not saved");
  return created;
}

export async function publishWaiverTemplate(
  actor: WaiversActor,
  templateId: string,
  body: unknown
): Promise<WaiverTemplateDto> {
  const template = await requireTemplate(actor, templateId);
  await assertMutableWaiverLocation(actor, template.locationId);
  rejectClientOrgFields(body);
  const b =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const versionId =
    typeof b.versionId === "string" && b.versionId.trim() ? b.versionId.trim() : null;
  const version = await prisma.waiverTemplateVersion.findFirst({
    where: {
      templateId: template.id,
      orgId: template.orgId,
      ...(versionId ? { id: versionId } : { status: "draft" }),
    },
    include: { locales: true },
    orderBy: { version: "desc" },
  });
  if (!version) throw new Error("No draft version to publish");
  if (version.status === "published") {
    throw new Error("That version is already published and cannot be changed");
  }
  if (version.status === "archived") {
    throw new Error("Archived versions cannot be published");
  }
  if (!version.bodyHtml.trim()) throw new Error("Agreement text is required");
  const defaultLocale = version.locales.find((l) => l.locale === version.localeDefault);
  if (
    !defaultLocale ||
    defaultLocale.bodyHtml !== version.bodyHtml ||
    defaultLocale.layoutId !== version.layoutId ||
    defaultLocale.displayMode !== version.displayMode ||
    defaultLocale.allowDocumentExtract !== version.allowDocumentExtract ||
    JSON.stringify(defaultLocale.fieldsJson ?? null) !==
      JSON.stringify(version.fieldsJson ?? null)
  ) {
    throw new Error(
      "Draft locales do not match the agreement text. Save the draft again before publishing."
    );
  }

  const sha = waiverContentSha256({
    kind: template.kind,
    bodyHtml: version.bodyHtml,
    fieldsJson: version.fieldsJson,
    layoutId: version.layoutId,
    displayMode: version.displayMode,
    allowDocumentExtract: version.allowDocumentExtract,
    allowTypedSignature: version.allowTypedSignature,
    allowDrawnSignature: version.allowDrawnSignature,
    locales: version.locales.map((l) => ({
      locale: l.locale,
      title: l.title,
      bodyHtml: l.bodyHtml,
      fieldsJson: l.fieldsJson,
      layoutId: l.layoutId,
      displayMode: l.displayMode,
      allowDocumentExtract: l.allowDocumentExtract,
    })),
  });

  const publishedById = actor.sub && isValidId(actor.sub) ? actor.sub : null;
  await prisma.$transaction([
    prisma.waiverTemplateVersion.update({
      where: { id: version.id },
      data: {
        status: "published",
        publishedAt: new Date(),
        publishedById,
        contentSha256: sha,
      },
    }),
    prisma.waiverTemplate.update({
      where: { id: template.id },
      data: {
        status: "published",
        currentPublishedVersionId: version.id,
        archivedAt: null,
        ...(version.title.trim()
          ? { name: version.title.trim().slice(0, 160) }
          : {}),
      },
    }),
  ]);

  await logActivityEntryAsync({
    actorSub: actor.sub,
    orgId: template.orgId,
    action: "waiver_template_publish",
    entityType: "WaiverTemplate",
    entityId: template.id,
    description: `Published waiver template version ${version.version}`,
    metadata: { versionId: version.id, contentSha256: sha },
  });

  const updated = await prisma.waiverTemplate.findFirstOrThrow({
    where: { id: template.id },
    include: {
      versions: {
        select: { id: true, status: true, version: true },
        orderBy: { version: "desc" },
      },
    },
  });
  return toTemplateDto(updated);
}

export async function listTemplateVersions(
  actor: WaiversActor,
  templateId: string
): Promise<WaiverVersionDto[]> {
  const template = await requireTemplate(actor, templateId);
  const rows = await prisma.waiverTemplateVersion.findMany({
    where: { templateId: template.id, orgId: template.orgId },
    include: {
      locales: { orderBy: { locale: "asc" } },
      publishedBy: { select: { firstName: true, lastName: true, email: true } },
    },
    orderBy: { version: "desc" },
  });
  return rows.map((row) => ({
    id: row.id,
    version: row.version,
    status: row.status,
    localeDefault: row.localeDefault,
    title: row.title,
    bodyHtml: row.bodyHtml,
    fieldsJson: row.fieldsJson,
    layoutId: row.layoutId,
    displayMode: row.displayMode,
    allowDocumentExtract: row.allowDocumentExtract,
    allowTypedSignature: row.allowTypedSignature,
    allowDrawnSignature: row.allowDrawnSignature,
    contentSha256: row.contentSha256,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    publishedByName: row.publishedBy
      ? `${row.publishedBy.firstName ?? ""} ${row.publishedBy.lastName ?? ""}`.trim() ||
        row.publishedBy.email
      : null,
    createdAt: row.createdAt.toISOString(),
    locales: row.locales.map((l) => ({
      id: l.id,
      locale: l.locale,
      title: l.title,
      bodyHtml: l.bodyHtml,
      fieldsJson: l.fieldsJson,
      layoutId: l.layoutId,
      displayMode: l.displayMode,
      allowDocumentExtract: l.allowDocumentExtract,
    })),
  }));
}

/** Closed. A spreadsheet must not replace draft questions. */
export async function applyBlueprintToDraft(
  _actor: WaiversActor,
  _templateId: string,
  _input: { fields: unknown; layoutId: string; displayMode: string }
): Promise<WaiverTemplateDto> {
  throw new Error("Form questions are added in the form wizard, not from a spreadsheet.");
}
