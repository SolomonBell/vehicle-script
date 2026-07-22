// ============================================================
// ENGINE 1: SYNC NEW BOOKINGS FROM CALENDAR
// Reads every calendar defined in CALENDAR_CONFIGS (Config.js).
// Vehicle type and location come from the calendar config entry,
// not from the event title.
// ============================================================
function syncCalendarBookings() {
  const sheet       = getSheet();
  const existingIds = getExistingEventIds(sheet);
  const now         = new Date();
  const future      = new Date(now.getTime() + CONFIG.DAYS_AHEAD * 24 * 60 * 60 * 1000);

  CALENDAR_CONFIGS.forEach(function(calCfg) {
    if (!calCfg.calendarId) {
      Logger.log('syncCalendarBookings: skipping ' + calCfg.propKey + ' (Script Property not set)');
      return;
    }

    const calendar = CalendarApp.getCalendarById(calCfg.calendarId);
    if (!calendar) {
      Logger.log('syncCalendarBookings: calendar not found for ' + calCfg.propKey);
      return;
    }

    const events = calendar.getEvents(now, future);

    events.forEach(function(event) {
      try {
        const eventId = event.getId();
        if (existingIds.includes(eventId)) return;

        const desc = event.getDescription() || '';
        Logger.log('Description raw: ' + JSON.stringify(desc.substring(0, 200)));

        const name        = extractBookedByName(desc) || event.getTitle();
        const phone       = extractPhone(desc);
        const email       = extractPrimaryEmail(desc);
        const secondEmail = extractSecondDriverEmail(desc);

        if (!email && !phone) return;

        const startTime = event.getStartTime();
        const endTime   = event.getEndTime();
        const dateStr   = formatDateTime(startTime);
        const firstName = name.split(' ')[0];
        const stripeUrl = getStripePaymentUrl(calCfg.vehicleType);
        const intakeUrl = buildIntakeUrl(name, email || '', phone || '', startTime);

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
          '',                               // O: Rental Approved (manager only)
          '',                               // P: Approval Notified At
          '',                               // Q: Approval Reminder Count
          calCfg.vehicleType,               // R: Vehicle Type
          calCfg.location,                  // S: Location
        ]);

        // Welcome SMS
        const welcomeSms =
          'Reliable Storage: Hi ' + firstName + '! Your truck is reserved for ' + dateStr + '. ' +
          'Step 1 -- pay your $' + getDepositAmount(calCfg.vehicleType) + ' deposit: ' + stripeUrl + ' ' +
          'Step 2 -- complete intake form: ' + intakeUrl;

        // Welcome HTML email
        const welcomeEmailHtml =
          '<p>Hi ' + name + ',</p>' +
          '<p>Your moving truck is reserved for <strong>' + dateStr + '</strong>.</p>' +
          '<p>Please complete these two steps to confirm your booking:</p>' +
          '<p><strong>1. Pay your $' + getDepositAmount(calCfg.vehicleType) + ' deposit:</strong><br>' +
          '<a href="' + stripeUrl + '">Click here to pay deposit</a></p>' +
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
              '<p>Location: ' + calCfg.location + '</p>' +
              '<p>Vehicle: ' + calCfg.vehicleType + '</p>' +
              '<p>Email: ' + (email || 'No Email') + '</p>' +
              '<p>Phone: ' + (phone || 'No Phone') + '</p>';
            sendEmailHtml(CONFIG.MANAGER_EMAIL, 'New truck booking — ' + name + ' on ' + dateStr, mgrHtml);
          } catch(e) { Logger.log('Manager email failed for new booking ' + name + ': ' + e); }
        }
        if (CONFIG.MANAGER_PHONE) {
          try {
            sendSms(CONFIG.MANAGER_PHONE,
              'New booking: ' + name + ' on ' + dateStr +
              ' (' + calCfg.location + ' / ' + calCfg.vehicleType + '). Check the Bookings sheet.');
          } catch(e) { Logger.log('Manager SMS failed for new booking ' + name + ': ' + e); }
        }

        const newRow = sheet.getLastRow();
        sheet.getRange(newRow, 9).setValue('Yes'); // I: Intake Sent

      } catch(e) {
        alertAdmin('syncCalendarBookings error', e.toString());
      }
    });
  });
}
