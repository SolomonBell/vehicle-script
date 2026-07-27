# Sandbox Plan — Modular v8 Parity Testing

> **⚠ Historical document.** This plan was written during the v7-to-v8 parity testing phase,
> before the multi-site refactor. It references removed Script Properties (`STRIPE_PAYMENT_URL`,
> `TWILIO_NUM`, `BITLY_TOKEN`, single `CALENDAR_ID`) and the single-location code structure.
> For current sandbox setup, see **README.md §14 (Sandbox Environment)** and
> **docs/setup-notes.md**. The Pipedream duplication checklist and curl test cases in
> sections 5–6 remain valid.

**Original purpose:** Verify that the 11-file modular v8 code behaves identically to the
single-file production script before beginning the multi-site refactor. Testing
runs entirely in an isolated environment. No production resource is edited,
reconfigured, or pointed at a sandbox URL at any point during this process.

---

## Ground Rule

> **Production is read-only during sandbox testing.**
>
> Do not edit the production Pipedream workflows, the production Apps Script
> project, the production Google Sheet, or the production Stripe or DocuSeal
> webhook registrations. If a sandbox test requires a configuration change,
> that change is made only in the sandbox equivalents listed below.

---

## 1. Sandbox Components to Create

| Component | How to create |
|---|---|
| **Sandbox Google Sheet** | File → Make a copy of the production sheet. Rename it clearly (e.g., `[SANDBOX] Reliable Storage Bookings`). Clear all real customer rows from the Bookings tab — keep headers only. |
| **Sandbox Apps Script project** | In the sandbox sheet: Extensions → Apps Script. This creates a new project bound to the sandbox sheet. Paste all 11 `src/*.js` files into it (one script file per source file). |
| **Sandbox web app deployment** | From the sandbox Apps Script editor: Deploy → New deployment → Web app. Set *Execute as: Me*, *Who has access: Anyone*. Save the deployment URL — it is different from production and must never replace the production URL. |
| **Test Google Calendar** | Create a new Google Calendar named `[SANDBOX] Truck Rentals` or similar. This is the calendar the sandbox `CALENDAR_ID` Script Property points to. Do not use the production Bainbridge calendar. |
| **Sandbox Pipedream workflows** | Duplicate both active Pipedream workflows (Stripe and DocuSeal). See section 5 for the full duplication checklist. |
| **Sandbox WEBHOOK\_SHARED\_SECRET** | Generate a new secret: `openssl rand -hex 32`. This value is different from the production secret. Use it only in the sandbox. |

---

## 2. What Can Be Copied from Production

These resources are safe to reuse in the sandbox without modification.

| Resource | Copy method |
|---|---|
| **Bookings sheet schema** | The "Make a copy" step above preserves the A–Q headers, column widths, and column O data-validation dropdown. Verify the dropdown still restricts to `Approved - Free`, `Approved - Paid`, `Denied` after copying. |
| **Apps Script source code** | Copy from `src/*.js` in this repository — the sandbox gets the same 11 files. |
| **DocuSeal template IDs** | `1234567` (single driver) and `7654321` (two drivers) are the same templates. The sandbox will send real DocuSeal submissions to test email addresses. |
| **Google Form URLs** | `INTAKE_FORM_BASE` and `INSPECT_FORM_BASE` can point to the production forms during sandbox testing. Submissions from the sandbox go into the same form responses, which is acceptable. If this is undesirable, create test copies of both forms and update the Script Properties accordingly. |
| **Twilio credentials** | `TWILIO_SID` and `TWILIO_TOKEN` can be the same. The sandbox will send real SMS messages — restrict test phone numbers to your own verified number. Do not use real customer phone numbers in sandbox bookings. |
| **SendGrid credentials** | `SENDGRID_KEY` can be the same. The sandbox will send real emails — restrict test email addresses to your own verified address. |
| **Bitly token** | `BITLY_TOKEN` can be the same. Bitly shortens URLs regardless of environment. |
| **Pipedream workflow logic** | The workflow code/logic is duplicated as-is. Only the destination URL and secret value change. |

---

## 3. What Must Be Newly Generated

These values must be fresh for the sandbox. Do not copy from production.

