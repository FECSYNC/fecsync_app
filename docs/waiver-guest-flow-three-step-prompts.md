# Digital Waivers guest-flow upgrade — three copy-and-paste steps

Paste one fenced block at a time into a new Cursor chat. Finish the step. Paste that step’s follow-up audit. Start the next step only after the audit reports no skipped work.

Step 1 stores the form the company designs (fields, clauses, layout, display, signature and scan switches, spreadsheet blueprint). Step 2 makes guests and the kiosk render and sign that form, and keeps desk, export, booking, and party surfaces in sync. Step 3 turns on document and ID reading, venue plus guest mail, and the kiosk walk-in pass.

Behavior reference, read only, do not copy PHP, secrets, branding, or legal sentences: skylinepark/waiver.html, skylinepark/js/waiver.js, skylinepark/js/waiver-ocr-local.js, skylinepark/js/aamva-id.js, skylinepark/waiver-mail.php, skylinepark/waiver-parks.php, skylinepark/waiver-id-scan.php. The product to extend is the Next.js Digital Waivers module already in this repo.

```text
START STEP 1 of the Digital Waivers guest-flow upgrade.
Execute ONLY Step 1. Do not build the guest wizard UI, the signature pad replacement, OCR, the extract API, venue mail changes, or the walk-in pass. Those are Steps 2 and 3. Do leave the current public sign page and kiosk able to sign exactly as they do today after your schema and payload changes.+++----------++++++++++++++++++++++++++++++++++++++++

Before you write code, scan and analyze the repo. Read .cursor/rules/saas-venue-platform.mdc, docs/digital-waivers-complete-spec.md, docs/waivers-env.md, and docs/waiver-guest-flow-three-step-prompts.md. Then open the live waiver code and write down what already exists versus what Step 1 must add. Do not re-stub Phases 1 through 5. Do not reopen /signup. Do not give Starter the waivers module. Do not copy Skyline legal text, park names, mailboxes, SMTP passwords, captcha secrets, or AWS keys.

Scan at least these files and keep their current jobs:
prisma/schema.prisma models WaiverSettings, WaiverTemplate, WaiverTemplateVersion, WaiverTemplateLocale, WaiverRequirement, WaiverRecord, WaiverSigner, WaiverSignature, WaiverRequest, WaiverKioskDevice, WaiverSignageToken, WaiverReminderWatermark, FormResponse.
src/lib/waivers/templates.ts, settings.ts, contentHash.ts, sanitizeHtml.ts, capture.ts, signToken.ts, kiosk.ts, records.ts, desk.ts, evaluateWaiver.ts, bookingHooks.ts, importWaivers.ts, exportWaivers.ts, access.ts, common.ts, assert.ts, http.ts, publicHttp.ts.
src/services/waivers.ts.
src/lib/auth/permissions.ts API_PERMISSIONS waiver entries.
src/lib/adminNav.ts waiver links.
src/lib/mailer.ts sendWaiverGuestEmail.
src/lib/companyExport.ts waiver counts.
src/components/Protected/admin/pages/waivers/WaiverTemplateEditorPage.tsx, WaiverTemplatesPage.tsx, WaiverSettingsPage.tsx, WaiverSubnav.tsx, WaiverImportPage.tsx.
src/components/waivers/SignWaiverForm.tsx and KioskWaiverScreen.tsx (read only in this step; do not redesign them).
src/app/sign/[token]/page.tsx and src/app/kiosk/waivers/[deviceToken]/page.tsx.
src/app/api/admin/waivers/templates/route.ts, templates/[id]/route.ts, templates/[id]/versions/route.ts, templates/[id]/publish/route.ts, settings/route.ts, import/route.ts.
src/app/api/public/waivers/sign/[token]/route.ts and kiosk/[deviceToken]/route.ts.
scripts/smoke-waivers-phase1.mts through phase5.mts.

What you are building in Step 1 is the company-side form definition. A staff member will later download a CSV or Excel blueprint, fill rows, import them into a draft waiver, add more fields in the editor, pick one of ten layouts and one display mode, and turn signature and document scan on or off. This step persists that definition and shows it in the template editor. It does not yet change how a guest fills the page.

Data model. Extend the existing tables. Do not create a second template table or a second signed-waiver table.
On WaiverTemplateVersion and on WaiverTemplateLocale, store layoutId, displayMode, and allowDocumentExtract. layoutId is one of classic, two_column, cards, wizard, kiosk_compact, agreement_focus, numbered_rail, accordion, split, checklist. displayMode is one of multi_step, single_page, grid, accordion. Default layoutId classic and displayMode single_page so every waiver that exists today still has a valid presentation. allowDocumentExtract defaults to false.
Signature switches stay on WaiverSettings (allowTypedSignature, allowDrawnSignature). Also store nullable overrides on the template version: when null, the location or org WaiverSettings still decide; when true or false, that published version decides. Do not change the meaning of existing settings rows.
Add notifyEmail as an optional string on WaiverSettings. VenueLocation has no email column. Do not invent one. Staff copy in Step 3 will use this address when set.
Add acceptedClauses Json nullable on WaiverSignature for Step 2 to fill. Leave it null in this step.
Add fillMethod String nullable on WaiverRecord for Step 2 and Step 3. Leave it null in this step.
Raise nothing that would reject existing settings. src/lib/waivers/settings.ts already allows maxMinorsPerGuardianSession from 1 to 20 and defaults to 8. Keep that cap. Do not lower it.
Extend fieldsJson. Today parseFields in src/lib/waivers/templates.ts allows text, textarea, checkbox, select, date, email, phone, at most 40 fields. Add types clause, minor_repeater, and address. Each field keeps id, type, label, required, options. Add optional help (string, max 300) and mapsTo (empty or one of first_name, last_name, email, phone, dob, emergency_name, emergency_phone, address, city, state, postal_code). A clause field is an agreement checkbox, not a guest data input. Raise the cap high enough for guest fields plus at least 20 clauses (use 60 if you need one number). Duplicate ids still fail. Unknown types still fail.
contentSha256 must change when presentation or these new field keys change. Update canonicalFields and waiverContentSha256 in src/lib/waivers/contentHash.ts so layoutId, displayMode, allowDocumentExtract, signature overrides, help, and mapsTo are part of the canonical payload for the version and for each locale. A publish must not rewrite older WaiverSignature rows. Old records keep the hash they stored.
Run prisma migrate (yarn db:migrate) for these columns. Then yarn db:generate. If migrate cannot run in this environment, write the migration SQL and say so; do not hand-edit the client types and leave the database behind without stating that.

APIs to update in place, same permission gates they already have:
GET and PATCH /api/admin/waivers/templates/[id] return and save draft fields including help, mapsTo, new types, layoutId, displayMode, allowDocumentExtract, and signature overrides.
POST /api/admin/waivers/templates and POST /api/admin/waivers/templates/[id]/versions accept the same on the draft.
POST /api/admin/waivers/templates/[id]/publish hashes the new canonical content and still does not edit published bodies in place. Published version body stays immutable. A new draft is the only edit path, which is already the rule in permissions.ts.
GET /api/admin/waivers/settings and PUT /api/admin/waivers/settings read and write notifyEmail. Validate it as an email or empty.
GET /api/public/waivers/sign/[token] and GET /api/public/waivers/kiosk/[deviceToken] include the new presentation and field shape in the session JSON so Step 2 can render it. Extra JSON keys must not break SignWaiverForm or KioskWaiverScreen. Do not require new body fields on POST sign yet. capture.ts keeps today’s signature rules in this step (typed or drawn when settings say so, single intent checkbox).
Register every new admin path in src/lib/auth/permissions.ts API_PERMISSIONS with the same style as the existing waiver lines (waivers:write, assertWaiversEnabled, never trust body orgId).

New blueprint routes, staff only:
GET /api/admin/waivers/templates/blueprint downloads a sample file. Support format=csv and format=xlsx. CSV is required. xlsx is required too; add a small spreadsheet dependency only if the repo does not already have one, and use it on the server.
POST /api/admin/waivers/templates/[id]/blueprint accepts CSV or xlsx, query or body mode=preview or mode=commit. Preview returns row errors and does not write. Commit writes the draft version only: fields, clauses as clause-type fields, layoutId and displayMode if the file includes a Presentation sheet or a presentation header. It does not publish. It does not create WaiverRecord, WaiverSignature, WaiverSigner, or GuestProfile rows.
The existing POST /api/admin/waivers/import and src/lib/waivers/importWaivers.ts stay the historical signed-guest importer. Do not merge the blueprint into that parser. WaiverImportPage stays the historical import screen.
Put the parser in src/lib/waivers/blueprint.ts. Columns, header required: section, key, label, type, required, options, help, maps_to. section is guest, agreement, or a custom heading string. type is text, textarea, email, phone, date, select, checkbox, clause, minor_repeater, address. required is yes or no. options are pipe-separated. maps_to matches mapsTo. Sample rows use placeholders such as “Write your safety-rules clause here”, never Skyline’s legal paragraphs. Include a short Instructions sheet on xlsx and comment lines are not required on CSV; a second Presentation area may set layout_id and display_mode, defaulting to classic and single_page when omitted.
Reject files over a modest size (2 MB) and over the field cap. Return the failing row number and column.

Editor UI, on the existing page src/app/(admin)/admin/waivers/templates/[id]/page.tsx via WaiverTemplateEditorPage.tsx. Do not add a second editor route.
Staff can add, edit, reorder, and delete fields and clause rows on the draft.
Staff can set help text and mapsTo.
Staff can pick layoutId from the ten ids and displayMode from the four modes. Show the human names in the control and store the ids. Each preset’s default display: classic single_page, two_column grid, cards single_page, wizard multi_step, kiosk_compact multi_step, agreement_focus single_page, numbered_rail multi_step, accordion accordion, split grid, checklist single_page. Choosing a preset sets that default display; staff can override displayMode afterward.
Staff can set allowDocumentExtract, and the signature overrides (inherit, force on, force off) for drawn and typed.
Show a preview panel that lists the sections, fields, clauses, layout name, and display mode with sample labels. Full guest chrome is Step 2. This preview only has to prove the draft saved.
Do not offer a CSV or Excel blueprint. Staff add every question in the form wizard.
Update src/services/waivers.ts types and functions so the editor does not hand-fetch around the client. Include layoutId, displayMode, allowDocumentExtract, signature overrides, help, and mapsTo. Do not download or import a form blueprint.
WaiverSettingsPage can edit notifyEmail for the selected location (and the org default when locationId is null), using the existing settings API.
Admin nav already has Templates at /admin/waivers/templates. Keep it. No new top-level product area.

Sync rules for Step 1:
evaluateWaiver.ts, bookingHooks.ts, BookingWaiverPanel, party-chase, membership waiverRequired, reminders, and historical import must keep working. You are not changing validity vocabulary.
FormResponse.payloadJson remains the place extra answers will be stored in Step 2. Do not add another answers table.
companyExport.ts waiver counts must still run. New columns on existing models do not need new counts.
Demo lock, Starter denial, storefront denial, and unpaid or suspended orgs stay fail-closed through assertWaiversEnabled.
Park scope and “never trust client orgId” stay as they are in src/lib/waivers/common.ts.

When Step 1 is done, say what you scanned, list every file you changed, confirm the guest sign POST still uses the old rules, and confirm blueprint commit does not publish and does not write signed records. Do not start Step 2.
```

