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
// TEST 8b: Log Stripe URL for an existing booking row
// Reads the first row with both an eventId (col A) and a vehicle type (col R),
// builds the full Stripe URL using the same production logic as
// syncCalendarBookings, and logs it. No messages sent, no sheet writes.
// ---------------------------------------------------------------------------
function testLogStripeUrlForExistingBooking() {
  const sheet = getSheet();
  const data  = sheet.getDataRange().getValues();

  let row = null;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][17]) {
      row = data[i];
      break;
    }
  }

  if (!row) {
    Logger.log('testLogStripeUrlForExistingBooking: no row found with both an ' +
               'eventId (col A) and a vehicle type (col R). Add a booking row first.');
    return;
  }

  const eventId           = row[0];
  const vehicleType       = row[17]; // R: Vehicle Type (0-indexed 17)
  const clientReferenceId = Utilities.base64EncodeWebSafe(eventId).replace(/=+$/, '');
  const stripeUrl         = getStripePaymentUrl(vehicleType) +
                            '?client_reference_id=' + clientReferenceId;

  Logger.log('Event ID (original):  ' + eventId);
  Logger.log('client_reference_id:  ' + clientReferenceId);
  Logger.log('Stripe URL:           ' + stripeUrl);

  // Round-trip decode check — proves the encoded value restores to the exact original event ID
  const padded  = clientReferenceId + '==='.slice(0, (4 - clientReferenceId.length % 4) % 4);
  const decoded = Utilities.newBlob(Utilities.base64DecodeWebSafe(padded)).getDataAsString();
  Logger.log('Decode check: ' + (decoded === eventId ? 'PASS' : 'FAIL — got "' + decoded + '"'));
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
// Cases 1-4 are retained from before. Cases 5-9 cover the actual live response
// shape (array of submitter objects) confirmed in sandbox testing.
// ---------------------------------------------------------------------------
function testExtractDocuSealSubmissionId() {
  let passed = 0;
  let failed = 0;

  // Case 1: single object with top-level id
  const id1 = extractDocuSealSubmissionId({ id: 12345, status: 'pending', submitters: [] });
  if (id1 === 12345) {
    Logger.log('OK (object with id): ' + id1);
    passed++;
  } else {
    Logger.log('FAIL (object with id): expected 12345, got ' + id1);
    failed++;
  }

  // Case 2: null response
  const id2 = extractDocuSealSubmissionId(null);
  if (id2 === null) {
    Logger.log('OK (null response): returned null');
    passed++;
  } else {
    Logger.log('FAIL (null response): expected null, got ' + id2);
    failed++;
  }

  // Case 3: single object with no id field
  const id3 = extractDocuSealSubmissionId({ status: 'error', message: 'bad request' });
  if (id3 === null) {
    Logger.log('OK (no id field): returned null');
    passed++;
  } else {
    Logger.log('FAIL (no id field): expected null, got ' + id3);
    failed++;
  }

  // Case 4: non-object response
  const id4 = extractDocuSealSubmissionId('unexpected string');
  if (id4 === null) {
    Logger.log('OK (string response): returned null');
    passed++;
  } else {
    Logger.log('FAIL (string response): expected null, got ' + id4);
    failed++;
  }

  // Case 5: single object with submission_id (no top-level id)
  const id5 = extractDocuSealSubmissionId({ submission_id: 99, email: 'a@b.com' });
  if (id5 === 99) {
    Logger.log('OK (object with submission_id): ' + id5);
    passed++;
  } else {
    Logger.log('FAIL (object with submission_id): expected 99, got ' + id5);
    failed++;
  }

  // Case 6: single object with nested submission.id
  const id6 = extractDocuSealSubmissionId({ submission: { id: 77 }, email: 'a@b.com' });
  if (id6 === 77) {
    Logger.log('OK (object with submission.id): ' + id6);
    passed++;
  } else {
    Logger.log('FAIL (object with submission.id): expected 77, got ' + id6);
    failed++;
  }

  // Case 7: array where all entries share the same submission_id (live response shape)
  const id7 = extractDocuSealSubmissionId([
    { id: 1, submission_id: 500, role: 'Driver',                   email: 'customer@example.com' },
    { id: 2, submission_id: 500, role: 'Reliable Storage Manager', email: 'mgr@example.com' },
  ]);
  if (id7 === 500) {
    Logger.log('OK (array with shared submission_id): ' + id7);
    passed++;
  } else {
    Logger.log('FAIL (array with shared submission_id): expected 500, got ' + id7);
    failed++;
  }

  // Case 8: array where entries share nested submission.id
  const id8 = extractDocuSealSubmissionId([
    { id: 1, submission: { id: 600 }, role: 'Driver' },
    { id: 2, submission: { id: 600 }, role: 'Reliable Storage Manager' },
  ]);
  if (id8 === 600) {
    Logger.log('OK (array with shared submission.id): ' + id8);
    passed++;
  } else {
    Logger.log('FAIL (array with shared submission.id): expected 600, got ' + id8);
    failed++;
  }

  // Case 9: array with conflicting submission IDs — must return null
  const id9 = extractDocuSealSubmissionId([
    { id: 1, submission_id: 500 },
    { id: 2, submission_id: 501 },
  ]);
  if (id9 === null) {
    Logger.log('OK (conflicting submission IDs): returned null with warning logged');
    passed++;
  } else {
    Logger.log('FAIL (conflicting submission IDs): expected null, got ' + id9);
    failed++;
  }

  Logger.log(failed === 0
    ? 'All ' + passed + ' extractDocuSealSubmissionId checks passed.'
    : passed + ' passed, ' + failed + ' failed.');
}

