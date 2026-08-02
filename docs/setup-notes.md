# Setup Notes — Reliable Storage Vehicle Rental Automation

## Source code structure

The Apps Script source is split across multiple files in `src/`. Each file holds one logical group of functions:

| File | Contents |
|---|---|
| `Config.js` | `PROPS`, `CONFIG`, `CALENDAR_CONFIGS` — all configuration and Script Property bindings |
| `Forms.js` | `buildIntakeUrl`, `buildInspectUrl`, `onFormSubmit` (dispatcher), `processIntakeFormSubmission_`, `processInspectionFormSubmission_`, matching/extraction helpers |
| `DocuSeal.js` | `sendLeaseViaDocuSeal` |
| `Webhooks.js` | `doPost`, `doGet`, `markDepositPaid`, `markLeaseSigned` |
| `CalendarSync.js` | `syncCalendarBookings` |
| `Leases.js` | `sendLeaseToNewBookings` |
| `Approval.js` | `checkRentalEligibility` |
| `Reminders.js` | `processReminders` |
| `Notifications.js` | `sendSms`, `sendEmailHtml`, `alertAdmin` |
| `Helpers.js` | `getSheet`, `getExistingEventIds`, extraction helpers, `toDate`, date formatters, `getDepositAmount`, `getStripePriceId`, `createStripeCheckoutSession`, `getLocationConfig` |
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
| `MANAGER_EMAIL`  | Site manager — BCC'd on customer emails by default (except the pre-trip/post-trip inspection emails — see below), receives booking and approval notices |
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

| Property key                    | What it is                                                                                   |
|---------------------------------|----------------------------------------------------------------------------------------------|
| `STRIPE_SECRET_KEY`             | Stripe secret API key — used server-side to create Checkout Sessions. Never log this value.  |
| `STRIPE_PRICE_ID_CARGO_VAN`     | Stripe Price ID for the Cargo Van deposit product (must start with `price_`)                 |
| `STRIPE_PRICE_ID_MOVING_TRUCK`  | Stripe Price ID for the Moving Truck deposit product (must start with `price_`)              |

### Deposit amounts (customer-facing)

| Property key                  | What it is                                       |
|-------------------------------|--------------------------------------------------|
| `DEPOSIT_AMOUNT_CARGO_VAN`    | Dollar amount shown in SMS/email (e.g. `50`)     |
| `DEPOSIT_AMOUNT_MOVING_TRUCK` | Dollar amount shown in SMS/email (e.g. `100`)    |
| `DEPOSIT_AMOUNT`              | Fallback amount for rows with a blank Vehicle Type col |

### Twilio (SMS)

| Property key   | What it is                                                                        |
|----------------|-----------------------------------------------------------------------------------|
| `TWILIO_SID`   | Twilio Account SID — begins with `AC`, followed by 32 alphanumeric characters |
| `TWILIO_TOKEN` | Twilio Auth Token — used for Basic Auth alongside the SID                     |

`MANAGER_PHONE` (listed under Identity and routing above) is also consumed by the SMS system — it receives new-booking and 24-hour pre-rental notifications.

**E.164 format**: `MANAGER_PHONE` and all `PHONE_<LOCATION>` values must begin with `+` followed by the country code and number with no spaces or dashes (e.g. `+12065550100` for a US number). A missing country code produces Twilio "Invalid To Phone Number" errors at send time.

**Trial account**: on a Twilio trial account, all outbound SMS are prefixed with "Sent from your Twilio trial account — " and can only be delivered to phone numbers that have been individually verified in the Twilio console. Verify `MANAGER_PHONE` and any test customer phone numbers before running end-to-end tests.

**Sandbox-only**: `SANDBOX_TEST_PHONE` (optional) is a Script Property read by the manual `testSendSingleSms()`, `testSendPreTripInspection()`, and `testSendPostTripInspection()` functions in `SandboxTests.js` — set it to your own verified phone number before running any of those tests. `SANDBOX_TEST_EMAIL` (optional) is the email counterpart, read by `testSendPreTripInspection()` and `testSendPostTripInspection()` — set it to your own verified inbox. Neither is used anywhere in production code paths, and neither is part of `CONFIG`.