```text
FOLLOW-UP AUDIT FOR STEP 1 of the Digital Waivers guest-flow upgrade.
Do not implement Step 2 or Step 3. Do not add OCR, a new guest wizard, walk-in passes, or mail routing. Scan the repo and report PASS or FAIL for every item below. If an item is FAIL or MISSING, fix only that Step 1 gap, then re-check it. End with a skipped-work list. If the skipped-work list is not empty, the step is not done.

1. prisma/schema.prisma WaiverTemplateVersion and WaiverTemplateLocale have layoutId, displayMode, and allowDocumentExtract, with defaults classic, single_page, and false. Existing databases have a migration or an explicit statement that migrate could not be applied.
2. Signature overrides on the version are nullable and null means “use WaiverSettings”. allowTypedSignature and allowDrawnSignature on WaiverSettings are unchanged in meaning.
3. WaiverSettings.notifyEmail exists and GET/PUT /api/admin/waivers/settings validate it. VenueLocation was not given a fake email column.
4. WaiverSignature.acceptedClauses and WaiverRecord.fillMethod exist and are still null for old rows. No backfill invented clause acceptance.
5. src/lib/waivers/templates.ts accepts clause, minor_repeater, and address, plus help and mapsTo, rejects unknown mapsTo and duplicate ids, and allows at least 20 clauses plus guest fields.
6. src/lib/waivers/contentHash.ts changes the hash when layout, display, allowDocumentExtract, signature overrides, help, or mapsTo change. Publishing does not update old WaiverSignature.contentSha256 values.
7. PATCH draft and POST version and POST publish round-trip the new fields. Published bodies are still immutable.
8. GET /api/public/waivers/sign/[token] and GET /api/public/waivers/kiosk/[deviceToken] include the new fields. POST sign still succeeds with today’s body (intent checkbox and typed or drawn signature per current settings). SignWaiverForm and KioskWaiverScreen still submit successfully.
9. GET /api/admin/waivers/templates/blueprint returns CSV and xlsx. The sample uses placeholder clause text, not Skyline legal copy.
10. POST /api/admin/waivers/templates/[id]/blueprint preview writes nothing. Commit updates the draft only. It does not publish and does not insert WaiverRecord or WaiverSignature.
11. POST /api/admin/waivers/import and src/lib/waivers/importWaivers.ts still import historical signed guests and still refuse to replace a newer live signature.
12. New routes are in src/lib/auth/permissions.ts. A user without waivers:write cannot import a blueprint. Demo, Starter, and the default storefront still fail closed.
13. WaiverTemplateEditorPage can edit fields, clauses, mapsTo, layoutId, displayMode, allowDocumentExtract, and signature overrides, and can download and import a blueprint. src/services/waivers.ts matches those APIs.
14. WaiverSettingsPage can save notifyEmail.
15. evaluateWaiver.ts, booking waiver panel, party-chase, and yarn smoke:waivers:p1 through p5 still pass, or you ran them and pasted the failures that are yours to fix before calling Step 1 done.
16. No PHP from skylinepark was added to the Next app. No ID image column was added. No guest photo storage was added.

Report each item as PASS or FAIL with the file path that proves it. Then list anything the step asked for that you did not find. Do not begin Step 2 in this audit.
```

