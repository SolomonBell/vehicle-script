# Production Diff Summary
## archive/v7-original.js → archive/current-production-from-andrew.js (v8)

> **⚠ Historical document.** This is a point-in-time diff analysis between the two archived v7/v8
> scripts, written before the multi-site refactor. Several items it describes as open or
> unimplemented have since been resolved in the current `src/*.js` code: `WEBHOOK_SHARED_SECRET`
> validation is now implemented at the top of `doPost` (`Webhooks.js`), and `verifyStripeSignature`
> / `computeHmacSha256` (the "dead code" discussed in section 3 and Q2) no longer exist in the
> codebase at all. The open questions to Andrew in section 6 are retained for historical record —
> do not treat them as still-open. For the current architecture, see **README.md** and
> **docs/setup-notes.md**.
>
> **The `archive/` directory this document diffs (`archive/v7-original.js` and
> `archive/current-production-from-andrew.js`) has been deleted from this repository.** Neither
> file exists anymore; this analysis is retained only as a historical record of the v7 → v8
> transition.

---

## 1. High-Level Overview

The new script is **v8** — a focused, low-risk increment on v7. The overall architecture is unchanged: same engines, same column schema, same sheet name, same trigger functions, same Pipedream-compatible `doPost` payload shapes. There are four meaningful changes:

1. Manager is now BCC'd on every customer-facing email (new BCC logic in `sendEmailHtml`)
2. `FROM_EMAIL` and `REPLY_TO_EMAIL` changed from `info@` / `andrew@` to `bainbridge@`
3. A new `toDate()` defensive helper wraps all date formatters, replacing an opaque error
4. A diagnostic log line was added in `syncCalendarBookings` for the `startTime` value

None of these changes affect the architecture-proposal.md assumptions in a breaking way, but two of them have direct implications for the multi-site refactor (see section 5).

---

## 2. Functional Changes

### Email: BCC behavior (new in v8)
`sendEmailHtml` now builds a `personalization` block that adds a BCC to `CONFIG.MANAGER_EMAIL` on every customer-facing email. The BCC is intentionally skipped when the primary recipient is already the manager or the admin, to avoid duplicate copies.

```
Emails that ARE BCC'd to manager:
  - Welcome email to customer (new booking)
  - Deposit confirmation email to customer
  - 24-hour reminder to customer
  - Post-rental inspection email to customer

Emails that are NOT BCC'd:
  - Approval/reminder/escalation emails to manager (she's already the To:)
  - Admin alert emails (she's ADMIN_EMAIL)
  - DocuSeal lease emails (sent by DocuSeal directly, not sendEmailHtml)
```

This is the most significant behavioral change in v8 and is explicitly documented in the v8 header comment.

### Email: FROM address and reply-to (changed in v8)

| Field | v7 | v8 |
|---|---|---|
| `FROM_EMAIL` | `info@example.com` | `site@example.com` |
| `REPLY_TO_EMAIL` | `admin@example.com` | `site@example.com` |

Customer replies now go to the site manager, not the admin. This aligns with the architecture proposal's existing decision to make `fromEmail` and `replyToEmail` per-site fields.

### SMS: no change in behavior
`sendSms` is functionally identical to v7. v8 adds a comment block explaining why no manager copy is needed for SMS: all texts are already sent FROM the Bainbridge Twilio number (`+12065550111`), so every message appears in that number's thread. A copy to the manager is also impossible because Twilio rejects `To == From`.

### Deposit/payment handling: no change
`markDepositPaid` is functionally identical to v7. Logic, column writes, and sequencing are unchanged.

### DocuSeal handling: no change
`sendLeaseViaDocuSeal` is functionally identical to v7. The v8 header explicitly notes that DocuSeal lease emails are sent by DocuSeal directly and are therefore not subject to the new BCC logic.

### Manager approval logic: no change
`checkRentalEligibility` is functionally identical to v7. P/Q column state machine, branch A/B/C/D logic, and escalation behavior are unchanged.

