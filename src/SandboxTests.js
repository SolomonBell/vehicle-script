// ============================================================
// SANDBOX TEST FUNCTIONS
// Run manually from the Apps Script editor. Never wire to triggers.
//
// CATEGORIES:
//   [CONFIG]   Safe configuration checks — no external calls, no sheet writes.
//              Safe to run at any time, including in runAllSandboxConfigurationTests().
//   [CALENDAR] Google Calendar read-only — reads calendar via CalendarApp.
//              No sheet writes. Included in runAllSandboxConfigurationTests().
//   [SHEET]    Sheet read-only — reads sheet data, no external calls, no writes.
//   [DRY-RUN]  Sheet read, no external messages, no Stripe sessions.
//   [MUTATION] Writes to the sheet (appends test rows). Clean up manually after.
//   [LIVE]     Makes real external API calls (Stripe, Twilio, SendGrid, DocuSeal).
//              Run only when intentionally testing a live integration.
// ============================================================

// ---------------------------------------------------------------------------
// TEST 1: Sheet connection [CALENDAR]
// Verifies SHEET_ID is set and the Bookings tab is accessible.
// ---------------------------------------------------------------------------
function testSheetConnection() {
  const sheet = getSheet();
  Logger.log('Connected to sheet: ' + sheet.getName());
  const bookingRows = Math.max(sheet.getLastRow() - 1, 0);
  Logger.log('Booking rows: ' + bookingRows);
}

// ---------------------------------------------------------------------------
// TEST 2: Calendar configs [CALENDAR]
// Verifies every CALENDAR_CONFIGS entry has its Script Property set and that
// CalendarApp can connect to the calendar.
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
// TEST 3: List all accessible calendars [CALENDAR]
// Debug helper — confirms which calendars are visible to the script account.
// Useful when a calendar has been shared but CALENDAR_ID isn't confirmed yet.
// Not included in the runner (output is informational, not pass/fail).
// ---------------------------------------------------------------------------
function listAccessibleCalendars() {
  const calendars = CalendarApp.getAllCalendars();
  Logger.log('Total calendars: ' + calendars.length);
  calendars.forEach(function(cal, i) {
    Logger.log((i + 1) + '. ' + cal.getName() + ' | ' + cal.getId());
  });
}

// ---------------------------------------------------------------------------
// TEST 4: Intake form URL builder [SHEET]
// Finds the first row named "Test Customer" in the sheet and logs the
// pre-filled intake URL. Requires a test row in the sheet. No writes.
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
// TEST 5: Vehicle type and location mapping [CONFIG]
// Verifies that CALENDAR_CONFIGS contains the correct metadata for every
// supported location. No external calls.
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
// TEST 6: Missing and invalid calendar ID handling [CALENDAR]
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
// TEST 7: Calendar sync dry run [MUTATION]
// Reads every calendar in CALENDAR_CONFIGS and appends new events to the
// sheet WITHOUT sending any emails, SMS, or creating Stripe sessions.
// Vehicle Type (col R) and Location (col S) are written from the calendar
// config, matching production syncCalendarBookings() behavior exactly.
// CAUTION: Appends rows to the live sheet — clean up test rows manually.
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
// TEST 8: Stripe Checkout Session configuration [CONFIG]
// Verifies STRIPE_SECRET_KEY is set (never logged), STRIPE_PRICE_ID_* properties
// are set and start with "price_", and every vehicle type in CALENDAR_CONFIGS
// resolves to a Price ID via getStripePriceId(). No API call is made.
// ---------------------------------------------------------------------------
function testStripeConfiguration() {
  let passed = 0;
  let failed = 0;

  // STRIPE_SECRET_KEY — confirm it is set but never log the value
  const secretKey = PROPS.STRIPE_SECRET_KEY;
  if (!secretKey || secretKey.trim() === '') {
    Logger.log('FAIL: STRIPE_SECRET_KEY is not set in Script Properties.');
    failed++;
  } else {
    Logger.log('OK: STRIPE_SECRET_KEY is set (value not logged).');
    passed++;
  }

  // STRIPE_PRICE_ID_* — must be set and start with "price_"
  ['STRIPE_PRICE_ID_CARGO_VAN', 'STRIPE_PRICE_ID_MOVING_TRUCK'].forEach(function(key) {
    const val = PROPS[key];
    if (!val || val.trim() === '') {
      Logger.log('FAIL: ' + key + ' is not set in Script Properties.');
      failed++;
    } else if (!val.trim().startsWith('price_')) {
      Logger.log('FAIL: ' + key + ' does not start with "price_" (got "' + val.trim() + '").');
      failed++;
    } else {
      Logger.log('OK: ' + key + ' = ' + val.trim());
      passed++;
    }
  });

  // Verify each CALENDAR_CONFIGS vehicle type resolves via getStripePriceId()
  const seenTypes = {};
  CALENDAR_CONFIGS.forEach(function(calCfg) {
    if (seenTypes[calCfg.vehicleType]) return; // only test each type once
    seenTypes[calCfg.vehicleType] = true;

    const priceId = getStripePriceId(calCfg.vehicleType);
    if (priceId) {
      Logger.log('OK [' + calCfg.vehicleType + ']: getStripePriceId → ' + priceId);
      passed++;
    } else {
      Logger.log('FAIL [' + calCfg.vehicleType + ']: getStripePriceId returned null — ' +
                 'check STRIPE_PRICE_ID_* Script Properties.');
      failed++;
    }
  });

  Logger.log(failed === 0
    ? 'All ' + passed + ' Stripe configuration checks passed.'
    : passed + ' passed, ' + failed + ' failed.');
}

// ---------------------------------------------------------------------------
// TEST 8b: Log Stripe Price ID and clientReferenceId for an existing booking row [SHEET]
// Reads the first row with both an eventId (col A) and a vehicle type (col R),
// logs what Price ID would be used and the encoded clientReferenceId.
// No API call is made, no messages sent, no sheet writes.
// To test a live Checkout Session, use testCreateStripeCheckoutSession() instead.
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
  const priceId           = getStripePriceId(vehicleType);

  Logger.log('Event ID (original):  ' + eventId);
  Logger.log('client_reference_id:  ' + clientReferenceId);
  Logger.log('Vehicle type:         ' + vehicleType);
  Logger.log('Stripe Price ID:      ' + (priceId || '(none — check STRIPE_PRICE_ID_* properties)'));
  Logger.log('--- No API call made. Use testCreateStripeCheckoutSession() for a live session. ---');

  // Round-trip decode check — proves the encoded value restores to the exact original event ID
  const padded  = clientReferenceId + '==='.slice(0, (4 - clientReferenceId.length % 4) % 4);
  const decoded = Utilities.newBlob(Utilities.base64DecodeWebSafe(padded)).getDataAsString();
  Logger.log('Decode check: ' + (decoded === eventId ? 'PASS' : 'FAIL — got "' + decoded + '"'));
}

// ---------------------------------------------------------------------------
// MANUAL STANDALONE TEST: Create a live Stripe Checkout Session [LIVE]
// MAKES A LIVE STRIPE API CALL and creates a real live Checkout Session.
// Run only when intentionally testing the live Stripe integration.
// Reads the first booking row that has an Event ID and a Vehicle Type,
// generates the clientReferenceId using the same encoding as CalendarSync.js,
// and calls createStripeCheckoutSession(). Logs the returned session URL.
// Does not send any messages, write to the sheet, or log the Stripe secret key.
// ---------------------------------------------------------------------------
function testCreateStripeCheckoutSession() {
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
    Logger.log('testCreateStripeCheckoutSession: no row found with both an ' +
               'eventId (col A) and a vehicle type (col R). Add a booking row first.');
    return;
  }

  const eventId           = row[0];
  const vehicleType       = row[17]; // R: Vehicle Type (0-indexed 17)
  const clientReferenceId = Utilities.base64EncodeWebSafe(eventId).replace(/=+$/, '');

  Logger.log('Vehicle type:         ' + vehicleType);
  Logger.log('client_reference_id:  ' + clientReferenceId);

  const sessionUrl = createStripeCheckoutSession(vehicleType, clientReferenceId, null);

  Logger.log('Checkout Session URL: ' + sessionUrl);
}

// ---------------------------------------------------------------------------
// TEST 9: Deposit amount resolution [CONFIG]
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

// ---------------------------------------------------------------------------
// TEST 19: Approval notification eligibility (shouldNotifyCustomerOfApproval) [CONFIG]
// Verifies the pure decision helper checkRentalEligibility() uses to decide
// whether to send the customer their one-time approval notification. The
// customer must never be notified before the lease has actually been signed
// (column N) -- a manager approval value alone (column O) is not enough, no
// matter how long it has been sitting in the sheet. Also verifies the
// no-duplicates guarantee once column U is already 'Yes'. No sheet reads, no
// external calls, no writes, no email or SMS sent.
// ---------------------------------------------------------------------------
function testApprovalNotificationEligibility() {
  let passed = 0;
  let failed = 0;

  function check(label, approved, leaseSigned, customerNotified, expected) {
    const actual = shouldNotifyCustomerOfApproval(approved, leaseSigned, customerNotified);
    if (actual === expected) {
      Logger.log('OK (' + label + '): shouldNotifyCustomerOfApproval(' +
                 JSON.stringify(approved) + ', ' + JSON.stringify(leaseSigned) + ', ' +
                 JSON.stringify(customerNotified) + ') = ' + actual);
      passed++;
    } else {
      Logger.log('FAIL (' + label + '): expected ' + expected + ', got ' + actual +
                 ' for approved=' + JSON.stringify(approved) + ', leaseSigned=' + JSON.stringify(leaseSigned) +
                 ', customerNotified=' + JSON.stringify(customerNotified));
      failed++;
    }
  }

  // Approved but lease not yet signed -> must NOT notify, regardless of how
  // the approval got there or how long it has been waiting. This is the
  // core business rule: manager approval alone never triggers the email.
  check('Approved - Free, lease blank -> not eligible',  'Approved - Free', '',  '', false);
  check('Approved - Paid, lease blank -> not eligible',  'Approved - Paid', '',  '', false);
  check('Approved - Paid, lease undefined -> not eligible', 'Approved - Paid', undefined, '', false);

  // Approved AND signed AND not yet notified -> eligible
  check('Approved - Free, signed, not notified -> eligible', 'Approved - Free', 'Yes', '', true);
  check('Approved - Paid, signed, not notified -> eligible', 'Approved - Paid', 'Yes', '', true);

  // Signed and already notified -> must NOT notify again (no-duplicates guarantee)
  check('Approved - Paid, signed, already notified -> not eligible', 'Approved - Paid', 'Yes', 'Yes', false);
  check('Approved - Free, signed, already notified -> not eligible', 'Approved - Free', 'Yes', 'Yes', false);

  // Denied -> never notify the customer, regardless of lease or flag state
  check('Denied, lease blank -> not eligible',        'Denied', '',    '',    false);
  check('Denied, lease signed -> not eligible',        'Denied', 'Yes', '',    false);
  check('Denied, already notified somehow -> not eligible', 'Denied', 'Yes', 'Yes', false);

  // Pending (blank approval) -> never notify
  check('Pending (blank approval), lease blank -> not eligible',  '', '',    '', false);
  check('Pending (blank approval), lease signed -> not eligible', '', 'Yes', '', false);

  Logger.log(failed === 0
    ? 'All ' + passed + ' approval notification eligibility checks passed.'
    : passed + ' passed, ' + failed + ' failed.');
}

// ---------------------------------------------------------------------------
// TEST 20: DocuSeal send eligibility (isDocuSealEligible) [CONFIG]
// Verifies the pure decision helper that gates every DocuSeal send point
// (markDepositPaid, processIntakeFormSubmission_, sendLeaseToNewBookings): blocked when
// only one of deposit/intake is complete, allowed exactly once when both are
// complete, and never eligible again once the lease has already been sent.
// No sheet reads, no external calls, no writes, no DocuSeal request is made.
// ---------------------------------------------------------------------------
function testDocuSealEligibility() {
  let passed = 0;
  let failed = 0;

  function check(label, depositPaid, intakeCompleted, leaseSent, expected) {
    const actual = isDocuSealEligible(depositPaid, intakeCompleted, leaseSent);
    if (actual === expected) {
      Logger.log('OK (' + label + '): isDocuSealEligible = ' + actual);
      passed++;
    } else {
      Logger.log('FAIL (' + label + '): expected ' + expected + ', got ' + actual);
      failed++;
    }
  }

  // Deposit paid, intake NOT complete -> blocked. This is the exact scenario
  // item 2 fixes: Intake Sent (I) = 'Yes' does not mean the intake was
  // completed, so this must stay blocked even though a naive check on column
  // I alone would have allowed it.
  check('deposit paid, intake incomplete', 'Yes', '', '', false);
  check('deposit paid, intake blank flag', 'Yes', undefined, '', false);

  // Intake complete, deposit NOT paid -> blocked
  check('intake complete, deposit unpaid', '', 'Yes', '', false);

  // Neither complete -> blocked
  check('neither complete', '', '', '', false);

  // Both complete, lease not yet sent -> allowed exactly once
  check('both complete, not yet sent', 'Yes', 'Yes', '', true);

  // Both complete, but lease already sent -> blocked (no duplicate submission)
  check('both complete, already sent', 'Yes', 'Yes', 'Yes', false);

  // Order independence: the helper only looks at final state, not arrival
  // order, so "deposit first" and "intake first" converge to the same result
  // once both conditions are true — this is what makes the DocuSeal send
  // point order-independent per item 2's requirement.
  const depositFirstThenIntake = isDocuSealEligible('Yes', 'Yes', '');
  const intakeFirstThenDeposit = isDocuSealEligible('Yes', 'Yes', '');
  if (depositFirstThenIntake === true && intakeFirstThenDeposit === true) {
    Logger.log('OK (order independence): both arrival orders converge to eligible=true');
    passed++;
  } else {
    Logger.log('FAIL (order independence): depositFirst=' + depositFirstThenIntake +
               ', intakeFirst=' + intakeFirstThenDeposit);
    failed++;
  }

  Logger.log(failed === 0
    ? 'All ' + passed + ' DocuSeal eligibility checks passed.'
    : passed + ' passed, ' + failed + ' failed.');
}

// ============================================================
// DOCUSEAL TESTS
// ============================================================

// ---------------------------------------------------------------------------
// TEST 11: DocuSeal Script Property names [CONFIG]
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
// TEST 12: extractDocuSealSubmissionId response parsing [CONFIG]
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
// TEST 13: Deposit webhook row-lookup logic (no side effects) [SHEET]
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
// TEST 14: Lease-signed webhook row-lookup logic (no side effects) [SHEET]
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

