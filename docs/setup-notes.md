# Setup Notes — Reliable Storage Truck Rental Automation

## Source code structure

The Apps Script source is split across multiple files in `src/`. Each file holds one logical group of functions:

| File | Contents |
|---|---|
| `Config.js` | `PROPS`, `CONFIG`, `CALENDAR_CONFIGS` — all configuration and Script Property bindings |
| `Forms.js` | `buildIntakeUrl`, `buildInspectUrl` |
| `DocuSeal.js` | `sendLeaseViaDocuSeal` |
| `Webhooks.js` | `doPost`, `doGet`, `markDepositPaid`, `markLeaseSigned` |
| `CalendarSync.js` | `syncCalendarBookings` |
| `Leases.js` | `sendLeaseToNewBookings` |
| `Approval.js` | `checkRentalEligibility` |
| `Reminders.js` | `processReminders` |
| `Notifications.js` | `sendSms`, `sendEmailHtml`, `alertAdmin` |
| `Helpers.js` | `getSheet`, `getExistingEventIds`, extraction helpers, `toDate`, date formatters, `getDepositAmount`, `getStripePaymentUrl` |
| `Setup.js` | `setupTriggers`, `setupSheetSchema` |
| `SandboxTests.js` | Manual test functions — never wire to triggers |

**All files share one global scope.** Google Apps Script loads every `.js` file in the project into the same execution environment. Functions defined in one file call functions defined in another without any import or export syntax. There is no module system.

**All files must be deployed together.** When copying code into Apps Script, every `src/*.js` file must be present as its own script file in the project. Deploying a subset will produce "function not defined" errors at runtime.

**Load order does not matter.** No file has top-level code that depends on another file being loaded first. `CONFIG`, `PROPS`, and `CALENDAR_CONFIGS` are declared in `Config.js` and referenced inside function bodies elsewhere.

