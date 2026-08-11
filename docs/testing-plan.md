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
| Lease signing (one-driver and two-driver, including correct per-role signer gating in Pipedream) | Test 5, Test 11c |
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
| Automatic cancellation detection (calendar delete → column AA) | Test 15 |
| Manual cancellation (typing a value into column AA) | Test 15 |
| Cancelled-booking guards (lease/approval/reminders/reschedule all stop; historical facts still recorded) | Test 15 |
| Reschedule detection (Start Time change → E/F/AC update, K/L re-arm) | Test 16 |
| Reschedule re-arming X/Z when the pre-trip inspection was already complete | Test 16 |
| Reschedule exceptional path when the post-trip inspection is already complete (Y set) | Test 16 |
| Per-location DocuSeal manager co-signer selection (all four locations) | Test 17 |

**Confirmed at the sandbox configuration/unit-test level:** `runAllSandboxConfigurationTests()`
(49 tests, including every cancellation/reschedule and per-location DocuSeal manager-signer test)
has been run in the real Apps Script sandbox environment and completed with:

```
===== Running Sandbox Configuration Tests (49 tests) =====
...
===== All Sandbox Configuration Tests Completed Successfully =====
```

This confirms the underlying logic — column updates, location scoping, delivery gating,
idempotency, per-location signer selection, cancelled-row guards — is implemented and wired
correctly in the real Apps Script runtime, not just in the hand-built Node.js shim used during
development. **It does not, by itself, satisfy any item in the table above or in Tests 15–17
below** — those require an actual Calendar event edit/delete, an actual DocuSeal signing flow, or
actual elapsed time, none of which a configuration/unit test exercises.

- [x] Run `runAllSandboxConfigurationTests()` from the actual Apps Script editor in the sandbox
      project and confirm all tests pass — **done; 49/49 passed**

Do not report any item in the second table as "passed" until it has actually been exercised —
either by waiting for a real booking to reach the 24-hour window and, separately, a real hour to
elapse after a real pre-trip inspection completion, or by manually time-shifting a test row's Start
Time (Test 7), column X completion timestamp (Test 9), or both inspection timestamps close
together (Test 13), as described in those tests.

---

## Prerequisites

- [ ] All Script Properties set (see [`docs/setup-notes.md`](setup-notes.md)) — the DocuSeal
      manager co-signer uses the existing `EMAIL_<LOCATION>` properties, no separate property
- [ ] Bookings sheet exists with correct headers (A–AC)
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
`No Second Email`; column M stays blank until intake); G, H, J, K, L, O, P, Q, R, U, V, W, X, Y,
AA, AB, AC all blank.

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
1. **One-driver booking:** sign the lease as Driver #1, then as the manager, in either order.
2. **Two-driver booking:** sign the lease as Driver #1, confirm column O is still blank, then sign
   as Driver #2, then as the manager, in either order.

**Expected results:**
- [ ] One-driver: column O (Lease Signed) = `Yes` after Driver #1 signs. The manager's own
      signature does not affect column O either way.
- [ ] Two-driver: column O stays blank after Driver #1 signs alone (Pipedream ignores this event —
      see `docs/setup-notes.md`'s "Final signing-completion logic"). Column O = `Yes` only after
      Driver #2 signs.
- [ ] Two-driver: the manager's signature (regardless of when it happens) never triggers or is
      required for column O to become `Yes` — only Driver #2's signature does.
- [ ] DocuSeal's final `submission.completed` event (sent once every party, including the manager,
      has signed) does not produce a duplicate or redundant write to column O.

**Status:** PASS — Validated end-to-end in the sandbox for both the one-driver and two-driver
templates, including confirming Driver #1's signature alone does not mark a two-driver lease
signed, the manager's signature is ignored, and `submission.completed` is ignored.

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

**Status:** MIXED. 11a passed under the prior single-column design. 11c (intake "Yes" with valid
data, template selection, and the full two-driver signing sequence) has now been validated
end-to-end in the sandbox. 11b and 11d (the "No" answer and the four validation-failure modes)
have not yet been re-run against the redesigned live intake form — they are covered by the
sandbox unit tests in `SandboxTests.js` (`testValidateAdditionalDriverSubmission`,
`testProcessIntakeFormSubmissionAdditionalDriverWrite`) but still need a live-form pass.

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
2. Pay the deposit and complete the booking through to lease delivery
3. Sign the lease as Driver #1, then as Driver #2, then as the manager

**Expected results:**
- [ ] Column M populated with the submitted name
- [ ] Column N populated with the submitted email
- [ ] Column W = `Yes`
- [ ] When the lease is sent, DocuSeal uses the two-driver template (`DOCUSEAL_TEMPLATE_TWO_DRIVERS`)
- [ ] Both Driver #1 and Driver #2 receive DocuSeal signing requests, and Driver #2's request uses
      the real submitted name and email — never a placeholder name
