// ============================================================
// SANDBOX / DEBUG TEST FUNCTIONS
// These functions are for manual testing only.
// Do NOT wire these to triggers. Remove before going to production.
// ============================================================

function testSheetConnection() {
  const sheet = getSheet();
  Logger.log("Connected to sheet: " + sheet.getName());
  const bookingRows = Math.max(sheet.getLastRow() - 1, 0);
  Logger.log("Booking rows: " + bookingRows);
}

function testCalendarConnection() {
  Logger.log("CALENDAR_ID property: " + CONFIG.CALENDAR_ID);
  Logger.log("Length: " + (CONFIG.CALENDAR_ID ? CONFIG.CALENDAR_ID.length : 0));
  const calendar = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
  if (!calendar) throw new Error('Calendar not found. Check CALENDAR_ID Script Property.');

  Logger.log("Connected to calendar: " + calendar.getName());

  const now = new Date();
  const future = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const events = calendar.getEvents(now, future);

  Logger.log("Events found in next 30 days: " + events.length);

  events.slice(0, 5).forEach((event, index) => {
    Logger.log((index + 1) + ". " + event.getTitle() + " | " + event.getStartTime());
  });
}

function listAccessibleCalendars() {
  const calendars = CalendarApp.getAllCalendars();

  Logger.log("Total calendars: " + calendars.length);

  calendars.forEach((cal, i) => {
    Logger.log(
      (i + 1) + ". " +
      cal.getName() +
      " | " +
      cal.getId()
    );
  });
}

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

function testSyncCalendarBookingsNoNotifications() {
  const sheet       = getSheet();
  const existingIds = getExistingEventIds(sheet);
  const calendar    = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
  const now         = new Date();
  const future      = new Date(now.getTime() + CONFIG.DAYS_AHEAD * 24 * 60 * 60 * 1000);
  const events      = calendar.getEvents(now, future);

  let added = 0;

  events.forEach(event => {
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
      ''                                // Q: Approval Reminder Count
    ]);

    Logger.log('ADDED: ' + name + ' | ' + (email || 'No Email') + ' | ' + formatDateTime(startTime));
    added++;
  });

  Logger.log('Done. Rows added: ' + added);
}
