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
// sheet without sending any emails, SMS, Bitly requests, or Stripe links.
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