- [ ] After Driver #1 signs (alone), column O (Lease Signed) is still blank
- [ ] After Driver #2 signs, column O = `Yes`
- [ ] The manager's own signature (whenever it happens) is not required for and does not
      independently trigger column O

**Status:** PASS — Validated end-to-end in the sandbox, including the full two-driver signing
sequence (Driver #1 → Driver #2 → manager, with column O flipping only after Driver #2).

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

## Test 15: Cancellation (automatic and manual)

See `src/CancelReschedule.js` and [docs/setup-notes.md](setup-notes.md) for the implementation
details.

**Part A — automatic cancellation (calendar delete):**

**What to do:**
1. Pick a Bookings row with a future Start Time whose calendar event still exists
2. Delete that calendar event directly in Google Calendar
3. Wait for the `syncCalendarBookings` trigger (~5 min) or run it manually

**Expected results:**
- [ ] Column AA (Cancelled) is stamped with a timestamp
- [ ] Column AB (Cancel Notified) = `Yes` once the notice is delivered
- [ ] Customer receives a cancellation email and SMS (if phone present), including the change/cancel
      footer
- [ ] Manager receives a cancellation notice (email + SMS if `MANAGER_PHONE` is set), via the
      existing global `CONFIG.MANAGER_EMAIL`/`CONFIG.MANAGER_PHONE` — not a per-location address
- [ ] Re-running `syncCalendarBookings` again does **not** send a second cancellation notice

**Part B — manual cancellation:**

**What to do:**
1. Pick any Bookings row with a future Start Time whose calendar event still exists
2. Type any value into column AA directly in the sheet (it does not need to be `Yes` — any
   non-blank value counts)
3. Wait for the `syncCalendarBookings` trigger (~5 min) or run it manually

**Expected results:**
- [ ] Column AA is **not** overwritten (your manually-typed value is preserved)
- [ ] The same cancellation notices as Part A are sent, and column AB = `Yes` once delivered

**Part C — location scoping:**

**What to do:**
1. Confirm that deleting or cancelling a booking at one location never affects a row at a
   different location, even one whose Start Time is in the same window

**Expected results:**
- [ ] Only the row(s) belonging to the location whose calendar was actually read are ever
      evaluated for cancellation

**Part D — cancelled-row guards:**

**What to do, on the now-cancelled row from Part A or B:**
1. Confirm no further approval reminders are sent (`checkRentalEligibility`)
2. Confirm no lease is sent if one had not already gone out (`sendLeaseToNewBookings`)
3. Confirm no pre-trip or post-trip reminder is sent (`processReminders`)
4. Confirm the row is never reschedule-detected even if its calendar event's time would otherwise
   qualify

**Expected results:**
- [ ] All four of the above hold
- [ ] Historical facts already recorded (deposit paid, intake submitted, lease signed, inspection
      submissions) are **not** erased or blocked — a webhook or form submission arriving for an
      already-cancelled row still records the underlying fact (see `markDepositPaid`,
      `processIntakeFormSubmission_` in the source), it just does not trigger a new customer
      message or a new DocuSeal lease send

**Part E — empty-calendar safety:**

**What to do:**
1. Confirm a location whose calendar genuinely has zero upcoming events in the sync window still
   correctly cancels a row whose event was the last one deleted (this is the case the
   `events.length === 0` heuristic used to get wrong — see the audit)
2. Separately, simulate or observe a genuinely failed calendar read (e.g. a temporarily revoked
   calendar permission) and confirm that location's sync is skipped for that cycle with an admin
   alert, rather than being treated as "zero bookings"

**Expected results:**
- [ ] A successfully-read empty calendar still allows cancellation detection to proceed
- [ ] A thrown read error skips new-booking/reschedule/cancellation processing for that location
      only, and `alertAdmin()` fires

**Status:** PENDING — not yet validated end to end against a real Google Calendar and a real
sandbox sheet. The underlying logic (`runCancellationDetectionForLocation_`, location scoping,
delivery gating, idempotency — see `src/SandboxTests.js`) has passed both during development and
in the real Apps Script sandbox via `runAllSandboxConfigurationTests()` (49/49) — that confirms
the code is wired correctly, not that a real calendar delete has been observed producing a real
cancellation.

---

## Test 16: Reschedule

**What to do:**
1. Pick a Bookings row with a future Start Time
2. Edit that event's start/end time directly in Google Calendar, by more than 60 seconds
3. Wait for the `syncCalendarBookings` trigger (~5 min) or run it manually

**Expected results:**
- [ ] Columns E and F update to the new start/end time
- [ ] Column AC (Rescheduled At) is stamped with a timestamp
- [ ] Columns K (24hr Sent) and L (Post-Rental Sent) are cleared, if either was already `Yes`
- [ ] Customer receives a reschedule email and SMS, including the change/cancel footer
- [ ] Manager receives a reschedule notice, via the existing global manager address
- [ ] Deposit Paid (G), Lease Sent (J), Lease Signed (O), Rental Approved (P), and DocuSeal
      Submission ID (U) are all **unchanged**

**Edge case — under 60 seconds:**
- [ ] Edit the event's time by less than 60 seconds — confirm this is **not** treated as a
      reschedule (no E/F/AC change, no notice sent)

**Edge case — exactly 60 seconds:**
- [ ] Edit the event's time by exactly 60 seconds — confirm this also does **not** count (the
      tolerance is strict `>`, not `>=`)

