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

// Returns true for any completion-cell value that has already been marked
// done -- both the plain 'Yes' used by column W (Intake Form Completed) and
// the 'Yes <timestamp>' format used by columns X and Y (Pre-/Post-Inspection
// Form Completed, see formatInspectionCompletionValue() in Helpers.js). A
// value is considered "set" purely by its 'Yes' prefix; the timestamp
// portion, if any, does not need to be parseable for this check -- that is
// a separate concern handled by parseInspectionCompletionTimestamp_() in
// Helpers.js. Used by findBookingMatchRow_() below so it treats every
// completion-flag format in this codebase identically when deciding whether
// a row is still eligible to be matched.
function isInspectionCompletionValueSet_(cellValue) {
  return typeof cellValue === 'string' && cellValue.trim().indexOf('Yes') === 0;
}

// Pure row-matching logic shared by processIntakeFormSubmission_() and
// processInspectionFormSubmission_(), separated out so it can be
// unit-tested with synthetic data (no sheet reads, no live form event).
//
// Matches on email (case-insensitive) plus, when available, the pre-filled
// rental date -- narrowing a repeat customer's simultaneous incomplete
// bookings down to the one they actually just submitted a form for. Neither
// form currently carries Event ID or any other unique booking reference, so
// this is the strongest match available without a Google Form change.
//
// completionColIndex is the 0-based column that marks a row as already
// handled for the specific document being matched (W for intake, X for
// pre-inspection, Y for post-inspection) -- callers pass whichever column
// applies so the same algorithm and the same "never guess" guarantee apply
// to every form-submit handler in this codebase. "Already handled" is
// determined by isInspectionCompletionValueSet_() above, not by an exact
// 'Yes' string match, so this works whether the column holds a bare 'Yes'
// (W) or 'Yes <timestamp>' (X, Y).
//
// dateStr, when provided, must already be in 'yyyy-MM-dd' form (the same
// format formatDateForForm() uses to pre-fill the date field). Pass null to
// skip date narrowing entirely.
//
// NEVER guesses. Returns one of four outcomes as { status, row, precision }:
//   'matched'      -- row is the single unambiguous 0-based row index to update.
//   'ambiguous'    -- two or more eligible (not-yet-complete) rows share this
//                     email and could not be told apart. row is -1. Caller
//                     must update nothing.
//   'already_done' -- every row with this email is already marked complete
//                     in completionColIndex -- a harmless duplicate
//                     submission, not an error. row is -1.
//   'not_found'    -- no row has this email at all, complete or not. row is -1.
//
// Matching never considers column B (customer name).
//
// Algorithm:
//   1. Collect every row with this email, complete or not.
//   2. If zero such rows exist -> not_found.
//   3. Narrow to rows not yet marked complete in completionColIndex. If zero
//      remain -> already_done (every match for this email is a duplicate).
//   4. If a date was supplied, narrow that set to rows whose rental date
//      matches it. Exactly one match -> matched. Two or more -> ambiguous
//      (same email AND same date on multiple incomplete bookings). Zero ->
//      fall through to step 5 (the date didn't help, not that it failed).
//   5. Controlled email-only fallback: allowed ONLY when exactly one
//      eligible row exists for the email overall. Two or more -> ambiguous.
function findBookingMatchRow_(data, email, dateStr, completionColIndex) {
  const withEmail = [];
  for (let i = 1; i < data.length; i++) {
    const rowEmail = (data[i][2] || '').toLowerCase().trim(); // C: Email
    if (rowEmail === email) withEmail.push(i);
  }

  if (withEmail.length === 0) {
    return { status: 'not_found', row: -1, precision: null };
  }

  const eligible = withEmail.filter(function(i) { return !isInspectionCompletionValueSet_(data[i][completionColIndex]); });

  if (eligible.length === 0) {
    return { status: 'already_done', row: -1, precision: null };
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

// Intake-specific wrapper around findBookingMatchRow_() -- preserves the
// original three-outcome contract ('matched' / 'ambiguous' / 'not_found')
// exactly as before this function was generalized, so
// processIntakeFormSubmission_() and its tests continue to behave
// identically. A duplicate intake
// submission (every match already marked 'Yes' in column W) is reported as
// 'not_found', same as if no row had matched at all -- this function never
// exposed the 'already_done' distinction, so callers must not start relying
// on it here.
function findIntakeMatchRow(data, email, dateStr) {
  const result = findBookingMatchRow_(data, email, dateStr, 22); // W: Intake Form Completed
  if (result.status === 'already_done') return { status: 'not_found', row: -1, precision: null };
  return result;
}

// Inspection-specific wrapper around findBookingMatchRow_(). inspectionType
// must be 'pre' or 'post' (see extractInspectionSubmissionFields()) and
// selects which completion column duplicate-submission checks and matching
// are scoped to -- X for 'pre', Y for 'post'. Unlike findIntakeMatchRow(),
// this exposes 'already_done' as its own status so
// processInspectionFormSubmission_() can treat a resubmission of an
// already-completed inspection as a silent no-op rather than alerting the
// admin about a "missing" match.
function findInspectionMatchRow(data, email, dateStr, inspectionType) {
  const completionCol = inspectionType === 'pre' ? 23 : 24; // X: Pre-Inspection Form Completed / Y: Post-Inspection Form Completed
  return findBookingMatchRow_(data, email, dateStr, completionCol);
}

// Exact Google Form question titles, verified live against the sandbox
// intake response sheet's header row -- these are also the exact keys
// e.namedValues uses on a spreadsheet form-submit event, since Google
// Forms writes the question title as the response sheet's column header.
// If the live form's questions are ever retitled, these must be updated to
// match, or processIntakeFormSubmission_() will safely find nothing and
// process nothing rather than silently reading the wrong field.
const INTAKE_RESPONSE_EMAIL_QUESTION_TITLE = 'Email Address';
const INTAKE_RESPONSE_DATE_QUESTION_TITLE  = 'Rental Date';

// Exact question titles for the redesigned intake form's additional-driver
// branch (Section 2/3 -- see docs/setup-notes.md). Same "verify against the
// live form, safely find/process nothing if retitled" contract as the two
// constants above.
const INTAKE_RESPONSE_ADDITIONAL_DRIVER_QUESTION_TITLE      = 'Will there be an additional authorized driver?';
const INTAKE_RESPONSE_ADDITIONAL_DRIVER_NAME_QUESTION_TITLE  = 'Additional Driver Full Name';
const INTAKE_RESPONSE_ADDITIONAL_DRIVER_EMAIL_QUESTION_TITLE = 'Additional Driver Email Address';

// Tab name of the linked intake-form response sheet, within the SAME
// spreadsheet as Bookings -- verified live against the sandbox project.
// Used only as a safety check so this handler ignores submissions from any
// other form that might get linked to this spreadsheet later -- isolated
// here in one constant rather than scattered through the function. Update
// this if the response tab is ever renamed.
const INTAKE_RESPONSE_SHEET_NAME = 'Rental Intake Form';

// Pure extraction of the fields processIntakeFormSubmission_() needs from a
// spreadsheet form-submit event object -- separated out so it can be
// unit-tested with a synthetic event (no sheet reads, no live trigger).
//
// Returns { email, date, hasAdditionalDriver, rawAdditionalDriverAnswer,
// additionalDriverName, additionalDriverEmail } on success, where:
//   - date is null if it was blank or unparseable -- findIntakeMatchRow()
//     handles that safely via its email-only fallback,
//   - hasAdditionalDriver is true/false when the answer normalizes to
//     exactly "yes"/"no" (case/whitespace-insensitive), or null if the
//     answer is missing or does not normalize to either -- callers must
//     never guess and must treat null as "cannot process this submission's
//     additional-driver data" (see validateAdditionalDriverSubmission_()
//     below),
//   - rawAdditionalDriverAnswer is the trimmed, original-case answer, kept
//     only for admin-alert context when hasAdditionalDriver is null,
//   - additionalDriverName / additionalDriverEmail are the trimmed (and,
//     for email, lowercased) answers to the two Section 3 questions --
//     always returned as-extracted (possibly blank strings) regardless of
//     hasAdditionalDriver; validation of whether they are required happens
//     in validateAdditionalDriverSubmission_(), not here.
// Returns null if:
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
  // compares against. Uses parseFormDateOnly_() (Helpers.js), not new Date()
  // directly, so a bare "yyyy-MM-dd" answer is treated as a local calendar
  // date rather than UTC midnight -- otherwise it silently rolls back one
  // day when formatted in a timezone behind UTC (e.g. Pacific). If the
  // submitted date string can't be parsed, date stays null --
  // findIntakeMatchRow()'s email-only fallback handles that safely (matched
  // only if it is itself unambiguous).
  let date = null;
  if (rawDate) {
    try { date = formatDateForForm(parseFormDateOnly_(rawDate)); }
    catch(dateErr) { date = null; }
  }

  const additionalDriverValues      = e.namedValues[INTAKE_RESPONSE_ADDITIONAL_DRIVER_QUESTION_TITLE];
  const additionalDriverNameValues  = e.namedValues[INTAKE_RESPONSE_ADDITIONAL_DRIVER_NAME_QUESTION_TITLE];
  const additionalDriverEmailValues = e.namedValues[INTAKE_RESPONSE_ADDITIONAL_DRIVER_EMAIL_QUESTION_TITLE];

  const rawAdditionalDriverAnswer = (additionalDriverValues && additionalDriverValues[0] ? additionalDriverValues[0] : '').toString().trim();
  const additionalDriverName      = (additionalDriverNameValues && additionalDriverNameValues[0] ? additionalDriverNameValues[0] : '').toString().trim();
  const additionalDriverEmail     = (additionalDriverEmailValues && additionalDriverEmailValues[0] ? additionalDriverEmailValues[0] : '').toString().toLowerCase().trim();

  const normalizedAdditionalDriverAnswer = rawAdditionalDriverAnswer.toLowerCase();
  let hasAdditionalDriver = null;
  if (normalizedAdditionalDriverAnswer === 'yes') hasAdditionalDriver = true;
  else if (normalizedAdditionalDriverAnswer === 'no') hasAdditionalDriver = false;

  return {
    email: email,
    date: date,
    hasAdditionalDriver: hasAdditionalDriver,
    rawAdditionalDriverAnswer: rawAdditionalDriverAnswer,
    additionalDriverName: additionalDriverName,
    additionalDriverEmail: additionalDriverEmail
  };
}

// Validates the additional-driver branch of an intake submission (see
// extractIntakeSubmissionFields() above). Pure -- no sheet reads, no
// external calls -- so it can be unit-tested directly. Never guesses:
// anything not explicitly valid is rejected. Returns { valid: true } or
// { valid: false, reason: '<short machine-readable reason>' }.
//
//   - hasAdditionalDriver === false -> always valid; there is nothing else
//     to check on the "No" branch.
//   - hasAdditionalDriver !== true (i.e. null, or any other unexpected
//     value) -> invalid, reason 'unrecognized-answer'. This covers a
//     missing/blank answer or one that didn't normalize to "yes"/"no".
//   - hasAdditionalDriver === true requires, in order:
//       * a nonblank additionalDriverName ('missing-name' if blank),
//       * a nonblank additionalDriverEmail ('missing-email' if blank),
//       * a syntactically valid email format ('invalid-email-format'),
//       * additionalDriverEmail different from primaryEmail, case-
//         insensitively ('duplicate-email' if they match).
//
// Used by processIntakeFormSubmission_() to decide whether it is safe to
// write columns M/N and mark Intake Form Completed (column W) for this
// submission.
function validateAdditionalDriverSubmission_(hasAdditionalDriver, additionalDriverName, additionalDriverEmail, primaryEmail) {
  if (hasAdditionalDriver === false) {
    return { valid: true };
  }
  if (hasAdditionalDriver !== true) {
    return { valid: false, reason: 'unrecognized-answer' };
  }
  if (!additionalDriverName) {
    return { valid: false, reason: 'missing-name' };
  }
  if (!additionalDriverEmail) {
    return { valid: false, reason: 'missing-email' };
  }
  if (!isValidEmailFormat_(additionalDriverEmail)) {
    return { valid: false, reason: 'invalid-email-format' };
  }
  if (additionalDriverEmail.toLowerCase().trim() === (primaryEmail || '').toLowerCase().trim()) {
    return { valid: false, reason: 'duplicate-email' };
  }
  return { valid: true };
}

// Exact Google Form question titles and response-sheet tab name for the
// inspection form, in the same style as the verified INTAKE_RESPONSE_*
// constants above -- verified live against the sandbox spreadsheet's
// "Rental Vehicle Condition Inspection Form" response tab. Other headers
// exist on that tab but are not needed for completion matching. If the live
// form's questions are ever retitled, these constants are the only place
// that needs updating -- extractInspectionSubmissionFields() would
// otherwise safely find nothing and process nothing rather than silently
// reading the wrong field.
const INSPECT_RESPONSE_EMAIL_QUESTION_TITLE = 'Email Address';
const INSPECT_RESPONSE_DATE_QUESTION_TITLE  = 'Rental Date';
const INSPECT_RESPONSE_TYPE_QUESTION_TITLE  = 'Inspection Type';

// Google Forms automatically adds a "Timestamp" column to every linked
// response sheet, recording the actual moment the response was submitted --
// this is a standard Google Forms behavior, not a question the form author
// added, so it is not expected to ever be retitled the way the questions
// above might be. Used to record the customer's actual pre-/post-trip
// inspection completion time (see extractInspectionSubmissionFields() and
// processInspectionFormSubmission_() below), rather than the time the
// script happens to process the event.
const INSPECT_RESPONSE_TIMESTAMP_QUESTION_TITLE = 'Timestamp';

// Tab name of the linked inspection-form response sheet, within the SAME
// spreadsheet as Bookings and the intake form (all three are tabs in the
// one spreadsheet identified by the SHEET_ID Script Property -- there is no
// separate inspection response spreadsheet). Used only as a safety check so
// this handler ignores submissions from any other form linked to this
// spreadsheet -- isolated here in one constant rather than scattered
// through the function. Update this if the response tab is ever renamed.
const INSPECT_RESPONSE_SHEET_NAME = 'Rental Vehicle Condition Inspection Form';

// Pure extraction of the fields processInspectionFormSubmission_() needs
// from a spreadsheet form-submit event object -- mirrors
// extractIntakeSubmissionFields() above, plus the inspection-type answer
// that distinguishes a pre-trip from a post-trip submission. The pre- and
// post-trip inspections share one Google Form (see buildInspectUrl()
// above); the Inspection Type answer is the only thing that tells them
// apart.
//
// Response classification compares the submitted answer against
// CONFIG.INSPECT_VAL_PRE / CONFIG.INSPECT_VAL_POST -- the same values
// buildInspectUrl() uses to pre-fill the form's dropdown -- since the live
// form's dropdown option text (e.g. "Pre-Trip (Before Vehicle Pickup)") is
// what the response sheet actually records when the customer leaves the
// pre-filled value unchanged. The submitted answer and both configured
// values are independently normalized with String(value).trim().toLowerCase()
// before comparing, so case and incidental whitespace differences never
// cause a false unclassified result; anything that doesn't match either
// normalized configured value is left unclassified (type: null) rather than
// guessed.
//
// Returns { email, date, type, rawType, submittedAt } on success, where:
//   - date is null if it was blank or unparseable (findInspectionMatchRow()
//     handles that safely via its email-only fallback),
//   - type is 'pre', 'post', or null if the normalized answer was neither
//     -- the caller must refuse to update anything in that case and must
//     never guess the type,
//   - rawType is the trimmed, original-case submitted answer, kept only for
//     admin-alert context when type is null, and
//   - submittedAt is the actual form-submission time as a Date, read from
//     the sheet's automatic "Timestamp" column (see
//     INSPECT_RESPONSE_TIMESTAMP_QUESTION_TITLE above) -- null if that
//     column is missing or unparseable, in which case the caller falls back
//     to the time it happens to be processing the event (see
//     processInspectionFormSubmission_() below).
// Returns null if:
//   - the event object doesn't look like a spreadsheet form-submit event
//     (missing e.range or e.namedValues), or
//   - the submission is from a sheet other than INSPECT_RESPONSE_SHEET_NAME
//     (e.g. the intake form or an unrelated linked form), or
//   - no email answer was found under INSPECT_RESPONSE_EMAIL_QUESTION_TITLE.
// A null return means "process nothing" -- the caller must not guess.
function extractInspectionSubmissionFields(e) {
  if (!e || !e.range || !e.namedValues) return null;

  const sourceSheetName = e.range.getSheet().getName();
  if (sourceSheetName !== INSPECT_RESPONSE_SHEET_NAME) return null;

  const emailValues     = e.namedValues[INSPECT_RESPONSE_EMAIL_QUESTION_TITLE];
  const dateValues      = e.namedValues[INSPECT_RESPONSE_DATE_QUESTION_TITLE];
  const typeValues      = e.namedValues[INSPECT_RESPONSE_TYPE_QUESTION_TITLE];
  const timestampValues = e.namedValues[INSPECT_RESPONSE_TIMESTAMP_QUESTION_TITLE];

  const email        = (emailValues && emailValues[0] ? emailValues[0] : '').toString().toLowerCase().trim();
  const rawDate      = (dateValues && dateValues[0] ? dateValues[0] : '').toString().trim();
  const rawType      = (typeValues && typeValues[0] ? typeValues[0] : '').toString().trim();
  const rawTimestamp = (timestampValues && timestampValues[0] ? timestampValues[0] : '').toString().trim();

  if (!email) return null;

  // See parseFormDateOnly_() (Helpers.js): a bare "yyyy-MM-dd" answer must
  // be parsed as a local calendar date, not UTC midnight, or it silently
  // rolls back one day when formatted in a timezone behind UTC (e.g.
  // Pacific).
  let date = null;
  if (rawDate) {
    try { date = formatDateForForm(parseFormDateOnly_(rawDate)); }
    catch(dateErr) { date = null; }
  }

  let submittedAt = null;
  if (rawTimestamp) {
    try {
      const parsed = new Date(rawTimestamp);
      submittedAt = isNaN(parsed.getTime()) ? null : parsed;
    } catch(timestampErr) { submittedAt = null; }
  }

  const normalizedType = String(rawType).trim().toLowerCase();
  const normalizedPre  = String(CONFIG.INSPECT_VAL_PRE).trim().toLowerCase();
  const normalizedPost = String(CONFIG.INSPECT_VAL_POST).trim().toLowerCase();
  let type = null;
  if (normalizedType === normalizedPre)       type = 'pre';
  else if (normalizedType === normalizedPost) type = 'post';

  return { email: email, date: date, type: type, rawType: rawType, submittedAt: submittedAt };
}

// ============================================================
// FORM SUBMIT DISPATCHER (the ONLY installable spreadsheet-bound "On form
// submit" trigger in this project)
// ------------------------------------------------------------
// This project's Triggers UI does not offer "From form" or "From
// spreadsheet" as manual event sources (verified live against the sandbox
// project) -- only "Time-driven" and "From calendar". This trigger is
// therefore created PROGRAMMATICALLY via installFormSubmitTrigger_() in
// Setup.js, using
// ScriptApp.newTrigger('onFormSubmit').forSpreadsheet(ss).onFormSubmit().create() --
// which the ScriptApp API supports regardless of what the Triggers UI
// dropdown lists. setupTriggers() creates this trigger automatically; no
// manual installation and no new Script Property are required.
//
// The intake form and the inspection form are NOT separate spreadsheets --
// both write their responses into tabs of the SAME spreadsheet Bookings
// lives in (identified by the SHEET_ID Script Property): "Rental Intake
// Form" and "Rental Vehicle Condition Inspection Form" respectively. A
// spreadsheet-bound onFormSubmit trigger fires for EVERY form linked to
// that spreadsheet, so there can only be one such trigger per spreadsheet
// -- Apps Script does not support installing two. This dispatcher is that
// one trigger; it looks at e.range.getSheet().getName() and routes to the
// matching processing function, or ignores the event if the submission came
// from neither response tab.
//
// This is a SPREADSHEET form-submit event, not a FORM form-submit event --
// the event object shape is different. It provides e.namedValues (an
// object keyed by question title, each value a single-element array),
// e.values (positional, NOT used here -- namedValues is preferred so this
// does not depend on column order), and e.range (the newly-appended
// response row, used here only to determine which sheet the event came
// from). It does NOT provide e.response or any FormApp/ItemResponse object.
// ============================================================
function onFormSubmit(e) {
  try {
    if (!e || !e.range) {
      Logger.log('onFormSubmit: received an event with no range -- ignoring.');
      return;
    }

    const sheetName = e.range.getSheet().getName();

    if (sheetName === INTAKE_RESPONSE_SHEET_NAME) {
      processIntakeFormSubmission_(e);
      return;
    }

    if (sheetName === INSPECT_RESPONSE_SHEET_NAME) {
      processInspectionFormSubmission_(e);
      return;
    }

    Logger.log('onFormSubmit: submission from sheet "' + sheetName + '" is neither the intake nor ' +
               'the inspection response sheet -- ignoring.');
  } catch(err) {
    Logger.log('onFormSubmit error: ' + err.toString());
    try { alertAdmin('onFormSubmit error', err.toString()); } catch(e2) { /* best effort */ }
  }
}

// ============================================================
// INTAKE FORM SUBMISSION PROCESSING (called only from onFormSubmit() above)
// ------------------------------------------------------------
// This is the repository's only mechanism for detecting that the intake
// form was actually completed, as opposed to Intake Sent (column I), which
// only means the pre-filled link was emailed to the customer. It does not
// read or store the full response beyond what is documented here -- only
// email/date (matching) and the additional-driver branch (columns M/N) are
// ever read -- it only confirms a submission arrived, records the
// additional-driver outcome, and marks column W (Intake Form Completed) on
// the matching booking row. The flag can only ever be set here, which
// onFormSubmit() invokes only after Google Forms has already accepted and
// recorded the submission -- there is no earlier point at which the script
// could observe or act on it.
//
// extractIntakeSubmissionFields() independently re-checks the sheet name
// against INTAKE_RESPONSE_SHEET_NAME (defense in depth: this function
// behaves safely even if ever called directly, e.g. from a test, without
// going through the dispatcher).
//
// Matching: see findIntakeMatchRow() above (unchanged). It never guesses --
// if the submission's email matches more than one eligible (not-yet-complete)
// booking and the rental date cannot tell them apart, this function updates
// nothing and logs a warning instead of marking an arbitrary row complete.
//
// Additional-driver branch (columns M / N -- Additional Driver Name /
// Additional Driver Email): validated by validateAdditionalDriverSubmission_()
// above before anything is written. Column W (Intake Form Completed) is
// deliberately NOT set if that validation fails -- an invalid or incomplete
// additional-driver answer is treated the same as "not yet usably
// submitted," and an admin alert is sent instead, rather than silently
// completing the booking with missing/bad driver-2 identity data. On a
// valid "Yes" answer, M/N are written from the submission. On a valid "No"
// answer, M/N are authoritatively reset to "no additional driver" -- this
// also overwrites any earlier Calendar-description-derived fallback value
// syncCalendarBookings() (CalendarSync.js) may have put in column N, since
// the intake form is the authoritative source once submitted.
//
// If the deposit was already paid before the intake form was submitted,
// this function also sends the DocuSeal lease immediately, mirroring the
// gating markDepositPaid applies when the deposit arrives second. This is
// what makes the deposit/intake ordering not matter for DocuSeal.
// ============================================================
function processIntakeFormSubmission_(e) {
  try {
    const fields = extractIntakeSubmissionFields(e);
    if (!fields) {
      Logger.log('processIntakeFormSubmission_: could not extract a usable submission -- either this ' +
                 'event is not from the intake response sheet (' + INTAKE_RESPONSE_SHEET_NAME + '), or ' +
                 'no email answer was found. If the sheet is correct, verify ' +
                 'INTAKE_RESPONSE_EMAIL_QUESTION_TITLE matches the live form\'s exact question title.');
      return;
    }

    const sheet = getSheet();
    const data  = sheet.getDataRange().getValues();

    const match = findIntakeMatchRow(data, fields.email, fields.date);

    if (match.status === 'ambiguous') {
      Logger.log('processIntakeFormSubmission_: submission for ' + fields.email + ' matched more ' +
                 'than one eligible booking row and could not be safely disambiguated by rental date ' +
                 '-- no row was updated and no DocuSeal lease was sent. Review the Bookings sheet manually.');
      return;
    }

    if (match.status === 'not_found') {
      Logger.log('processIntakeFormSubmission_: no matching booking row found for ' + fields.email);
      return;
    }

    const i = match.row;

    // Validate the additional-driver branch before writing or marking
    // anything for this submission -- see validateAdditionalDriverSubmission_()
    // above and the function-level comment for why.
    const validation = validateAdditionalDriverSubmission_(
      fields.hasAdditionalDriver, fields.additionalDriverName, fields.additionalDriverEmail, fields.email
    );

    if (!validation.valid) {
      Logger.log('processIntakeFormSubmission_: additional-driver data for ' + fields.email +
                 ' failed validation (' + validation.reason + ', raw answer "' +
                 fields.rawAdditionalDriverAnswer + '") -- row ' + (i + 1) +
                 ' NOT marked complete. Review the Bookings sheet / intake response manually.');
      alertAdmin('Intake form: invalid additional-driver submission',
        'A submission from ' + fields.email + ' had an invalid additional-driver answer (' +
        validation.reason + '; raw answer: "' + fields.rawAdditionalDriverAnswer + '"). Row ' +
        (i + 1) + ' was NOT marked Intake Form Completed. Review the raw response and correct ' +
        'columns M/N manually if needed, or ask the customer to resubmit.');
      return;
    }

    if (fields.hasAdditionalDriver === true) {
      sheet.getRange(i + 1, 13).setValue(fields.additionalDriverName);  // M: Additional Driver Name
      sheet.getRange(i + 1, 14).setValue(fields.additionalDriverEmail); // N: Additional Driver Email
      Logger.log('processIntakeFormSubmission_: additional driver recorded for row ' + (i + 1) +
                 ' (' + fields.additionalDriverName + ', ' + fields.additionalDriverEmail + ')');
    } else {
      // "No" branch -- authoritatively clears any earlier Calendar-derived
      // fallback value back to the "no additional driver" state.
      sheet.getRange(i + 1, 13).setValue('');                 // M: Additional Driver Name
      sheet.getRange(i + 1, 14).setValue('No Second Email');  // N: Additional Driver Email
      Logger.log('processIntakeFormSubmission_: no additional driver for row ' + (i + 1) +
                 ' -- M cleared, N reset to "No Second Email".');
    }

    sheet.getRange(i + 1, 23).setValue('Yes'); // W: Intake Form Completed
    Logger.log('processIntakeFormSubmission_: marked intake complete for row ' + (i + 1) +
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
        // Use the just-validated fields.* values (not a stale re-read of
        // data[i][12]/[13], which still holds whatever was in the sheet
        // BEFORE the writes just above) so this send always reflects
        // exactly what was just recorded for this submission.
        const additionalDriverName  = fields.hasAdditionalDriver === true ? fields.additionalDriverName  : '';
        const additionalDriverEmail = fields.hasAdditionalDriver === true ? fields.additionalDriverEmail : 'No Second Email';
        const startTime   = new Date(data[i][4]);
        const endTime     = new Date(data[i][5]);
        const vehicleType = data[i][18] || ''; // S: Vehicle Type
        const location    = data[i][19] || ''; // T: Location

        const docuSealResp = sendLeaseViaDocuSeal(name, email, additionalDriverName, additionalDriverEmail, startTime, endTime, vehicleType, location);
        const submissionId = extractDocuSealSubmissionId(docuSealResp);

        sheet.getRange(i + 1, 10).setValue('Yes'); // J: Lease Sent
        if (submissionId != null) sheet.getRange(i + 1, 21).setValue(submissionId); // U: DocuSeal Submission ID
        Logger.log('processIntakeFormSubmission_: deposit was already paid -- lease sent for ' + email);
      } catch(leaseErr) {
        Logger.log('processIntakeFormSubmission_: DocuSeal send failed for row ' + (i + 1) + ': ' + leaseErr);
        alertAdmin('processIntakeFormSubmission_ DocuSeal error', leaseErr.toString());
      }
    }
  } catch(err) {
    Logger.log('processIntakeFormSubmission_ error: ' + err.toString());
    try { alertAdmin('processIntakeFormSubmission_ error', err.toString()); } catch(e2) { /* best effort */ }
  }
}