| Item | How to generate | Why |
|---|---|---|
| **`WEBHOOK_SHARED_SECRET`** | `openssl rand -hex 32` | Production and sandbox must have different secrets. Sharing secrets means a sandbox Pipedream misconfiguration could inadvertently reach production doPost. |
| **Sandbox Apps Script deployment URL** | Generated automatically on Deploy → New deployment | Each Apps Script deployment has a unique URL. The sandbox URL must be registered only in sandbox Pipedream workflows — never in production workflows. |
| **Sandbox Pipedream HTTP trigger URLs** | Generated when duplicating each workflow | Each duplicated Pipedream workflow gets a new trigger URL. Register these in Stripe test mode and DocuSeal sandbox/test webhook settings, not in the production webhook registrations. |
| **`CALENDAR_ID`** | Google Calendar ID of the new test calendar | The sandbox must poll a test calendar, not the production Bainbridge calendar, to avoid processing real customer bookings. |
| **Stripe test mode credentials** | Stripe Dashboard → Developers → toggle to Test mode | Use `STRIPE_PAYMENT_URL` from Stripe test mode. Use the test mode `STRIPE_SECRET_KEY`. Register the sandbox Pipedream Stripe workflow URL in Stripe test mode webhooks only. |

---

## 4. Script Properties Checklist

Set all of the following in the **sandbox Apps Script project** under
Project Settings → Script Properties. Do not touch production Script Properties.

> **⚠ Stale property table** — reflects the single-location v8 era. For current required
> Script Properties, see **docs/setup-notes.md §Script Properties** and
> **README.md §14 (Sandbox Environment §Minimum Script Properties)**.

| Property key | Value to use in sandbox | Status |
|---|---|---|
| `CALENDAR_ID_BAINBRIDGE_CARGO_VAN` | ID of the test Google Calendar | Current |
| `STRIPE_SECRET_KEY` | Stripe test mode secret key (`sk_test_...`) | Current |
| `STRIPE_PRICE_ID_CARGO_VAN` | Stripe test mode Price ID | Current |
| `STRIPE_PRICE_ID_MOVING_TRUCK` | Stripe test mode Price ID | Current |
| `TWILIO_SID` | Same as production | Current |
| `TWILIO_TOKEN` | Same as production | Current |
| `SENDGRID_KEY` | Same as production | Current |
| `DOCUSEAL_API_KEY` | Same as production | Current |
| `INTAKE_FORM_BASE` | Production form URL, or URL of a test copy | Current |
| `INSPECT_FORM_BASE` | Production form URL, or URL of a test copy | Current |
| `WEBHOOK_SHARED_SECRET` | **Newly generated** — different from production | Current |
| `STRIPE_PAYMENT_URL` | ~~Stripe test mode payment link~~ | **Removed** — replaced by Checkout Sessions |
| `TWILIO_NUM` | ~~Hardcoded in Config.js~~ | **Removed** — replaced by per-location `PHONE_<LOCATION>` |
| `BITLY_TOKEN` | ~~URL shortener~~ | **Removed** — never in current codebase |

Before running any test: open Apps Script → Executions or Logger and run a
no-op function to confirm the project loads without errors. If `PROPS` or
`CONFIG` has an `undefined` value, the execution log will show it immediately.

---

## 5. Pipedream Duplication Checklist

Complete this checklist for each of the two active workflows.

### For each workflow (Stripe and DocuSeal):

- [ ] Open the production workflow in Pipedream
- [ ] Use **Duplicate workflow** — do not edit the original
- [ ] Rename the duplicate clearly (e.g., `[SANDBOX] Stripe Connection to Google App`)
- [ ] In the duplicate workflow, update the **final HTTP POST step**:
  - Change the destination URL from the production Apps Script URL to the **sandbox deployment URL**
  - Change the `secret` value from the production `WEBHOOK_SHARED_SECRET` to the **sandbox secret**
- [ ] Save and deploy the sandbox workflow
- [ ] Copy the sandbox workflow's **HTTP trigger URL** (the URL Stripe or DocuSeal calls)
- [ ] Register this trigger URL in the appropriate test environment:
  - **Stripe workflow:** add as a webhook endpoint in Stripe Dashboard test mode only
  - **DocuSeal workflow:** add as a webhook endpoint in DocuSeal account settings, restricted to the test/sandbox context if available