**Edge case — pre-trip inspection already completed:**
1. Complete the pre-trip inspection on a row (column X holds `Yes <timestamp>`)
2. Reschedule that same booking's calendar event by more than 60 seconds

**Expected results:**
- [ ] Column X is cleared back to blank, in addition to K/L
- [ ] Column Z (Suspicious Timing Warning Sent) is cleared back to blank if it was already `Yes`
- [ ] The inspection lifecycle behaves as if starting fresh for the new date

**Edge case — post-trip inspection already completed (Y set):**
1. Complete both inspections on a row (column Y holds `Yes <timestamp>`)
2. Reschedule that same booking's calendar event

**Expected results:**
- [ ] The row is left **completely unchanged** — no E/F/K/L/X/Z/AC write, no customer or manager
      notice sent
- [ ] `alertAdmin()` fires instead, identifying the booking for manual review

**Edge case — already-cancelled row:**
- [ ] A row already marked Cancelled (column AA) is never reschedule-detected, even if its
      calendar event's time changes

**Status:** PENDING — not yet validated end to end against a real Google Calendar event edit.
`isRescheduleDetected()`'s tolerance boundaries and `handleReschedule_()`'s column-update logic
(see `src/SandboxTests.js`) have passed both during development and in the real Apps Script
sandbox via `runAllSandboxConfigurationTests()` (49/49) — that confirms the code is wired
correctly, not that a real calendar time-edit has been observed producing a real reschedule.

**Live-UAT note:** whether Google Calendar Appointment Schedules preserves the same Event ID when
a *customer* reschedules through the booking page itself (as opposed to a manager editing the
calendar event directly) has not been confirmed. The manager-mediated path above (a human edits
the calendar) is the one this feature is designed around and reliably preserves the Event ID.

---

## Test 17: Per-location DocuSeal manager co-signer

There is no separate manager-email Script Property. The DocuSeal "Reliable Storage Manager"
co-signer uses each location's existing `EMAIL_<LOCATION>` value — confirmed with Andrew that the
same address already used to send that location's customer-facing mail is the intended signer.

**What to do:**
1. Confirm `EMAIL_BAINBRIDGE`, `EMAIL_POULSBO`, `EMAIL_PORT_ORCHARD`, and `EMAIL_FAIRGROUNDS` are
   all set in Script Properties (they already are — required for every other per-location message)
2. Send a lease (via any of the three lease-sending paths) for a booking at each of the four
   locations

**Expected results:**
- [ ] Each location's lease submitters include a `Reliable Storage Manager` entry using **that
      location's own** `EMAIL_<LOCATION>` value — not a single shared address, and not the global
      `CONFIG.MANAGER_EMAIL`

**Status:** PENDING — not yet validated end to end against the real DocuSeal API in the sandbox.
All four locations' submitter selection (see `src/SandboxTests.js`,
`testSendLeaseViaDocuSealPerLocationManagerEmail`) has passed both during development and in the
real Apps Script sandbox via `runAllSandboxConfigurationTests()` (49/49) — that confirms the code
is wired correctly, not that a real DocuSeal lease has actually been signed by the correct
per-location address.

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
- [ ] Column T is still Location and column S is still Vehicle Type — confirm no column was
      inserted before either (AA/AB/AC must stay append-only after Z)
- [ ] Columns AA/AB/AC are only ever written by `syncCalendarBookings()` (via
      `CancelReschedule.js`), or AA manually by a manager
- [ ] Cancelled-row guards are still present in `sendLeaseToNewBookings` (`Leases.js`),
      `checkRentalEligibility_`/`notifyCustomerOfApproval` (`Approval.js`), and the pre-trip/
      post-trip branches of `processReminders` (`Reminders.js`) — the suspicious-timing warning
      branch is intentionally **not** guarded by cancellation
- [ ] `markDepositPaid` (`Webhooks.js`) and `processIntakeFormSubmission_` (`Forms.js`) still
      record their historical facts (G/H, and M/N/W respectively) unconditionally, gating only the
      customer message / DocuSeal send on cancellation status
- [ ] `sendLeaseViaDocuSeal` (`DocuSeal.js`) still uses `locCfg.email` (`EMAIL_<LOCATION>`) for the
      `Reliable Storage Manager` submitter — not `CONFIG.MANAGER_EMAIL` and not a separate
      `MANAGER_EMAIL_<LOCATION>` property, which does not exist
- [ ] Run `runAllSandboxConfigurationTests()` from `SandboxTests.js` and confirm all tests pass
      (49 as of this writing)