// ============================================================
// INSPECTION FORM SUBMISSION PROCESSING (called only from onFormSubmit()
// above, mirrors processIntakeFormSubmission_() above)
// ------------------------------------------------------------
// The pre-trip and post-trip inspections share a single Google Form,
// distinguished only by the value of the Inspection Type question (see
// buildInspectUrl() above). This function reads that answer back out of
// the submission (via extractInspectionSubmissionFields(), which
// normalizes it independently of the CONFIG.INSPECT_VAL_PRE/POST display
// strings used only for URL pre-fill) to decide whether to write column X
// (Pre-Inspection Form Completed) or column Y (Post-Inspection Form
// Completed) -- never both in the same run, and never based on customer
// name alone.
//
// extractInspectionSubmissionFields() independently re-checks the sheet
// name against INSPECT_RESPONSE_SHEET_NAME (defense in depth: this
// function behaves safely even if ever called directly, e.g. from a test,
// without going through the dispatcher).
//
// Reuses findBookingMatchRow_() (via findInspectionMatchRow(), see above)
// for the same ambiguity-safe email+date matching intake uses -- never
// guesses which booking a submission belongs to, and a submission that
// cannot be safely matched, or cannot be classified as pre- or
// post-inspection, alerts the admin with context rather than failing
// silently.
// ============================================================
function processInspectionFormSubmission_(e) {
  try {
    const fields = extractInspectionSubmissionFields(e);
    if (!fields) {
      Logger.log('processInspectionFormSubmission_: could not extract a usable submission -- either ' +
                 'this event is not from the inspection response sheet (' + INSPECT_RESPONSE_SHEET_NAME +
                 '), or no email answer was found. If the sheet is correct, verify ' +
                 'INSPECT_RESPONSE_EMAIL_QUESTION_TITLE matches the live form\'s exact question title.');
      return;
    }

    if (!fields.type) {
      Logger.log('processInspectionFormSubmission_: could not classify submission from ' + fields.email +
                 ' as pre- or post-inspection -- the Inspection Type answer was "' + fields.rawType +
                 '", which does not normalize to "pre" or "post". No row was updated.');
      alertAdmin('Inspection form: unrecognized inspection type',
        'A submission from ' + fields.email + ' had an Inspection Type answer of "' + fields.rawType +
        '", which does not normalize to "pre" or "post", so no booking row was updated. Verify the ' +
        'inspection form\'s Inspection Type field and the INSPECT_RESPONSE_TYPE_QUESTION_TITLE constant.');
      return;
    }

    const sheet = getSheet();
    const data  = sheet.getDataRange().getValues();

    const match = findInspectionMatchRow(data, fields.email, fields.date, fields.type);

    if (match.status === 'already_done') {
      Logger.log('processInspectionFormSubmission_: ' + fields.type + '-inspection already marked ' +
                 'complete for ' + fields.email + ' -- ignoring duplicate submission.');
      return;
    }

    if (match.status === 'ambiguous') {
      Logger.log('processInspectionFormSubmission_: ' + fields.type + '-inspection submission for ' +
                 fields.email + ' matched more than one eligible booking row and could not be safely ' +
                 'disambiguated by rental date -- no row was updated.');
      alertAdmin('Inspection form: ambiguous match',
        'A ' + fields.type + '-inspection submission from ' + fields.email +
        (fields.date ? ' for rental date ' + fields.date : '') +
        ' matched more than one eligible booking and could not be safely disambiguated. ' +
        'No row was updated. Review the Bookings sheet manually.');
      return;
    }

    if (match.status === 'not_found') {
      Logger.log('processInspectionFormSubmission_: no matching booking row found for ' + fields.email +
                 ' (' + fields.type + '-inspection)');
      alertAdmin('Inspection form: no matching booking',
        'A ' + fields.type + '-inspection submission from ' + fields.email +
        (fields.date ? ' for rental date ' + fields.date : '') +
        ' did not match any booking row. No row was updated. Review the Bookings sheet manually.');
      return;
    }

    const i   = match.row;
    const col = fields.type === 'pre' ? 24 : 25; // X: Pre-Inspection Form Completed / Y: Post-Inspection Form Completed
    // Use the actual form-submission time (fields.submittedAt, read from the
    // response sheet's own Timestamp column) whenever it's available, so the
    // recorded completion time -- and the one-hour post-trip delay measured
    // from it, see isPostTripReminderEligible() in Helpers.js -- reflects
    // when the customer actually submitted the form. Falling back to the
    // time this handler happens to run is a rare, defensive fallback for the
    // unlikely case the Timestamp column is missing or unparseable.
    const completedAt = fields.submittedAt || new Date();
    sheet.getRange(i + 1, col).setValue(formatInspectionCompletionValue(completedAt));
    Logger.log('processInspectionFormSubmission_: marked ' + fields.type + '-inspection complete for ' +
               'row ' + (i + 1) + ' at ' + formatDateTimeShort(completedAt) +
               ' (matched by ' + match.precision + ')');
  } catch(err) {
    Logger.log('processInspectionFormSubmission_ error: ' + err.toString());
    try { alertAdmin('processInspectionFormSubmission_ error', err.toString()); } catch(e2) { /* best effort */ }
  }
}