- [ ] Confirm the production workflow's destination URL is still the production Apps Script URL and has not been changed

### Final check before running any sandbox test:

- [ ] Production Pipedream workflows: URLs and secrets unchanged ✓
- [ ] Sandbox Pipedream workflows: pointing to sandbox URL and sandbox secret ✓
- [ ] Production Stripe webhooks: still pointing to production Pipedream trigger URL ✓
- [ ] Sandbox Stripe test webhooks: pointing to sandbox Pipedream trigger URL ✓

---

## 6. Manual `doPost` Security Tests

Run these with `curl` against the **sandbox deployment URL** before running any
workflow-driven tests. These verify that `WEBHOOK_SHARED_SECRET` validation
works correctly in the sandbox environment.

Replace `<sandbox-url>` with the sandbox Apps Script web app deployment URL.
Replace `<sandbox-secret>` with the value set in the sandbox Script Properties.

### Test A — Missing secret is rejected

```bash
curl -s -X POST "<sandbox-url>" \
  -H "Content-Type: application/json" \
  -d '{"customerEmail":"test@example.com","amountPaid":50}'
```

**Expected:** `{"received":false}` returned. No rows updated in sandbox sheet.
No emails sent. No SMS sent. Rejection logged in Apps Script execution log.

### Test B — Wrong secret is rejected

```bash
curl -s -X POST "<sandbox-url>" \
  -H "Content-Type: application/json" \
  -d '{"secret":"wrong-value","customerEmail":"test@example.com","amountPaid":50}'
```

**Expected:** Same as Test A — `{"received":false}`, no side effects.

### Test C — WEBHOOK\_SHARED\_SECRET not set triggers setup error

Temporarily remove `WEBHOOK_SHARED_SECRET` from sandbox Script Properties, then
send any POST. Check the execution log.

**Expected:** `doPost error` logged with message `Setup error: WEBHOOK_SHARED_SECRET
is not set in Script Properties.` Admin alert email sent to `ADMIN_EMAIL`.
Re-add the property before continuing.

### Test D — Authorized Stripe payload succeeds

Requires a test booking row to already exist in the sandbox sheet (create one
manually or run Test 1 from section 7 first).

```bash
curl -s -X POST "<sandbox-url>" \
  -H "Content-Type: application/json" \
  -d '{"secret":"<sandbox-secret>","customerEmail":"<email-in-sandbox-sheet>","amountPaid":50}'
```

**Expected:** Column G = `Yes`, column H = `50`. Deposit confirmation email and
SMS sent to the test address. DocuSeal lease dispatched to the test address.
Column J = `Yes`. `{"received":true}` returned.

### Test E — Authorized DocuSeal payload succeeds

```bash
curl -s -X POST "<sandbox-url>" \
  -H "Content-Type: application/json" \
  -d '{"secret":"<sandbox-secret>","type":"lease_signed","signerEmail":"<email-in-sandbox-sheet>"}'
```

**Expected:** Column N = `Yes` for the matching row. `{"received":true}` returned.

---

## 7. Bainbridge Parity Tests

These mirror the eight tests in `docs/testing-plan.md`, run against the sandbox
environment. The goal is to confirm the modular 11-file code produces identical
behavior to the production single-file script. All tests use test email addresses
and phone numbers — no real customer data.

### Test 1 — New booking syncs from test calendar

**Setup:** Create a manual event on the sandbox test calendar. Format the event
description to match the Google Booking structure (include `<b>Booked by</b>`
block, email, phone). Set a future start time.

**Expected:**
- [ ] New row appears in sandbox Bookings sheet with correct Name, Email, Phone, Start Time
- [ ] Column I (`Intake Sent`) = `Yes`
- [ ] Customer receives welcome email with deposit link and pre-filled intake form URL
- [ ] Customer receives welcome SMS
- [ ] Manager receives "New truck booking" email
- [ ] Manager receives "New booking" SMS
- [ ] Columns O, P, Q are blank

### Test 2 — Approval reminder state machine

**Setup:** Confirm row from Test 1 has column I = `Yes` and column O = blank.

