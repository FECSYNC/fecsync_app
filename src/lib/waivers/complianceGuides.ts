/**
 * Operator education checklists. Not a compliance certificate and not legal advice.
 * Statute text is summarized; links point at official sources.
 */
export type ComplianceGuide = {
  id: string;
  title: string;
  jurisdictionCode: string;
  disclaimer: string;
  sections: { heading: string; body: string; links?: { label: string; href: string }[] }[];
};

const DISCLAIMER =
  "Not legal advice. These notes are an operator checklist so your team knows which settings to review with counsel. FECSYNC does not determine that your venue is legally compliant.";

export const COMPLIANCE_GUIDES: readonly ComplianceGuide[] = [
  {
    id: "US-FL",
    title: "Florida operator checklist",
    jurisdictionCode: "US-FL",
    disclaimer: DISCLAIMER,
    sections: [
      {
        heading: "Age of majority",
        body: "Florida’s age of majority is 18. Default Waiver Settings use 18. Guests under that age should not self-sign a liability waiver; a parent or legal guardian signs for them. Do not lower this to bypass guardian capture.",
      },
      {
        heading: "Minors and guardians",
        body: "Keep require-guardian enabled for trampoline parks, amusement attractions, and similar guest activities. Capture the guardian’s name, relationship, and adult date of birth, plus each minor’s name and date of birth. One guardian session should stay within the minor cap you configure.",
      },
      {
        heading: "Attraction operations",
        body: "Amusement and trampoline operators should keep a written waiver version for each published agreement, retain signed copies for the retention period you set with counsel, and block or warn at check-in when a required waiver is missing. This product stores the signed version hash, time, and intent flag — it does not replace your operating permit, insurance, or inspection program.",
        links: [
          {
            label: "Florida Legislature (official)",
            href: "https://www.leg.state.fl.us/",
          },
        ],
      },
      {
        heading: "Records and electronic signatures",
        body: "Florida has adopted a version of UETA, and federal ESIGN applies to many interstate electronic contracts. Store the agreement text the guest actually signed (immutable version), show a clear intent checkbox, and keep an audit trail. Historical signatures stay on the version that was published at sign time when you publish a new draft.",
        links: [
          {
            label: "Florida Statutes (official)",
            href: "http://www.leg.state.fl.us/statutes/",
          },
        ],
      },
      {
        heading: "Consult counsel",
        body: "Have a Florida attorney review assumption-of-risk language, guardian authority, and how long you must keep records. Acknowledging this guide in Venue Manager is an internal training stamp, not proof of compliance.",
      },
    ],
  },
  {
    id: "US-GENERAL",
    title: "United States general checklist",
    jurisdictionCode: "US-OTHER",
    disclaimer: DISCLAIMER,
    sections: [
      {
        heading: "ESIGN and UETA",
        body: "The federal ESIGN Act and the state Uniform Electronic Transactions Act (where enacted) generally allow electronic records and signatures when the person intends to sign and receives the record. This product stores intent accepted, signed-at in the venue timezone, a content hash of the published text, a typed and/or drawn signature, an IP hash (not the raw IP in exports), and user agent.",
        links: [
          {
            label: "15 U.S.C. Chapter 96 (ESIGN) — govinfo",
            href: "https://www.govinfo.gov/content/pkg/USCODE-2011-title15/html/USCODE-2011-title15-chap96.htm",
          },
        ],
      },
      {
        heading: "Minors",
        body: "Age of majority is 18 in most states and 19 or 21 in a few. Set age of majority per venue (allowed range 16–21) to match counsel’s instruction. Minors do not self-sign when guardian capture is required.",
      },
      {
        heading: "Retention and versioning",
        body: "Choose a retention period with counsel (default 7 years is a starting point, not a legal holding period). Publishing a new version does not rewrite old signatures. Each signature row is append-only and bound to the content hash of the version shown at signing.",
      },
      {
        heading: "What this product stores",
        body: "Templates and published versions, locale text, guest profile identity used at signing, signer rows (adult and minors), signature audit, request tokens as hashes only, and kiosk device token hashes. Exports omit signature drawings, token hashes, PIN hashes, and raw IP addresses.",
      },
      {
        heading: "Consult counsel",
        body: "State waiver enforceability varies, especially for negligence and for attractions. This checklist does not certify compliance.",
      },
    ],
  },
];

export function listComplianceGuides(): ComplianceGuide[] {
  return COMPLIANCE_GUIDES.map((g) => ({
    ...g,
    sections: g.sections.map((s) => ({ ...s, links: s.links ? [...s.links] : undefined })),
  }));
}

export function getComplianceGuide(id: string): ComplianceGuide | null {
  return listComplianceGuides().find((g) => g.id === id) ?? null;
}
