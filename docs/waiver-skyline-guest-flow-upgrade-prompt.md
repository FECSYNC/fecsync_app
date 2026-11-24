# Waiver guest-flow upgrade — one-step Cursor prompt

**Reference studied:** `skylinepark/` (HTML, CSS, JS, PHP). That folder is a **guest signing wizard** for three fixed parks. It is not an admin “create template” app.

**Product to upgrade:** Digital Waivers already shipped in this repo (Phases 1–5). Extend it. Do not rebuild it, and do not port PHP into this Next.js app.

Copy everything inside the fence below into a new Cursor chat.

```text
START the Skyline guest-flow upgrade of Digital Waivers.
Reference behavior (read, do not copy verbatim): skylinepark/waiver.html, skylinepark/js/waiver.js, skylinepark/js/waiver-ocr-local.js, skylinepark/js/aamva-id.js, skylinepark/waiver-mail.php, skylinepark/waiver-parks.php, skylinepark/waiver-id-scan.php, skylinepark/waiver-delivery-mail.php.
This repo already ships Digital Waivers Phases 1–5. EXTEND those files. Do not re-stub templates, signing, kiosk, desk verify, import/export, reminders, or booking links.

================================================================================
A. WHAT SKYLINE ACTUALLY DOES (COPY THE BEHAVIOR, NOT THE STACK)
================================================================================

Skyline is one public page, waiver.html, driven by waiver.js. There is no operator “create waiver” screen. “Create” means the guest completes this wizard:

1. Location — pick a park, then a visit plan (general, kids, membership, groups, party).
   Shared links use ?park=&plan=. The guest must confirm “Yes, this is my park” before continuing, or choose a different park.
   Walk-in (?mode=walkin) hides the plan picker. After signing, a 90-minute pass lets that browser continue to any plan at that park without signing again. “New guest” clears the pass.
2. Email — required. Copy says the guest must be 18+ to sign. Confirmation goes to this address only.
3. Fill method — three choices:
   - Scan ID or document (photo of an ID card OR a typed details page; the reader tries both layouts).
   - Scan a printed document (typed page only; handwriting is rejected in the error copy).
   - Fill manually.
   Scan UI: front photo required, extra page optional, Upload or Camera (rear camera, HTTPS only), Retake, Extract details.
   A checklist modal shows the exact labels to type (First name:, Last name:, Date of birth:, phone, address parts, emergency contact, Minor 1..15) plus a copyable example. Photos are used only to fill the form and are discarded after extract. They are not stored.
4. Details — tabs “Me and minor(s)” (default) vs “Just me”.
   Guardian: first, last, DOB as searchable month/day/year pickers, phone with searchable country dial code (default US +1), address search with “Enter address manually”, emergency name + phone.
   Minors: add up to 15, each with name + DOB. Switching to “Just me” drops minor rows. Switching back reapplies minors last read from a scan.
   After a scan, a review banner lists what was filled, and “Finish these next” jumps to still-required fields. Filled inputs are marked so the guest can see they came from the photo.
5. Sign — safety-rules card, then one required checkbox per agreement clause (Skyline has 16). A sticky bar reads “Scroll down. N / M checkboxes complete” and turns done only when every box is checked. Submit stays blocked until every box is checked, a signature is drawn, the typed legal name matches the guest’s first+last name, and a short park code (captcha) matches.
   Drawn signature: canvas, pointer events, coalesced move samples so the stroke stays on the finger, page scroll blocked while signing, Clear, status “Not signed yet” / “Signature captured”.
6. Success — guest copy says a confirmation is on the way (check spam). Then the browser opens that park+plan booking URL. Walk-in success offers “continue to plans” or “new guest”.

Document extractor (two stages, photos never kept):
- Primary: on-device OCR (Tesseract via skylinepark/js/waiver-ocr-local.js) plus AAMVA barcode decode (ZXing + skylinepark/js/aamva-id.js) for US driver licenses.
- Image prep: JPEG normalize, max side ~2000, contrast enhance, try the likeliest rotation first, stop early when name + DOB + address/phone are strong, one grayscale rescue, merge a second page.
- ID choice tries ID layout first, then typed-document layout, and keeps the better/merged parse.
- Document choice uses typed-label parsing only (lines like “First name: Ana”, “Minor 1 date of birth: …”).
- Backup: POST waiver-id-scan.php (AWS Textract AnalyzeID) with a ~12s abort. If cloud fails, the guest is told to retake or fill manually. Local success never waits on cloud.
- fill_method stored as scan | document | manual, and only committed after a successful extract (manual is explicit).

Checkbox behavior (important):
- Legal boxes are NEVER auto-checked. The guest must tick each one.
- The only auto-check is “Enter address manually” when a scan returns an address.
- Monitoring = live N/M count, highlight of unchecked clauses, scroll to the first missing control, block submit.

Mail routing (skylinepark/waiver-parks.php + waiver-mail.php):
- Each park has its own From address, From name, and notify inbox list.
- Submit validates, queues a job, answers the browser immediately, then a second request sends mail so the phone does not wait on SMTP.
- Park inbox gets the full record (identity, minors, which clauses were accepted, fill method, drawn signature).
- Guest gets a branded confirmation at the email they typed, with the signature inline.
- Honeypot field, rate limit, server-side captcha token, signature size cap.
- Success redirect is the booking URL for that park+plan, not a generic thank-you.

Do NOT copy into this repo:
- Skyline legal clause wording. Operators write their own clauses in the template editor. This product must not claim the guest is legally compliant.
- Skyline branding, park names, booking URLs, mailbox addresses, SMTP passwords, captcha secret, or AWS keys.
- PHP, cPanel outbox folders, or a second waiver database.
- Client-only captcha (Skyline paints the code in the browser). Use the existing rate limit. Do not add a fake captcha that the page also displays.

================================================================================
B. WHERE THIS LANDS IN THE EXISTING APP
================================================================================

Read before coding:
- .cursor/rules/saas-venue-platform.mdc
- docs/digital-waivers-complete-spec.md (shipped facts)
- docs/waivers-env.md
- prisma/schema.prisma Waiver* models
- src/lib/waivers/capture.ts, templates.ts, evaluateWaiver.ts
- src/components/waivers/SignWaiverForm.tsx
- src/components/waivers/KioskWaiverScreen.tsx
- src/components/Protected/admin/pages/waivers/WaiverTemplateEditorPage.tsx
- src/lib/mailer.ts sendWaiverGuestEmail
- src/lib/moduleEntitlement.ts assertWaiversEnabled

Keep:
- Organization + VenueLocation tenancy. Public sign still binds to a signing token (and orgSlug+venueSlug when present). Never trust client orgId/locationId.
- Demo lock, Starter has no waivers, Growth+Enterprise only, DEFAULT_ORG never runs park waivers.
- WaiverRecord is the signed store. WaiverSignature stays append-only. Historical signatures stay on the template version that was signed (contentSha256).
- Drawn signatures stay sanitized SVG path data (sanitizeDrawn in capture.ts). Do not store JPEG data URLs. Port Skyline’s pointer-pad UX, then serialize strokes to the SVG the API already accepts.
- Existing desk, kiosk device, import/export, reminders, booking confirmation links, and party waiver list.

Map Skyline concepts:
- Park → VenueLocation already on the signing token / kiosk device. Do not add a public park dropdown that lets a guest switch tenants.
- Plan → the admission product or booking this link was issued for, when the token or query already carries bookingId / product id. Show it as a confirm chip (“Yes, this visit”) the way Skyline confirms park+plan. If the link has no plan, skip the plan step.
- Walk-in → kiosk and on-site staff sign already exist. Add a short-lived walk-in pass only for the kiosk/on-site channel: after a successful sign at that location, staff can start the next plan for the same guest for 90 minutes without a second signature, and “New guest” clears it. Store the pass server-side (hashed, location-scoped, expiresAt), not only in localStorage.
- Per-park inbox → the venue’s existing notification email (CompanyProfile / VenueLocation contact). Guest confirmation keeps using sendWaiverGuestEmail. Park/staff copy goes to that venue inbox, not a hardcoded Skyline address. Queue the send so the sign response returns before mail finishes (same idea as waiver_queue_job + kickDeliverMail). Do not add a third Vercel cron.
- Agreement checkboxes → new versioned clause list on the published template, not a single intent checkbox and not Skyline’s 16 hardcoded labels.

================================================================================
C. BUILD THIS UPGRADE (ALL OF IT, IN THIS ONE PASS)
================================================================================

C1. Versioned agreement clauses
- Add clauses to the draft/published template version (extend fieldsJson with type "clause", or add clausesJson on WaiverTemplateVersion + WaiverTemplateLocale — pick the one that versions with contentSha256).
- A clause has id, required (default true), and label (plain text or limited HTML already allowed in bodyHtml — sanitize). Cap: at least 20 clauses. Raise the form-field cap only if clause rows would blow the current 40-field limit; guest data fields and clauses must both fit.
- Template editor (WaiverTemplateEditorPage) can add, reorder, remove, and mark required clauses on the draft, then publish. Publishing a new version does not rewrite old signatures.
- If a published waiver has zero clauses, keep today’s single intent checkbox so existing templates still sign.
- Server rejects sign when any required clause id is missing or not true. Store the accepted clause ids + labels on the signature audit (JSON on WaiverSignature or the record answers) so the desk detail and the emails can list them. Do not auto-check clauses in the UI or the API.

C2. Guest form on the public sign page and the kiosk
Render SignWaiverForm and KioskWaiverScreen from the published template (fields, clauses, layout id, display mode, feature toggles). Use Harewa/VenueFlow tokens (gold #D4AF37, stone/gray, resolveBrandForOrg). Do not copy Skyline purple chrome, stamp buttons, or legal copy.
The same published data must render in whichever display mode the operator saved (C8). Multi-step uses this order. Single-page, grid, and accordion show the same blocks without forcing the guest through steps.
Blocks, in order, omitting any block the template turned off:
1. Confirm venue (and plan/booking chip when the session has one). Deep link must be confirmed with “Yes, this is my park” before Next. No tenant switcher.
2. Email (prefill when the request already has toEmail; lock it when the token email is fixed).
3. How to fill — only when document extract is enabled for this template: Scan ID or document | Scan a printed document | Fill manually. When extract is off, skip this block and open the fields.
4. Details: operator-defined fields, plus Me and minor(s) | Just me when the template includes a minor repeater. DOB pickers, country dial + phone, and address search apply to fields of those types. Minor rows cap at WaiverSettings.maxMinorsPerGuardianSession (the setting may allow up to 15; honor a lower org setting).
5. Agreement: published bodyHtml, then one checkbox per required clause, sticky “N / M checkboxes complete”, highlight missing, scroll to first gap. Signature pad and typed legal name render only for the signature modes that are enabled. Typed name must match the guardian/adult first+last (case-insensitive, collapsed spaces). When both drawn and typed are enabled, both are required — change capture.ts so “either” is no longer enough in that case. When both are disabled, clauses alone complete the sign (still store intentAccepted from the required clauses).
6. Success receipt already exists. After sign, if the session has a booking or product URL, offer that link. Do not invent a booking URL.

C3. Document and ID extract (no photo retention)
- New client module, e.g. src/lib/waivers/extractGuestDocument.ts, porting the parsing ideas from waiver-ocr-local.js and aamva-id.js: label lines, DOB normalization, minor N first/last/dob, AAMVA PDF417 when a barcode library is already acceptable as a dependency. Run OCR in the browser (tesseract.js or the same approach Skyline uses). Do not upload the image until local OCR is too weak.
- UI: front image required, extra page optional, file upload and getUserMedia rear camera (HTTPS / localhost only; otherwise tell the guest to upload). Max 6 MB, JPEG normalize, orientation attempts, early exit when the parse is strong, merge extra page, discard image data from state after success or when leaving the step.
- Checklist dialog with copyable example labels (generic, not Skyline sample people).
- On success, fill only empty-or-overwrite guest fields you actually parsed, show the review banner and “Finish these next” jumps, remember scanned minors and apply them only in “Me and minor(s)”.
- On failure, leave the guest on the scan step with a clear manual fallback. Never block signing because OCR failed.
- Optional cloud backup: one server route under the public waiver token, e.g. POST /api/public/waivers/sign/[token]/extract, enabled only when env for a document API is set (document the env in docs/waivers-env.md). 12s timeout, rate limit, images not written to disk or the database, response is structured fields only. If env is missing, skip cloud and keep manual fallback. Do not embed Skyline AWS keys.

C4. Address assist
- Address typeahead may call a server proxy you control, or be omitted if no key exists. Do not send guest keystrokes from the browser straight to a third party without a proxy and a short privacy line on the step. Manual address fields always work with no network.

C5. Mail
- Guest email: existing sendWaiverGuestEmail, plus the accepted clause labels and a note that a signature was captured (do not attach the raw photo; SVG signature may be inlined if the mailer already can).
- Venue email: send the same record to the location notify address when one is configured. Include fill method (manual | scan | document), signer, minors, clause list, public ref. No ID image.
- Return the sign API success before mail completes; send mail after the response is committed, with the existing mailer error handling. Idempotent: a replayed sign must not send a second pair of emails (capture.ts already has replay).

C6. Walk-in pass (kiosk / on-site only)
- After a successful kiosk or staff-assisted sign, create a 90-minute location-scoped pass for that guest profile.
- The kiosk success screen offers “Continue” (pass still valid) and “New guest” (revoke pass).
- Public emailed links do not create a walk-in pass.

C7. Tests
- Extend the waiver smoke scripts (or add yarn smoke:waivers:guest-flow) for: clause required server-side, both signatures required when both settings are on, signature omitted when both signature toggles are off, name mismatch rejected, zero-clause templates still accept the old intent checkbox, extract route hidden and refused when the template toggle is off and does not persist images, walk-in pass expires and is location-scoped, blueprint CSV creates a draft (fields + clauses + layout) and does not create WaiverRecord rows.
- Do not weaken smoke:waivers:p1 through p5.

C8. Operator form builder — spreadsheet blueprint, layouts, optional signature and extract
This is how a company creates the waiver form. It is separate from the existing historical signed-waiver CSV (src/lib/waivers/importWaivers.ts), which records guests who already signed. Keep that importer. Add a second importer that builds a draft template.

Blueprint file (staff download and upload, under /admin/waivers, WaiversWrite):
- Buttons: Download CSV and Download Excel (.xlsx). One sheet named Fields, one sheet named Instructions.
- Columns, header row required:
  section, key, label, type, required, options, help, maps_to
- section: guest | agreement | custom (free text section title is also allowed and becomes a heading).
- type: text | textarea | email | phone | date | select | checkbox | clause | minor_repeater | address
- required: yes | no
- options: pipe-separated choices for select
- maps_to: optional bind to a known signer slot (first_name, last_name, email, phone, dob, emergency_name, emergency_phone, address, city, state, postal_code) so OCR and the signature name-match know which field is which. Custom keys with an empty maps_to are stored as extra answers only.
- A clause row’s label is the checkbox text the guest must tick. Do not ship Skyline’s clause sentences as sample legal content. The sample file uses obvious placeholders (“Write your safety-rules clause here”).
- Include 2–3 example rows the operator replaces, plus a minor_repeater example.
- Import parses CSV and xlsx, shows a preview (row errors called out), and on confirm creates or updates the draft WaiverTemplateVersion: fields, clauses, and content hash inputs. It does not publish and does not write WaiverRecord or WaiverSignature.
- After import, the template editor can add, edit, reorder, and delete fields and clauses before publish. Imported rows are a starting set.

Display (saved on the draft and copied onto the published version so old signatures keep the look they were signed under only as audit; the live guest page uses the current published version’s display):
- displayMode: multi_step | single_page | grid | accordion
  - multi_step: one block per step with a progress rail (Skyline’s flow).
  - single_page: every block on one scroll.
  - grid: guest fields in a responsive flex/grid (two columns on wide screens, one column on a phone); agreement and signature full width under the grid.
  - accordion: one section open at a time on a single page.
- layoutId: one of these 10 presets. A preset sets spacing, header treatment, clause presentation, and a default displayMode. The operator can override displayMode after picking a preset.
  1. classic — single column, stacked labels
  2. two_column — grid of short fields
  3. cards — each section in its own card
  4. wizard — multi-step rail (Skyline step shape)
  5. kiosk_compact — large type, short vertical steps for the kiosk
  6. agreement_focus — clauses first and visually primary, identity fields after
  7. numbered_rail — steps listed as a vertical index beside the form
  8. accordion — sections expand one at a time
  9. split — details and agreement side by side on desktop, stacked on mobile
  10. checklist — clauses as a monitored checklist, fields in a tight block above the signature
- Template editor shows a live preview that switches when layout or displayMode changes, using sample guest values, before publish.
- Guest sign and kiosk read layoutId + displayMode from the published version. Brand colors stay resolveBrandForOrg. Presets change structure and density, not a second color system.

Standby features, each optional per template (default off for document extract; signature defaults stay the current WaiverSettings allowTypedSignature / allowDrawnSignature):
- allowDrawnSignature and allowTypedSignature already exist. Expose them on the template editor as well as settings, template value overriding location settings when set. Off means that control is absent on the guest form and the API does not require it.
- allowDocumentExtract (new boolean on the template version, default false). The OCR/ID/document code from C3 is always shipped. The guest sees the scan block only when this flag is true on the published version. When false, the extract API rejects the call. Operators can turn it on without a new deploy.
- Editor copy states that clauses are never auto-checked and that photos are not stored.

================================================================================
D. NON-GOALS
================================================================================

- Do not rewrite waivers in PHP or add skylinepark routes to the Next app.
- Do not copy Skyline legal text into seed data.
- Do not auto-check agreement clauses.
- Do not store ID or document photos.
- Do not build the check-in scanner, ticket-purchase kiosk, or POS terminal.
- Do not reopen /signup.
- Do not change plan ids or give Starter the waivers module.
- Do not treat the form-blueprint spreadsheet as a signed-waiver import. Guest history stays on the existing CSV importer.

================================================================================
E. DONE WHEN
================================================================================

An operator can download the field blueprint (CSV and Excel), fill it, import it into a draft waiver, add or remove fields in the editor, pick 1 of 10 layouts and a display mode (multi-step, single page, grid, or accordion), and turn signature and document extract on or off. Publish, then a guest sees that form. With extract and both signatures on, the guest path is confirm → email → fill method → details → per-clause checkboxes with a live N/M count → drawn pad + matching typed name → receipt. With those toggles off, those blocks are absent and the API does not require them.
A scan can prefill from a typed page or an ID on-device, with manual fallback, and no image remains in the database.
The venue inbox and the guest inbox each get the correct mail for that location, after the sign response has already returned.
Existing published waivers with no clauses still sign with the current intent checkbox.
Demo, Starter, storefront, and unpaid orgs still fail closed.
```
