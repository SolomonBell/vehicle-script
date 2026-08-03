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
| Approval Reminder Count (column R) audited — no bug found, regression test added | Test 3 |
| Customer approval gating and notification | Test 6 |
| Intake completion tracking (column W) | Test 2 |
| Trigger installation (`setupTriggers()` creates all five triggers) | Prerequisites |

**Still awaiting final operational validation** — implemented and reviewed in code, but not yet
confirmed by an actual sandbox run reaching these conditions:

| Area | Covered by |
|---|---|
| Automatic pre-trip reminder firing on schedule | Test 7 |
| Manager pre-trip greeting/summary (including the location-specific greeting) | Test 7 |
| Pre-trip inspection completion update with actual submission timestamp (column X) | Test 8 |
| Post-trip reminder firing one hour after pre-trip completion | Test 9 |
| Manager post-trip greeting/notice (including the location-specific greeting) | Test 9 |
| Post-trip inspection completion update with actual submission timestamp (column Y) | Test 10 |
| Suspicious inspection timing warning firing and stopping at one send per booking (column Z) | Test 13 |
| Immediate inspection send tools (pure test and authorized real send) | Test 14 |

Do not report any item in the second table as "passed" until it has actually been exercised —
either by waiting for a real booking to reach the 24-hour window and, separately, a real hour to
elapse after a real pre-trip inspection completion, or by manually time-shifting a test row's Start
Time (Test 7), column X completion timestamp (Test 9), or both inspection timestamps close
together (Test 13), as described in those tests.

---

## Prerequisites

- [ ] All Script Properties set (see [`docs/setup-notes.md`](setup-notes.md))
- [ ] Bookings sheet exists with correct headers (A–Y)
- [ ] Column P has dropdown validation (`Approved - Free` / `Approved - Paid` / `Denied`)
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

**Check in sheet:** Columns A–I, N, S–T populated (column N holds the Calendar-derived email or
`No Second Email`; column M stays blank until intake); G, H, J, K, L, O, P, Q, R, U, V, W, X, Y
all blank.

**Status:** PASS — Validated.

---

## Test 2: Intake form submission

**What to do:**
1. Open the pre-filled intake form URL from Test 1's welcome email/email log and submit it
   (leave the pre-filled fields as-is)

**Expected results:**
- [ ] Column W (Intake Form Completed) = `Yes` on the matching row
- [ ] If the deposit was already paid at this point, the DocuSeal lease is sent as part of this
      submission (columns J and U update) — otherwise nothing else changes yet
- [ ] Apps Script execution log shows `processIntakeFormSubmission_: marked intake complete for
      row N (matched by email+date)` (or `email-only`, depending on whether the date narrowed
      the match)

**Ambiguity check (optional, recommended once):** create two test bookings for the same email
with different rental dates, submit intake for one, and confirm only the intended row's column W
updates (matched by `email+date` in the log) — not the other row.

**Status:** PASS — Validated.

---

## Test 3: Approval reminder loop (checkRentalEligibility)

**What to do:**
1. Confirm row from Test 1 has I = `Yes` and O = blank

**After next trigger run (~5 min):**
- [ ] Manager receives an "Action needed: approve rental for {name}" email, opening with
      `Hi {Location} Manager,`
- [ ] Column Q = timestamp of send
- [ ] Column R = `1`

**Simulate reminder due:**
- [ ] Manually backdate P by 13 hours in the sheet
- [ ] Wait for next trigger run

**Expected:**
- [ ] Manager receives a "Reminder #1: approve rental for {name}" email, also opening with
      `Hi {Location} Manager,`
- [ ] Q increments to `2`

**Test manager decision:**
- [ ] Set column P = `Approved - Paid` (or `Approved - Free`)
- [ ] Confirm no more manager reminder emails are sent on subsequent runs
- [ ] Confirm the customer does **not** receive an approval notification yet if the lease has not
      been signed — see Test 6

