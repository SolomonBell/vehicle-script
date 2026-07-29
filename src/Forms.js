// ============================================================
// PRE-FILLED URL BUILDERS
// ============================================================
function buildIntakeUrl(name, email, phone, rentalDate) {
  const base = CONFIG.INTAKE_FORM_BASE;
  // Use MM/DD/YYYY format which Google Forms date fields expect
  const date = formatDateForForm(rentalDate);
  return base
    + '?usp=pp_url'
    + '&entry.' + CONFIG.INTAKE_ENTRY_NAME  + '=' + encodeURIComponent(name)
    + '&entry.' + CONFIG.INTAKE_ENTRY_EMAIL + '=' + encodeURIComponent(email)
    + '&entry.' + CONFIG.INTAKE_ENTRY_PHONE + '=' + encodeURIComponent(phone)
    + '&entry.' + CONFIG.INTAKE_ENTRY_DATE  + '=' + encodeURIComponent(date);
}

function buildInspectUrl(name, email, rentalDate, type) {
  const base    = CONFIG.INSPECT_FORM_BASE;
  const date    = formatDate(rentalDate);
  const typeVal = type === 'pre' ? CONFIG.INSPECT_VAL_PRE : CONFIG.INSPECT_VAL_POST;
  return base
    + '?usp=pp_url'
    + '&entry.' + CONFIG.INSPECT_ENTRY_NAME  + '=' + encodeURIComponent(name)
    + '&entry.' + CONFIG.INSPECT_ENTRY_EMAIL + '=' + encodeURIComponent(email)
    + '&entry.' + CONFIG.INSPECT_ENTRY_DATE  + '=' + encodeURIComponent(date)
    + '&entry.' + CONFIG.INSPECT_ENTRY_TYPE  + '=' + encodeURIComponent(typeVal);
}

// Pure row-matching logic for onIntakeFormSubmit(), separated out so it can
// be unit-tested with synthetic data (no sheet reads, no live form event).
//
// Matches on email (case-insensitive) plus, when available, the pre-filled
// rental date -- narrowing a repeat customer's simultaneous incomplete
// bookings down to the one they actually just submitted intake for. The
// form does not currently carry Event ID or any other unique booking
// reference (see the note above onIntakeFormSubmit), so this is the
// strongest match available without a Google Form change.
//
// dateStr, when provided, must already be in 'yyyy-MM-dd' form (the same
// format formatDateForForm() uses to pre-fill the date field). Pass null to
// skip date narrowing entirely.
//
// NEVER guesses. Returns one of three outcomes as { status, row, precision }:
//   'matched'    -- row is the single unambiguous 0-based row index to update.
//   'ambiguous'  -- two or more eligible (not-yet-complete) rows share this
//                   email and could not be told apart. row is -1. Caller
//                   must update nothing.
//   'not_found'  -- no eligible row has this email at all. row is -1.
//
// Already-completed rows (column V = 'Yes') are never eligible, so they can
// never cause -- or block -- a match. Matching never considers column B
// (customer name).
//
// Algorithm:
//   1. Collect every row with this email that is not yet complete.
//   2. If zero such rows exist -> not_found.
//   3. If a date was supplied, narrow that set to rows whose rental date
//      matches it. Exactly one match -> matched. Two or more -> ambiguous
//      (same email AND same date on multiple incomplete bookings). Zero ->
//      fall through to step 4 (the date didn't help, not that it failed).
//   4. Controlled email-only fallback: allowed ONLY when exactly one
//      eligible row exists for the email overall. Two or more -> ambiguous.
function findIntakeMatchRow(data, email, dateStr) {
  const eligible = [];
  for (let i = 1; i < data.length; i++) {
    const rowEmail    = (data[i][2] || '').toLowerCase().trim(); // C: Email
    const alreadyDone = data[i][21];                              // V: Intake Form Completed
    if (rowEmail === email && alreadyDone !== 'Yes') eligible.push(i);
  }

  if (eligible.length === 0) {
    return { status: 'not_found', row: -1, precision: null };
  }

  if (dateStr) {
    const dateMatches = eligible.filter(function(i) {
      return formatDateForForm(new Date(data[i][4])) === dateStr; // E: Start Time
    });
    if (dateMatches.length === 1) {
      return { status: 'matched', row: dateMatches[0], precision: 'email+date' };
    }
    if (dateMatches.length > 1) {
      return { status: 'ambiguous', row: -1, precision: null };
    }
    // dateMatches.length === 0: the date didn't narrow anything down (wrong
    // or edited date, or none of the eligible rows share it) -- fall
    // through to the controlled email-only fallback below.
  }

  if (eligible.length === 1) {
    return { status: 'matched', row: eligible[0], precision: 'email-only' };
  }

  // Two or more eligible rows share this email and the date (if any) did
  // not disambiguate them. Do not guess which one the customer meant.
  return { status: 'ambiguous', row: -1, precision: null };
}