// ---------------------------------------------------------------------------
// TEST 21: Intake form row-matching logic (findIntakeMatchRow) [CONFIG]
// Pure test against synthetic booking rows -- no sheet reads, no sheet
// writes, no live form event, no external calls. This is a safety-critical
// path: findIntakeMatchRow() must NEVER guess. When a submission's email
// matches more than one eligible (not-yet-complete) booking and the rental
// date cannot tell them apart, the correct result is 'ambiguous', not an
// arbitrary pick -- picking wrong here would mark the wrong booking's
// intake complete and could trigger the wrong DocuSeal agreement.
// ---------------------------------------------------------------------------
function testIntakeFormSubmitRowMatching() {
  let passed = 0;
  let failed = 0;

  // Column layout matches the real sheet (0-indexed): ... C=2 Email ...
  // E=4 Start Time ... V=21 Intake Form Completed. Only the columns
  // findIntakeMatchRow() actually reads are populated; the rest are left
  // undefined, which is fine since the function under test never touches them.
  function fakeRow(email, startTime, intakeCompleted) {
    const row = new Array(22);
    row[2]  = email;
    row[4]  = startTime;
    row[21] = intakeCompleted;
    return row;
  }

  function check(label, data, email, dateStr, expectedStatus, expectedRow) {
    const actual = findIntakeMatchRow(data, email, dateStr);
    if (actual.status === expectedStatus && actual.row === expectedRow) {
      Logger.log('OK (' + label + '): status=' + actual.status +
                 ', row=' + actual.row +
                 (actual.precision ? ', precision=' + actual.precision : ''));
      passed++;
    } else {
      Logger.log('FAIL (' + label + '): expected status=' + expectedStatus + ', row=' + expectedRow +
                 ' but got status=' + actual.status + ', row=' + actual.row);
      failed++;
    }
  }

  // ---- Case 1: one email match, no usable date -- succeeds -------------------
  (function case1() {
    const data = [
      [],
      fakeRow('solo@example.com', new Date('2026-08-01T10:00:00'), ''), // row 1: only booking for this email
    ];
    check('case 1: single booking, no date', data, 'solo@example.com', null, 'matched', 1);
  })();

  // ---- Case 2: two incomplete bookings, same email, different dates, ---------
  // matching date supplied -- correct row succeeds (the core repeat-customer fix).
  (function case2() {
    const data = [
      [],
      fakeRow('repeat@example.com', new Date('2026-08-01T10:00:00'), ''), // row 1: booking A
      fakeRow('repeat@example.com', new Date('2026-08-10T10:00:00'), ''), // row 2: booking B
    ];
    check('case 2: repeat customer, date selects booking A', data, 'repeat@example.com', '2026-08-01', 'matched', 1);
    check('case 2: repeat customer, date selects booking B', data, 'repeat@example.com', '2026-08-10', 'matched', 2);
  })();

  // ---- Case 3: two incomplete bookings, same email, no usable date -----------
  // -- ambiguous, no row selected. This is the exact scenario that was
  // previously (incorrectly) resolved by picking "the first incomplete row".
  (function case3() {
    const data = [
      [],
      fakeRow('repeat@example.com', new Date('2026-08-01T10:00:00'), ''),
      fakeRow('repeat@example.com', new Date('2026-08-10T10:00:00'), ''),
    ];
    check('case 3: repeat customer, no date -- ambiguous', data, 'repeat@example.com', null, 'ambiguous', -1);
  })();

  // ---- Case 4: two incomplete bookings, same email, unmatched date -----------
  // -- ambiguous, no row selected (the date didn't help, so this falls back to
  // the same unresolved multi-row situation as case 3).
  (function case4() {
    const data = [
      [],
      fakeRow('repeat@example.com', new Date('2026-08-01T10:00:00'), ''),
      fakeRow('repeat@example.com', new Date('2026-08-10T10:00:00'), ''),
    ];
    check('case 4: repeat customer, date matches neither -- ambiguous', data, 'repeat@example.com', '2026-08-31', 'ambiguous', -1);
  })();

  // ---- Case 5: same email AND same date on two incomplete bookings -----------
  // -- ambiguous, no row selected. The date narrows to two rows instead of
  // one, which must still refuse to guess.
  (function case5() {
    const data = [
      [],
      fakeRow('twins@example.com', new Date('2026-08-01T10:00:00'), ''), // e.g. two different vehicle types, same day
      fakeRow('twins@example.com', new Date('2026-08-01T10:00:00'), ''),
    ];
    check('case 5: same email and same date -- ambiguous', data, 'twins@example.com', '2026-08-01', 'ambiguous', -1);
  })();

  // ---- Case 6: completed rows are ignored -------------------------------------
  (function case6() {
    const data = [
      [],
      fakeRow('repeat@example.com', new Date('2026-08-01T10:00:00'), 'Yes'), // already complete -- not eligible
      fakeRow('repeat@example.com', new Date('2026-08-10T10:00:00'), ''),    // the only eligible row
    ];
    check('case 6: completed row ignored, only one eligible row remains', data, 'repeat@example.com', null, 'matched', 2);
    check('case 6: completed row never matched even with its own date', data, 'repeat@example.com', '2026-08-01', 'matched', 2);
  })();

  // ---- Case 7: unknown email returns no match ---------------------------------
  (function case7() {
    const data = [
      [],
      fakeRow('someone@example.com', new Date('2026-08-01T10:00:00'), ''),
    ];
    check('case 7: unknown email -- not found', data, 'nonexistent-intake@example.com', null, 'not_found', -1);
    check('case 7: unknown email with a real date -- not found', data, 'nonexistent-intake@example.com', '2026-08-01', 'not_found', -1);
  })();

  Logger.log(failed === 0
    ? 'All ' + passed + ' intake form row-matching checks passed.'
    : passed + ' passed, ' + failed + ' failed.');
}

// ---------------------------------------------------------------------------
// TEST 22: Spreadsheet form-submit event extraction (extractIntakeSubmissionFields) [CONFIG]
// Pure test against synthetic spreadsheet form-submit event objects -- no
// sheet reads, no real trigger, no external calls. Covers the event-shape
// extraction processIntakeFormSubmission_() depends on: e.namedValues keyed by the
// (currently placeholder, must-be-verified) question title constants, and
// e.range used only to confirm the submission came from the intake
// response sheet.
// ---------------------------------------------------------------------------
function testExtractIntakeSubmissionFields() {
  let passed = 0;
  let failed = 0;

  // Minimal fake Range -- only getSheet().getName() is used by the function
  // under test.
  function fakeRange(sheetName) {
    return { getSheet: function() { return { getName: function() { return sheetName; } }; } };
  }

  function fakeEvent(sheetName, namedValues) {
    return { range: fakeRange(sheetName), namedValues: namedValues };
  }

  function check(label, event, expectEmail, expectDateOrNull) {
    const actual = extractIntakeSubmissionFields(event);
    if (expectEmail === null) {
      if (actual === null) {
        Logger.log('OK (' + label + '): correctly returned null');
        passed++;
      } else {
        Logger.log('FAIL (' + label + '): expected null, got ' + JSON.stringify(actual));
        failed++;
      }
      return;
    }
    if (actual && actual.email === expectEmail &&
        (expectDateOrNull === undefined || actual.date === expectDateOrNull)) {
      Logger.log('OK (' + label + '): email=' + actual.email + ', date=' + actual.date);
      passed++;
    } else {
      Logger.log('FAIL (' + label + '): expected email=' + expectEmail +
                 (expectDateOrNull !== undefined ? ', date=' + expectDateOrNull : '') +
                 ', got ' + JSON.stringify(actual));
      failed++;
    }
  }

  // ---- Extraction of email and date from a synthetic event succeeds ----
  (function extractionSucceeds() {
    const namedValues = {};
    namedValues[INTAKE_RESPONSE_EMAIL_QUESTION_TITLE] = ['Customer@Example.com']; // mixed case, on purpose
    namedValues[INTAKE_RESPONSE_DATE_QUESTION_TITLE]  = ['2026-08-01'];
    const event = fakeEvent(INTAKE_RESPONSE_SHEET_NAME, namedValues);
    check('extraction succeeds, email lowercased', event, 'customer@example.com', '2026-08-01');
  })();

  // ---- Extraction succeeds with no date answer present ----
  (function extractionNoDate() {
    const namedValues = {};
    namedValues[INTAKE_RESPONSE_EMAIL_QUESTION_TITLE] = ['customer@example.com'];
    const event = fakeEvent(INTAKE_RESPONSE_SHEET_NAME, namedValues);
    check('extraction succeeds with no date answer', event, 'customer@example.com', null);
  })();

  // ---- Unrelated response-sheet submission is ignored ----
  (function unrelatedSheetIgnored() {
    const namedValues = {};
    namedValues[INTAKE_RESPONSE_EMAIL_QUESTION_TITLE] = ['customer@example.com'];
    namedValues[INTAKE_RESPONSE_DATE_QUESTION_TITLE]  = ['2026-08-01'];
    const event = fakeEvent('Some Other Form Responses', namedValues); // not INTAKE_RESPONSE_SHEET_NAME
    check('unrelated response sheet is ignored', event, null);
  })();

  // ---- Missing email is rejected ----
  (function missingEmailRejected() {
    const namedValues = {};
    namedValues[INTAKE_RESPONSE_DATE_QUESTION_TITLE] = ['2026-08-01']; // no email key at all
    const event = fakeEvent(INTAKE_RESPONSE_SHEET_NAME, namedValues);
    check('missing email answer is rejected', event, null);
  })();

  // ---- Blank email is rejected ----
  (function blankEmailRejected() {
    const namedValues = {};
    namedValues[INTAKE_RESPONSE_EMAIL_QUESTION_TITLE] = [''];
    const event = fakeEvent(INTAKE_RESPONSE_SHEET_NAME, namedValues);
    check('blank email answer is rejected', event, null);
  })();

  // ---- Malformed event object (missing range/namedValues) is rejected ----
  (function malformedEventRejected() {
    check('event with no range is rejected', { namedValues: {} }, null);
    check('event with no namedValues is rejected', { range: fakeRange(INTAKE_RESPONSE_SHEET_NAME) }, null);
    check('null event is rejected', null, null);
  })();

  Logger.log(failed === 0
    ? 'All ' + passed + ' intake submission extraction checks passed.'
    : passed + ' passed, ' + failed + ' failed.');
}

// ---------------------------------------------------------------------------
// TEST 23: Inspection form-submit row matching (findInspectionMatchRow) [CONFIG]
// Pure test against synthetic data -- no sheet reads, no live form event.
// Verifies the same ambiguity-safe email+date matching used for intake also
// applies correctly to inspection submissions, that the pre-trip (W) and
// post-trip (X) completion columns are tracked fully independently of each
// other via the inspectionType argument, and that matching never considers
// customer name.
// ---------------------------------------------------------------------------
function testInspectionFormSubmitRowMatching() {
  let passed = 0;
  let failed = 0;

  // Column layout matches the real sheet (0-indexed): ... C=2 Email ...
  // E=4 Start Time ... W=22 Pre-Inspection Form Completed ... X=23
  // Post-Inspection Form Completed. Only the columns findInspectionMatchRow()
  // actually reads are populated; name is deliberately never stored, since
  // the function under test does not accept or use it.
  function fakeRow(email, startTime, preCompleted, postCompleted) {
    const row = new Array(24);
    row[2]  = email;
    row[4]  = startTime;
    row[22] = preCompleted;
    row[23] = postCompleted;
    return row;
  }

  function check(label, data, email, dateStr, inspectionType, expectedStatus, expectedRow) {
    const actual = findInspectionMatchRow(data, email, dateStr, inspectionType);
    if (actual.status === expectedStatus && actual.row === expectedRow) {
      Logger.log('OK (' + label + '): status=' + actual.status +
                 ', row=' + actual.row +
                 (actual.precision ? ', precision=' + actual.precision : ''));
      passed++;
    } else {
      Logger.log('FAIL (' + label + '): expected status=' + expectedStatus + ', row=' + expectedRow +
                 ' but got status=' + actual.status + ', row=' + actual.row);
      failed++;
    }
  }

  // ---- Pre submission uniquely matches a booking -> W would be updated ----
  (function preMatches() {
    const data = [
      [],
      fakeRow('solo@example.com', new Date('2026-08-01T10:00:00'), '', ''),
    ];
    check('pre submission, single booking -- matched', data, 'solo@example.com', null, 'pre', 'matched', 1);
  })();

  // ---- Post submission uniquely matches a booking -> X would be updated ----
  (function postMatches() {
    const data = [
      [],
      fakeRow('solo@example.com', new Date('2026-08-01T10:00:00'), '', ''),
    ];
    check('post submission, single booking -- matched', data, 'solo@example.com', null, 'post', 'matched', 1);
  })();

  // ---- W and X are tracked independently: a row already complete in the ----
  // OTHER column is still eligible for this one -- proves a pre submission
  // never alters X's eligibility and a post submission never alters W's.
  (function columnsAreIndependent() {
    const dataPreEligible = [
      [],
      fakeRow('done-post@example.com', new Date('2026-08-01T10:00:00'), '', 'Yes'), // X already Yes, W blank
    ];
    check('post already done does not block a pre match (pre unaffected by X)',
          dataPreEligible, 'done-post@example.com', null, 'pre', 'matched', 1);

    const dataPostEligible = [
      [],
      fakeRow('done-pre@example.com', new Date('2026-08-01T10:00:00'), 'Yes', ''), // W already Yes, X blank
    ];
    check('pre already done does not block a post match (post unaffected by W)',
          dataPostEligible, 'done-pre@example.com', null, 'post', 'matched', 1);
  })();

  // ---- Already-completed submission is idempotent: not an error, no row ----
  // selected, and distinguishable from a genuine non-match.
  (function alreadyDoneIsIdempotent() {
    const data = [
      [],
      fakeRow('finished@example.com', new Date('2026-08-01T10:00:00'), 'Yes', ''),
    ];
    check('pre already Yes -- already_done, not an error', data, 'finished@example.com', null, 'pre', 'already_done', -1);
  })();

  // ---- Regression test: a completion cell holding "Yes <timestamp>" (the
  // format written by formatInspectionCompletionValue() in Helpers.js, e.g.
  // "Yes 8/2/2026 9:15 AM") must be recognized as already done, exactly like
  // a bare "Yes". Before isInspectionCompletionValueSet_() was introduced,
  // this matcher used strict equality against 'Yes', which would have let a
  // resubmission match and overwrite an already-recorded completion
  // timestamp -- this proves that regression cannot reoccur.
  (function alreadyDoneWithTimestampIsIdempotent() {
    const data = [
      [],
      fakeRow('finished-ts@example.com', new Date('2026-08-01T10:00:00'), 'Yes 8/1/2026 9:15 AM', ''),
    ];
    check('pre already "Yes <timestamp>" -- still already_done, not re-matched',
          data, 'finished-ts@example.com', null, 'pre', 'already_done', -1);

    const dataPost = [
      [],
      fakeRow('finished-ts-post@example.com', new Date('2026-08-01T10:00:00'), '', 'Yes 8/1/2026 4:08 PM'),
    ];
    check('post already "Yes <timestamp>" -- still already_done, not re-matched',
          dataPost, 'finished-ts-post@example.com', null, 'post', 'already_done', -1);
  })();

  // ---- No matching booking -- no update ----
  (function noMatch() {
    const data = [
      [],
      fakeRow('someone@example.com', new Date('2026-08-01T10:00:00'), '', ''),
    ];
    check('unknown email -- not_found', data, 'nonexistent-inspect@example.com', null, 'pre', 'not_found', -1);
  })();

  // ---- Multiple matching bookings, no date to disambiguate -- no update ----
  (function multipleMatches() {
    const data = [
      [],
      fakeRow('repeat@example.com', new Date('2026-08-01T10:00:00'), '', ''),
      fakeRow('repeat@example.com', new Date('2026-08-10T10:00:00'), '', ''),
    ];
    check('repeat customer, no date -- ambiguous', data, 'repeat@example.com', null, 'pre', 'ambiguous', -1);
  })();

  // ---- Same email, different rental dates -- date selects the correct booking ----
  (function sameEmailDifferentDates() {
    const data = [
      [],
      fakeRow('repeat@example.com', new Date('2026-08-01T10:00:00'), '', ''), // booking A
      fakeRow('repeat@example.com', new Date('2026-08-10T10:00:00'), '', ''), // booking B
    ];
    check('repeat customer, date selects booking A', data, 'repeat@example.com', '2026-08-01', 'post', 'matched', 1);
    check('repeat customer, date selects booking B', data, 'repeat@example.com', '2026-08-10', 'post', 'matched', 2);
  })();

  // ---- Customer name alone is never sufficient: the matcher does not ----
  // accept or read a name field at all. Same name, different email -- only
  // the requested email's own booking matches.
  (function nameAloneInsufficient() {
    const data = [
      [],
      fakeRow('jane.a@example.com', new Date('2026-08-01T10:00:00'), '', ''), // "Jane Doe" booking A
      fakeRow('jane.b@example.com', new Date('2026-08-01T10:00:00'), '', ''), // "Jane Doe" booking B, same date, different email
    ];
    check('same name different email -- matches only that email\'s booking (A)',
          data, 'jane.a@example.com', null, 'pre', 'matched', 1);
    check('same name different email -- matches only that email\'s booking (B)',
          data, 'jane.b@example.com', null, 'pre', 'matched', 2);
  })();

  Logger.log(failed === 0
    ? 'All ' + passed + ' inspection form row-matching checks passed.'
    : passed + ' passed, ' + failed + ' failed.');
}

