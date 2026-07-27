## Multi-Site Architecture Proposal — Reliable Storage Vehicle Rental Automation (Revised)

> **⚠ Historical document.** This is the original multi-site design proposal. The implementation
> that actually landed on `main` took a different, simpler path than what's described below: a
> single `CALENDAR_CONFIGS` array (not separate `GLOBAL`/`SITES` objects), one shared `Bookings`
> sheet with Location/Vehicle Type columns (not per-site sheet tabs), and one global set of
> triggers (not per-site wrapper functions like `syncCalendarBookings_Bainbridge`). `Forms.js`'s
> `buildIntakeUrl`/`buildInspectUrl` also do not take a `site` parameter or use a Site dropdown
> entry ID, unlike what section 2 proposes. Retained for historical context on the design
> alternatives considered. For the current architecture, see **README.md** and
> **docs/setup-notes.md**.
>
> **The `archive/` directory referenced throughout this document (`archive/v7-original.js`,
> `archive/current-production-from-andrew.js`) has been deleted from this repository.** Any
> instruction below that references pulling from or saving to `archive/` is no longer actionable
> and is retained only as a historical record of the process used at the time.

**Working branch:** `main`
**Baseline:** Pull Andrew's latest script from the shared Google Drive folder and update `src/Code.js` before beginning any implementation. `archive/v7-original.js` is the old v7 baseline only. Save the Andrew-uploaded version as `archive/current-production-from-andrew.js` before refactoring. Do not implement from stale code.

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
| `INTAKE_FORM_BASE`, standard entry IDs, `INTAKE_ENTRY_SITE` | Shared form; `INTAKE_ENTRY_SITE` is the entry ID for the Site dropdown added by Andrew |
| `INSPECT_FORM_BASE`, standard entry IDs, `INSPECT_ENTRY_SITE` | Same — shared inspection form with a Site dropdown |
| `WEBHOOK_SHARED_SECRET` | Shared secret validating Pipedream → Apps Script requests; see section 3 |
| `BITLY_TOKEN` | One shortener account |
| `DAYS_AHEAD`, `POST_RENTAL_HOURS`, `HOURS_BETWEEN_APPROVAL_REMINDERS`, `MAX_APPROVAL_REMINDERS` | Policy constants, uniform |

**`SITES` array** — one entry per location:

| Key | Rationale |
|---|---|
| `id`, `label` | Internal identifier (`'bainbridge'`) and human-readable label; `label` must exactly match the Site dropdown option text in the Google Form |
| `sheetName` | One tab per site (e.g., `'Bookings'`, `'Bookings - Poulsbo'`) |
| `calendarId` | Each site has its own booking calendar |
| `managerEmail`, `managerPhone` | Each site has its own manager |
| `fromEmail` | Site-specific sending address (e.g., `site@example.com`) |
| `replyToEmail` | Site-specific reply address |
| `twilioFrom` | Site-specific Twilio sending number |

```javascript
const SITES = [
  {
    id:           'bainbridge',
    label:        'Bainbridge',       // must match the Google Form Site dropdown option exactly
    sheetName:    'Bookings',
    calendarId:   PROPS.BAINBRIDGE_CALENDAR_ID,
    managerEmail: 'site@example.com',
    managerPhone: '+12065550100',
    fromEmail:    'site@example.com',
    replyToEmail: 'site@example.com',
    twilioFrom:   '+12065550111',
  },
  // { id: 'poulsbo', label: 'Poulsbo', ... }
];
```

Script Properties follow the pattern `{SITE_ID}_{KEY}` for site-specific values; global keys are unprefixed.

---

### 2. Functions Requiring Refactoring

**`sendSms(toPhone, message, site)`** — replace `CONFIG.TWILIO_NUM` with `site.twilioFrom`. `TWILIO_SID` and `TWILIO_TOKEN` come from `GLOBAL`.