// Exact Google Form question titles, verified live against the sandbox
// intake response sheet's header row -- these are also the exact keys
// e.namedValues uses on a spreadsheet form-submit event, since Google
// Forms writes the question title as the response sheet's column header.
// If the live form's questions are ever retitled, these must be updated to
// match, or onIntakeFormSubmit() will safely find nothing and process
// nothing rather than silently reading the wrong field.
const INTAKE_RESPONSE_EMAIL_QUESTION_TITLE = 'Email Address';
const INTAKE_RESPONSE_DATE_QUESTION_TITLE  = 'Rental Date';

// Tab name of the linked intake-form response sheet, within the SAME
// spreadsheet as Bookings -- verified live against the sandbox project.
// Used only as a safety check so this handler ignores submissions from any
// other form that might get linked to this spreadsheet later -- isolated
// here in one constant rather than scattered through the function. Update
// this if the response tab is ever renamed.
const INTAKE_RESPONSE_SHEET_NAME = 'Rental Intake Form';

// Pure extraction of the fields onIntakeFormSubmit() needs from a
// spreadsheet form-submit event object -- separated out so it can be
// unit-tested with a synthetic event (no sheet reads, no live trigger).
//
// Returns { email, date } on success (date is null if it was blank or
// unparseable -- findIntakeMatchRow() handles that safely via its
// email-only fallback), or null if:
//   - the event object doesn't look like a spreadsheet form-submit event
//     (missing e.range or e.namedValues), or
//   - the submission is from a sheet other than INTAKE_RESPONSE_SHEET_NAME
//     (e.g. a different form linked to the same spreadsheet), or
//   - no email answer was found under INTAKE_RESPONSE_EMAIL_QUESTION_TITLE.
// A null return means "process nothing" -- the caller must not guess.
function extractIntakeSubmissionFields(e) {
  if (!e || !e.range || !e.namedValues) return null;

  const sourceSheetName = e.range.getSheet().getName();
  if (sourceSheetName !== INTAKE_RESPONSE_SHEET_NAME) return null;

  const emailValues = e.namedValues[INTAKE_RESPONSE_EMAIL_QUESTION_TITLE];
  const dateValues  = e.namedValues[INTAKE_RESPONSE_DATE_QUESTION_TITLE];

  const email   = (emailValues && emailValues[0] ? emailValues[0] : '').toString().toLowerCase().trim();
  const rawDate = (dateValues && dateValues[0] ? dateValues[0] : '').toString().trim();

  if (!email) return null;

  // Best-effort normalization to the 'yyyy-MM-dd' form findIntakeMatchRow()
  // compares against. If the submitted date string can't be parsed, date
  // stays null -- findIntakeMatchRow()'s email-only fallback handles that
  // safely (matched only if it is itself unambiguous).
  let date = null;
  if (rawDate) {
    try { date = formatDateForForm(new Date(rawDate)); }
    catch(dateErr) { date = null; }
  }

  return { email: email, date: date };
}

