# Production Rollout Plan — Reliable Storage Vehicle Rental Automation

**Status: not yet started.** This repository is currently validated only in a sandbox
environment — see [README.md "Repository status"](../README.md#repository-status) and
[docs/testing-plan.md](testing-plan.md) for exactly what has and has not been confirmed. This
document describes the plan for moving from sandbox validation to a live production deployment.
It does not describe work that has already happened.

---

## 1. Sandbox vs. production — what is actually separate

| Resource | Sandbox | Production | Shared? |
|---|---|---|---|
| Apps Script project | Separate project | Separate project | No — entirely separate projects, each with its own Script Properties |
| Google Sheet (Bookings + form response tabs) | Sandbox spreadsheet | Production spreadsheet | No |
| Google Calendar(s) | Test calendar(s) | Real booking calendar(s) | No |
| Google Forms (intake, inspection) | May reuse production forms, or use test copies | Production forms | Decide before rollout — see §3 |
| Stripe | Test mode keys and Price IDs | Live mode keys and Price IDs | No |
| DocuSeal | Test/sandbox templates | Production templates | No |
| Twilio | Same account acceptable; restrict test numbers | Same account | Credentials can be shared; behavior (who receives messages) must not overlap |
| SendGrid | Same account acceptable | Same account | Credentials can be shared |
| Pipedream workflows | Separate duplicated workflows pointing at the sandbox deployment URL | Original workflows pointing at the production deployment URL | No — must point at different URLs and use different secrets |
| `WEBHOOK_SHARED_SECRET` | Sandbox-only value | Production-only value | **Must be different** |
| Source code (`src/*.js`) | Identical | Identical | **Yes** — this is the one thing that should never differ between environments |

The only thing that should ever be identical between sandbox and production is the source code
itself. Every credential, ID, and URL is environment-specific.

---

## 2. Pre-rollout checklist

All of the following must be true before starting the cutover in §4:

- [ ] Every item in the "Validated" table in [docs/testing-plan.md](testing-plan.md) is confirmed
- [ ] Every item in the "Still awaiting final operational validation" table in
      [docs/testing-plan.md](testing-plan.md) has been exercised at least once (Tests 7–10, using
      either real elapsed time or the manual time-shift technique described there) and passed
- [ ] Cancellation, reschedule, and per-location DocuSeal manager signer (Tests 15–17 in
      [docs/testing-plan.md](testing-plan.md)) have each been exercised live in the sandbox and
      passed — development-time Node/GAS-shim testing alone does not satisfy this
- [ ] `runAllSandboxConfigurationTests()` passes with no failures in the sandbox project
- [ ] The known limitations in [README.md §21](../README.md#21-known-limitations-and-future-work)
      have been reviewed and explicitly accepted as acceptable for initial production rollout, or
      addressed — in particular the lease-sending race condition and the webhook first-match-wins
      ambiguity risk, since both involve real customer-facing side effects (duplicate leases,
      wrong-row payment matching)
- [ ] A rollback plan (§6) is understood by whoever is performing the cutover

Do not proceed to §4 with unchecked items above.

---

## 3. Decisions to make before cutover

These are business/operational decisions, not code changes — resolve them before migrating:

1. **Will production reuse the sandbox's Google Forms, or use fresh copies?** Reusing the same
   forms means sandbox test submissions and real customer submissions land in the same response
   tabs. If this is undesirable, create fresh copies of both forms for production and update
   `INTAKE_FORM_BASE`/`INSPECT_FORM_BASE` and all `*_ENTRY_*` properties accordingly — and confirm
   the response tab names still match `INTAKE_RESPONSE_SHEET_NAME`/`INSPECT_RESPONSE_SHEET_NAME`
   in `src/Forms.js` (`'Rental Intake Form'` / `'Rental Vehicle Condition Inspection Form'`), or
   update those constants if the production tabs are named differently.
2. **DocuSeal templates:** confirm production template IDs and role names (`Driver #1`,
   `Driver #2`, `Reliable Storage Manager`) match exactly what `sendLeaseViaDocuSeal` sends. The
   Pipedream DocuSeal workflow's signing-completion step also hardcodes the sandbox template IDs
   (`5142370` one-driver, `4482457` two-driver, see `docs/setup-notes.md`'s "Deployed Pipedream
   code") directly in its JavaScript — these two literals must be updated to the production
   template IDs in that Pipedream step, not just in Script Properties, or the step will throw
   `Unknown DocuSeal template ID` for every production signing event.
3. **Stripe mode:** confirm live-mode Price IDs exist for both vehicle types and match the real
   deposit amounts.
4. **Manager/admin recipients:** confirm `MANAGER_EMAIL`, `MANAGER_PHONE`, `ADMIN_EMAIL`, and the
   per-location `EMAIL_<LOCATION>`/`PHONE_<LOCATION>` values are the real production addresses and
   numbers, not sandbox test values. **`EMAIL_<LOCATION>` is also the DocuSeal manager co-signer
   destination for that location** — there is no separate manager-email property — so confirm each
   `EMAIL_<LOCATION>` is the address that should actually be signing leases at that location, not
   just an address that looks right for outbound customer mail.
5. **Site-tab formulas:** if the production spreadsheet has manually-maintained per-location
   `QUERY`/`FILTER` tabs (see [README §6 "Location tabs and QUERY
   formulas"](../README.md#location-tabs-and-query-formulas)), confirm they reference **column T**
   (Location), not column S (Vehicle Type) or any other column — this must be checked independently
   in the production spreadsheet even if it was already fixed in sandbox, since each environment
   has its own separate Sheet and tabs.

---

## 4. Migration steps

1. **Create the production Apps Script project**, bound to the production Google Sheet (or create
   the production Sheet first, then Extensions → Apps Script from it).
2. **Deploy source code** — `clasp push` (pointed at the production project) or paste each
   `src/*.js` file manually. All 13 files must be present (including `CancelReschedule.js`).
3. **Set all Script Properties** in the production project per
   [docs/setup-notes.md](setup-notes.md) and [README.md §8](../README.md#8-script-properties-reference),
   using production values resolved in §3 above — never copy sandbox values wholesale.
4. **Run `validateConfig()`** from the editor — confirm no missing/invalid numeric properties.
5. **Run `testSheetConnection()` and `testCalendarConfigs()`** — confirm the production Sheet and
   calendars are reachable.
6. **Run `setupTriggers()`** — creates all five triggers and applies sheet schema (M/N headers,
   column S/T dropdowns, V/W/X/Y/Z headers, and AA/AB/AC headers for cancellation/reschedule).
7. **Confirm column P has manual dropdown validation** (`Approved - Free` / `Approved - Paid` /
   `Denied`) — this is not created automatically by `setupSheetSchema()`.
8. **Deploy as a Web App** (Deploy → New deployment → Web app; Execute as: Me; Who has access:
   Anyone). Copy the deployment URL.
9. **Point production Pipedream workflows** at the new production deployment URL, with the
   production `WEBHOOK_SHARED_SECRET`. Confirm sandbox Pipedream workflows are untouched and still
   point at the sandbox deployment URL.
10. **Configure the live Stripe webhook** to point at the production Pipedream Stripe workflow
    URL. Configure the live DocuSeal webhook similarly.
11. **Test unauthorized POST** against the production URL — expect `{"received":false}` and zero
    side effects.
12. **First production booking verification** — see §5. Do not consider the rollout complete until
    this passes.

---

## 5. First-production-booking verification

Before letting the automation run unattended in production, run one real (or tightly controlled
test) booking through the entire flow, watching the Executions log at each step:

1. Create one booking on a production calendar — ideally using a real staff member's own contact
   info rather than a customer's, so any issue only affects an internal test.
2. Confirm the row appears correctly and the welcome message is delivered (Test 1 in
   [docs/testing-plan.md](testing-plan.md)).
3. Submit the intake form (Test 2).
4. Complete the deposit via a real (small) live-mode payment or a controlled live-mode test
   transaction if your Stripe account allows it (Test 4).
5. Sign the lease (Test 5).
6. Confirm the manager approval flow and customer approval gating behave correctly (Tests 3 and 6)
   — this is the highest-value thing to watch closely, since it's the most recently changed logic.
7. If feasible, wait for or manually time-shift through the pre-trip window and the one-hour
   post-trip delay to confirm Tests 7–10 also succeed in production, not just sandbox — these are
   the items still marked "not yet validated" as of this writing, and passing them in sandbox does
   not guarantee an identical production `HOURS_BETWEEN_APPROVAL_REMINDERS` value produces the same
   approval-reminder timing. (`POST_RENTAL_HOURS` has been removed entirely and no longer affects
   post-trip reminder timing — see [docs/testing-plan.md](testing-plan.md) Test 9.)
8. Confirm the lease's `Reliable Storage Manager` submitter uses that booking's location's own
   `EMAIL_<LOCATION>` value, not a shared or global address (Test 17).
9. If feasible, exercise a real cancellation (delete the test booking's calendar event, or type a
   value into column AA) and a real reschedule (edit the test booking's calendar time) to confirm
   Tests 15–16 also succeed against the production Sheet and Calendar.
10. Only after this full pass succeeds should real customer bookings be allowed to flow through
    unattended.

---

## 6. Rollback considerations

- **Source code rollback:** `clasp push` (or paste) the previous known-good version of `src/*.js`.
  Git history in this repository is the source of truth for what "previous known-good" means —
  confirm the commit to roll back to before pushing.
- **Trigger rollback:** re-run `setupTriggers()` after rolling back source code if the trigger
  architecture itself changed between versions (new/removed/rescheduled triggers) — not needed for
  an ordinary logic-only rollback.
- **Web app deployment rollback:** if `Webhooks.js` was part of the change being rolled back,
  create a new deployment version from the rolled-back source (Deploy → Manage deployments → New
  version) — the deployment URL itself does not change, so no Pipedream update is needed.
- **Data rollback:** this system does not delete data — a bad deploy that wrote incorrect column
  values must be corrected by hand in the Sheet (or via a one-off script), not by any automated
  rollback mechanism. There is currently no automated backup/versioning of the Bookings sheet
  beyond Google Sheets' own built-in version history (File → Version history).
- **Never roll back by disabling triggers and leaving the system half-migrated** — either fully
  roll back (old code + old triggers) or fully proceed; a mixed state is harder to reason about
  than either endpoint.

---

## 7. After rollout

- Keep the sandbox environment. It remains the correct place to test any future change before it
  reaches production — see [docs/setup-notes.md](setup-notes.md) and
  [README.md §14](../README.md#14-sandbox-environment).
- Update [docs/testing-plan.md](testing-plan.md)'s validation-status tables once production
  operation confirms behavior that sandbox alone could not (e.g. real-world timing of the 24-hour
  and post-rental reminders under production Script Property values).
- Review [docs/operations-runbook.md](operations-runbook.md) with whoever will be operating the
  system day-to-day.

### Manager training / handoff

Before location managers start relying on the production system, walk them through
[docs/manager-guide.md](manager-guide.md) — the nontechnical guide covering what managers need to
do, what the system does automatically, what every Bookings sheet column means, and when to
escalate to the system administrator. It intentionally contains no source code, Apps Script,
Git/clasp, or Pipedream detail, so it's safe to hand to non-technical staff on its own. Its
[Current Rollout Status](manager-guide.md#17-current-rollout-status) section should be updated in
step with [docs/testing-plan.md](testing-plan.md) as validation progresses.