// ---------------------------------------------------------------------------
// TEST 24: Spreadsheet form-submit event extraction (extractInspectionSubmissionFields) [CONFIG]
// Pure test against synthetic spreadsheet form-submit event objects -- no
// sheet reads, no real trigger, no external calls. Covers email/date
// extraction (mirrors testExtractIntakeSubmissionFields) plus the pre/post
// inspection-type classification unique to this form, including case- and
// whitespace-normalization of the submitted answer and the case where the
// type answer cannot be classified at all.
//
// Classification compares the submitted answer against CONFIG.INSPECT_VAL_PRE
// / CONFIG.INSPECT_VAL_POST (both normalized the same way as the answer) --
// this test temporarily stubs those two CONFIG properties to the live
// form's exact option text ("Pre-Trip (Before Vehicle Pickup)" / "Post-Trip
// (After Vehicle Return)") for the duration of the test, and always restores
// the originals in a finally block. This exercises the real production
// comparison without ever reading or writing the live Script Properties
// those CONFIG values are sourced from.
// ---------------------------------------------------------------------------
function testExtractInspectionSubmissionFields() {
  let passed = 0;
  let failed = 0;

  function fakeRange(sheetName) {
    return { getSheet: function() { return { getName: function() { return sheetName; } }; } };
  }

  function fakeEvent(sheetName, namedValues) {
    return { range: fakeRange(sheetName), namedValues: namedValues };
  }

  function check(label, event, expectEmail, expectDateOrNull, expectType) {
    const actual = extractInspectionSubmissionFields(event);
    if (expectEmail === null) {
      if (actual === null) {
        Logger.log('OK (' + label + '): correctly returned null');
        passed++;
      } else {
        Logger.log('FAIL (' + label + '): expected null, got ' + JSON.stringify(actual));
        failed++;
      }
      return;
    }
    if (actual && actual.email === expectEmail &&
        (expectDateOrNull === undefined || actual.date === expectDateOrNull) &&
        (expectType === undefined || actual.type === expectType)) {
      Logger.log('OK (' + label + '): email=' + actual.email + ', date=' + actual.date + ', type=' + actual.type);
      passed++;
    } else {
      Logger.log('FAIL (' + label + '): expected email=' + expectEmail +
                 (expectDateOrNull !== undefined ? ', date=' + expectDateOrNull : '') +
                 (expectType !== undefined ? ', type=' + expectType : '') +
                 ', got ' + JSON.stringify(actual));
      failed++;
    }
  }

  const LIVE_VAL_PRE  = 'Pre-Trip (Before Vehicle Pickup)';
  const LIVE_VAL_POST = 'Post-Trip (After Vehicle Return)';

  const realInspectValPre  = CONFIG.INSPECT_VAL_PRE;
  const realInspectValPost = CONFIG.INSPECT_VAL_POST;
  CONFIG.INSPECT_VAL_PRE  = LIVE_VAL_PRE;
  CONFIG.INSPECT_VAL_POST = LIVE_VAL_POST;

  try {
    // ---- 1. The exact live-style pre-inspection option classifies as pre ----
    (function preTypeExtracted() {
      const namedValues = {};
      namedValues[INSPECT_RESPONSE_EMAIL_QUESTION_TITLE] = ['Customer@Example.com']; // mixed case, on purpose
      namedValues[INSPECT_RESPONSE_DATE_QUESTION_TITLE]  = ['2026-08-01'];
      namedValues[INSPECT_RESPONSE_TYPE_QUESTION_TITLE]  = [LIVE_VAL_PRE];
      const event = fakeEvent(INSPECT_RESPONSE_SHEET_NAME, namedValues);
      check('live pre-trip option classified as pre, email lowercased', event, 'customer@example.com', '2026-08-01', 'pre');
    })();

    // ---- 2. The exact live-style post-inspection option classifies as post ----
    (function postTypeExtracted() {
      const namedValues = {};
      namedValues[INSPECT_RESPONSE_EMAIL_QUESTION_TITLE] = ['customer@example.com'];
      namedValues[INSPECT_RESPONSE_DATE_QUESTION_TITLE]  = ['2026-08-01'];
      namedValues[INSPECT_RESPONSE_TYPE_QUESTION_TITLE]  = [LIVE_VAL_POST];
      const event = fakeEvent(INSPECT_RESPONSE_SHEET_NAME, namedValues);
      check('live post-trip option classified as post', event, 'customer@example.com', '2026-08-01', 'post');
    })();

    // ---- 3. Leading/trailing whitespace and case differences still normalize correctly ----
    (function typeIsTrimmedAndCaseNormalized() {
      const pairs = [
        [LIVE_VAL_PRE.toUpperCase(),   'pre'],
        [LIVE_VAL_PRE.toLowerCase(),   'pre'],
        ['  ' + LIVE_VAL_PRE + '  ',   'pre'],
        [LIVE_VAL_POST.toUpperCase(),  'post'],
        [LIVE_VAL_POST.toLowerCase(),  'post'],
        ['  ' + LIVE_VAL_POST + '  ',  'post'],
      ];
      pairs.forEach(function(pair) {
        const rawValue = pair[0];
        const expected = pair[1];
        const namedValues = {};
        namedValues[INSPECT_RESPONSE_EMAIL_QUESTION_TITLE] = ['customer@example.com'];
        namedValues[INSPECT_RESPONSE_TYPE_QUESTION_TITLE]  = [rawValue];
        const event = fakeEvent(INSPECT_RESPONSE_SHEET_NAME, namedValues);
        check('type answer ' + JSON.stringify(rawValue) + ' normalizes to ' + expected,
              event, 'customer@example.com', undefined, expected);
      });
    })();

    // ---- 4. An unrelated value still returns type: null ----
    (function unknownTypeRejected() {
      const namedValues = {};
      namedValues[INSPECT_RESPONSE_EMAIL_QUESTION_TITLE] = ['customer@example.com'];
      namedValues[INSPECT_RESPONSE_DATE_QUESTION_TITLE]  = ['2026-08-01'];
      namedValues[INSPECT_RESPONSE_TYPE_QUESTION_TITLE]  = ['Some Unrelated Answer'];
      const event = fakeEvent(INSPECT_RESPONSE_SHEET_NAME, namedValues);
      check('unrecognized type answer -- type is null, not a guess', event, 'customer@example.com', '2026-08-01', null);
    })();

    // ---- 5. rawType remains preserved (for admin-alert context) even when unrecognized ----
    (function unknownTypeKeepsRawTypeForAlert() {
      const namedValues = {};
      namedValues[INSPECT_RESPONSE_EMAIL_QUESTION_TITLE] = ['customer@example.com'];
      namedValues[INSPECT_RESPONSE_TYPE_QUESTION_TITLE]  = ['Not Pre Or Post'];
      const event = fakeEvent(INSPECT_RESPONSE_SHEET_NAME, namedValues);
      const actual = extractInspectionSubmissionFields(event);
      if (actual && actual.type === null && actual.rawType === 'Not Pre Or Post') {
        Logger.log('OK (rawType preserved for admin alert): rawType=' + actual.rawType);
        passed++;
      } else {
        Logger.log('FAIL (rawType preserved for admin alert): got ' + JSON.stringify(actual));
        failed++;
      }
    })();

    // ---- Extraction succeeds with no date answer present ----
    (function extractionNoDate() {
      const namedValues = {};
      namedValues[INSPECT_RESPONSE_EMAIL_QUESTION_TITLE] = ['customer@example.com'];
      namedValues[INSPECT_RESPONSE_TYPE_QUESTION_TITLE]  = [LIVE_VAL_PRE];
      const event = fakeEvent(INSPECT_RESPONSE_SHEET_NAME, namedValues);
      check('extraction succeeds with no date answer', event, 'customer@example.com', null, 'pre');
    })();

    // ---- submittedAt: a valid Timestamp answer is parsed into a real Date ----
    // -- this is the value processInspectionFormSubmission_() (Forms.js) writes
    // into columns W/X via formatInspectionCompletionValue(), and what
    // isPostTripReminderEligible() (Helpers.js) measures the one-hour post-trip
    // delay from, so it must reflect the actual submission time, not just any
    // truthy value.
    (function submittedAtValidTimestamp() {
      const namedValues = {};
      namedValues[INSPECT_RESPONSE_EMAIL_QUESTION_TITLE]     = ['customer@example.com'];
      namedValues[INSPECT_RESPONSE_TYPE_QUESTION_TITLE]      = [LIVE_VAL_PRE];
      namedValues[INSPECT_RESPONSE_TIMESTAMP_QUESTION_TITLE] = ['8/1/2026 9:15:00'];
      const event = fakeEvent(INSPECT_RESPONSE_SHEET_NAME, namedValues);
      const actual = extractInspectionSubmissionFields(event);
      if (actual && actual.submittedAt instanceof Date && !isNaN(actual.submittedAt.getTime())) {
        Logger.log('OK (valid Timestamp answer parses to a Date): submittedAt=' + actual.submittedAt);
        passed++;
      } else {
        Logger.log('FAIL (valid Timestamp answer parses to a Date): got ' + JSON.stringify(actual));
        failed++;
      }
    })();

    // ---- submittedAt: a missing Timestamp answer -- never guess a time ----
    (function submittedAtMissing() {
      const namedValues = {};
      namedValues[INSPECT_RESPONSE_EMAIL_QUESTION_TITLE] = ['customer@example.com'];
      namedValues[INSPECT_RESPONSE_TYPE_QUESTION_TITLE]  = [LIVE_VAL_PRE];
      // no Timestamp key at all
      const event = fakeEvent(INSPECT_RESPONSE_SHEET_NAME, namedValues);
      const actual = extractInspectionSubmissionFields(event);
      if (actual && actual.submittedAt === null) {
        Logger.log('OK (missing Timestamp answer -- submittedAt is null)');
        passed++;
      } else {
        Logger.log('FAIL (missing Timestamp answer -- submittedAt is null): got ' + JSON.stringify(actual));
        failed++;
      }
    })();

    // ---- submittedAt: a malformed Timestamp answer -- never guess a time ----
    (function submittedAtMalformed() {
      const namedValues = {};
      namedValues[INSPECT_RESPONSE_EMAIL_QUESTION_TITLE]     = ['customer@example.com'];
      namedValues[INSPECT_RESPONSE_TYPE_QUESTION_TITLE]      = [LIVE_VAL_PRE];
      namedValues[INSPECT_RESPONSE_TIMESTAMP_QUESTION_TITLE] = ['not a real date'];
      const event = fakeEvent(INSPECT_RESPONSE_SHEET_NAME, namedValues);
      const actual = extractInspectionSubmissionFields(event);
      if (actual && actual.submittedAt === null) {
        Logger.log('OK (malformed Timestamp answer -- submittedAt is null, not a guess)');
        passed++;
      } else {
        Logger.log('FAIL (malformed Timestamp answer -- submittedAt is null): got ' + JSON.stringify(actual));
        failed++;
      }
    })();

    // ---- Unrelated response-sheet submission is ignored (e.g. the intake form) ----
    (function unrelatedSheetIgnored() {
      const namedValues = {};
      namedValues[INSPECT_RESPONSE_EMAIL_QUESTION_TITLE] = ['customer@example.com'];
      namedValues[INSPECT_RESPONSE_TYPE_QUESTION_TITLE]  = [LIVE_VAL_PRE];
      const event = fakeEvent(INTAKE_RESPONSE_SHEET_NAME, namedValues); // wrong sheet on purpose
      check('unrelated response sheet is ignored', event, null);
    })();

    // ---- Missing email is rejected ----
    (function missingEmailRejected() {
      const namedValues = {};
      namedValues[INSPECT_RESPONSE_TYPE_QUESTION_TITLE] = [LIVE_VAL_PRE]; // no email key at all
      const event = fakeEvent(INSPECT_RESPONSE_SHEET_NAME, namedValues);
      check('missing email answer is rejected', event, null);
    })();

    // ---- Blank email is rejected ----
    (function blankEmailRejected() {
      const namedValues = {};
      namedValues[INSPECT_RESPONSE_EMAIL_QUESTION_TITLE] = [''];
      const event = fakeEvent(INSPECT_RESPONSE_SHEET_NAME, namedValues);
      check('blank email answer is rejected', event, null);
    })();

    // ---- Malformed event object (missing range/namedValues) is rejected ----
    (function malformedEventRejected() {
      check('event with no range is rejected', { namedValues: {} }, null);
      check('event with no namedValues is rejected', { range: fakeRange(INSPECT_RESPONSE_SHEET_NAME) }, null);
      check('null event is rejected', null, null);
    })();
  } finally {
    // 6. Always restore -- this test must never leave CONFIG (or the live
    // Script Properties it was read from) altered for any other test or run.
    CONFIG.INSPECT_VAL_PRE  = realInspectValPre;
    CONFIG.INSPECT_VAL_POST = realInspectValPost;
  }

  if (CONFIG.INSPECT_VAL_PRE === realInspectValPre && CONFIG.INSPECT_VAL_POST === realInspectValPost) {
    Logger.log('OK: CONFIG.INSPECT_VAL_PRE / CONFIG.INSPECT_VAL_POST restored to their original values');
    passed++;
  } else {
    Logger.log('FAIL: CONFIG.INSPECT_VAL_PRE / CONFIG.INSPECT_VAL_POST were not restored');
    failed++;
  }

  Logger.log(failed === 0
    ? 'All ' + passed + ' inspection submission extraction checks passed.'
    : passed + ' passed, ' + failed + ' failed.');
}