// ============================================================
// INTAKE FORM SUBMIT HANDLER (installable spreadsheet-bound "On form submit" trigger)
// ------------------------------------------------------------
// This project's Triggers UI does not offer "From form" or "From
// spreadsheet" as manual event sources (verified live against the sandbox
// project) -- only "Time-driven" and "From calendar". This handler is
// therefore designed for a trigger created PROGRAMMATICALLY via
// installIntakeFormSubmitTrigger_() in Setup.js, using
// ScriptApp.newTrigger('onIntakeFormSubmit').forSpreadsheet(ss).onFormSubmit().create() --
// which the ScriptApp API supports regardless of what the Triggers UI
// dropdown lists. setupTriggers() creates this trigger automatically; no
// manual installation and no new Script Property are required.
//
// This is a SPREADSHEET form-submit event, not a FORM form-submit event --
// the event object shape is different. It provides e.namedValues (an
// object keyed by question title, each value a single-element array),
// e.values (positional, NOT used here -- namedValues is preferred so this
// does not depend on column order), and e.range (the newly-appended
// response row, used only to confirm which sheet the event came from).
// It does NOT provide e.response or any FormApp/ItemResponse object.
//
// Because the trigger is spreadsheet-bound, it fires for ANY form linked to
// this spreadsheet, not just the intake form -- e.range.getSheet().getName()
// is checked against INTAKE_RESPONSE_SHEET_NAME first so a submission from
// an unrelated linked form (if one is ever added) is ignored rather than
// processed.
//
// This is the repository's only mechanism for detecting that the intake
// form was actually completed, as opposed to Intake Sent (column I), which
// only means the pre-filled link was emailed to the customer. It does not
// read or store the full response -- consistent with the documented design
// ("the script does not read form responses") -- it only confirms a
// submission arrived and marks column V (Intake Form Completed) on the
// matching booking row. The flag can only ever be set here, inside this
// handler, which Apps Script invokes only after Google Forms has already
// accepted and recorded the submission -- there is no earlier point at
// which the script could observe or act on it.
//
// Matching: see findIntakeMatchRow() above (unchanged). It never guesses --
// if the submission's email matches more than one eligible (not-yet-complete)
// booking and the rental date cannot tell them apart, this handler updates
// nothing and logs a warning instead of marking an arbitrary row complete.
//
// If the deposit was already paid before the intake form was submitted,
// this function also sends the DocuSeal lease immediately, mirroring the
// gating markDepositPaid applies when the deposit arrives second. This is
// what makes the deposit/intake ordering not matter for DocuSeal.
// ============================================================
function onIntakeFormSubmit(e) {
  try {
    const fields = extractIntakeSubmissionFields(e);
    if (!fields) {
      Logger.log('onIntakeFormSubmit: could not extract a usable submission -- either this event ' +
                 'is not from the intake response sheet (' + INTAKE_RESPONSE_SHEET_NAME + '), or ' +
                 'no email answer was found. If the sheet is correct, verify ' +
                 'INTAKE_RESPONSE_EMAIL_QUESTION_TITLE matches the live form\'s exact question title.');
      return;
    }

    const sheet = getSheet();
    const data  = sheet.getDataRange().getValues();

    const match = findIntakeMatchRow(data, fields.email, fields.date);

    if (match.status === 'ambiguous') {
      Logger.log('onIntakeFormSubmit: submission for ' + fields.email + ' matched more than one ' +
                 'eligible booking row and could not be safely disambiguated by rental date -- no ' +
                 'row was updated and no DocuSeal lease was sent. Review the Bookings sheet manually.');
      return;
    }

    if (match.status === 'not_found') {
      Logger.log('onIntakeFormSubmit: no matching booking row found for ' + fields.email);
      return;
    }

    const i = match.row;
    sheet.getRange(i + 1, 22).setValue('Yes'); // V: Intake Form Completed
    Logger.log('onIntakeFormSubmit: marked intake complete for row ' + (i + 1) +
               ' (matched by ' + match.precision + ')');

    // If the deposit already cleared, this submission is the second of the
    // two conditions to arrive -- send the lease now.
    const depositPaid = data[i][6]; // G: Deposit Paid
    const leaseSent    = data[i][9]; // J: Lease Sent
    const rowEmail     = (data[i][2] || '').toLowerCase().trim();
    if (isDocuSealEligible(depositPaid, 'Yes', leaseSent) && rowEmail !== 'no email') {
      try {
        const name        = data[i][1];
        const email       = data[i][2];
        const secondEmail = data[i][12] || '';
        const startTime   = new Date(data[i][4]);
        const endTime     = new Date(data[i][5]);
        const vehicleType = data[i][17] || '';
        const location    = data[i][18] || '';

        const docuSealResp = sendLeaseViaDocuSeal(name, email, secondEmail, startTime, endTime, vehicleType, location);
        const submissionId = extractDocuSealSubmissionId(docuSealResp);

        sheet.getRange(i + 1, 10).setValue('Yes'); // J: Lease Sent
        if (submissionId != null) sheet.getRange(i + 1, 20).setValue(submissionId); // T: DocuSeal Submission ID
        Logger.log('onIntakeFormSubmit: deposit was already paid -- lease sent for ' + email);
      } catch(leaseErr) {
        Logger.log('onIntakeFormSubmit: DocuSeal send failed for row ' + (i + 1) + ': ' + leaseErr);
        alertAdmin('onIntakeFormSubmit DocuSeal error', leaseErr.toString());
      }
    }
  } catch(err) {
    Logger.log('onIntakeFormSubmit error: ' + err.toString());
    try { alertAdmin('onIntakeFormSubmit error', err.toString()); } catch(e2) { /* best effort */ }
  }
}
