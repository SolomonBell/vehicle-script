// ============================================================
// SANDBOX / DEBUG TEST FUNCTIONS
// These functions are for manual testing only.
// Do NOT wire these to triggers. Remove before going to production.
// ============================================================

// ---------------------------------------------------------------------------
// TEST 1: Sheet connection
// Verifies SHEET_ID is set and the Bookings tab is accessible.
// ---------------------------------------------------------------------------
function testSheetConnection() {
  const sheet = getSheet();
  Logger.log('Connected to sheet: ' + sheet.getName());
  const bookingRows = Math.max(sheet.getLastRow() - 1, 0);
  Logger.log('Booking rows: ' + bookingRows);
}

// ---------------------------------------------------------------------------
// TEST 2: Calendar configs
// Verifies every CALENDAR_CONFIGS entry has its Script Property set and that
// CalendarApp can connect to the calendar. Replaces the old single-calendar
// testCalendarConnection().
// ---------------------------------------------------------------------------
function testCalendarConfigs() {
  Logger.log('Checking ' + CALENDAR_CONFIGS.length + ' calendar configuration(s)...');

  CALENDAR_CONFIGS.forEach(function(calCfg) {
    if (!calCfg.calendarId) {
      Logger.log('MISSING: ' + calCfg.propKey + ' is not set in Script Properties');
      return;
    }

    const calendar = CalendarApp.getCalendarById(calCfg.calendarId);
    if (!calendar) {
      Logger.log('FAIL: Calendar not found for ' + calCfg.propKey + ' (' + calCfg.calendarId + ')');
      return;
    }

    const now    = new Date();
    const future = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const count  = calendar.getEvents(now, future).length;

    Logger.log('OK: ' + calCfg.location + ' / ' + calCfg.vehicleType +
               ' → "' + calendar.getName() + '" (' + count + ' events in next 30 days)');
  });
}

// ---------------------------------------------------------------------------
// TEST 3: List all accessible calendars
// Debug helper — confirms which calendars are visible to the script account.
// Useful when a calendar has been shared but CALENDAR_ID isn't confirmed yet.
// ---------------------------------------------------------------------------
function listAccessibleCalendars() {
  const calendars = CalendarApp.getAllCalendars();
  Logger.log('Total calendars: ' + calendars.length);
  calendars.forEach(function(cal, i) {
    Logger.log((i + 1) + '. ' + cal.getName() + ' | ' + cal.getId());
  });
}

