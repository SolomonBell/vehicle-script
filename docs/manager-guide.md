# Manager Guide — Reliable Storage Vehicle Rental Automation

**Who this is for:** Reliable Storage location managers and supervisors who use the vehicle
rental booking system day to day. You do not need any technical background to use this guide.

**Approximate reading time:** 20–25 minutes for the full guide; each section can also be used on
its own as a quick reference.

**In one sentence:** This system automatically walks a customer from booking a vehicle through
picking it up and returning it, and asks you — the manager — to do a small number of specific
things at specific points, mainly reviewing and approving each rental.

---

**Video walkthrough:** Coming soon

> A short walkthrough video will be added here showing the Bookings sheet, the manager approval
> process, the customer workflow, and what managers should check before and after each rental.

<!-- Replace "Coming soon" above with the final vehicle-rental manager walkthrough link. -->

---

## Table of Contents

1. [What This System Does](#1-what-this-system-does)
2. [What Managers Are Responsible For](#2-what-managers-are-responsible-for)
3. [Tools Involved](#3-tools-involved)
4. [Complete Rental Workflow](#4-complete-rental-workflow)
5. [Manager Email and Notification Guide](#5-manager-email-and-notification-guide)
6. [Customer Email Summary](#6-customer-email-summary)
7. [The Bookings Sheet Explained](#7-the-bookings-sheet-explained)
8. [Manager Approval Process](#8-manager-approval-process)
9. [Inspection Forms](#9-inspection-forms)
10. [Daily Manager Checklist](#10-daily-manager-checklist)
11. [What Managers Do Not Need to Do](#11-what-managers-do-not-need-to-do)
12. [Troubleshooting](#12-troubleshooting)
13. [Safe Editing Rules](#13-safe-editing-rules)
14. [When to Contact the System Administrator](#14-when-to-contact-the-system-administrator)
15. [Quick Reference Checklist](#15-quick-reference-checklist)
16. [Frequently Asked Questions](#16-frequently-asked-questions)
17. [Current Rollout Status](#17-current-rollout-status)

---

## 1. What This System Does

This system runs quietly in the background and handles the routine, repetitive parts of renting
out a vehicle so you don't have to do them by hand. It coordinates:

- Vehicle bookings coming in from the calendar
- Sending the customer their intake form (their basic information and documents)
- Sending the customer their deposit/authorization step
- Sending the customer their rental agreement (lease) for signature
- Asking you to approve or deny the rental
- Telling the customer once they're approved
- Reminding the customer the day before pickup
- Sending the pre-trip and post-trip vehicle inspection forms
- Notifying you at the key moments so you always know what's happening
- Keeping a running record of every step in one spreadsheet (the "Bookings sheet")

**You should not need to manually send any of the routine customer emails or texts described in
this guide.** The system sends them automatically once the right conditions are met. Your job is
to review, approve, and watch for anything that looks wrong — not to operate the sending of
messages yourself.

---

## 2. What Managers Are Responsible For

Based on how the system is actually built today, a manager's real responsibilities are:

- **Reviewing new-booking emails** as they arrive, to stay aware of what's coming up
- **Checking the customer and rental details** (name, vehicle type, location, date/time,
  contact info) look correct and reasonable
- **Deciding whether to approve or deny each rental**, and recording that decision
- **Updating the Rental Approved field** in the Bookings sheet with one of the accepted values
  (see [Section 8](#8-manager-approval-process))
- **Reviewing the 24-hour rental summary** you receive before each pickup, so you know what's
  coming that day
- **Preparing the correct vehicle** for the date, time, and vehicle type shown in the booking
- **Reviewing whether the pre-trip inspection was completed** before or at pickup
- **Reviewing whether the post-trip inspection was completed** after the rental
- **Escalating anything that looks missing, wrong, or suspicious** to the system administrator
  (see [Section 14](#14-when-to-contact-the-system-administrator))
- **Not editing fields the system manages itself** (see [Section 13](#13-safe-editing-rules))

This guide does not describe any responsibility beyond what's listed above and detailed later in
this document — if you're ever asked to do something that isn't covered here, that's a good
reason to check with the system administrator rather than guess.

---

## 3. Tools Involved

You don't need to learn how any of these work — this table is just so the names make sense when
you see them mentioned in emails, logs, or conversations about the system.

| Tool | What it does, from a manager's perspective |
|---|---|
| **Google Calendar** (Appointment Schedules) | This is where the customer actually books the vehicle. The booking's date, time, and which calendar it came from tell the system the vehicle type and location. |
| **Google Sheets** ("Bookings" sheet) | The single running record of every booking. Every step of every rental is tracked here as it happens. This is the sheet you'll look at the most. |
| **Google Forms** | Two forms: one collects the customer's intake information before the rental, the other collects vehicle-condition inspection photos before and after the rental. |
| **Google Apps Script** | The automation itself — the "engine" that reads the Bookings sheet, sends messages, and reacts to things like payments and signatures. You never need to open or run this directly. |
| **Stripe** | Handles the customer's deposit/authorization hold on their card. You don't need to do anything in Stripe for a routine rental. |
| **DocuSeal** | Handles the rental agreement (lease) — sending it out for signature and confirming once it's signed. You (the manager) are also a required signer on every lease. |
| **SendGrid** | Sends every email the system generates (to customers, to you, and to the administrator). You'll never interact with SendGrid directly. |
| **Twilio** | Sends every text message the system generates. Each location has its own sending phone number, so texts from "your" location come from the same number every time. |
| **Pipedream** | A behind-the-scenes messenger that passes payment and signature events from Stripe and DocuSeal along to the automation. Nothing you need to check as a manager. |

---

## 4. Complete Rental Workflow

The table below walks through the entire life of a booking, grouped into stages. "Automatic"
means the system does it with no manager action required.

### Booking

| Step | Who | What happens | What the manager should do |
|---|---|---|---|
| 1 | Customer | Books a vehicle through the appropriate Google Calendar booking page. | Nothing yet. |
| 2 | System (automatic) | Within about 5 minutes, the booking is added as a new row in the Bookings sheet. | Nothing required — optional to glance at the sheet. |
| 3 | System (automatic) | The customer receives a welcome email and text with their deposit link and intake form link. | Nothing required. |
| 4 | System (automatic) | You receive a "new booking" email and text. | **Review it** — check the name, vehicle, location, date, and contact info look right. |

### Intake and Deposit

| Step | Who | What happens | What the manager should do |
|---|---|---|---|
| 5 | Customer | Submits the intake form. | Nothing required. |
| 6 | Customer | Completes the Stripe deposit/authorization step. | Nothing required. |

These two steps can happen in **either order** — the system handles both orderings correctly.

### Lease

| Step | Who | What happens | What the manager should do |
|---|---|---|---|
| 7 | System (automatic) | Once both intake and deposit are done, the rental agreement (lease) is sent via DocuSeal for signature. | Nothing required to trigger this — but you are a required signer on the lease. |
| 8 | Customer (and manager) | Everyone required signs the lease electronically. | **Sign the lease when you receive the DocuSeal signing request.** |

### Approval

| Step | Who | What happens | What the manager should do |
|---|---|---|---|
| 9 | System (automatic) | You receive an approval-request email asking you to review the rental. | **Review the booking.** |
| 10 | Manager | You decide whether to approve or deny. | **Set Rental Approved in the Bookings sheet** — see [Section 8](#8-manager-approval-process). |
| 11 | System (automatic) | Once **both** Rental Approved is set to an approved value **and** the lease is signed, the customer receives their approval email. | Nothing required — this happens automatically once both conditions are true, in whichever order they occur. |

### 24-Hour Preparation

| Step | Who | What happens | What the manager should do |
|---|---|---|---|
| 12 | System (automatic) | About a day before pickup, the customer receives a reminder with the pre-trip inspection form link. | Nothing required to send it. |
| 13 | System (automatic) | You receive a 24-hour rental summary for that pickup. | **Review it and prepare the vehicle.** |
| 14 | Customer | Submits the pre-trip inspection form. | **Check that it was completed before pickup** (see [Section 9](#9-inspection-forms)). |

### Rental

| Step | Who | What happens | What the manager should do |
|---|---|---|---|
| 15 | Customer | Picks up and uses the vehicle. | Hand off the vehicle as normal. |

### Post-Rental

| Step | Who | What happens | What the manager should do |
|---|---|---|---|
| 16 | System (automatic) | About an hour after the customer completes the pre-trip inspection form (step 14) — not after the rental ends — the customer receives a message with the post-trip inspection form link. | Nothing required to send it. |
| 17 | System (automatic) | You receive a post-trip inspection notice. | **Review it.** |
| 18 | Customer | Submits the post-trip inspection form. | **Check that it was completed** and follow up if not. |

Note: if the customer never submits the pre-trip inspection form, the post-trip message never
gets sent, since it's timed from the pre-trip form's completion, not from a fixed time after
pickup or drop-off.

---

## 5. Manager Email and Notification Guide

This section lists every email the system currently sends **to a manager or to the
administrator**. Each one begins with a greeting naming the booking's location — for example
`Hi Bainbridge Manager,`, `Hi Poulsbo Manager,`, `Hi Port Orchard Manager,`, or
`Hi Fairgrounds Manager,`. This greeting exists only to make it obvious at a glance which
location a message is about — **it does not change who actually receives the email.** All
location emails currently go to the same configured manager address; the greeting is a label,
not a routing decision.

| Email | Recipient | Sent when | What it contains | Action needed? |
|---|---|---|---|---|
| **New booking notification** | Manager (email + text) | As soon as a new booking is added to the sheet | Customer name, vehicle, location, date/time, contact info, deposit amount due | Review only |
| **Approval request** ("Action needed: approve rental for...") | Manager (email) | Once the customer's welcome message has gone out | Customer and rental details, and the three approval choices | **Yes — decide and set Rental Approved** |
| **Approval reminder** ("Reminder #N: approve rental for...") | Manager (email) | Repeats periodically if you haven't yet set Rental Approved | Same details, noting this is a follow-up | **Yes — same as above** |
| **Approval escalation** | **Administrator**, not the manager | If reminders go unanswered past a set number of attempts | Notes that the manager hasn't responded and to follow up directly | Administrator-facing; if you see this was sent, follow up on the approval yourself |
| **24-hour rental summary** | Manager (email + text) | About a day before the scheduled pickup, once the customer's reminder was actually delivered | Customer, vehicle, location, date/time, whether the lease is signed — does **not** include the pre-trip inspection link, since the blank form is only ever sent to the customer | Review and prepare the vehicle |
| **Post-trip inspection notice** | Manager (email) | About an hour after the customer completes the pre-trip inspection form, once the post-trip customer message was sent | Customer, vehicle, location, date, and the post-trip inspection link | Review; follow up if the form isn't submitted within a day |

A note on the approval escalation: it is the one manager-related message that does **not** go to
a location manager — it goes to the system administrator, because at that point the system has
already tried to reach the manager multiple times without a response.

---

## 6. Customer Email Summary

You don't need every detail of what customers receive, but it helps to know what to expect when
a customer asks "did I miss something?"

| Customer receives | When | What it's for |
|---|---|---|
| **Welcome email/text** | Right after booking | Contains the Stripe deposit link and the intake form link |
| **Deposit confirmation** | Right after the deposit step completes | Confirms the deposit, and lets them know the lease is coming |
| **Lease (rental agreement)** | Once both intake and deposit are done | Sent directly by DocuSeal — the customer signs here |
| **"Your rental is approved" email/text** | Once you've approved **and** the lease is signed | The one-time notice that everything is confirmed |
| **24-hour reminder** | About a day before pickup | Reminds them of pickup time and includes the pre-trip inspection form (says the form must be completed before driving, and that the post-trip form follows once pre-trip is done) |
| **Post-trip reminder** | About an hour after they complete the pre-trip inspection form | Thanks them and includes the post-trip inspection form |

---

## 7. The Bookings Sheet Explained

The Bookings sheet has one row per booking and columns A through X. This table documents the
exact current columns, in order.

| Col | Header | Who/what updates it | What it means | Should a manager edit it? |
|---|---|---|---|---|
| A | Event ID | System, at booking creation | An internal ID for the calendar booking. Used by the system to avoid creating duplicate rows. | No |
| B | Customer Name | System | The customer's name, taken from the booking. | No |
| C | Email | System | The customer's email address. | No |
| D | Phone | System | The customer's phone number. | No |
| E | Start Time | System | The scheduled pickup date/time. | No |
| F | End Time | System | The scheduled return date/time. | No |
| G | Deposit Paid | System, when Stripe confirms payment | `Yes` once the deposit/authorization step is complete. Blank means not yet done. | No |
| H | Stripe Amount | System, when Stripe confirms payment | The dollar amount the customer authorized. Informational. | No |
| I | Intake Sent | System, at booking creation | `Yes` once the welcome email (with the intake link) has been sent. This means the *link was emailed*, not that the customer filled it out — see column V for that. | No |
| J | Lease Sent | System, once deposit and intake are both done | `Yes` once the rental agreement has been sent out for signature. | No |
| K | 24hr Sent | System, about a day before pickup | `Yes` once the 24-hour reminder was actually delivered to the customer. | No |
| L | Post-Rental Sent | System, about an hour after the customer completes the pre-trip inspection form | `Yes` once the post-trip message was sent. | No |
| M | Second Driver Email | System, at booking creation | The second driver's email, if the booking included one. Otherwise blank/placeholder. | No |
| N | Lease Signed | System, once DocuSeal confirms signing | `Yes` once the lease has been fully signed. | No |
| O | Rental Approved | **Manager** | Your decision. See [Section 8](#8-manager-approval-process) for the exact accepted values. | **Yes — this is the field you're expected to set.** |
| P | Approval Notified At | System | The timestamp of the last approval-request email sent to you. Used only to time reminders. | No |
| Q | Approval Reminder Count | System | How many approval reminders have been sent so far. Used only to control the reminder loop. | No |
| R | Vehicle Type | System, from the calendar the booking came from | The vehicle type for this booking (e.g. Cargo Van, Moving Truck). | No, under normal circumstances |
| S | Location | System, from the calendar the booking came from | The location for this booking. | No, under normal circumstances |
| T | DocuSeal Submission ID | System, when the lease is sent | An internal reference number for the signed lease. Used to match the signing confirmation back to the right booking. | No |
| U | Customer Approval Notified | System, once approval + signing conditions are both met | `Yes` once the customer's "your rental is approved" message has been sent, so it's never sent twice. | No |
| V | Intake Form Completed | System, when the customer actually submits the intake form | `Yes` once the customer has submitted the intake form (not just been sent the link). | No |
| W | Pre-Inspection Form Completed | System, when the customer actually submits the pre-trip inspection form | `Yes` followed by the date and time it was submitted (e.g. `Yes 8/2/2026 9:15 AM`) once the pre-trip inspection form has been submitted. This timestamp is also what the system uses to time the post-trip message (see [Section 9](#9-inspection-forms)). | No — see [Section 9](#9-inspection-forms) |
| X | Post-Inspection Form Completed | System, when the customer actually submits the post-trip inspection form | `Yes` followed by the date and time it was submitted (e.g. `Yes 8/2/2026 4:08 PM`) once the post-trip inspection form has been submitted. | No — see [Section 9](#9-inspection-forms) |

**In every column except O, W, and X, "blank" means "hasn't happened yet" and "Yes" means "done."
There is no other accepted value in these Yes/blank columns. Columns W and X are the two
exceptions: instead of a bare `Yes`, they hold `Yes` plus the exact date and time the form was
submitted, in the same cell — blank still means "not done."**

---

## 8. Manager Approval Process

This is the one step in the whole workflow that always requires a person — you — to make a
decision. It deserves a close look.

### What causes the approval request to be sent

Once a new booking's welcome message has gone out (column I becomes `Yes`), the system starts
asking you to review it. It keeps asking on a repeating schedule until you set a decision.

### What you should review before deciding

- The customer's name and contact information look legitimate
- The vehicle type, location, and date/time are correct
- Anything else your normal company policy asks you to check before approving a rental

### Which field you edit, and the accepted values

You record your decision in **column O, Rental Approved**. The system accepts exactly three
values:

| Value | Meaning |
|---|---|
| `Approved - Free` | You approve the rental with no additional fee. |
| `Approved - Paid` | You approve the rental with an additional fee/paid arrangement. |
| `Denied` | You are denying the rental. |

Only these three exact values are recognized. The dropdown in the sheet is set up to only offer
these choices, so as long as you pick from the dropdown you'll always enter a valid value.

### What happens once you approve

As soon as you set `Approved - Free` or `Approved - Paid`:
- The approval-reminder emails to you **stop immediately.**
- The customer is **not** told right away — see the next section.

### Why the customer approval email might not send immediately

The customer's "your rental is approved" message is only sent once **both** of these are true:

1. Rental Approved is `Approved - Free` or `Approved - Paid`
2. Lease Signed (column N) is `Yes`

If you approve a rental before the lease has been signed, nothing is wrong — the system is simply
waiting. As soon as the lease gets signed afterward, the customer approval message goes out
automatically on the very next check (checks run every few minutes).

> **Example — approval first, signature later**
> 1. You mark the booking `Approved - Free`.
> 2. Lease Signed is still blank.
> 3. The customer approval email does **not** send yet.
> 4. The lease gets signed later that day.
> 5. The system then sends the customer approval email automatically.

> **Example — signature first, approval later**
> 1. The lease gets signed, so Lease Signed becomes `Yes`.
> 2. You haven't reviewed the booking yet, so Rental Approved is still blank.
> 3. The customer approval email does **not** send yet.
> 4. You review the booking and set it to `Approved - Paid`.
> 5. The system then sends the customer approval email automatically.

Either order works correctly — the system simply waits for whichever condition is still missing.

### Manager reminder behavior

If you don't respond to the first approval request, you'll receive a follow-up reminder after a
set number of hours, and this repeats up to a small, fixed number of times.

### Escalation behavior

If you still haven't responded after the full set of reminders, the system sends **one** message
to the system administrator (not to you) noting that approval is still outstanding, and then goes
quiet on that booking — it will not keep emailing you or the administrator about it. If this
happens, please follow up on the approval directly.

### If you made a mistake

If you selected the wrong value in Rental Approved, simply change it to the correct value.

- Changing **into** `Denied` after having approved will stop the customer from being told they're
  approved (assuming that message hasn't already gone out).
- Changing **out of** `Denied` re-opens the approval path — treat this the same as if you were
  approving it for the first time.
- **If the customer has already received their approval email before you realize the decision was
  wrong, the system will not automatically "unsend" it.** Contact the customer directly, and
  contact the system administrator if you're unsure how to correct the record.

---

## 9. Inspection Forms

There are two inspection checkpoints for every rental: **before** pickup and **after** return.
Both use the same Google Form — the customer is asked one question, **Inspection Type**, that
tells the system which one they're completing. The two exact accepted answers are:

- `Pre-Trip (Before Vehicle Pickup)`
- `Post-Trip (After Vehicle Return)`

| | Pre-trip inspection | Post-trip inspection |
|---|---|---|
| When the link is sent | With the 24-hour reminder, about a day before pickup | About an hour after the customer completes the pre-trip inspection form |
| Sheet column it completes | W (Pre-Inspection Form Completed) | X (Post-Inspection Form Completed) |

**A blank X simply means the customer hasn't submitted the post-trip form yet.** It does not, by
itself, block or delay anything else in the workflow — but it's still something you should follow
up on, since it's the vehicle-condition record for that rental.

**A blank W is different: it also means the post-trip message has not gone out yet.** The
post-trip inspection link is only sent once the pre-trip form is completed (plus about an hour) —
so if a customer never submits the pre-trip form, they will never automatically receive the
post-trip link either. If a rental has ended and W is still blank, that's worth following up on
for two reasons: the pre-trip inspection record is missing, and the post-trip message hasn't been
triggered.

### If a customer says they submitted the form but the sheet still shows blank

1. Double-check you're looking at the correct booking row.
2. Ask the customer to confirm they actually pressed submit (not just opened the form).
3. Give it a few minutes — there can be a short delay between submission and the sheet updating.
4. If it's been a while and still blank, contact the system administrator with the customer's
   name, email, and approximate submission time so it can be investigated.

### Why you should not manually mark W or X as "Yes"

Marking these columns `Yes` by hand tells the system (and anyone else looking at the sheet) that
the form was submitted and matched to this booking, when it may not actually have been. If a
submission is genuinely missing, the right move is to have the customer resubmit or to escalate
it — not to edit the column directly, which can hide a real problem (for example, a submission
that came in but was matched to the wrong booking, or wasn't matched at all because of a mismatch
in the confirmed email address or date).

For column W specifically, there's an additional reason: the system reads the date/time that
follows `Yes` in that cell to decide when to send the post-trip message (about an hour later). A
hand-entered `Yes` with no date/time, or a date/time the system can't parse, means the post-trip
message will never be sent automatically for that booking — the system will not guess a
completion time it wasn't actually given.

Both the intake form and both inspection forms live inside the same overall system — you don't
need to know the technical details of how submissions are matched to bookings to use this guide;
just know that submission matching happens automatically, and a mismatch is something to report
rather than fix by hand.

---

## 10. Daily Manager Checklist

### Start of day
- [ ] Check for any new-booking emails you haven't reviewed yet
- [ ] Check for any pending approval requests or reminders

### Before each rental
- [ ] Confirm Rental Approved is set correctly for that booking
- [ ] Confirm Lease Signed is `Yes`
- [ ] Confirm Deposit Paid is `Yes`
- [ ] Confirm you've received the 24-hour rental summary
- [ ] Have the correct vehicle ready for the vehicle type/location/time shown

### At pickup
- [ ] Confirm the pre-trip inspection form was completed (column W)
- [ ] Hand off the vehicle per your normal process

### After return
- [ ] Confirm the post-trip inspection form was completed (column X)
- [ ] Follow up with the customer if it's still blank after a reasonable time

### End of day
- [ ] Scan the sheet for any bookings with unusual gaps (e.g. approved but not signed for several
      days, or reminders that don't seem to be resolving)
- [ ] Escalate anything that looks stuck — see [Section 14](#14-when-to-contact-the-system-administrator)

---

## 11. What Managers Do Not Need to Do

You should never need to:

- Create Stripe payment links or sessions by hand
- Create DocuSeal lease submissions by hand
- Manually send any of the routine customer emails or texts described in this guide
- Run or execute any Apps Script code
- Set up or modify triggers (the schedules the system runs on)
- Use GitHub or any code repository
- Use `clasp` or any code deployment tool
- View or edit Script Properties (the system's technical configuration values)
- Inspect or modify Pipedream workflows
- Deploy code changes

All of the above are the system administrator's responsibility, not yours.

---

## 12. Troubleshooting

For each issue: check the listed items, avoid the listed edits, and escalate when noted.

**Booking does not appear in the sheet**
- Check: has it been at least 5–10 minutes since the customer booked?
- Check: did the booking include an email address or phone number? The system needs at least one
  to create the row.
- Do not: manually add a row for the booking.
- Escalate if: it's been well over 10 minutes and the booking still hasn't appeared.

**Customer did not receive the welcome email**
- Check: the customer's spam folder.
- Check: whether the row exists in the sheet at all, and whether column I (Intake Sent) is `Yes`.
- Do not: manually resend from the sheet — there is no manual resend feature.
- Escalate if: the row shows I = `Yes` but the customer genuinely never received anything.

**Intake form was submitted but column V is still blank**
- See [Section 9](#9-inspection-forms) for the same troubleshooting approach — it applies here too
  (double-check the row, confirm the customer actually submitted, allow a short delay).
- Do not: manually mark V as `Yes`.
- Escalate if: the submission is confirmed but the column remains blank after a reasonable wait.

**Deposit was completed but column G is still blank**
- Check: did the customer actually complete the Stripe checkout, or only open the link?
- Do not: manually mark G as `Yes` — this can trigger downstream lease sending against a
  payment that may not have actually cleared.
- Escalate if: the customer has a payment confirmation but G stays blank.

**Lease was signed but column N is still blank**
- Check: did *every* required signer — including you as the manager — actually complete their
  signature? The lease is not considered fully signed until all required parties have signed.
- Do not: manually mark N as `Yes`.
- Escalate if: everyone has genuinely signed and the column is still blank.

**Manager approval was entered but customer approval did not send**
- Check: column N (Lease Signed). If it's blank, this is expected — see
  [Section 8](#8-manager-approval-process). The customer email sends automatically once the lease
  is signed.
- Do not: change any other column to try to force the email.
- Escalate if: both O is approved and N is `Yes`, and the customer still hasn't received anything
  after a reasonable wait.

**Approval reminder keeps arriving**
- Check: has Rental Approved actually been set? A reminder means the system still sees it blank.
- Do not: ignore it indefinitely — reminders stop the moment a value is set.
- Escalate if: you've set a value and are still receiving reminders for that same booking.

**24-hour email did not send**
- Check: is the deposit paid (column G) and is the rental approved (column O)? Both are required
  before this reminder goes out.
- Check: is it actually within roughly a day of the scheduled pickup yet?
- Do not: manually mark column K as `Yes` — this would prevent the real reminder from ever going
  out for that booking.
- Escalate if: deposit is paid, the rental is approved, pickup is within a day, and still nothing
  has gone out.

**Pre-trip form was submitted but column W is still blank**
- Follow the same steps as the intake-form entry above, applied to W instead of V.

**Post-trip email did not send**
- Check: has the customer actually completed the pre-trip inspection form (column W)? This message
  is timed from that completion, about an hour later — **not** from the rental's scheduled end
  time or how long ago pickup happened. If W is still blank, the post-trip message will not go out
  yet, no matter how much time has passed since the rental ended.
- Check: has at least an hour passed since the date/time shown in column W?
- Do not: manually mark column L as `Yes`.
- Escalate if: column W shows a completion time more than an hour or two in the past and still
  nothing has gone out.

**Post-trip form was submitted but column X is still blank**
- Follow the same steps as the intake-form entry above, applied to X instead of V.

**Manager email has the wrong location greeting**
- The greeting (e.g. "Hi Bainbridge Manager,") is generated from the booking's Location column
  (S). If the greeting looks wrong, the booking's location may have been set incorrectly at
  creation time.
- Do not: assume the email went to the wrong inbox — the greeting does not control delivery.
- Escalate if: the location genuinely appears wrong for that booking.

**Customer email address is wrong**
- Check: what's shown in column C against what the customer says is correct.
- Do not: edit column C expecting it to resend anything automatically — editing it only changes
  the record, it does not retroactively resend past messages.
- Escalate if: you're unsure whether editing it will affect anything already in progress for that
  booking (for example, a lease already sent to the old address).

**Customer has a second driver**
- This is handled automatically — see [Section 16 FAQ](#16-frequently-asked-questions).

**Customer needs the lease or a form resent**
- There is currently no automated "resend" feature for the lease or the inspection forms. This
  is a case to bring to the system administrator rather than try to work around yourself.

**Duplicate booking rows appear**
- Do not: delete either row yourself without understanding which one is the "real" one.
- Escalate immediately — this can indicate a real issue and deleting the wrong row could lose
  information about a real customer.

**Booking is for the wrong vehicle type or location**
- Check: which calendar the booking actually came from — vehicle type and location are set from
  that, automatically, at the time the booking is created.
- Do not: routinely edit columns R or S as a way of "fixing" bookings — this is not a normal
  manager workflow in the current system.
- Escalate if: a booking consistently shows the wrong vehicle type or location for its calendar.

**Manager accidentally edited the wrong field**
- If it's a system-managed column (anything other than O), note what it was changed to (if you
  remember the original value) and contact the system administrator — some system-managed values
  can be hard to reconstruct correctly by guessing.
- If it's column O, simply set it to the correct value — this is safe to correct yourself.

**Customer cancels or changes the rental**
- There is currently no built-in cancellation or rescheduling feature in this system. Handle
  cancellations and changes through your normal company process, and treat the sheet as a record
  to be manually annotated or escalated for correction rather than a place with a built-in
  "cancel" button.

---

## 13. Safe Editing Rules

### Safe or expected for managers to edit

| Field | Notes |
|---|---|
| **Column O — Rental Approved** | This is the field you are expected to set, using exactly one of the three accepted values from [Section 8](#8-manager-approval-process). |

### System-managed fields — do not edit

| Fields | Why manual edits can create a misleading state |
|---|---|
| A, B, C, D, E, F, M, R, S (booking details) | These are filled in automatically from the calendar booking. Editing them changes the record without changing what actually happened, which can make the sheet disagree with Stripe, DocuSeal, or the customer's actual booking. |
| G, H (deposit) | These reflect what Stripe actually confirmed. Setting G to `Yes` by hand does not create a real deposit — it can cause the system to send a lease or other messages as if payment had cleared when it hasn't. |
| I, J, K, L (sent flags) | These record that a specific message was actually delivered. Marking one `Yes` by hand can permanently prevent the real message from ever being sent for that booking. |
| N (Lease Signed) | This reflects DocuSeal's confirmation that signing is complete. Setting it by hand can let a rental proceed as if a legally required signature exists when it may not. |
| P, Q (approval timing/count) | These exist only to control the manager reminder schedule. Editing them can cause reminders to stop or restart unexpectedly. |
| T (DocuSeal Submission ID) | This is the internal reference number the system uses to match a signing confirmation to the right booking. Changing it can cause a real signature to be matched to the wrong row, or to no row at all. |
| U, V, W, X (approval/intake/inspection completion) | These record that the customer actually completed a specific step. Marking one `Yes` by hand tells the system (and anyone reading the sheet) something happened that may not have — see [Section 9](#9-inspection-forms) for why this matters especially for the inspection columns. |

**Rule of thumb:** if a column records something the *customer* did (submitted a form, paid, signed) or something the *system* did (sent a message), leave it alone. If it records something *you* decide, it's yours to set.

---

## 14. When to Contact the System Administrator

Reach out to the system administrator when you see any of the following:

- The Bookings sheet disagrees with what Stripe or DocuSeal actually shows for a booking
- Duplicate rows for what looks like the same booking
- The same notification (to you or a customer) arriving repeatedly when it shouldn't
- A customer's payment or signature seems to have been matched to the wrong booking row
- A booking's vehicle type or location consistently looks wrong for the calendar it came from
- You suspect the automatic checks (triggers) have stopped running — for example, nothing has
  updated in the sheet for an unusually long time even though new bookings should exist
- You receive a manager-facing email you don't recognize or that doesn't match anything in this
  guide
- Expected form responses (intake or inspection) seem to be missing entirely
- Anything about the system's behavior seems inconsistent with what this guide describes

**System administrator contact information:**

- System administrator: [Add name]
- Email: [Add email]
- Phone: [Add phone]

---

## 15. Quick Reference Checklist

**New booking:**
- [ ] Review the new-booking email
- [ ] Check customer, vehicle, date, and location
- [ ] Let intake, deposit, and lease signing happen (any order) before expecting approval to
      fully take effect

**Approval:**
- [ ] Review the booking
- [ ] Set Rental Approved to `Approved - Free`, `Approved - Paid`, or `Denied`
- [ ] Confirm Customer Approval Notified (column U) eventually changes to `Yes` once both approval
      and signing are done

**Before pickup:**
- [ ] Check 24hr Sent (column K)
- [ ] Confirm Lease Signed (column N) is `Yes`
- [ ] Confirm Deposit Paid (column G) is `Yes`
- [ ] Confirm Customer Approval Notified (column U) is `Yes`
- [ ] Confirm Pre-Inspection Form Completed (column W) as appropriate for your process

**After return:**
- [ ] Check Post-Rental Sent (column L)
- [ ] Confirm Post-Inspection Form Completed (column X)
- [ ] Escalate damage or discrepancies through your normal company process — this system does not
      include a built-in damage-resolution workflow

---

## 16. Frequently Asked Questions

**Why has the customer not received their approval email yet?**
Almost always because Lease Signed (column N) is still blank. The customer approval email
requires both your approval and a completed signature — see [Section 8](#8-manager-approval-process).

**Can I manually set Deposit Paid to Yes?**
No. This column should only ever reflect what Stripe actually confirmed. Setting it by hand can
cause a lease to be sent for a deposit that was never actually received.

**Can I manually mark Lease Signed?**
No. This should only reflect DocuSeal's confirmation that every required signature is complete.

**What if the customer has a second driver?**
Nothing special is required from you. If the booking's details include a second driver's email,
the system automatically uses the two-driver version of the lease and sends a signing request to
both drivers.

**Does the manager need to send the inspection forms?**
No. Both the pre-trip and post-trip inspection form links are sent automatically, bundled with
the 24-hour reminder and the post-rental message.

**Why is Pre-Inspection still blank?**
Either the customer hasn't submitted the form yet, or the 24-hour reminder that contains the link
hasn't gone out yet (which itself requires the deposit to be paid and the rental to be approved).
See [Section 9](#9-inspection-forms) and [Section 12](#12-troubleshooting).

**Why did I receive an approval reminder?**
Because Rental Approved is still blank for that booking. Reminders stop as soon as you set a
value.

**Does changing the sheet send an email?**
Only column O behaves this way, and only indirectly: setting it to an approved value can allow
the customer approval email to go out (if the lease is already signed), and setting it to
anything stops your approval reminders. Editing other columns by hand does not trigger a real
message — see [Section 13](#13-safe-editing-rules) for why editing them is still discouraged.

**What happens if a customer books twice?**
Each booking on the calendar becomes its own row, matched by its own internal booking ID, so two
separate bookings will normally appear as two separate rows even for the same customer. If you
believe two rows actually represent the same booking, treat that as a duplicate-row situation —
see [Section 12](#12-troubleshooting) — rather than deleting either row yourself.

**What should I do if the rental location is wrong?**
Check which calendar the booking came from, since location is set automatically from that at
creation time. If it's consistently wrong, escalate to the system administrator rather than
routinely editing the Location column yourself.

**Who deploys code changes?**
The system administrator/developer, not the manager. You should never need to deploy, push, or
otherwise change any code to use this system.

---

## 17. Current Rollout Status

> **This section describes the system's current testing status. It is expected to change as
> validation continues, and should be updated once the items below are confirmed — this is not
> a permanent part of a manager's ongoing responsibilities.**

As of this writing, the following have been validated end-to-end:

- Calendar booking sync
- Welcome/intake message delivery
- Stripe authorization flow
- DocuSeal lease delivery
- Lease signing
- Manager approval
- Customer approval gating
- Customer approval notification
- Intake completion tracking
- Trigger installation (the automatic schedules the system runs on)

The following are implemented but still awaiting final operational validation:

- The automatic pre-trip reminder actually firing on schedule
- The manager pre-trip greeting and summary
- Pre-trip inspection completion tracking with the actual submission time (column W)
- The post-trip reminder actually firing about an hour after pre-trip completion
- The manager post-trip greeting and notice
- Post-trip inspection completion tracking with the actual submission time (column X)

If you notice any of the "still awaiting validation" items behaving unexpectedly, that is
valuable information — please report it to the system administrator rather than assuming it's a
mistake on your part.
