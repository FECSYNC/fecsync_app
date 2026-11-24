/** Shared guest-flow validation rules (Step 2). Used by capture and smokes. */

import { clausePrompt } from "@/lib/waivers/presentation";

export type ClauseField = {
  id: string;
  type: string;
  label: string;
  required: boolean;
};

export type EffectiveSignaturePolicy = {
  allowTypedSignature: boolean;
  allowDrawnSignature: boolean;
  requireIntentCheckbox: boolean;
  hasClauseFields: boolean;
};

export function resolveEffectiveSignature(input: {
  settingsAllowTyped: boolean;
  settingsAllowDrawn: boolean;
  settingsRequireIntent: boolean;
  versionAllowTyped: boolean | null;
  versionAllowDrawn: boolean | null;
}): Pick<
  EffectiveSignaturePolicy,
  "allowTypedSignature" | "allowDrawnSignature" | "requireIntentCheckbox"
> {
  return {
    allowTypedSignature:
      input.versionAllowTyped != null
        ? input.versionAllowTyped
        : input.settingsAllowTyped,
    allowDrawnSignature:
      input.versionAllowDrawn != null
        ? input.versionAllowDrawn
        : input.settingsAllowDrawn,
    requireIntentCheckbox: input.settingsRequireIntent,
  };
}

export function collapseName(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function namesMatch(legalName: string, firstName: string, lastName: string): boolean {
  const typed = collapseName(legalName);
  if (!typed) return false;
  const expected = collapseName(`${firstName} ${lastName}`.trim());
  return typed === expected;
}

export type AcceptedClauseRow = { id: string; label: string };

export function readAcceptedClauses(
  fields: ClauseField[],
  body: Record<string, unknown>
): { accepted: AcceptedClauseRow[]; clauseFields: ClauseField[] } {
  const clauseFields = fields.filter((f) => f.type === "clause");
  const raw =
    body.acceptedClauses && typeof body.acceptedClauses === "object" && !Array.isArray(body.acceptedClauses)
      ? (body.acceptedClauses as Record<string, unknown>)
      : {};
  const accepted: AcceptedClauseRow[] = [];
  for (const field of clauseFields) {
    if (field.required && raw[field.id] !== true) {
      throw new Error(`Accept "${clausePrompt(field.label)}" to continue`);
    }
    if (raw[field.id] === true) {
      accepted.push({ id: field.id, label: field.label });
    }
  }
  return { accepted, clauseFields };
}