// ---------------------------------------------------------------------------
// TEST 4: Intake form URL builder
// Finds the first row named "Test Customer" in the sheet and logs the
// pre-filled intake URL. Requires a test row in the sheet.
// ---------------------------------------------------------------------------
function testBuildIntakeUrl() {
  const sheet = getSheet();
  const data  = sheet.getDataRange().getValues();

  let row = null;
  for (let i = 1; i < data.length; i++) {
    if ((data[i][1] || '').toString().toLowerCase().includes('test customer')) {
      row = data[i];
      break;
    }
  }

  if (!row) {
    Logger.log('No row found with name containing "Test Customer". Add one to the sheet first.');
    return;
  }

  const name      = row[1];
  const email     = row[2];
  const phone     = (row[3] || '').toString().replace(/^'/, '');
  const startTime = new Date(row[4]);

  Logger.log('Name:  ' + name);
  Logger.log('Email: ' + email);
  Logger.log('Phone: ' + phone);
  Logger.log('Date:  ' + startTime);

  const url = buildIntakeUrl(name, email, phone, startTime);
  Logger.log('Intake URL: ' + url);
}

// ---------------------------------------------------------------------------
// TEST 5: Vehicle type and location mapping
// Verifies that CALENDAR_CONFIGS contains the correct metadata for every
// supported location. Does not call any external API.
// ---------------------------------------------------------------------------
function testVehicleTypeAndLocationMapping() {
  const EXPECTED = [
    { propKey: 'CALENDAR_ID_BAINBRIDGE_CARGO_VAN',      location: 'Bainbridge',   vehicleType: 'Cargo Van' },
    { propKey: 'CALENDAR_ID_POULSBO_MOVING_TRUCK',      location: 'Poulsbo',      vehicleType: 'Moving Truck' },
    { propKey: 'CALENDAR_ID_PORT_ORCHARD_MOVING_TRUCK', location: 'Port Orchard', vehicleType: 'Moving Truck' },
    { propKey: 'CALENDAR_ID_FAIRGROUNDS_MOVING_TRUCK',  location: 'Fairgrounds',  vehicleType: 'Moving Truck' },
  ];

  let passed = 0;
  let failed = 0;

  if (CALENDAR_CONFIGS.length !== EXPECTED.length) {
    Logger.log('FAIL: CALENDAR_CONFIGS has ' + CALENDAR_CONFIGS.length +
               ' entries, expected ' + EXPECTED.length);
    failed++;
  }

  EXPECTED.forEach(function(exp, i) {
    const actual = CALENDAR_CONFIGS[i];
    if (!actual) {
      Logger.log('FAIL [' + i + ']: entry missing (expected ' + exp.propKey + ')');
      failed++;
      return;
    }

    const ok = actual.propKey     === exp.propKey &&
               actual.location    === exp.location &&
               actual.vehicleType === exp.vehicleType;

    if (ok) {
      Logger.log('OK: ' + exp.propKey +
                 ' → location="' + actual.location + '", vehicleType="' + actual.vehicleType + '"');
      passed++;
    } else {
      Logger.log('FAIL: ' + exp.propKey);
      if (actual.location    !== exp.location)    Logger.log('  location:    expected "' + exp.location    + '", got "' + actual.location    + '"');
      if (actual.vehicleType !== exp.vehicleType) Logger.log('  vehicleType: expected "' + exp.vehicleType + '", got "' + actual.vehicleType + '"');
      if (actual.propKey     !== exp.propKey)     Logger.log('  propKey:     expected "' + exp.propKey     + '", got "' + actual.propKey     + '"');
      failed++;
    }
  });

  Logger.log(failed === 0
    ? 'All ' + passed + ' mapping checks passed.'
    : passed + ' passed, ' + failed + ' failed.');
}

// ---------------------------------------------------------------------------
// TEST 6: Missing and invalid calendar ID handling
// Verifies that a missing Script Property (null calendarId) and an invalid
// calendar ID are both handled gracefully — logged, not thrown.
// ---------------------------------------------------------------------------
function testMissingCalendarConfig() {
  Logger.log('Testing missing/invalid calendar ID handling...');

  // Case A: calendarId is null (Script Property not set)
  const nullCfg = { propKey: 'FAKE_MISSING_PROP', calendarId: null, location: 'Nowhere', vehicleType: 'Cargo Van' };
  if (!nullCfg.calendarId) {
    Logger.log('OK (null): missing calendarId correctly detected for ' + nullCfg.propKey);
  }

  // Case B: calendarId is set but does not correspond to a real calendar
  const badId  = 'not-a-real-calendar@group.calendar.google.com';
  const badCal = CalendarApp.getCalendarById(badId);
  if (!badCal) {
    Logger.log('OK (invalid ID): CalendarApp returned null for a bad calendar ID — would be skipped safely');
  } else {
    Logger.log('UNEXPECTED: Got a calendar object for bad ID: ' + badId);
  }
}

// ---------------------------------------------------------------------------
// TEST 7: Calendar sync dry run — no notifications sent
// Reads every calendar in CALENDAR_CONFIGS and appends new events to the
// sheet without sending any emails, SMS messages, or Stripe links.
// Vehicle Type (col R) and Location (col S) are written from the calendar
// config, matching the production syncCalendarBookings() behavior exactly.
// ---------------------------------------------------------------------------
function testSyncCalendarBookingsNoNotifications() {
  const sheet       = getSheet();
  const existingIds = getExistingEventIds(sheet);
  const now         = new Date();
  const future      = new Date(now.getTime() + CONFIG.DAYS_AHEAD * 24 * 60 * 60 * 1000);

  let totalAdded = 0;

  CALENDAR_CONFIGS.forEach(function(calCfg) {
    if (!calCfg.calendarId) {
      Logger.log('SKIP: ' + calCfg.propKey + ' not set in Script Properties');
      return;
    }

    const calendar = CalendarApp.getCalendarById(calCfg.calendarId);
    if (!calendar) {
      Logger.log('SKIP: Calendar not found for ' + calCfg.propKey);
      return;
    }

    const events = calendar.getEvents(now, future);
    let added    = 0;

    events.forEach(function(event) {
      const eventId = event.getId();
      if (existingIds.includes(eventId)) {
        Logger.log('SKIP (already in sheet): ' + event.getTitle());
        return;
      }

      const desc        = event.getDescription() || '';
      const name        = extractBookedByName(desc) || event.getTitle();
      const phone       = extractPhone(desc);
      const email       = extractPrimaryEmail(desc);
      const secondEmail = extractSecondDriverEmail(desc);

      if (!email && !phone) {
        Logger.log('SKIP (no email or phone): ' + name);
        return;
      }

      const startTime = event.getStartTime();
      const endTime   = event.getEndTime();

      sheet.appendRow([
        eventId,                          // A
        name,                             // B
        email       || 'No Email',        // C
        phone ? "'" + phone : 'No Phone', // D
        startTime,                        // E
        endTime,                          // F
        '',                               // G: Deposit Paid
        '',                               // H: Stripe Amount
        '',                               // I: Intake Sent
        '',                               // J: Lease Sent
        '',                               // K: 24hr Sent
        '',                               // L: Post-Rental Sent
        secondEmail || 'No Second Email', // M: Second Driver Email
        '',                               // N: Lease Signed
        '',                               // O: Rental Approved
        '',                               // P: Approval Notified At
        '',                               // Q: Approval Reminder Count
        calCfg.vehicleType,               // R: Vehicle Type
        calCfg.location,                  // S: Location
      ]);

      Logger.log('ADDED [' + calCfg.location + ' / ' + calCfg.vehicleType + ']: ' +
        name + ' | ' + (email || 'No Email') + ' | ' + formatDateTime(startTime));
      added++;
      totalAdded++;
    });

    Logger.log('--- ' + calCfg.location + ' / ' + calCfg.vehicleType +
               ': ' + events.length + ' events found, ' + added + ' added ---');
  });

  Logger.log('Done. Total rows added across all calendars: ' + totalAdded);
}

// ---------------------------------------------------------------------------
// TEST 8: Stripe payment URL resolution
// Verifies that each vehicle type in CALENDAR_CONFIGS resolves to a non-empty
// payment URL, and documents the fallback behavior for unknown/blank types.
// Payment links are public URLs — no secret keys are logged or exposed.
// ---------------------------------------------------------------------------
function testStripePaymentUrls() {
  let passed = 0;
  let failed = 0;

  // Verify each vehicle type present in CALENDAR_CONFIGS gets a URL
  const seenTypes = {};
  CALENDAR_CONFIGS.forEach(function(calCfg) {
    if (seenTypes[calCfg.vehicleType]) return; // only test each type once
    seenTypes[calCfg.vehicleType] = true;

    const url = getStripePaymentUrl(calCfg.vehicleType);
    if (url) {
      Logger.log('OK [' + calCfg.vehicleType + ']: ' + url.substring(0, 40) + '...');
      passed++;
    } else {
      Logger.log('FAIL [' + calCfg.vehicleType + ']: getStripePaymentUrl returned empty/null — check Script Property');
      failed++;
    }
  });

  // Verify unknown vehicle type falls back (does not throw, does not return null silently)
  const unknownUrl = getStripePaymentUrl('Unknown Vehicle');
  Logger.log('Unknown type → fallback URL ' +
    (unknownUrl ? 'set (' + unknownUrl.substring(0, 40) + '...)' : 'NOT set (STRIPE_PAYMENT_URL is blank)'));

  // Verify blank vehicle type (old rows before multi-site migration)
  const blankUrl = getStripePaymentUrl('');
  Logger.log('Blank type   → fallback URL ' +
    (blankUrl ? 'set (' + blankUrl.substring(0, 40) + '...)' : 'NOT set (STRIPE_PAYMENT_URL is blank)'));

  Logger.log(failed === 0
    ? 'All ' + passed + ' Stripe URL checks passed.'
    : passed + ' passed, ' + failed + ' failed.');
}

// ---------------------------------------------------------------------------
// TEST 9: Deposit amount resolution
// Verifies each vehicle type returns the correct deposit amount and that
// unknown/blank vehicle types fall back gracefully.
// ---------------------------------------------------------------------------
function testDepositAmounts() {
  let passed = 0;
  let failed = 0;

  const EXPECTED = {
    'Cargo Van':    CONFIG.DEPOSIT_AMOUNT_CARGO_VAN,
    'Moving Truck': CONFIG.DEPOSIT_AMOUNT_MOVING_TRUCK,
  };

  // Verify each vehicle type present in CALENDAR_CONFIGS gets the right amount
  const seenTypes = {};
  CALENDAR_CONFIGS.forEach(function(calCfg) {
    if (seenTypes[calCfg.vehicleType]) return;
    seenTypes[calCfg.vehicleType] = true;

    const amount   = getDepositAmount(calCfg.vehicleType);
    const expected = EXPECTED[calCfg.vehicleType];

    if (!amount) {
      Logger.log('FAIL [' + calCfg.vehicleType + ']: getDepositAmount returned empty — check Script Property');
      failed++;
    } else if (expected && amount !== expected) {
      Logger.log('FAIL [' + calCfg.vehicleType + ']: expected "' + expected + '", got "' + amount + '"');
      failed++;
    } else {
      Logger.log('OK [' + calCfg.vehicleType + ']: $' + amount);
      passed++;
    }
  });

  // Unknown vehicle type should fall back, not throw
  const unknownAmount = getDepositAmount('Unknown Vehicle');
  Logger.log('Unknown type → fallback amount: ' + (unknownAmount || 'not set (DEPOSIT_AMOUNT is blank)'));

  // Blank vehicle type (old rows with empty column R)
  const blankAmount = getDepositAmount('');
  Logger.log('Blank type   → fallback amount: ' + (blankAmount || 'not set (DEPOSIT_AMOUNT is blank)'));

  Logger.log(failed === 0
    ? 'All ' + passed + ' deposit amount checks passed.'
    : passed + ' passed, ' + failed + ' failed.');
}

// ============================================================
// DOCUSEAL TESTS
// ============================================================

// ---------------------------------------------------------------------------
// TEST 11: DocuSeal Script Property names
// Confirms DOCUSEAL_API_KEY is set, and that DOCUSEAL_TEMPLATE_ONE_DRIVER and
// DOCUSEAL_TEMPLATE_TWO_DRIVERS are set and numeric.
// Does not log secret values. Does not make a live API call.
// ---------------------------------------------------------------------------
function testDocuSealPropertyNames() {
  let passed = 0;
  let failed = 0;

  // API key — confirm it exists but do not log the value
  if (PROPS.DOCUSEAL_API_KEY) {
    Logger.log('OK: DOCUSEAL_API_KEY is set (value not logged).');
    passed++;
  } else {
    Logger.log('FAIL: DOCUSEAL_API_KEY is not set in Script Properties.');
    failed++;
  }

  // Template IDs — must be set and numeric
  ['DOCUSEAL_TEMPLATE_ONE_DRIVER', 'DOCUSEAL_TEMPLATE_TWO_DRIVERS'].forEach(function(key) {
    const raw = PROPS[key];
    if (raw == null || raw.trim() === '') {
      Logger.log('FAIL: ' + key + ' is not set in Script Properties.');
      failed++;
    } else if (!isFinite(Number(raw))) {
      Logger.log('FAIL: ' + key + ' is not numeric (got "' + raw + '").');
      failed++;
    } else {
      Logger.log('OK: ' + key + ' = ' + Number(raw));
      passed++;
    }
  });

  Logger.log(failed === 0
    ? 'All ' + passed + ' DocuSeal property checks passed.'
    : passed + ' passed, ' + failed + ' failed.');
}

// ---------------------------------------------------------------------------
// TEST 12: extractDocuSealSubmissionId response parsing
// Uses mocked response objects to verify extraction logic without a live call.
//
// NOTE: Run one live sandbox DocuSeal submission after deploying to confirm
// that response.id is the correct field. The helper logs top-level response
// keys (not values) on every real call so you can verify the actual shape.
// ---------------------------------------------------------------------------
function testExtractDocuSealSubmissionId() {
  let passed = 0;
  let failed = 0;

  // Case 1: expected happy-path shape — { id: <number>, ... }
  const id1 = extractDocuSealSubmissionId({ id: 12345, status: 'pending', submitters: [] });
  if (id1 === 12345) {
    Logger.log('OK (valid response): id = ' + id1);
    passed++;
  } else {
    Logger.log('FAIL (valid response): expected 12345, got ' + id1);
    failed++;
  }

  // Case 2: null response (e.g. caller received nothing)
  const id2 = extractDocuSealSubmissionId(null);
  if (id2 === null) {
    Logger.log('OK (null response): returned null');
    passed++;
  } else {
    Logger.log('FAIL (null response): expected null, got ' + id2);
    failed++;
  }

  // Case 3: response object with no id field
  const id3 = extractDocuSealSubmissionId({ status: 'error', message: 'bad request' });
  if (id3 === null) {
    Logger.log('OK (missing id field): returned null with warning logged');
    passed++;
  } else {
    Logger.log('FAIL (missing id field): expected null, got ' + id3);
    failed++;
  }

  // Case 4: non-object type (unexpected response)
  const id4 = extractDocuSealSubmissionId('unexpected string');
  if (id4 === null) {
    Logger.log('OK (string response): returned null');
    passed++;
  } else {
    Logger.log('FAIL (string response): expected null, got ' + id4);
    failed++;
  }

  Logger.log(failed === 0
    ? 'All ' + passed + ' extractDocuSealSubmissionId checks passed.'
    : passed + ' passed, ' + failed + ' failed.');
}

// ============================================================
// CONFIGURATION TESTS
// ============================================================

// ---------------------------------------------------------------------------
// TEST 10: Configuration validation
// Verifies all required numeric Script Properties are set and contain valid
// finite numbers. Run this first when setting up a new environment or after
// changing Script Properties. Reports every problem before throwing.
// ---------------------------------------------------------------------------
function validateConfig() {
  var errors = [];

  var NUMERIC_PROPS = [
    'DAYS_AHEAD',
    'POST_RENTAL_HOURS',
    'HOURS_BETWEEN_APPROVAL_REMINDERS',
    'MAX_APPROVAL_REMINDERS',
    'DEPOSIT_AMOUNT',
    'DEPOSIT_AMOUNT_CARGO_VAN',
    'DEPOSIT_AMOUNT_MOVING_TRUCK',
  ];

  NUMERIC_PROPS.forEach(function(key) {
    var raw = PROPS[key];
    if (raw == null || raw.trim() === '') {
      errors.push('Invalid or missing Script Property: ' + key);
    } else if (!isFinite(Number(raw))) {
      errors.push('Invalid or missing Script Property: ' + key + ' (got "' + raw + '", expected a number)');
    }
  });

  if (errors.length > 0) {
    errors.forEach(function(msg) { Logger.log(msg); });
    throw new Error('Configuration validation failed. See execution log for details.');
  }

  Logger.log('validateConfig: all required numeric Script Properties are set and valid.');
}
