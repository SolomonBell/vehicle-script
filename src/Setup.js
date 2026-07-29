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

  // Column R header
  const headerCell = sheet.getRange('R1');
  if (!headerCell.getValue()) headerCell.setValue('Vehicle Type');

  // Column R data validation: derive vehicle types from CALENDAR_CONFIGS (single source of truth)
  const vehicleTypes = [...new Set(CALENDAR_CONFIGS.map(c => c.vehicleType))];
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(vehicleTypes, true)
    .setAllowInvalid(true)   // allow blank (existing rows) and script-written empty strings
    .build();
  sheet.getRange('R2:R').setDataValidation(rule);

  // Column S: Location — derive from CALENDAR_CONFIGS
  const sHeaderCell = sheet.getRange('S1');
  if (!sHeaderCell.getValue()) sHeaderCell.setValue('Location');

  const locations = [...new Set(CALENDAR_CONFIGS.map(c => c.location))];
  const locationRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(locations, true)
    .setAllowInvalid(true)
    .build();
  sheet.getRange('S2:S').setDataValidation(locationRule);

  // Column U header: Customer Approval Notified — a simple Yes/blank flag
  // (same pattern as I/J/K/L), set by notifyCustomerOfApproval() in Approval.js.
  // No dropdown needed, same as the other Yes/blank flag columns.
  const uHeaderCell = sheet.getRange('U1');
  if (!uHeaderCell.getValue()) uHeaderCell.setValue('Customer Approval Notified');

  // Column V header: Intake Form Completed — a simple Yes/blank flag set by
  // processIntakeFormSubmission_() in Forms.js (via the onFormSubmit
  // dispatcher) when the intake Google Form is submitted.
  const vHeaderCell = sheet.getRange('V1');
  if (!vHeaderCell.getValue()) vHeaderCell.setValue('Intake Form Completed');

  // Column W header: Pre-Inspection Form Completed — a simple Yes/blank flag
  // set by processInspectionFormSubmission_() in Forms.js (via the
  // onFormSubmit dispatcher). Column already exists in the sandbox sheet;
  // this only fills in the header text if it is blank.
  const wHeaderCell = sheet.getRange('W1');
  if (!wHeaderCell.getValue()) wHeaderCell.setValue('Pre-Inspection Form Completed');

  // Column X header: Post-Inspection Form Completed — same pattern as W.
  const xHeaderCell = sheet.getRange('X1');
  if (!xHeaderCell.getValue()) xHeaderCell.setValue('Post-Inspection Form Completed');

  Logger.log('Sheet schema applied: Column R = Vehicle Type, Column S = Location (dropdowns), ' +
             'Column U = Customer Approval Notified, Column V = Intake Form Completed, ' +
             'Column W = Pre-Inspection Form Completed, Column X = Post-Inspection Form Completed.');
}
