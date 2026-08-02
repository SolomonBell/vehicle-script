# Reliable Storage — Vehicle Rental Automation

> **Currently in sandbox validation, not yet cut over to production.** Automates the complete
> vehicle rental workflow for Reliable Storage across four locations and two vehicle types — from
> calendar booking through post-rental inspection follow-up — with no manual staff intervention
> required for the routine lifecycle once validated. See [Repository status](#repository-status)
> below and [docs/production-rollout.md](docs/production-rollout.md) for exactly what has and has
> not been verified yet.

> **Not a developer?** If you're a Reliable Storage manager or supervisor looking for a
> plain-language explanation of how to use this system day to day, see the
> **[Manager Guide](docs/manager-guide.md)** instead of this technical README.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Rental Workflow](#2-rental-workflow)
3. [System Architecture](#3-system-architecture)
4. [Repository Structure](#4-repository-structure)
5. [Source File Reference](#5-source-file-reference)
6. [Bookings Sheet](#6-bookings-sheet)
7. [Google Forms](#7-google-forms)
8. [Script Properties Reference](#8-script-properties-reference)
9. [DocuSeal Integration](#9-docuseal-integration)
10. [Stripe Integration](#10-stripe-integration)
11. [Notifications](#11-notifications)
12. [Approval State Machine](#12-approval-state-machine)
13. [Webhook Security](#13-webhook-security)
14. [Sandbox Environment](#14-sandbox-environment)
15. [Testing](#15-testing)
16. [Development Workflow](#16-development-workflow)
17. [Deployment](#17-deployment)
18. [Adding a New Location](#18-adding-a-new-location)
19. [Adding a New Vehicle Type](#19-adding-a-new-vehicle-type)
20. [Troubleshooting](#20-troubleshooting)
21. [Known Limitations and Future Work](#21-known-limitations-and-future-work)
22. [Code Style](#22-code-style)

---

## 1. Project Overview

Reliable Storage is a Pacific Northwest storage and moving vehicle rental company with locations
across the Kitsap Peninsula. This repository contains the Google Apps Script automation that
handles every step of the vehicle rental process from the moment a customer books through the
post-rental inspection follow-up.

### Repository status

**Environment:** Sandbox. The code in `src/` has been deployed and exercised in a sandbox Apps
Script project bound to a sandbox Google Sheet, sandbox Google Forms, and test-mode Stripe/DocuSeal
credentials. It has **not** been cut over to a production Apps Script project or production Script
Properties. See [docs/production-rollout.md](docs/production-rollout.md) for the migration plan
and [docs/testing-plan.md](docs/testing-plan.md) for the acceptance-test checklist.

**Validated in the sandbox environment** (confirmed working end-to-end):
- Calendar booking sync (`syncCalendarBookings`)
- Welcome/intake message delivery
- Stripe payment/authorization flow (Checkout Session → webhook → deposit marked paid)
- DocuSeal lease delivery
- Lease signing (DocuSeal webhook → Lease Signed = Yes)
- Manager approval (request, decision, reminder stop)
- Customer approval gating and notification (waits for both approval and signature)
- Intake completion tracking (`onFormSubmit` → column V)
- Trigger installation (`setupTriggers()` creates all five triggers correctly)

**Still awaiting final operational validation** (implemented and believed correct from code
review, but not yet confirmed by a live sandbox run):
- Automatic 24-hour reminder firing on schedule
- Manager 24-hour greeting/summary (including the new location-specific greeting)
- Pre-trip inspection completion update (column W, with actual form-submission timestamp)
- Post-trip reminder firing exactly one hour after pre-trip inspection completion
- Manager post-trip notice
- Post-trip inspection completion update (column X, with actual form-submission timestamp)

Do not treat the items in the second list as passed. They require a booking to actually reach the
24-hour and post-rental windows (or a manually time-shifted test row) before they can be marked
validated — see [docs/testing-plan.md](docs/testing-plan.md).

### Active sites

| Location | Vehicle | Calendar Script Property |
|---|---|---|
| Bainbridge | Cargo Van | `CALENDAR_ID_BAINBRIDGE_CARGO_VAN` |
| Poulsbo | Moving Truck | `CALENDAR_ID_POULSBO_MOVING_TRUCK` |
| Port Orchard | Moving Truck | `CALENDAR_ID_PORT_ORCHARD_MOVING_TRUCK` |
| Fairgrounds | Moving Truck | `CALENDAR_ID_FAIRGROUNDS_MOVING_TRUCK` |

### What the system does automatically

- Detects new Google Calendar bookings every 5 minutes, creates a unique Stripe Checkout Session
  (authorization hold), and sends the customer a welcome message with the session URL and a
  pre-filled rental intake form URL
- Notifies the site manager of every new booking and initiates the manager approval loop
- Sends a DocuSeal e-signature lease to the customer (and second driver, if any) after the deposit
  clears; writes the DocuSeal submission ID to the sheet
- Monitors for manager approval and sends escalating reminders until the manager responds or the
  escalation cap is reached
- Sends a 24-hour pickup reminder (customer only, not the blank form to the manager) with a
  pre-filled pre-trip inspection form link, by both email and SMS; includes a deposit urgency
  notice if payment has not yet cleared
- Records the pre-trip inspection completion time when the customer submits the form, then sends
  the post-trip inspection prompt (email + SMS) exactly one hour after that recorded completion
  time — not from the booking's end time
- Routes all Stripe deposit and DocuSeal signing events through Pipedream into the Apps Script
  web app endpoint with shared-secret authentication

### Tech stack

| Layer | Technology |
|---|---|
| Automation runtime | Google Apps Script (V8) |
| Booking source | Google Calendar (Appointment Schedules) |
| System of record | Google Sheets (Bookings tab, columns A–Y) |
| E-mail | SendGrid REST API |
| SMS | Twilio REST API |
| E-signature | DocuSeal REST API |
| Payments | Stripe Checkout Sessions (manual authorization holds) |
| Webhook bridge | Pipedream |
| Forms | Google Forms (pre-filled URLs) |

### Core design principle

**The sheet is the only state.** The script holds no state between runs. Every execution reads the
current sheet data, decides what actions are needed based on flag columns, takes those actions,
and writes updated flags. Two executions on the same row always converge on the same outcome
because flag checks are idempotent.

---

## 2. Rental Workflow

### Linear flow

```
Customer books vehicle via Google Booking
            │
            ▼
  Google Calendar event created
            │
            ▼
  syncCalendarBookings detects event (every 5 min)
            │
            ▼
  Row appended to Bookings sheet (columns A–S initialized; T–Y populate later)
            │
            ├──▶  Welcome SMS + email sent to customer
            │       • Stripe Checkout Session URL (unique per booking;
            │         places an authorization hold on the card)
            │       • Pre-filled intake form URL
            │
            ├──▶  Manager notified (email + SMS)
            │
            └──▶  Intake Sent flag → Col I = Yes
                        │
                        ▼
            checkRentalEligibility begins approval loop
                        │
                  ┌─────┴────────────────────────────────────┐
                  │ Manager reviews and sets Col O to one of │
                  │  • Approved - Free                       │
                  │  • Approved - Paid                       │
                  │  • Denied                                │
                  └─────┬────────────────────────────────────┘
                        │
            ┌───────────┴───────────┐
            │                       │
            ▼                       ▼
         Denied                  Approved
         (done)                     │
                                    ▼
                  Customer completes Intake Form
                    • Name, email, phone, date
                    • Driver's license photo
                    • Insurance document
                         │
                         ▼
                  Customer pays deposit via Stripe Checkout Session
                    • Authorization hold placed (capture_method: manual)
                    • Manual capture or release in Stripe Dashboard
                         │
                         ▼
                  Stripe → Pipedream → doPost (markDepositPaid)
                    • Col G (Deposit Paid) = Yes
                    • Col H (Stripe Amount) = amount
                    • Deposit confirmation SMS + email sent
                         │
                         ▼
                  DocuSeal lease dispatched
                    • Customer (+ second driver if present) receives signing request
                    • Manager receives co-signer request
                    • Col J (Lease Sent) = Yes
                    • Col T (DocuSeal Submission ID) = submission ID
                         │
                         ▼
                  Customer (and second driver) signs lease
                         │
                         ▼
                  DocuSeal → Pipedream → doPost (markLeaseSigned)
                    • Col N (Lease Signed) = Yes
                         │
                         ▼
                  checkRentalEligibility sees Col N = Yes
                    • Customer approval email + SMS sent
                    • Col U (Customer Approval Notified) = Yes
                    (only fires once Col O was already an approved value;
                     if approval and signature arrive out of order, this
                     step waits until both are true)
                         │
                         ▼
                  processReminders — 24-hour window before pickup
                    • Col K (24hr Sent) = Yes (written BEFORE sending)
                    • Pre-trip reminder SMS + email to customer (same form
                      link sent by both channels; NOT sent to the manager)
                    • Manager notified with 24hr rental summary (location
                      greeting; no inspection link)
                         │
                         ▼
                  Customer submits pre-trip inspection form
                    • onFormSubmit dispatcher routes to
                      processInspectionFormSubmission_()
                    • Col W (Pre-Inspection Form Completed) =
                      "Yes <actual form-submission time>"
                         │
                         ▼
                  processReminders — fires on the first run at least one
                  hour after the Col W completion timestamp (not from
                  booking End Time, not from when the pre-trip reminder
                  was sent)
                    • Col L (Post-Rental Sent) = Yes (written BEFORE sending)
                    • Post-trip reminder SMS + email to customer (same form
                      link sent by both channels)
                    • Manager notified (location greeting)
                         │
                         ▼
                  Customer submits post-trip inspection form
                    • onFormSubmit dispatcher routes to
                      processInspectionFormSubmission_()
                    • Col X (Post-Inspection Form Completed) =
                      "Yes <actual form-submission time>"
                         │
                         ▼
                  Workflow complete
```

Neither W nor X currently gates any further step — they record completion only (Col W's
completion timestamp is also what the post-trip send timing above is measured from). Sending the
pre-trip inspection link is driven by time and the K flag column; sending the post-trip inspection
link is driven by the Col W completion timestamp and the L flag column (see the `Reminders.js —
Engine 3` entry in [Source File Reference](#5-source-file-reference)) — none of this is gated by
Deposit Paid, Lease Signed, or approval state.

### Implementation notes

- `syncCalendarBookings` extracts customer name, email, phone, and second driver email from the
  structured HTML in the Calendar event description — not from the event title. The event title
  typically contains only vehicle/location info.

- Deposit and approval can arrive in either order. `markDepositPaid` sends the lease immediately
  on payment (regardless of approval status). `sendLeaseToNewBookings` is a catch-up engine that
  runs every 15 minutes and sends the lease to any row where the deposit is paid and the lease
  has not yet been sent — covering the case where payment cleared before the lease was dispatched
  (e.g., approval came in after deposit, or a transient DocuSeal error on first attempt).

- Column O (`Rental Approved`) is enforced by a data-validation dropdown. The script never writes
  to this column under any circumstance. Only the site manager sets it.

- For each new booking, `syncCalendarBookings` calls `createStripeCheckoutSession()` to create a
  unique Stripe Checkout Session with `capture_method: manual`. This places an authorization hold
  on the customer's card rather than capturing immediately. The Google Calendar event ID (base64
  URL-safe encoded) is passed as `client_reference_id`. When Stripe fires the
  `checkout.session.completed` event, Pipedream passes the encoded event ID to `doPost` as
  `eventId`. `markDepositPaid` decodes it and matches the payment to the correct booking row by
  event ID first, falling back to email matching for older rows.

- Authorization holds expire after 7 days (up to 31 days for eligible merchants). Holds must be
  captured or released manually in the Stripe Dashboard before expiry. Automated capture and
  release is a planned future enhancement.

- The 24-hour reminder fires when `hoursUntilStart` is between 0 and 26, covering the full
  30-minute trigger interval without gaps. It only fires for approved bookings.

- If the deposit has not cleared when the 24-hour reminder fires, the reminder becomes an urgency
  notice directing the customer to check their original welcome email for the payment link.

- The post-trip inspection prompt fires on the first `processReminders` run where at least one
  hour has elapsed since the customer completed the pre-trip inspection form (column W's recorded
  completion timestamp), so in practice it fires between one hour and one hour plus the
  30-minute trigger interval after completion. It never fires if the pre-trip inspection has not
  been completed. This replaced the older `POST_RENTAL_HOURS`-after-end-time timing; that Script
  Property has been removed from `CONFIG` and is no longer required or read anywhere in the
  codebase (safe to leave set or delete from Script Properties either way).

- The manager is automatically BCC'd on customer-facing emails by default. Emails already addressed
  to the manager or admin are excluded from the BCC to avoid duplicate copies. The pre-trip and
  post-trip inspection customer emails are the exception: both are sent with
  `suppressManagerBcc = true` (see [Notifications.js](#notificationsjs) below), since the manager
  must not receive either blank inspection form, not even by BCC, before the customer submits it.

### Full workflow diagram

```mermaid
flowchart TD
    A([Customer books via Google Booking]) --> B[syncCalendarBookings detects\nnew Calendar event — every 5 min]
    B --> C[Row appended to Bookings sheet\nColumns A-S initialised; T-X populate later]
    C --> D[Welcome SMS and email sent\nDeposit link + intake form URL]
    C --> E[Manager notified by email and SMS]
    C --> F[checkRentalEligibility sends\napproval request to manager\nColumns P and Q updated]

    F --> G{Manager sets Column O}
    G -->|Denied| STOP([Booking closed])
    G -->|Approved - Free or Approved - Paid| H[Approval gate cleared]

    H --> I([Customer pays via Stripe Checkout Session\nAuthorization hold placed — manual capture])
    I --> J[Stripe → Pipedream validates + forwards\nPOST to doPost with shared secret + eventId]
    J --> K[markDepositPaid\nCol G = Yes · Col H = amount]
    K --> L[Deposit confirmation SMS and email]
    K --> M[DocuSeal lease dispatched\nCol J = Yes · Col T = submission ID]

    M --> N([Customer signs lease])
    N --> O[DocuSeal → Pipedream validates + forwards\nPOST to doPost with shared secret]
    O --> P[markLeaseSigned — Col N = Yes]
    P --> P2[checkRentalEligibility sees Col N = Yes\nand Col O already approved\nCustomer approval email/SMS sent — Col U = Yes]

    P2 --> Q[processReminders fires within\n24-26 hours of pickup — Col K = Yes]
    Q --> R[Pre-trip reminder SMS and email\nsame form link on both channels]
    R --> R2([Customer submits pre-trip inspection form])
    R2 --> R3[onFormSubmit dispatcher routes to\nprocessInspectionFormSubmission_\nCol W = Yes + submission timestamp]
    R3 --> S{processReminders: has 1 hour\nelapsed since Col W timestamp?}
    S -->|not yet| S
    S -->|yes — Col L = Yes| T[Post-trip reminder SMS and email\nsame form link on both channels]
    T --> U2([Customer submits post-trip inspection form])
    U2 --> U3[onFormSubmit dispatcher routes to\nprocessInspectionFormSubmission_\nCol X = Yes + submission timestamp]
    U3 --> V([Workflow complete])
```

---

## 3. System Architecture

### Three execution paths

The system has three independent execution paths that converge on Google Sheets as the shared
system of record.

```
┌─────────────────────────────────────────────────────┐
│                  TRIGGER PATH                       │
│  (time-based, runs continuously)                    │
│                                                     │
│  Google Calendar                                    │
│       │ polled every 5 min                          │
│       ▼                                             │
│  Apps Script Triggers                               │
│  ├─ syncCalendarBookings    (5 min)                 │
│  ├─ checkRentalEligibility  (5 min)                 │
│  ├─ sendLeaseToNewBookings  (15 min)                │
│  └─ processReminders        (30 min)                │
│       │                                             │
│       ▼                                             │
│  Google Sheets ◄──────────────── reads / writes     │
│       │                                             │
│       ├──▶ SendGrid  (emails)                       │
│       ├──▶ Twilio    (SMS)                          │
│       ├──▶ DocuSeal  (lease submissions)            │
│       └──▶ Google Forms (pre-filled URLs in msgs)   │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│                  WEBHOOK PATH                       │
│  (event-driven, fires on payment / signing)         │
│                                                     │
│  Stripe ──────┐                                     │
│               │ webhook events                      │
│  DocuSeal ────┤                                     │
│               ▼                                     │
│  Pipedream (validates signatures,                   │
│             normalises payloads,                    │
│             injects shared secret + eventId)        │
│               │                                     │
│               ▼                                     │
│  Apps Script Web App (doPost)                       │
│               │                                     │
│               ▼                                     │
│  Google Sheets ◄──────────────── reads / writes     │
│               │                                     │
│               ├──▶ SendGrid  (confirmation emails)  │
│               ├──▶ Twilio    (confirmation SMS)     │
│               └──▶ DocuSeal  (lease submissions)    │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│                FORM SUBMISSION PATH                 │
│  (event-driven, fires on Google Form submit)        │
│                                                     │
│  Customer submits intake or inspection form         │
│       │                                             │
│       ▼                                             │
│  Single spreadsheet-bound onFormSubmit trigger      │
│  (fires for ANY form linked to the Bookings         │
│   spreadsheet — both response tabs live there)      │
│       │                                             │
│       ▼                                             │
│  onFormSubmit(e) dispatcher (Forms.js)              │
│  routes by e.range.getSheet().getName():            │
│  ├─ "Rental Intake Form" →                          │
│  │    processIntakeFormSubmission_()                │
│  └─ "Rental Vehicle Condition Inspection Form" →    │
│       processInspectionFormSubmission_()            │
│       │                                             │
│       ▼                                             │
│  Google Sheets ◄──────────────── reads / writes     │
│       (Col V, W, or X; may trigger DocuSeal lease   │
│        send from the intake path)                   │
└─────────────────────────────────────────────────────┘
```

### Detailed architecture diagram

```mermaid
graph TB
    subgraph Source["Booking Source"]
        CUST([Customer])
        GCAL[(Google Calendar)]
    end

    subgraph GAS["Google Apps Script (12 source files)"]
        direction TB
        TRIGGERS["Time-based triggers
        syncCalendarBookings · 5 min
        checkRentalEligibility · 5 min
        sendLeaseToNewBookings · 15 min
        processReminders · 30 min"]
        ONFORMSUBMIT["onFormSubmit dispatcher
        (1 spreadsheet-bound trigger,
        routes by response tab name)"]
        DOPOST["doPost — Web app endpoint"]
    end

    subgraph RECORD["System of Record"]
        SHEETS[(Google Sheets — Bookings tab\nColumns A-Y)]
    end

    subgraph BRIDGE["Pipedream — Webhook Bridge"]
        PD["Stripe workflow · DocuSeal workflow"]
    end

    subgraph SERVICES["External Services"]
        direction LR
        STRIPE["Stripe\nCheckout Sessions\n(manual holds)"]
        DOCUSEAL["DocuSeal\nE-Signatures"]
        SENDGRID["SendGrid\nEmail"]
        TWILIO["Twilio\nSMS"]
        FORMS["Google Forms\nIntake · Inspection"]
    end

    CUST -->|books| GCAL
    GCAL -->|polled every 5 min| TRIGGERS
    TRIGGERS <-->|reads / writes| SHEETS
    TRIGGERS --> SENDGRID
    TRIGGERS --> TWILIO
    TRIGGERS --> DOCUSEAL
    TRIGGERS -.->|pre-filled URLs embedded in messages| FORMS

    CUST -->|pays via Checkout Session| STRIPE
    STRIPE -->|checkout.session.completed| PD
    DOCUSEAL -->|signing completed event| PD
    PD -->|normalised POST + shared secret| DOPOST

    DOPOST <-->|reads / writes| SHEETS
    DOPOST --> SENDGRID
    DOPOST --> TWILIO
    DOPOST --> DOCUSEAL

    CUST -->|submits intake or inspection form| FORMS
    FORMS -->|onFormSubmit event, both response tabs\nlive in the Bookings spreadsheet| ONFORMSUBMIT
    ONFORMSUBMIT <-->|reads / writes Col V, W, or X| SHEETS
    ONFORMSUBMIT -.->|intake path only, if deposit already paid| DOCUSEAL
```

### Multi-site design

Multiple locations and vehicle types are driven entirely by `CALENDAR_CONFIGS` in `Config.js` —
the single source of truth for which calendars to poll, which location they belong to, and which
vehicle type they serve:

```javascript
const CALENDAR_CONFIGS = [
  { propKey: 'CALENDAR_ID_BAINBRIDGE_CARGO_VAN',      calendarId: PROPS.CALENDAR_ID_BAINBRIDGE_CARGO_VAN,      location: 'Bainbridge',   vehicleType: 'Cargo Van' },
  { propKey: 'CALENDAR_ID_POULSBO_MOVING_TRUCK',      calendarId: PROPS.CALENDAR_ID_POULSBO_MOVING_TRUCK,      location: 'Poulsbo',      vehicleType: 'Moving Truck' },
  { propKey: 'CALENDAR_ID_PORT_ORCHARD_MOVING_TRUCK', calendarId: PROPS.CALENDAR_ID_PORT_ORCHARD_MOVING_TRUCK, location: 'Port Orchard', vehicleType: 'Moving Truck' },
  { propKey: 'CALENDAR_ID_FAIRGROUNDS_MOVING_TRUCK',  calendarId: PROPS.CALENDAR_ID_FAIRGROUNDS_MOVING_TRUCK,  location: 'Fairgrounds',  vehicleType: 'Moving Truck' },
];
```

`syncCalendarBookings` iterates every entry in one pass. Entries whose Script Property is not set
(`calendarId` is `undefined`) are silently skipped with a log entry. Each booking row records its
location and vehicle type in columns R and S, which drive per-vehicle deposit amounts and Stripe
Price IDs in all downstream messages.

`setupSheetSchema()` derives the column R and S dropdown validation lists directly from
`CALENDAR_CONFIGS`, so adding a new entry automatically extends both dropdowns on the next
`setupSheetSchema()` run.

**Vehicle-type resolution:** deposit amounts are looked up by vehicle type string in
`getDepositAmount()` in `Helpers.js`. Stripe Price IDs are looked up in `getStripePriceId()`.
Both use explicit object-map lookup tables. An unknown vehicle type in `getDepositAmount()` falls
back to the generic `DEPOSIT_AMOUNT` Script Property with a warning log entry; `getStripePriceId()`
returns `null` and logs a warning (callers throw if the Price ID is missing). Adding a new vehicle
type requires updating both lookup tables plus adding `CONFIG` entries and Script Properties. See
[Adding a New Vehicle Type](#19-adding-a-new-vehicle-type).

---

## 4. Repository Structure

```
src/                          ← working copy — paste each file into Apps Script
  Config.js                   ← PROPS, CONFIG, CALENDAR_CONFIGS
  CalendarSync.js             ← syncCalendarBookings() — Engine 1
  Leases.js                   ← sendLeaseToNewBookings() — Engine 2 (catch-up)
  Approval.js                 ← checkRentalEligibility() — Engine 2b
  Reminders.js                ← processReminders() — Engine 3
  Notifications.js            ← sendSms(), sendEmailHtml(), alertAdmin()
  DocuSeal.js                 ← sendLeaseViaDocuSeal(), extractDocuSealSubmissionId()
  Webhooks.js                 ← doPost(), doGet(), markDepositPaid(), markLeaseSigned()
  Forms.js                    ← buildIntakeUrl(), buildInspectUrl(),
                                 onFormSubmit() dispatcher,
                                 processIntakeFormSubmission_(),
                                 processInspectionFormSubmission_()
  Helpers.js                  ← getSheet(), extraction helpers, formatters,
                                 getDepositAmount(), getStripePriceId(),
                                 createStripeCheckoutSession(), getLocationConfig()
  Setup.js                    ← setupTriggers(), setupSheetSchema()
  SandboxTests.js             ← manual test functions — never wire to triggers

docs/
  manager-guide.md            ← nontechnical guide for location managers (start here if
                                 you are not a developer)
  setup-notes.md              ← Script Properties reference, sheet schema,
                                 trigger setup, Pipedream workflow config
  testing-plan.md             ← acceptance-test checklist + current validation status
  operations-runbook.md       ← day-to-day operational quick-reference
  production-rollout.md       ← sandbox-to-production migration plan (not yet executed)
  sandbox-plan.md             ← historical — see README.md §14 for current sandbox setup
  architecture-proposal.md    ← historical design notes from the multi-site migration
  production-diff-summary.md  ← v7 → v8 change analysis

CLAUDE.md                     ← context for AI-assisted development
README.md                     ← this file

.claude/
  settings.json                ← shared repository-level Claude Code permissions (committed)
  settings.local.json           ← personal, machine-specific overrides — gitignored, never committed
```

**All 12 `src/*.js` files share one global scope** when deployed to Google Apps Script. There is
no module system, no `import`, no `export`. Functions in one file call functions in another
freely. Load order between files is irrelevant — no file has top-level code that depends on
another file's declarations at parse time. `PROPS`, `CONFIG`, and `CALENDAR_CONFIGS` are declared
in `Config.js` and referenced inside function bodies in every other file.

---

## 5. Source File Reference

### Config.js

Owns all configuration. Runs at module-parse time (top-level code).

```javascript
const PROPS = PropertiesService.getScriptProperties().getProperties();
```

`PROPS` is a flat object of all Script Properties, loaded once per execution. Undefined properties
return `undefined` (not `null`) in Google Apps Script.

`CONFIG` is a plain object that maps internal key names to Script Property values. Numeric
properties are wrapped in `Number()` at this point so all downstream code receives the correct
type. `CALENDAR_CONFIGS` is an array of location/vehicle/calendar entries built from `PROPS`.

> **Important:** The internal CONFIG key names for DocuSeal differ from the Script Property
> names. `CONFIG.DOCUSEAL_KEY` reads from Script Property `DOCUSEAL_API_KEY`.
> `CONFIG.DOCUSEAL_TEMPLATE_SINGLE` reads from Script Property `DOCUSEAL_TEMPLATE_ONE_DRIVER`.
> This mapping is intentional — internal keys are stable; Script Property names match the
> external service's terminology.

---

### CalendarSync.js — Engine 1

**Function:** `syncCalendarBookings()`
**Trigger:** Every 5 minutes

Polls every calendar in `CALENDAR_CONFIGS`. For each event whose ID is not already in the sheet:
extracts customer data from the event description HTML, calls `createStripeCheckoutSession()` to
create a unique Stripe Checkout Session, appends a 19-column row (A–S; column T is left blank),
sends the welcome SMS and email with the session URL, notifies the manager, and marks column I
(Intake Sent) = `Yes`.

The Checkout Session is created with `capture_method: manual` (authorization hold) and with the
Google Calendar event ID (base64 URL-safe encoded via `Utilities.base64EncodeWebSafe`) as the
`client_reference_id`. Stripe includes this value in its `checkout.session.completed` webhook
event, which Pipedream passes to `doPost` as `eventId`. This allows `markDepositPaid` to match
payments to rows by event ID rather than by email alone.

If `createStripeCheckoutSession()` throws (Stripe API error), the per-event try/catch in
`syncCalendarBookings` calls `alertAdmin` — no row is appended and no messages are sent.

**Deduplication:** Uses event IDs, not the Intake Sent flag. `getExistingEventIds()` loads all
event IDs from column A before the loop. An event already in the sheet is skipped before any
message is sent.

---

### Leases.js — Engine 2 (catch-up)

**Function:** `sendLeaseToNewBookings()`
**Trigger:** Every 15 minutes

Scans all rows for bookings where the deposit is paid (G = Yes) but the lease has not been sent
(J ≠ Yes) and the booking is approved. Sends the DocuSeal lease and writes J = Yes and T =
submission ID. This is the catch-up path for cases where `markDepositPaid` could not send the
lease (e.g., DocuSeal was temporarily unreachable, or approval arrived after the deposit was paid).

---

### Approval.js — Engine 2b

**Function:** `checkRentalEligibility()`
**Trigger:** Every 5 minutes

Acquires a `LockService.getScriptLock()` with a 10-second timeout to prevent overlapping
executions, same pattern as `processReminders`. Drives the manager approval state machine using
columns P and Q. Only processes rows where column I (Intake Sent) = `Yes`. Skips rows where
column O (Rental Approved) has any decision value — manager reminders stop as soon as O is set.
Never writes to column O.

Once O is approved, sends the customer their one-time "your rental is approved" email only when
column N (Lease Signed) is also `Yes` — manager approval alone does not trigger it. If the lease
is not yet signed, the row is skipped and re-checked on the next run until the DocuSeal signed
webhook (`markLeaseSigned`) updates column N. Tracked in column U so it is never sent twice. See
[Approval State Machine](#12-approval-state-machine).

**Approval Reminder Count (column Q) — audited, no bug found.** Q is read with
`Number(data[i][16]) || 0` (blank, numeric, and numeric-string values are all interpreted
correctly), every write targets the same row it was read from, and Q is written only after the
manager email actually succeeds, so a failed send is retried rather than silently counted. No SMS
is sent for approval reminders, so email/SMS "double counting" is not possible. See
`testApprovalReminderCountBehavior()` in `SandboxTests.js` for the regression coverage, and
`docs/setup-notes.md`'s "Approval reminder behavior" section for the full trace.

---

### Reminders.js — Engine 3

**Function:** `processReminders()`
**Trigger:** Every 30 minutes

Acquires a `LockService.getScriptLock()` with a 10-second timeout to prevent overlapping
executions. Scans all rows and sends up to three types of messages:

- **Pre-trip reminder** — when `hoursUntilStart` is between 0 and 26 and column K is blank and
  the booking is approved (`isPreTripReminderEligible()` in `Helpers.js`). Sent to the customer
  by both SMS and email, with the pre-filled pre-trip inspection form link; states the form must
  be completed before driving the vehicle and that the post-trip form follows once pre-trip is
  done. Column K is written only after a successful send (see below) — a row missing approval or
  deposit is safely re-evaluated on every later run for as long as it stays inside the window. The
  manager's 24-hour summary email does not include the (blank, unsigned) inspection form link.
  Content is built by `buildPreTripReminderContent_()`.

- **Post-trip reminder** — when the customer has completed the pre-trip inspection form (column
  W holds a parseable `"Yes <timestamp>"` value, written by `processInspectionFormSubmission_()`
  in `Forms.js`) and at least one hour has elapsed since that recorded completion time, and column
  L is blank (`isPostTripReminderEligible()` in `Helpers.js`). This is evaluated fresh on every
  run, so the message goes out on the first run where the one-hour delay has actually elapsed —
  this is what makes the delay durable across separate Apps Script executions without any timer or
  sleep call. It never fires from the booking's End Time and never fires before the pre-trip
  inspection is completed. Content is built by `buildPostTripReminderContent_()`.

- **Suspicious inspection timing warning** — once both W and X hold a parseable completion
  timestamp and column Y is blank, computes the elapsed time between them
  (`getInspectionElapsedMinutes()`) and, if it is less than
  `CONFIG.SUSPICIOUS_INSPECTION_WINDOW_MINUTES` (`isSuspiciousInspectionTiming()`), sends a
  neutral, manager-only warning (`sendSuspiciousInspectionTimingWarning_()`) and writes column Y.
  Purely informational — never blocks or alters the workflow, never sent to the customer, and
  never contains a customer-facing form link. See [Suspicious inspection
  timing](#suspicious-inspection-timing-warning) below.

All three follow the same "delivered/sent only after success" pattern as `notifyCustomerOfApproval()`
(`Approval.js`): the flag column is written only after a successful send, and — for the two
customer-facing reminders — a row with neither phone nor email on file is treated as delivered to
avoid endless retry. Rows older than 48 hours past end time with both K and L set are skipped to
limit the scan window, **except** when column Y is still blank and column X already holds a
completion timestamp — that combination is kept in the scan so a late-arriving post-trip
submission on an old booking still gets its suspicious-timing check.

The old `POST_RENTAL_HOURS`-after-end-time timing has been replaced by the pre-trip-completion-based
timing above. The `POST_RENTAL_HOURS` Script Property has been removed from `CONFIG` and from
`validateConfig()`'s required-property list, since nothing reads it anymore.

### Immediate inspection sends (Reminders.js)

`sendPreTripInspectionNowForRow(rowNumber)` and `sendPostTripInspectionNowForRow(rowNumber)` call
`sendPreTripReminder_()` / `sendPostTripReminder_()` directly for one booking (by 1-based sheet
row), bypassing `isPreTripReminderEligible()` / `isPostTripReminderEligible()` entirely. These are
real sends: on success they write K/L and notify the manager exactly like the automated path, just
triggered immediately. Intended for a legitimate resend, or for sending the post-trip inspection
right away when a vehicle is returned unusually early. Manually run only, from the Apps Script
editor — not wired to any trigger, not reachable from any customer-facing surface. See [Manual
immediate inspection sends](setup-notes.md#manual-immediate-inspection-sends) in
`docs/setup-notes.md` for the corresponding pure-test entry points in `SandboxTests.js`.

---

### Notifications.js

**Functions:** `sendSms(toPhone, message, fromPhone)`, `sendEmailHtml(toEmail, subject, htmlBody, fromEmail, replyToEmail, suppressManagerBcc)`,
`buildEmailPersonalization_(toEmail, suppressManagerBcc)`, `alertAdmin(subject, body)`

`sendEmailHtml` builds a SendGrid v3 `/mail/send` payload. The optional `fromEmail` and
`replyToEmail` parameters set the sending address for this message; both default to the global
`CONFIG.FROM_EMAIL` / `CONFIG.REPLY_TO_EMAIL` values when not provided. The recipient block is
built by `buildEmailPersonalization_()`, a pure helper pulled out so this logic is directly
testable: it automatically BCC's `CONFIG.MANAGER_EMAIL` on every customer-facing email, suppresses
the BCC when `toEmail` is the manager or admin (to avoid duplicate copies on emails already
addressed to them), and also suppresses it whenever the optional 6th argument
`suppressManagerBcc` is `true` — every call site omits this argument except the pre-trip and
post-trip inspection customer emails (`Reminders.js`), which pass `true` because the manager must
never receive either blank inspection form, not even by BCC.

`sendSms` posts to the Twilio Messages REST API using Basic Auth with TWILIO_SID:TWILIO_TOKEN.
The optional `fromPhone` parameter sets the Twilio sender number; all production call sites pass
`locCfg.phone`.

`alertAdmin` logs the message at `[ALERT]` level and emails `CONFIG.ADMIN_EMAIL` via
`sendEmailHtml`. If `sendEmailHtml` itself fails, the failure is logged but not re-thrown (alerts
must not cause further exceptions).

---

### DocuSeal.js

**Functions:** `sendLeaseViaDocuSeal(name, email, secondEmail, startTime, endTime, vehicleType, location)`,
`extractDocuSealSubmissionId(response)`

`sendLeaseViaDocuSeal` selects the correct template based on whether a second driver email is
present, builds the submitters array with exact role names (`Driver #1` for both single- and
two-driver templates), and POSTs to `https://api.docuseal.com/submissions` using
`CONFIG.DOCUSEAL_KEY` as the `X-Auth-Token` header. The `startTime` and `endTime` Date objects
are used to prefill `pickup_datetime`, `return_datetime`, and `reservation_date` fields on the
lease document. Returns the parsed JSON response. Throws on HTTP 4xx/5xx.

`extractDocuSealSubmissionId` takes the parsed response and returns the shared submission ID.
The DocuSeal API returns an array of submitter objects. This function collects `submission_id`
(or `submission.id`) from each array element — these are the shared identifier common to all
signers. It returns null with a warning log if no ID is found or if IDs conflict across elements.
The response structure is logged on every call (keys and ID fields, not values).

---

### Webhooks.js

**Functions:** `doPost(e)`, `doGet()`, `markDepositPaid(customerEmail, amountPaid, eventId)`,
`markLeaseSigned(submissionId, signerEmail)`

`doPost` is the Apps Script web app entry point. It validates the shared secret, then routes to
either `markLeaseSigned` (for `type === 'lease_signed'`) or `markDepositPaid` (for Stripe
payment events). Always returns HTTP 200 with `{ received: true }` — non-200 would trigger
Pipedream retry loops. Secret validation failures return `{ received: false }`.

`doGet` returns `{COMPANY_NAME} webhook endpoint is live.` as plain text (where `{COMPANY_NAME}`
is the value of the `COMPANY_NAME` Script Property). Used to verify the deployment URL is
reachable.

`markDepositPaid` matches the incoming payment to a booking row using two strategies in order:

1. **Primary — event ID match:** Stripe passes the Google Calendar event ID (base64 URL-safe
   encoded) as `client_reference_id`. `doPost` decodes it and passes it as `eventId`.
   `markDepositPaid` searches column A for a row with a matching event ID and an unpaid deposit.

2. **Fallback — email match:** If no event ID is present (or no match found), searches column C
   for a case-insensitive email match with an unpaid deposit. This covers rows created before
   the `client_reference_id` feature was added.

After matching, it writes G = Yes and H = amount, sends confirmation SMS (in an isolated
try/catch so SMS failure cannot block email or DocuSeal) and email, then calls
`sendLeaseViaDocuSeal`. **The lease send is inside a try/catch** — if DocuSeal fails, J and T
are not written (the catch-up engine handles it). Writes J = Yes and T = submission ID after a
successful DocuSeal call.

`markLeaseSigned(submissionId, signerEmail)` uses the same two-strategy lookup:

1. **Primary — submission ID match:** Searches column T for a matching DocuSeal submission ID
   (normalized to string).

2. **Fallback — email match:** If no submission ID is provided or found, searches column C.

> **Note:** `WEBHOOK_SHARED_SECRET` is read directly from `PROPS` in `doPost`, not from
> `CONFIG`. This is intentional — the shared secret is needed before `CONFIG` is guaranteed to be
> fully valid, and it bypasses the CONFIG layer to avoid any potential misconfiguration masking
> the secret check.

---

### Forms.js

**URL builders:** `buildIntakeUrl(name, email, phone, rentalDate)`,
`buildInspectUrl(name, email, rentalDate, type)`

Builds pre-filled Google Forms URLs by appending query parameters with entry IDs from Script
Properties. The intake form uses `yyyy-MM-dd` date format. The inspection form uses
`MMMM d, yyyy` (human-readable) — Google Forms date fields accept different formats depending on
the field type; these values match the configured field types. `buildInspectUrl`'s `type`
parameter (`'pre'`/`'post'`) selects `CONFIG.INSPECT_VAL_PRE` or `CONFIG.INSPECT_VAL_POST` as the
pre-filled dropdown value.

**Trigger:** `onFormSubmit(e)`

The single installed spreadsheet-bound form-submit trigger — installed by `setupTriggers()` (see
the `Setup.js` entry below and [Google Forms](#7-google-forms)). Reads `e.range.getSheet().getName()` and routes to
`processIntakeFormSubmission_(e)` or `processInspectionFormSubmission_(e)` based on which response
tab the submission came from; ignores anything else.

**Processing functions:** `processIntakeFormSubmission_(e)`, `processInspectionFormSubmission_(e)`

Called only from `onFormSubmit()` (each also independently re-checks its own response-sheet name,
so both remain safe if ever called directly, e.g. from a test). `processIntakeFormSubmission_`
matches the submission to a booking row and sets column V to the plain flag `Yes`; if the deposit
was already paid, it also sends the DocuSeal lease. `processInspectionFormSubmission_` matches the
submission, classifies it as pre- or post-inspection by comparing the `Inspection Type` answer
against `CONFIG.INSPECT_VAL_PRE`/`INSPECT_VAL_POST` (both sides normalized with
`String(value).trim().toLowerCase()`), and sets column W or X to `"Yes " + formatDateTimeShort(...)`
(`formatInspectionCompletionValue()` in `Helpers.js`) using the response sheet's own `Timestamp`
column (the actual moment the customer submitted the form) rather than the time the trigger
happens to run. Neither handler ever guesses — see [Google Forms](#7-google-forms) for the full
matching and classification rules.

**Matching helpers:** `findBookingMatchRow_(data, email, dateStr, completionColIndex)`,
`findIntakeMatchRow(data, email, dateStr)`, `findInspectionMatchRow(data, email, dateStr, inspectionType)`,
`isInspectionCompletionValueSet_(cellValue)`

`findBookingMatchRow_` is the shared, ambiguity-safe matcher (email plus rental date when
available, never customer name) used by both form handlers, parameterized by which completion
column to check. `findIntakeMatchRow` and `findInspectionMatchRow` are thin wrappers around it.
"Already completed" is determined by `isInspectionCompletionValueSet_()`, which treats any value
starting with `Yes` — the plain flag used by column V or the `"Yes <timestamp>"` value used by
columns W/X — as done, so a resubmission for an already-completed inspection is correctly ignored
instead of overwriting the recorded completion time.

**Extraction helpers:** `extractIntakeSubmissionFields(e)`, `extractInspectionSubmissionFields(e)`

Pure functions that pull email/date (and, for inspection, the type answer) out of a spreadsheet
form-submit event object, returning `null` if the event doesn't look right or the response is from
an unrelated sheet. Isolated from the sheet-reading logic so they can be unit-tested with synthetic
events — see `testExtractIntakeSubmissionFields` / `testExtractInspectionSubmissionFields` in
`SandboxTests.js`.

---

### Helpers.js

**Functions:** `getSheet()`, `getExistingEventIds(sheet)`, `extractBookedByName(text)`,
`extractPrimaryEmail(text)`, `extractSecondDriverEmail(text)`, `extractPhone(text)`, `toDate()`,
`formatDate()`, `formatDateForForm()`, `formatDateTime()`, `formatDateTimeShort()`,
`formatInspectionCompletionValue(date)`, `parseInspectionCompletionTimestamp_(cellValue)`,
`getDepositAmount(vehicleType)`, `getStripePriceId(vehicleType)`,
`createStripeCheckoutSession(vehicleType, clientReferenceId, customerEmail)`,
`getLocationConfig(location)`

`formatDateTimeShort()` formats a Date as `M/d/yyyy h:mm a` (e.g. `8/2/2026 9:15 AM`) — the same
compact style already used for the booking Start/End Time cells, but with a four-digit year so it
stays unambiguous when combined with a flag in one cell. `formatInspectionCompletionValue(date)`
builds the exact `"Yes " + formatDateTimeShort(date)` value written to columns W and X.
`parseInspectionCompletionTimestamp_(cellValue)` reverses it, returning the recorded completion
Date or `null` if the cell is blank, not prefixed with `Yes`, or unparseable — used by
`processReminders()` to measure elapsed time since the pre-trip inspection completed.

`getSheet()` reads `SHEET_ID` directly via
`PropertiesService.getScriptProperties().getProperty('SHEET_ID')` — it does NOT go through the
`PROPS`/`CONFIG` pattern. This is because `getSheet()` may be called during Setup before `CONFIG`
is fully validated.

The extraction functions parse structured HTML in Google Calendar event descriptions:

- `extractBookedByName` — matches `<b>Booked by</b>` followed by the name on the next line
- `extractPrimaryEmail` — finds the first bare email address not preceded by a "second" label
- `extractSecondDriverEmail` — finds the email after a `<b>Second Driver…</b>` label
- `extractPhone` — normalises any US phone format to `+1XXXXXXXXXX`

`getDepositAmount` uses an explicit object-map lookup table keyed on vehicle type string. Unknown
vehicle types fall back to the generic `DEPOSIT_AMOUNT` Script Property with a warning log.

`getStripePriceId` uses a similar lookup table returning the Stripe Price ID for the vehicle type.
Unknown vehicle types return `null` with a warning log — callers that receive `null` throw an
error rather than proceeding.

`createStripeCheckoutSession` makes a live Stripe API call to create a Checkout Session with
`mode: 'payment'`, `capture_method: 'manual'` (authorization hold), the vehicle's Price ID, and
the supplied `clientReferenceId`. The `success_url` is `https://reliablestorage.com`. Returns the
hosted Checkout Session URL. Throws on Stripe API errors (HTTP 4xx/5xx). Never logs the Stripe
secret key.

---

### Setup.js

**Functions:** `setupTriggers()`, `setupSheetSchema()`

`setupTriggers()` deletes all existing project triggers and creates five triggers: the four
time-based engines (`syncCalendarBookings`, `checkRentalEligibility`, `sendLeaseToNewBookings`,
`processReminders`) plus one spreadsheet-bound `onFormSubmit` trigger, installed via
`installFormSubmitTrigger_()`. Then calls `setupSheetSchema()`. **Run this once manually** after
initial deployment or whenever trigger configuration changes — ordinary source-only edits do not
require re-running it (see [Development Workflow](#16-development-workflow)).

`onFormSubmit` is a single dispatcher that fires for any form linked to the Bookings spreadsheet
(both the intake and inspection forms write into tabs of that same spreadsheet) and routes each
event to `processIntakeFormSubmission_()` or `processInspectionFormSubmission_()` by response-tab
name — see [Google Forms](#7-google-forms).

`setupSheetSchema()` writes `Vehicle Type` to the R1 cell (if blank) and applies dropdown
validation to column R from the unique vehicle types in `CALENDAR_CONFIGS`. Same for `Location`
in column S. It also fills in the header text (if blank) for columns U (`Customer Approval
Notified`), V (`Intake Form Completed`), W (`Pre-Inspection Form Completed`), X
(`Post-Inspection Form Completed`), and Y (`Suspicious Timing Warning Sent`) — no dropdown
validation on these, same Yes/blank pattern as G/I/J/K/L/N. Safe to re-run — it only writes
headers if the cell is currently blank, and always re-applies R/S validation. **Does not touch
columns A–Q or T** — those must be set up manually.

---

### SandboxTests.js

Contains all manual test, validation, and diagnostic functions. Run from the Apps Script editor
toolbar. Never wire any of these to triggers. See [Testing](#15-testing) for the complete
function reference.

---

## 6. Bookings Sheet

The sheet must have a tab named `Bookings` (exact, case-sensitive). Row 1 is headers. Data starts
at row 2.

### Column reference

| Col | Header | Written by | Notes |
|---|---|---|---|
| A | Event ID | `syncCalendarBookings` | Google Calendar event ID; used for deduplication and payment matching |
| B | Customer Name | `syncCalendarBookings` | Extracted from event description HTML |
| C | Email | `syncCalendarBookings` | Primary customer email; `No Email` if absent |
| D | Phone | `syncCalendarBookings` | E.164 format with leading `'` to prevent spreadsheet reformatting; `No Phone` if absent |
| E | Start Time | `syncCalendarBookings` | Google Calendar event start time as a Date object |
| F | End Time | `syncCalendarBookings` | Calendar event end time; defaults to start + 4 hours in processReminders if blank |
| G | Deposit Paid | `markDepositPaid` (webhook) | Set to `Yes` when Stripe payment confirmed |
| H | Stripe Amount | `markDepositPaid` (webhook) | Dollar amount received; informational only |
| I | Intake Sent | `syncCalendarBookings` | Set to `Yes` after welcome message sent; gates the approval loop |
| J | Lease Sent | `markDepositPaid`, `sendLeaseToNewBookings` | Set to `Yes` after DocuSeal submission succeeds |
| K | 24hr Sent | `processReminders` | Set to `Yes` after the pre-trip reminder is successfully delivered by SMS or email (or immediately if the customer has neither on file) |
| L | Post-Rental Sent | `processReminders` | Set to `Yes` after the post-trip reminder is successfully delivered by SMS or email (or immediately if the customer has neither on file); send is timed from the column W completion timestamp, not from End Time |
| M | Second Driver Email | `syncCalendarBookings` | Second driver's email if provided; `No Second Email` if absent |
| N | Lease Signed | `markLeaseSigned` (webhook) | Set to `Yes` when DocuSeal signing event received |
| O | Rental Approved | **Manager only** | **Script never writes this column.** Dropdown: `Approved - Free`, `Approved - Paid`, `Denied` |
| P | Approval Notified At | `checkRentalEligibility` | Timestamp of last approval notification sent to manager |
| Q | Approval Reminder Count | `checkRentalEligibility` | Number of notifications sent; > `MAX_APPROVAL_REMINDERS` = permanently silenced |
| R | Vehicle Type | `syncCalendarBookings` | From `CALENDAR_CONFIGS[n].vehicleType`; drives deposit and Stripe URL lookup |
| S | Location | `syncCalendarBookings` | From `CALENDAR_CONFIGS[n].location`; informational |
| T | DocuSeal Submission ID | `markDepositPaid`, `sendLeaseToNewBookings` | Submission ID returned by DocuSeal API; written only if `extractDocuSealSubmissionId` returns a non-null value |
| U | Customer Approval Notified | `checkRentalEligibility` (via `notifyCustomerOfApproval`) | Set to `Yes` after the customer's one-time "your rental is approved" email/SMS is sent |
| V | Intake Form Completed | `processIntakeFormSubmission_` (via `onFormSubmit`) | Set to `Yes` when the intake Google Form is submitted — distinct from Intake Sent (column I), which only means the link was emailed |
| W | Pre-Inspection Form Completed | `processInspectionFormSubmission_` (via `onFormSubmit`) | Set to `"Yes <date/time>"` (e.g. `Yes 8/2/2026 9:15 AM`) using the pre-trip inspection form's own Timestamp column when a submission is matched to this row; also the value `processReminders` reads to time the post-trip reminder |
| X | Post-Inspection Form Completed | `processInspectionFormSubmission_` (via `onFormSubmit`) | Set to `"Yes <date/time>"` (e.g. `Yes 8/2/2026 4:08 PM`) using the post-trip inspection form's own Timestamp column when a submission is matched to this row |
| Y | Suspicious Timing Warning Sent | `processReminders` (via `sendSuspiciousInspectionTimingWarning_`) | Set to `Yes` after the manager is warned that W and X were completed `SUSPICIOUS_INSPECTION_WINDOW_MINUTES` apart or less (inclusive); blank means either not applicable yet or not suspicious |

### Flag semantics

- **Column O** is the only column that gates downstream behaviour. The approval loop in
  `checkRentalEligibility` checks for specific string values (`Approved - Free`,
  `Approved - Paid`, `Denied`). Any other value (including blank) leaves the row in the pending
  state.

- **Columns G, I, J, K, L, N, U, V, Y** are binary flags — the script only checks whether the value
  is exactly `Yes`. Any other value (including blank) is treated as "not done."

- **Columns W and X** combine a completion flag with the actual form-submission timestamp in one
  cell (`"Yes " + date/time`, written by `formatInspectionCompletionValue()` in `Helpers.js`).
  "Already completed" is recognized by a `Yes` prefix (`isInspectionCompletionValueSet_()` in
  `Forms.js`), not by exact equality to `Yes` — this is what lets `processReminders` also parse
  out the completion time from column W (`parseInspectionCompletionTimestamp_()` in `Helpers.js`)
  to time the post-trip reminder. Column V (Intake Form Completed) still uses the plain `Yes`
  flag; it does not carry a timestamp.

- **Column Q** is numeric. The script reads it with `Number(data[i][16]) || 0`, so a blank or
  non-numeric value is treated as 0 (no notifications sent).

### Data validation

Column O must have a data-validation dropdown restricted to exactly these three values:
```
Approved - Free
Approved - Paid
Denied
```

Columns R and S have dropdown validation applied automatically by `setupSheetSchema()`. The
values are derived from `CALENDAR_CONFIGS`, so they stay in sync automatically.

Column T has no validation; it holds a numeric submission ID written by the script.

### Column T — DocuSeal Submission ID

Column T was added after the initial deployment. It is not initialised to empty string in the
`appendRow` call in `syncCalendarBookings` (which writes 19 values, A–S). New rows leave T blank
until a lease is successfully sent. Existing rows from before T was added will also have a blank T
unless a lease is resent.

### Location tabs and QUERY formulas

The Bookings sheet may have additional per-location tabs that use `QUERY` formulas to filter the
main Bookings tab by the Location column (S). These tabs are a Google Sheets feature maintained
separately from the script — the script reads and writes only the main Bookings tab. Adding a new
location does not automatically create a filtered tab; that must be done manually.

---

## 7. Google Forms

Two Google Forms support the rental workflow. The script generates pre-filled URLs for both forms
and does not manage form structure. It also does not read the *content* of any form response —
with two narrow exceptions: `processIntakeFormSubmission_()` and `processInspectionFormSubmission_()`
(`src/Forms.js`) react to submissions to detect that the intake and inspection forms were actually
*completed*, as opposed to merely sent. Each reads only the submitted email, rental date, and (for
inspection) the inspection-type answers — the exact question titles on the live form, to match the
submission to the correct booking row — and writes a single `Yes`/blank completion flag. Neither
stores or forwards the rest of the response.

**Both forms write into tabs of the same spreadsheet as Bookings** (identified by the `SHEET_ID`
Script Property) — there is no separate spreadsheet for either, and no Script Property identifying
one. Their response tabs are named exactly `Rental Intake Form` and `Rental Vehicle Condition
Inspection Form`. Because a spreadsheet-bound form-submit trigger fires for *every* form linked to
a spreadsheet, `setupTriggers()` installs exactly **one** such trigger — `onFormSubmit` — alongside
the four time-based engines (five triggers total). `onFormSubmit(e)` in `src/Forms.js` is a
dispatcher: it reads `e.range.getSheet().getName()` and routes the event to
`processIntakeFormSubmission_()`, to `processInspectionFormSubmission_()`, or ignores it if the
submission came from neither response tab. **`setupTriggers()` must be re-run after every
`clasp push`** to (re)install all five triggers. See "Trigger setup" in `docs/setup-notes.md` for
the full details, including what happens when a submission can't be safely matched to exactly one
booking (it's ignored, not guessed, and the admin is alerted).

### Rental Intake Form

**Purpose:** Collects customer information and required documents before the rental date.

**When sent:** Included in the welcome SMS and email at the time of booking (`syncCalendarBookings`).

**Pre-filled fields (from Script Properties):**

| Field | Entry ID Property | Value |
|---|---|---|
| Customer name | `INTAKE_ENTRY_NAME` | From calendar event description |
| Customer email | `INTAKE_ENTRY_EMAIL` | From calendar event description |
| Customer phone | `INTAKE_ENTRY_PHONE` | From calendar event description |
| Rental date | `INTAKE_ENTRY_DATE` | Start time in `yyyy-MM-dd` format |

**Typical intake form fields** (configured in Google Forms, not the script):
- Customer name, email, phone (pre-filled)
- Rental date (pre-filled)
- Driver's license photo upload
- Insurance document upload
- Additional driver information if applicable

Google Forms file upload responses are saved to a Google Drive folder configured in the form's
settings. The script does not interact with this folder.

**Config keys:** `INTAKE_FORM_BASE`, `INTAKE_ENTRY_NAME`, `INTAKE_ENTRY_EMAIL`,
`INTAKE_ENTRY_PHONE`, `INTAKE_ENTRY_DATE`

---

### Vehicle Inspection Form

**Purpose:** Documents vehicle condition with timestamped photos before and after every rental.

**When sent:**
- Pre-trip link in the 24-hour reminder email and SMS (`sendPreTripReminder_()` in
  `processReminders`) — same link, same form, sent by both channels; the customer only needs to
  complete it once. Not sent to the manager.
- Post-trip link in the post-trip reminder email and SMS (`sendPostTripReminder_()` in
  `processReminders`), sent once the customer has completed the pre-trip inspection and at least
  one hour has elapsed since that recorded completion — see [Column reference](#column-reference)
  and the `Reminders.js — Engine 3` entry in [Source File Reference](#5-source-file-reference).

**Pre-filled fields (from Script Properties):**

| Field | Entry ID Property | Value |
|---|---|---|
| Customer name | `INSPECT_ENTRY_NAME` | From sheet column B |
| Customer email | `INSPECT_ENTRY_EMAIL` | From sheet column C |
| Rental date | `INSPECT_ENTRY_DATE` | Start time in `MMMM d, yyyy` format |
| Inspection type | `INSPECT_ENTRY_TYPE` | `INSPECT_VAL_PRE` or `INSPECT_VAL_POST` |

The inspection type dropdown in the form uses exact option text values stored in `INSPECT_VAL_PRE`
and `INSPECT_VAL_POST` Script Properties. These must exactly match the option text in the Google
Form's dropdown field.

**Config keys:** `INSPECT_FORM_BASE`, `INSPECT_ENTRY_NAME`, `INSPECT_ENTRY_EMAIL`,
`INSPECT_ENTRY_DATE`, `INSPECT_ENTRY_TYPE`, `INSPECT_VAL_PRE`, `INSPECT_VAL_POST`

**Completion tracking:** `processInspectionFormSubmission_()` (`src/Forms.js`), called from the
`onFormSubmit` dispatcher, reacts to submissions of this form the same way
`processIntakeFormSubmission_()` does for intake — matching on the submitted email plus, when
available, the rental date, via the same ambiguity-safe `findBookingMatchRow_()` logic (see
"Booking matching" below). Because one form serves both the pre-trip and post-trip inspection, it
also reads back the `Inspection Type` answer and compares it against `CONFIG.INSPECT_VAL_PRE` /
`CONFIG.INSPECT_VAL_POST` — the submitted answer and both configured values are independently
normalized with `String(value).trim().toLowerCase()` before comparing, so case and incidental
whitespace differences never cause a false unclassified result. The live form's option text is the
configured value (e.g. `Pre-Trip (Before Vehicle Pickup)` / `Post-Trip (After Vehicle Return)`),
so this is the same text `buildInspectUrl()` uses to pre-fill the dropdown:
- A submission normalizing to `pre` sets column **W** (Pre-Inspection Form Completed) to
  `"Yes <date/time>"`, using the response sheet's own `Timestamp` column as the completion time
  (falling back to the time the handler runs only if that column is missing or unparseable).
- A submission normalizing to `post` sets column **X** (Post-Inspection Form Completed) the same
  way.

Each column is tracked independently — a pre-trip submission never touches X and a post-trip
submission never touches W. A submission whose type answer normalizes to neither `pre` nor `post`,
or that cannot be matched to exactly one eligible booking, updates nothing and alerts
`ADMIN_EMAIL` with context; a resubmission of an already-completed inspection is a silent no-op
(not an error, not an alert, and does not overwrite the recorded completion time) — recognized via
`isInspectionCompletionValueSet_()`. The pre-trip inspection link still goes out unconditionally in
the 24-hour reminder. The post-trip inspection link, however, is now driven directly by column W's
completion timestamp: `processReminders` sends it on the first run at least one hour after that
timestamp (see [Column reference](#column-reference) and the `Reminders.js — Engine 3` entry in
[Source File Reference](#5-source-file-reference)) — it is never sent before the pre-trip
inspection has been completed.

**Response tab:** like the intake form, this form's responses are a tab (`Rental Vehicle Condition
Inspection Form`) in the same spreadsheet as Bookings, identified by the existing `SHEET_ID`
Script Property — no separate spreadsheet, and no additional Script Property, is required.

---

## 8. Script Properties Reference

All 50 Script Properties must be set in **Apps Script → Project Settings → Script Properties**.
No value ever belongs in source code.

### Identity and routing

| Property | Description | Example | Secret | Required | Used in |
|---|---|---|---|---|---|
| `SHEET_ID` | Google Spreadsheet ID (from sheet URL) | `1BxiM...` | No | Yes | `Helpers.js` |
| `SHEET_NAME` | Bookings tab name | `Bookings` | No | Yes | `Config.js` |
| `COMPANY_NAME` | Business name used in customer-facing emails, SMS, and the webhook liveness response | `Reliable Storage` | No | Yes | `Config.js` |
| `ADMIN_EMAIL` | Escalation address for unanswered approvals and script errors | `admin@example.com` | No | Yes | `Config.js` |
| `MANAGER_EMAIL` | Site manager — BCC'd on all customer emails, receives booking/approval notices | `manager@example.com` | No | Yes | `Config.js` |
| `MANAGER_PHONE` | Site manager phone in E.164 format | `+12065551234` | No | No | `Config.js` |
| `FROM_NAME` | Display name for outbound emails | `Reliable Storage` | No | Yes | `Config.js` |

> **`SHEET_ID` note:** Unlike all other properties, `SHEET_ID` is read directly via
> `getProperty('SHEET_ID')` inside `Helpers.js`, not through the `PROPS`/`CONFIG` pattern. This
> is the one property that bypasses `Config.js`.

> **`COMPANY_NAME` note:** Used in `doGet()` for the liveness response, in DocuSeal email
> subjects and bodies, and in customer-facing SMS. If unset, these messages will include the
> string `undefined`.

### Google Calendar

One property per active calendar. Calendars whose property is not set are silently skipped.

| Property | Location | Vehicle |
|---|---|---|
| `CALENDAR_ID_BAINBRIDGE_CARGO_VAN` | Bainbridge | Cargo Van |
| `CALENDAR_ID_POULSBO_MOVING_TRUCK` | Poulsbo | Moving Truck |
| `CALENDAR_ID_PORT_ORCHARD_MOVING_TRUCK` | Port Orchard | Moving Truck |
| `CALENDAR_ID_FAIRGROUNDS_MOVING_TRUCK` | Fairgrounds | Moving Truck |

The Calendar ID is the full `*@group.calendar.google.com` address found in Google Calendar →
Settings → Integrate calendar → Calendar ID. The Apps Script service account must be shared on
each calendar with at least read access.

### Stripe

| Property | Description | Example | Secret | Required |
|---|---|---|---|---|
| `STRIPE_SECRET_KEY` | Stripe secret API key — used server-side to create Checkout Sessions | `sk_live_...` or `sk_test_...` | **Yes** | Yes |
| `STRIPE_PRICE_ID_CARGO_VAN` | Stripe Price ID for the Cargo Van deposit product | `price_...` | No | Yes (for Cargo Van) |
| `STRIPE_PRICE_ID_MOVING_TRUCK` | Stripe Price ID for the Moving Truck deposit product | `price_...` | No | Yes (for Moving Truck) |

Each booking gets its own dynamically created Checkout Session. `STRIPE_SECRET_KEY` must never
be logged or embedded in client-facing content. The Price IDs refer to Stripe Products with
a fixed price matching the deposit amount. In sandbox, use test-mode keys (`sk_test_...`) and
test-mode Price IDs.

> **Google Apps Script property limit:** this project is at the 50-property limit.
> Adding a new vehicle type requires a new `STRIPE_PRICE_ID_*` property and one slot is consumed.

### Deposit amounts

| Property | Description | Example | Secret | Required |
|---|---|---|---|---|
| `DEPOSIT_AMOUNT_CARGO_VAN` | Dollar amount shown in customer messages | `50` | No | Yes (for Cargo Van) |
| `DEPOSIT_AMOUNT_MOVING_TRUCK` | Dollar amount shown in customer messages | `100` | No | Yes (for Moving Truck) |
| `DEPOSIT_AMOUNT` | Fallback for rows with blank Vehicle Type column | `50` | No | Recommended |

These are strings used directly in message text (e.g., "pay your $50 deposit"). They are not used
for any financial calculation.

### Twilio (SMS)

| Property | Description | Secret | Required |
|---|---|---|---|
| `TWILIO_SID` | Twilio Account SID — begins with `AC`, followed by 32 alphanumeric characters (34 chars total) | **Yes** | Yes |
| `TWILIO_TOKEN` | Twilio Auth Token — used for Basic Auth alongside the SID | **Yes** | Yes |

`MANAGER_PHONE` must be in E.164 format: `+` followed by 7–15 digits (e.g., `+12065551234`).
A missing country code produces Twilio "Invalid To Phone Number" errors. The outbound sender
number for each booking is set by `PHONE_<LOCATION>` — see [Location-specific senders](#location-specific-senders).

On a Twilio trial account, all outbound SMS are prefixed with "Sent from your Twilio trial
account — " and can only be delivered to individually verified phone numbers.

### SendGrid (email)

| Property | Description | Secret | Required |
|---|---|---|---|
| `SENDGRID_KEY` | SendGrid API key (`SG....`) — must have the **Mail Send** permission scope | **Yes** | Yes |
| `FROM_EMAIL` | Sender address — must be a verified sender in SendGrid | No | Yes |
| `REPLY_TO_EMAIL` | Reply-to address (typically the site manager) | No | Yes |

`FROM_EMAIL` must be either a verified single sender or belong to an authenticated domain in your
SendGrid account. An unverified sender produces HTTP 403 errors logged as admin alerts.

`FROM_EMAIL` is used only by `alertAdmin()`. All booking emails and SMS messages use the
location-specific sender values below.

### Location-specific senders

Each active location sends emails and SMS messages from its own address and number. The booking's
location (column S) is looked up by `getLocationConfig()` in `Helpers.js`, which returns
`{ email, phone }` for that location. `getLocationConfig` throws — never silently falls back to
a different location — if it receives a location string that is not one of the four active values.

| Property | What it is | Format |
|---|---|---|
| `EMAIL_BAINBRIDGE` | From-address for all Bainbridge booking emails | Verified SendGrid sender |
| `PHONE_BAINBRIDGE` | Twilio sender number for all Bainbridge booking SMS | E.164 |
| `EMAIL_POULSBO` | From-address for all Poulsbo booking emails | Verified SendGrid sender |
| `PHONE_POULSBO` | Twilio sender number for all Poulsbo booking SMS | E.164 |
| `EMAIL_PORT_ORCHARD` | From-address for all Port Orchard booking emails | Verified SendGrid sender |
| `PHONE_PORT_ORCHARD` | Twilio sender number for all Port Orchard booking SMS | E.164 |
| `EMAIL_FAIRGROUNDS` | From-address for all Fairgrounds booking emails | Verified SendGrid sender |
| `PHONE_FAIRGROUNDS` | Twilio sender number for all Fairgrounds booking SMS | E.164 |

All eight properties are required. Missing or malformed values are caught by `testLocationSenderConfig()`.

### DocuSeal (e-signature)

| Property | Description | Example | Secret | Required |
|---|---|---|---|---|
| `DOCUSEAL_API_KEY` | DocuSeal API key (sent as `X-Auth-Token` header) | `abc123...` | **Yes** | Yes |
| `DOCUSEAL_TEMPLATE_ONE_DRIVER` | Template ID for single-driver lease | `1234567` | No | Yes |
| `DOCUSEAL_TEMPLATE_TWO_DRIVERS` | Template ID for two-driver lease | `7654321` | No | Yes |

> **CONFIG key mapping:** The internal code uses `CONFIG.DOCUSEAL_KEY` and
> `CONFIG.DOCUSEAL_TEMPLATE_SINGLE` — these names appear throughout the source. They map from the
> Script Properties `DOCUSEAL_API_KEY` and `DOCUSEAL_TEMPLATE_ONE_DRIVER` respectively. The
> mapping is in `Config.js` lines 87–89. Do not rename the internal CONFIG keys; only the Script
> Property names matter for the Apps Script console.

### Intake Form (Form 1)

| Property | Description |
|---|---|
| `INTAKE_FORM_BASE` | Google Form base URL |
| `INTAKE_ENTRY_NAME` | Form entry ID for name field |
| `INTAKE_ENTRY_EMAIL` | Form entry ID for email field |
| `INTAKE_ENTRY_PHONE` | Form entry ID for phone field |
| `INTAKE_ENTRY_DATE` | Form entry ID for date field |

Entry IDs are numeric strings found by inspecting the form's pre-fill URL or via the Google Forms
"Get pre-filled link" tool (the query parameter after `entry.`).

### Inspection Form (Form 2)

| Property | Description |
|---|---|
| `INSPECT_FORM_BASE` | Google Form base URL |
| `INSPECT_ENTRY_NAME` | Form entry ID for name field |
| `INSPECT_ENTRY_EMAIL` | Form entry ID for email field |
| `INSPECT_ENTRY_DATE` | Form entry ID for date field |
| `INSPECT_ENTRY_TYPE` | Form entry ID for inspection type dropdown |
| `INSPECT_VAL_PRE` | Exact text of the pre-trip option (live value: `Pre-Trip (Before Vehicle Pickup)`) |
| `INSPECT_VAL_POST` | Exact text of the post-trip option (live value: `Post-Trip (After Vehicle Return)`) |

`INSPECT_VAL_PRE` and `INSPECT_VAL_POST` must match the option text in the Google Form dropdown
field. They serve **two** purposes: `buildInspectUrl()` uses them to pre-fill the form's dropdown,
and `extractInspectionSubmissionFields()` (`src/Forms.js`) compares the submitted answer against
them (both sides normalized with `String(value).trim().toLowerCase()`) to classify a response as
pre- or post-inspection — see "Vehicle Inspection Form" above. Because both uses read the same two
properties, they can never drift out of sync with each other.
No Script Property identifies a separate inspection response spreadsheet: its responses are a tab
in the same spreadsheet as Bookings, identified by the existing `SHEET_ID`.

### Operational parameters

These control timing and reminder behaviour. All are parsed as numbers with `Number()`.

| Property | Description | Example | Notes |
|---|---|---|---|
| `DAYS_AHEAD` | How many days ahead to scan each calendar for new bookings | `60` | Lower values reduce API calls; higher values give earlier notice |
| `HOURS_BETWEEN_APPROVAL_REMINDERS` | Hours between manager approval reminder emails | `12` | Set to 12 for one reminder per half-day |
| `MAX_APPROVAL_REMINDERS` | Total approval notifications before escalating to admin | `3` | 1 initial + 2 follow-ups + 1 escalation, then permanent silence |
| `SUSPICIOUS_INSPECTION_WINDOW_MINUTES` | Minutes; if the post-trip inspection is completed this many minutes or less after the pre-trip inspection (inclusive), the manager is warned (column Y) | `15` | Default chosen as long enough for a plausible short rental, short enough to only flag implausibly close submissions — see [Suspicious inspection timing warning](#suspicious-inspection-timing-warning) |

**Removed:** `POST_RENTAL_HOURS` (formerly: hours after rental end time before the post-trip
message) is no longer part of `CONFIG` and no longer required by `validateConfig()` — the post-trip
reminder is timed from the pre-trip inspection's recorded completion instead (see `Reminders.js —
Engine 3` in [Source File Reference](#5-source-file-reference)). If it is still set in Script
Properties from an earlier deployment, it is simply ignored; it does not need to be removed.

**Sandbox-only (not part of `CONFIG`):** `SANDBOX_TEST_PHONE` and `SANDBOX_TEST_EMAIL` are read
directly from `PROPS` by manual `SandboxTests.js` functions only (`testSendSingleSms()`,
`testSendPreTripInspection()`, `testSendPostTripInspection()`) — set them to your own verified
phone number and inbox before running those tests. Never used in any production code path.

### Webhook authentication

| Property | Description | Secret | Required |
|---|---|---|---|
| `WEBHOOK_SHARED_SECRET` | Shared secret validated in every `doPost` call | **Yes** | Yes |

Generate with: `openssl rand -hex 32`

Set the same value in each Pipedream workflow's POST step as the `secret` field in the JSON body.

---

## 9. DocuSeal Integration

### Templates

DocuSeal templates define the lease document structure and the signing roles. Two templates are
used:

**Single-driver template** (`DOCUSEAL_TEMPLATE_ONE_DRIVER`)

Signing roles (must match exactly in the DocuSeal template):
- `Driver #1` — the primary customer
- `Reliable Storage Manager` — the site manager

**Two-driver template** (`DOCUSEAL_TEMPLATE_TWO_DRIVERS`)

Signing roles:
- `Driver #1` — the primary customer
- `Driver #2` — the second driver
- `Reliable Storage Manager` — the site manager

The role name `Driver #1` is used for the primary customer in **both** templates. The role names
are hardcoded in `DocuSeal.js`. If a template's role names differ, update the strings in
`sendLeaseViaDocuSeal`.

### Pre-filled document fields

The script prefills the following fields on the lease document via the `values` object in the
Driver #1 submitter entry:

| Field name | Value |
|---|---|
| `storage_location` | Location string from column S (e.g., `Bainbridge`) |
| `vehicle_type` | Vehicle type string from column R (e.g., `Cargo Van`) |
| `reservation_date` | Rental date in `MMMM d, yyyy` format |
| `pickup_datetime` | Start time formatted as date + time |
| `return_datetime` | End time formatted as date + time |

Signer names are **not** prefilled — DocuSeal collects these when each party signs.

### Submission flow

1. `markDepositPaid` or `sendLeaseToNewBookings` calls `sendLeaseViaDocuSeal`.
2. `sendLeaseViaDocuSeal` selects the template based on whether a second driver email is present
   and not `No Second Email`.
3. A POST is made to `https://api.docuseal.com/submissions` with the template ID, submitters
   array, prefill values, and an email subject/body.
4. If successful (HTTP < 400), the parsed JSON response is returned.
5. `extractDocuSealSubmissionId` reads the shared submission ID from the response.
6. Column J (Lease Sent) = `Yes` and column T (DocuSeal Submission ID) = the submission ID are
   written to the sheet.
7. If the DocuSeal call fails (throws), neither J nor T is written. The catch-up engine
   (`sendLeaseToNewBookings`) will retry on its next 15-minute run.

### DocuSeal response shape

The `/submissions` endpoint returns an array of submitter objects — one per signer. Each object
has a per-submitter `id` field and a `submission_id` field (or `submission.id`) that is the same
across all signers. `extractDocuSealSubmissionId` collects `submission_id` / `submission.id`
from each element, verifies they all agree, and returns the common value. The per-submitter `id`
is intentionally not used here, as it uniquely identifies a single signer rather than the
submission.

The function logs the response structure on every call:
```
extractDocuSealSubmissionId: isArray=true, length=2
  [0] keys: id, submission_id, role, email, ...
  [0] id=1, submission_id=12345, submitter_id=..., submission.id=(none)
  [1] keys: id, submission_id, role, email, ...
  [1] id=2, submission_id=12345, submitter_id=..., submission.id=(none)
```

After the first real submission, confirm in the Executions log that `submission_id` appears in
each element. If the DocuSeal response shape differs from this, update `extractDocuSealSubmissionId`
in `DocuSeal.js` accordingly.

### Lease email

DocuSeal sends the lease email directly to each signer — it does not go through `sendEmailHtml`.
As a result, the lease email is **not** BCC'd to the manager via the script's BCC logic. The
manager already receives a DocuSeal signing request as a co-signer on every lease.

### Signed event

After all parties sign, DocuSeal sends a webhook event to Pipedream. Pipedream validates the
request, filters to completed signing events, skips the manager signing step (to avoid marking
the lease signed before the customer signs), extracts `signerEmail` and `submissionId`, and POSTs
to `doPost`:

```json
{ "secret": "...", "type": "lease_signed", "submissionId": "...", "signerEmail": "..." }
```

`doPost` routes this to `markLeaseSigned`, which first matches by `submissionId` against column T,
then falls back to email match against column C, and sets column N (Lease Signed) = `Yes`.

### DocuSeal Submission ID (Column T)

The submission ID written to column T is used by `markLeaseSigned` as the primary row-lookup key
when a signing event arrives. This eliminates the ambiguity that would occur if the same email
address appeared in multiple booking rows.

```javascript
const docuSealResp = sendLeaseViaDocuSeal(
  name, email, secondEmail, startTime, endTime, vehicleType, location
);
const submissionId = extractDocuSealSubmissionId(docuSealResp);
sheet.getRange(i + 1, 10).setValue('Yes');       // J: Lease Sent
if (submissionId != null) {
  sheet.getRange(i + 1, 20).setValue(submissionId); // T: DocuSeal Submission ID
}
```

If `extractDocuSealSubmissionId` returns null (missing field or conflicting IDs), a warning is
logged and column T is left blank. Column J is written regardless — the lease was sent even if
the ID could not be captured. In this case `markLeaseSigned` falls back to email matching.

---

## 10. Stripe Integration

### Checkout Sessions with manual authorization holds

When a new booking is detected, `syncCalendarBookings` calls `createStripeCheckoutSession()` in
`Helpers.js` to create a unique hosted Checkout Session. The session has:

- `mode: 'payment'` — one-time payment
- `line_items[0][price]` — the Stripe Price ID for the vehicle type (from `getStripePriceId()`)
- `line_items[0][quantity]: 1`
- `payment_intent_data[capture_method]: manual` — places an **authorization hold** rather than
  capturing immediately. The PaymentIntent enters `requires_capture` state after the customer pays.
- `client_reference_id` — the Google Calendar event ID, base64 URL-safe encoded (trailing `=`
  stripped), used to match the webhook payment event back to the correct booking row.
- `success_url: https://reliablestorage.com` — where Stripe redirects after the customer submits
  payment. No cancel URL is configured.
- `customer_email` — pre-populates the Stripe Checkout email field if the customer email is known
  (omitted for `No Email` rows).

The function returns the hosted Checkout Session URL, which is embedded in the welcome SMS and
email sent to the customer.

### Authorization holds and manual capture

Because `capture_method: manual` is used, **the deposit is not charged until a staff member
manually captures the hold in the Stripe Dashboard** (or via the Stripe API). The workflow is:

1. Customer opens the Checkout Session URL and completes payment → authorization hold placed.
2. Stripe fires `checkout.session.completed` → Pipedream → `markDepositPaid` → G = Yes.
3. After reviewing the booking and completing the rental, staff captures the hold in the Stripe
   Dashboard to charge the card, or releases it if the rental was cancelled.

**Authorization hold expiry:** Standard Stripe authorization holds expire after **7 days**
(up to 31 days for eligible card merchants). Holds that are neither captured nor released before
expiry are automatically voided by Stripe. Monitoring hold expiry is a planned future enhancement.

### Webhook flow

After the customer completes the Checkout Session, Stripe sends `checkout.session.completed` to
the Pipedream "Stripe Connection to Google App" workflow:

1. **Pipedream** validates the Stripe webhook signature using the Stripe webhook secret.
2. Pipedream extracts `customerEmail`, `amountPaid`, and `client_reference_id` (the encoded
   event ID) from the Stripe event payload.
3. Pipedream injects `WEBHOOK_SHARED_SECRET` as `secret` and the encoded event ID as `eventId`.
4. Pipedream POSTs to the Apps Script web app URL:
   ```json
   { "secret": "...", "customerEmail": "...", "amountPaid": "...", "eventId": "..." }
   ```
5. `doPost` validates the secret, base64-decodes `eventId` (padding re-applied as needed), and
   calls `markDepositPaid(customerEmail, amountPaid, decodedEventId)`.
6. `markDepositPaid` matches the row by event ID (column A, primary), falls back to email (column
   C), writes G = Yes and H = amount, sends confirmation messages, and dispatches the DocuSeal
   lease.

If no matching row is found, an admin alert is sent and the payment is logged for manual follow-up.

### Pipedream (Phase 1 — unchanged)

Pipedream is unchanged from the previous Payment Link implementation. The same workflow handles
both `checkout.session.completed` events from Checkout Sessions and legacy payment events. No
Pipedream changes are needed until Phase 2 (automated capture/release).

### Stripe API call in CalendarSync

`createStripeCheckoutSession` makes a synchronous HTTPS call to the Stripe API inside the
per-event try/catch in `syncCalendarBookings`. If the API call fails (network error, invalid Price
ID, Stripe outage):
- The catch block calls `alertAdmin`.
- No row is appended to the sheet.
- No welcome message is sent.
- The event will be retried on the next 5-minute trigger run (because no event ID was ever written
  to column A).

### Sandbox vs. production

Stripe has separate test mode and live mode. Use test-mode credentials (`sk_test_...`) and
test-mode Price IDs for the sandbox environment. Test Checkout Sessions can be completed using
Stripe's test card numbers (e.g., `4242 4242 4242 4242`). Point the Pipedream Stripe workflow at
a sandbox Apps Script deployment for testing.

---

## 11. Notifications

### Email (SendGrid)

All HTML emails are sent via the SendGrid v3 `/mail/send` endpoint by `sendEmailHtml()`.

**Sender:** The location-specific `EMAIL_<LOCATION>` value for all booking-related emails.
`CONFIG.FROM_EMAIL` is used only by `alertAdmin()`. Display name is always `CONFIG.FROM_NAME`.
**Reply-to:** Same as the sender — replies to any booking email go to the location's address.

**BCC logic:**
- Every email addressed to a customer is automatically BCC'd to `CONFIG.MANAGER_EMAIL`.
- Emails already addressed to `CONFIG.MANAGER_EMAIL` — approval notices, booking notices — are
  **not** BCC'd (the manager is the primary recipient, no copy needed).
- Emails addressed to `CONFIG.ADMIN_EMAIL` — error alerts — are **not** BCC'd.

### SMS (Twilio)

All SMS messages are sent via the Twilio Messages REST API by `sendSms()`. Auth uses Basic Auth
encoding of `TWILIO_SID:TWILIO_TOKEN`.

**Sender:** The location-specific `PHONE_<LOCATION>` value. All production SMS and the
`testSendSingleSms()` smoke test send from a location-specific number.

Because all messages for a given location share the same Twilio number, the site manager can see
every Bainbridge conversation in one thread, every Poulsbo conversation in another, and so on.

In `markDepositPaid`, the customer SMS is wrapped in its own `try/catch`. A Twilio failure does
not block the confirmation email or the DocuSeal lease send.

### Customer notifications

| Trigger | Channel | Content |
|---|---|---|
| New booking detected | Email + SMS | Welcome message; Stripe Checkout Session URL; pre-filled intake form URL |
| Deposit confirmed | Email + SMS | Deposit confirmation; rental agreement coming by email |
| Rental approved (only once lease is signed — Col N = Yes) | Email + SMS | "Your rental is approved" notice; sent once, tracked in Col U |
| 24hr before pickup (approved and deposit paid) | Email + SMS | Pickup reminder; pre-trip inspection form link (same link/form on both channels, complete once); states the form must be completed before driving the vehicle and that the post-trip form follows once pre-trip is done |
| One hour after pre-trip inspection form completed | Email + SMS | Post-trip inspection form link (same link/form on both channels, complete once); states the form should be completed now that the vehicle has been returned |

### Manager notifications

| Trigger | Channel | Content | Greeting |
|---|---|---|---|
| New booking detected | Email + SMS | Customer name, date, location, vehicle, contact info | `Hi {Location} Manager,` |
| Approval needed | Email only | Customer details; instructions to set column O | `Hi {Location} Manager,` |
| Approval reminder #n | Email only | Customer details; reminder number | `Hi {Location} Manager,` |
| Approval escalation | Email only | Sent to `ADMIN_EMAIL` when cap reached | none (addressed to admin, not a location manager) |
| 24hr before pickup | Email + SMS | Customer name, date, deposit status, lease status — no inspection link (the blank pre-trip form is not sent to the manager) | `Hi {Location} Manager,` |
| One hour after pre-trip inspection form completed | Email only | Customer name, vehicle, location, date, customer email, post-trip inspection form link | `Hi {Location} Manager,` |
| Suspicious inspection timing (once per booking, only if triggered) | Email only | Customer name, booking ID, vehicle, location, scheduled start/end, both inspection completion times, elapsed time — no form link, no accusatory language | `Hi {Location} Manager,` |

Each of the six manager-addressed templates opens with a greeting using that booking's location
(column S) — e.g. `Hi Bainbridge Manager,`, `Hi Poulsbo Manager,`, `Hi Port Orchard Manager,`,
`Hi Fairgrounds Manager,` — reusing the same `location` value already read for the rest of the
message body. The admin escalation email is unaffected since it is addressed to `ADMIN_EMAIL`, not
a location manager.

### Suspicious inspection timing warning

`processReminders()` compares the pre-trip and post-trip inspection completion timestamps (columns
W and X) once both are present, and warns the manager if they were submitted
`CONFIG.SUSPICIOUS_INSPECTION_WINDOW_MINUTES` apart **or less** — inclusive of the boundary itself,
so a submission exactly at the threshold still triggers the warning (Script Property
`SUSPICIOUS_INSPECTION_WINDOW_MINUTES`, default **15** — see [Operational
parameters](#operational-parameters) below for why). This is purely informational: it never blocks
approval, never alters the rental workflow, and is worded neutrally ("may be worth a look" / "does
not mean anything is wrong") — it never accuses the customer of anything. It is sent at most once
per booking, tracked in column Y (Suspicious Timing Warning Sent), and is never sent to the
customer and never contains a customer-facing form link or instructions.

Implementation: `getInspectionElapsedMinutes()`, `isSuspiciousInspectionTiming()`, and
`formatElapsedMinutes()` (all pure, `Helpers.js`); `sendSuspiciousInspectionTimingWarning_()`
(`Reminders.js`) builds and sends the email and writes column Y only after a successful send.

**Why no new sheet column was avoided first:** the codebase's convention (see `docs/setup-notes.md`,
"why not reuse P/Q instead of adding U") is against overloading an existing column with a second,
unrelated meaning. Appending a marker to W or X directly was also ruled out, since it would break
`parseInspectionCompletionTimestamp_()`'s parsing of those cells (which the post-trip reminder
timing itself depends on). Column Y — a single `Yes`/blank flag, the same pattern already used by
I/J/K/L/N/U/V — was the smallest safe way to add durable, unambiguous duplicate protection.

### Error alerts

`alertAdmin(subject, body)` sends to `CONFIG.ADMIN_EMAIL` with subject prefixed `[Rental Script]`.
It is called from `catch` blocks throughout the codebase for unexpected errors. If `alertAdmin`
itself fails (e.g., SendGrid is unreachable), it logs the failure and returns without throwing.

---

## 12. Approval State Machine

`checkRentalEligibility` runs every 5 minutes and drives a state machine tracked in column P
(last notification timestamp) and column Q (reminder count).

**Entry condition:** Column I (Intake Sent) must be `Yes`. Rows with a blank I are skipped.

**Exit condition:** Column O (Rental Approved) is set to any of the three decision values.

```
Q = 0  (no approval email sent yet)
     │
     ├── Send initial approval email to MANAGER_EMAIL
     ├── Set P = now
     └── Set Q = 1
          │
          ▼
Q = 1 or 2, hours since P >= HOURS_BETWEEN_APPROVAL_REMINDERS
     │
     ├── Send "Reminder #N" email to MANAGER_EMAIL
     ├── Set P = now
     └── Set Q = Q + 1
          │
          ▼
Q = MAX_APPROVAL_REMINDERS, hours since P >= HOURS_BETWEEN_APPROVAL_REMINDERS
     │
     ├── Send escalation email to ADMIN_EMAIL
     └── Set Q = MAX_APPROVAL_REMINDERS + 1 (permanent skip)
          │
          ▼
Q > MAX_APPROVAL_REMINDERS
     └── [skip silently — permanent silence after escalation]
```

**Default values** (from Script Properties): `HOURS_BETWEEN_APPROVAL_REMINDERS = 12`,
`MAX_APPROVAL_REMINDERS = 3` → 1 initial email + 2 reminders + 1 escalation, then permanent
silence.

**State table:**

| Q value | Condition | Action | Next Q |
|---|---|---|---|
| 0 | I = Yes, O = blank | Send initial email to manager | 1 |
| 1 | hours since P ≥ 12 | Send reminder #1 to manager | 2 |
| 2 | hours since P ≥ 12 | Send reminder #2 to manager | 3 |
| 3 | hours since P ≥ 12 | Escalate to admin | 4 (permanent skip) |
| > 3 | — | Skip silently | unchanged |

P is updated when the initial email and each reminder are sent. P is not updated at escalation.
Rows where the manager sets column O to any decision value are excluded at the top of the loop
and never receive another notification.

This state machine was audited end-to-end (row-targeting, blank/numeric/numeric-string count
parsing, write-only-on-success, and the stop-at-maximum behavior above) with no bug found — see
`testApprovalReminderCountBehavior()` in `SandboxTests.js` for the resulting regression coverage.

### Customer approval notification (separate from the manager loop)

The P/Q state machine above governs only the manager reminder loop, and it exits the moment
column O is set — it does not decide when the customer is told. **Manager approval alone never
triggers the customer's approval email.** That is a separate, one-time check:

```
Column O = Approved - Free or Approved - Paid
     │
     ▼
Column N (Lease Signed) = Yes?
     │
     ├── No  → skip this row; re-check on the next 5-minute run
     │          (approval sits in the sheet for however long signing takes;
     │           no timeout, no reminder loop for this wait)
     │
     └── Yes → Column U (Customer Approval Notified) = Yes already?
                    │
                    ├── Yes → skip (already sent)
                    └── No  → send the customer's approval email/SMS,
                               then set Column U = Yes
```

Column N is set only by the DocuSeal signed webhook (`markLeaseSigned`), so if the manager
approves before the customer signs, the system waits — the next `checkRentalEligibility` run
after the webhook updates column N is what actually sends the email. `checkRentalEligibility`
holds `LockService.getScriptLock()` for the duration of each run, so an overlapping execution
cannot read column U before a prior run has written it, preventing a duplicate send.

---

## 13. Webhook Security

### Shared secret authentication

The Apps Script web app is deployed with "Anyone" access — required for Pipedream to POST
without authentication. Every `doPost` call validates a shared secret before doing anything:

```javascript
const expectedSecret = PROPS.WEBHOOK_SHARED_SECRET;
if (!expectedSecret) throw new Error('Setup error: WEBHOOK_SHARED_SECRET is not set');
if (!data.secret || data.secret !== expectedSecret) {
  Logger.log('doPost rejected: missing or invalid secret.');
  return ContentService.createTextOutput(JSON.stringify({ received: false }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

Requests with a missing or wrong secret return HTTP 200 with `{ received: false }` — not 4xx.
A non-200 response would cause Pipedream to retry the webhook, which is not desirable for
rejected requests.

### Idempotent flag writes (Reminders)

`processReminders` writes flag columns (K and L) and flushes the spreadsheet **before** making
any external API call. If a second trigger invocation starts while the first is still running,
it will see the flag already set and skip the row. This prevents duplicate reminder messages.

### Duplicate booking prevention

`syncCalendarBookings` loads all existing Google Calendar event IDs from column A before the
main loop. Each event is checked against this list before any row is appended or any message is
sent. An event already in the sheet is skipped entirely.

### Column O protection

The manager's approval decision in column O is protected in multiple ways:
- The script contains no `setValue` calls for column O — searches of the source confirm this.
- Column O should have a data-validation dropdown restricted to exactly three values.
- `checkRentalEligibility` reads column O but never writes it.

---

## 14. Sandbox Environment

### Why a sandbox exists

The production Apps Script runs on live Google Calendar, Sheets, Stripe, DocuSeal, and messaging
accounts. Any bug in a trigger function can send real messages to real customers, write incorrect
data to the production sheet, or trigger real payment flows. A sandbox environment provides an
isolated copy of every resource so changes can be tested safely before production deployment.

### What is duplicated

| Resource | Sandbox copy | Notes |
|---|---|---|
| Google Sheet | Separate spreadsheet | Set `SHEET_ID` to the sandbox sheet |
| Google Calendar | Separate test calendar(s) | Share with the script account; set `CALENDAR_ID_*` |
| Apps Script | Separate project | Separate Script Properties for each environment |
| Stripe | Stripe test mode | Use test-mode secret key and Price IDs; complete test sessions with Stripe's test card numbers; CLI or dashboard to trigger webhook events |
| DocuSeal | DocuSeal test account or test templates | Use test template IDs |
| Pipedream | Separate workflows (or the same workflows pointed at sandbox deployment URL) | |
| Google Forms | Reuse production forms or use separate test forms | |

### What never changes between environments

- All source code (`src/*.js`) is identical between sandbox and production. The only differences
  are the Script Properties.
- The `WEBHOOK_SHARED_SECRET` should be a different value in each environment.

### Safe operations in sandbox

These operations are safe to run in the sandbox at any time:
- All functions in `SandboxTests.js`
- `setupTriggers()` and `setupSheetSchema()`
- `syncCalendarBookings()`, `checkRentalEligibility()`, `sendLeaseToNewBookings()`,
  `processReminders()` — when run against sandbox data
- `doPost` invocations via `curl` with the sandbox URL and sandbox shared secret

### Operations that must NEVER touch production

- Never run `setupTriggers()` in a production Apps Script while developing
- Never paste sandbox Script Properties into production
- Never use the production Apps Script deployment URL in `curl` tests
- Never clear column O, P, or Q in the production sheet for testing purposes
- Never `appendRow` test data to the production Bookings sheet

### Minimum Script Properties for sandbox

```
SHEET_ID                          = sandbox spreadsheet ID
SHEET_NAME                        = Bookings
COMPANY_NAME                      = Reliable Storage (Test)
ADMIN_EMAIL                       = your-email@example.com
MANAGER_EMAIL                     = your-email@example.com
MANAGER_PHONE                     = +1XXXXXXXXXX  (or leave blank)
FROM_NAME                         = Reliable Storage (Test)
CALENDAR_ID_BAINBRIDGE_CARGO_VAN  = ID of your test calendar
STRIPE_SECRET_KEY                 = sk_test_... (Stripe test-mode secret key)
STRIPE_PRICE_ID_CARGO_VAN         = price_... (Stripe test-mode Price ID)
STRIPE_PRICE_ID_MOVING_TRUCK      = price_... (Stripe test-mode Price ID)
DEPOSIT_AMOUNT_CARGO_VAN          = 50
DEPOSIT_AMOUNT_MOVING_TRUCK       = 100
TWILIO_SID                        = your Twilio SID
TWILIO_TOKEN                      = your Twilio token
SENDGRID_KEY                      = SG.your-key
FROM_EMAIL                        = test@yourdomain.com
REPLY_TO_EMAIL                    = test@yourdomain.com
DOCUSEAL_API_KEY                  = your DocuSeal key
DOCUSEAL_TEMPLATE_ONE_DRIVER      = your test template ID
DOCUSEAL_TEMPLATE_TWO_DRIVERS     = your test template ID
INTAKE_FORM_BASE                  = your intake form URL
INTAKE_ENTRY_NAME                 = (entry ID)
INTAKE_ENTRY_EMAIL                = (entry ID)
INTAKE_ENTRY_PHONE                = (entry ID)
INTAKE_ENTRY_DATE                 = (entry ID)
INSPECT_FORM_BASE                 = your inspect form URL
INSPECT_ENTRY_NAME                = (entry ID)
INSPECT_ENTRY_EMAIL               = (entry ID)
INSPECT_ENTRY_DATE                = (entry ID)
INSPECT_ENTRY_TYPE                = (entry ID)
INSPECT_VAL_PRE                   = Pre-trip Inspection
INSPECT_VAL_POST                  = Post-trip Inspection
WEBHOOK_SHARED_SECRET             = (generate: openssl rand -hex 32)
DAYS_AHEAD                        = 60
HOURS_BETWEEN_APPROVAL_REMINDERS  = 12
MAX_APPROVAL_REMINDERS            = 3
SUSPICIOUS_INSPECTION_WINDOW_MINUTES = 15
```

Properties for inactive locations (Poulsbo, Port Orchard, Fairgrounds) can be omitted. The script
silently skips calendars whose property is not set.

### Testing webhook events in sandbox

Use `curl` to simulate events against the sandbox deployment URL:

```bash
# Unauthorized request (should return { "received": false })
curl -X POST "YOUR_SANDBOX_URL" \
  -H "Content-Type: application/json" \
  -d '{"customerEmail":"test@example.com","amountPaid":50}'

# Stripe payment event (with eventId for primary lookup)
curl -X POST "YOUR_SANDBOX_URL" \
  -H "Content-Type: application/json" \
  -d '{"secret":"YOUR_SANDBOX_SECRET","customerEmail":"email-in-sheet@example.com","amountPaid":50,"eventId":"CALENDAR_EVENT_ID"}'

# Stripe payment event (email-only fallback, for rows without eventId)
curl -X POST "YOUR_SANDBOX_URL" \
  -H "Content-Type: application/json" \
  -d '{"secret":"YOUR_SANDBOX_SECRET","customerEmail":"email-in-sheet@example.com","amountPaid":50}'

# DocuSeal lease signed event (with submissionId for primary lookup)
curl -X POST "YOUR_SANDBOX_URL" \
  -H "Content-Type: application/json" \
  -d '{"secret":"YOUR_SANDBOX_SECRET","type":"lease_signed","submissionId":"12345","signerEmail":"email-in-sheet@example.com"}'
```

### Testing philosophy

The sandbox is not a staging environment — it is a development environment. The goal is not
to mirror production exactly but to exercise every code path with real external service calls
(real Twilio, real SendGrid, real DocuSeal) before promoting code to production.

Run the full configuration test suite (`runAllSandboxConfigurationTests`) at the start of every
sandbox session. Then use `testSyncCalendarBookingsNoNotifications` to verify calendar connectivity
before enabling notifications.

---

## 15. Testing

All manual test functions live in `SandboxTests.js`. Select a function from the Apps Script
editor dropdown and click **Run**. Check the Executions log for output. Never wire these to
triggers.

### Quick start

```
1. runAllSandboxConfigurationTests()           — run first; validates entire config (30 tests)
2. testCalendarConfigs()                       — confirm calendar connectivity
3. testSyncCalendarBookingsNoNotifications()   — add rows without sending messages
4. Then test the full webhook flow with curl (see Sandbox section)
```

### Configuration tests

| Function | What it verifies |
|---|---|
| `validateConfig()` | All required numeric Script Properties are set and contain valid finite numbers. Reports every problem before throwing. |
| `testDocuSealPropertyNames()` | `DOCUSEAL_API_KEY` is set (value not logged); `DOCUSEAL_TEMPLATE_ONE_DRIVER` and `DOCUSEAL_TEMPLATE_TWO_DRIVERS` are set and numeric. |
| `testSendGridConfiguration()` | `SENDGRID_KEY` is set (value not logged); `FROM_NAME`, `COMPANY_NAME`, `SHEET_NAME` are non-blank; `FROM_EMAIL`, `REPLY_TO_EMAIL`, `MANAGER_EMAIL`, `ADMIN_EMAIL` are set and look like email addresses. No API call. |
| `testTwilioConfiguration()` | `TWILIO_SID` matches `AC` + 32 alphanumeric chars; `TWILIO_TOKEN` is set (value not logged); `MANAGER_PHONE` is in E.164 format. No API call. |
| `testLocationSenderConfig()` | All eight `EMAIL_<LOCATION>` and `PHONE_<LOCATION>` properties are set and correctly formatted; `getLocationConfig()` resolves every active location without throwing; throws on an unknown location. No API call. |

### Connectivity tests

| Function | What it verifies |
|---|---|
| `testSheetConnection()` | `SHEET_ID` is set, the spreadsheet is accessible, and the Bookings tab exists. Logs row count. |
| `testCalendarConfigs()` | Every entry in `CALENDAR_CONFIGS` has its Script Property set and resolves to an accessible Google Calendar. Logs event count for the next 30 days per calendar. |
| `listAccessibleCalendars()` | Lists every calendar visible to the script account. Use when a calendar has been shared but its ID is not confirmed. |

### Mapping and resolution tests

| Function | What it verifies |
|---|---|
| `testVehicleTypeAndLocationMapping()` | Every entry in `CALENDAR_CONFIGS` has the correct `propKey`, `location`, and `vehicleType` values. Useful after adding a new location. |
| `testStripeConfiguration()` | `STRIPE_SECRET_KEY` is set (value not logged); `STRIPE_PRICE_ID_CARGO_VAN` and `STRIPE_PRICE_ID_MOVING_TRUCK` are set and start with `price_`; every vehicle type in `CALENDAR_CONFIGS` resolves via `getStripePriceId()`. No API call. |
| `testDepositAmounts()` | Every vehicle type in `CALENDAR_CONFIGS` resolves to a deposit amount via `getDepositAmount()`. Also tests the unknown-type and blank-type fallbacks. |

### Response parsing tests

| Function | What it verifies |
|---|---|
| `testExtractDocuSealSubmissionId()` | Nine mock cases: single object with `id`, null response, object with no id field, non-object, object with `submission_id`, object with `submission.id`, array with shared `submission_id`, array with shared `submission.id`, array with conflicting IDs. No live API call. |

### Webhook row-lookup tests (no side effects)

| Function | What it verifies |
|---|---|
| `testMarkDepositPaidRowLookup()` | Simulates the eventId-first / email-fallback matching logic in `markDepositPaid` against the live sheet. Three sub-tests: correct eventId finds right row, bogus eventId misses then email fallback succeeds, null eventId uses email-only path. Requires at least one unpaid booking row with an event ID in column A. |
| `testMarkLeaseSignedRowLookup()` | Simulates the submissionId-first / email-fallback matching logic in `markLeaseSigned`. Three sub-tests: submissionId match, bogus submissionId + email fallback, null submissionId + email only. Requires at least one unsigned booking row with an email in column C. |

### Robustness tests

| Function | What it verifies |
|---|---|
| `testMissingCalendarConfig()` | A null calendarId is detected and logged (not thrown). An invalid calendar ID returns null from CalendarApp without throwing. |
| `testBuildIntakeUrl()` | Requires a row containing "Test Customer" in column B. Logs the generated intake URL for visual inspection. |

### Template and message tests

| Function | What it verifies |
|---|---|
| `testEmailTemplateStrings()` | Constructs sample message strings using production interpolation patterns and checks for known-bad strings: hardcoded vehicle-type wording, wrong dash type in DocuSeal subject, inconsistent deposit status casing. No sheet reads, no API calls. |

### Dry-run tests

| Function | What it verifies |
|---|---|
| `testSyncCalendarBookingsNoNotifications()` | Full calendar sync — appends rows to the sheet for new events — without sending any email, SMS, or creating Stripe sessions. Mirrors `syncCalendarBookings` exactly (including columns R and S). Safe to run repeatedly; test rows must be cleaned up manually afterward. |
| `testLogStripeUrlForExistingBooking()` | Reads the first booking row with an event ID (col A) and vehicle type (col R). Logs the encoded `client_reference_id`, the vehicle type, and the Stripe Price ID that would be used. Includes a round-trip base64 decode check. No API call, no messages, no sheet writes. |
| `testCreateStripeCheckoutSession()` | **MAKES A LIVE STRIPE API CALL** — creates a real Checkout Session. Reads the first booking row with an event ID (col A) and vehicle type (col R), generates `clientReferenceId` using the same encoding as `CalendarSync.js`, calls `createStripeCheckoutSession()`, and logs the returned session URL. Run only when intentionally testing the live Stripe integration. Never logged: secret key, full API response. Not in the runner. |

### Reminder eligibility and send tests

| Function | What it verifies |
|---|---|
| `testPreTripReminderEligibility()` | Pure test of `isPreTripReminderEligible()` (`Helpers.js`): normal-window eligibility, deposit-unpaid exclusion, late eligibility once deposit/approval arrive, permanent exclusion once the rental has started, and the already-sent (column K) no-duplicate case. |
| `testSendPreTripReminderFlagBehavior()` | Stubs `sendSms`/`sendEmailHtml` (restored in `finally`) and a fake sheet to verify `sendPreTripReminder_()` only writes column K when the customer was actually reached — both channels failing writes nothing, either channel succeeding writes `Yes`, and no contact info on file is treated as delivered. |
| `testInspectionCompletionFormatting()` | Pure test of `formatDateTimeShort()`, `formatInspectionCompletionValue()`, `parseInspectionCompletionTimestamp_()` (`Helpers.js`), and `isInspectionCompletionValueSet_()` (`Forms.js`): the `"Yes " + formatDateTimeShort(...)` format, a format-then-parse round trip, and that the parser/detector never guess on blank or malformed input. |
| `testPostTripReminderEligibility()` | Pure test of `isPostTripReminderEligible()` (`Helpers.js`): not eligible while the pre-trip completion timestamp is unknown, not eligible before an hour has elapsed since completion, eligible at/after one hour, and the already-sent (column L) no-duplicate case. |
| `testSendPostTripReminderFlagBehavior()` | Same pattern as `testSendPreTripReminderFlagBehavior()`, against `sendPostTripReminder_()` and column L. |

### Approval reminder count tests

| Function | What it verifies |
|---|---|
| `testApprovalReminderCountBehavior()` | Stubs `getSheet` and `sendEmailHtml` (both restored in `finally`) and calls the real `checkRentalEligibility_()` directly against a fake sheet — no live sheet, no real email. Verifies: blank, numeric, and numeric-string counts are all interpreted correctly; the count increments correctly; the correct booking row is written; reminders stop at `MAX_APPROVAL_REMINDERS` (and stay stopped once past it); a failed send does not increment the count; and a two-row run never lets one booking's write affect the other's row. |

### Suspicious inspection timing tests

| Function | What it verifies |
|---|---|
| `testSuspiciousInspectionTimingCalculations()` | Pure test of `getInspectionElapsedMinutes()`, `isSuspiciousInspectionTiming()`, and `formatElapsedMinutes()` (`Helpers.js`): elapsed-time calculation, missing/malformed timestamps, the inclusive threshold boundary (outside is not suspicious; exactly at and inside are both suspicious), post-trip earlier than pre-trip, and elapsed-time formatting (including the negative-value note). |
| `testSendSuspiciousInspectionTimingWarningFlagBehavior()` | Stubs `sendEmailHtml` (restored in `finally`) and a fake sheet to verify `sendSuspiciousInspectionTimingWarning_()` only writes column Y after a successful manager email — a failed send or a missing `MANAGER_EMAIL` writes nothing, so the row is retried on the next run and the warning is never sent twice. |

### Immediate inspection send tests

| Function | What it does |
|---|---|
| `testSendPreTripInspection()` | **[LIVE]** Sends the real pre-trip inspection email and SMS to `SANDBOX_TEST_EMAIL` / `SANDBOX_TEST_PHONE`, using content built by the real `buildPreTripReminderContent_()` from a "Test Customer" booking row. Does not write column K or notify the manager — pure system test, not an operational send. Validates the test row has an email, phone, resolvable location, and `INSPECT_FORM_BASE` before sending. Not in the runner. |
| `testSendPostTripInspection()` | **[LIVE]** Same as above, for the post-trip inspection message (`buildPostTripReminderContent_()`); does not write column L or notify the manager. Not in the runner. |

Contrast with `sendPreTripInspectionNowForRow(rowNumber)` / `sendPostTripInspectionNowForRow(rowNumber)`
(`src/Reminders.js`, not `SandboxTests.js`) — those ARE real operational sends against a real
booking row's real contact info, for an authorized resend or an early-return post-trip send; see
[Immediate inspection sends](#immediate-inspection-sends-remindersjs) above.

### Test runners

| Function | What it does |
|---|---|
| `runAllSandboxConfigurationTests()` | Runs 30 tests in sequence: `validateConfig`, `testSheetConnection`, `testCalendarConfigs`, `testMissingCalendarConfig`, `testVehicleTypeAndLocationMapping`, `testStripeConfiguration`, `testDepositAmounts`, `testDocuSealPropertyNames`, `testExtractDocuSealSubmissionId`, `testSendGridConfiguration`, `testTwilioConfiguration`, `testLocationSenderConfig`, `testApprovalNotificationEligibility`, `testDocuSealEligibility`, `testEmailTemplateStrings`, `testIntakeFormSubmitRowMatching`, `testExtractIntakeSubmissionFields`, `testInspectionFormSubmitRowMatching`, `testExtractInspectionSubmissionFields`, `testFormSubmitDispatcher`, `testPreTripReminderEligibility`, `testSendPreTripReminderFlagBehavior`, `testInspectionEmailsExcludeManagerFromRecipients`, `testInspectionCompletionFormatting`, `testPostTripReminderEligibility`, `testSendPostTripReminderFlagBehavior`, `testApprovalReminderCountBehavior`, `testSuspiciousInspectionTimingCalculations`, `testSendSuspiciousInspectionTimingWarningFlagBehavior`, `testTriggerRegistrationIsWellFormed`. Logs a clear header before starting and a completion banner when all pass. |

### Standalone manual tests (not in runner)

| Function | What it does |
|---|---|
| `testSendSingleSms()` | Sends a real Twilio SMS to the configured test number with a timestamped message. Use to verify Twilio delivery end-to-end. Run manually; never add to the runner. |
| `testSendPreTripInspection()` / `testSendPostTripInspection()` | See [Immediate inspection send tests](#immediate-inspection-send-tests) above. Run manually; never add to the runner. |

### End-to-end flow tests

For a complete flow test (new booking → intake → deposit → lease → signing → approval → 24-hour
reminder → pre-inspection → post-rental → post-inspection), follow the checklist in
[`docs/testing-plan.md`](docs/testing-plan.md), which also tracks exactly which scenarios have
been confirmed working end-to-end versus still awaiting validation — see
[Repository status](#repository-status).

---

## 16. Development Workflow

This project runs entirely inside Google Apps Script. There is no local execution environment —
all code must be deployed to Apps Script before it can run.

### Typical change cycle

```bash
# 1. Edit source file(s) in src/
#    Use your preferred editor

# 2. Deploy to sandbox Apps Script
#    Option A: paste file contents directly into the Apps Script editor
#    Option B: use clasp

clasp push   # pushes all src/*.js files to the Apps Script project

# 3. Verify the file was saved (check the editor's file list)

# 4. Run relevant test(s) from SandboxTests.js

# 5. For engine changes: add a test row and run the engine function manually

# 6. For webhook changes: use curl against the sandbox URL

# 7. Review execution logs
#    Apps Script Editor → Executions (left sidebar)

# 8. Commit
git status
git add src/FileName.js
git commit -m "Describe the change"
git push
```

### When changes take effect

There are three distinct mechanisms in play, and they are easy to conflate:

- **`git commit` / `git push`** only affects this repository's history. It has no effect on the
  live Apps Script project whatsoever until the code is separately deployed there (by pasting
  files or by `clasp push`).
- **`clasp push`** (or pasting files manually) updates the Apps Script **project's source code**.
  This alone is what both time-driven triggers (`syncCalendarBookings`, `checkRentalEligibility`,
  `sendLeaseToNewBookings`, `processReminders`) and the spreadsheet-bound `onFormSubmit` trigger
  run — every trigger always executes the current saved project code on its next firing. No
  redeployment and no trigger reinstallation is needed for ordinary source-only changes.
- **A new Apps Script web app deployment** (Deploy → Manage deployments → New version) is a
  separate, additional step required **only** when the code reachable through `doGet`/`doPost`
  must change — the deployed web app serves whichever version was active at the time of its last
  deployment, not automatically the latest saved source.

| Change type | `clasp push` / paste sufficient? | New web app deployment needed? | Re-run `setupTriggers()`? |
|---|---|---|---|
| Trigger-path functions (`syncCalendarBookings`, `checkRentalEligibility`, `sendLeaseToNewBookings`, `processReminders`) | Yes — live on next scheduled firing | No | No |
| `onFormSubmit` / `Forms.js` processing logic | Yes — live on next form submission | No | No |
| `doPost` / `doGet` (`Webhooks.js`) | Source is updated, but the **live web app endpoint** still runs the old version | **Yes** | No |
| Script Properties | Immediate — `PROPS` is read fresh at the start of every execution | No | No |
| Trigger architecture itself (adding/removing/rescheduling a trigger, e.g. what `Setup.js` registers) | Yes | No | **Yes** — `setupTriggers()` must be re-run to actually install the new trigger set |

In short: **re-running `setupTriggers()` is not part of the normal edit cycle.** It is only needed
the first time, or after a change to which triggers exist or how they're scheduled — not after
every `clasp push`.

### Viewing logs

- **Apps Script Editor → Executions** (left sidebar) — shows every trigger run and manual
  execution with `Logger.log()` output and any thrown exceptions.
- Trigger executions include the trigger interval and any stack trace on failure.
- `doPost` executions include the full request processing log.

### Using clasp

[clasp](https://github.com/google/clasp) allows pushing all files from the command line:

```bash
npm install -g @google/clasp
clasp login
clasp push   # pushes all src/*.js files defined in .clasp.json
```

A `.clasp.json` file in the repository root maps `src/` to the target Apps Script project ID. Use
separate `.clasp.json` configurations or separate clasp sessions for sandbox and production
projects.

---

## 17. Deployment

### Initial deployment checklist

```
[ ] 1. Open the Google Sheet → Extensions → Apps Script
[ ] 2. Create one script file per src/*.js file — all 12 files must be present
        (Config, CalendarSync, Leases, Approval, Reminders, Notifications,
         DocuSeal, Webhooks, Forms, Helpers, Setup, SandboxTests)
[ ] 3. Paste the contents of each src/*.js file into its matching editor file
[ ] 4. Set all 50 Script Properties in Project Settings → Script Properties
[ ] 5. Run validateConfig() from the editor — confirm no errors
[ ] 6. Run testSheetConnection() — confirm Bookings tab is accessible
[ ] 7. Run testCalendarConfigs() — confirm each active calendar is reachable
[ ] 8. Run setupTriggers() — creates all 5 triggers and applies sheet schema
[ ] 9. Confirm column R (Vehicle Type) and S (Location) have dropdown validation
[ ] 10. Set up column O dropdown validation manually:
         Approved - Free | Approved - Paid | Denied
[ ] 11. Confirm column T (DocuSeal Submission ID) header exists in row 1
[ ] 12. Deploy as Web App: Deploy → New deployment → Web app
         Execute as: Me
         Who has access: Anyone
[ ] 13. Copy the deployment URL
[ ] 14. Set that URL as the destination in each Pipedream workflow's POST step
[ ] 15. Configure Stripe webhook to point to the Pipedream Stripe workflow URL
[ ] 16. Configure DocuSeal webhook to point to the Pipedream DocuSeal workflow URL
[ ] 17. Test unauthorized POST (expect { "received": false } and no sheet changes)
[ ] 18. Run testSyncCalendarBookingsNoNotifications() — confirm calendar rows appear
[ ] 19. Create a real test booking and let syncCalendarBookings detect it naturally
[ ] 20. Follow docs/testing-plan.md for full end-to-end flow verification
```

### Updating deployed code

**Trigger-path changes (most edits):**
1. Paste updated file into the Apps Script editor and save.
2. The next trigger run picks up the change automatically.
3. No new deployment needed.

**Webhook endpoint changes (`Webhooks.js`):**
1. Save the updated file.
2. Deploy → Manage deployments → Edit → New version → Deploy.
3. The web app URL stays the same; no Pipedream update needed.

### Re-deployment note

Creating a new versioned deployment preserves the existing web app URL. Only creating a new
*deployment* (not a new *version*) generates a new URL. If a new deployment is unavoidable and
generates a new URL, update both Pipedream workflow POST steps.

---

## 18. Adding a New Location

Adding a location that uses an existing vehicle type requires only configuration changes — no
source code changes.

**Steps:**

1. **Create the Google Calendar** for the new location and configure Appointment Schedules.

2. **Share the calendar** with the Google account that owns the Apps Script project.
   (Google Calendar → Settings → Share with specific people → Add the script account email → Give
   "See all event details" access or better.)

3. **Get the calendar ID** from Google Calendar → Settings → Integrate calendar → Calendar ID.
   It ends in `@group.calendar.google.com`.

4. **Add an entry to `CALENDAR_CONFIGS`** in `src/Config.js`:
   ```javascript
   {
     propKey:     'CALENDAR_ID_NEWTOWN_CARGO_VAN',
     calendarId:  PROPS.CALENDAR_ID_NEWTOWN_CARGO_VAN,
     location:    'Newtown',
     vehicleType: 'Cargo Van',
   },
   ```

5. **Set the Script Properties** in Apps Script → Project Settings → Script Properties:
   - `CALENDAR_ID_NEWTOWN_CARGO_VAN` → the Calendar ID from step 3
   - `EMAIL_NEWTOWN` → the sending email address for this location (must be a verified SendGrid sender)
   - `PHONE_NEWTOWN` → the Twilio phone number for this location in E.164 format

6. **Add the location to `getLocationConfig`** in `src/Helpers.js`. In the `MAP` object, add:
   ```javascript
   'Newtown': { email: CONFIG.EMAIL_NEWTOWN, phone: CONFIG.PHONE_NEWTOWN },
   ```
   Also add `EMAIL_NEWTOWN` and `PHONE_NEWTOWN` to `CONFIG` in `src/Config.js`.

7. **Re-run `setupSheetSchema()`** (or `setupTriggers()`) to add `Newtown` to the Location
   dropdown in column S.

8. **Run `testCalendarConfigs()` and `testLocationSenderConfig()`** to confirm the new calendar
   is accessible and the sender properties are correctly set.

The next `syncCalendarBookings` run will detect events from the new calendar automatically.

---

## 19. Adding a New Vehicle Type

Adding a vehicle type that does not already exist requires changes in three source files plus new
Script Properties.

**Steps:**

1. **Add an entry to `CALENDAR_CONFIGS`** in `src/Config.js` with the new `vehicleType` string.

2. **Add the vehicle type to both lookup tables** in `src/Helpers.js`:

   ```javascript
   function getDepositAmount(vehicleType) {
     const amounts = {
       'Cargo Van':    CONFIG.DEPOSIT_AMOUNT_CARGO_VAN,
       'Moving Truck': CONFIG.DEPOSIT_AMOUNT_MOVING_TRUCK,
       'Box Truck':    CONFIG.DEPOSIT_AMOUNT_BOX_TRUCK,    // ← add
     };
     ...
   }

   function getStripePriceId(vehicleType) {
     const ids = {
       'Cargo Van':    CONFIG.STRIPE_PRICE_ID_CARGO_VAN,
       'Moving Truck': CONFIG.STRIPE_PRICE_ID_MOVING_TRUCK,
       'Box Truck':    CONFIG.STRIPE_PRICE_ID_BOX_TRUCK,  // ← add
     };
     ...
   }
   ```

3. **Add the corresponding CONFIG entries** in `src/Config.js`:
   ```javascript
   // ---- Deposit amounts ----
   DEPOSIT_AMOUNT_BOX_TRUCK:     PROPS.DEPOSIT_AMOUNT_BOX_TRUCK,

   // ---- Stripe ----
   STRIPE_PRICE_ID_BOX_TRUCK:    PROPS.STRIPE_PRICE_ID_BOX_TRUCK,
   ```

4. **Set the new Script Properties** in the Apps Script console:
   - `DEPOSIT_AMOUNT_BOX_TRUCK` — e.g. `75`
   - `STRIPE_PRICE_ID_BOX_TRUCK` — the Stripe Price ID for the Box Truck deposit product
   - `CALENDAR_ID_<LOCATION>_BOX_TRUCK` — one per location using this vehicle type
   - Note: this project is at the 50-property limit. Each new vehicle type consumes 2 slots
     (`DEPOSIT_AMOUNT_*` and `STRIPE_PRICE_ID_*`) plus one per calendar. Verify you have
     capacity before adding.

5. **Re-run `setupSheetSchema()`** to add `Box Truck` to the Vehicle Type dropdown in column R.

6. **Add the vehicle type to `testVehicleTypeAndLocationMapping()`** in `SandboxTests.js` if you
   want the test to verify the new entry.

---

## 20. Troubleshooting

> See also [docs/operations-runbook.md](docs/operations-runbook.md) for a shorter,
> question-oriented quick-reference covering the same ground for day-to-day operation.

### No new rows from a calendar

1. Run `testCalendarConfigs()` — reports whether each calendar Script Property is set and whether
   the calendar is accessible.
2. Run `listAccessibleCalendars()` — lists all calendars visible to the script account. If the
   target calendar is absent, it needs to be shared with the script account.
3. Check the Executions log for `syncCalendarBookings` — look for lines containing `skipping`
   (property not set) or `calendar not found`.
4. Confirm the event's start time falls within the `DAYS_AHEAD` window from now.

### A customer received a duplicate message

Duplicates can happen in two scenarios:

- **Welcome message:** Very unlikely. `syncCalendarBookings` checks event IDs before sending. If a
  duplicate appeared, check whether the same event ID appears twice in column A — it should not.
  The more common cause is that column I (Intake Sent) was manually cleared, but `syncCalendarBookings`
  uses event ID dedup, not the I flag, so clearing I alone would not trigger a resend.

- **Reminder message:** Flag-before-send (`processReminders` writes K or L and flushes before
  sending) prevents most cases. A duplicate can occur if column K or L was manually cleared in
  the sheet after the reminder was already sent.

### A webhook POST arrived but nothing happened

1. Check the Executions log for `doPost` — look for `doPost rejected: missing or invalid secret`.
2. Verify `WEBHOOK_SHARED_SECRET` is set and matches the `secret` field in each Pipedream
   workflow's POST step.
3. Verify the Pipedream workflow is posting to the current Apps Script deployment URL. If a new
   versioned deployment was created, the URL may have changed.
4. Use `doGet` to verify the URL is reachable: `curl YOUR_DEPLOYMENT_URL` should return
   `{COMPANY_NAME} webhook endpoint is live.` (the value of your `COMPANY_NAME` Script Property).

### Approval reminders are not sending

1. Confirm column I (Intake Sent) = `Yes` — `checkRentalEligibility` skips rows where intake is
   not marked as sent.
2. Confirm column O (Rental Approved) is blank — rows with any of the three decision values are
   skipped entirely.
3. Check column Q (Approval Reminder Count). If it is greater than `MAX_APPROVAL_REMINDERS` (3
   by default), the row has been permanently silenced after escalation to admin. Set Q to a lower
   value to restart the loop (note this will resend notifications).
4. Check column P (Approval Notified At) — if it is set and `HOURS_BETWEEN_APPROVAL_REMINDERS`
   has not elapsed since that timestamp, the reminder is simply not due yet.

### The DocuSeal lease is not sending

1. Run `testDocuSealPropertyNames()` — confirms `DOCUSEAL_API_KEY` is set and both template IDs
   are numeric.
2. Verify the DocuSeal template role names match exactly:
   - Single driver: `Driver #1`, `Reliable Storage Manager`
   - Two drivers: `Driver #1`, `Driver #2`, `Reliable Storage Manager`
3. Check the Executions log for `sendLeaseViaDocuSeal` — any HTTP 4xx/5xx from DocuSeal will
   appear as `DocuSeal error:` followed by the response body.
4. Confirm `MANAGER_EMAIL` is set — the manager is added as a co-signer on every lease; if the
   email is missing, the submitters array will omit the manager role.

### Column T (DocuSeal Submission ID) is blank after lease sent

1. Check the Executions log for `extractDocuSealSubmissionId: isArray=` — this line is logged on
   every lease send.
2. If the log shows `isArray=true`, look for the per-element logs showing `submission_id` values.
   If `submission_id` is absent from all elements, DocuSeal may be using a different field.
   Update `extractDocuSealSubmissionId` in `DocuSeal.js` accordingly.
3. If no `extractDocuSealSubmissionId:` line appears, the function was not called — check whether
   `sendLeaseViaDocuSeal` threw before returning (which would also prevent J from being written).

### The 24-hour reminder did not fire

1. Confirm column O (Rental Approved) is `Approved - Free` or `Approved - Paid` — the 24-hour
   reminder only fires for approved bookings.
2. Confirm column K (24hr Sent) is blank — a `Yes` means it already fired.
3. The window is `hoursUntilStart` between 0 and 26. If `processReminders` ran when
   `hoursUntilStart` was exactly 0 or exactly 26, verify the actual timestamp difference.
4. Check the Executions log for `processReminders` runs during the expected window.

### The post-trip reminder did not fire

1. Confirm column W (Pre-Inspection Form Completed) holds a `"Yes <date/time>"` value, not blank
   and not a bare `Yes` — the post-trip reminder is timed from this recorded completion timestamp,
   parsed by `parseInspectionCompletionTimestamp_()` in `Helpers.js`. If W is blank, the pre-trip
   inspection form has not been submitted (or matched) yet.
2. If W's timestamp portion is not a parseable date, `parseInspectionCompletionTimestamp_()`
   returns `null` and the post-trip reminder can never fire for that row until W is corrected by
   hand — this is a defensive "never guess" behavior, not a bug to route around.
3. Confirm column L (Post-Rental Sent) is blank — a `Yes` means it already fired.
4. The reminder fires on the first `processReminders` run where at least one hour has elapsed
   since W's timestamp — check the Executions log for `processReminders` runs after that point.
5. The booking's End Time (column F) is **not** used for this timing — do not use it to predict
   when the post-trip reminder will fire. (`POST_RENTAL_HOURS`, the old timing basis, has been
   removed entirely.)

### The suspicious inspection timing warning did not fire (or fired unexpectedly)

1. Confirm both column W and column X hold a parseable `"Yes <date/time>"` value — the check only
   runs once both are present (`getInspectionElapsedMinutes()` returns `null`, and nothing is sent,
   if either is missing or unparseable).
2. Confirm column Y is blank — a `Yes` means the manager was already warned for this booking; it
   fires at most once.
3. Compare the two timestamps' difference against `SUSPICIOUS_INSPECTION_WINDOW_MINUTES`
   (`isSuspiciousInspectionTiming()` in `Helpers.js` — the threshold is inclusive: a gap at or
   below the configured number of minutes triggers the warning, including exactly at the
   threshold).
4. If it fired and you did not expect it to, remember the check does not use absolute value: a
   post-trip timestamp recorded *before* the pre-trip timestamp also triggers it (see
   `formatElapsedMinutes()`'s negative-value note in the resulting email).
5. If a row is older than 48 hours past End Time with K and L already `Yes`, it is still scanned
   as long as X has a value and Y is still blank — it is not skipped by the same 48-hour cutoff
   that limits the ordinary reminder scan.

### Stripe Checkout Session not created (syncCalendarBookings alert)

1. Check the Executions log for `syncCalendarBookings` — look for `Stripe API error` followed by
   an HTTP status code (e.g., `400`, `401`, `404`).
2. A `401` error means `STRIPE_SECRET_KEY` is invalid or missing. Verify it is set correctly in
   Script Properties. It should start with `sk_live_` (production) or `sk_test_` (sandbox).
3. A `404` error on the Price lookup means `STRIPE_PRICE_ID_CARGO_VAN` or
   `STRIPE_PRICE_ID_MOVING_TRUCK` does not exist in the Stripe account associated with your key.
   Verify the Price IDs in the Stripe Dashboard match the Script Properties exactly.
4. If the Stripe call fails, no row is appended to the sheet and no welcome message is sent.
   The booking event will be retried on the next 5-minute trigger run.
5. Run `testCreateStripeCheckoutSession()` (standalone, not in the runner) to manually verify
   that Stripe API calls succeed for an existing booking row.

### Stripe deposit paid but wrong row updated (or row not found)

1. Check the Executions log for `markDepositPaid` — look for lines indicating whether the eventId
   primary lookup or email fallback was used.
2. If `no eventId match` appears and the email fallback also fails, verify that Pipedream is
   extracting `client_reference_id` from the Stripe `checkout.session.completed` event and
   passing it as `eventId` in the POST body.
3. If the `eventId` decoding log line shows `could not decode client_reference_id`, the value may
   not be valid base64 — check that no URL-encoding of `+` and `/` characters happened in the
   Stripe payload before Pipedream passes it to Apps Script.

---

## 21. Known Limitations and Future Work

### Current limitations

**No retry for failed welcome messages:** If `sendSms` or `sendEmailHtml` throws during
`syncCalendarBookings`, the row is still added to the sheet (the `appendRow` already ran). On the
next trigger run the event ID is already in the sheet, so the event is skipped. The customer may
not receive the welcome message. A manual resend or re-clearing of column I could address this,
but there is no automated recovery path.

**Column T not initialised in new rows:** `syncCalendarBookings` writes 19 values (A–S) in its
`appendRow` call. Column T is left uninitialized. This is intentional — the DocuSeal submission
ID is not available at row creation time — but it means `getDataRange().getValues()` returns an
array where index 19 is undefined for new rows.

**No lock for syncCalendarBookings:** `processReminders` and `checkRentalEligibility` both use
`LockService` to prevent overlapping executions. `syncCalendarBookings` does not. A concurrent
run could, in theory, see the same new booking event (before column A is updated) and send a
duplicate welcome message. In practice, `appendRow` is atomic from the sheet's perspective, but
the race window exists.

**`setupSheetSchema` manages columns R, S, U, V, W, and X only:** Column headers A–Q and T must be
set up manually. If a column is accidentally deleted or renamed, the script will silently read the
wrong data.

**Lease email not BCC'd to manager:** DocuSeal sends lease emails directly — they do not pass
through `sendEmailHtml`. The manager receives a DocuSeal co-signer request instead of a BCC copy.

**No lock on any of the three lease-sending call sites:** `markDepositPaid` (`Webhooks.js`),
`processIntakeFormSubmission_` (`Forms.js`), and `sendLeaseToNewBookings` (`Leases.js`) can each
independently send a DocuSeal lease, and none acquires `LockService`. Column J (Lease Sent) is
only written *after* the DocuSeal API call succeeds, not before. If a deposit clears and the
intake form is submitted within moments of each other, two of these paths can both pass their own
eligibility check before either writes J, producing two DocuSeal submissions for the same booking.
Confirmed by code tracing; not yet observed in sandbox testing.

**First-match-wins email fallback in the two webhook handlers:** `markDepositPaid` and
`markLeaseSigned` (`Webhooks.js`) fall back to a simple loop that stops at the first row matching
the customer's email, with no ambiguity check — unlike the deliberately ambiguity-safe matcher
(`findBookingMatchRow_`) used by the intake and inspection form handlers. A repeat customer with
two simultaneous eligible bookings under the same email could have a Stripe payment or DocuSeal
signature silently applied to the wrong row. Confirmed by code tracing; not yet observed in
sandbox testing.

**Pre-trip reminder can be permanently skipped for a booking:** `isPreTripReminderEligible()`
(`Helpers.js`) requires the booking to be approved and the deposit paid before the pre-trip
reminder (and its inspection link) is sent; a booking missing either one is safely re-evaluated on
every `processReminders` run for as long as it remains inside the 26-hour window, so it is not
permanently skipped as long as approval and payment both land before the window closes. If either
one lands only after `hoursUntilStart` has already gone negative (the window closed), the pre-trip
reminder never fires for that booking, with no retry — and because the post-trip reminder is timed
from the pre-trip inspection's own completion timestamp (column W), a booking that never received
its pre-trip reminder also never receives a post-trip reminder, even if the customer completes the
inspection form some other way (e.g., a manually shared link). Confirmed by code tracing; not yet
observed in sandbox testing.

### Stripe Checkout Session migration (complete)

The migration from static Stripe Payment Links to dynamic Stripe Checkout Sessions with manual
authorization holds is complete. All source files (`src/Config.js`, `src/Helpers.js`,
`src/CalendarSync.js`, `src/Reminders.js`, `src/SandboxTests.js`) and `docs/setup-notes.md`
have been updated. Authorization hold capture/release remains manual via the Stripe Dashboard
and is tracked under Future improvements below.

### Future improvements

- **Phase 2 Stripe:** Automate authorization hold capture on approved bookings; automate release on denied bookings or cancellations
- Add hold-expiry monitoring — alert admin when a `requires_capture` PaymentIntent is approaching the 7-day expiry
- Add `LockService` to `syncCalendarBookings` to fully close the concurrent-add race window
- Add automated column header verification (compare row 1 against expected headers at startup)
- Add retry logic for failed welcome messages (e.g., check I flag independently of event ID, and
  re-attempt if I is blank and the event is already in the sheet)
- Add per-location or per-vehicle-type customisation of email/SMS content
- Extend `setupSheetSchema` to write and verify all column headers A–T
- Add rate-limiting awareness for Twilio and SendGrid (both have per-second limits)

### Technical debt

- The `testSyncCalendarBookingsNoNotifications` test in `SandboxTests.js` calls `appendRow` on
  the live sheet, which must be manually cleaned up after testing.
- The `SHEET_NAME` property is used in `getSheet()` via `CONFIG.SHEET_NAME`, but `SHEET_ID` is
  read directly via `getProperty()` — an inconsistency in how the two sheet configuration values
  are accessed.

---

## 22. Code Style

### Language and runtime

Google Apps Script V8 runtime. Modern JavaScript (`const`, `let`, arrow functions, template
literals, spread, destructuring) is supported. `var` is used sparingly in older test functions
for broader compatibility.

### No module system

All files share one global scope. Function names must be unique across all 12 files. Prefix
private helpers with the file's domain if collision risk exists.

### Configuration access

- Script Properties accessed via `PROPS.PROPERTY_NAME` (from the `PROPS` object in `Config.js`)
- All downstream code reads from `CONFIG.*` — never calls `PropertiesService` directly
- Exception: `getSheet()` reads `SHEET_ID` via `getProperty()` directly (historical; intentional)

### Error handling

- Functions that call external APIs (`sendSms`, `sendEmailHtml`, `sendLeaseViaDocuSeal`) throw
  on HTTP errors. Callers are responsible for catching.
- `processReminders` wraps each row's processing in a `try/catch` so one failing row does not
  block the rest.
- `alertAdmin` is the boundary for unrecoverable errors — call it from `catch` blocks when
  manual intervention may be needed.
- Never swallow an exception silently — always `Logger.log` at minimum.

### Idempotency

Every action that sends an external message or modifies the sheet checks a flag first. The
typical pattern:

```javascript
if (flagColumn !== 'Yes') {
  // For reminders: write flag first, then send
  sheet.getRange(row, col).setValue('Yes');
  SpreadsheetApp.flush();
  sendSms(...);
  sendEmailHtml(...);
}
```

For webhook handlers and CalendarSync, the deduplication check (event ID or deposit flag) happens
before the action rather than writing the flag first.

### Column index conventions

The codebase uses two column numbering systems:

- `data[i][N]` — 0-based array index from `getDataRange().getValues()`
- `sheet.getRange(row, N)` — 1-based column number

Column mapping:

```
0-based  1-based  Column  Header
0        1        A       Event ID
1        2        B       Customer Name
...
9        10       J       Lease Sent
...
14       15       O       Rental Approved
15       16       P       Approval Notified At
16       17       Q       Approval Reminder Count
17       18       R       Vehicle Type
18       19       S       Location
19       20       T       DocuSeal Submission ID
20       21       U       Customer Approval Notified
21       22       V       Intake Form Completed
22       23       W       Pre-Inspection Form Completed
23       24       X       Post-Inspection Form Completed
24       25       Y       Suspicious Timing Warning Sent
```

There is no helper that converts column names to indices. All column accesses use hardcoded
numbers with a comment identifying the column header (e.g., `data[i][14] // O: Rental Approved`).

### Logging

Use `Logger.log` throughout. Messages include the function name when the context is not obvious.
Sensitive values (API keys, secrets, phone numbers, email addresses) are never logged. DocuSeal
response structure (keys and ID fields) is logged on every submission, but not response values.

### Comments

Comments explain non-obvious constraints, invariants, or workarounds — not what the code does.
Examples: why the BCC is suppressed for manager emails, why `To == From` is rejected by Twilio,
why column O is never written, why the shared secret returns HTTP 200 on rejection.
