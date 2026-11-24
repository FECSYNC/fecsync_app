import type { DraftField } from "@/components/Protected/admin/pages/waivers/WaiverFieldDesigner";

export type WaiverStarter = {
  id: string;
  mode: "documents" | "forms";
  kind: string;
  title: string;
  summary: string;
  bodyHtml: string;
  fields: DraftField[];
};

function field(
  id: string,
  type: string,
  label: string,
  mapsTo = "",
  required = true
): DraftField {
  return {
    id,
    section: type === "clause" ? "agreement" : "guest",
    type,
    label,
    required,
    options: "",
    help: "",
    mapsTo: type === "clause" ? "" : mapsTo,
  };
}

const guestName = [
  field("first_name", "text", "First name", "first_name"),
  field("last_name", "text", "Last name", "last_name"),
  field("email", "email", "Email", "email"),
  field("phone", "phone", "Phone", "phone", false),
  field("dob", "date", "Date of birth", "dob"),
];

const agree = field("agree", "clause", "I have read this agreement and I agree to it.");
const photoReader = field("photo_reader", "photo_reader", "Photo reader", "", false);
const signature = field("signature", "signature", "E-signature", "", true);

function withTools(rows: DraftField[], includeSignature = true): DraftField[] {
  const questions = rows.filter((row) => row.type !== "clause");
  const clauses = rows.filter((row) => row.type === "clause");
  return [...(rows.some((row) => row.type === "photo_reader") ? [] : [photoReader]), ...questions, ...(includeSignature ? [signature] : []), ...clauses];
}

function readyClause(id: string, title: string, about: string): DraftField {
  return field(id, "clause", `${title}: Replace this sentence with your own ${about}.`);
}

/** One page break per picture after Location and Email. Not passed through withTools(). */
const readyMadeGuestFields: DraftField[] = [
  {
    ...field("step_fill", "page_break", "How do you want to complete your details?", "", false),
    help: "Faster fill",
  },
  field("photo_reader", "photo_reader", "Photo reader", "", false),
  field("step_guest", "page_break", "Guest info", "", false),
  field("guest_heading", "section", "Your details (guardian)", "", false),
  { ...field("first_name", "text", "First name", "first_name"), row: "guest_name" },
  { ...field("last_name", "text", "Last name", "last_name"), row: "guest_name" },
  field("dob", "date", "Date of birth", "dob"),
  field("phone", "phone", "Phone", "phone"),
  field("step_address", "page_break", "Address", "", false),
  {
    ...field("address", "address", "Address", "address"),
    help: "Start typing — pick a suggestion to autofill the matching address fields.",
  },
  field("minors", "minor_repeater", "Minors in this group", "", true),
  field("step_emergency", "page_break", "Emergency contact", "", false),
  { ...field("emergency_name", "text", "Emergency contact name", "emergency_name"), row: "emergency" },
  { ...field("emergency_phone", "text", "Emergency phone", "emergency_phone"), row: "emergency" },
  field("step_safety", "page_break", "Safety rules", "", false),
  {
    ...field("safety_rules", "html", "Safety rules", "", false),
    help: "Replace this sentence with your own safety rules.",
  },
  field("step_read", "page_break", "Please read this document carefully", "", false),
  readyClause("c_safety", "Safety rules", "safety-rules confirmation"),
  readyClause("c_rights", "Legal rights", "rights statement"),
  field("step_authority", "page_break", "Authorization to sign", "", false),
  readyClause("c_authority", "Authorization to sign", "authorization statement"),
  readyClause("c_responsibility", "Personal responsibility", "responsibility statement"),
  field("step_risk", "page_break", "Assumption of risk", "", false),
  readyClause("c_risk", "Assumption of risk", "risk statement"),
  readyClause("c_release", "Release of liability", "release statement"),
  readyClause("c_covenant", "Covenant not to sue", "covenant statement"),
  readyClause("c_indemnify", "Defense and indemnification", "indemnification statement"),
  readyClause("c_property", "Liability for property", "property statement"),
  readyClause("c_photo", "Photography / video release", "photo statement"),
  readyClause("c_privacy", "Privacy", "privacy statement"),
  readyClause("c_terms", "Terms and severability", "terms statement"),
  readyClause("c_arbitration", "Arbitration and venue", "dispute statement"),
  readyClause("c_equipment", "Equipment", "equipment statement"),
  readyClause("c_age", "Age and authority", "age statement"),
  readyClause("c_final", "Final agreement", "final confirmation"),
  field("step_draw", "page_break", "Draw your electronic signature", "", false),
  {
    ...field("signature", "signature", "Draw your electronic signature", "", true),
    help: "Sign with your finger, stylus, or mouse. Keep your finger on the pad while signing — it won't jump or scroll away.",
  },
  field("step_typed", "page_break", "Type your full legal name to confirm", "", false),
  field("typed_name", "section", "Type your full legal name to confirm", "", true),
];