This live checklist is complemented by `testApprovalReminderCountBehavior()` in `SandboxTests.js`,
which exercises the full increment/escalation/stop-at-maximum state machine (including blank,
numeric, and numeric-string Q values, and that one booking's row can't affect another's) against
synthetic data with no live sheet writes — added as part of an audit that found no bug in this
mechanism; see README §12 Approval State Machine.

**Status:** PASS — Validated.

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
- [ ] If column W (Intake Form Completed) is already `Yes`, the DocuSeal lease is sent to the
      customer (and manager as co-signer); column J (Lease Sent) = `Yes` and column U (DocuSeal
      Submission ID) is populated
- [ ] If column W is not yet `Yes`, no lease is sent yet — confirm it sends once Test 2 is
      completed afterward

**Status:** PASS — Validated.

---

## Test 5: DocuSeal lease signed webhook

**What to do:**
1. Sign the lease as all required parties (customer, second driver if applicable, manager), or
   POST a simulated `lease_signed` event to the webhook URL with `signerEmail` matching the
   customer email in the sheet

**Expected results:**
- [ ] Column O (Lease Signed) = `Yes` on the matching row

**Status:** PASS — Validated.

---

## Test 6: Customer approval notification (gated on approval AND signature)

This is the core business rule under test: the customer must **not** receive the "your rental is
approved" notification until **both** column P is an approved value **and** column O (Lease
Signed) is `Yes` — regardless of which one becomes true first.

**Scenario A — approval arrives before signature:**
1. Set column P = `Approved - Paid` (or `Approved - Free`) on a row where O is still blank
2. Confirm no customer approval email/SMS is sent on the next `checkRentalEligibility` run
3. Complete the lease signing (Test 5) so column O becomes `Yes`
4. Confirm the customer approval email/SMS is sent on the **next** `checkRentalEligibility` run
   after O becomes `Yes`, and column V (Customer Approval Notified) = `Yes`

**Scenario B — signature arrives before approval:**
1. Complete lease signing first (column O = `Yes`) on a row where O is still blank
2. Confirm no customer approval email/SMS is sent while O is blank
3. Set column P to an approved value
4. Confirm the customer approval email/SMS is sent on the next `checkRentalEligibility` run, and
   column V = `Yes`

**Both scenarios:**
- [ ] The approval email is never sent before both conditions are true
- [ ] The approval email is sent exactly once (column V prevents a resend on later runs)

**Status:** PASS — Validated (both orderings observed correctly gated in sandbox).

---

## Test 7: Pre-trip reminder (processReminders)

**What to do:**
1. Edit the Start Time in the sheet to be ~25 hours from now
2. Confirm column P = `Approved - Paid` (or `Approved - Free`) and column G = `Yes`
3. Wait for the `processReminders` trigger (~30 min) OR run it manually from the editor

**Expected results:**
- [ ] Column K (24hr Sent) = `Yes`
- [ ] Customer receives a "Pickup reminder: {vehicle type} rental on {date}" email with a pre-trip
      inspection form link, stating the form must be completed before driving and that the
      post-trip form will follow once pre-trip is done
- [ ] Customer receives a pickup reminder SMS with the same link and the same information
- [ ] Both the email and SMS state the form only needs to be completed once
- [ ] Manager receives an "Upcoming rental tomorrow" email opening with `Hi {Location} Manager,`,
      including deposit/lease status — confirm the email does **not** include the pre-trip
      inspection form link (the blank form is intentionally not sent to the manager)
- [ ] Manager receives a "Tomorrow's rental" SMS

**Edge case — deposit not paid:**
- [ ] Set G = blank, re-run
- [ ] Confirm nothing is sent to the customer or manager, and column K stays blank
      (`isPreTripReminderEligible()` in `src/Helpers.js` requires column G = `Yes`) — the row is
      re-evaluated on every later `processReminders` run for as long as it stays inside the
      26-hour window, so the reminder still fires once the deposit clears, as long as that happens
      before the window closes
- [ ] Set G back to `Yes` and re-run — confirm the reminder now sends normally

**Status:** PENDING — Not yet validated. Implemented and reviewed in code; requires either waiting for a
real booking to reach the 24-hour window or the manual time-shift above.

---

## Test 8: Pre-trip inspection form submission