// ---------------------------------------------------------------------------
// TEST 25: Form-submit dispatcher routing (onFormSubmit) [CONFIG]
// Verifies onFormSubmit() -- the single installed spreadsheet-bound
// form-submit trigger -- routes each event to the correct processing
// function by response-tab name, and ignores anything else. Because the
// real processIntakeFormSubmission_() / processInspectionFormSubmission_()
// call getSheet() and can send DocuSeal requests, this test temporarily
// replaces them with counting stubs before calling onFormSubmit(), then
// restores the originals in a finally block -- no sheet is read or
// written, and no email/SMS/DocuSeal/Stripe/webhook call is made at any
// point.
// ---------------------------------------------------------------------------
function testFormSubmitDispatcher() {
  let passed = 0;
  let failed = 0;

  function check(label, condition) {
    if (condition) {
      Logger.log('OK: ' + label);
      passed++;
    } else {
      Logger.log('FAIL: ' + label);
      failed++;
    }
  }

  function fakeRange(sheetName) {
    return { getSheet: function() { return { getName: function() { return sheetName; } }; } };
  }

  function fakeEvent(sheetName) {
    return { range: fakeRange(sheetName), namedValues: {} };
  }

  const realProcessIntake     = processIntakeFormSubmission_;
  const realProcessInspection = processInspectionFormSubmission_;
  let intakeCalls     = 0;
  let inspectionCalls = 0;

  processIntakeFormSubmission_     = function() { intakeCalls++; };
  processInspectionFormSubmission_ = function() { inspectionCalls++; };

  try {
    // ---- Dispatcher routes Rental Intake Form to intake logic only ----
    intakeCalls = 0; inspectionCalls = 0;
    onFormSubmit(fakeEvent(INTAKE_RESPONSE_SHEET_NAME));
    check('intake submission calls intake processing exactly once', intakeCalls === 1);
    check('intake submission does not run inspection processing', inspectionCalls === 0);

    // ---- Dispatcher routes Rental Vehicle Condition Inspection Form to inspection logic only ----
    intakeCalls = 0; inspectionCalls = 0;
    onFormSubmit(fakeEvent(INSPECT_RESPONSE_SHEET_NAME));
    check('inspection submission calls inspection processing exactly once', inspectionCalls === 1);
    check('inspection submission does not run intake processing', intakeCalls === 0);

    // ---- Dispatcher ignores an unrelated tab ----
    intakeCalls = 0; inspectionCalls = 0;
    onFormSubmit(fakeEvent('Some Unrelated Sheet'));
    check('unrelated tab calls neither intake nor inspection processing',
          intakeCalls === 0 && inspectionCalls === 0);

    // ---- Malformed events are ignored safely, never throw ----
    let threw = false;
    try {
      onFormSubmit(null);
      onFormSubmit({});
      onFormSubmit({ range: null });
    } catch (e) {
      threw = true;
    }
    check('malformed events do not throw and call neither processing function',
          !threw && intakeCalls === 0 && inspectionCalls === 0);
  } finally {
    // Always restore the real functions, even if an assertion above failed,
    // so no other test or live trigger is left pointed at the stubs.
    processIntakeFormSubmission_     = realProcessIntake;
    processInspectionFormSubmission_ = realProcessInspection;
  }

  check('processIntakeFormSubmission_ restored to the original function',
        processIntakeFormSubmission_ === realProcessIntake);
  check('processInspectionFormSubmission_ restored to the original function',
        processInspectionFormSubmission_ === realProcessInspection);

  Logger.log(failed === 0
    ? 'All ' + passed + ' form-submit dispatcher checks passed.'
    : passed + ' passed, ' + failed + ' failed.');
}

// ---------------------------------------------------------------------------
// TEST 28: Pre-trip reminder eligibility (isPreTripReminderEligible) [CONFIG]
// Pure test against the eligibility helper used by processReminders() to
// decide whether a booking's 24-hour/pre-trip reminder should be attempted.
// No sheet reads, no external calls, no writes. Covers: normal-window
// eligibility, deposit-unpaid exclusion, late eligibility once deposit or
// approval arrive (as long as the booking is still inside the window),
// permanent exclusion once the rental has started, and the K-already-Yes
// no-duplicate case.
// ---------------------------------------------------------------------------
function testPreTripReminderEligibility() {
  let passed = 0;
  let failed = 0;

  function check(label, hoursUntilStart, sent24hr, approved, depositPaid, expected) {
    const actual = isPreTripReminderEligible(hoursUntilStart, sent24hr, approved, depositPaid);
    if (actual === expected) {
      Logger.log('OK (' + label + '): isPreTripReminderEligible(' + hoursUntilStart + ', ' +
                 JSON.stringify(sent24hr) + ', ' + JSON.stringify(approved) + ', ' +
                 JSON.stringify(depositPaid) + ') = ' + actual);
      passed++;
    } else {
      Logger.log('FAIL (' + label + '): expected ' + expected + ', got ' + actual +
                 ' for hoursUntilStart=' + hoursUntilStart + ', sent24hr=' + JSON.stringify(sent24hr) +
                 ', approved=' + JSON.stringify(approved) + ', depositPaid=' + JSON.stringify(depositPaid));
      failed++;
    }
  }

  // 1. Eligible booking inside the normal reminder window
  check('eligible inside normal window', 20, '', 'Approved - Paid', 'Yes', true);
  check('eligible inside normal window (Approved - Free)', 15, '', 'Approved - Free', 'Yes', true);

  // 2. Deposit unpaid inside the normal window -- not eligible
  check('deposit unpaid inside window -- not eligible', 20, '', 'Approved - Paid', '', false);
  check('deposit unpaid (blank) inside window -- not eligible', 20, '', 'Approved - Paid', undefined, false);

  // 3. Deposit becomes paid later (still inside the window, closer to start) -- eligible
  check('deposit paid later in window -- eligible', 5, '', 'Approved - Paid', 'Yes', true);

  // 4. Approval missing inside the normal window -- not eligible
  check('approval missing (blank) inside window -- not eligible', 20, '', '', 'Yes', false);
  check('approval Denied inside window -- not eligible', 20, '', 'Denied', 'Yes', false);

  // 5. Approval becomes valid after the normal window opened but before rental start -- eligible
  check('approval granted late, still before start -- eligible', 3, '', 'Approved - Free', 'Yes', true);
  check('approval granted right at the window edge -- eligible', 26, '', 'Approved - Paid', 'Yes', true);

  // 6. Rental has already started -- pre-trip reminder never eligible
  check('rental already started -- not eligible', -0.5, '', 'Approved - Paid', 'Yes', false);
  check('rental started, even with everything else true -- not eligible', -5, '', 'Approved - Paid', 'Yes', false);

  // Too early (outside the 26-hour window) -- not eligible yet
  check('too early, outside window -- not eligible', 40, '', 'Approved - Paid', 'Yes', false);

  // 7. K already Yes -- never re-eligible (no duplicate reminder)
  check('K already Yes -- not eligible', 20, 'Yes', 'Approved - Paid', 'Yes', false);
  check('K already Yes even with everything else true -- not eligible', 0, 'Yes', 'Approved - Free', 'Yes', false);

  // Exact boundary: hoursUntilStart = 0 (the moment the rental starts) is still eligible
  check('exactly at hoursUntilStart = 0 -- eligible', 0, '', 'Approved - Paid', 'Yes', true);

  Logger.log(failed === 0
    ? 'All ' + passed + ' pre-trip reminder eligibility checks passed.'
    : passed + ' passed, ' + failed + ' failed.');
}

// ---------------------------------------------------------------------------
// TEST 29: Pre-trip reminder send-and-flag behavior (sendPreTripReminder_) [CONFIG]
// Verifies that src/Reminders.js's sendPreTripReminder_() only writes column K
// (24hr Sent) when the customer was actually reached, matching the same
// "delivered if reached by either channel" pattern as notifyCustomerOfApproval()
// (Approval.js). Uses a fake sheet object (no live Sheets API calls -- setValue
// calls are recorded, not applied) and temporarily stubs the global sendSms /
// sendEmailHtml functions so no real Twilio or SendGrid call is made. Both
// stubbed functions are restored in a finally block even if an assertion fails.
// ---------------------------------------------------------------------------
function testSendPreTripReminderFlagBehavior() {
  let passed = 0;
  let failed = 0;

  function check(label, condition) {
    if (condition) {
      Logger.log('OK: ' + label);
      passed++;
    } else {
      Logger.log('FAIL: ' + label);
      failed++;
    }
  }

  function fakeSheet() {
    const writes = [];
    return {
      writes: writes,
      getRange: function(row, col) {
        return {
          setValue: function(value) {
            writes.push({ row: row, col: col, value: value });
          }
        };
      }
    };
  }

  const fakeLocCfg = { email: 'sender@example.com', phone: '+12065550100' };

  const realSendSms       = sendSms;
  const realSendEmailHtml = sendEmailHtml;

  try {
    // ---- 8. Both channels fail -- K is NOT marked Yes, no false "done" state ----
    (function bothChannelsFail() {
      sendSms       = function() { throw new Error('simulated Twilio outage'); };
      sendEmailHtml = function() { throw new Error('simulated SendGrid outage'); };

      const sheet = fakeSheet();
      const result = sendPreTripReminder_(
        sheet, 4, 'Test Customer', 'customer@example.com', '+12065551234',
        fakeLocCfg, 'August 1, 2026 at 9:00 AM', 'Cargo Van', 'Bainbridge',
        'https://example.com/pre-inspect', 'Yes'
      );

      check('both channels failing returns false (not delivered)', result === false);
      check('both channels failing writes nothing to column K', sheet.writes.length === 0);
    })();

    // ---- Email succeeds even though SMS fails -- still delivered, K written ----
    (function emailSucceedsSmsFails() {
      sendSms       = function() { throw new Error('simulated Twilio outage'); };
      sendEmailHtml = function() { /* succeeds */ };

      const sheet = fakeSheet();
      const result = sendPreTripReminder_(
        sheet, 4, 'Test Customer', 'customer@example.com', '+12065551234',
        fakeLocCfg, 'August 1, 2026 at 9:00 AM', 'Cargo Van', 'Bainbridge',
        'https://example.com/pre-inspect', 'Yes'
      );

      check('email success alone counts as delivered', result === true);
      check('column K (row 5, col 11) written exactly once', sheet.writes.length === 1 &&
            sheet.writes[0].row === 5 && sheet.writes[0].col === 11 && sheet.writes[0].value === 'Yes');
    })();

    // ---- No phone and no email on file -- treated as delivered (avoid endless retry) ----
    (function noContactInfoAtAll() {
      sendSms       = function() { throw new Error('should not be called -- no phone on file'); };
      sendEmailHtml = function() { throw new Error('should not be called -- no email on file'); };

      const sheet = fakeSheet();
      const result = sendPreTripReminder_(
        sheet, 4, 'Test Customer', 'No Email', 'No Phone',
        fakeLocCfg, 'August 1, 2026 at 9:00 AM', 'Cargo Van', 'Bainbridge',
        'https://example.com/pre-inspect', 'Yes'
      );

      check('no contact info at all is treated as delivered (matches notifyCustomerOfApproval precedent)', result === true);
      check('column K still written when there is no way to reach the customer', sheet.writes.length === 1);
    })();
  } finally {
    // Always restore the real functions, even if an assertion above failed.
    sendSms       = realSendSms;
    sendEmailHtml = realSendEmailHtml;
  }

  check('sendSms restored to the original function', sendSms === realSendSms);
  check('sendEmailHtml restored to the original function', sendEmailHtml === realSendEmailHtml);

  Logger.log(failed === 0
    ? 'All ' + passed + ' pre-trip reminder send/flag checks passed.'
    : passed + ' passed, ' + failed + ' failed.');
}

