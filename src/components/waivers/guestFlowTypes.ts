export type GuestField = {
  id: string;
  type: string;
  label: string;
  required: boolean;
  options: string[];
  help?: string;
  mapsTo?: string;
  section?: string;
  /** Shared with neighboring questions so they render on one row. */
  row?: string;
};

export type GuestFlowSession = {
  state: "form";
  channel: string;
  brand: { name: string; logoUrl: string | null };
  venueName: string;
  timeZone?: string;
  locale: string;
  locales: { locale: string; title: string }[];
  template: {
    id: string;
    kind: string;
    name: string;
    versionId: string;
    contentSha256: string;
    title: string;
    bodyHtml: string;
    fields: GuestField[];
    layoutId: string;
    displayMode: string;
    allowDocumentExtract: boolean;
    allowTypedSignature: boolean | null;
    allowDrawnSignature: boolean | null;
    signatureRequired: boolean;
  };
  extraForms: {
    templateId: string;
    name: string;
    versionId: string;
    fields: GuestField[];
  }[];
  settings: {
    ageOfMajorityYears: number;
    allowAdultSelfSign: boolean;
    allowGroupSigning: boolean;
    maxMinorsPerGuardianSession: number;
    requireGuardianForMinors: boolean;
    requireIntentCheckbox: boolean;
    allowTypedSignature: boolean;
    allowDrawnSignature: boolean;
    optionalWitness: boolean;
  };
  signingContext: {
    lockedEmail: string | null;
    bookingLabel: string | null;
    productLabel: string | null;
  };
};

export type GuestSignBody = {
  locale: string;
  templateVersionId: string;
  contentSha256: string;
  declined?: boolean;
  people: Record<string, unknown>[];
  guardian?: Record<string, unknown>;
  answers: Record<string, unknown>;
  forms: Record<string, Record<string, unknown>>;
  acceptedClauses: Record<string, boolean>;
  intentAccepted?: boolean;
  typedName?: string;
  drawnSignatureSvg?: string;
  witnessName?: string;
  fillMethod?: string;
};
