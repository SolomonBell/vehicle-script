// ============================================================
// ENGINE 1: SYNC NEW BOOKINGS FROM CALENDAR
// Extracts name, email, phone, and second driver email
// from the event description written by Google Booking.
// ============================================================
function syncCalendarBookings() {
  const sheet       = getSheet();
  const existingIds = getExistingEventIds(sheet);
  const calendar    = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
  const now         = new Date();
  const future      = new Date(now.getTime() + CONFIG.DAYS_AHEAD * 24 * 60 * 60 * 1000);
  const events      = calendar.getEvents(now, future);

  events.forEach(event => {
    try {
      const eventId = event.getId();
      if (existingIds.includes(eventId)) return;

      const desc = event.getDescription() || '';
      Logger.log('Description raw: ' + JSON.stringify(desc.substring(0, 200)));

      // Extract name from "Booked by\nFirstname Lastname\n..." pattern
      const name        = extractBookedByName(desc) || event.getTitle();
      const phone       = extractPhone(desc);
      const email       = extractPrimaryEmail(desc);
      const secondEmail = extractSecondDriverEmail(desc);

      if (!email && !phone) return;

      const startTime = event.getStartTime();
      const endTime   = event.getEndTime();
      const dateStr   = formatDateTime(startTime);
      const firstName = name.split(' ')[0];

      const intakeUrl = buildIntakeUrl(
        name,
        email || '',
        phone || '',
        startTime
      );

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
        '',                               // O: Rental Approved (pending)
        '',                               // P: Approval Notified At
        ''                                // Q: Approval Reminder Count
      ]);

      // Welcome SMS
      const welcomeSms =
        'Reliable Storage: Hi ' + firstName + '! Your truck is reserved for ' + dateStr + '. ' +
        'Step 1 -- pay your $50 deposit: ' + CONFIG.STRIPE_PAYMENT_URL + ' ' +
        'Step 2 -- complete intake form: ' + intakeUrl;

      // Welcome HTML email
      const welcomeEmailHtml =
        '<p>Hi ' + name + ',</p>' +
        '<p>Your moving truck is reserved for <strong>' + dateStr + '</strong>.</p>' +
        '<p>Please complete these two steps to confirm your booking:</p>' +
        '<p><strong>1. Pay your $50 deposit:</strong><br>' +
        '<a href="' + CONFIG.STRIPE_PAYMENT_URL + '">Click here to pay deposit</a></p>' +
        '<p><strong>2. Complete your intake form</strong> (your info is pre-filled — just verify and submit):<br>' +
        '<a href="' + intakeUrl + '">Click here to complete intake form</a></p>' +
        '<p>Your rental agreement will be emailed for e-signature once your deposit is received.</p>' +
        '<p>Questions? Reply to this email or call us.</p>' +
        '<p>— Reliable Storage</p>';

      if (phone && phone !== 'No Phone') sendSms(phone, welcomeSms);
      if (email && email !== 'No Email') sendEmailHtml(email, 'Your truck rental — ' + dateStr, welcomeEmailHtml);

      // Manager notification
      if (CONFIG.MANAGER_EMAIL) {
        try {
          const mgrHtml =
            '<p>New truck booking:</p>' +
            '<p><strong>' + name + '</strong></p>' +
            '<p>Date/time: ' + dateStr + '</p>' +
            '<p>Email: ' + (email || 'No Email') + '</p>' +
            '<p>Phone: ' + (phone || 'No Phone') + '</p>';
          sendEmailHtml(CONFIG.MANAGER_EMAIL, 'New truck booking — ' + name + ' on ' + dateStr, mgrHtml);
        } catch(e) { Logger.log('Manager email failed for new booking ' + name + ': ' + e); }
      }
      if (CONFIG.MANAGER_PHONE) {
        try {
          sendSms(CONFIG.MANAGER_PHONE, 'New booking: ' + name + ' on ' + dateStr + '. Check the Bookings sheet.');
        } catch(e) { Logger.log('Manager SMS failed for new booking ' + name + ': ' + e); }
      }

      const newRow = sheet.getLastRow();
      sheet.getRange(newRow, 9).setValue('Yes'); // I: Intake Sent

    } catch(e) {
      alertAdmin('syncCalendarBookings error', e.toString());
    }
  });
}