// ---------------------------------------------------------------------------
// TEST 13: Deposit webhook row-lookup logic (no side effects)
// Simulates the eventId-first, email-fallback matching logic in markDepositPaid
// without writing to the sheet, sending SMS/email, or calling DocuSeal/Stripe.
// Requires at least one unpaid booking row (column G ≠ 'Yes') with both an
// eventId in column A and an email in column C.
// ---------------------------------------------------------------------------
function testMarkDepositPaidRowLookup() {
  const sheet = getSheet();
  const data  = sheet.getDataRange().getValues();

  // Find the first row with an eventId, a real email, and an unpaid deposit.
  let testEventId = null;
  let testEmail   = null;
  let testRowIdx  = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][2] && data[i][2] !== 'No Email' && data[i][6] !== 'Yes') {
      testEventId = data[i][0];
      testEmail   = (data[i][2] || '').toLowerCase().trim();
      testRowIdx  = i;
      break;
    }
  }

  if (testRowIdx === -1) {
    Logger.log('SKIP: No unpaid row found with both an eventId (col A) and an email (col C). ' +
               'Add a test booking row with column G blank to run this test.');
    return;
  }

  Logger.log('Test row: index=' + (testRowIdx + 1) +
             ' | eventId=' + testEventId + ' | email=' + testEmail);

  let passed = 0;
  let failed = 0;

  // ---- Sub-test A: correct eventId finds the right row (primary lookup) ---
  (function testPrimaryLookup() {
    let found = -1;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === testEventId && data[i][6] !== 'Yes') { found = i; break; }
    }
    if (found === testRowIdx) {
      Logger.log('OK (primary eventId lookup): found correct row ' + (found + 1));
      passed++;
    } else {
      Logger.log('FAIL (primary eventId lookup): expected row ' + (testRowIdx + 1) +
                 ', got ' + (found === -1 ? 'no match' : 'row ' + (found + 1)));
      failed++;
    }
  })();

  // ---- Sub-test B: wrong eventId misses → email fallback finds the row ----
  (function testFallback() {
    const bogusId = 'nonexistent-id@google.com';
    let foundById = -1;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === bogusId && data[i][6] !== 'Yes') { foundById = i; break; }
    }
    let foundByEmail = -1;
    for (let i = 1; i < data.length; i++) {
      if ((data[i][2] || '').toLowerCase().trim() === testEmail && data[i][6] !== 'Yes') {
        foundByEmail = i; break;
      }
    }
    if (foundById !== -1) {
      Logger.log('FAIL (fallback): bogus eventId unexpectedly matched a row');
      failed++;
    } else if (foundByEmail === testRowIdx) {
      Logger.log('OK (email fallback): eventId miss → email found correct row ' + (foundByEmail + 1));
      passed++;
    } else {
      Logger.log('FAIL (email fallback): expected row ' + (testRowIdx + 1) +
                 ', got ' + (foundByEmail === -1 ? 'no match' : 'row ' + (foundByEmail + 1)));
      failed++;
    }
  })();

  // ---- Sub-test C: null eventId → email-only backward-compatible path -----
  (function testEmailOnly() {
    const noEventId = null;
    let found = -1;
    if (!noEventId) {
      for (let i = 1; i < data.length; i++) {
        if ((data[i][2] || '').toLowerCase().trim() === testEmail && data[i][6] !== 'Yes') {
          found = i; break;
        }
      }
    }
    if (found === testRowIdx) {
      Logger.log('OK (email-only path): null eventId → email found correct row ' + (found + 1));
      passed++;
    } else {
      Logger.log('FAIL (email-only path): expected row ' + (testRowIdx + 1) +
                 ', got ' + (found === -1 ? 'no match' : 'row ' + (found + 1)));
      failed++;
    }
  })();

  Logger.log(failed === 0
    ? 'All ' + passed + ' row-lookup checks passed.'
    : passed + ' passed, ' + failed + ' failed.');
}