```text
START STEP 2 of the Digital Waivers guest-flow upgrade.
Step 1 must already be in the repo (presentation fields, blueprint import, template editor). Scan first. If any Step 1 audit item is missing, fix that gap before building Step 2. Execute ONLY Step 2. Do not build on-device OCR, the extract HTTP route, AWS backup, or the walk-in pass table. Those are Step 3. You may leave a disabled hook where the scan block will go, and it must stay hidden unless allowDocumentExtract is true. When that flag is true in Step 2, show the three choices (scan ID or document, scan a printed document, fill manually) but the scan choices must explain that reading a photo arrives in the next step and must still offer Fill manually as a working path. Do not pretend a photo was read.

Before coding, scan the files listed in Step 1 again, plus src/components/waivers/SignWaiverForm.tsx, src/components/waivers/KioskWaiverScreen.tsx, src/lib/waivers/capture.ts (especially readSignature, sanitizeDrawn, and the sign transaction), src/lib/waivers/kiosk.ts, src/lib/waivers/signToken.ts, src/lib/waivers/desk.ts, src/lib/waivers/exportWaivers.ts, src/lib/waivers/records.ts, src/components/Protected/admin/pages/waivers/WaiverRecordDetailPage.tsx, WaiverResponsesPage.tsx, BookingWaiverPanel.tsx, and the public sign and kiosk routes. Read evaluateWaiver.ts and do not invent a second validity status.

Guest experience. One shared renderer used by both SignWaiverForm and KioskWaiverScreen, for example src/components/waivers/WaiverGuestFlow.tsx plus src/components/waivers/SignaturePad.tsx. Keep the pages src/app/sign/[token]/page.tsx and src/app/kiosk/waivers/[deviceToken]/page.tsx as the routes. Brand colors come from the existing session brand (resolveBrandForOrg / the brand already returned to the sign page). Gold #D4AF37 and stone/gray stay the fallback. Do not copy Skyline purple, stamp buttons, or legal sentences.

The published version’s displayMode chooses the structure.
multi_step shows one block at a time with a progress rail. Order: confirm venue, email, fill method only if document extract is enabled, details, agreement and signature, then the existing receipt.
single_page shows those same blocks on one scroll.
grid lays short guest fields in a responsive two-column flex or grid on a wide screen and one column on a narrow screen. Agreement and signature are full width under the grid.
accordion keeps one section open at a time on a single page.
layoutId changes density and chrome among the ten presets stored in Step 1 (classic, two_column, cards, wizard, kiosk_compact, agreement_focus, numbered_rail, accordion, split, checklist). agreement_focus shows clauses before identity fields. split places details and agreement side by side on a wide screen and stacked on a phone. checklist makes the clause progress the visual focus. kiosk_compact uses larger type. Presets must not introduce a second color system.

Blocks to implement inside that renderer.
Confirm venue using the venue name already on the session. If the session has a booking or product label, show it and require “Yes, this is my park” before continue on multi_step. There is no control that changes org or venue.
Email. If the signing token already fixed the email, show it locked. Otherwise collect it.
Details render the published fields, not a hardcoded Skyline form. date fields use a month, day, and year picker. phone fields include a searchable country dial list defaulting to US +1, stored with the number. address fields support manual entry always. Typeahead only if you add a server proxy you control; do not send keystrokes from the browser to a third party. minor_repeater shows “Me and minor(s)” and “Just me”. Just me submits no minor rows. Minor count cannot exceed WaiverSettings.maxMinorsPerGuardianSession (already capped at 20 in settings.ts).
Custom fields that do not mapsTo a signer slot are still shown and stored.
Agreement renders published bodyHtml through the existing sanitizer, then one checkbox per required clause field. A sticky line reads how many of the required clauses are checked, in the form “N / M checkboxes complete”. Unchecked required clauses are highlighted and the view scrolls to the first gap. Never set a clause checkbox to checked from code. The only automatic checkbox allowed anywhere is an “enter address manually” control when a later scan fills an address (Step 3). If the published version has zero clause fields, keep today’s single intent checkbox so old templates still sign.
Signature. Build a pointer pad: pointer capture, coalesced move samples, scroll locked while the finger is down, clear, and status text that switches from not signed to signature captured. Serialize strokes to an SVG that sanitizeDrawn in capture.ts already accepts. Do not store JPEG or PNG data URLs. Typed legal name is a text field. When typed signature is enabled, the typed value must match the adult first and last name (case-insensitive, spaces collapsed). When both drawn and typed are enabled, both are required. When only one is enabled, only that one is required. When both are disabled, required clauses (or the legacy intent checkbox) are enough and the API must not demand a signature. Resolve enablement as version override if set, otherwise WaiverSettings.
Document extract flag off hides the fill-method block entirely. Flag on shows the three choices, with manual fill working now.

Server capture in src/lib/waivers/capture.ts.
Accept the clause id map. Reject the sign when any required clause is missing or not true. Persist the accepted clause ids and labels on WaiverSignature.acceptedClauses.
Apply the signature rules above inside readSignature. Remove the branch that treats typed OR drawn as enough when both settings are on.
Keep contentSha256 mismatch rejection.
Store extra answers and clause answers in FormResponse.payloadJson linked to the waiver record, which is the table that already exists. Do not add a parallel answers table.
Set WaiverRecord.fillMethod to manual when the guest did not scan. Leave scan and document values for Step 3. Null remains valid for old rows.
One WaiverRecord per covered person and shared waiverGroupId stay as they are. Guardian and minor signer rows stay on WaiverSigner.
Replay of the same sign must still return the existing receipt and must not create a second signature.
Kiosk POST /api/public/waivers/kiosk/[deviceToken] uses the same validation as the public sign POST.
On-site staff signing (POST /api/admin/waivers/records and WaiverOnsitePage) must create a session the same renderer can complete, or submit through the same capture function. Staff are not the signer. Do not let a staff user bypass required clauses.

Desk and neighbors, update so they show the new data without changing validity:
WaiverRecordDetailPage lists accepted clause labels, whether a drawn signature exists, the typed name, and fillMethod. It already shows the signature image for staff. Keep SVG rendering safe.
GET /api/admin/waivers/records/[id] returns those fields.
exportWaivers.ts may add columns for fillMethod and a clause-accepted count or joined labels. Do not add the SVG to the CSV. Do not remove existing columns.
WaiverResponsesPage and GET /api/admin/waivers/responses still list FormResponse rows and now include the extra field answers that were stored in payloadJson.
evaluateWaiver.ts, bookingHooks.ts, BookingWaiverPanel, GET/POST /api/admin/waivers/party-chase, membership plan waiverRequired, and reminder emails stay on the same status words. A signed record with clauses is still a signed record. Do not mark someone unsigned because a display mode changed.
Historical import (src/lib/waivers/importWaivers.ts) does not have to supply acceptedClauses. Imported rows remain historical and still must not replace a newer live signature.
Guest confirmation email from the existing sendWaiverGuestEmail call in capture.ts should include the accepted clause labels in the HTML body. Do not attach an ID image. Inlining the SVG is allowed only if the mailer already sends HTML. Do not block the HTTP response on a slow mailbox: keep the current timeout behavior, and if you move the send to after the response is committed, a replay must still send at most one guest email. Venue notifyEmail is Step 3. Do not send a second staff mailbox in this step unless it already happens today.
Template editor preview from Step 1 should now be able to open the same WaiverGuestFlow in a preview mode with sample values, without creating a WaiverRecord.

Client service types in src/services/waivers.ts must include acceptedClauses and fillMethod on the record detail.

Tests. Add scripts/smoke-waivers-guest-flow.mts and package.json script smoke:waivers:guest-flow, or extend an existing waiver smoke if that is the local pattern, covering: required clause missing is rejected, zero-clause template still accepts the legacy intent checkbox, both signatures required when both are enabled, typed name mismatch rejected, signature omitted when both toggles are off, blueprint draft from Step 1 still does not create WaiverRecord rows. Run yarn smoke:waivers:p1 through p5 and this new script. Fix failures you caused.

When Step 2 is done, list files changed and confirm OCR files and walk-in pass tables were not added. Do not start Step 3.
```