**What to do:**
1. Using the pre-trip inspection link from Test 7, submit the inspection form (leave the
   pre-filled Inspection Type value as-is)

**Expected results:**
- [ ] Column X (Pre-Inspection Form Completed) = `Yes <date/time>` on the matching row (e.g.
      `Yes 8/2/2026 9:15 AM`), using the actual form-submission time, in the same `M/d/yyyy h:mm a`
      style already used for the booking's Start/End Time cells
- [ ] Column Y (Post-Inspection Form Completed) is **not** affected
- [ ] Apps Script execution log shows `processInspectionFormSubmission_: marked pre-inspection
      complete for row N`
- [ ] Resubmitting the same pre-trip inspection form again does **not** change column X's recorded
      value (idempotent — see `isInspectionCompletionValueSet_()` in `src/Forms.js`)

**Status:** PENDING — Not yet validated. Depends on Test 7 having produced a real pre-trip link to submit.

---

## Test 9: Post-trip reminder (processReminders)

**What to do:**
1. Complete Test 8 first, so column X holds a real completion timestamp
2. Either wait roughly one hour after the column X timestamp, or manually edit column X to a
   value more than one hour in the past (e.g. `Yes 8/1/2026 9:15 AM` if it is now past 10:15 AM the
   same day), keeping the exact `Yes <date/time>` format
3. Confirm column L (Post-Rental Sent) = blank
4. Wait for the `processReminders` trigger (~30 min) OR run it manually

**Expected results:**
- [ ] Column L (Post-Rental Sent) = `Yes`
- [ ] Customer receives a post-trip inspection email with a pre-filled form link, stating the form
      should be completed now that the vehicle has been returned
- [ ] Customer receives a post-trip inspection SMS with the same link and information
- [ ] Both the email and SMS state the form only needs to be completed once
- [ ] Manager receives a "Post-rental inspection: {name} ({vehicle type})" email opening with
      `Hi {Location} Manager,`, including the post-trip inspection form link

**Edge case — pre-trip not yet completed:**
- [ ] On a row where column X is blank, confirm `processReminders` never sends the post-trip
      reminder for that row, no matter how much time has passed since End Time
      (`isPostTripReminderEligible()` in `src/Helpers.js` requires a parseable column X timestamp)

**Edge case — less than one hour since pre-trip completion:**
- [ ] Set column X to a timestamp less than one hour in the past and re-run — confirm the
      post-trip reminder does not fire yet

Note: this reminder is timed entirely from column X's recorded completion timestamp — not from
the booking's End Time. (`POST_RENTAL_HOURS`, the old timing basis, has been removed from `CONFIG`
entirely.) It is also not gated on approval or deposit status.

**Status:** PENDING — Not yet validated. Implemented and reviewed in code; requires either waiting a real
hour after a real pre-trip completion or the manual time-shift above.

---

## Test 10: Post-trip inspection form submission

**What to do:**
1. Using the post-trip inspection link from Test 9, submit the inspection form (leave the
   pre-filled Inspection Type value as-is)

**Expected results:**
- [ ] Column Y (Post-Inspection Form Completed) = `Yes <date/time>` on the matching row (e.g.
      `Yes 8/2/2026 4:08 PM`), using the actual form-submission time, same format as column X
- [ ] Column X is **not** affected (should already hold its Test 8 value, and remains so)
- [ ] Apps Script execution log shows `processInspectionFormSubmission_: marked post-inspection
      complete for row N`
- [ ] Resubmitting the same post-trip inspection form again does **not** change column Y's
      recorded value (idempotent)

**Status:** PENDING — Not yet validated. Depends on Test 9 having produced a real post-trip link to submit.

---

## Test 11: Additional-driver flow (columns M/N)

**Status:** PENDING — Not yet re-validated against the redesigned intake form. The Calendar
fallback sub-test below (11a) passed under the prior single-column design; the intake-form
validation sub-tests (11b–11d) require live submissions against the redesigned form and have not
yet been run outside the sandbox unit tests in `SandboxTests.js`
(`testValidateAdditionalDriverSubmission`, `testProcessIntakeFormSubmissionAdditionalDriverWrite`,
`testSendLeaseViaDocuSealTemplateSelection`).