### SendGrid (email)

| Property key     | What it is                                                                       |
|------------------|----------------------------------------------------------------------------------|
| `SENDGRID_KEY`   | SendGrid API key — must have the **Mail Send** permission scope                  |
| `FROM_EMAIL`     | Sender address for all outbound emails — must be a verified sender in SendGrid   |
| `FROM_NAME`      | Display name shown in the From field of every outbound email                     |
| `REPLY_TO_EMAIL` | Reply-to address on all customer emails (typically the site manager's address)   |

`ADMIN_EMAIL` and `MANAGER_EMAIL` (listed under Identity and routing above) are also consumed by the email system: `MANAGER_EMAIL` is automatically BCC'd on customer-facing emails by default, except the pre-trip and post-trip inspection emails, which are sent with `suppressManagerBcc = true` (see `sendEmailHtml()` in `src/Notifications.js`) so the manager never receives either blank inspection form, not even by BCC; `ADMIN_EMAIL` receives script error alerts and approval escalations.

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

No additional Script Property is used for intake-completion detection or matching — see
"Matching an intake submission to the correct booking row" below.

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

`INSPECT_VAL_PRE` and `INSPECT_VAL_POST` are used only to pre-fill the form's dropdown when
building the link (`buildInspectUrl()`) — they are display text (e.g. "Pre-trip Inspection"), not
necessarily what the response sheet records. No additional Script Property is used for
inspection-completion detection or matching: like intake, the inspection form's responses are a
tab in the same spreadsheet identified by `SHEET_ID` — see "Matching an inspection submission to
the correct booking row" below.

### Location-specific senders

Each active location has its own sending email address and Twilio phone number. Every customer-facing email and SMS for a booking is sent from the address and number associated with that booking's location (column S). The global `FROM_EMAIL` is used only by `alertAdmin()`. All booking SMS messages are sent from the location-specific `PHONE_<LOCATION>` number returned by `getLocationConfig()`.

| Property key           | What it is                                                             |
|------------------------|------------------------------------------------------------------------|
| `EMAIL_BAINBRIDGE`     | From-address for all Bainbridge booking emails                         |
| `PHONE_BAINBRIDGE`     | Twilio sender number for all Bainbridge booking SMS (E.164)            |
| `EMAIL_POULSBO`        | From-address for all Poulsbo booking emails                            |
| `PHONE_POULSBO`        | Twilio sender number for all Poulsbo booking SMS (E.164)               |
| `EMAIL_PORT_ORCHARD`   | From-address for all Port Orchard booking emails                       |
| `PHONE_PORT_ORCHARD`   | Twilio sender number for all Port Orchard booking SMS (E.164)          |
| `EMAIL_FAIRGROUNDS`    | From-address for all Fairgrounds booking emails                        |
| `PHONE_FAIRGROUNDS`    | Twilio sender number for all Fairgrounds booking SMS (E.164)           |

All `EMAIL_<LOCATION>` values must be verified senders in SendGrid (single sender or authenticated domain). All `PHONE_<LOCATION>` values must be SMS-capable Twilio numbers in E.164 format (`+` followed by 7–15 digits, e.g. `+12065551234`).

The helper function `getLocationConfig(location)` in `Helpers.js` is the single lookup for these properties. It throws — never silently falls back — if the location string does not match one of the four active locations.

### Webhooks

| Property key            | What it is                                                          |
|-------------------------|---------------------------------------------------------------------|
| `WEBHOOK_SHARED_SECRET` | Shared secret validating Pipedream → Apps Script requests (see below) |

## Google Sheet setup

Sheet tab must be named `Bookings` (exact, case-sensitive).

Row 1 headers (columns A–Y). Columns R, S, U, V, W, X, and Y are written by
`syncCalendarBookings()` / `setupSheetSchema()` as noted below:

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
| J   | Lease Sent              | markDepositPaid / processIntakeFormSubmission_ / sendLeaseToNewBookings |
| K   | 24hr Sent               | processReminders   |
| L   | Post-Rental Sent        | processReminders   |
| M   | Second Driver Email     | syncCalendarBookings |
| N   | Lease Signed            | markLeaseSigned (webhook) |
| O   | Rental Approved         | **Manager only** — script never writes this |
| P   | Approval Notified At    | checkRentalEligibility |
| Q   | Approval Reminder Count | checkRentalEligibility |
| R   | Vehicle Type            | syncCalendarBookings (from CALENDAR_CONFIGS) |
| S   | Location                | syncCalendarBookings (from CALENDAR_CONFIGS) |
| T   | DocuSeal Submission ID  | markDepositPaid / processIntakeFormSubmission_ / sendLeaseToNewBookings (via sendLeaseViaDocuSeal) |
| U   | Customer Approval Notified | checkRentalEligibility (via notifyCustomerOfApproval) |
| V   | Intake Form Completed   | processIntakeFormSubmission_, called from onFormSubmit (installable trigger — see below) |
| W   | Pre-Inspection Form Completed | processInspectionFormSubmission_, called from onFormSubmit (installable trigger — see below); value is `"Yes <date/time>"`, not a bare `Yes` |
| X   | Post-Inspection Form Completed | processInspectionFormSubmission_, called from onFormSubmit (installable trigger — see below); value is `"Yes <date/time>"`, not a bare `Yes` |
| Y   | Suspicious Timing Warning Sent | processReminders (via sendSuspiciousInspectionTimingWarning_) |

**Column U** is a simple `Yes`/blank flag, same pattern as I/J/K/L. It tracks whether the
customer has been sent the one-time "your rental is approved" notification, so the notification
is never sent twice.

**Manager approval alone does not trigger the customer email.** `checkRentalEligibility` only
sends the customer notification once column N (Lease Signed) is also `Yes`. If the manager sets
column O before the lease is signed, the approval value simply waits in the sheet — manager
reminders stop immediately, but the customer email is not sent until a later run of
`checkRentalEligibility` sees column N updated by the DocuSeal signed webhook
(`markLeaseSigned`). See [Approval reminder behavior](#approval-reminder-behavior-v7) below.

> **Why not reuse columns P/Q instead of adding U?** P (Approval Notified At) and Q (Approval
> Reminder Count) are the *manager* reminder loop's own state — they record when the manager was
> last asked to approve and how many times. `checkRentalEligibility` stops touching P/Q the
> moment a row is approved (see the code comments), so they freeze at whatever value they held
> when the manager acted — a useful historical record of the manager's response time that would
> be destroyed by overloading them with a second, unrelated meaning. Repurposing Q in particular
> (e.g. a special value meaning "customer notified") would make a single number mean two
> different things depending on context, which is exactly the kind of ambiguous state this
> column avoids. No other existing column (I/J/K/L/N) represents "customer told about the
> approval decision" either — each already has its own distinct, unambiguous meaning. Column U
> is therefore necessary, not a convenience.

**Column V** is also a simple `Yes`/blank flag. It is the only reliable signal that the intake
form was actually *submitted* — column I (Intake Sent) only means the pre-filled link was
emailed to the customer, not that they filled it out. `markDepositPaid`, `processIntakeFormSubmission_`,
and `sendLeaseToNewBookings` all require column V = `Yes` (in addition to column G = `Yes`)
before sending the DocuSeal lease, so the deposit and the intake form can arrive in either order
and the lease is still only ever sent once. It is written only inside `processIntakeFormSubmission_()`,
which `onFormSubmit()` (the installed trigger — see "Trigger setup" below) calls only after Google
Forms has already accepted and recorded the submission — there is no earlier point in the flow at
which the script could observe it.

> **Why a flag instead of scanning the intake response sheet on every trigger run?** The intake
> form's responses are linked to the "Rental Intake Form" tab in the same spreadsheet as Bookings
> (identified by `SHEET_ID`) — as is the inspection form's "Rental Vehicle Condition Inspection
> Form" tab; there is no separate spreadsheet for either. Re-scanning either tab from
> `checkRentalEligibility` (every 5 min), `sendLeaseToNewBookings` (every 15 min), or the deposit
> webhook would mean repeatedly reading a sheet that only grows over time and re-solving the same
> row-matching problem on every run. The single `onFormSubmit` trigger is spreadsheet-bound (see
> "Trigger setup" below), but it only ever *reacts* to the one newly-appended row a form-submit
> event carries in `e.range`/`e.namedValues` — it never scans or reads the rest of either response
> tab's history. The event-driven flag does the matching work exactly once, at submission time,
> for the cost of one row write — no matter how large the response sheets grow.

**Columns W and X** track whether the pre-trip and post-trip inspection forms were actually
*submitted*, like U and V, but unlike those two they are not a bare `Yes`/blank flag — each holds
`"Yes " + formatDateTimeShort(submittedAt)` (e.g. `Yes 8/2/2026 9:15 AM`), combining the completion
flag and the actual form-submission time in one cell (`formatInspectionCompletionValue()` in
`src/Helpers.js`). The timestamp comes from the response sheet's own Google-Forms-generated
`Timestamp` column (`e.namedValues['Timestamp']`, read in `extractInspectionSubmissionFields()` in
`src/Forms.js`) — the actual moment the customer submitted the form, not the time the script
happens to process the event. Both columns are written only inside
`processInspectionFormSubmission_()`, the inspection form's equivalent of
`processIntakeFormSubmission_()`, also called only from `onFormSubmit()`. The two columns are
tracked completely independently: a pre-trip submission only ever writes W, a post-trip submission
only ever writes X, and each is idempotent on its own — a resubmission of an already-completed
inspection is a silent no-op, not an error and not a duplicate write (recognized by
`isInspectionCompletionValueSet_()`, which treats any value with a `Yes` prefix as done, regardless
of the timestamp text that follows it — see below).

**Column W now gates the post-trip reminder's timing.** `processReminders` reads W back via
`parseInspectionCompletionTimestamp_()` (`src/Helpers.js`) and sends the post-trip reminder on the
first run at least one hour after that recorded completion time (`isPostTripReminderEligible()`) —
see the `Reminders.js — Engine 3` entry in [README.md's Source File
Reference](../README.md#5-source-file-reference). Column X is not read anywhere else in the code
except by the suspicious-timing check described next — it otherwise only records completion. See
"Matching an inspection submission to the correct booking row" below for the matching details.

**Column Y (Suspicious Timing Warning Sent)** is a simple `Yes`/blank flag, same pattern as
U/V. Once both W and X hold a parseable completion timestamp, `processReminders` computes the
elapsed time between them (`getInspectionElapsedMinutes()` in `src/Helpers.js`) and, if it is less
than `CONFIG.SUSPICIOUS_INSPECTION_WINDOW_MINUTES` (`isSuspiciousInspectionTiming()`, also
`Helpers.js` — see [README.md's Operational
parameters](../README.md#operational-parameters) for the threshold and why 15 minutes was chosen),
sends a neutral, informational warning to the manager
(`sendSuspiciousInspectionTimingWarning_()` in `src/Reminders.js`) and writes Y = `Yes` only after
that email succeeds, so a failed send is retried on the next run and a successful one is never
repeated. This check does not block or alter the rental workflow in any way, is never sent to the
customer, and never contains a customer-facing form link or instructions — it exists purely to
give the manager a chance to review the two inspection responses. No existing column or notes
field was reused for this: the codebase's own convention (see the "why not reuse P/Q instead of
adding U" reasoning above) is against overloading a column with a second, unrelated meaning, and
appending a marker into W or X directly would break `parseInspectionCompletionTimestamp_()`'s
parsing — so a new column was the smallest safe way to add durable, unambiguous duplicate
protection.

### Matching an intake submission to the correct booking row

`processIntakeFormSubmission_()` matches by the submitted email (case-insensitive) plus, when
available, the pre-filled rental date — see `findIntakeMatchRow()` in `src/Forms.js`. This is
deliberately **not** name-based matching.

**This never guesses.** `findIntakeMatchRow()` returns one of three outcomes: `matched` (exactly
one eligible row identified — the only case that writes anything), `ambiguous` (two or more
not-yet-complete rows share the email and the rental date could not tell them apart), or
`not_found` (no eligible row has that email at all). Email-only matching is used only as a
controlled fallback, and only when it is itself unambiguous — i.e. exactly one not-yet-complete
row exists for that email overall. If two or more do, the result is `ambiguous`, not an arbitrary
pick. On `ambiguous` or `not_found`, `processIntakeFormSubmission_()` writes nothing to the sheet
and sends no DocuSeal lease — it only logs a warning naming the submission's email so it can be
resolved manually. Already-completed rows (column V = `Yes`) are never eligible and can never
cause or block a match.

**No unique booking identifier is carried through the intake form.** `buildIntakeUrl()` only
pre-fills name, email, phone, and rental date. There is no Event ID (or similar) field on the
form and no corresponding Script Property, and the current design does not add one — that would
require both a manual change to the live Google Form (which this repository does not own or
control) and a new Script Property, neither of which is in scope right now.

This means a repeat customer with two *simultaneous, incomplete* bookings that also happen to
share the same rental date is a case this repository's matching cannot resolve automatically.
That is intentional and by design: rather than guess which booking the submission belongs to,
`findIntakeMatchRow()` reports `ambiguous`, and `processIntakeFormSubmission_()` deliberately
processes nothing for it — no column write, no DocuSeal submission — logging a warning naming the
submission's email so it can be resolved manually instead. This is the accepted tradeoff of not
carrying a unique identifier through the form: safe-but-occasionally-manual, never silently wrong.

### Matching an inspection submission to the correct booking row

`processInspectionFormSubmission_()` reuses the exact same algorithm as
`processIntakeFormSubmission_()` — both call a shared helper, `findBookingMatchRow_()` in
`src/Forms.js`, generalized to take the relevant completion column (V for intake, W or X for
inspection) as a parameter rather than hardcoding it. `findIntakeMatchRow()` and
`findInspectionMatchRow()` are both thin wrappers around this one shared implementation, so the
two form handlers can never drift into inconsistent matching rules. Matching is by submitted email
(case-insensitive) plus, when available, the pre-filled rental date — never by customer name,
which the matcher does not even read.

Because the pre-trip and post-trip inspections share one Google Form, `processInspectionFormSubmission_()`
first reads back the submission's `Inspection Type` answer and compares it against
`CONFIG.INSPECT_VAL_PRE` / `CONFIG.INSPECT_VAL_POST` — the submitted answer and both configured
values are independently normalized with `String(value).trim().toLowerCase()` before comparing.
The live form's dropdown option text (e.g. `Pre-Trip (Before Vehicle Pickup)` /
`Post-Trip (After Vehicle Return)`) is the same text `buildInspectUrl()` uses to pre-fill the
dropdown — the two are the same two Script Properties, read for two different purposes, so they
can never drift out of sync with each other. Anything that doesn't normalize-match either
configured value is left `null` rather than guessed. A `null` classification is refused outright —
no matching is attempted and no row is touched — and alerts `ADMIN_EMAIL` with the submission's
email and the raw (unrecognized) answer so the type-question configuration can be checked.

`findInspectionMatchRow()` returns one of four outcomes (one more than `findIntakeMatchRow()`):
`matched`, `ambiguous`, `not_found`, and `already_done` — the last one specifically for a
duplicate submission of an inspection that is already marked complete, which `findIntakeMatchRow()`
folds into `not_found` to preserve its original external behavior unchanged, but which
`processInspectionFormSubmission_()` handles as a distinct, silent no-op rather than treating it
the same as a genuinely unmatched submission. `ambiguous` and `not_found` both alert `ADMIN_EMAIL`
with the inspection type, submitter email, and rental date (when known) — this differs from
`processIntakeFormSubmission_()`, which only logs those cases; the admin alert was added
specifically for inspection because, unlike intake, there is no other point later in the flow
where a missed inspection completion would surface on its own.

**Column O** must have a data-validation dropdown restricted to:
- `Approved - Free`
- `Approved - Paid`
- `Denied`

The script never writes to column O. Only the manager does.

**Columns R and S** have dropdown validation applied automatically by `setupSheetSchema()`. The dropdown values are derived directly from `CALENDAR_CONFIGS`, so adding a new calendar config entry automatically updates the dropdowns.

## Trigger setup

Run `setupTriggers()` once manually from the Apps Script editor toolbar.
This deletes all existing project triggers and registers exactly five new ones:

| Function        | Trigger type | Interval / event |
|-----------------|--------------|-------------------|
| `syncCalendarBookings`   | time-based   | every 5 min  |
| `checkRentalEligibility` | time-based   | every 5 min  |
| `sendLeaseToNewBookings` | time-based   | every 15 min |
| `processReminders`       | time-based   | every 30 min |
| `onFormSubmit`           | spreadsheet-bound | on form submit (see below) |

`setupTriggers()` also calls `setupSheetSchema()` to apply column headers and dropdown validation.

**No manual trigger installation is required.** In this project's Apps Script configuration, the
Triggers UI's "Select event source" dropdown offers only **Time-driven** and **From calendar** —
verified live against the sandbox project. It does not offer **From form** or **From
spreadsheet**, so a manually-created "on form submit" trigger is not an option here at all.

Instead, `setupTriggers()` creates the `onFormSubmit` trigger **programmatically**, via
`installFormSubmitTrigger_()` in `Setup.js`:

```javascript
ScriptApp.newTrigger('onFormSubmit')
  .forSpreadsheet(ss)
  .onFormSubmit()
  .create();
```

The `ScriptApp` API supports creating this trigger type regardless of what the Triggers UI
dropdown lists — the UI and the API are not the same surface. `ss` is obtained via
`getSheet().getParent()` (`Helpers.js`) — the same spreadsheet Bookings already lives in, resolved
through the existing `SHEET_ID` Script Property. **No new Script Property is added or required.**

### One trigger, one dispatcher, two response tabs

The intake form and the inspection form are **not** separate spreadsheets. Both write their
responses into tabs of the one spreadsheet identified by `SHEET_ID` — alongside `Bookings` itself:

- `Rental Intake Form` — the intake form's response tab
- `Rental Vehicle Condition Inspection Form` — the inspection form's response tab

A spreadsheet-bound `onFormSubmit` trigger fires for **every** form linked to that spreadsheet, not
just one — Apps Script does not support installing two separate onFormSubmit triggers for the same
spreadsheet, and there is no need to: `setupTriggers()` installs exactly one, and `onFormSubmit(e)`
in `src/Forms.js` is a dispatcher that reads `e.range.getSheet().getName()` and routes accordingly:

```javascript
function onFormSubmit(e) {
  const sheetName = e.range.getSheet().getName();
  if (sheetName === INTAKE_RESPONSE_SHEET_NAME)   { processIntakeFormSubmission_(e); return; }
  if (sheetName === INSPECT_RESPONSE_SHEET_NAME)  { processInspectionFormSubmission_(e); return; }
  // any other sheet: ignored
}
```

`processIntakeFormSubmission_()` and `processInspectionFormSubmission_()` are the same processing
logic that used to be reached directly as separate triggers — moved behind the dispatcher, not
rewritten. Each also independently re-checks its own response-sheet name (defense in depth), so
both behave safely even if ever called directly (e.g. from a test) without going through
`onFormSubmit()`.

Because `setupTriggers()` deletes every existing project trigger before recreating them, it is
safe to run more than once and never creates a duplicate `onFormSubmit` trigger.

### Why a spreadsheet trigger, and what that changes about the event shape

A trigger created with `.forSpreadsheet(ss).onFormSubmit()` fires on that spreadsheet's form-submit
event, which has a **different shape** than a form-bound trigger's event: it provides
`e.namedValues` (an object keyed by the exact form question title) and `e.range` (the newly
appended response row), not `e.response`. `onFormSubmit()` and the two processing functions in
`src/Forms.js` are written for this shape — none of them use `e.response`, Google Form
`ItemResponse` parsing, or any `FormApp` call.

**All response-sheet question-title and tab-name constants are filled in and verified**, not
placeholders:

| Constant | Value | Used for |
|---|---|---|
| `INTAKE_RESPONSE_SHEET_NAME` | `'Rental Intake Form'` | Routing + ignoring unrelated submissions |
| `INTAKE_RESPONSE_EMAIL_QUESTION_TITLE` | `'Email Address'` | Intake email extraction |
| `INTAKE_RESPONSE_DATE_QUESTION_TITLE` | `'Rental Date'` | Intake date extraction |
| `INSPECT_RESPONSE_SHEET_NAME` | `'Rental Vehicle Condition Inspection Form'` | Routing + ignoring unrelated submissions |
| `INSPECT_RESPONSE_EMAIL_QUESTION_TITLE` | `'Email Address'` | Inspection email extraction |
| `INSPECT_RESPONSE_DATE_QUESTION_TITLE` | `'Rental Date'` | Inspection date extraction |
| `INSPECT_RESPONSE_TYPE_QUESTION_TITLE` | `'Inspection Type'` | Inspection pre/post classification |

All seven constants live in `src/Forms.js`. If any live form question is ever retitled, or either
response tab renamed, the matching constant is the only place that needs updating — the affected
processing function would otherwise safely find nothing and process nothing rather than silently
reading the wrong field.

### Matching stays ambiguity-safe

Matching logic (`findIntakeMatchRow()`, `findInspectionMatchRow()`) is unchanged by any of this:
email plus rental date when available, a controlled email-only fallback only when unambiguous, and
an explicit `ambiguous` result — no sheet write, no DocuSeal request — whenever a submission cannot
be safely resolved to exactly one booking. See "Matching an intake submission to the correct
booking row" and "Matching an inspection submission to the correct booking row" above.

### After deploying

**`setupTriggers()` must be re-run after every `clasp push`** that touches trigger-related code —
pushing new source does not itself install or update triggers. This is not new to this feature; it
applies to the four original time-based triggers too, and now also to the single `onFormSubmit`
spreadsheet trigger described above.

See `src/Forms.js` and `src/Setup.js` for the full implementation.

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

The reminder interval and cap are Script Properties, not fixed values — see
`HOURS_BETWEEN_APPROVAL_REMINDERS` and `MAX_APPROVAL_REMINDERS` above. The state machine:

- Q = 0: no notification sent yet → sends initial email → sets P = now, Q = 1
- 1 ≤ Q < MAX_APPROVAL_REMINDERS, hours since P ≥ HOURS_BETWEEN_APPROVAL_REMINDERS: sends reminder → increments Q
- Q = MAX_APPROVAL_REMINDERS, hours since P ≥ HOURS_BETWEEN_APPROVAL_REMINDERS: escalates to ADMIN_EMAIL → sets Q = MAX_APPROVAL_REMINDERS + 1 (permanent skip)
- Q > MAX_APPROVAL_REMINDERS: row is silently skipped forever
- Manager sets column O to resolve; script skips all resolved rows for the reminder loop

**Audited and confirmed correct.** This state machine was traced end-to-end against the actual
`checkRentalEligibility_()` implementation: Q is read with `Number(data[i][16]) || 0` (blank,
numeric, and numeric-string values are all interpreted correctly), every write targets
`getRange(i + 1, 17)` using the same row index the row was read from (no cross-row writes), and Q
is written only *after* the manager email succeeds (inside the `try`, after `sendEmailHtml`) — a
failed send is retried on the next run rather than silently counted. No SMS is sent for approval
reminders, so there is no "one attempt vs. two channels" ambiguity to resolve. No bug was found;
see `testApprovalReminderCountBehavior()` in `SandboxTests.js` for the regression coverage added
to confirm this (blank/numeric/numeric-string counts, correct increment, correct row targeting,
stopping at the intended maximum, and one booking's row never affecting another's in the same
run).

This state machine (P/Q) governs only the manager reminder loop and stops the moment column O is
set. It does not govern the customer notification. The customer's one-time "your rental is
approved" email is a separate check: once column O is `Approved - Free` or `Approved - Paid`,
`checkRentalEligibility` sends it only when column N (Lease Signed) is also `Yes` and column U is
not already `Yes`. If the lease has not been signed yet, the row is skipped and re-checked on
every subsequent 5-minute run until the DocuSeal signed webhook sets column N — there is no
separate reminder loop or timeout for this wait. `checkRentalEligibility` acquires
`LockService.getScriptLock()` before each run (same pattern as `processReminders`) so an
overlapping execution cannot read column U before a prior run finishes writing it, which
prevents a duplicate send of the customer email.

## Manual immediate inspection sends

Both inspection reminders normally wait for their eligibility window (`isPreTripReminderEligible()`
/ `isPostTripReminderEligible()` in `src/Helpers.js`, evaluated by `processReminders()`). Two
different manual paths exist for sending one immediately instead, for two different purposes:

**Pure system testing (`SandboxTests.js`, safe by default):** `testSendPreTripInspection()` and
`testSendPostTripInspection()` build the exact production email/SMS content
(`buildPreTripReminderContent_()` / `buildPostTripReminderContent_()` in `src/Reminders.js` — the
same functions `sendPreTripReminder_()` / `sendPostTripReminder_()` call internally, so there is
only one copy of each template) using a real Bookings row (found the same way
`testBuildIntakeUrl()` finds one: the first row whose Customer Name contains "Test Customer"), but
send to `SANDBOX_TEST_EMAIL` / `SANDBOX_TEST_PHONE` instead of that row's real contact info. They
do **not** call `sendPreTripReminder_()` / `sendPostTripReminder_()`, so columns K/L are never
written and no manager notice is sent — this is a pure test of the message-building and delivery
path, not a real operational send. Both validate the test row has an email, a phone, a resolvable
location, and that `INSPECT_FORM_BASE` is set before sending anything, and log exactly which
booking row and test recipient were used. Requires `SANDBOX_TEST_EMAIL` and `SANDBOX_TEST_PHONE`
in Script Properties. Not included in `runAllSandboxConfigurationTests()` — they send real
messages (to the test recipient, never a real customer).

**Authorized real sends (`src/Reminders.js`, production helpers):**
`sendPreTripInspectionNowForRow(rowNumber)` and `sendPostTripInspectionNowForRow(rowNumber)` take
a 1-based sheet row number and call the real `sendPreTripReminder_()` / `sendPostTripReminder_()`
directly against that row's actual email and phone — bypassing the eligibility window, but
otherwise identical to the automated path: on success, K/L is written and the manager notice goes
out normally. These are real sends and must only be run manually, from the Apps Script editor, for
a specific authorized reason — e.g. re-sending an inspection link after confirming with the
customer it did not arrive, or sending the post-trip link immediately because a vehicle was
returned unusually early (rather than waiting for the customer to complete the pre-trip form and
the usual one-hour delay, which does not apply here since this bypasses that check entirely).
Neither function is wired to any trigger or reachable from any customer-facing surface.

## Suspicious inspection timing warning

`CONFIG.SUSPICIOUS_INSPECTION_WINDOW_MINUTES` (Script Property `SUSPICIOUS_INSPECTION_WINDOW_MINUTES`,
default **15**) is the threshold `processReminders()` uses to warn the manager when a booking's
pre-trip and post-trip inspection forms were completed that many minutes apart **or less** — the
boundary is inclusive, so a submission exactly at the threshold still triggers the warning (see
`isSuspiciousInspectionTiming()` in `src/Helpers.js`, and column Y in [Google Sheet
setup](#google-sheet-setup) above). 15 minutes was chosen as a reasonable default: long enough that
even a very short, legitimate rental plausibly involves driving somewhere and back between
completing the two forms, short enough that it only flags submissions that are implausibly close
together. Adjust it in Script Properties if a location's real usage pattern calls for a different
value — no code change is required.

The warning is sent at most once per booking (column Y), is manager-only, is worded neutrally
("may be worth a look" / "does not mean anything is wrong"), never contains a customer-facing form
link, and never blocks or alters anything else in the workflow. See
`sendSuspiciousInspectionTimingWarning_()` in `src/Reminders.js` for the exact email content, and
`testSuspiciousInspectionTimingCalculations()` / `testSendSuspiciousInspectionTimingWarningFlagBehavior()`
in `SandboxTests.js` for the test coverage.
