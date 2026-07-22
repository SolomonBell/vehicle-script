# Setup Notes — Bainbridge Single-Location

> **Before making any changes:** Pull Andrew's latest script from the shared Google Drive folder. Save it as `archive/current-production-from-andrew.js` and replace `src/Code.js` with that version. Do not implement from `archive/v7-original.js`.

## Source code structure

The Apps Script source is split across multiple files in `src/`. Each file holds one logical group of functions:

| File | Contents |
|---|---|
| `Config.js` | `PROPS`, `CONFIG` — all configuration and Script Property bindings |
| `Forms.js` | `buildIntakeUrl`, `buildInspectUrl` |
| `DocuSeal.js` | `sendLeaseViaDocuSeal` |
| `Webhooks.js` | `doPost`, `doGet`, `markDepositPaid`, `markLeaseSigned`, `verifyStripeSignature`, `computeHmacSha256` |
| `CalendarSync.js` | `syncCalendarBookings` |
| `Leases.js` | `sendLeaseToNewBookings` |
| `Approval.js` | `checkRentalEligibility` |
| `Reminders.js` | `processReminders` |
| `Notifications.js` | `shortenUrl`, `shortenUrlsInText`, `sendSms`, `sendEmailHtml`, `alertAdmin` |
| `Helpers.js` | `getSheet`, `getExistingEventIds`, extraction helpers, `toDate`, date formatters |
| `Setup.js` | `setupTriggers` |
| `Code.js` | Header comment and file map only — no code |

**All files share one global scope.** Google Apps Script loads every `.js` file in the project into the same execution environment. Functions defined in one file call functions defined in another without any import or export syntax. There is no module system.

**All files must be deployed together.** When copying code into Apps Script, every `src/*.js` file must be present as its own script file in the project. Deploying a subset will produce "function not defined" errors at runtime.

**Load order does not matter.** No file has top-level code that depends on another file being loaded first. `CONFIG` and `PROPS` are declared in `Config.js` and referenced inside function bodies elsewhere — function bodies are not executed until the function is called, by which time all files have been parsed.