### 11a. Calendar-description fallback (initial value only)

**What to do:**
1. Create a calendar event whose description includes a second driver email (in the format the
   booking form uses)

**Expected results:**
- [ ] Column N (Additional Driver Email) populated from the Calendar description (not
      `No Second Email`); column M (Additional Driver Name) is blank — the Calendar description
      never carries a name
- [ ] This is only the *initial* value — a subsequent intake form submission (11b/11c below)
      overwrites it

### 11b. Intake form — "No" answer

**What to do:**
1. Submit the intake form answering "No" to `Will there be an additional authorized driver?`

**Expected results:**
- [ ] Column M is cleared to blank
- [ ] Column N is reset to `No Second Email`, even if 11a had populated a real email
- [ ] Column W (Intake Form Completed) = `Yes`
- [ ] When the lease is sent, DocuSeal uses the single-driver template
      (`DOCUSEAL_TEMPLATE_ONE_DRIVER`) and only `Driver #1` (+ manager) receives a signing request

### 11c. Intake form — "Yes" answer with valid name/email

**What to do:**
1. Submit the intake form answering "Yes", with a real `Additional Driver Full Name` and an
   `Additional Driver Email Address` different from the primary customer's email

**Expected results:**
- [ ] Column M populated with the submitted name
- [ ] Column N populated with the submitted email
- [ ] Column W = `Yes`
- [ ] When the lease is sent, DocuSeal uses the two-driver template (`DOCUSEAL_TEMPLATE_TWO_DRIVERS`)
- [ ] Both Driver #1 and Driver #2 receive DocuSeal signing requests, and Driver #2's request uses
      the real submitted name and email — never a placeholder name

### 11d. Intake form — "Yes" answer with invalid data (validation failure modes)

**What to do, for each case below:** submit the intake form answering "Yes" with the described
invalid data.

- [ ] Blank `Additional Driver Full Name` — columns M, N, and W are all left untouched; admin is
      alerted (reason `missing-name`)
- [ ] Blank `Additional Driver Email Address` — same (reason `missing-email`)
- [ ] Malformed email address — same (reason `invalid-email-format`)
- [ ] `Additional Driver Email Address` equal to the primary customer's email — same (reason
      `duplicate-email`)

In every case: the row is **not** marked Intake Form Completed (so it is not silently treated as
done), and no DocuSeal lease is sent for it until the intake form is resubmitted with valid data.

---

## Test 12: Webhook robustness — no matching email

**What to do:**
1. POST a Stripe payment with `customerEmail = nobody@example.com` (correct shared secret,
   otherwise no row in the sheet will match)

**Expected results:**
- [ ] No sheet rows updated
- [ ] Admin receives a "Stripe payment -- no booking match" alert email
- [ ] `{"received":true}` returned (no crash, no retry storm)

**Status:** PASS — Validated.

---

## Test 13: Suspicious inspection timing warning

**What to do:**
1. Complete a booking's pre-trip inspection (Test 8), then complete the post-trip inspection
   (Test 10) at most `SUSPICIOUS_INSPECTION_WINDOW_MINUTES` (default 15) after the pre-trip
   completion time shown in column X — either by acting quickly, or by editing column X to a
   recent-enough timestamp before submitting the post-trip form
2. Confirm column Z (Suspicious Timing Warning Sent) is blank beforehand
3. Wait for the `processReminders` trigger (~30 min) or run it manually

**Expected results:**
- [ ] Column Z = `Yes`
- [ ] Manager receives a "Review recommended: inspection timing for {name} ({vehicle type})" email
      opening with `Hi {Location} Manager,`
- [ ] The email includes customer name, booking ID (column A), vehicle, location, scheduled
      start/end, both inspection completion times, and the elapsed time between them
- [ ] The email is neutral in tone — it does not accuse the customer of anything and does not say
      the timing means something is wrong
- [ ] The customer does **not** receive this email
- [ ] Nothing else about the booking's state changes (no other column written, no other message
      sent) as a result of this check

