## Multi-Site Architecture Proposal — Reliable Storage Truck Rental Automation (Revised)

**Branch target:** `refactor/multi-site` off `main`
**Baseline:** `src/Code.js` (v7, Bainbridge single-location)

---

### 1. Configuration Split

**`GLOBAL` object** — truly shared across all sites:

| Key | Notes |
|---|---|
| `ADMIN_EMAIL` | Corporate escalation, not site-specific |
| `SENDGRID_KEY`, `FROM_NAME` | One sending account; display name is the company, not the location |
| `TWILIO_SID`, `TWILIO_TOKEN` | One Twilio account |
| `DOCUSEAL_KEY`, `DOCUSEAL_TEMPLATE_SINGLE`, `DOCUSEAL_TEMPLATE_TWO_DRIVERS` | Templates stay global unless Andrew confirms they differ by site |
| `STRIPE_PAYMENT_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Shared unless Andrew sets up per-site Stripe accounts |
| `INTAKE_FORM_BASE` + all entry IDs | Shared form; Andrew will add a Site dropdown to the form so responses are tagged by location |
| `INSPECT_FORM_BASE` + all entry IDs | Same — shared form with a Site dropdown |
| `BITLY_TOKEN` | One shortener account |
| `DAYS_AHEAD`, `POST_RENTAL_HOURS`, `HOURS_BETWEEN_APPROVAL_REMINDERS`, `MAX_APPROVAL_REMINDERS` | Policy constants, uniform |

**`SITES` array** — one entry per location:

| Key | Rationale |
|---|---|
| `id`, `label` | Internal identifier (`'bainbridge'`) and human-readable label |
| `sheetName` | One tab per site (e.g., `'Bookings'`, `'Bookings - Site2'`) |
| `calendarId` | Each site has its own booking calendar |
| `managerEmail`, `managerPhone` | Each site has its own manager |
| `fromEmail` | Site-specific sending address (e.g., `site@example.com`) |
| `replyToEmail` | Site-specific reply address |
| `twilioFrom` | Site-specific Twilio sending number |

```javascript
const SITES = [
  {
    id:           'bainbridge',
    label:        'Bainbridge',
    sheetName:    'Bookings',
    calendarId:   PROPS.BAINBRIDGE_CALENDAR_ID,
    managerEmail: 'site@example.com',
    managerPhone: '+12065550100',
    fromEmail:    'site@example.com',
    replyToEmail: 'site@example.com',
    twilioFrom:   '+12065550111',
  },
  // { id: 'site2', ... }
];
```

Script Properties follow the pattern `{SITE_ID}_{KEY}` for site-specific values; global keys are unprefixed.

---

### 2. Functions Requiring Refactoring

**`sendSms(toPhone, message, site)`** — replace `CONFIG.TWILIO_NUM` with `site.twilioFrom`. `TWILIO_SID` and `TWILIO_TOKEN` come from `GLOBAL`.

**`sendEmailHtml(toEmail, subject, htmlBody, site)`** — replace `CONFIG.FROM_EMAIL` / `CONFIG.REPLY_TO_EMAIL` with `site.fromEmail` / `site.replyToEmail`. `SENDGRID_KEY` and `FROM_NAME` come from `GLOBAL`.

**`buildIntakeUrl` / `buildInspectUrl`** — no longer need a site parameter. All form base URLs and entry IDs are in `GLOBAL`. Andrew's Site dropdown on the form handles location tagging; the script does not need to pass it.

**`sendLeaseViaDocuSeal(name, email, secondEmail, dateStr, site)`** — template IDs and `DOCUSEAL_KEY` come from `GLOBAL`; only `MANAGER_EMAIL` comes from `site`.

**Engine functions** (`syncCalendarBookings`, `checkRentalEligibility`, `sendLeaseToNewBookings`, `processReminders`) — each gains a `site` parameter replacing all `CONFIG.*` references. Trigger wrappers call `SITES.forEach(site => fn(site))`. Existing trigger function names are preserved so `setupTriggers()` needs no change.

**`getSheet(site)`** — looks up `site.sheetName` instead of `CONFIG.SHEET_NAME`.

**`alertAdmin`** — no change; `ADMIN_EMAIL` is global.

**`doPost`** — see section 4.

---

### 3. Pipedream — Webhook Bridge

All external webhook events are routed through Pipedream before reaching Apps Script. Apps Script `doPost` never receives raw Stripe or DocuSeal/Dropbox Sign payloads directly.

**Three active Pipedream workflows:**

| Workflow | Trigger | What Pipedream does | Payload POSTed to Apps Script |
|---|---|---|---|
| Stripe Connection to Google App | HTTP / Stripe-related payload | Extracts `customerEmail` and `amountPaid` | `{ "customerEmail": "...", "amountPaid": "..." }` |
| DocuSeal Workflow | HTTP / DocuSeal | Filters to completed events only; ignores manager signing role; extracts `signerEmail` | `{ "type": "lease_signed", "signerEmail": "..." }` |
| Dropbox Sign → Google App | HTTP / Dropbox Sign | Filters to signature events; extracts `signerEmail` | `{ "type": "lease_signed", "signerEmail": "..." }` |

**Apps Script `doPost` must remain compatible with these three payload shapes.** Do not change the field names `customerEmail`, `amountPaid`, `type`, or `signerEmail`.

### 4. `doPost` — Webhook Routing

Because Pipedream normalises all three event sources into the same two payload shapes, `doPost` routing logic is straightforward. The only routing problem is which site's sheet to update, because the payloads carry no site identifier.

**Milestone 1:** Search all `SITES` sheets for a row whose email column matches the incoming email. Process the first match and log the matched site ID. This is safe for nearly all real-world cases. The known edge case — same customer email at two sites simultaneously with an unpaid deposit — is accepted as a Milestone 1 constraint and must be documented in the code.

**v9 fix:** Update each Pipedream workflow to append `siteId` and `eventId` to its outbound payload before POSTing to Apps Script. This requires no structural change to the workflows — only an extra field in the final POST step. `doPost` can then read `data.siteId` and route directly to the correct site's sheet without any cross-sheet search.

---

### 5. Migration Strategy

**Step 1 — Branch.** Create `refactor/multi-site` from `main`. Never modify `main`, `archive/v7-original.js`, or the live production script during this phase.

**Step 2 — Sandbox setup.** Create a copy of the production spreadsheet. Create a test Google Calendar. Create a separate Apps Script project bound to the sandbox spreadsheet. Set sandbox Script Properties with test credentials (or real credentials where safe, such as a Stripe test-mode key).

**Step 3 — Single-site SITES refactor in sandbox.** Replace `CONFIG` with `GLOBAL` + a single-entry `SITES` array pointing to sandbox resources. Refactor all functions as described in section 2. With one site the `forEach` loop is behaviorally identical to the current `CONFIG` pattern.

**Step 4 — Bainbridge parity test in sandbox.** Run the full test checklist from `docs/testing-plan.md` against the refactored sandbox. All 8 tests must pass. Column O must never be written by the script. P/Q approval reminder behavior must be identical to v7.

**Step 5 — Production cutover.** Only after sandbox parity is confirmed: paste the refactored code into the live Apps Script project, update Script Properties to use the `BAINBRIDGE_*` prefix convention. The live `Bookings` tab name does not change at this step — `SITES[0].sheetName` is simply `'Bookings'`.

**Step 6 — Add second site.** Add a second entry to `SITES`, provision its Script Properties, create its sheet tab, and run its calendar and webhook integrations. Test in isolation. Rename the Bainbridge tab to `Bookings - Bainbridge` and the new tab to `Bookings - {Site2}` only after both sites are confirmed stable, so sheet-name changes are a single coordinated event.

---

### 6. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **`doPost` email collision**: same email at two sites simultaneously | Medium | Log matched site; accept as known limitation until Stripe Checkout Session metadata is implemented in v9 |
| **Apps Script 6-minute limit**: `forEach` over N sites multiplies trigger execution time | Medium | Prune stale rows (skip rows with rental end > 90 days ago); monitor execution time after adding site 2 |
| **Script Properties flat namespace**: typo in `BAINBRIDGE_` prefix causes silent `undefined` | Low–Medium | Add a startup validation loop that logs any site property that resolves to `undefined` before the engines run |
| **Form shared-form assumption**: if Andrew decides inspection forms must differ by site, `buildInspectUrl` needs to be revisited | Low | Confirm with Andrew before Milestone 2 begins |
| **`processReminders` script-wide lock**: sequential per-site processing is fine; lock timeout is 10 s, so one slow site delays the next | Low | Accept for Milestone 1; per-site lock keys are a Milestone 2 option if execution time becomes an issue |

---

### 7. Testing Gates

**Gate 1 — Sandbox parity (blocks everything else)**
All 8 tests in `docs/testing-plan.md` pass against refactored single-site sandbox code. `site.fromEmail` and `site.twilioFrom` appear correctly in outbound messages. Column O is never written.

**Gate 2 — Site isolation**
Add a sandbox second-site entry. A test booking on site 2's calendar appears only in site 2's sheet. A Stripe payment for site 2's customer updates only site 2's row.

**Gate 3 — Webhook cross-site search**
Stripe payment for email found in site 1 only → updates site 1. Payment for email found in site 2 only → updates site 2. Payment for unknown email → admin alert, no crash. Two-site same-email collision → first-match behavior logged and documented.

**Gate 4 — Production cutover smoke test**
After Step 5, manually trigger `syncCalendarBookings` and confirm it reads from `BAINBRIDGE_CALENDAR_ID` and writes to the `Bookings` tab exactly as before. Use a controlled test booking only, because `syncCalendarBookings` sends customer-facing welcome SMS/email when it detects a new event.

**Rollback.** `archive/v7-original.js` is the recovery baseline. Paste it back into the live script, restore original Script Properties keys. Recovery time: ~5 minutes.