**How to deploy:**
1. Open the Apps Script project (Extensions → Apps Script from the Google Sheet).
2. For each file in `src/`, create a matching script file in the Apps Script editor and paste its contents.
3. Alternatively, use [clasp](https://github.com/google/clasp) to push all `src/*.js` files at once.
4. Set all Script Properties (see below), then run `setupTriggers()` once from the editor toolbar.

## Script Properties

All of these must be set in Apps Script → Project Settings → Script Properties.
None of these values belong in source code.

### Identity and routing

| Property key     | What it is                                                    |
|------------------|---------------------------------------------------------------|
| `SHEET_ID`       | Google Spreadsheet ID (from the sheet URL)                    |
| `SHEET_NAME`     | Name of the booking tab in the spreadsheet — normally `Bookings` |
| `COMPANY_NAME`   | Business name used in all customer-facing emails and SMS      |
| `ADMIN_EMAIL`    | Escalation address for approval reminders and script errors   |
| `MANAGER_EMAIL`  | Site manager — BCC'd on all customer emails, receives booking and approval notices |
| `MANAGER_PHONE`  | Site manager phone number in E.164 format (e.g. +12065551234) |

### Google Calendar (one per site/vehicle)

| Property key                            | What it is                                |
|-----------------------------------------|-------------------------------------------|
| `CALENDAR_ID_BAINBRIDGE_CARGO_VAN`      | Google Calendar ID — Bainbridge Cargo Van      |
| `CALENDAR_ID_POULSBO_MOVING_TRUCK`      | Google Calendar ID — Poulsbo Moving Truck      |
| `CALENDAR_ID_PORT_ORCHARD_MOVING_TRUCK` | Google Calendar ID — Port Orchard Moving Truck |
| `CALENDAR_ID_FAIRGROUNDS_MOVING_TRUCK`  | Google Calendar ID — Fairgrounds Moving Truck  |

Calendars with an unset property are silently skipped at sync time. You can add a new site by adding an entry to `CALENDAR_CONFIGS` in `Config.js` and setting its property here.

### Stripe

| Property key                       | What it is                                                               |
|------------------------------------|--------------------------------------------------------------------------|
| `STRIPE_PAYMENT_URL_CARGO_VAN`     | Public Stripe payment link for the Cargo Van deposit                     |
| `STRIPE_PAYMENT_URL_MOVING_TRUCK`  | Public Stripe payment link for the Moving Truck deposit                  |
| `STRIPE_PAYMENT_URL`               | Fallback payment link (used only for rows with a blank Vehicle Type col) |

### Deposit amounts (customer-facing)

| Property key                  | What it is                                       |
|-------------------------------|--------------------------------------------------|
| `DEPOSIT_AMOUNT_CARGO_VAN`    | Dollar amount shown in SMS/email (e.g. `50`)     |
| `DEPOSIT_AMOUNT_MOVING_TRUCK` | Dollar amount shown in SMS/email (e.g. `100`)    |
| `DEPOSIT_AMOUNT`              | Fallback amount for rows with a blank Vehicle Type col |

### Twilio (SMS)

| Property key   | What it is                    |
|----------------|-------------------------------|
| `TWILIO_SID`   | Twilio Account SID            |
| `TWILIO_TOKEN` | Twilio Auth Token             |
| `TWILIO_NUM`   | From-number in E.164 format   |

### SendGrid (email)

| Property key     | What it is                                                                       |
|------------------|----------------------------------------------------------------------------------|
| `SENDGRID_KEY`   | SendGrid API key — must have the **Mail Send** permission scope                  |
| `FROM_EMAIL`     | Sender address for all outbound emails — must be a verified sender in SendGrid   |
| `FROM_NAME`      | Display name shown in the From field of every outbound email                     |
| `REPLY_TO_EMAIL` | Reply-to address on all customer emails (typically the site manager's address)   |

`ADMIN_EMAIL` and `MANAGER_EMAIL` (listed under Identity and routing above) are also consumed by the email system: `MANAGER_EMAIL` is automatically BCC'd on all customer-facing emails; `ADMIN_EMAIL` receives script error alerts and approval escalations.

**SendGrid sender verification**: `FROM_EMAIL` must be either a verified single sender or belong to an authenticated domain in your SendGrid account. A valid API key alone is not sufficient — unverified senders produce HTTP 403 errors that are logged and trigger an admin alert.

### DocuSeal (e-signature)

| Property key                      | What it is                                     |
|-----------------------------------|------------------------------------------------|
| `DOCUSEAL_API_KEY`                | DocuSeal API key (X-Auth-Token)                |
| `DOCUSEAL_TEMPLATE_ONE_DRIVER`    | Template ID for single-driver lease (numeric)  |
| `DOCUSEAL_TEMPLATE_TWO_DRIVERS`   | Template ID for two-driver lease (numeric)     |

Role names in DocuSeal templates must match exactly what the script sends:
- Single driver: `Driver #1`, `Reliable Storage Manager`
- Two drivers: `Driver #1`, `Driver #2`, `Reliable Storage Manager`

### Intake Form (Form 1)

| Property key         | What it is                                      |
|----------------------|-------------------------------------------------|
| `INTAKE_FORM_BASE`   | Google Form base URL for the intake form        |
| `INTAKE_ENTRY_NAME`  | Form entry ID for the customer name field       |
| `INTAKE_ENTRY_EMAIL` | Form entry ID for the email field               |
| `INTAKE_ENTRY_PHONE` | Form entry ID for the phone field               |
| `INTAKE_ENTRY_DATE`  | Form entry ID for the rental date field         |

### Inspection Form (Form 2)

| Property key          | What it is                                              |
|-----------------------|---------------------------------------------------------|
| `INSPECT_FORM_BASE`   | Google Form base URL for the inspection form            |
| `INSPECT_ENTRY_NAME`  | Form entry ID for the customer name field               |
| `INSPECT_ENTRY_EMAIL` | Form entry ID for the email field                       |
| `INSPECT_ENTRY_DATE`  | Form entry ID for the rental date field                 |
| `INSPECT_ENTRY_TYPE`  | Form entry ID for the inspection type dropdown          |
| `INSPECT_VAL_PRE`     | Form value for the pre-trip option (exact choice text)  |
| `INSPECT_VAL_POST`    | Form value for the post-trip option (exact choice text) |

### Webhooks

| Property key            | What it is                                                          |
|-------------------------|---------------------------------------------------------------------|
| `WEBHOOK_SHARED_SECRET` | Shared secret validating Pipedream → Apps Script requests (see below) |

## Google Sheet setup

Sheet tab must be named `Bookings` (exact, case-sensitive).

Row 1 headers (columns A–T). Columns R and S are written by `syncCalendarBookings()` and set up by `setupSheetSchema()`:

| Col | Header                  | Written by         |
|-----|--------------------------|--------------------|
| A   | Event ID                | syncCalendarBookings |
| B   | Customer Name           | syncCalendarBookings |
| C   | Email                   | syncCalendarBookings |
| D   | Phone                   | syncCalendarBookings |
| E   | Start Time              | syncCalendarBookings |
| F   | End Time                | syncCalendarBookings |
| G   | Deposit Paid            | markDepositPaid (webhook) |
| H   | Stripe Amount           | markDepositPaid (webhook) |
| I   | Intake Sent             | syncCalendarBookings |
| J   | Lease Sent              | markDepositPaid / sendLeaseToNewBookings |
| K   | 24hr Sent               | processReminders   |
| L   | Post-Rental Sent        | processReminders   |
| M   | Second Driver Email     | syncCalendarBookings |
| N   | Lease Signed            | markLeaseSigned (webhook) |
| O   | Rental Approved         | **Manager only** — script never writes this |
| P   | Approval Notified At    | checkRentalEligibility |
| Q   | Approval Reminder Count | checkRentalEligibility |
| R   | Vehicle Type            | syncCalendarBookings (from CALENDAR_CONFIGS) |
| S   | Location                | syncCalendarBookings (from CALENDAR_CONFIGS) |
| T   | DocuSeal Submission ID  | markDepositPaid / sendLeaseToNewBookings (via sendLeaseViaDocuSeal) |

**Column O** must have a data-validation dropdown restricted to:
- `Approved - Free`
- `Approved - Paid`
- `Denied`

The script never writes to column O. Only the manager does.

**Columns R and S** have dropdown validation applied automatically by `setupSheetSchema()`. The dropdown values are derived directly from `CALENDAR_CONFIGS`, so adding a new calendar config entry automatically updates the dropdowns.

## Trigger setup

Run `setupTriggers()` once manually from the Apps Script editor toolbar.
This deletes all existing project triggers and registers four new ones:

| Function                  | Interval     |
|---------------------------|--------------|
| `syncCalendarBookings`    | every 5 min  |
| `checkRentalEligibility`  | every 5 min  |
| `sendLeaseToNewBookings`  | every 15 min |
| `processReminders`        | every 30 min |

`setupTriggers()` also calls `setupSheetSchema()` to apply column headers and dropdown validation.

## Apps Script web app deployment

After deploying as a Web App (Deploy → New deployment → Web app):
- Set "Execute as" = Me
- Set "Who has access" = Anyone
- Copy the deployment URL — this is the URL the Pipedream workflows POST to, not a URL you register directly with Stripe or DocuSeal

## Pipedream workflows

Pipedream sits between external services (Stripe and DocuSeal) and Apps Script. It validates upstream signatures, normalises raw payloads, adds the shared secret, and POSTs to Apps Script. Do not register the Apps Script URL directly with Stripe or DocuSeal — always route through Pipedream.

**Two active workflows:**

### 1. Stripe Connection to Google App
- **Trigger:** HTTP webhook receiving a Stripe-related payload
- **Pipedream steps:** Validates Stripe signature; extracts `customerEmail` and `amountPaid`; adds `secret`
- **POSTs to Apps Script:**
  ```json
  { "secret": "...", "customerEmail": "...", "amountPaid": "..." }
  ```
- **Setup:** Point the Stripe webhook (in the Stripe Dashboard) at this Pipedream workflow's HTTP trigger URL

### 2. DocuSeal Workflow
- **Trigger:** HTTP webhook from DocuSeal
- **Pipedream steps:** Validates DocuSeal request; filters to completed signature events only; skips the manager signing role; extracts `signerEmail`; adds `secret`
- **POSTs to Apps Script:**
  ```json
  { "secret": "...", "type": "lease_signed", "signerEmail": "..." }
  ```
- **Setup:** Register this Pipedream workflow's URL in DocuSeal as the webhook endpoint

## Webhook shared secret setup

The shared secret prevents arbitrary POST requests from triggering side effects in `doPost`.

### Generate the secret

```bash
openssl rand -hex 32
```

### Set in Apps Script

Apps Script → Project Settings → Script Properties:
- Key: `WEBHOOK_SHARED_SECRET`
- Value: the generated hex string

### Set in each Pipedream workflow

In each workflow's final POST step, include the same hex string as the `secret` field in the JSON body.

### Test unauthorized POST fails safely

```bash
curl -X POST "<your-apps-script-url>" \
  -H "Content-Type: application/json" \
  -d '{"customerEmail":"test@example.com","amountPaid":50}'
```

Expected: `{ "received": true }` returned, zero rows updated, zero emails or SMS sent, rejection logged in Apps Script execution log.

### Test authorized Stripe payload

```bash
curl -X POST "<your-apps-script-url>" \
  -H "Content-Type: application/json" \
  -d '{"secret":"<your-secret>","customerEmail":"<email-in-sheet>","amountPaid":50}'
```

Expected: matching row updated, confirmation email and SMS sent, DocuSeal lease triggered, column J set to Yes.

### Test authorized DocuSeal payload

```bash
curl -X POST "<your-apps-script-url>" \
  -H "Content-Type: application/json" \
  -d '{"secret":"<your-secret>","type":"lease_signed","signerEmail":"<email-in-sheet>"}'
```

Expected: matching row's Lease Signed column (N) set to Yes.

## Approval reminder behavior (v7+)

- Q = 0: no notification sent yet → sends initial email → sets P = now, Q = 1
- Q = 1 or 2, hours since P ≥ 12: sends reminder → increments Q
- Q = 3, hours since P ≥ 12: escalates to ADMIN_EMAIL → sets Q = 4 (permanent skip)
- Q > 3: row is silently skipped forever
- Manager sets column O to resolve; script skips all resolved rows
