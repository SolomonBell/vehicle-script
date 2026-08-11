// ============================================================
// SETUP -- run ONCE manually from the editor toolbar
// ============================================================
function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('syncCalendarBookings')
    .timeBased().everyMinutes(5).create();

  ScriptApp.newTrigger('processReminders')
    .timeBased().everyMinutes(30).create();

  ScriptApp.newTrigger('sendLeaseToNewBookings')
    .timeBased().everyMinutes(15).create();

  ScriptApp.newTrigger('checkRentalEligibility')
    .timeBased().everyMinutes(5).create();

  installFormSubmitTrigger_();

  Logger.log('All triggers created.');
  setupSheetSchema();
}

// ============================================================
// FORM SUBMIT TRIGGER (called by setupTriggers(), safe to run repeatedly)
// ------------------------------------------------------------
// This project's Triggers UI does not offer "From form" or "From
// spreadsheet" as manual event sources (verified live) -- only
// "Time-driven" and "From calendar". A trigger for onFormSubmit() (Forms.js)
// is therefore created here programmatically, using
// ScriptApp.newTrigger(...).forSpreadsheet(ss).onFormSubmit() -- the
// ScriptApp API supports this independent of what the Triggers UI dropdown
// lists.
//
// There is exactly ONE such trigger, for the SAME spreadsheet Bookings
// already lives in, via getSheet().getParent() (Helpers.js) -- the same
// SHEET_ID-based lookup every other function in this codebase uses. The
// intake form ("Rental Intake Form" tab) and the inspection form ("Rental
// Vehicle Condition Inspection Form" tab) both write into tabs of this same
// spreadsheet -- there is no separate inspection response spreadsheet and
// no Script Property identifying one. A spreadsheet-bound onFormSubmit
// trigger fires for every form linked to a spreadsheet, so a single trigger
// here is sufficient (and Apps Script would not support a second one on the
// same spreadsheet anyway); onFormSubmit() in Forms.js is the dispatcher
// that routes each event to the intake or inspection processing function by
// response-tab name.
//
// Idempotent: setupTriggers() deletes every existing project trigger
// before calling this, so re-running setupTriggers() never creates a
// duplicate onFormSubmit trigger.
//
// Never logs the spreadsheet ID or URL -- only whether installation
// succeeded or failed.
// ============================================================
function installFormSubmitTrigger_() {
  try {
    const ss = getSheet().getParent(); // the Bookings spreadsheet (also holds the intake and inspection response tabs)
    ScriptApp.newTrigger('onFormSubmit').forSpreadsheet(ss).onFormSubmit().create();
    Logger.log('installFormSubmitTrigger_: onFormSubmit trigger installed.');
  } catch(e) {
    Logger.log('installFormSubmitTrigger_: could not create the onFormSubmit trigger. ' +
               'Verify SHEET_ID is set and this script has edit access to that spreadsheet.');
  }
}

