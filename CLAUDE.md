# CLAUDE.md — Reliable Storage Truck Rental Automation

## What this repo is

Google Apps Script automation for Reliable Storage truck rentals.
Currently scoped to the single Bainbridge location.
The script lives in Google Apps Script (not Node.js) — it cannot be run locally.

## Repo layout

```
src/Code.js           ← working copy — paste this into Apps Script
archive/v7-original.js ← unmodified v7 source, never edit
docs/setup-notes.md   ← Script Properties, trigger setup, sheet columns
docs/testing-plan.md  ← step-by-step Bainbridge flow test checklist
```

## Rules for editing src/Code.js

- Column O (Rental Approved) is manager-only. The script must NEVER write to it.
  Valid values are set only by the manager: `Approved - Free` / `Approved - Paid` / `Denied`.
- Columns P and Q (Approval Notified At / Approval Reminder Count) are the script's
  only state for the approval reminder loop. Do not remove or rename them.
- All secrets and URLs must remain in Script Properties — never hardcoded in CONFIG.
- TWILIO_NUM and MANAGER_PHONE are hardcoded constants (not Script Properties) —
  that is intentional; they are not secrets.

## How to deploy

1. Open the Google Sheet → Extensions → Apps Script
2. Replace all code with the contents of `src/Code.js`
3. Set Script Properties (see docs/setup-notes.md)
4. Run `setupTriggers()` once from the editor toolbar

## Branch strategy

- `main` — Bainbridge single-location baseline (this branch)
- `refactor/multi-site` — multi-location work (not started yet)

Do not begin multi-site work on main.

## Key integrations

| Service   | Purpose                        | Config key(s)                              |
|-----------|--------------------------------|--------------------------------------------|
| Stripe    | Deposit payment + webhook      | STRIPE_PAYMENT_URL, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET |
| DocuSeal  | E-signature lease              | DOCUSEAL_KEY                               |
| SendGrid  | HTML email                     | SENDGRID_KEY                               |
| Twilio    | SMS                            | TWILIO_SID, TWILIO_TOKEN                   |
| Bitly     | URL shortening in SMS          | BITLY_TOKEN                                |
| G Calendar| Booking source                 | CALENDAR_ID                                |
| G Forms   | Intake + inspection pre-fill   | INTAKE_FORM_BASE, INSPECT_FORM_BASE        |
