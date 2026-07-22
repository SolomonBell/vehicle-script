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

  Logger.log('All triggers created.');
  setupSheetSchema();
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

  Logger.log('Sheet schema applied: Column R = Vehicle Type, Column S = Location (dropdowns).');
}