**How to deploy:**
1. Open the Apps Script project (Extensions → Apps Script from the Google Sheet).
2. For each file in `src/`, create a matching script file in the Apps Script editor and paste its contents. The filename in Apps Script does not need to match exactly, but keeping the same names makes it easier to track.
3. Alternatively, use [clasp](https://github.com/google/clasp) to push all `src/*.js` files at once from the command line.
4. Set all Script Properties (see below), then run `setupTriggers()` once from the editor toolbar.

## Script Properties

All of these must be set in Apps Script → Project Settings → Script Properties.
None of these values belong in source code.

| Property key           | What it is                                              |
|------------------------|---------------------------------------------------------|
| `CALENDAR_ID_BAINBRIDGE_CARGO_VAN`      | Google Calendar ID — Bainbridge Cargo Van      |
| `CALENDAR_ID_POULSBO_MOVING_TRUCK`      | Google Calendar ID — Poulsbo Moving Truck      |
| `CALENDAR_ID_PORT_ORCHARD_MOVING_TRUCK` | Google Calendar ID — Port Orchard Moving Truck |
| `CALENDAR_ID_FAIRGROUNDS_MOVING_TRUCK`  | Google Calendar ID — Fairgrounds Moving Truck  |
| `STRIPE_PAYMENT_URL`   | Public Stripe payment link for the $50 deposit          |
| `STRIPE_SECRET_KEY`    | Stripe secret key (sk_live_...)                         |
| `STRIPE_WEBHOOK_SECRET`| Stripe webhook signing secret (whsec_...)               |
| `TWILIO_SID`           | Twilio Account SID                                      |
| `TWILIO_TOKEN`         | Twilio Auth Token                                       |
| `SENDGRID_KEY`         | SendGrid API key (SG....)                               |
| `DOCUSEAL_KEY`         | DocuSeal API key (X-Auth-Token)                         |
| `INTAKE_FORM_BASE`     | Google Form base URL for the intake form (Form 1)       |
| `INSPECT_FORM_BASE`    | Google Form base URL for the inspection form (Form 2)   |
| `BITLY_TOKEN`          | Bitly generic access token (for SMS URL shortening)     |
| `WEBHOOK_SHARED_SECRET`| Shared secret validating Pipedream → Apps Script requests (see Webhook shared secret section) |

## Google Sheet setup

Sheet must be named `Bookings` (exact, case-sensitive).

Row 1 headers (columns A–Q):

| Col | Header                  |
|-----|-------------------------|
| A   | Event ID                |
| B   | Customer Name           |
| C   | Email                   |
| D   | Phone                   |
| E   | Start Time              |
| F   | End Time                |
| G   | Deposit Paid            |
| H   | Stripe Amount           |
| I   | Intake Sent             |
| J   | Lease Sent              |
| K   | 24hr Sent               |
| L   | Post-Rental Sent        |
| M   | Second Driver Email     |
| N   | Lease Signed            |
| O   | Rental Approved         |
| P   | Approval Notified At    |
| Q   | Approval Reminder Count |
| R   | Vehicle Type            |
| S   | Location                |

**Column O must have a data-validation dropdown** restricted to:
- `Approved - Free`
- `Approved - Paid`
- `Denied`

The script never writes to column O. Only the manager does.

## Trigger setup

Run `setupTriggers()` once manually from the Apps Script editor toolbar.
This deletes all existing triggers and creates per-site wrapper functions on their own schedules. Each wrapper runs in an independent 6-minute execution budget so a slow site cannot block another.

**Single-site (Bainbridge only):**

| Function                           | Interval     |
|------------------------------------|--------------|
| `syncCalendarBookings_Bainbridge`  | every 5 min  |
| `checkRentalEligibility_Bainbridge`| every 5 min  |
| `sendLeaseToNewBookings_Bainbridge`| every 15 min |
| `processReminders_Bainbridge`      | every 30 min |

When a second site is added, `setupTriggers()` registers an equivalent set for that site (e.g., `syncCalendarBookings_Poulsbo`, etc.).

## Apps Script web app deployment

After deploying as a Web App (Deploy → New deployment → Web app):
- Set "Execute as" = Me
- Set "Who has access" = Anyone
- Copy the deployment URL — this is the URL the Pipedream workflows POST to, not a URL you register directly with Stripe or DocuSeal

## Pipedream workflows

Pipedream sits between external services (Stripe and DocuSeal) and Apps Script. It validates upstream signatures, normalises raw payloads, adds the shared secret, and POSTs to Apps Script. Do not register the Apps Script URL directly with Stripe or DocuSeal — always route through Pipedream.

**DocuSeal is the active signature provider.** Any Dropbox Sign workflow visible in historical Pipedream screenshots is legacy — ignore it.

**Two active workflows:**

### 1. Stripe Connection to Google App
- **Trigger:** HTTP webhook receiving a Stripe-related payload
- **Pipedream steps:** Validates Stripe signature where possible; extracts `customerEmail` and `amountPaid`; adds `secret`
- **POSTs to Apps Script:**
  ```json
  { "secret": "...", "customerEmail": "...", "amountPaid": "..." }
  ```
- **Setup:** Point the Stripe webhook (in the Stripe Dashboard) at this Pipedream workflow's HTTP trigger URL

### 2. DocuSeal Workflow
- **Trigger:** HTTP webhook from DocuSeal
- **Pipedream steps:** Validates DocuSeal request where possible; filters to completed signature events only; skips the manager signing role; extracts `signerEmail`; adds `secret`
- **POSTs to Apps Script:**
  ```json
  { "secret": "...", "type": "lease_signed", "signerEmail": "..." }
  ```
- **Setup:** Register this Pipedream workflow's URL in DocuSeal as the webhook endpoint

**Pipedream → Apps Script URL:** Set the Apps Script web app deployment URL as the destination in each workflow's final POST step. Update this URL whenever the Apps Script is re-deployed as a new version.

**Future (v9):** Each workflow will also include `siteId` and `eventId` in the outbound payload so `doPost` can route directly to the correct site without searching all sheets. No structural workflow change is required — only an extra field in the final POST step.

## Webhook shared secret setup

The shared secret prevents arbitrary POST requests from triggering any side effects in `doPost`. The same value must be set in Apps Script Script Properties and in each Pipedream workflow.

### Generate the secret

```bash
openssl rand -hex 32
```

Copy the output. Treat it like a password — do not commit it to source control.

### Set in Apps Script

Apps Script → Project Settings → Script Properties → Add property:
- Key: `WEBHOOK_SHARED_SECRET`
- Value: the generated hex string

### Set in each Pipedream workflow

In each workflow's environment variables (or in the final POST step as a hardcoded field):
- Add the same hex string as the value for `secret` in the JSON body POSTed to Apps Script

Both the Stripe and DocuSeal workflows must include it.

### Test unauthorized POST fails safely

Send a POST to the Apps Script web app URL with no `secret` field:

```bash
curl -X POST "<your-apps-script-url>" \
  -H "Content-Type: application/json" \
  -d '{"customerEmail":"test@example.com","amountPaid":50}'
```

Expected: `{ "received": true }` returned, zero rows updated, zero emails or SMS sent, rejection logged in Apps Script execution log.

Repeat with a wrong secret value — same expected result.

### Test authorized Stripe payload works

```bash
curl -X POST "<your-apps-script-url>" \
  -H "Content-Type: application/json" \
  -d '{"secret":"<your-secret>","customerEmail":"<email-in-sheet>","amountPaid":50}'
```

Expected: matching row's deposit column updated, confirmation email and SMS sent to customer, DocuSeal lease triggered, column J set to Yes.

### Test authorized DocuSeal payload works

```bash
curl -X POST "<your-apps-script-url>" \
  -H "Content-Type: application/json" \
  -d '{"secret":"<your-secret>","type":"lease_signed","signerEmail":"<email-in-sheet>"}'
```

Expected: matching row's Lease Signed column (N) set to Yes.

### Rotating the secret

If the secret must be rotated: update Pipedream workflows first, then update Apps Script Script Properties within seconds. Avoid rotating during active booking hours. A brief window of mismatched secrets will cause Pipedream POSTs to be rejected silently (logged only) until both sides are in sync.

## DocuSeal template IDs

| Template                    | ID      |
|-----------------------------|---------|
| Single driver               | 1234567 |
| Two drivers                 | 7654321 |

Role names in DocuSeal templates must match exactly:
- Single driver template: `Driver`, `Reliable Storage Manager`
- Two-driver template: `Driver #1`, `Driver #2`, `Reliable Storage Manager`

## Approval reminder behavior (v7)

- Q = 0: no notification sent yet → sends initial email → sets P = now, Q = 1
- Q = 1 or 2, hours since P >= 12: sends reminder → increments Q
- Q = 3, hours since P >= 12: escalates to ADMIN_EMAIL → sets Q = 4 (permanent skip)
- Q > 3: row is silently skipped forever
- Manager sets column O to resolve; script skips all resolved rows
