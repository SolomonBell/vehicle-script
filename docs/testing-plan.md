# Testing Plan — Bainbridge Single-Location Flow

## Prerequisites

- [ ] All Script Properties set (see setup-notes.md)
- [ ] Bookings sheet exists with correct headers (A–T)
- [ ] Column O has dropdown validation (Approved - Free / Approved - Paid / Denied)
- [ ] `setupTriggers()` has been run
- [ ] Script deployed as Web App with correct access settings
- [ ] Stripe webhook pointing to deployment URL
- [ ] DocuSeal `lease_signed` webhook pointing to deployment URL
- [ ] Test email/phone available that won't alarm real customers

---

## Test 1: New booking syncs from calendar

**What to do:**
1. Create a test calendar event on the Bainbridge booking calendar
   - Include a description with Booked by / email / phone in Google Booking format
   - Set a future start time

**Expected results:**
- [ ] Row appears in Bookings sheet with correct Name, Email, Phone, Start Time
- [ ] Column I (Intake Sent) = `Yes`
- [ ] Customer receives welcome email with deposit link and pre-filled intake form URL
- [ ] Customer receives welcome SMS (if phone present)
- [ ] Manager receives "New truck booking" email
- [ ] Manager receives "New booking" SMS

**Check in sheet:** Columns A–I, R–S populated; O, P, Q, T all blank.

---

## Test 2: Approval reminder loop (checkRentalEligibility)

**What to do:**
1. Confirm row from Test 1 has I = `Yes` and O = blank

**After next trigger run (~5 min):**
- [ ] Manager receives "Action needed: Approve truck rental" email
- [ ] Column P = timestamp of send
- [ ] Column Q = 1

**Simulate reminder due:**
- [ ] Manually backdate P by 13 hours in the sheet
- [ ] Wait for next trigger run

**Expected:**
- [ ] Manager receives "Reminder #1" email
- [ ] Q increments to 2

**Test manager decision:**
- [ ] Set column O = `Approved - Paid`
- [ ] Confirm no more reminder emails are sent on subsequent runs

---

## Test 3: Stripe deposit webhook

**What to do:**
1. Use Stripe test mode or Stripe CLI to POST a payment event to the webhook URL
   - `customerEmail` must match the email in the Bookings sheet row
   - `amountPaid` = 50

**Expected results:**
- [ ] Column G (Deposit Paid) = `Yes`
- [ ] Column H (Stripe Amount) = `50`
- [ ] Customer receives deposit confirmation email
- [ ] Customer receives deposit confirmation SMS
- [ ] DocuSeal lease email sent to customer (and manager)
- [ ] Column J (Lease Sent) = `Yes`

---

## Test 4: DocuSeal lease signed webhook

**What to do:**
1. POST a `lease_signed` event to the webhook URL
   - `signerEmail` must match customer email in sheet

**Expected results:**
- [ ] Column N (Lease Signed) = `Yes`

---

## Test 5: 24-hour reminder (processReminders)

**What to do:**
1. Edit the Start Time in the sheet to be ~25 hours from now
2. Confirm column O = `Approved - Paid` and column G = `Yes`
3. Wait for processReminders trigger (~30 min) OR run manually

**Expected results:**
- [ ] Column K (24hr Sent) = `Yes`
- [ ] Customer receives "Your truck pickup is tomorrow!" email with pre-trip inspection link
- [ ] Customer receives "Pickup is tomorrow!" SMS
- [ ] Manager receives "Tomorrow's rental" email with deposit/lease status
- [ ] Manager receives "Tomorrow's rental" SMS

**Edge case — deposit not paid:**
- [ ] Set G = blank, re-run
- [ ] Email subject should be "Action needed — deposit due for tomorrow's [vehicle type] pickup"
- [ ] SMS should direct customer to check their original welcome email for the payment link

---

## Test 6: Post-rental reminder (processReminders)

**What to do:**
1. Edit End Time in the sheet to be ~2 hours ago
2. Confirm column L (Post-Rental Sent) = blank
3. Wait for trigger OR run manually

**Expected results:**
- [ ] Column L (Post-Rental Sent) = `Yes`
- [ ] Customer receives post-trip inspection email with pre-filled form link
- [ ] Customer receives post-trip SMS
- [ ] Manager receives "Post-rental inspection needed" email

---

## Test 7: Two-driver flow

**What to do:**
1. Create a calendar event whose description includes a second driver email
   (in the format the Bainbridge booking form uses)

**Expected results:**
- [ ] Column M (Second Driver Email) populated correctly
- [ ] When lease is sent (Test 3), DocuSeal uses the two-driver template (ID 7654321)
- [ ] Both Driver #1 and Driver #2 receive DocuSeal signing requests

---

## Test 8: Webhook robustness — no matching email

**What to do:**
1. POST a Stripe payment with `customerEmail` = `nobody@example.com`

**Expected results:**
- [ ] No sheet rows updated
- [ ] Admin receives "Stripe payment -- no booking match" alert email

---

## Regression checklist after any code change

- [ ] All trigger functions still exist: `syncCalendarBookings`, `checkRentalEligibility`, `sendLeaseToNewBookings`, `processReminders`
- [ ] `setupTriggers()` still exists and creates all four triggers
- [ ] `doPost` and `doGet` still exist (required for webhook endpoint)
- [ ] Column O is never written by the script
- [ ] P and Q column indices are still 15 and 16 (0-based) / 16 and 17 (1-based range)
