# Setup Notes — Bainbridge Single-Location

## Script Properties

All of these must be set in Apps Script → Project Settings → Script Properties.
None of these values belong in source code.

| Property key           | What it is                                              |
|------------------------|---------------------------------------------------------|
| `CALENDAR_ID`          | Google Calendar ID for the Bainbridge booking calendar  |
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

**Hardcoded constants (not Script Properties — intentional):**
- `TWILIO_NUM: '+12065550111'` — the Twilio sending number
- `MANAGER_PHONE: '+12065550100'` — Bainbridge manager SMS number

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

**Column O must have a data-validation dropdown** restricted to:
- `Approved - Free`
- `Approved - Paid`
- `Denied`

The script never writes to column O. Only the manager does.

## Trigger setup

Run `setupTriggers()` once manually from the Apps Script editor toolbar.
This deletes all existing triggers and creates:

| Function                  | Interval  |
|---------------------------|-----------|
| `syncCalendarBookings`    | every 5 min  |
| `checkRentalEligibility`  | every 5 min  |
| `sendLeaseToNewBookings`  | every 15 min |
| `processReminders`        | every 30 min |

## Apps Script web app deployment

After deploying as a Web App (Deploy → New deployment → Web app):
- Set "Execute as" = Me
- Set "Who has access" = Anyone
- Copy the deployment URL — this is the URL the Pipedream workflows POST to, not a URL you register directly with Stripe or DocuSeal

## Pipedream workflows

Pipedream sits between external services (Stripe, DocuSeal, Dropbox Sign) and Apps Script. It normalises the raw webhook payloads into the two shapes that `doPost` expects. Do not register the Apps Script URL directly with Stripe or DocuSeal — always route through Pipedream.

**Three active workflows:**

### 1. Stripe Connection to Google App
- **Trigger:** HTTP webhook receiving a Stripe-related payload
- **Pipedream steps:** Extracts `customerEmail` and `amountPaid` from the Stripe event
- **POSTs to Apps Script:**
  ```json
  { "customerEmail": "...", "amountPaid": "..." }
  ```
- **Setup:** Point the Stripe webhook (in the Stripe Dashboard) at this Pipedream workflow's HTTP trigger URL

### 2. DocuSeal Workflow
- **Trigger:** HTTP webhook from DocuSeal
- **Pipedream steps:** Filters to completed signature events only; skips the manager signing role; extracts `signerEmail`
- **POSTs to Apps Script:**
  ```json
  { "type": "lease_signed", "signerEmail": "..." }
  ```
- **Setup:** Register this Pipedream workflow's URL in DocuSeal as the webhook endpoint

### 3. Dropbox Sign → Google App
- **Trigger:** HTTP webhook from Dropbox Sign (HelloSign)
- **Pipedream steps:** Filters to signature completed events; extracts `signerEmail`
- **POSTs to Apps Script:**
  ```json
  { "type": "lease_signed", "signerEmail": "..." }
  ```
- **Setup:** Register this Pipedream workflow's URL in Dropbox Sign as the event callback URL

**Pipedream → Apps Script URL:** Set the Apps Script web app deployment URL as the destination in each workflow's final POST step. Update this URL any time the Apps Script is re-deployed as a new version.

**Future (v9):** Each Pipedream workflow will be updated to include `siteId` and `eventId` in the outbound payload. This allows `doPost` to route directly to the correct site's sheet without searching all sheets. No structural workflow change is needed — only an additional field in the final POST step.

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