```text
FOLLOW-UP AUDIT FOR STEP 2 of the Digital Waivers guest-flow upgrade.
Do not implement Step 3. Do not add Tesseract, image upload routes, walk-in pass rows, or a venue notification email. Scan the repo and mark every item PASS or FAIL. Fix only Step 2 gaps, then re-check. End with a skipped-work list. An empty skipped-work list is required before Step 3.

1. src/app/sign/[token]/page.tsx and src/app/kiosk/waivers/[deviceToken]/page.tsx still mount the guest UI, and both use one shared flow component rather than two divergent forms.
2. displayMode multi_step, single_page, grid, and accordion all render the same published fields. You verified each mode with a draft or published fixture, not only the default single page.
3. All ten layout ids render without throwing: classic, two_column, cards, wizard, kiosk_compact, agreement_focus, numbered_rail, accordion, split, checklist. agreement_focus shows clauses before identity. split stacks on a narrow viewport.
4. Required clause checkboxes start unchecked. Nothing in the client sets them checked. The N / M line matches the required clause count. Submit stays blocked until each required clause is checked.
5. A published template with zero clause fields still signs with the legacy intent checkbox.
6. capture.ts rejects a missing required clause, rejects a typed name that does not match first plus last when typed signature is on, requires both drawn SVG and typed name when both are enabled, and accepts clauses only when both signature toggles are off.
7. Drawn signatures are SVG paths accepted by sanitizeDrawn. No data-URL images are stored on WaiverSignature.drawnSignatureSvg.
8. Accepted clause ids and labels are stored on WaiverSignature.acceptedClauses. Extra answers are in FormResponse.payloadJson. WaiverRecord.fillMethod is manual for a non-scan sign.
9. Replay does not insert a second WaiverSignature and does not send a second guest email.
10. WaiverRecordDetailPage and GET /api/admin/waivers/records/[id] show clauses, typed name, drawn signature, and fillMethod. Export CSV has no SVG and still has the previous columns.
11. evaluateWaiver, booking waiver panel, and party-chase still use the existing status set. A complete sign still counts as signed for those screens.
12. Historical POST /api/admin/waivers/import behavior is unchanged.
13. On-site sign and kiosk sign use the same clause and signature rules as the public link.
14. allowDocumentExtract false hides the scan choices. allowDocumentExtract true does not claim a photo was parsed.
15. Demo, Starter, storefront, and unpaid orgs still cannot call staff waiver APIs. Public sign still binds to the token, not to a client-supplied orgId.
16. yarn smoke:waivers:p1 through p5 and the guest-flow smoke pass.
17. Step 3 files are absent: no extract route, no walk-in pass model, no ID image column.

Report each item as PASS or FAIL with a file path. List skipped Step 2 work. Do not begin Step 3 in this audit.
```