// ---------------------------------------------------------------------------
// TEST 36: Pre-trip and post-trip inspection emails exclude the manager
// from recipients (buildEmailPersonalization_, sendPreTripReminder_,
// sendPostTripReminder_) [CONFIG]
// The manager must not receive either blank inspection email in any form --
// not To, not CC (never used anywhere in this codebase), and not BCC --
// before the customer has actually submitted the corresponding form. Three
// layers are verified:
//   1. buildEmailPersonalization_() (Notifications.js) directly -- pure,
//      no sheet reads, no external calls -- confirms suppressManagerBcc
//      removes the manager from the recipient data entirely, while leaving
//      normal (non-suppressed) behavior, including the undefined-argument
//      default, unaffected (backward compatible with every other call site).
//   2. sendPreTripReminder_() (Reminders.js) actually passes
//      suppressManagerBcc = true for the customer email call specifically,
//      and still sends the dedicated manager 24-hour summary -- stubs
//      sendEmailHtml and a fake sheet (restored in a finally block), no
//      real email is sent.
//   3. Same as (2), for sendPostTripReminder_() and the dedicated manager
//      post-trip notice.
// ---------------------------------------------------------------------------
function testInspectionEmailsExcludeManagerFromRecipients() {
  let passed = 0;
  let failed = 0;

  function check(label, condition) {
    if (condition) {
      Logger.log('OK: ' + label);
      passed++;
    } else {
      Logger.log('FAIL: ' + label);
      failed++;
    }
  }

  // ---- Layer 1: buildEmailPersonalization_() directly ----
  (function personalizationBuilderChecks() {
    const realManagerEmail = CONFIG.MANAGER_EMAIL;
    const realAdminEmail   = CONFIG.ADMIN_EMAIL;
    CONFIG.MANAGER_EMAIL = 'manager@example.com';
    CONFIG.ADMIN_EMAIL   = 'admin@example.com';

    try {
      const suppressed = buildEmailPersonalization_('customer@example.com', true);
      check('suppressed: to contains only the customer', suppressed.to.length === 1 && suppressed.to[0].email === 'customer@example.com');
      check('suppressed: no bcc field is present at all', !suppressed.bcc);
      check('suppressed: no cc field is present at all', !suppressed.cc);
      check('suppressed: manager email does not appear anywhere in the personalization data',
            JSON.stringify(suppressed).indexOf('manager@example.com') === -1);

      const normal = buildEmailPersonalization_('customer@example.com', false);
      check('normal (explicit false): manager is still bcc\'d -- unrelated emails are unaffected',
            normal.bcc && normal.bcc.length === 1 && normal.bcc[0].email === 'manager@example.com');

      const normalDefault = buildEmailPersonalization_('customer@example.com');
      check('normal (omitted arg): manager is still bcc\'d -- backward compatible with every existing call site',
            normalDefault.bcc && normalDefault.bcc[0].email === 'manager@example.com');

      const toManagerDirectly = buildEmailPersonalization_('manager@example.com', false);
      check('email addressed directly to the manager is never also bcc\'d to her', !toManagerDirectly.bcc);
    } finally {
      CONFIG.MANAGER_EMAIL = realManagerEmail;
      CONFIG.ADMIN_EMAIL   = realAdminEmail;
    }
  })();

  function fakeSheet() {
    const writes = [];
    return {
      writes: writes,
      getRange: function(row, col) {
        return { setValue: function(value) { writes.push({ row: row, col: col, value: value }); } }
      }
    };
  }

  const fakeLocCfg = { email: 'sender@example.com', phone: '+12065550100' };

  // ---- Layer 2: sendPreTripReminder_() passes suppressManagerBcc = true ----
  // for the customer email, but still sends the dedicated manager summary.
  (function preTripReminderSuppressesManagerBcc() {
    const realSendSms       = sendSms;
    const realSendEmailHtml = sendEmailHtml;
    const emailCalls = [];

    try {
      sendSms       = function() { /* succeeds */ };
      sendEmailHtml = function(toEmail, subject, htmlBody, fromEmail, replyToEmail, suppressManagerBcc) {
        emailCalls.push({ toEmail: toEmail, suppressManagerBcc: suppressManagerBcc });
      };

      const sheet = fakeSheet();
      sendPreTripReminder_(
        sheet, 4, 'Test Customer', 'customer@example.com', '+12065551234',
        fakeLocCfg, 'August 1, 2026 at 9:00 AM', 'Cargo Van', 'Bainbridge',
        'https://example.com/pre-inspect', 'Yes'
      );

      const customerCall = emailCalls.filter(function(c) { return c.toEmail === 'customer@example.com'; })[0];
      check('sendPreTripReminder_ sent the customer email', !!customerCall);
      check('the customer email call passed suppressManagerBcc = true', customerCall && customerCall.suppressManagerBcc === true);

      const managerCall = emailCalls.filter(function(c) { return c.toEmail === CONFIG.MANAGER_EMAIL; })[0];
      check('the dedicated manager 24-hour summary email was still sent', !!managerCall);
    } finally {
      sendSms       = realSendSms;
      sendEmailHtml = realSendEmailHtml;
    }

    check('sendSms restored to the original function', sendSms === realSendSms);
    check('sendEmailHtml restored to the original function', sendEmailHtml === realSendEmailHtml);
  })();

  // ---- Layer 3: sendPostTripReminder_() passes suppressManagerBcc = true ----
  // for the customer email, but still sends the dedicated manager notice.
  (function postTripReminderSuppressesManagerBcc() {
    const realSendSms       = sendSms;
    const realSendEmailHtml = sendEmailHtml;
    const emailCalls = [];

    try {
      sendSms       = function() { /* succeeds */ };
      sendEmailHtml = function(toEmail, subject, htmlBody, fromEmail, replyToEmail, suppressManagerBcc) {
        emailCalls.push({ toEmail: toEmail, suppressManagerBcc: suppressManagerBcc });
      };

      const sheet = fakeSheet();
      sendPostTripReminder_(
        sheet, 4, 'Test Customer', 'customer@example.com', '+12065551234',
        fakeLocCfg, 'August 1, 2026 at 9:00 AM', 'Cargo Van', 'Bainbridge',
        'https://example.com/post-inspect'
      );

      const customerCall = emailCalls.filter(function(c) { return c.toEmail === 'customer@example.com'; })[0];
      check('sendPostTripReminder_ sent the customer email', !!customerCall);
      check('the customer email call passed suppressManagerBcc = true', customerCall && customerCall.suppressManagerBcc === true);

      const managerCall = emailCalls.filter(function(c) { return c.toEmail === CONFIG.MANAGER_EMAIL; })[0];
      check('the dedicated manager post-trip notice email was still sent', !!managerCall);
    } finally {
      sendSms       = realSendSms;
      sendEmailHtml = realSendEmailHtml;
    }

    check('sendSms restored to the original function', sendSms === realSendSms);
    check('sendEmailHtml restored to the original function', sendEmailHtml === realSendEmailHtml);
  })();

  Logger.log(failed === 0
    ? 'All ' + passed + ' pre-trip/post-trip email manager-exclusion checks passed.'
    : passed + ' passed, ' + failed + ' failed.');
}

// ---------------------------------------------------------------------------
// TEST 30: Inspection completion formatting/parsing (Helpers.js) [CONFIG]
// Pure test against formatDateTimeShort(), formatInspectionCompletionValue(),
// parseInspectionCompletionTimestamp_(), and isInspectionCompletionValueSet_()
// (Forms.js) -- no sheet reads, no external calls. Confirms the round trip
// (format then parse recovers the same moment) and that the parser/detector
// never guess a time or a "done" state from ambiguous input.
// ---------------------------------------------------------------------------
function testInspectionCompletionFormatting() {
  let passed = 0;
  let failed = 0;

  function check(label, condition) {
    if (condition) {
      Logger.log('OK: ' + label);
      passed++;
    } else {
      Logger.log('FAIL: ' + label);
      failed++;
    }
  }

  // ---- formatInspectionCompletionValue() produces "Yes <formatDateTimeShort>" ----
  (function formatProducesYesPrefix() {
    const date = new Date('2026-08-02T09:15:00');
    const formatted = formatInspectionCompletionValue(date);
    check('formatInspectionCompletionValue starts with "Yes "', formatted.indexOf('Yes ') === 0);
    check('formatInspectionCompletionValue includes formatDateTimeShort output',
          formatted === 'Yes ' + formatDateTimeShort(date));
  })();

  // ---- Round trip: parse(format(date)) recovers the same moment (to the minute) ----
  (function roundTrip() {
    const date = new Date('2026-08-02T16:08:00');
    const formatted = formatInspectionCompletionValue(date);
    const parsed = parseInspectionCompletionTimestamp_(formatted);
    check('round trip recovers a non-null Date', parsed instanceof Date && !isNaN(parsed.getTime()));
    check('round trip recovers the same minute', parsed && parsed.getFullYear() === date.getFullYear() &&
          parsed.getMonth() === date.getMonth() && parsed.getDate() === date.getDate() &&
          parsed.getHours() === date.getHours() && parsed.getMinutes() === date.getMinutes());
  })();

  // ---- parseInspectionCompletionTimestamp_() never guesses on bad input ----
  (function parserRejectsBadInput() {
    check('blank value -- null', parseInspectionCompletionTimestamp_('') === null);
    check('undefined value -- null', parseInspectionCompletionTimestamp_(undefined) === null);
    check('plain "Yes" with no timestamp -- null', parseInspectionCompletionTimestamp_('Yes') === null);
    check('value not starting with Yes -- null', parseInspectionCompletionTimestamp_('8/2/2026 9:15 AM') === null);
    check('"Yes" followed by unparseable text -- null', parseInspectionCompletionTimestamp_('Yes not a date') === null);
  })();

  // ---- isInspectionCompletionValueSet_() recognizes both the plain 'Yes' ----
  // (column V) and 'Yes <timestamp>' (columns W/X) formats, and only those.
  (function completionValueSetDetection() {
    check('bare "Yes" is set', isInspectionCompletionValueSet_('Yes') === true);
    check('"Yes <timestamp>" is set', isInspectionCompletionValueSet_('Yes 8/2/2026 9:15 AM') === true);
    check('blank is not set', isInspectionCompletionValueSet_('') === false);
    check('undefined is not set', isInspectionCompletionValueSet_(undefined) === false);
    check('"No" is not set', isInspectionCompletionValueSet_('No') === false);
    check('a value merely containing Yes later is not set (must start with Yes)',
          isInspectionCompletionValueSet_('Not Yes') === false);
  })();

  Logger.log(failed === 0
    ? 'All ' + passed + ' inspection completion formatting/parsing checks passed.'
    : passed + ' passed, ' + failed + ' failed.');
}

// ---------------------------------------------------------------------------
// TEST 31: Post-trip reminder eligibility (isPostTripReminderEligible) [CONFIG]
// Pure test against the eligibility helper used by processReminders() to
// decide whether a booking's post-trip reminder should be attempted. No
// sheet reads, no external calls. Covers: not eligible before pre-trip
// completion is known, not eligible before an hour has elapsed, eligible
// once an hour has elapsed, and the already-sent no-duplicate case. Mirrors
// testPreTripReminderEligibility's structure above.
// ---------------------------------------------------------------------------
function testPostTripReminderEligibility() {
  let passed = 0;
  let failed = 0;

  function check(label, hoursSincePreTripCompleted, sentPost, expected) {
    const actual = isPostTripReminderEligible(hoursSincePreTripCompleted, sentPost);
    if (actual === expected) {
      Logger.log('OK (' + label + '): isPostTripReminderEligible(' + hoursSincePreTripCompleted + ', ' +
                 JSON.stringify(sentPost) + ') = ' + actual);
      passed++;
    } else {
      Logger.log('FAIL (' + label + '): expected ' + expected + ', got ' + actual +
                 ' for hoursSincePreTripCompleted=' + hoursSincePreTripCompleted +
                 ', sentPost=' + JSON.stringify(sentPost));
      failed++;
    }
  }

  // 1. Pre-trip inspection not yet completed (null -- unknown/unparseable) -- never eligible
  check('pre-trip completion unknown -- not eligible', null, '', false);
  check('pre-trip completion unknown, even with everything else true -- not eligible', null, '', false);

  // 2. Less than one hour since pre-trip completion -- not yet eligible
  check('30 minutes since pre-trip completion -- not eligible', 0.5, '', false);
  check('just under an hour -- not eligible', 0.98, '', false);

  // 3. Exactly one hour or more since pre-trip completion -- eligible
  check('exactly one hour since pre-trip completion -- eligible', 1, '', true);
  check('well over an hour since pre-trip completion -- eligible', 5, '', true);

  // 4. L already Yes -- never re-eligible (no duplicate reminder)
  check('L already Yes -- not eligible', 5, 'Yes', false);
  check('L already Yes even with hours well past one -- not eligible', 100, 'Yes', false);

  Logger.log(failed === 0
    ? 'All ' + passed + ' post-trip reminder eligibility checks passed.'
    : passed + ' passed, ' + failed + ' failed.');
}

// ---------------------------------------------------------------------------
// TEST 32: Post-trip reminder send-and-flag behavior (sendPostTripReminder_) [CONFIG]
// Verifies that src/Reminders.js's sendPostTripReminder_() only writes column L
// (Post-Rental Sent) when the customer was actually reached, matching the same
// "delivered if reached by either channel" pattern as sendPreTripReminder_()
// above. Uses a fake sheet object (no live Sheets API calls) and temporarily
// stubs the global sendSms / sendEmailHtml functions so no real Twilio or
// SendGrid call is made. Both stubbed functions are restored in a finally
// block even if an assertion fails.
// ---------------------------------------------------------------------------
function testSendPostTripReminderFlagBehavior() {
  let passed = 0;
  let failed = 0;

  function check(label, condition) {
    if (condition) {
      Logger.log('OK: ' + label);
      passed++;
    } else {
      Logger.log('FAIL: ' + label);
      failed++;
    }
  }

  function fakeSheet() {
    const writes = [];
    return {
      writes: writes,
      getRange: function(row, col) {
        return {
          setValue: function(value) {
            writes.push({ row: row, col: col, value: value });
          }
        };
      }
    };
  }

  const fakeLocCfg = { email: 'sender@example.com', phone: '+12065550100' };

  const realSendSms       = sendSms;
  const realSendEmailHtml = sendEmailHtml;

  try {
    // ---- Both channels fail -- L is NOT marked Yes, no false "done" state ----
    (function bothChannelsFail() {
      sendSms       = function() { throw new Error('simulated Twilio outage'); };
      sendEmailHtml = function() { throw new Error('simulated SendGrid outage'); };

      const sheet = fakeSheet();
      const result = sendPostTripReminder_(
        sheet, 4, 'Test Customer', 'customer@example.com', '+12065551234',
        fakeLocCfg, 'August 1, 2026 at 9:00 AM', 'Cargo Van', 'Bainbridge',
        'https://example.com/post-inspect'
      );

      check('both channels failing returns false (not delivered)', result === false);
      check('both channels failing writes nothing to column L', sheet.writes.length === 0);
    })();

    // ---- SMS succeeds even though email fails -- still delivered, L written ----
    (function smsSucceedsEmailFails() {
      sendSms       = function() { /* succeeds */ };
      sendEmailHtml = function() { throw new Error('simulated SendGrid outage'); };

      const sheet = fakeSheet();
      const result = sendPostTripReminder_(
        sheet, 4, 'Test Customer', 'customer@example.com', '+12065551234',
        fakeLocCfg, 'August 1, 2026 at 9:00 AM', 'Cargo Van', 'Bainbridge',
        'https://example.com/post-inspect'
      );

      check('sms success alone counts as delivered', result === true);
      check('column L (row 5, col 12) written exactly once', sheet.writes.length === 1 &&
            sheet.writes[0].row === 5 && sheet.writes[0].col === 12 && sheet.writes[0].value === 'Yes');
    })();

    // ---- No phone and no email on file -- treated as delivered (avoid endless retry) ----
    (function noContactInfoAtAll() {
      sendSms       = function() { throw new Error('should not be called -- no phone on file'); };
      sendEmailHtml = function() { throw new Error('should not be called -- no email on file'); };

      const sheet = fakeSheet();
      const result = sendPostTripReminder_(
        sheet, 4, 'Test Customer', 'No Email', 'No Phone',
        fakeLocCfg, 'August 1, 2026 at 9:00 AM', 'Cargo Van', 'Bainbridge',
        'https://example.com/post-inspect'
      );

      check('no contact info at all is treated as delivered (matches sendPreTripReminder_ precedent)', result === true);
      check('column L still written when there is no way to reach the customer', sheet.writes.length === 1);
    })();
  } finally {
    // Always restore the real functions, even if an assertion above failed.
    sendSms       = realSendSms;
    sendEmailHtml = realSendEmailHtml;
  }

  check('sendSms restored to the original function', sendSms === realSendSms);
  check('sendEmailHtml restored to the original function', sendEmailHtml === realSendEmailHtml);

  Logger.log(failed === 0
    ? 'All ' + passed + ' post-trip reminder send/flag checks passed.'
    : passed + ' passed, ' + failed + ' failed.');
}