// ============================================================
// SHEET SCHEMA SETUP -- called by setupTriggers()
// Adds column headers and data validation.
// Safe to re-run: only writes a header if cell is blank,
// and always re-applies the validation rule.
// ============================================================
function setupSheetSchema() {
  const sheet = getSheet();

  // Column M header: Additional Driver Name — written only by
  // processIntakeFormSubmission_() in Forms.js, once a validated "Yes"
  // additional-driver answer has been received. Blank until then.
  const mHeaderCell = sheet.getRange('M1');
  if (!mHeaderCell.getValue()) mHeaderCell.setValue('Additional Driver Name');

  // Column N header: Additional Driver Email — initially populated (or left
  // as the 'No Second Email' placeholder) by syncCalendarBookings() in
  // CalendarSync.js from the Calendar description as a fallback; the intake
  // form is authoritative once submitted (see processIntakeFormSubmission_()
  // in Forms.js).
  const nHeaderCell = sheet.getRange('N1');
  if (!nHeaderCell.getValue()) nHeaderCell.setValue('Additional Driver Email');

  // Column S header
  const headerCell = sheet.getRange('S1');
  if (!headerCell.getValue()) headerCell.setValue('Vehicle Type');

  // Column S data validation: derive vehicle types from CALENDAR_CONFIGS (single source of truth)
  const vehicleTypes = [...new Set(CALENDAR_CONFIGS.map(c => c.vehicleType))];
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(vehicleTypes, true)
    .setAllowInvalid(true)   // allow blank (existing rows) and script-written empty strings
    .build();
  sheet.getRange('S2:S').setDataValidation(rule);

  // Column T: Location — derive from CALENDAR_CONFIGS
  const tHeaderCell = sheet.getRange('T1');
  if (!tHeaderCell.getValue()) tHeaderCell.setValue('Location');

  const locations = [...new Set(CALENDAR_CONFIGS.map(c => c.location))];
  const locationRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(locations, true)
    .setAllowInvalid(true)
    .build();
  sheet.getRange('T2:T').setDataValidation(locationRule);

  // Column V header: Customer Approval Notified — a simple Yes/blank flag
  // (same pattern as I/J/K/L), set by notifyCustomerOfApproval() in Approval.js.
  // No dropdown needed, same as the other Yes/blank flag columns.
  const vHeaderCell = sheet.getRange('V1');
  if (!vHeaderCell.getValue()) vHeaderCell.setValue('Customer Approval Notified');

  // Column W header: Intake Form Completed — a simple Yes/blank flag set by
  // processIntakeFormSubmission_() in Forms.js (via the onFormSubmit
  // dispatcher) when the intake Google Form is submitted.
  const wHeaderCell = sheet.getRange('W1');
  if (!wHeaderCell.getValue()) wHeaderCell.setValue('Intake Form Completed');

  // Column X header: Pre-Inspection Form Completed — a simple Yes/blank flag
  // set by processInspectionFormSubmission_() in Forms.js (via the
  // onFormSubmit dispatcher). Column already exists in the sandbox sheet;
  // this only fills in the header text if it is blank.
  const xHeaderCell = sheet.getRange('X1');
  if (!xHeaderCell.getValue()) xHeaderCell.setValue('Pre-Inspection Form Completed');

  // Column Y header: Post-Inspection Form Completed — same pattern as X.
  const yHeaderCell = sheet.getRange('Y1');
  if (!yHeaderCell.getValue()) yHeaderCell.setValue('Post-Inspection Form Completed');

  // Column Z header: Suspicious Timing Warning Sent — a simple Yes/blank
  // flag set by sendSuspiciousInspectionTimingWarning_() in Reminders.js,
  // once per booking, after the manager has been warned that the pre-trip
  // and post-trip inspection forms were submitted unusually close together.
  const zHeaderCell = sheet.getRange('Z1');
  if (!zHeaderCell.getValue()) zHeaderCell.setValue('Suspicious Timing Warning Sent');

  // Column AA header: Cancelled — a timestamp, set either automatically by
  // the cancellation-detection pass (a previously-synced booking's calendar
  // event was deleted) or manually by a manager typing any value into this
  // column directly. Blank until then. See CancelReschedule.js.
  const aaHeaderCell = sheet.getRange('AA1');
  if (!aaHeaderCell.getValue()) aaHeaderCell.setValue('Cancelled');

  // Column AB header: Cancel Notified — a simple Yes/blank flag (same
  // pattern as I/J/K/L/V/W/Z), set only once the one-time cancellation
  // notice has actually been delivered to the customer via at least one
  // channel — see runCancellationDetectionForLocation_() in
  // CancelReschedule.js.
  const abHeaderCell = sheet.getRange('AB1');
  if (!abHeaderCell.getValue()) abHeaderCell.setValue('Cancel Notified');

  // Column AC header: Rescheduled At — a timestamp holding only the most
  // recent reschedule (not a history of every past reschedule), set by
  // handleReschedule_() in CancelReschedule.js.
  const acHeaderCell = sheet.getRange('AC1');
  if (!acHeaderCell.getValue()) acHeaderCell.setValue('Rescheduled At');

  Logger.log('Sheet schema applied: Column M = Additional Driver Name, Column N = Additional Driver Email, ' +
             'Column S = Vehicle Type, Column T = Location (dropdowns), ' +
             'Column V = Customer Approval Notified, Column W = Intake Form Completed, ' +
             'Column X = Pre-Inspection Form Completed, Column Y = Post-Inspection Form Completed, ' +
             'Column Z = Suspicious Timing Warning Sent, Column AA = Cancelled, ' +
             'Column AB = Cancel Notified, Column AC = Rescheduled At.');
}
