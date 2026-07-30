# CLAUDE.md — Reliable Storage Vehicle Rental Automation

## What this repo is

Google Apps Script automation for Reliable Storage vehicle rentals.
Supports multiple locations and vehicle types via `CALENDAR_CONFIGS`.
The script lives in Google Apps Script (not Node.js) — it cannot be run locally.

## Repo layout

```
src/                   ← working copy — paste each file into Apps Script
  Config.js            ← PROPS, CONFIG, CALENDAR_CONFIGS
  CalendarSync.js      ← syncCalendarBookings()
  Notifications.js     ← sendSms(), sendEmailHtml(), alertAdmin()
  Reminders.js         ← processReminders()
  Approval.js          ← checkRentalEligibility(), notifyCustomerOfApproval()
  Leases.js            ← sendLeaseToNewBookings()
  DocuSeal.js          ← sendLeaseViaDocuSeal(), extractDocuSealSubmissionId()
  Webhooks.js          ← doPost(), doGet(), markDepositPaid(), markLeaseSigned()
  Forms.js             ← buildIntakeUrl(), buildInspectUrl(), onFormSubmit() dispatcher,
                          processIntakeFormSubmission_(), processInspectionFormSubmission_()
  Helpers.js           ← getSheet(), extraction helpers, formatters, shouldNotifyCustomerOfApproval()
  Setup.js             ← setupTriggers(), setupSheetSchema()
  SandboxTests.js      ← manual test functions (never trigger these)
docs/manager-guide.md       ← nontechnical guide for location managers
docs/setup-notes.md         ← Script Properties, trigger setup, sheet columns
docs/testing-plan.md        ← acceptance-test checklist + current validation status
docs/operations-runbook.md  ← day-to-day operational quick-reference
docs/production-rollout.md  ← sandbox-to-production migration plan (not yet executed)
docs/architecture-proposal.md    ← historical — multi-site proposal; superseded by the
                                    CALENDAR_CONFIGS-based design actually implemented
docs/production-diff-summary.md  ← historical — v7 → v8 diff analysis, questions resolved
docs/sandbox-plan.md             ← historical — see README.md §14 for current sandbox setup
```

## Rules for editing src/

- Column O (Rental Approved) is manager-only. The script must NEVER write to it.
  Valid values are set only by the manager: `Approved - Free` / `Approved - Paid` / `Denied`.
- Columns P and Q (Approval Notified At / Approval Reminder Count) are the script's
  only state for the approval reminder loop. Do not remove or rename them.
- Column U (Customer Approval Notified) is written only after both O is approved AND
  N (Lease Signed) = Yes — never send the customer approval notice on approval alone.
- Columns V, W, X (Intake / Pre-Inspection / Post-Inspection Form Completed) are written only
  by the ambiguity-safe form-submission matchers in Forms.js — never guess a row when a
  submission could match more than one booking.
- There is exactly one spreadsheet-bound `onFormSubmit` trigger (installed by
  `installFormSubmitTrigger_()` in Setup.js). It dispatches by response-tab name — do not add a
  second form-submit trigger; Apps Script does not support two on the same spreadsheet.
- All secrets, URLs, phone numbers, and email addresses must remain in Script Properties —
  never hardcoded in CONFIG.
- `CALENDAR_CONFIGS` in Config.js is the single source of truth for locations, vehicle types,
  and calendar IDs. Setup.js derives its dropdown validation lists from it.
- Adding a new vehicle type requires updating `CALENDAR_CONFIGS`, the lookup tables in
  `Helpers.js` (`getDepositAmount`, `getStripePriceId`), and `CONFIG` in Config.js.
  Adding a new location that uses an existing vehicle type requires only `CALENDAR_CONFIGS`.

## How to deploy

1. Open the Google Sheet → Extensions → Apps Script
2. For each `src/*.js` file, create a matching script file and paste its contents
3. Set Script Properties (see docs/setup-notes.md)
4. Run `setupTriggers()` once from the editor toolbar — creates all five triggers (four
   time-based engines plus the `onFormSubmit` dispatcher) and applies sheet schema

Ordinary source-only changes (`clasp push` or re-pasting a file) do not require re-running
`setupTriggers()` — every trigger always runs the current saved project code. Re-run it only when
the trigger set itself changes. A new Web App deployment (Deploy → Manage deployments → New
version) is a separate step needed only when `doPost`/`doGet` (`Webhooks.js`) must change — the
deployed web app serves whichever version was active at its last deployment, not the latest saved
source automatically.

**Environment:** this repository is currently validated only in a sandbox environment — see
README.md "Repository status" and docs/production-rollout.md before assuming any instruction here
describes a production deployment.

## Branch strategy

- `main` — active multi-site implementation
- `feature/multisite-architecture` — historical planning branch (early architecture proposal
  and Pipedream design notes); fully superseded by the multi-site work that landed on `main`,
  which took a different, simpler design than what this branch proposed

## Key integrations

| Service   | Purpose                        | Config key(s)                                                             |
|-----------|--------------------------------|---------------------------------------------------------------------------|
| Stripe    | Deposit payment + webhook      | STRIPE_SECRET_KEY, STRIPE_PRICE_ID_CARGO_VAN, STRIPE_PRICE_ID_MOVING_TRUCK (dynamic Checkout Sessions, capture_method=manual) |
| DocuSeal  | E-signature lease              | DOCUSEAL_KEY, DOCUSEAL_TEMPLATE_SINGLE, DOCUSEAL_TEMPLATE_TWO_DRIVERS     |
| SendGrid  | HTML email                     | SENDGRID_KEY, FROM_EMAIL, REPLY_TO_EMAIL                                  |
| Twilio    | SMS                            | TWILIO_SID, TWILIO_TOKEN (sender number is per-location — PHONE_BAINBRIDGE, PHONE_POULSBO, etc., not a single CONFIG.TWILIO_NUM) |
| G Calendar| Booking source (multi-site)    | CALENDAR_ID_BAINBRIDGE_CARGO_VAN, CALENDAR_ID_POULSBO_MOVING_TRUCK, etc. |
| G Forms   | Intake + inspection pre-fill   | INTAKE_FORM_BASE, INSPECT_FORM_BASE (+ entry ID properties); both forms' responses land in tabs of the same spreadsheet as Bookings, read via one onFormSubmit dispatcher — no separate response spreadsheet or Script Property |
