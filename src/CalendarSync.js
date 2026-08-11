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

    // Calendar read safety: a thrown exception here means the read itself
    // failed (bad permissions, transient API error, etc.) -- distinguish
    // that from a successful read that legitimately returns zero events
    // (e.g. every future booking at this location was just cancelled). A
    // failed read must never be treated as "zero bookings" -- see
    // runCancellationDetectionForLocation_() in CancelReschedule.js, which
    // relies on this distinction already having been made before it runs.
    let events;
    try {
      events = calendar.getEvents(now, future);
    } catch (e) {
      Logger.log('syncCalendarBookings: calendar read failed for ' + calCfg.propKey + ' (' +
                 calCfg.location + '): ' + e);
      alertAdmin('syncCalendarBookings calendar read failed',
        'Location: ' + calCfg.location + ' (' + calCfg.propKey + ')\n' +
        'New-booking sync, reschedule detection, and cancellation detection were all skipped for ' +
        'this location this cycle. Error: ' + e.toString());
      return; // continue safely with the remaining locations
    }

    // Location-scoped Event ID -> row index lookup, built fresh each cycle
    // from a snapshot taken before any of this cycle's writes, used below to
    // detect reschedules on rows already synced for this location before
    // falling through to the new-booking append logic.
    const sheetDataForLocation = sheet.getDataRange().getValues();
    const rowByEventId = {};
    for (let r = 1; r < sheetDataForLocation.length; r++) {
      if (sheetDataForLocation[r][19] === calCfg.location && sheetDataForLocation[r][0]) { // T: Location, A: Event ID
        rowByEventId[sheetDataForLocation[r][0]] = r;
      }
    }
    const cancelRescheduleLocCfg = getLocationConfig(calCfg.location);

    events.forEach(function(event) {
      try {
        const eventId = event.getId();

        // Already synced for this location? Check for a reschedule instead
        // of the new-booking append logic below.
        if (rowByEventId.hasOwnProperty(eventId)) {
          const ri  = rowByEventId[eventId];
          const row = sheetDataForLocation[ri];
          const newStart = event.getStartTime();
          const newEnd   = event.getEndTime();
          const oldStart = new Date(row[4]); // E: Start Time
          if (isRescheduleDetected(oldStart.getTime(), newStart.getTime())) {
            handleReschedule_(sheet, ri, row, newStart, newEnd, cancelRescheduleLocCfg);
          }
          return; // never re-add an already-synced event as new
        }

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

    // Cancellation detection: after processing all of this location's
    // currently-fetched events, check whether any of this location's own
    // future-dated rows are no longer represented on the calendar. Strictly
    // scoped to calCfg.location (see runCancellationDetectionForLocation_()
    // in CancelReschedule.js) so a busy or quiet calendar at one location
    // can never affect another location's rows. events is guaranteed to be
    // the result of a successful read at this point -- a failed read
    // already returned out of this forEach iteration above.
    runCancellationDetectionForLocation_(sheet, calCfg, events, now, future);

  });
}
