# CLAUDE.md — Reliable Storage Truck Rental Automation

## What this repo is

Google Apps Script automation for Reliable Storage truck rentals.
Supports multiple locations and vehicle types via `CALENDAR_CONFIGS`.
The script lives in Google Apps Script (not Node.js) — it cannot be run locally.

## Repo layout

```
src/                   ← working copy — paste each file into Apps Script
  Config.js            ← PROPS, CONFIG, CALENDAR_CONFIGS
  CalendarSync.js      ← syncCalendarBookings()
  Notifications.js     ← sendSms(), sendEmailHtml(), alertAdmin()
  Reminders.js         ← processReminders()
  Approval.js          ← checkRentalEligibility()
  Leases.js            ← sendLeaseToNewBookings()
  DocuSeal.js          ← sendLeaseViaDocuSeal()
  Webhooks.js          ← doPost(), doGet(), markDepositPaid(), markLeaseSigned()
  Forms.js             ← buildIntakeUrl(), buildInspectUrl()
  Helpers.js           ← getSheet(), extraction helpers, formatters
  Setup.js             ← setupTriggers(), setupSheetSchema()
  SandboxTests.js      ← manual test functions (never trigger these)
archive/v7-original.js ← unmodified v7 source, never edit
docs/setup-notes.md   ← Script Properties, trigger setup, sheet columns
docs/testing-plan.md  ← step-by-step flow test checklist
```

## Rules for editing src/

- Column O (Rental Approved) is manager-only. The script must NEVER write to it.
  Valid values are set only by the manager: `Approved - Free` / `Approved - Paid` / `Denied`.
- Columns P and Q (Approval Notified At / Approval Reminder Count) are the script's
  only state for the approval reminder loop. Do not remove or rename them.
- All secrets, URLs, phone numbers, and email addresses must remain in Script Properties —
  never hardcoded in CONFIG.
- `CALENDAR_CONFIGS` in Config.js is the single source of truth for locations, vehicle types,
  and calendar IDs. Setup.js derives its dropdown validation lists from it.
- Adding a new vehicle type requires updating `CALENDAR_CONFIGS`, the lookup tables in
  `Helpers.js` (`getDepositAmount`, `getStripePaymentUrl`), and `CONFIG` in Config.js.
  Adding a new location that uses an existing vehicle type requires only `CALENDAR_CONFIGS`.

## How to deploy

1. Open the Google Sheet → Extensions → Apps Script
2. For each `src/*.js` file, create a matching script file and paste its contents
3. Set Script Properties (see docs/setup-notes.md)
4. Run `setupTriggers()` once from the editor toolbar

## Branch strategy

- `main` — active multi-site implementation
- `refactor/multi-site` — not needed; multi-site work landed on main

## Key integrations

| Service   | Purpose                        | Config key(s)                                                             |
|-----------|--------------------------------|---------------------------------------------------------------------------|
| Stripe    | Deposit payment + webhook      | STRIPE_PAYMENT_URL_CARGO_VAN, STRIPE_PAYMENT_URL_MOVING_TRUCK, STRIPE_PAYMENT_URL (fallback) |
| DocuSeal  | E-signature lease              | DOCUSEAL_KEY, DOCUSEAL_TEMPLATE_SINGLE, DOCUSEAL_TEMPLATE_TWO_DRIVERS     |
| SendGrid  | HTML email                     | SENDGRID_KEY, FROM_EMAIL, REPLY_TO_EMAIL                                  |
| Twilio    | SMS                            | TWILIO_SID, TWILIO_TOKEN, TWILIO_NUM                                      |
| G Calendar| Booking source (multi-site)    | CALENDAR_ID_BAINBRIDGE_CARGO_VAN, CALENDAR_ID_POULSBO_MOVING_TRUCK, etc. |
| G Forms   | Intake + inspection pre-fill   | INTAKE_FORM_BASE, INSPECT_FORM_BASE (+ entry ID properties)               |
