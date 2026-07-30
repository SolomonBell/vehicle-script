# Operations Runbook — Reliable Storage Vehicle Rental Automation

Quick-reference guide for day-to-day operation of this system, once deployed. This is a
companion to [README.md §20 Troubleshooting](../README.md#20-troubleshooting), which has the full
technical diagnostic steps — this runbook is the shorter "what do I check, and in what order"
guide for someone operating the system rather than developing it.

**Environment:** as of this writing, only a sandbox deployment exists — see
[README.md "Repository status"](../README.md#repository-status) and
[docs/production-rollout.md](production-rollout.md). Everything below applies equally to sandbox
and production; substitute the correct Apps Script project, Sheet, and deployment URL for
whichever environment you are operating.

---

## 1. Where to look

| Question | Where to look |
|---|---|
| "Did trigger X run, and did it error?" | Apps Script editor → **Executions** (left sidebar) |
| "What is the current state of a specific booking?" | The Bookings sheet, that row, columns A–X |
| "Is a Script Property missing or wrong?" | Apps Script editor → **Project Settings → Script Properties** |
| "Did a webhook arrive?" | Executions log, filter for `doPost` |
| "Did an admin alert fire?" | `ADMIN_EMAIL` inbox — subject prefixed `[Rental Script]` |
| "What should have happened for this row by now?" | [docs/testing-plan.md](testing-plan.md) — matches each stage to its expected columns/messages |

---

## 2. Reading a booking row (columns A–X)

Given a row, this is the order the columns are meant to fill in, and what each one means:

| Col | Meaning | Normally filled by |
|---|---|---|
| A–F, M, R, S | Booking identity (event ID, name, contact info, dates, second driver, vehicle, location) | `syncCalendarBookings`, at row creation |
| I | Welcome message was sent (not that the customer did anything) | `syncCalendarBookings` |
| V | Customer actually submitted the intake form | `processIntakeFormSubmission_` (via `onFormSubmit`) |
| G, H | Deposit paid, amount | `markDepositPaid` (Stripe webhook) |
| J, T | Lease sent, DocuSeal submission ID | whichever of the three lease-sending paths ran first — see README §9 |
| N | Lease signed | `markLeaseSigned` (DocuSeal webhook) |
| O | Manager's decision — **never written by the script** | Manager, manually |
| P, Q | Manager reminder timestamp/count | `checkRentalEligibility` |
| U | Customer told "you're approved" | `checkRentalEligibility` (only after O is approved **and** N = Yes) |
| K | 24-hour reminder sent | `processReminders` |
| W | Customer submitted the pre-trip inspection form | `processInspectionFormSubmission_` (via `onFormSubmit`) |
| L | Post-rental reminder sent | `processReminders` |
| X | Customer submitted the post-trip inspection form | `processInspectionFormSubmission_` (via `onFormSubmit`) |

If a column that "should" be filled in is blank, work backwards through this table to find the
first blank one — that is almost always the actual blocker.

---

## 3. Common questions

### "A customer says they never got the welcome email/SMS"

1. Confirm the row exists in the sheet at all (column A has the event ID) and column I = `Yes`.
2. If the row doesn't exist: check Executions for `syncCalendarBookings` — was the calendar event
   description missing an email/phone in the expected format? (`extractPrimaryEmail`/`extractPhone`
   require specific HTML structure.)
3. If the row exists and I = `Yes` but the customer says nothing arrived: check spam, and check
   the Executions log for that run for `sendEmailHtml`/`sendSms` errors around that timestamp —
   `syncCalendarBookings` still appends the row even if the message send throws, so I = `Yes`
   does not guarantee delivery succeeded. See README §21 Known Limitations ("No retry for failed
   welcome messages").

### "The customer says they signed the lease but the system doesn't show it"

1. Check column N. If blank, the `lease_signed` webhook has not arrived or did not match.
2. Check Executions for `markLeaseSigned` around the signing time — look for `no submissionId
   match` or `no booking found`.
3. If column T (DocuSeal Submission ID) is blank for this row, the match had to fall back to
   email — confirm the signer's email exactly matches column C.
4. If nothing appears in the log at all for that time window, the issue is upstream — check the
   Pipedream DocuSeal workflow's execution history for that event.

### "The manager says they never got an approval request"

Walk [README §20 "Approval reminders are not sending"](../README.md#20-troubleshooting) — in
short: confirm column I = `Yes` (approval loop only starts once intake was sent) and column O is
blank (any decision value stops the loop).

### "The customer got the approval email too early / not at all"

This should never happen — the email is gated on **both** column O being approved **and** column
N = `Yes`. If you see it happen (or not happen when both conditions are true), this is a real bug,
not a configuration issue — capture the row's full column state and the Executions log around the
relevant `checkRentalEligibility` run before escalating.

### "A DocuSeal lease looks like it was sent twice for the same booking"

This is a known, documented risk (not yet observed in sandbox testing) — see README §21 "No lock
on any of the three lease-sending call sites." Capture: which two of `markDepositPaid`,
`processIntakeFormSubmission_`, `sendLeaseToNewBookings` fired, and how close together (timestamps
from Executions). Do not attempt a code fix from this runbook — file it as a defect.

### "Two bookings share the same customer email and something looks like it hit the wrong one"

Known risk in the two webhook handlers (`markDepositPaid`, `markLeaseSigned`) — see README §21
"First-match-wins email fallback." The form-submission handlers (intake/inspection) are
ambiguity-safe and will refuse to update anything rather than guess; the webhook handlers are not.
If you suspect this happened, check both rows' state manually and correct by hand if needed.

### "The pre-trip or post-trip inspection link never arrived"

1. Confirm the relevant reminder actually fired: column K (pre-trip) or L (post-trip) = `Yes`.
2. For pre-trip specifically: if the deposit was unpaid when the 24-hour window was reached, the
   reminder sent an urgency notice with **no inspection link**, and K is now `Yes` — so it will
   not retry. See README §21 for this known limitation.
3. If K/L is blank and it's well past the expected time, check whether `processReminders` is
   actually running on schedule (Executions log) — the trigger may need reinstalling
   (`setupTriggers()`), though this is rare since ordinary code changes don't require it.

### "Inspection form was submitted but W/X never updated"

1. Check Executions for `processInspectionFormSubmission_` around the submission time.
2. Look for `could not classify submission` — this means the Inspection Type answer didn't
   normalize to match `CONFIG.INSPECT_VAL_PRE`/`INSPECT_VAL_POST`. An admin alert should have
   fired for this — check `ADMIN_EMAIL`.
3. Look for `matched more than one eligible booking` (ambiguous) or `no matching booking row
   found` — both alert admin with the submitter's email and inspection type for manual follow-up.
4. If none of the above appear at all, confirm the `onFormSubmit` trigger is actually installed
   (Apps Script editor → Triggers) and that the inspection form's response tab is named exactly
   `Rental Vehicle Condition Inspection Form`.

---

## 4. Manual recovery actions (things a human may need to do by hand)

These are legitimate manual interventions — none of them require a code change:

| Situation | Manual action |
|---|---|
| Welcome message never sent (I = `Yes` but no delivery) | Manually send the customer the deposit and intake links (can regenerate from `buildIntakeUrl`/the Stripe Checkout URL logic if needed, or simply re-share the row's data) |
| Approval reminder loop permanently silenced (Q > `MAX_APPROVAL_REMINDERS`) | Set column O directly, or lower Q to resume reminders (this will resend notifications) |
| A booking needs to be excluded from all future automation | Set column O = `Denied` |
| A row's Location or Vehicle Type is wrong | Correct columns R/S directly — downstream lookups (deposit amount, Stripe Price ID, sender identity) re-resolve from the corrected value on the next run |
| Ambiguous intake/inspection submission logged but not applied | Manually set the correct completion column (V/W/X) for the correct row after confirming which booking it belongs to |

**Never do these manually:**
- Never write to column O programmatically or via a script — it is manager-only by design.
- Never clear column A (Event ID) to force a resync — this creates a duplicate row for the same
  Calendar event.
- Never edit Script Properties in the production project while testing in sandbox, or vice versa.

---

## 5. Where to go next

- [README.md](../README.md) — full architecture, source file reference, Script Properties
  reference, sheet schema, and the complete Troubleshooting section
- [docs/setup-notes.md](setup-notes.md) — Script Properties, trigger setup, Pipedream workflow
  configuration
- [docs/testing-plan.md](testing-plan.md) — acceptance tests and current validation status
- [docs/production-rollout.md](production-rollout.md) — sandbox-to-production migration plan