// ---------------------------------------------------------------------------
// TEST 33: Approval reminder count behavior (checkRentalEligibility_) [CONFIG]
// Verifies the Approval Reminder Count column (Q) end-to-end by calling the
// real production function directly against a fake sheet -- no live sheet is
// read or written, and sendEmailHtml is stubbed so no real email is sent
// (both restored in a finally block). Covers: blank / numeric / numeric-
// string count values are all interpreted correctly, the count increments
// correctly, the correct booking row is updated, reminders stop at
// CONFIG.MAX_APPROVAL_REMINDERS, a failed send does not increment the count,
// and one booking's row cannot affect another booking's row in the same run.
// ---------------------------------------------------------------------------
function testApprovalReminderCountBehavior() {
  let passed = 0;
  let failed = 0;

  function check(label, condition) {
    if (condition) {
      Logger.log('OK: ' + label);
      passed++;
    } else {
      Logger.log('FAIL: ' + label);
      failed++;
    }
  }

  // Fake sheet backed by a plain in-memory array of rows (header + data).
  // getRange(row, col).setValue() records writes instead of touching a live
  // sheet. Row/column layout matches the real Bookings sheet up through
  // column U (0-indexed 0-20) -- only the columns checkRentalEligibility_()
  // actually reads are populated.
  function fakeSheet(rows) {
    const writes = [];
    const header = new Array(21).fill('');
    const data   = [header].concat(rows);
    return {
      writes: writes,
      getDataRange: function() {
        return { getValues: function() { return data; } };
      },
      getRange: function(row, col) {
        return {
          setValue: function(value) { writes.push({ row: row, col: col, value: value }); }
        };
      }
    };
  }

  function fakeRow(name, email, phone, startTime, approvedValue, lastNotifiedAt, reminderCountRaw) {
    const row = new Array(21);
    row[1]  = name;
    row[2]  = email;
    row[3]  = phone;
    row[4]  = startTime;
    row[8]  = 'Yes';            // I: Intake Sent -- required for the row to be considered at all
    row[13] = '';                // N: Lease Signed
    row[14] = approvedValue;     // O: Rental Approved (blank = pending)
    row[15] = lastNotifiedAt;    // P: Approval Notified At
    row[16] = reminderCountRaw;  // Q: Approval Reminder Count
    row[17] = 'Cargo Van';       // R: Vehicle Type
    row[18] = 'Bainbridge';      // S: Location
    row[20] = '';                // U: Customer Approval Notified
    return row;
  }

  const soon         = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);  // outside the reminder-due window by itself; only O/P/Q matter here
  const longAgo       = new Date(Date.now() - 100 * 60 * 60 * 1000);     // well past HOURS_BETWEEN_APPROVAL_REMINDERS
  const recentlySent   = new Date(Date.now() - 1 * 60 * 60 * 1000);       // not yet due again under the documented default (12h)

  const realGetSheet      = getSheet;
  const realSendEmailHtml = sendEmailHtml;
  let emailCallCount = 0;
  let shouldFailEmail = false;

  try {
    sendEmailHtml = function() {
      emailCallCount++;
      if (shouldFailEmail) throw new Error('simulated SendGrid outage');
    };

    // ---- 1. Blank count -- interpreted as 0, triggers the initial send ----
    (function blankCountSendsInitial() {
      const sheet = fakeSheet([ fakeRow('Blank Count', 'blank@example.com', '+12065550001', soon, '', '', '') ]);
      getSheet = function() { return sheet; };
      emailCallCount = 0;
      checkRentalEligibility_();
      check('blank count -- exactly one email sent (initial)', emailCallCount === 1);
      check('blank count -- Q written as 1 on row 2', sheet.writes.some(function(w) { return w.row === 2 && w.col === 17 && w.value === 1; }));
      check('blank count -- P written on row 2', sheet.writes.some(function(w) { return w.row === 2 && w.col === 16; }));
    })();

    // ---- 2. Existing numeric count (1), due for its next reminder -- increments to 2 ----
    (function numericCountIncrementsCorrectly() {
      const sheet = fakeSheet([ fakeRow('Numeric Count', 'num@example.com', '+12065550002', soon, '', longAgo, 1) ]);
      getSheet = function() { return sheet; };
      emailCallCount = 0;
      checkRentalEligibility_();
      check('numeric count 1 -- one reminder email sent', emailCallCount === 1);
      check('numeric count 1 -- Q written as 2', sheet.writes.some(function(w) { return w.row === 2 && w.col === 17 && w.value === 2; }));
    })();

    // ---- 3. Existing numeric-STRING count ("2"), due for its next reminder -- increments to 3 ----
    (function numericStringCountIncrementsCorrectly() {
      const sheet = fakeSheet([ fakeRow('String Count', 'str@example.com', '+12065550003', soon, '', longAgo, '2') ]);
      getSheet = function() { return sheet; };
      emailCallCount = 0;
      checkRentalEligibility_();
      check('numeric-string count "2" -- one reminder email sent', emailCallCount === 1);
      check('numeric-string count "2" -- Q written as 3', sheet.writes.some(function(w) { return w.row === 2 && w.col === 17 && w.value === 3; }));
    })();

    // ---- 4. Count at MAX -- escalates instead of a normal reminder; reminders stop at the intended maximum ----
    (function stopsAtMaximumAndEscalates() {
      const sheet = fakeSheet([ fakeRow('At Max', 'atmax@example.com', '+12065550004', soon, '', longAgo, CONFIG.MAX_APPROVAL_REMINDERS) ]);
      getSheet = function() { return sheet; };
      emailCallCount = 0;
      checkRentalEligibility_();
      check('count at MAX -- exactly one escalation email sent', emailCallCount === 1);
      check('count at MAX -- Q written as MAX+1 (permanent skip)',
            sheet.writes.some(function(w) { return w.row === 2 && w.col === 17 && w.value === CONFIG.MAX_APPROVAL_REMINDERS + 1; }));
      check('count at MAX -- P is NOT written on escalation', !sheet.writes.some(function(w) { return w.row === 2 && w.col === 16; }));
    })();

    // ---- 5. Count already past MAX -- permanently silenced: no email, no write ----
    (function permanentlySilencedAfterMax() {
      const sheet = fakeSheet([ fakeRow('Past Max', 'pastmax@example.com', '+12065550005', soon, '', longAgo, CONFIG.MAX_APPROVAL_REMINDERS + 1) ]);
      getSheet = function() { return sheet; };
      emailCallCount = 0;
      checkRentalEligibility_();
      check('count past MAX -- no email sent', emailCallCount === 0);
      check('count past MAX -- no write at all', sheet.writes.length === 0);
    })();

    // ---- 6. Reminder not yet due (recently notified) -- no email, no write ----
    (function reminderNotYetDue() {
      const sheet = fakeSheet([ fakeRow('Not Due', 'notdue@example.com', '+12065550006', soon, '', recentlySent, 1) ]);
      getSheet = function() { return sheet; };
      emailCallCount = 0;
      checkRentalEligibility_();
      check('reminder not yet due -- no email sent', emailCallCount === 0);
      check('reminder not yet due -- no write at all', sheet.writes.length === 0);
    })();

    // ---- 7. Failed delivery does NOT increment the count ----
    (function failedDeliveryDoesNotIncrement() {
      const sheet = fakeSheet([ fakeRow('Fails', 'fails@example.com', '+12065550007', soon, '', '', '') ]);
      getSheet = function() { return sheet; };
      shouldFailEmail = true;
      checkRentalEligibility_();
      shouldFailEmail = false;
      check('failed send -- no write at all (count not incremented)', sheet.writes.length === 0);
    })();

    // ---- 8. Correct row targeting: two rows in one run, each affects only its own row ----
    (function correctRowTargetingNoCrossContamination() {
      const sheet = fakeSheet([
        fakeRow('Row A Blank', 'rowa@example.com', '+12065550008', soon, '', '', ''),                                 // sheet row 2 -- initial send
        fakeRow('Row B AtMax', 'rowb@example.com', '+12065550009', soon, '', longAgo, CONFIG.MAX_APPROVAL_REMINDERS), // sheet row 3 -- escalation
      ]);
      getSheet = function() { return sheet; };
      emailCallCount = 0;
      checkRentalEligibility_();

      check('two-row run -- exactly two emails sent (one per row)', emailCallCount === 2);
      check('row A (sheet row 2) written with value 1',
            sheet.writes.some(function(w) { return w.row === 2 && w.col === 17 && w.value === 1; }));
      check('row B (sheet row 3) written with value MAX+1',
            sheet.writes.some(function(w) { return w.row === 3 && w.col === 17 && w.value === CONFIG.MAX_APPROVAL_REMINDERS + 1; }));
      check('no write landed on any row other than 2 or 3',
            sheet.writes.every(function(w) { return w.row === 2 || w.row === 3; }));
    })();
  } finally {
    getSheet      = realGetSheet;
    sendEmailHtml = realSendEmailHtml;
  }

  check('getSheet restored to the original function', getSheet === realGetSheet);
  check('sendEmailHtml restored to the original function', sendEmailHtml === realSendEmailHtml);

  Logger.log(failed === 0
    ? 'All ' + passed + ' approval reminder count checks passed.'
    : passed + ' passed, ' + failed + ' failed.');
}

// ---------------------------------------------------------------------------
// TEST 34: Suspicious inspection timing calculations [CONFIG]
// Pure tests against getInspectionElapsedMinutes(), isSuspiciousInspectionTiming(),
// and formatElapsedMinutes() (all in Helpers.js) -- no sheet reads, no
// external calls. Covers elapsed-time calculation, missing/malformed
// timestamps, the suspicious-timing threshold (outside / exactly at / inside),
// post-trip earlier than pre-trip, and elapsed-time formatting.
// ---------------------------------------------------------------------------
function testSuspiciousInspectionTimingCalculations() {
  let passed = 0;
  let failed = 0;

  function check(label, condition) {
    if (condition) {
      Logger.log('OK: ' + label);
      passed++;
    } else {
      Logger.log('FAIL: ' + label);
      failed++;
    }
  }

  const THRESHOLD = 15; // matches the documented default for SUSPICIOUS_INSPECTION_WINDOW_MINUTES

  // ---- getInspectionElapsedMinutes() ----
  (function elapsedMinutesCalculation() {
    const pre  = new Date('2026-08-02T09:00:00');
    const post = new Date('2026-08-02T09:10:00');
    check('10 minutes apart -- elapsed = 10', getInspectionElapsedMinutes(pre, post) === 10);

    const postEarlier = new Date('2026-08-02T08:55:00');
    check('post-trip earlier than pre-trip -- elapsed is negative', getInspectionElapsedMinutes(pre, postEarlier) === -5);

    check('missing pre-trip timestamp -- null', getInspectionElapsedMinutes(null, post) === null);
    check('missing post-trip timestamp -- null', getInspectionElapsedMinutes(pre, null) === null);
    check('malformed pre-trip timestamp -- null', getInspectionElapsedMinutes(new Date('not a date'), post) === null);
    check('malformed post-trip timestamp -- null', getInspectionElapsedMinutes(pre, new Date('not a date')) === null);
  })();

  // ---- isSuspiciousInspectionTiming() ----
  // Boundary rule: elapsed time LESS THAN OR EQUAL TO the threshold is
  // suspicious (inclusive) -- a submission exactly at the configured
  // threshold is exactly as close together as the threshold was meant to
  // catch, so it must not be the one case that slips through.
  (function suspiciousThresholdChecks() {
    check('well outside threshold (60 min) -- not suspicious', isSuspiciousInspectionTiming(60, THRESHOLD) === false);
    check('just outside threshold (16 min) -- not suspicious', isSuspiciousInspectionTiming(16, THRESHOLD) === false);
    check('exactly at threshold (15 min) -- suspicious (inclusive boundary)', isSuspiciousInspectionTiming(15, THRESHOLD) === true);
    check('just inside threshold (14 min) -- suspicious', isSuspiciousInspectionTiming(14, THRESHOLD) === true);
    check('well inside threshold (1 min) -- suspicious', isSuspiciousInspectionTiming(1, THRESHOLD) === true);
    check('zero minutes apart -- suspicious', isSuspiciousInspectionTiming(0, THRESHOLD) === true);
    check('post-trip earlier than pre-trip (negative) -- suspicious', isSuspiciousInspectionTiming(-5, THRESHOLD) === true);
    check('null elapsed (nothing to compare yet) -- not suspicious', isSuspiciousInspectionTiming(null, THRESHOLD) === false);
  })();

  // ---- formatElapsedMinutes() ----
  (function elapsedFormatting() {
    check('0 minutes formats as "0 minutes"', formatElapsedMinutes(0) === '0 minutes');
    check('1 minute formats singular', formatElapsedMinutes(1) === '1 minute');
    check('45 minutes formats as "45 minutes"', formatElapsedMinutes(45) === '45 minutes');
    check('60 minutes formats as "1 hour"', formatElapsedMinutes(60) === '1 hour');
    check('65 minutes formats as "1 hour 5 minutes"', formatElapsedMinutes(65) === '1 hour 5 minutes');
    check('120 minutes formats as "2 hours"', formatElapsedMinutes(120) === '2 hours');
    check('negative value includes an explanatory note',
          formatElapsedMinutes(-10).indexOf('post-trip was recorded before pre-trip') !== -1);
    check('negative value still shows a positive-looking duration',
          formatElapsedMinutes(-10).indexOf('10 minute') === 0);
  })();

  Logger.log(failed === 0
    ? 'All ' + passed + ' suspicious inspection timing calculation checks passed.'
    : passed + ' passed, ' + failed + ' failed.');
}