**Edge case — exactly at the threshold:**
- [ ] Repeat with the two inspections exactly `SUSPICIOUS_INSPECTION_WINDOW_MINUTES` apart (e.g.
      column X set to exactly 15 minutes before the post-trip submission) — confirm the warning
      **does** fire; the boundary is inclusive

**Edge case — outside the threshold:**
- [ ] Repeat with the two inspections more than `SUSPICIOUS_INSPECTION_WINDOW_MINUTES` apart —
      confirm no warning is sent and column Z stays blank

**Edge case — duplicate prevention:**
- [ ] Run `processReminders` again after Y = `Yes` — confirm no second warning email is sent

**Status:** PENDING — Not yet validated. Depends on Tests 8 and 10 having produced two real,
closely-timed inspection completions.

---

## Test 14: Immediate inspection sends (manual tools)

This exercises the manual "send now" capability rather than the normal automated schedule — see
[docs/setup-notes.md "Manual immediate inspection sends"](setup-notes.md#manual-immediate-inspection-sends).

**Pure system test (safe, does not touch a real customer or the automated sent flags):**
1. Set `SANDBOX_TEST_EMAIL` and `SANDBOX_TEST_PHONE` in Script Properties to your own verified
   inbox/phone
2. Ensure a Bookings row exists with a name containing "Test Customer"
3. Run `testSendPreTripInspection()` from the Apps Script editor

**Expected results:**
- [ ] The configured test email and phone receive the real pre-trip inspection content
- [ ] Execution log names the booking row used for content and confirms the test recipient
- [ ] Column K on the "Test Customer" row is **not** written
- [ ] The manager does **not** receive a 24-hour summary as a result of this run

4. Repeat with `testSendPostTripInspection()`, confirming column L is **not** written and no
   manager post-trip notice is sent

**Authorized real send (production helper — only run against a booking you intend to actually
message):**
5. Pick a real (or deliberately test) booking row number and run
   `sendPreTripInspectionNowForRow(rowNumber)` or `sendPostTripInspectionNowForRow(rowNumber)`
   from the Apps Script editor

**Expected results:**
- [ ] The booking's real customer contact info receives the message
- [ ] Column K or L is written on success, exactly as the automated path would
- [ ] The manager receives the corresponding summary/notice
- [ ] Running it again on an already-sent row still sends (these functions do not check K/L first
      — they are for a deliberate, authorized immediate send, not idempotent background processing)

**Status:** PENDING — Not yet validated end-to-end; implemented and reviewed in code.

---

## Regression checklist after any code change

- [ ] All five trigger functions still exist: `syncCalendarBookings`, `checkRentalEligibility`,
      `sendLeaseToNewBookings`, `processReminders`, `onFormSubmit`
- [ ] `setupTriggers()` still exists and creates all five triggers (four time-based + one
      spreadsheet-bound form-submit trigger)
- [ ] `doPost` and `doGet` still exist (required for the webhook endpoint)
- [ ] `onFormSubmit` still dispatches by response-tab name to `processIntakeFormSubmission_` /
      `processInspectionFormSubmission_`
- [ ] Column P is never written by the script
- [ ] Q and R column indices are still 16 and 17 (0-based) / 17 and 18 (1-based range)
- [ ] Columns W, X, Y are only ever written by `processIntakeFormSubmission_` /
      `processInspectionFormSubmission_`, never guessed when ambiguous
- [ ] Column Z is only ever written by `sendSuspiciousInspectionTimingWarning_()`, only after a
      successful manager email, and only once per booking
- [ ] The customer approval email still requires both column P (approved) and column O (Lease
      Signed = `Yes`) before sending — re-run Test 6 if `Approval.js` or `Helpers.js` changed
- [ ] `sendPreTripInspectionNowForRow()` / `sendPostTripInspectionNowForRow()` (`Reminders.js`) and
      `testSendPreTripInspection()` / `testSendPostTripInspection()` (`SandboxTests.js`) still
      exist, and the latter two are still absent from `runAllSandboxConfigurationTests()`
- [ ] Run `runAllSandboxConfigurationTests()` from `SandboxTests.js` and confirm all tests pass
