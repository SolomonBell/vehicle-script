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
        const clientReferenceId = Utilities.base64EncodeWebSafe(eventId).replace(/=+$/, '');
        const stripeUrl = createStripeCheckoutSession(calCfg.vehicleType, clientReferenceId, email);
        const intakeUrl = buildIntakeUrl(name, email || '', phone || '', startTime);
        const locCfg    = getLocationConfig(calCfg.location);

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
          '',                               // M: Additional Driver Name -- unknown until the intake form is submitted; the Calendar description never carries a name, only (at most) an email
          secondEmail || 'No Second Email', // N: Additional Driver Email -- initial fallback from the Calendar description; the intake form is authoritative once submitted (see processIntakeFormSubmission_() in Forms.js)
          '',                               // O: Lease Signed
          '',                               // P: Rental Approved (manager only)
          '',                               // Q: Approval Notified At
          '',                               // R: Approval Reminder Count
          calCfg.vehicleType,               // S: Vehicle Type
          calCfg.location,                  // T: Location
        ]);

        // Welcome SMS — keep to one action (deposit link); intake form is in the email
        const welcomeSms =
          CONFIG.COMPANY_NAME + ': Hi ' + firstName + ', your ' + calCfg.vehicleType +
          ' at ' + calCfg.location + ' is reserved for ' + dateStr + '. ' +
          'Pay your $' + getDepositAmount(calCfg.vehicleType) + ' deposit to confirm: ' + stripeUrl;

        // Welcome HTML email
        const welcomeEmailHtml =
          '<p>Hi ' + name + ',</p>' +
          '<p>Your ' + calCfg.vehicleType + ' reservation at our ' +
          calCfg.location + ' location is scheduled for ' + dateStr + '.</p>' +
          '<p>Please complete these two steps to continue your reservation:</p>' +
          '<p>1. Pay the $' + getDepositAmount(calCfg.vehicleType) + ' deposit: ' +
          '<a href="' + stripeUrl + '">Pay deposit</a></p>' +
          '<p>2. Review and submit your pre-filled intake form: ' +
          '<a href="' + intakeUrl + '">Complete intake form</a></p>' +
          '<p>Once both steps are done, we will send your rental agreement by email for ' +
          'electronic signature. A Reliable Storage manager will also review your booking, ' +
          'and we will notify you once it is approved.</p>' +
          '<p>Reply to this email or call us if you have any questions.</p>' +
          '<p>Thank you,<br>' + CONFIG.COMPANY_NAME + '</p>';

        if (phone && phone !== 'No Phone') sendSms(phone, welcomeSms, locCfg.phone);
        if (email && email !== 'No Email') sendEmailHtml(email, 'Your ' + calCfg.vehicleType + ' reservation for ' + dateStr, welcomeEmailHtml, locCfg.email, locCfg.email);

        // Manager notification
        if (CONFIG.MANAGER_EMAIL) {
          try {
            const mgrHtml =
              '<p>Hi ' + calCfg.location + ' Manager,</p>' +
              '<p>A new booking has been created.</p>' +
              '<p>' +
              'Customer: ' + name + '<br>' +
              'Vehicle: ' + calCfg.vehicleType + '<br>' +
              'Location: ' + calCfg.location + '<br>' +
              'Date/time: ' + dateStr + '<br>' +
              'Email: ' + (email || 'No Email') + '<br>' +
              'Phone: ' + (phone || 'No Phone') + '<br>' +
              'Deposit due: $' + getDepositAmount(calCfg.vehicleType) +
              '</p>';
            sendEmailHtml(CONFIG.MANAGER_EMAIL, 'New booking: ' + name + ' (' + calCfg.vehicleType + ')', mgrHtml, locCfg.email, locCfg.email);
          } catch(e) { Logger.log('Manager email failed for new booking ' + name + ': ' + e); }
        }
        if (CONFIG.MANAGER_PHONE) {
          try {
            sendSms(CONFIG.MANAGER_PHONE,
              'New booking: ' + name + ' on ' + dateStr +
              ' (' + calCfg.location + ' / ' + calCfg.vehicleType + '). Check the Bookings sheet.',
              locCfg.phone);
          } catch(e) { Logger.log('Manager SMS failed for new booking ' + name + ': ' + e); }
        }

        const newRow = sheet.getLastRow();
        sheet.getRange(newRow, 5, 1, 2).setNumberFormat('m/d/yy h:mm AM/PM');
        sheet.getRange(newRow, 9).setValue('Yes'); // I: Intake Sent

      } catch(e) {
        alertAdmin('syncCalendarBookings error', e.toString());
      }
    });
  });
}