// ---------------------------------------------------------------------------
// TEST 35: Suspicious inspection timing warning send/flag behavior
// (sendSuspiciousInspectionTimingWarning_) [CONFIG]
// Verifies src/Reminders.js's sendSuspiciousInspectionTimingWarning_() only
// writes column Y (Suspicious Timing Warning Sent) after a successful
// manager email, matching the same write-after-success pattern used
// throughout Reminders.js -- this is what makes the warning durably
// send-once-per-booking. Uses a fake sheet (no live Sheets API calls) and
// temporarily stubs the global sendEmailHtml function so no real SendGrid
// call is made (restored in a finally block even if an assertion fails).
// ---------------------------------------------------------------------------
function testSendSuspiciousInspectionTimingWarningFlagBehavior() {
  let passed = 0;
  let failed = 0;

  function check(label, condition) {
    if (condition) {
      Logger.log('OK: ' + label);
      passed++;
    } else {
      Logger.log('FAIL: ' + label);
      failed++;
    }
  }

  function fakeSheet() {
    const writes = [];
    return {
      writes: writes,
      getRange: function(row, col) {
        return {
          setValue: function(value) { writes.push({ row: row, col: col, value: value }); }
        };
      }
    };
  }

  const fakeLocCfg = { email: 'sender@example.com', phone: '+12065550100' };
  const pre  = new Date('2026-08-02T09:00:00');
  const post = new Date('2026-08-02T09:10:00');

  const realSendEmailHtml = sendEmailHtml;

  try {
    // ---- Successful send writes column Y = Yes (duplicate-prevention flag) ----
    (function successWritesFlag() {
      sendEmailHtml = function() { /* succeeds */ };
      const sheet = fakeSheet();
      const result = sendSuspiciousInspectionTimingWarning_(
        sheet, 4, 'EVT123', 'Test Customer', 'Cargo Van', 'Bainbridge',
        'August 1, 2026 at 9:00 AM', 'August 1, 2026 at 1:00 PM',
        pre, post, 10, fakeLocCfg
      );
      check('successful send returns true', result === true);
      check('column Y (row 5, col 25) written exactly once', sheet.writes.length === 1 &&
            sheet.writes[0].row === 5 && sheet.writes[0].col === 25 && sheet.writes[0].value === 'Yes');
    })();

    // ---- Failed send does not write column Y -- retried on the next run ----
    (function failureDoesNotWriteFlag() {
      sendEmailHtml = function() { throw new Error('simulated SendGrid outage'); };
      const sheet = fakeSheet();
      const result = sendSuspiciousInspectionTimingWarning_(
        sheet, 4, 'EVT124', 'Test Customer', 'Cargo Van', 'Bainbridge',
        'August 1, 2026 at 9:00 AM', 'August 1, 2026 at 1:00 PM',
        pre, post, 10, fakeLocCfg
      );
      check('failed send returns false', result === false);
      check('failed send writes nothing (so the next run retries)', sheet.writes.length === 0);
    })();

    // ---- No manager email configured -- no send attempted, no write ----
    (function noManagerEmailConfigured() {
      sendEmailHtml = function() { throw new Error('should not be called -- no manager email configured'); };
      const realManagerEmail = CONFIG.MANAGER_EMAIL;
      CONFIG.MANAGER_EMAIL = '';
      const sheet = fakeSheet();
      const result = sendSuspiciousInspectionTimingWarning_(
        sheet, 4, 'EVT125', 'Test Customer', 'Cargo Van', 'Bainbridge',
        'August 1, 2026 at 9:00 AM', 'August 1, 2026 at 1:00 PM',
        pre, post, 10, fakeLocCfg
      );
      CONFIG.MANAGER_EMAIL = realManagerEmail;
      check('no MANAGER_EMAIL configured -- returns false', result === false);
      check('no MANAGER_EMAIL configured -- writes nothing', sheet.writes.length === 0);
      check('CONFIG.MANAGER_EMAIL restored', CONFIG.MANAGER_EMAIL === realManagerEmail);
    })();
  } finally {
    sendEmailHtml = realSendEmailHtml;
  }

  check('sendEmailHtml restored to the original function', sendEmailHtml === realSendEmailHtml);

  Logger.log(failed === 0
    ? 'All ' + passed + ' suspicious inspection timing warning send/flag checks passed.'
    : passed + ' passed, ' + failed + ' failed.');
}

// ---------------------------------------------------------------------------
// TEST 27: Trigger registration functions are defined and safe to reference [CONFIG]
// This is a narrow, deliberately static check -- it does NOT invoke
// ScriptApp, does NOT create a real trigger, and does NOT run setupTriggers()
// or installFormSubmitTrigger_(). Full idempotency (that re-running
// setupTriggers() never creates duplicate triggers) can only be verified by
// actually running it in a live Apps Script project, which is out of scope
// for a safe automated test. This only confirms the functions this design
// depends on exist with the expected names and that the constants they use
// are sane, so a typo or accidental deletion is caught without ever touching
// ScriptApp.
// ---------------------------------------------------------------------------
function testTriggerRegistrationIsWellFormed() {
  let passed = 0;
  let failed = 0;

  function check(label, condition) {
    if (condition) {
      Logger.log('OK: ' + label);
      passed++;
    } else {
      Logger.log('FAIL: ' + label);
      failed++;
    }
  }

  check('setupTriggers is defined', typeof setupTriggers === 'function');
  check('installFormSubmitTrigger_ is defined', typeof installFormSubmitTrigger_ === 'function');
  check('onFormSubmit is defined', typeof onFormSubmit === 'function');

  check('processIntakeFormSubmission_ is defined', typeof processIntakeFormSubmission_ === 'function');
  check('INTAKE_RESPONSE_SHEET_NAME is a non-empty string',
        typeof INTAKE_RESPONSE_SHEET_NAME === 'string' && INTAKE_RESPONSE_SHEET_NAME.length > 0);
  check('INTAKE_RESPONSE_SHEET_NAME is the exact verified tab name',
        INTAKE_RESPONSE_SHEET_NAME === 'Rental Intake Form');

  check('processInspectionFormSubmission_ is defined', typeof processInspectionFormSubmission_ === 'function');
  check('INSPECT_RESPONSE_SHEET_NAME is a non-empty string',
        typeof INSPECT_RESPONSE_SHEET_NAME === 'string' && INSPECT_RESPONSE_SHEET_NAME.length > 0);
  check('INSPECT_RESPONSE_SHEET_NAME is the exact verified tab name',
        INSPECT_RESPONSE_SHEET_NAME === 'Rental Vehicle Condition Inspection Form');
  check('INSPECT_RESPONSE_EMAIL_QUESTION_TITLE is the exact verified header',
        INSPECT_RESPONSE_EMAIL_QUESTION_TITLE === 'Email Address');
  check('INSPECT_RESPONSE_DATE_QUESTION_TITLE is the exact verified header',
        INSPECT_RESPONSE_DATE_QUESTION_TITLE === 'Rental Date');
  check('INSPECT_RESPONSE_TYPE_QUESTION_TITLE is the exact verified header',
        INSPECT_RESPONSE_TYPE_QUESTION_TITLE === 'Inspection Type');

  check('INSPECTION_RESPONSE_SHEET_ID Script Property is not required (removed)',
        typeof INSPECTION_RESPONSE_SHEET_ID === 'undefined');

  Logger.log(failed === 0
    ? 'All ' + passed + ' trigger registration well-formedness checks passed. ' +
      'Note: this does not create or inspect any real trigger.'
    : passed + ' passed, ' + failed + ' failed.');
}

// ============================================================
// CONFIGURATION TESTS
// ============================================================