```text
START STEP 3 of the Digital Waivers guest-flow upgrade.
Steps 1 and 2 must already be in the repo. Scan first. If any Step 1 or Step 2 audit item is missing, fix it before adding Step 3. This step adds document and ID reading, venue mail, the kiosk walk-in pass, and the remaining sync. Do not rebuild the template editor or the guest layouts except where they must call the new extract and pass APIs.

Scan skylinepark/js/waiver-ocr-local.js and skylinepark/js/aamva-id.js for behavior only. Port the ideas into TypeScript under src/lib/waivers/. Do not copy Skyline secrets from waiver-id-scan-config.php or waiver-smtp-config.php. Do not add PHP routes.

Document extract, shipped but optional.
Create src/lib/waivers/extractGuestDocument.ts (browser parsing helpers that can run on the client: label lines, date normalization, minor N first name, last name, and date of birth, AAMVA PDF417 when you add a barcode library). OCR runs in the browser first (tesseract.js or the same on-device approach). Image prep: accept jpeg and png, reject non-images, max 6 MB, normalize to a jpeg data URL in memory, try the likeliest rotation first, stop when name plus date of birth plus address or phone are strong, one grayscale rescue, merge an optional second page.
The guest UI in WaiverGuestFlow, only when the published allowDocumentExtract is true, offers Scan ID or document, Scan a printed document, and Fill manually. Front photo required, extra page optional, file upload and rear camera. Camera uses getUserMedia only in a secure context (https or localhost). Otherwise tell the guest to upload. Show a checklist dialog with copyable placeholder labels (First name:, Last name:, Date of birth:, phone, street, city, state, postal code, emergency contact, Minor 1 first name, and so on through the minor cap). Do not use real people’s sample identities from Skyline.
On success, fill mapped fields, show which labels were filled, and list “Finish these next” jumps for required fields still empty. Remember scanned minors and apply them only when “Me and minor(s)” is selected. Switching to Just me drops minor rows. If the guest switches back, reapply the last scanned minors. Mark filled inputs so the guest can see they came from the photo. Discard image bytes from component state when extract finishes, when the guest leaves the step, and when they choose manual. Do not write image bytes to WaiverRecord, FormResponse, disk, or logs.
On failure, stay on the scan step with a manual fallback. A failed read must never block signing.
Set fillMethod to scan or document only after a successful extract. Manual stays manual. If the guest already extracted and later edits fields, keep the successful fillMethod.
Checkboxes for clauses stay guest-ticked. The only auto-check is the manual-address toggle when an address was extracted.

Server backup, optional.
POST /api/public/waivers/sign/[token]/extract and POST /api/public/waivers/kiosk/[deviceToken]/extract. Both require the same token checks as the sign GET. Both use publicWaiverRateLimit (tighter if you add a second bucket, still fail closed). If allowDocumentExtract is false on the published version, respond 403 and do not call a cloud API. If the cloud env documented in docs/waivers-env.md is missing, respond with a manual fallback and do not throw a stack trace to the guest. Timeout about 12 seconds. Return structured fields only. Do not persist the image. Local OCR success must not wait on this route. Wire the client to call it only when local parsing is too weak.
Register these public routes the same way other public waiver routes are allowed through the app middleware. Staff API_PERMISSIONS do not apply to the public token routes; do not accidentally require a tenant JWT. Still never trust a body orgId. The token is the tenant.

Walk-in pass, kiosk and on-site only.
Add model WaiverWalkinPass with id, orgId, locationId, guestProfileId, expiresAt, revokedAt, createdAt. Index orgId plus locationId. Cascade with the org. Relation on VenueLocation and GuestProfile. Include it in companyExport counts next to the other waiver counts in src/lib/companyExport.ts.
After a successful kiosk sign or staff-assisted on-site sign, create a pass for 90 minutes for that guest at that location. Public emailed signing links must not create a pass.
Kiosk success offers continue while the pass is valid and New guest which sets revokedAt. Continuing must not require a second signature for another plan at that same location during the 90 minutes. When the pass is expired or revoked, the next guest goes through the full form. Store this on the server. A localStorage flag alone is not enough.
Add the small admin or kiosk routes you need, for example POST /api/public/waivers/kiosk/[deviceToken]/walkin/revoke, and document them. Rate limit them. A pass for location A must not authorize location B.

Mail.
Guest email already goes out through sendWaiverGuestEmail from capture.ts. Include accepted clause labels and fillMethod. Do not attach photos.
When WaiverSettings.notifyEmail is set for that location (else the org-default settings row), send one staff email to that address with signer name, minors, clause labels, fillMethod, public ref, and venue name. No signature image file and no ID image. Use the existing mailer and brand resolver. Send after the sign response is committed, or within the existing short timeout, so the guest is not stuck on “Submitting”. Replay must not send a second guest email or a second staff email.
Do not add a Vercel cron. Reminders stay on the existing waivers-remind path.

Sync checklist you must update or explicitly verify:
src/lib/waivers/capture.ts fillMethod and mail.
src/lib/waivers/kiosk.ts session includes allowDocumentExtract and walk-in pass state.
src/lib/waivers/desk.ts and WaiverRecordDetailPage show fillMethod values scan and document.
src/lib/waivers/exportWaivers.ts includes fillMethod and does not include images.
src/lib/waivers/evaluateWaiver.ts unchanged in status vocabulary. A scan-filled waiver is valid only after it is signed, same as a typed one.
bookingHooks.ts, BookingWaiverPanel, party-chase, and membership waiverRequired still key off signed records, not off fillMethod.
importWaivers.ts historical CSV unchanged.
contentHash.ts already covers the flag from Step 1. Do not hash image bytes.
docs/waivers-env.md documents the optional extract provider env and states that missing env means manual fill only.
permissions.ts or the public route allowlist includes the new extract and revoke paths.
scripts/smoke-waivers-guest-flow.mts (or the Step 2 script) gains cases: extract route 403 when the flag is off, extract does not persist an image when the flag is on and env is missing, walk-in pass expires and is location-scoped, public email sign does not create a pass, blueprint import still does not create signed rows.
Run yarn smoke:waivers:all and yarn smoke:waivers:guest-flow.

Non-goals remain: no check-in scanner, no ticket-purchase kiosk, no POS terminal, no PHP port, no stored ID photos, no auto-checked legal clauses, no Starter entitlement change, no second waiver database.

When Step 3 is done, list every file and route you added or updated, and state that guest signing, kiosk, desk, export, booking panel, party chase, historical import, reminders, and company export all still agree on WaiverRecord as the signed store.
```