### Reminders: no change in logic
`processReminders` is functionally identical to v7. The BCC in `sendEmailHtml` means the manager now silently receives copies of the 24-hour and post-rental customer emails, but no reminder logic was changed.

### `doPost` / Pipedream payload handling: no change
`doPost` is functionally identical to v7. It still accepts the same two payload shapes:
- `{ "customerEmail": "...", "amountPaid": "..." }` → Stripe path
- `{ "type": "lease_signed", "signerEmail": "..." }` → DocuSeal path

No `secret` field is checked. The endpoint still trusts any well-formed POST (see section 3).

### Google Forms prefill logic: no change
`buildIntakeUrl` and `buildInspectUrl` are identical to v7. No site parameter, no Site dropdown entry ID.

### Column/sheet schema: no change
Column headers A–Q are identical to v7. No new columns added.

### Diagnostic log added in `syncCalendarBookings` (v8)
A single log line was added immediately after `event.getStartTime()`:

```javascript
Logger.log('startTime diag: value=' + startTime + ' | type=' + typeof startTime +
           ' | isDate=' + (startTime instanceof Date) + ' | event="' + event.getTitle() + '"');
```

This appears to be active debugging work related to the `toDate()` fix (see section 4). It is not harmful but is probably not intended as permanent production logging.

---

## 3. Security Changes

### `WEBHOOK_SHARED_SECRET`: not implemented
`doPost` in v8 does not check any shared secret. The endpoint trusts any POST request that parses as valid JSON. **This is unchanged from v7.** The `WEBHOOK_SHARED_SECRET` design in the architecture proposal is still entirely forward work.

### Stripe signature verification: still dead code
`verifyStripeSignature` and `computeHmacSha256` are present in both v7 and v8 but are never called from `doPost`. They appear to be unused. Stripe signature validation is presumably delegated to Pipedream before forwarding.

### `doPost` still trusts plain JSON
No change. Any caller with the correct payload shape can trigger sheet writes, emails, SMS, and DocuSeal submissions. The shared secret check from the architecture proposal must still be implemented.

---

## 4. Configuration Changes

### `FROM_EMAIL` and `REPLY_TO_EMAIL` changed (see section 2)
These are the only CONFIG value changes. All other fields are identical to v7.