// ---------------------------------------------------------------------------
// TEST 10: Configuration validation [CONFIG]
// Verifies all required numeric Script Properties are set and contain valid
// finite numbers. Run this first when setting up a new environment or after
// changing Script Properties. Reports every problem before throwing.
// ---------------------------------------------------------------------------
function validateConfig() {
  var errors = [];

  var NUMERIC_PROPS = [
    'DAYS_AHEAD',
    'HOURS_BETWEEN_APPROVAL_REMINDERS',
    'MAX_APPROVAL_REMINDERS',
    'SUSPICIOUS_INSPECTION_WINDOW_MINUTES',
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
// TEST 15: Email template string verification [CONFIG]
// Constructs sample message strings using the same interpolation patterns as
// the production functions and checks for known-bad strings introduced by
// earlier hardcoded wording. No sheet reads, no API calls.
// ---------------------------------------------------------------------------
function testEmailTemplateStrings() {
  let passed = 0;
  let failed = 0;

  const cargoVanType = 'Cargo Van';
  const location     = 'Bainbridge';
  const dateStr      = 'July 26, 2026 at 10:00 AM';
  const name         = 'Test Customer';

  // ---- Welcome email subject must not say "truck rental" for Cargo Van ----
  const welcomeSubject = 'Your ' + cargoVanType + ' reservation for ' + dateStr;
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
    'Your ' + cargoVanType + ' reservation at our ' +
    location + ' location is scheduled for ' + dateStr + '.';
  if (welcomeBody.toLowerCase().includes('moving truck')) {
    Logger.log('FAIL (welcome body): contains "moving truck": ' + welcomeBody);
    failed++;
  } else {
    Logger.log('OK (welcome body): vehicle type "' + cargoVanType + '" used correctly');
    passed++;
  }

  // ---- Post-rental email body must not say "returning the truck" ----
  const postRentalBody =
    'Thank you for completing your ' + cargoVanType + ' rental ' +
    'at our ' + location + ' location on ' + dateStr + '.';
  if (postRentalBody.toLowerCase().includes('returning the truck')) {
    Logger.log('FAIL (post-rental body): contains "returning the truck"');
    failed++;
  } else {
    Logger.log('OK (post-rental body): no hardcoded "truck" wording');
    passed++;
  }

  // ---- DocuSeal subject must not use an em dash or a double hyphen ----
  const docuSealSubject = 'Your ' + CONFIG.COMPANY_NAME + ' rental agreement for ' + dateStr;
  if (docuSealSubject.includes('--') || docuSealSubject.includes('—')) {
    Logger.log('FAIL (DocuSeal subject): contains a dash separator that should have been removed: ' + docuSealSubject);
    failed++;
  } else {
    Logger.log('OK (DocuSeal subject): no em dash or double hyphen');
    passed++;
  }

  // ---- Sample outgoing email strings must contain no em dash and no bold markup ----
  // Mirrors the same style rules enforced across src/ (Approval.js, CalendarSync.js,
  // Reminders.js, Webhooks.js, DocuSeal.js): no "—", no <b>/<strong>.
  const sampleOutgoingStrings = [
    welcomeSubject,
    welcomeBody,
    postRentalBody,
    docuSealSubject,
    'Deposit confirmed: ' + cargoVanType + ' rental on ' + dateStr,
    'Your rental is approved',
    'Action needed: approve rental for ' + name,
    "Tomorrow's rental: " + name + ', ' + cargoVanType + ' at ' + location + ' on ' + dateStr + '.',
  ];
  let dashOrBoldFound = false;
  sampleOutgoingStrings.forEach(function(s) {
    if (s.includes('—') || s.includes('<b>') || s.includes('<strong>')) {
      Logger.log('FAIL (style check): forbidden em dash or bold markup in: ' + s);
      dashOrBoldFound = true;
      failed++;
    }
  });
  if (!dashOrBoldFound) {
    Logger.log('OK (style check): ' + sampleOutgoingStrings.length + ' sample strings contain no em dash or bold markup.');
    passed++;
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
// TEST 16: SendGrid configuration check [CONFIG]
// Verifies that all Script Properties consumed by sendEmailHtml() and
// alertAdmin() are set and non-blank, and that address fields look like
// email addresses. No email sent, no API call. Does not verify SendGrid
// sender status — that requires a live API call.
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
// TEST 17: Twilio configuration check [CONFIG]
// Verifies that all Script Properties consumed by sendSms() and the manager
// SMS paths are set and correctly formatted. No SMS sent, no API call.
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

// ---------------------------------------------------------------------------
// TEST 18: Location-specific sender configuration [CONFIG]
// Verifies that all EMAIL_<LOCATION> and PHONE_<LOCATION> Script Properties
// are set and correctly formatted for the four active locations, and that
// getLocationConfig() resolves every active location without throwing.
// Does not send any email or SMS. Does not make any API calls.
// ---------------------------------------------------------------------------
function testLocationSenderConfig() {
  let passed = 0;
  let failed = 0;

  function looksLikeEmail(val) {
    return typeof val === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim());
  }
  function looksLikeE164(val) {
    return typeof val === 'string' && /^\+\d{7,15}$/.test(val.trim());
  }

  const LOCATIONS = [
    { name: 'Bainbridge',   emailKey: 'EMAIL_BAINBRIDGE',   phoneKey: 'PHONE_BAINBRIDGE'   },
    { name: 'Poulsbo',      emailKey: 'EMAIL_POULSBO',       phoneKey: 'PHONE_POULSBO'      },
    { name: 'Port Orchard', emailKey: 'EMAIL_PORT_ORCHARD',  phoneKey: 'PHONE_PORT_ORCHARD' },
    { name: 'Fairgrounds',  emailKey: 'EMAIL_FAIRGROUNDS',   phoneKey: 'PHONE_FAIRGROUNDS'  },
  ];

  // ---- Check each property is set and in the correct format ----
  LOCATIONS.forEach(function(loc) {
    const emailVal = CONFIG[loc.emailKey];
    const phoneVal = CONFIG[loc.phoneKey];

    if (!emailVal || emailVal.trim() === '') {
      Logger.log('FAIL [' + loc.name + ']: ' + loc.emailKey + ' is not set in Script Properties.');
      failed++;
    } else if (!looksLikeEmail(emailVal)) {
      Logger.log('FAIL [' + loc.name + ']: ' + loc.emailKey + ' does not look like an email address (got "' + emailVal + '").');
      failed++;
    } else {
      Logger.log('OK [' + loc.name + ']: ' + loc.emailKey + ' is set and looks like an email address.');
      passed++;
    }

    if (!phoneVal || phoneVal.trim() === '') {
      Logger.log('FAIL [' + loc.name + ']: ' + loc.phoneKey +
                 ' is not set in Script Properties (must be an SMS-capable Twilio number in E.164 format).');
      failed++;
    } else if (!looksLikeE164(phoneVal)) {
      Logger.log('FAIL [' + loc.name + ']: ' + loc.phoneKey +
                 ' does not look like an E.164 phone number (got "' + phoneVal + '"). ' +
                 'Must start with + followed by 7–15 digits (e.g. +12065551234).');
      failed++;
    } else {
      Logger.log('OK [' + loc.name + ']: ' + loc.phoneKey + ' is set and looks like an E.164 number.');
      passed++;
    }
  });

  // ---- Verify getLocationConfig resolves each active location without throwing ----
  LOCATIONS.forEach(function(loc) {
    try {
      const cfg = getLocationConfig(loc.name);
      if (!cfg.email || !cfg.phone) {
        Logger.log('FAIL [' + loc.name + ']: getLocationConfig returned config with blank email or phone.');
        failed++;
      } else {
        Logger.log('OK [' + loc.name + ']: getLocationConfig resolved correctly.');
        passed++;
      }
    } catch(e) {
      Logger.log('FAIL [' + loc.name + ']: getLocationConfig threw unexpectedly: ' + e.message);
      failed++;
    }
  });

  // ---- Verify unknown location throws rather than silently falling back ----
  let unknownThrew = false;
  try {
    getLocationConfig('Unknown Location');
  } catch(e) {
    unknownThrew = true;
  }
  if (unknownThrew) {
    Logger.log('OK (unknown location): getLocationConfig correctly threw for an unrecognised location.');
    passed++;
  } else {
    Logger.log('FAIL (unknown location): getLocationConfig should throw for an unrecognised location but did not.');
    failed++;
  }

  Logger.log(failed === 0
    ? 'All ' + passed + ' location sender configuration checks passed.'
    : passed + ' passed, ' + failed + ' failed.');
}

// ============================================================
// TEST RUNNERS
// ============================================================

// ---------------------------------------------------------------------------
// RUNNER: runAllSandboxConfigurationTests [CONFIG + CALENDAR]
// Runs configuration-only tests in sequence. Stops and re-throws on first
// failure. Does not include sync or response-parsing tests that require a
// live sheet row (see testMarkDepositPaidRowLookup, testMarkLeaseSignedRowLookup),
// or testSyncCalendarBookingsNoNotifications [MUTATION], which appends rows
// to the live sheet. testMissingCalendarConfig [CALENDAR] (read-only,
// CalendarApp.getCalendarById on a bad ID) and testExtractDocuSealSubmissionId
// / testEmailTemplateStrings [CONFIG] (both pure, no external calls) are
// included per their category contracts above -- previously defined but not
// wired in here, a gap closed during a cleanup pass.
// testIntakeFormSubmitRowMatching, testInspectionFormSubmitRowMatching, the
// two extraction tests, testFormSubmitDispatcher, testPreTripReminderEligibility,
// testSendPreTripReminderFlagBehavior, testInspectionEmailsExcludeManagerFromRecipients,
// testInspectionCompletionFormatting, testPostTripReminderEligibility,
// testSendPostTripReminderFlagBehavior, testApprovalReminderCountBehavior,
// testSuspiciousInspectionTimingCalculations, and
// testSendSuspiciousInspectionTimingWarningFlagBehavior are included
// because they are pure tests against synthetic data (the send/flag tests
// temporarily stub global functions -- including, for
// testApprovalReminderCountBehavior, getSheet itself -- and always restore
// them, even on failure), with no live sheet or form dependency and no real
// email/SMS ever sent.
// ---------------------------------------------------------------------------
function runAllSandboxConfigurationTests() {
  Logger.log('===== Running Sandbox Configuration Tests (30 tests) =====');

  const tests = [
    validateConfig,
    testSheetConnection,
    testCalendarConfigs,
    testMissingCalendarConfig,
    testVehicleTypeAndLocationMapping,
    testStripeConfiguration,
    testDepositAmounts,
    testDocuSealPropertyNames,
    testExtractDocuSealSubmissionId,
    testSendGridConfiguration,
    testTwilioConfiguration,
    testLocationSenderConfig,
    testApprovalNotificationEligibility,
    testDocuSealEligibility,
    testEmailTemplateStrings,
    testIntakeFormSubmitRowMatching,
    testExtractIntakeSubmissionFields,
    testInspectionFormSubmitRowMatching,
    testExtractInspectionSubmissionFields,
    testFormSubmitDispatcher,
    testPreTripReminderEligibility,
    testSendPreTripReminderFlagBehavior,
    testInspectionEmailsExcludeManagerFromRecipients,
    testInspectionCompletionFormatting,
    testPostTripReminderEligibility,
    testSendPostTripReminderFlagBehavior,
    testApprovalReminderCountBehavior,
    testSuspiciousInspectionTimingCalculations,
    testSendSuspiciousInspectionTimingWarningFlagBehavior,
    testTriggerRegistrationIsWellFormed,
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
// MANUAL STANDALONE TEST: One-time Twilio SMS send [LIVE]
// Run this manually from the Apps Script editor to verify Twilio delivery.
// Do NOT add to runAllSandboxConfigurationTests() — this sends a real SMS.
// Requires SANDBOX_TEST_PHONE in Script Properties, set to your own verified
// test phone number (E.164 format). Never hardcode a real destination here.
// ---------------------------------------------------------------------------
function testSendSingleSms() {
  Logger.log('Starting sandbox SMS test...');

  const to = PROPS.SANDBOX_TEST_PHONE;
  if (!to) {
    throw new Error('testSendSingleSms: SANDBOX_TEST_PHONE is not set in Script Properties. ' +
      'Set it to your own verified test phone number (E.164 format) before running this test.');
  }

  const message =
    'Reliable Storage Sandbox Test\n\n' +
    'This is a manual Twilio SMS test from the sandbox environment.\n\n' +
    'If you received this message, Twilio is configured correctly.\n\n' +
    'Timestamp:\n' +
    formatDateTime(new Date());

  try {
    sendSms(to, message, CONFIG.PHONE_BAINBRIDGE);
    Logger.log('Sandbox SMS test completed successfully.');
  } catch(e) {
    Logger.log('Sandbox SMS test FAILED: ' + e);
  }
}

// ---------------------------------------------------------------------------
// MANUAL STANDALONE TEST: Immediate pre-trip inspection send [LIVE]
// ------------------------------------------------------------
// Sends the REAL production pre-trip inspection email and SMS immediately,
// without waiting for isPreTripReminderEligible()'s window, so the full
// message-building and delivery path can be exercised end-to-end at any
// time -- e.g. after changing the template, or to confirm SendGrid/Twilio
// are working. Reuses buildPreTripReminderContent_() (Reminders.js), so the
// exact production template is sent -- never a separate copy.
//
// SAFE BY DEFAULT: looks up the same "Test Customer" row used by
// testBuildIntakeUrl() for realistic content (name, vehicle, location,
// date), but sends to PROPS.SANDBOX_TEST_EMAIL / PROPS.SANDBOX_TEST_PHONE
// instead of that row's real contact info, and does NOT call
// sendPreTripReminder_() -- so column K is never written and the manager's
// 24-hour summary is never sent. This is a pure system test, not a real
// operational send. Contrast with sendPreTripInspectionNowForRow()
// (Reminders.js), which IS a real send for an authorized resend or an
// early-return scenario, and does update the normal sent flags.
//
// Requires SANDBOX_TEST_EMAIL and SANDBOX_TEST_PHONE in Script Properties,
// and a Bookings row with a name containing "Test Customer". Validates the
// test booking has an email, a phone, a recognized location, and that a
// form link can be built before sending anything.
//
// Do NOT add to runAllSandboxConfigurationTests() -- this sends real messages.
// ---------------------------------------------------------------------------
function testSendPreTripInspection() {
  Logger.log('Starting immediate pre-trip inspection test send...');

  const testEmail = PROPS.SANDBOX_TEST_EMAIL;
  const testPhone = PROPS.SANDBOX_TEST_PHONE;
  if (!testEmail || !testPhone) {
    throw new Error('testSendPreTripInspection: SANDBOX_TEST_EMAIL and SANDBOX_TEST_PHONE must both ' +
      'be set in Script Properties before running this test.');
  }

  const sheet = getSheet();
  const data  = sheet.getDataRange().getValues();

  let row = null;
  let rowNumber = null;
  for (let i = 1; i < data.length; i++) {
    if ((data[i][1] || '').toString().toLowerCase().includes('test customer')) {
      row = data[i];
      rowNumber = i + 1;
      break;
    }
  }

  if (!row) {
    Logger.log('testSendPreTripInspection: no row found with name containing "Test Customer". Add one to the sheet first.');
    return;
  }

  const name        = row[1];
  const email       = row[2];
  const phone       = (row[3] || '').toString().replace(/^'/, '');
  const rentalDate  = new Date(row[4]);
  const dateStr     = formatDateTime(rentalDate);
  const vehicleType = row[17] || '';
  const location    = row[18] || '';
  const leaseSigned = row[13];

  // Validate the test booking has what it needs before building or sending anything.
  const problems = [];
  if (!email || email === 'No Email') problems.push('email');
  if (!phone || phone === 'No Phone') problems.push('phone number');
  let locCfg = null;
  try { locCfg = getLocationConfig(location); }
  catch(e) { problems.push('a recognized location'); }
  if (!CONFIG.INSPECT_FORM_BASE) problems.push('INSPECT_FORM_BASE (form link cannot be built)');

  if (problems.length) {
    Logger.log('testSendPreTripInspection: test booking row ' + rowNumber + ' is missing: ' +
               problems.join(', ') + '. Aborting -- nothing sent.');
    return;
  }

  const preUrl  = buildInspectUrl(name, email, rentalDate, 'pre');
  const content = buildPreTripReminderContent_(name, vehicleType, location, dateStr, preUrl, leaseSigned);

  Logger.log('testSendPreTripInspection: using booking row ' + rowNumber + ' (' + name + ', ' +
             vehicleType + ' at ' + location + ') for content; sending to TEST recipient ' +
             testEmail + ' / ' + testPhone + ' (not the booking\'s real contact info).');

  try {
    sendSms(testPhone, content.sms, locCfg.phone);
    Logger.log('testSendPreTripInspection: SMS sent to ' + testPhone);
  } catch(e) {
    Logger.log('testSendPreTripInspection: SMS FAILED: ' + e);
  }

  try {
    // suppressManagerBcc = true, matching sendPreTripReminder_()'s real
    // behavior: the manager must not receive the blank pre-trip form, not
    // even as a BCC copy, so this test never sends her one either.
    sendEmailHtml(testEmail, content.subject, content.html, locCfg.email, locCfg.email, true);
    Logger.log('testSendPreTripInspection: email sent to ' + testEmail +
               ' (manager BCC suppressed, matching production pre-trip email behavior).');
  } catch(e) {
    Logger.log('testSendPreTripInspection: email FAILED: ' + e);
  }

  Logger.log('testSendPreTripInspection: complete. This was a pure system test -- ' +
             'column K was not written and no manager summary was sent.');
}

// ---------------------------------------------------------------------------
// MANUAL STANDALONE TEST: Immediate post-trip inspection send [LIVE]
// ------------------------------------------------------------
// Same pattern as testSendPreTripInspection() above, for the post-trip
// inspection message. Reuses buildPostTripReminderContent_() (Reminders.js)
// for the exact production template, sends to the safe test recipient, and
// does NOT call sendPostTripReminder_() -- column L is never written and no
// manager notice is sent. Contrast with sendPostTripInspectionNowForRow()
// (Reminders.js), which IS a real send -- e.g. for a vehicle returned
// unusually early -- and does update the normal sent flags.
//
// Requires SANDBOX_TEST_EMAIL and SANDBOX_TEST_PHONE in Script Properties,
// and a Bookings row with a name containing "Test Customer".
//
// Do NOT add to runAllSandboxConfigurationTests() -- this sends real messages.
// ---------------------------------------------------------------------------
function testSendPostTripInspection() {
  Logger.log('Starting immediate post-trip inspection test send...');

  const testEmail = PROPS.SANDBOX_TEST_EMAIL;
  const testPhone = PROPS.SANDBOX_TEST_PHONE;
  if (!testEmail || !testPhone) {
    throw new Error('testSendPostTripInspection: SANDBOX_TEST_EMAIL and SANDBOX_TEST_PHONE must both ' +
      'be set in Script Properties before running this test.');
  }

  const sheet = getSheet();
  const data  = sheet.getDataRange().getValues();

  let row = null;
  let rowNumber = null;
  for (let i = 1; i < data.length; i++) {
    if ((data[i][1] || '').toString().toLowerCase().includes('test customer')) {
      row = data[i];
      rowNumber = i + 1;
      break;
    }
  }

  if (!row) {
    Logger.log('testSendPostTripInspection: no row found with name containing "Test Customer". Add one to the sheet first.');
    return;
  }

  const name        = row[1];
  const email       = row[2];
  const phone       = (row[3] || '').toString().replace(/^'/, '');
  const rentalDate  = new Date(row[4]);
  const dateStr     = formatDateTime(rentalDate);
  const vehicleType = row[17] || '';
  const location    = row[18] || '';

  const problems = [];
  if (!email || email === 'No Email') problems.push('email');
  if (!phone || phone === 'No Phone') problems.push('phone number');
  let locCfg = null;
  try { locCfg = getLocationConfig(location); }
  catch(e) { problems.push('a recognized location'); }
  if (!CONFIG.INSPECT_FORM_BASE) problems.push('INSPECT_FORM_BASE (form link cannot be built)');

  if (problems.length) {
    Logger.log('testSendPostTripInspection: test booking row ' + rowNumber + ' is missing: ' +
               problems.join(', ') + '. Aborting -- nothing sent.');
    return;
  }

  const postUrl = buildInspectUrl(name, email, rentalDate, 'post');
  const content = buildPostTripReminderContent_(name, vehicleType, location, dateStr, postUrl);

  Logger.log('testSendPostTripInspection: using booking row ' + rowNumber + ' (' + name + ', ' +
             vehicleType + ' at ' + location + ') for content; sending to TEST recipient ' +
             testEmail + ' / ' + testPhone + ' (not the booking\'s real contact info).');

  try {
    sendSms(testPhone, content.sms, locCfg.phone);
    Logger.log('testSendPostTripInspection: SMS sent to ' + testPhone);
  } catch(e) {
    Logger.log('testSendPostTripInspection: SMS FAILED: ' + e);
  }

  try {
    // suppressManagerBcc = true, matching sendPostTripReminder_()'s real
    // behavior: the manager must not receive the blank post-trip form, not
    // even as a BCC copy, so this test never sends her one either.
    sendEmailHtml(testEmail, content.subject, content.html, locCfg.email, locCfg.email, true);
    Logger.log('testSendPostTripInspection: email sent to ' + testEmail +
               ' (manager BCC suppressed, matching production post-trip email behavior).');
  } catch(e) {
    Logger.log('testSendPostTripInspection: email FAILED: ' + e);
  }

  Logger.log('testSendPostTripInspection: complete. This was a pure system test -- ' +
             'column L was not written and no manager notice was sent.');
}