**`sendEmailHtml(toEmail, subject, htmlBody, site)`** — replace `CONFIG.FROM_EMAIL` / `CONFIG.REPLY_TO_EMAIL` with `site.fromEmail` / `site.replyToEmail`. `SENDGRID_KEY` and `FROM_NAME` come from `GLOBAL`.

**`buildIntakeUrl(name, email, phone, rentalDate, site)`** — needs a `site` parameter. The shared form has a Site dropdown; the pre-filled URL must append `&entry.<INTAKE_ENTRY_SITE>=<site.label>` so the customer's location is pre-selected. `site.label` must exactly match the dropdown option text in the Google Form.

**`buildInspectUrl(name, email, rentalDate, type, site)`** — same requirement. Append `&entry.<INSPECT_ENTRY_SITE>=<site.label>` to pre-select the location.

**`sendLeaseViaDocuSeal(name, email, secondEmail, dateStr, site)`** — template IDs and `DOCUSEAL_KEY` come from `GLOBAL`; only `MANAGER_EMAIL` comes from `site`.

**Engine functions** (`syncCalendarBookings`, `checkRentalEligibility`, `sendLeaseToNewBookings`, `processReminders`) — each gains a `site` parameter replacing all `CONFIG.*` references. See trigger wrapper design below.

**`getSheet(site)`** — looks up `site.sheetName` instead of `CONFIG.SHEET_NAME`.

**`alertAdmin`** — no change; `ADMIN_EMAIL` is global.

**`doPost`** — see section 4.

#### Trigger wrapper design (per-site functions)

Apps Script triggers cannot accept arguments, so a single `SITES.forEach(site => fn(site))` inside one trigger function is not the design. Instead, each site gets its own named wrapper functions, each registered as a separate trigger with its own 6-minute execution budget. A slow API response or large booking history at one site cannot delay or block another site.

```javascript
// Bainbridge wrappers
function syncCalendarBookings_Bainbridge()   { syncCalendarBookingsForSite(getSiteById('bainbridge')); }
function checkRentalEligibility_Bainbridge() { checkRentalEligibilityForSite(getSiteById('bainbridge')); }
function sendLeaseToNewBookings_Bainbridge() { sendLeaseToNewBookingsForSite(getSiteById('bainbridge')); }
function processReminders_Bainbridge()       { processRemindersForSite(getSiteById('bainbridge')); }

// Second site wrappers (example — Poulsbo)
function syncCalendarBookings_Poulsbo()      { syncCalendarBookingsForSite(getSiteById('poulsbo')); }
function checkRentalEligibility_Poulsbo()    { checkRentalEligibilityForSite(getSiteById('poulsbo')); }
function sendLeaseToNewBookings_Poulsbo()    { sendLeaseToNewBookingsForSite(getSiteById('poulsbo')); }
function processReminders_Poulsbo()          { processRemindersForSite(getSiteById('poulsbo')); }
```

`setupTriggers()` registers each wrapper function on its own schedule. Each invocation is fully independent.

#### `processReminders` locking

The current single `LockService.getScriptLock()` is appropriate for a single deployment. With per-site trigger wrappers running independently, a global lock would serialize all sites unnecessarily and defeat the isolation benefit. Each per-site trigger runs in its own execution context so standard `getScriptLock()` calls within each wrapper do not contend with other sites. If the same site's trigger fires again before the previous run finishes (rare but possible for the 5-minute triggers), the existing lock timeout behavior handles it correctly. Document this constraint rather than over-engineering a per-site lock key for Milestone 1.

---

### 3. Pipedream — Webhook Bridge

All external webhook events are routed through Pipedream before reaching Apps Script. Apps Script `doPost` never receives raw Stripe or DocuSeal payloads directly.

**DocuSeal is the active signature provider.** Dropbox Sign is not part of the current or forward architecture. Any Dropbox Sign Pipedream workflows visible in historical screenshots are legacy and should be ignored.

**Two active Pipedream workflows:**

