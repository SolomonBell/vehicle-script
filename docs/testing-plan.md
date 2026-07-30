# Testing Plan — Acceptance Tests and Validation Status

> All four active locations (Bainbridge, Poulsbo, Port Orchard, Fairgrounds) and both vehicle
> types (Cargo Van, Moving Truck) follow the identical booking flow — location and vehicle type
> are resolved from `CALENDAR_CONFIGS` (`Config.js`), never hardcoded per site. Any location can
> be used for these tests; examples below use Bainbridge for concreteness.

This document is the acceptance-test checklist for the sandbox environment and the authoritative
record of what has and has not been confirmed working end-to-end. It complements the manual test
functions in `src/SandboxTests.js` (config/connectivity/pure-function checks — see
[README.md §15 Testing](../README.md#15-testing)), which verify configuration and logic without
exercising the full live flow. **Do not mark an item below as passed without actually observing
the described result in the sandbox.**

---

## Current validation status

**Validated** — confirmed working end-to-end in the sandbox environment:

| Area | Covered by |
|---|---|
| Calendar booking sync | Test 1 |
| Welcome/intake message delivery | Test 1 |
| Stripe payment/authorization flow | Test 4 |
| DocuSeal lease delivery | Test 4 |
| Lease signing | Test 5 |
| Manager approval (request, decision, reminder stop) | Test 3 |
| Customer approval gating and notification | Test 6 |
| Intake completion tracking (column V) | Test 2 |
| Trigger installation (`setupTriggers()` creates all five triggers) | Prerequisites |

**Still awaiting final operational validation** — implemented and reviewed in code, but not yet
confirmed by an actual sandbox run reaching these conditions:

| Area | Covered by |
|---|---|
| Automatic 24-hour reminder firing on schedule | Test 7 |
| Manager 24-hour greeting/summary (including the location-specific greeting) | Test 7 |
| Pre-trip inspection completion update (column W) | Test 8 |
| Post-rental reminder firing on schedule | Test 9 |
| Manager post-rental greeting/notice (including the location-specific greeting) | Test 9 |
| Post-trip inspection completion update (column X) | Test 10 |

Do not report any item in the second table as "passed" until it has actually been exercised —
either by waiting for a real booking to reach the 24-hour/post-rental windows, or by manually
time-shifting a test row's Start Time / End Time as described in Tests 7 and 9.

---

## Prerequisites

- [ ] All Script Properties set (see [`docs/setup-notes.md`](setup-notes.md))
- [ ] Bookings sheet exists with correct headers (A–X)
- [ ] Column O has dropdown validation (`Approved - Free` / `Approved - Paid` / `Denied`)
- [ ] `setupTriggers()` has been run and created all five triggers: `syncCalendarBookings`,
      `checkRentalEligibility`, `sendLeaseToNewBookings`, `processReminders`, `onFormSubmit`
- [ ] Script deployed as Web App with correct access settings
- [ ] Stripe webhook pointing (via Pipedream) to the deployment URL
- [ ] DocuSeal `lease_signed` webhook pointing (via Pipedream) to the deployment URL
- [ ] Intake and inspection Google Forms are linked to the same spreadsheet as Bookings, with
      response tabs named exactly `Rental Intake Form` and
      `Rental Vehicle Condition Inspection Form`
- [ ] Test email/phone available that won't alarm real customers

---

## Test 1: New booking syncs from calendar

**What to do:**
1. Create a test calendar event on a test booking calendar
   - Include a description with Booked by / email / phone in Google Booking format
   - Set a future start time

**Expected results:**
- [ ] Row appears in Bookings sheet with correct Name, Email, Phone, Start Time
- [ ] Column I (Intake Sent) = `Yes`
- [ ] Customer receives welcome email ("Your {vehicle type} reservation for {date}") with deposit
      link and pre-filled intake form URL
- [ ] Customer receives welcome SMS (if phone present)
- [ ] Manager receives a "New booking: {name} ({vehicle type})" email
- [ ] Manager receives "New booking" SMS

**Check in sheet:** Columns A–I, R–S populated; G, H, J, K, L, N, O, P, Q, T, U, V, W, X all blank.

**Status:** ✅ Validated.

---

## Test 2: Intake form submission

**What to do:**
1. Open the pre-filled intake form URL from Test 1's welcome email/email log and submit it
   (leave the pre-filled fields as-is)

**Expected results:**
- [ ] Column V (Intake Form Completed) = `Yes` on the matching row
- [ ] If the deposit was already paid at this point, the DocuSeal lease is sent as part of this
      submission (columns J and T update) — otherwise nothing else changes yet
- [ ] Apps Script execution log shows `processIntakeFormSubmission_: marked intake complete for
      row N (matched by email+date)` (or `email-only`, depending on whether the date narrowed
      the match)

**Ambiguity check (optional, recommended once):** create two test bookings for the same email
with different rental dates, submit intake for one, and confirm only the intended row's column V
updates (matched by `email+date` in the log) — not the other row.

**Status:** ✅ Validated.

---

## Test 3: Approval reminder loop (checkRentalEligibility)

**What to do:**
1. Confirm row from Test 1 has I = `Yes` and O = blank

**After next trigger run (~5 min):**
- [ ] Manager receives an "Action needed: approve rental for {name}" email, opening with
      `Hi {Location} Manager,`
- [ ] Column P = timestamp of send
- [ ] Column Q = `1`

**Simulate reminder due:**
- [ ] Manually backdate P by 13 hours in the sheet
- [ ] Wait for next trigger run

**Expected:**
- [ ] Manager receives a "Reminder #1: approve rental for {name}" email, also opening with
      `Hi {Location} Manager,`
- [ ] Q increments to `2`

**Test manager decision:**
- [ ] Set column O = `Approved - Paid` (or `Approved - Free`)
- [ ] Confirm no more manager reminder emails are sent on subsequent runs
- [ ] Confirm the customer does **not** receive an approval notification yet if the lease has not
      been signed — see Test 6

**Status:** ✅ Validated.

---

## Test 4: Stripe deposit webhook

**What to do:**
1. Complete the Stripe Checkout Session from the welcome email using a Stripe test card (e.g.
   `4242 4242 4242 4242`), or POST a simulated payment event directly to the webhook URL with
   `customerEmail` matching the Bookings sheet row and `amountPaid = 50`

**Expected results:**
- [ ] Column G (Deposit Paid) = `Yes`
- [ ] Column H (Stripe Amount) = `50`
- [ ] Customer receives deposit confirmation email ("Deposit confirmed: {vehicle type} rental on
      {date}")
- [ ] Customer receives deposit confirmation SMS
- [ ] If column V (Intake Form Completed) is already `Yes`, the DocuSeal lease is sent to the
      customer (and manager as co-signer); column J (Lease Sent) = `Yes` and column T (DocuSeal
      Submission ID) is populated
- [ ] If column V is not yet `Yes`, no lease is sent yet — confirm it sends once Test 2 is
      completed afterward

**Status:** ✅ Validated.

---

## Test 5: DocuSeal lease signed webhook

**What to do:**
1. Sign the lease as all required parties (customer, second driver if applicable, manager), or
   POST a simulated `lease_signed` event to the webhook URL with `signerEmail` matching the
   customer email in the sheet

**Expected results:**
- [ ] Column N (Lease Signed) = `Yes` on the matching row

**Status:** ✅ Validated.

---

## Test 6: Customer approval notification (gated on approval AND signature)

This is the core business rule under test: the customer must **not** receive the "your rental is
approved" notification until **both** column O is an approved value **and** column N (Lease
Signed) is `Yes` — regardless of which one becomes true first.

**Scenario A — approval arrives before signature:**
1. Set column O = `Approved - Paid` (or `Approved - Free`) on a row where N is still blank
2. Confirm no customer approval email/SMS is sent on the next `checkRentalEligibility` run
3. Complete the lease signing (Test 5) so column N becomes `Yes`
4. Confirm the customer approval email/SMS is sent on the **next** `checkRentalEligibility` run
   after N becomes `Yes`, and column U (Customer Approval Notified) = `Yes`

**Scenario B — signature arrives before approval:**
1. Complete lease signing first (column N = `Yes`) on a row where O is still blank
2. Confirm no customer approval email/SMS is sent while O is blank
3. Set column O to an approved value
4. Confirm the customer approval email/SMS is sent on the next `checkRentalEligibility` run, and
   column U = `Yes`

**Both scenarios:**
- [ ] The approval email is never sent before both conditions are true
- [ ] The approval email is sent exactly once (column U prevents a resend on later runs)

**Status:** ✅ Validated (both orderings observed correctly gated in sandbox).

---

## Test 7: 24-hour reminder (processReminders)

**What to do:**
1. Edit the Start Time in the sheet to be ~25 hours from now
2. Confirm column O = `Approved - Paid` (or `Approved - Free`) and column G = `Yes`
3. Wait for the `processReminders` trigger (~30 min) OR run it manually from the editor

**Expected results:**
- [ ] Column K (24hr Sent) = `Yes`
- [ ] Customer receives a "Pickup reminder: {vehicle type} rental on {date}" email with a pre-trip
      inspection form link
- [ ] Customer receives a pickup reminder SMS with the same link
- [ ] Manager receives an "Upcoming rental tomorrow" email opening with `Hi {Location} Manager,`,
      including deposit/lease status
- [ ] Manager receives a "Tomorrow's rental" SMS

**Edge case — deposit not paid:**
- [ ] Set G = blank, re-run
- [ ] Email subject should be "Action needed: deposit due for tomorrow's {vehicle type} pickup"
- [ ] This branch does **not** include the pre-trip inspection link — confirm the link is absent
      from both the email and SMS in this case
- [ ] **Known limitation to watch for:** column K is still marked `Yes` on this branch. If the
      deposit is paid *after* this run, the inspection link will not be sent retroactively for
      this booking — confirm this behavior matches what is documented in
      [README.md §21](../README.md#21-known-limitations-and-future-work) before treating it as a
      bug.

**Status:** ⏳ Not yet validated. Implemented and reviewed in code; requires either waiting for a
real booking to reach the 24-hour window or the manual time-shift above.

---

## Test 8: Pre-trip inspection form submission

**What to do:**
1. Using the pre-trip inspection link from Test 7, submit the inspection form (leave the
   pre-filled Inspection Type value as-is)

**Expected results:**
- [ ] Column W (Pre-Inspection Form Completed) = `Yes` on the matching row
- [ ] Column X (Post-Inspection Form Completed) is **not** affected
- [ ] Apps Script execution log shows `processInspectionFormSubmission_: marked pre-inspection
      complete for row N`

**Status:** ⏳ Not yet validated. Depends on Test 7 having produced a real pre-trip link to submit.

---

## Test 9: Post-rental reminder (processReminders)

**What to do:**
1. Edit End Time in the sheet to be past the `POST_RENTAL_HOURS` threshold (e.g. ~2 hours ago if
   `POST_RENTAL_HOURS = 1`)
2. Confirm column L (Post-Rental Sent) = blank
3. Wait for the trigger OR run it manually

**Expected results:**
- [ ] Column L (Post-Rental Sent) = `Yes`
- [ ] Customer receives a post-trip inspection email with a pre-filled form link
- [ ] Customer receives a post-trip inspection SMS
- [ ] Manager receives a "Post-trip inspection form sent to {name}" email opening with
      `Hi {Location} Manager,`

Note: unlike the 24-hour reminder, this branch is not gated on approval or deposit status — it
fires purely on elapsed time and column L.

**Status:** ⏳ Not yet validated. Implemented and reviewed in code; requires either waiting for a
real booking's End Time to elapse or the manual time-shift above.

---

## Test 10: Post-trip inspection form submission

**What to do:**
1. Using the post-trip inspection link from Test 9, submit the inspection form (leave the
   pre-filled Inspection Type value as-is)

**Expected results:**
- [ ] Column X (Post-Inspection Form Completed) = `Yes` on the matching row
- [ ] Column W is **not** affected (should already be `Yes` from Test 8, and remains so)
- [ ] Apps Script execution log shows `processInspectionFormSubmission_: marked post-inspection
      complete for row N`

**Status:** ⏳ Not yet validated. Depends on Test 9 having produced a real post-trip link to submit.

---

## Test 11: Two-driver flow

**What to do:**
1. Create a calendar event whose description includes a second driver email (in the format the
   booking form uses)

**Expected results:**
- [ ] Column M (Second Driver Email) populated correctly (not `No Second Email`)
- [ ] When the lease is sent (Test 4), DocuSeal uses the two-driver template
      (`DOCUSEAL_TEMPLATE_TWO_DRIVERS`)
- [ ] Both Driver #1 and Driver #2 receive DocuSeal signing requests

**Status:** ✅ Validated.

---

## Test 12: Webhook robustness — no matching email

**What to do:**
1. POST a Stripe payment with `customerEmail = nobody@example.com` (correct shared secret,
   otherwise no row in the sheet will match)

**Expected results:**
- [ ] No sheet rows updated
- [ ] Admin receives a "Stripe payment -- no booking match" alert email
- [ ] `{"received":true}` returned (no crash, no retry storm)

**Status:** ✅ Validated.

---

## Regression checklist after any code change

- [ ] All five trigger functions still exist: `syncCalendarBookings`, `checkRentalEligibility`,
      `sendLeaseToNewBookings`, `processReminders`, `onFormSubmit`
- [ ] `setupTriggers()` still exists and creates all five triggers (four time-based + one
      spreadsheet-bound form-submit trigger)
- [ ] `doPost` and `doGet` still exist (required for the webhook endpoint)
- [ ] `onFormSubmit` still dispatches by response-tab name to `processIntakeFormSubmission_` /
      `processInspectionFormSubmission_`
- [ ] Column O is never written by the script
- [ ] P and Q column indices are still 15 and 16 (0-based) / 16 and 17 (1-based range)
- [ ] Columns V, W, X are only ever written by `processIntakeFormSubmission_` /
      `processInspectionFormSubmission_`, never guessed when ambiguous
- [ ] The customer approval email still requires both column O (approved) and column N (Lease
      Signed = `Yes`) before sending — re-run Test 6 if `Approval.js` or `Helpers.js` changed
- [ ] Run `runAllSandboxConfigurationTests()` from `SandboxTests.js` and confirm all tests pass