**After next `checkRentalEligibility` trigger run (~5 min):**
- [ ] Manager receives "Action needed: Approve truck rental" email
- [ ] Column P = timestamp of send
- [ ] Column Q = `1`

**Simulate reminder interval:**
- [ ] Manually backdate column P by 13 hours
- [ ] Wait for next trigger run (~5 min)
- [ ] Manager receives "Reminder #1" email
- [ ] Column Q = `2`

**Resolve approval:**
- [ ] Set column O = `Approved - Paid`
- [ ] Confirm no further reminder emails sent on subsequent trigger runs

### Test 3 — Stripe deposit via sandbox Pipedream

**Setup:** Send a test Stripe payment event through the **sandbox** Pipedream
Stripe workflow (not production). The `customerEmail` must match the email in
the sandbox sheet.

**Expected:**
- [ ] Column G = `Yes`, column H = amount paid
- [ ] Customer receives deposit confirmation email
- [ ] Customer receives deposit confirmation SMS
- [ ] DocuSeal lease dispatched to customer (and manager as co-signer)
- [ ] Column J = `Yes`

### Test 4 — DocuSeal lease signed via sandbox Pipedream

**Setup:** Send a test DocuSeal signing event through the **sandbox** Pipedream
DocuSeal workflow. The `signerEmail` must match the customer email in the sandbox sheet.

**Expected:**
- [ ] Column N = `Yes` for the matching row

### Test 5 — 24-hour reminder

**Setup:** Edit the sandbox row's Start Time to ~25 hours from now. Confirm
column O = `Approved - Paid` and column G = `Yes`. Wait for `processReminders`
trigger (~30 min) or run manually.

**Expected:**
- [ ] Column K = `Yes`
- [ ] Customer receives "Your truck pickup is tomorrow!" email with pre-trip inspection link
- [ ] Customer receives pickup reminder SMS
- [ ] Manager receives "Tomorrow's rental" email with deposit/lease status
- [ ] Manager receives "Tomorrow's rental" SMS

**Edge case — deposit not paid:**
- [ ] Clear column G, run again
- [ ] Email subject should be "Action needed — your pickup is tomorrow"
- [ ] SMS should include deposit payment link

### Test 6 — Post-rental inspection prompt

**Setup:** Edit the sandbox row's End Time to ~2 hours ago. Confirm column L = blank.
Wait for trigger or run manually.

**Expected:**
- [ ] Column L = `Yes`
- [ ] Customer receives post-trip inspection email
- [ ] Customer receives post-trip SMS
- [ ] Manager receives "Post-rental inspection needed" email

### Test 7 — Two-driver flow

**Setup:** Create a sandbox calendar event whose description includes a second
driver email in the expected format.

**Expected:**
- [ ] Column M populated with the second driver email (not `No Second Email`)
- [ ] When deposit is paid (Test 3), DocuSeal uses the two-driver template (ID `7654321`)
- [ ] Both Driver #1 and Driver #2 receive DocuSeal signing requests

### Test 8 — Unmatched webhook email

**Setup:** Send an authorized POST to `doPost` (correct secret) with a
`customerEmail` that does not appear in the sandbox sheet.

**Expected:**
- [ ] No rows updated
- [ ] Admin receives "Stripe payment — no booking match" alert email
- [ ] `{"received":true}` returned (no crash)

---

## 8. Passing Criteria and Promotion to Production

All eight parity tests and all five security tests (A–E) must pass before the
sandbox is considered equivalent to production.

When all tests pass:

1. **Do not promote the sandbox Apps Script project to production.** The sandbox
   is a separate project and remains a sandbox.
2. Copy the verified `src/*.js` files into the **production** Apps Script project
   in a separate controlled deployment step, following the cutover procedure in
   `docs/architecture-proposal.md` (Section 5, Step 4).
3. Update the production Pipedream workflows to use the production
   `WEBHOOK_SHARED_SECRET` (already set — no change needed unless the secret was
   rotated during sandbox testing).
4. Run the Gate 5 smoke test from `docs/architecture-proposal.md`: manually
   trigger `syncCalendarBookings` in production using a controlled test booking,
   confirm it writes to the production Bookings tab, then delete the test row.

The sandbox environment remains available after production cutover for use as
the testing ground for the multi-site refactor.