| Workflow | Trigger | What Pipedream does | Payload POSTed to Apps Script |
|---|---|---|---|
| Stripe Connection to Google App | HTTP / Stripe-related payload | Validates Stripe signature where possible; extracts `customerEmail` and `amountPaid`; adds `secret` | `{ "secret": "...", "customerEmail": "...", "amountPaid": "..." }` |
| DocuSeal Workflow | HTTP / DocuSeal | Validates DocuSeal request where possible; filters to completed events; ignores manager signing role; extracts `signerEmail`; adds `secret` | `{ "secret": "...", "type": "lease_signed", "signerEmail": "..." }` |

**Shared secret:** Each Pipedream workflow must include `WEBHOOK_SHARED_SECRET` as the `"secret"` field in its POST body before forwarding to Apps Script. Store the value in each Pipedream workflow's environment variables. It must match `WEBHOOK_SHARED_SECRET` in Apps Script Script Properties exactly.

Pipedream should also validate the upstream signature (Stripe webhook signature header, DocuSeal HMAC or token) before forwarding. This gives two independent layers of trust: upstream authenticity checked by Pipedream, shared secret checked by Apps Script.

**Apps Script `doPost` must remain compatible with these payload shapes.** Do not change the field names `secret`, `customerEmail`, `amountPaid`, `type`, or `signerEmail`.

---

### 4. `doPost` — Security and Routing

#### Security check (first thing in `doPost`)

`doPost` must verify `data.secret` before performing any sheet reads, row updates, emails, SMS, DocuSeal submissions, or other side effects. If the secret is absent or does not match `GLOBAL.WEBHOOK_SHARED_SECRET`, `doPost` logs the rejection and returns `{ received: true }` with a `200` status — this avoids Pipedream retry storms for what is a permanent auth failure. No other action is taken.

```
1. Parse JSON body
2. If data.secret !== GLOBAL.WEBHOOK_SHARED_SECRET → log rejection, return 200, stop
3. If data.type === 'lease_signed' → markLeaseSigned(data.signerEmail, site)
4. Else → markDepositPaid(data.customerEmail, data.amountPaid, site)
```

The endpoint is deployed as "Anyone" (required for Pipedream to reach it), but the shared secret means arbitrary POST requests have no effect on any data.

#### Site routing

Payloads carry no site identifier. **Milestone 1:** Search all `SITES` sheets in order for a row whose email column matches the incoming email. Process the first match and log the matched site ID. The known edge case — same customer email at two sites simultaneously with an unpaid deposit — is accepted as a Milestone 1 constraint and documented in the code.

**v9 fix:** Update each Pipedream workflow to append `siteId` and `eventId` to the outbound payload. No structural workflow change required — only an extra field in the final POST step. `doPost` can then read `data.siteId` and route directly to the correct site without any cross-sheet search.

---

### 5. Migration Strategy

**Working directly on `main`.**

**Step 0 — Sync production code.** Pull Andrew's latest script from the shared Google Drive folder. Save it as `archive/current-production-from-andrew.js`. Replace `src/Code.js` with this version. `archive/v7-original.js` is preserved as the old baseline but must not be used as the implementation starting point.

**Step 1 — Sandbox setup.** Create a copy of the production spreadsheet. Create a test Google Calendar. Create a separate Apps Script project bound to the sandbox spreadsheet. Set sandbox Script Properties with test credentials (Stripe test-mode key, DocuSeal sandbox or separate test account, test Twilio number). Generate a test `WEBHOOK_SHARED_SECRET` for the sandbox.

**Step 2 — Single-site SITES refactor in sandbox.** Replace `CONFIG` with `GLOBAL` + a single-entry `SITES` array. Refactor all functions per section 2. Register per-site trigger wrappers for Bainbridge only. Add `WEBHOOK_SHARED_SECRET` to Script Properties and to the Pipedream sandbox workflow. Verify `doPost` rejects requests missing or with wrong secret before touching any sheet.