### No new Script Properties
The set of Script Properties keys is identical to v7:
`CALENDAR_ID`, `STRIPE_PAYMENT_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `TWILIO_SID`, `TWILIO_TOKEN`, `SENDGRID_KEY`, `DOCUSEAL_KEY`, `INTAKE_FORM_BASE`, `INSPECT_FORM_BASE`, `BITLY_TOKEN`

`WEBHOOK_SHARED_SECRET` is not present. It must be added as part of the multi-site refactor.

### No new hardcoded values
`TWILIO_NUM` (`+12065550111`) and `MANAGER_PHONE` (`+12065550100`) remain hardcoded constants, same as v7.

### `verifyStripeSignature` is still present but uncalled
`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` exist in CONFIG but are never passed to `verifyStripeSignature`, which itself is never called. These properties are being loaded from Script Properties for no current purpose. Worth confirming with Andrew whether this function was ever wired up, or if Pipedream fully owns Stripe signature verification.

---

## 5. Migration Implications

### Replace `src/Code.js` with v8
Yes — `src/Code.js` should be replaced with `archive/current-production-from-andrew.js`. It contains a real production bug fix (`toDate()`) and a real behavior change (manager BCC) that must not be lost in the refactor. All future work should start from v8, not v7.

### BCC logic requires careful handling in multi-site refactor
The BCC condition in `sendEmailHtml` currently reads:

```javascript
if (CONFIG.MANAGER_EMAIL &&
    toEmail !== CONFIG.MANAGER_EMAIL &&
    toEmail !== CONFIG.ADMIN_EMAIL) {
  personalization.bcc = [{ email: CONFIG.MANAGER_EMAIL }];
}
```

When `sendEmailHtml` is refactored to accept a `site` parameter:
- `CONFIG.MANAGER_EMAIL` → `site.managerEmail`
- `CONFIG.ADMIN_EMAIL` → `GLOBAL.adminEmail`

If either substitution is missed, the manager will receive BCC copies of her own approval emails, or the BCC will be suppressed on all emails. This is the highest-risk line in the refactor.

### `toDate()` helper is a keeper
The new `toDate()` function is a genuine improvement — it converts the opaque "Invalid argument: date. Should be of type: Date" error into a descriptive message naming the bad value. Keep it in the refactored code.

### Diagnostic log should be resolved before production refactor
The `startTime diag` log line in `syncCalendarBookings` fires on every new booking event indefinitely. Confirm with Andrew whether the underlying issue is resolved and remove the log, or promote it to a permanent structured log. Leaving it as-is is not a problem functionally, but adds noise to the execution log at scale.

### `docs/architecture-proposal.md` update needed
One sentence in the proposal incorrectly states that `INTAKE_FORM_BASE` + entry IDs and `INSPECT_FORM_BASE` + entry IDs were already in GLOBAL with `INTAKE_ENTRY_SITE`/`INSPECT_ENTRY_SITE` added. Neither entry ID exists in v8 yet. The Site dropdown on the forms has not been added yet, so `INTAKE_ENTRY_SITE` and `INSPECT_ENTRY_SITE` have no values to assign. This is still forward work, not something to block the refactor on — but the proposal should note that the Site dropdown entry IDs are pending Andrew adding the dropdown to the forms.

### `docs/setup-notes.md` — FROM_EMAIL note
The setup notes still list `TWILIO_NUM` and `MANAGER_PHONE` as hardcoded constants, which is correct. No change needed there. However, `FROM_EMAIL` and `REPLY_TO_EMAIL` are now effectively hardcoded to `site@example.com` inside CONFIG rather than being Script Properties. In the multi-site refactor these will move to the SITES array, so no intermediate action is needed.

---

## 6. Risks and Questions for Andrew

**Q1 — Diagnostic log intent:**
The `startTime diag` log line in `syncCalendarBookings` was presumably added to debug the date issue that `toDate()` now handles. Is the issue resolved? Should this log be removed, or should it be kept as permanent observability?

**Q2 — `verifyStripeSignature` dead code:**
`verifyStripeSignature` and `computeHmacSha256` are defined but never called. Is Stripe signature verification fully handled by Pipedream before the payload reaches `doPost`? If yes, these functions can be removed in the refactor to reduce confusion. If they were intended to be called from `doPost`, that wiring was never completed.

**Q3 — `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in Script Properties:**
These are loaded from Script Properties into CONFIG in both v7 and v8, but since `verifyStripeSignature` is never called they serve no current purpose. Are they present in the live Script Properties? Should they be removed (or kept for when Pipedream → Apps Script signature validation is added in v9)?

**Q4 — BCC on DocuSeal emails:**
The v8 comment confirms that DocuSeal lease emails are sent by DocuSeal and are therefore not BCC'd to the manager. Is this intentional for the long term, or should the manager eventually receive a copy of the lease email through some other mechanism?

**Q5 — Site dropdown on forms:**
The architecture proposal describes `INTAKE_ENTRY_SITE` and `INSPECT_ENTRY_SITE` as GLOBAL Script Properties for the Site dropdown. Has Andrew added the Site dropdown to the intake and inspection forms yet? The entry IDs for that dropdown are needed before `buildIntakeUrl` and `buildInspectUrl` can be refactored to pre-select the location.

**Risk — BCC condition during refactor:**
The most fragile line in the entire refactor is the BCC guard in `sendEmailHtml`. If `site.managerEmail` is accidentally compared against `CONFIG.MANAGER_EMAIL` (a mix of old and new references), the manager will receive duplicate emails on her own approval notifications, or BCC will be incorrectly suppressed. This line should have an explicit test case in Gate 1.