```text
FOLLOW-UP AUDIT FOR STEP 3 of the Digital Waivers guest-flow upgrade.
This is the final check. Do not start a new feature. Scan the repo and mark every item PASS or FAIL. Fix only gaps that Steps 1 through 3 required, then re-check. End with a skipped-work list. The upgrade is complete only when that list is empty and the smokes pass.

1. Step 1 is still true: blueprint CSV and xlsx, draft-only import, ten layout ids, four display modes, template editor, notifyEmail, content hash includes presentation, historical import still separate.
2. Step 2 is still true: shared guest flow, clause N / M count, clauses never auto-checked, SVG signatures, both signatures required only when both are enabled, zero-clause legacy intent still works, desk and export show clauses without putting SVG in the CSV.
3. allowDocumentExtract false means the scan block is hidden and POST extract on the sign token and on the kiosk token returns 403.
4. allowDocumentExtract true runs on-device reading first. A successful read sets fillMethod to scan or document, prefills mapped fields, can create minor rows only in the minors mode, and clears image data from state afterward.
5. A failed read leaves manual fill available and still allows submit once clauses and signatures (as configured) are complete.
6. No waiver table, FormResponse payload, log line, or disk path stores the ID or document image. Search the diff for data URLs being written to Prisma.
7. Cloud extract is skipped when docs/waivers-env.md vars are unset, and the guest still gets a manual fallback. No Skyline AWS keys are in the repo.
8. WaiverWalkinPass exists, is created only for kiosk or on-site success, lasts 90 minutes, revoke sets revokedAt, and a pass for one location does not satisfy another location. A public emailed link does not create a pass.
9. Guest email includes clause labels and fillMethod. Staff email goes only to WaiverSettings.notifyEmail when that field is set. Replay does not double-send. The sign HTTP response is not held open for a long SMTP wait.
10. evaluateWaiver, BookingWaiverPanel, party-chase, and membership waiverRequired still treat a fully signed record as signed, including records whose fillMethod is scan or document.
11. companyExport includes a count or export of WaiverWalkinPass for the org and still exports the previous waiver counts.
12. Reminders, void, resend, QR signage, and kiosk device rotate still work. You did not add a third Vercel cron.
13. yarn smoke:waivers:p1, p2, p3, p4, p5, and smoke:waivers:guest-flow pass. Paste the command results.
14. Demo, Starter, default storefront, and unpaid orgs still fail closed on staff waiver routes. Public routes still resolve the tenant from the token.
15. Files that must exist or be updated, confirm each one: src/lib/waivers/blueprint.ts, src/lib/waivers/extractGuestDocument.ts, src/lib/waivers/contentHash.ts, src/lib/waivers/templates.ts, src/lib/waivers/capture.ts, src/lib/waivers/kiosk.ts, src/components/waivers/WaiverGuestFlow.tsx, src/components/waivers/SignaturePad.tsx, src/components/Protected/admin/pages/waivers/WaiverTemplateEditorPage.tsx, src/components/Protected/admin/pages/waivers/WaiverRecordDetailPage.tsx, src/services/waivers.ts, src/lib/auth/permissions.ts, docs/waivers-env.md, scripts/smoke-waivers-guest-flow.mts, and the extract routes under src/app/api/public/waivers/sign/[token]/extract/route.ts and src/app/api/public/waivers/kiosk/[deviceToken]/extract/route.ts.

Report PASS or FAIL per item with the file that proves it. Then write “Skipped implementations:” and either “none” or the exact missing behavior. Do not call the upgrade complete while any required item is FAIL.
```