export const READY_MADE_GUEST_WAIVER_ID = "venue-guest-flow";

export const WAIVER_STARTERS: WaiverStarter[] = [
  {
    id: READY_MADE_GUEST_WAIVER_ID,
    mode: "documents",
    kind: "liability_waiver",
    title: "Ready-made guest waiver",
    summary: "Location, email, photo fill, guest details, and the agreement, in the order guests walk through them.",
    bodyHtml: "<p>Replace this sentence with your own notice to read this agreement carefully.</p>",
    fields: readyMadeGuestFields,
  },
  {
    id: "liability",
    mode: "documents",
    kind: "liability_waiver",
    title: "Liability waiver",
    summary: "Guest name, contact, date of birth, address, and one agreement clause.",
    bodyHtml: "<p>Replace this paragraph with your venue's own liability terms before you publish.</p>",
    fields: withTools([...guestName, field("address", "address", "Address", "address", false), agree]),
  },
  {
    id: "guardian",
    mode: "documents",
    kind: "liability_waiver",
    title: "Guardian and minors",
    summary: "Adult signer plus a minors block and one agreement clause.",
    bodyHtml: "<p>Replace this paragraph with the guardian terms you want a parent or guardian to accept.</p>",
    fields: withTools([...guestName, field("minors", "minor_repeater", "Minors in this group", "", true), agree]),
  },
  {
    id: "membership",
    mode: "documents",
    kind: "membership_contract",
    title: "Membership contract",
    summary: "Name and contact for a membership agreement.",
    bodyHtml: "<p>Replace this paragraph with your membership terms before you publish.</p>",
    fields: withTools([
      field("first_name", "text", "First name", "first_name"),
      field("last_name", "text", "Last name", "last_name"),
      field("email", "email", "Email", "email"),
      field("phone", "phone", "Phone", "phone", false),
      agree,
    ]),
  },
  {
    id: "booking",
    mode: "documents",
    kind: "booking_agreement",
    title: "Booking agreement",
    summary: "Name, contact, and date of birth for a visit agreement.",
    bodyHtml: "<p>Replace this paragraph with the booking terms for this visit.</p>",
    fields: withTools([...guestName, agree]),
  },
  {
    id: "blank-doc",
    mode: "documents",
    kind: "liability_waiver",
    title: "Blank waiver",
    summary: "Photo reader and e-signature are already on the form. Remove either one if you do not want it.",
    bodyHtml: "<p>Write your agreement here.</p>",
    fields: withTools([]),
  },
  {
    id: "inquiry",
    mode: "forms",
    kind: "inquiry",
    title: "Visit inquiry",
    summary: "A short note field guests can fill before they arrive.",
    bodyHtml: "<p>Tell us a bit more before your visit.</p>",
    fields: withTools([field("notes", "textarea", "Notes", "", false)], false),
  },
  {
    id: "event",
    mode: "forms",
    kind: "event_form",
    title: "Event form",
    summary: "Name, email, and phone for an event.",
    bodyHtml: "<p>Share your details for this event.</p>",
    fields: withTools([
      field("first_name", "text", "First name", "first_name"),
      field("last_name", "text", "Last name", "last_name"),
      field("email", "email", "Email", "email"),
      field("phone", "phone", "Phone", "phone", false),
    ]),
  },
  {
    id: "blank-form",
    mode: "forms",
    kind: "custom_form",
    title: "Blank form",
    summary: "Photo reader and e-signature are already on the form. Remove either one if you do not want it.",
    bodyHtml: "<p>Tell us what you need before your visit.</p>",
    fields: withTools([]),
  },
];