**Step 3 — Bainbridge parity test in sandbox.** Run the full test checklist from `docs/testing-plan.md`. All 8 tests must pass. Pre-filled intake and inspection URLs must contain the correct Site dropdown value. Column O must never be written. Authorized Pipedream payloads succeed; unauthorized POST requests are rejected silently.

**Step 4 — Production cutover.** After sandbox parity is confirmed: paste refactored code into the live Apps Script project. Update Script Properties to the `BAINBRIDGE_*` prefix convention. Add the real `WEBHOOK_SHARED_SECRET`. Update both live Pipedream workflows with the same secret. The live `Bookings` tab name does not change at this step.

**Step 5 — Add second site.** Add a second `SITES` entry, register its per-site trigger wrappers in `setupTriggers()`, provision its Script Properties, create its sheet tab. Confirm the Google Form Site dropdown includes the new site label. Rename tabs to `Bookings - Bainbridge` and `Bookings - Poulsbo` only after both sites are confirmed stable.

---

### 6. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **`doPost` unauthorized POST**: endpoint is open to the internet | Mitigated | Shared secret check at the very top of `doPost`; no side effects on failure |
| **`doPost` email collision**: same email at two sites simultaneously | Medium | Log matched site; accept as Milestone 1 constraint; resolved in v9 by adding `siteId` to Pipedream payloads |
| **`site.label` / form dropdown mismatch**: pre-filled URL sends wrong site value if label doesn't exactly match form option | Low–Medium | Document the exact dropdown option strings in setup-notes; validate in Gate 1 |
| **`archive/v7-original.js` used as implementation baseline**: it is not the current production version | High if ignored | Always start from `archive/current-production-from-andrew.js`; Step 0 is mandatory |
| **Script Properties flat namespace**: typo in `BAINBRIDGE_` prefix causes silent `undefined` | Low–Medium | Add startup validation that logs any site property resolving to `undefined` before engines run |
| **`WEBHOOK_SHARED_SECRET` rotation**: if the secret must be rotated, Pipedream workflows and Apps Script must update simultaneously | Low | Do not rotate during business hours; update Pipedream first, then Apps Script within seconds |

---

### 7. Testing Gates

**Gate 1 — Sandbox parity (blocks everything else)**
All 8 tests in `docs/testing-plan.md` pass against the refactored sandbox code. `site.fromEmail` and `site.twilioFrom` appear correctly in outbound messages. Pre-filled intake and inspection URLs contain the correct Site dropdown value for Bainbridge. Column O is never written.

**Gate 2 — Webhook security**
POST with no `secret` → logged, `{ received: true }` returned, zero side effects (no sheet changes, no emails, no SMS). POST with wrong `secret` → same. POST with correct `secret` and valid Stripe payload → deposit marked, lease sent. POST with correct `secret` and valid DocuSeal `lease_signed` payload → lease signed marked.

**Gate 3 — Site isolation**
Add a sandbox second-site entry. A test booking on site 2's calendar appears only in site 2's sheet. A Stripe payment for site 2's customer updates only site 2's row. Pre-filled form URL contains site 2's label.

**Gate 4 — Webhook cross-site search**
Authorized Stripe payment for email in site 1 only → updates site 1. Authorized payment for email in site 2 only → updates site 2. Authorized payment for unknown email → admin alert, no crash. Two-site same-email collision → first-match behavior logged and documented.

**Gate 5 — Production cutover smoke test**
After Step 4, manually trigger `syncCalendarBookings_Bainbridge` and confirm it reads from `BAINBRIDGE_CALENDAR_ID` and writes to the `Bookings` tab exactly as before. Use a controlled test booking only, because `syncCalendarBookings` sends customer-facing welcome SMS/email when it detects a new event.

**Rollback.** `archive/current-production-from-andrew.js` is the production baseline. Paste it back into the live script and restore original Script Properties. Recovery time: ~5 minutes.