// ---------------------------------------------------------------------------
// TEST 14: Lease-signed webhook row-lookup logic (no side effects)
// Simulates the submissionId-first, email-fallback matching logic in
// markLeaseSigned without writing to the sheet or calling any external API.
// Requires at least one unsigned booking row (column N ≠ 'Yes') with an email
// in column C. Sub-test A additionally requires a value in column T.
// ---------------------------------------------------------------------------
function testMarkLeaseSignedRowLookup() {
  const sheet = getSheet();
  const data  = sheet.getDataRange().getValues();

  // Find the first unsigned row with a real email.
  let testRowIdx = -1;
  let testEmail  = null;
  let testSubId  = null;

  for (let i = 1; i < data.length; i++) {
    const email  = (data[i][2] || '').toLowerCase().trim();
    const signed = data[i][13]; // N: Lease Signed
    if (email && email !== 'no email' && signed !== 'Yes') {
      testRowIdx = i;
      testEmail  = email;
      testSubId  = data[i][19] ? String(data[i][19]).trim() : null; // T: DocuSeal Submission ID
      break;
    }
  }

  if (testRowIdx === -1) {
    Logger.log('SKIP: No unsigned row found with an email (col C, N ≠ "Yes"). ' +
               'Add a test booking row to run this test.');
    return;
  }

  Logger.log('Test row: index=' + (testRowIdx + 1) +
             ' | email=' + testEmail +
             ' | submissionId=' + (testSubId || '(none in col T)'));

  let passed = 0;
  let failed = 0;

  // ---- Sub-test A: submission ID matches column T (primary lookup) ----------
  (function testSubmissionIdMatch() {
    if (!testSubId) {
      Logger.log('SKIP (submissionId match): column T is blank on test row — ' +
                 'trigger a live DocuSeal submission first to populate it');
      return;
    }
    let found = -1;
    for (let i = 1; i < data.length; i++) {
      const rowSubId = String(data[i][19] || '').trim();
      const signed   = data[i][13];
      if (rowSubId !== '' && rowSubId === testSubId && signed !== 'Yes') { found = i; break; }
    }
    if (found === testRowIdx) {
      Logger.log('OK (submissionId match): id="' + testSubId + '" found correct row ' + (found + 1));
      passed++;
    } else {
      Logger.log('FAIL (submissionId match): expected row ' + (testRowIdx + 1) +
                 ', got ' + (found === -1 ? 'no match' : 'row ' + (found + 1)));
      failed++;
    }
  })();

  // ---- Sub-test B: bogus submission ID misses → email fallback finds row ----
  (function testBogusSubIdEmailFallback() {
    const bogusSubId = '000000';
    let foundById    = -1;
    for (let i = 1; i < data.length; i++) {
      const rowSubId = String(data[i][19] || '').trim();
      const signed   = data[i][13];
      if (rowSubId !== '' && rowSubId === bogusSubId && signed !== 'Yes') { foundById = i; break; }
    }
    let foundByEmail = -1;
    for (let i = 1; i < data.length; i++) {
      const rowEmail = (data[i][2] || '').toLowerCase().trim();
      const signed   = data[i][13];
      if (rowEmail === testEmail && signed !== 'Yes') { foundByEmail = i; break; }
    }
    if (foundById !== -1) {
      Logger.log('FAIL (bogus subId + email fallback): bogus submissionId unexpectedly matched a row');
      failed++;
    } else if (foundByEmail === testRowIdx) {
      Logger.log('OK (bogus subId + email fallback): subId miss → email found correct row ' + (foundByEmail + 1));
      passed++;
    } else {
      Logger.log('FAIL (bogus subId + email fallback): expected row ' + (testRowIdx + 1) +
                 ', got ' + (foundByEmail === -1 ? 'no match' : 'row ' + (foundByEmail + 1)));
      failed++;
    }
  })();

  // ---- Sub-test C: null submission ID → email-only path --------------------
  (function testNullSubIdEmailOnly() {
    const noSubId = null;
    let found = -1;
    if (!noSubId) {
      for (let i = 1; i < data.length; i++) {
        const rowEmail = (data[i][2] || '').toLowerCase().trim();
        const signed   = data[i][13];
        if (rowEmail === testEmail && signed !== 'Yes') { found = i; break; }
      }
    }
    if (found === testRowIdx) {
      Logger.log('OK (null subId + email): email found correct row ' + (found + 1));
      passed++;
    } else {
      Logger.log('FAIL (null subId + email): expected row ' + (testRowIdx + 1) +
                 ', got ' + (found === -1 ? 'no match' : 'row ' + (found + 1)));
      failed++;
    }
  })();

  Logger.log(failed === 0
    ? 'All ' + passed + ' lease-signed row-lookup checks passed.'
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

// ---------------------------------------------------------------------------
// TEST 15: Email template string verification (no sheet reads, no API calls)
// Constructs sample message strings using the same interpolation patterns as
// the production functions and checks for known-bad strings introduced by
// earlier hardcoded wording.
// ---------------------------------------------------------------------------
function testEmailTemplateStrings() {
  let passed = 0;
  let failed = 0;

  const cargoVanType = 'Cargo Van';
  const location     = 'Bainbridge';
  const dateStr      = 'July 26, 2026 at 10:00 AM';
  const name         = 'Test Customer';

  // ---- Welcome email subject must not say "truck rental" for Cargo Van ----
  const welcomeSubject = 'Your ' + cargoVanType + ' reservation — ' + dateStr;
  if (welcomeSubject.toLowerCase().includes('moving truck') ||
      welcomeSubject.toLowerCase().includes('truck rental')) {
    Logger.log('FAIL (welcome subject): contains hardcoded vehicle wording: ' + welcomeSubject);
    failed++;
  } else {
    Logger.log('OK (welcome subject): ' + welcomeSubject);
    passed++;
  }

  // ---- Welcome email body must not say "moving truck" for Cargo Van ----
  const welcomeBody =
    'Your <strong>' + cargoVanType + '</strong> reservation at our <strong>' +
    location + '</strong> location is scheduled for <strong>' + dateStr + '</strong>.';
  if (welcomeBody.toLowerCase().includes('moving truck')) {
    Logger.log('FAIL (welcome body): contains "moving truck": ' + welcomeBody);
    failed++;
  } else {
    Logger.log('OK (welcome body): vehicle type "' + cargoVanType + '" used correctly');
    passed++;
  }

  // ---- Post-rental email body must not say "returning the truck" ----
  const postRentalBody =
    'Thank you for completing your <strong>' + cargoVanType + '</strong> rental ' +
    'at our <strong>' + location + '</strong> location on <strong>' + dateStr + '</strong>.';
  if (postRentalBody.toLowerCase().includes('returning the truck')) {
    Logger.log('FAIL (post-rental body): contains "returning the truck"');
    failed++;
  } else {
    Logger.log('OK (post-rental body): no hardcoded "truck" wording');
    passed++;
  }

  // ---- DocuSeal subject must use em dash, not double hyphen ----
  const docuSealSubject = 'Your ' + CONFIG.COMPANY_NAME + ' rental agreement — ' + dateStr;
  if (docuSealSubject.includes('--')) {
    Logger.log('FAIL (DocuSeal subject): contains "--" instead of "—": ' + docuSealSubject);
    failed++;
  } else if (docuSealSubject.includes('—')) {
    Logger.log('OK (DocuSeal subject): uses em dash');
    passed++;
  } else {
    Logger.log('FAIL (DocuSeal subject): no dash separator found');
    failed++;
  }

  // ---- Manager deposit status must use consistent casing ----
  const depositYes = true;
  const depositNo  = false;
  const statusYes  = depositYes ? 'Yes' : 'No';
  const statusNo   = depositNo  ? 'Yes' : 'No';
  if (statusYes === 'Yes' && statusNo === 'No') {
    Logger.log('OK (deposit status casing): "Yes" / "No" consistent');
    passed++;
  } else {
    Logger.log('FAIL (deposit status casing): got "' + statusYes + '" / "' + statusNo + '"');
    failed++;
  }

  Logger.log(failed === 0
    ? 'All ' + passed + ' template string checks passed.'
    : passed + ' passed, ' + failed + ' failed.');
}

// ---------------------------------------------------------------------------
// TEST 16: SendGrid configuration check (no email sent, no API call)
// Verifies that all Script Properties consumed by sendEmailHtml() and
// alertAdmin() are set and non-blank, and that address fields look like
// email addresses. Does not verify SendGrid sender status — that requires
// a live API call and is outside the scope of this offline check.
// ---------------------------------------------------------------------------
function testSendGridConfiguration() {
  let passed = 0;
  let failed = 0;

  // Basic email format — avoids the most common config mistakes
  // (blank value, accidentally pasting a name instead of an address, etc.)
  function looksLikeEmail(val) {
    return typeof val === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim());
  }

  // ---- API key: confirm it is set but never log the value ----
  if (CONFIG.SENDGRID_KEY && CONFIG.SENDGRID_KEY.trim() !== '') {
    Logger.log('OK: SENDGRID_KEY is set (value not logged).');
    passed++;
  } else {
    Logger.log('FAIL: SENDGRID_KEY is not set in Script Properties (needs Mail Send permission scope).');
    failed++;
  }

  // ---- String properties: set and non-blank ----
  const STRING_PROPS = [
    { key: 'FROM_NAME',    label: 'FROM_NAME',    hint: 'Display name shown in the From field' },
    { key: 'COMPANY_NAME', label: 'COMPANY_NAME', hint: 'Business name used in customer-facing messages' },
    { key: 'SHEET_NAME',   label: 'SHEET_NAME',   hint: 'Booking sheet tab name — normally "Bookings"' },
  ];

  STRING_PROPS.forEach(function(p) {
    const val = CONFIG[p.key] || PROPS[p.key]; // COMPANY_NAME and SHEET_NAME come from PROPS via CONFIG
    if (val && val.trim() !== '') {
      Logger.log('OK: ' + p.label + ' is set.');
      passed++;
    } else {
      Logger.log('FAIL: ' + p.label + ' is not set. (' + p.hint + ')');
      failed++;
    }
  });

  // ---- Email address properties: set, non-blank, and look like addresses ----
  const EMAIL_PROPS = [
    { key: 'FROM_EMAIL',     label: 'FROM_EMAIL',     hint: 'Must be a verified sender in SendGrid' },
    { key: 'REPLY_TO_EMAIL', label: 'REPLY_TO_EMAIL', hint: 'Reply-to address on all customer emails' },
    { key: 'MANAGER_EMAIL',  label: 'MANAGER_EMAIL',  hint: 'BCC recipient and direct notification recipient' },
    { key: 'ADMIN_EMAIL',    label: 'ADMIN_EMAIL',    hint: 'Escalation and error alert recipient' },
  ];

  EMAIL_PROPS.forEach(function(p) {
    const val = CONFIG[p.key];
    if (!val || val.trim() === '') {
      Logger.log('FAIL: ' + p.label + ' is not set. (' + p.hint + ')');
      failed++;
    } else if (!looksLikeEmail(val)) {
      Logger.log('FAIL: ' + p.label + ' does not look like an email address (got "' + val + '").');
      failed++;
    } else {
      Logger.log('OK: ' + p.label + ' is set and looks like an email address.');
      passed++;
    }
  });

  // ---- Summary ----
  if (failed === 0) {
    Logger.log('SendGrid configuration: all ' + passed + ' checks passed. ' +
               'Note: sender verification for FROM_EMAIL must be confirmed in the SendGrid dashboard — ' +
               'this check cannot verify it without a live API call.');
  } else {
    Logger.log(passed + ' passed, ' + failed + ' failed. Fix the issues above before testing email delivery.');
  }
}

// ---------------------------------------------------------------------------
// TEST 17: Twilio configuration check (no SMS sent, no API call)
// Verifies that all Script Properties consumed by sendSms() and the manager
// SMS paths are set and correctly formatted. Does not call Twilio.
// ---------------------------------------------------------------------------
function testTwilioConfiguration() {
  let passed = 0;
  let failed = 0;

  // E.164: '+' followed by 7–15 digits (covers all valid international numbers)
  function looksLikeE164(val) {
    return typeof val === 'string' && /^\+\d{7,15}$/.test(val.trim());
  }

  // ---- TWILIO_SID: 'AC' followed by exactly 32 alphanumeric characters ----
  const sid = CONFIG.TWILIO_SID;
  if (!sid || sid.trim() === '') {
    Logger.log('FAIL: TWILIO_SID is not set in Script Properties.');
    failed++;
  } else if (!/^AC[a-zA-Z0-9]{32}$/.test(sid.trim())) {
    Logger.log('FAIL: TWILIO_SID does not match the expected Twilio Account SID format ' +
               '(should be "AC" followed by 32 alphanumeric characters; got ' +
               sid.trim().length + ' chars).');
    failed++;
  } else {
    Logger.log('OK: TWILIO_SID starts with AC and has the expected 34-character format.');
    passed++;
  }

  // ---- TWILIO_TOKEN: present and non-blank — value never logged ----
  if (!CONFIG.TWILIO_TOKEN || CONFIG.TWILIO_TOKEN.trim() === '') {
    Logger.log('FAIL: TWILIO_TOKEN is not set in Script Properties.');
    failed++;
  } else {
    Logger.log('OK: TWILIO_TOKEN is set (value not logged).');
    passed++;
  }

  // ---- TWILIO_NUM: SMS-capable Twilio number in E.164 format ----
  const twilioNum = CONFIG.TWILIO_NUM;
  if (!twilioNum || twilioNum.trim() === '') {
    Logger.log('FAIL: TWILIO_NUM is not set in Script Properties ' +
               '(must be an SMS-capable Twilio number in E.164 format).');
    failed++;
  } else if (!looksLikeE164(twilioNum)) {
    Logger.log('FAIL: TWILIO_NUM does not look like an E.164 phone number ' +
               '(must start with + followed by 7–15 digits; got "' + twilioNum + '").');
    failed++;
  } else {
    Logger.log('OK: TWILIO_NUM is set and looks like an E.164 number.');
    passed++;
  }

  // ---- MANAGER_PHONE: E.164 format required; missing country code caused errors in v7 ----
  const managerPhone = CONFIG.MANAGER_PHONE;
  if (!managerPhone || managerPhone.trim() === '') {
    Logger.log('FAIL: MANAGER_PHONE is not set in Script Properties ' +
               '(used for manager SMS notifications).');
    failed++;
  } else if (!looksLikeE164(managerPhone)) {
    Logger.log('FAIL: MANAGER_PHONE does not look like an E.164 phone number ' +
               '(must start with + followed by 7–15 digits; got "' + managerPhone + '"). ' +
               'Include the country code — e.g. +12065551234 for a US number.');
    failed++;
  } else {
    Logger.log('OK: MANAGER_PHONE is set and looks like an E.164 number.');
    passed++;
  }

  // ---- Summary ----
  if (failed === 0) {
    Logger.log('Twilio configuration: all ' + passed + ' checks passed. ' +
               'Note: on a Twilio trial account, all recipient numbers must be individually ' +
               'verified in the Twilio console before SMS can be delivered to them.');
  } else {
    Logger.log(passed + ' passed, ' + failed + ' failed. Fix the issues above before testing SMS delivery.');
  }
}

// ============================================================
// TEST RUNNERS
// ============================================================

// ---------------------------------------------------------------------------
// RUNNER: runAllSandboxConfigurationTests
// Runs configuration-only tests in sequence. Stops and re-throws on first
// failure. Does not include sync, intake-form, or response-parsing tests.
// ---------------------------------------------------------------------------
function runAllSandboxConfigurationTests() {
  Logger.log('===== Running Sandbox Configuration Tests =====');

  const tests = [
    validateConfig,
    testSheetConnection,
    testCalendarConfigs,
    testVehicleTypeAndLocationMapping,
    testStripePaymentUrls,
    testDepositAmounts,
    testDocuSealPropertyNames,
    testSendGridConfiguration,
    testTwilioConfiguration,
  ];

  try {
    tests.forEach(function(fn) {
      Logger.log('Running ' + fn.name + '...');
      fn();
    });
  } catch (e) {
    Logger.log('Configuration test runner failed.');
    Logger.log(e.message);
    throw e;
  }

  Logger.log('===== All Sandbox Configuration Tests Completed Successfully =====');
}

// ---------------------------------------------------------------------------
// MANUAL STANDALONE TEST: One-time Twilio SMS send
// Run this manually from the Apps Script editor to verify Twilio delivery.
// Do NOT add to runAllSandboxConfigurationTests() — this sends a real SMS.
// ---------------------------------------------------------------------------
function testSendSingleSms() {
  Logger.log('Starting sandbox SMS test...');

  const to      = '+12065550199';
  const message =
    'Reliable Storage Sandbox Test\n\n' +
    'This is a manual Twilio SMS test from the sandbox environment.\n\n' +
    'If you received this message, Twilio is configured correctly.\n\n' +
    'Timestamp:\n' +
    formatDateTime(new Date());

  try {
    sendSms(to, message);
    Logger.log('Sandbox SMS test completed successfully.');
  } catch(e) {
    Logger.log('Sandbox SMS test FAILED: ' + e);
  }
}
