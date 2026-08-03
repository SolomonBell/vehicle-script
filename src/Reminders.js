// ============================================================
// ENGINE 3: REMINDERS
// ============================================================
function processReminders() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    Logger.log('processReminders: could not acquire lock, skipping');
    return;
  }

  try {
    const sheet = getSheet();
    const data  = sheet.getDataRange().getValues();
    const now   = new Date().getTime();

    for (let i = 1; i < data.length; i++) {
      const row       = data[i];
      const name      = row[1];
      const email     = row[2];
      const phone     = row[3];
      const startTime = new Date(row[4]).getTime();
      const endTime   = row[5] ? new Date(row[5]).getTime()
                               : startTime + 4 * 60 * 60 * 1000;
      const sent24hr  = row[10];
      const sentPost  = row[11];
      const approved  = row[15]; // P: Rental Approved
      const preTripCompletionRaw  = row[23]; // X: Pre-Inspection Form Completed
      const postTripCompletionRaw = row[24]; // Y: Post-Inspection Form Completed
      const timingWarningSent     = row[25]; // Z: Suspicious Timing Warning Sent

      if (isNaN(startTime)) continue;

      const hoursAfterEnd = (now - endTime) / (1000 * 60 * 60);
      // Rows past the 48-hour cutoff with both reminders already sent are
      // normally done and skipped to limit the scan window -- but only once
      // the suspicious-timing check below has also been resolved for this
      // row (already warned, or nothing to check yet because the post-trip
      // form still is not in). This keeps very old bookings from being
      // scanned forever while still catching a late post-trip submission on
      // whichever later run first sees it filled in.
      if (hoursAfterEnd > 48 && sent24hr === 'Yes' && sentPost === 'Yes' &&
          (timingWarningSent === 'Yes' || !postTripCompletionRaw)) continue;

      const hoursUntilStart = (startTime - now) / (1000 * 60 * 60);
      const rentalDate      = new Date(row[4]);
      const dateStr         = formatDateTime(rentalDate);
      const vehicleType     = row[18] || '';  // S: Vehicle Type
      const location        = row[19] || '';  // T: Location

      try {
        const locCfg = getLocationConfig(location);

        // 24-hour reminder. Deposit and approval are both real eligibility
        // gates (see isPreTripReminderEligible in Helpers.js) -- a booking
        // missing either one is skipped silently here and re-evaluated on
        // every later run for as long as it stays in the window.
        const depositPaid = row[6];
        if (isPreTripReminderEligible(hoursUntilStart, sent24hr, approved, depositPaid)) {
          const preUrl = buildInspectUrl(name, email || '', rentalDate, 'pre');
          sendPreTripReminder_(sheet, i, name, email, phone, locCfg, dateStr, vehicleType, location, preUrl, row[14]);
        }

        // Post-trip reminder. Fires exactly one hour after the pre-trip
        // inspection was actually completed (see isPostTripReminderEligible
        // in Helpers.js), not from the booking's End Time and not from when
        // the pre-trip reminder was sent -- if the pre-trip inspection
        // hasn't been completed yet, preTripCompletedAt is null and this
        // never fires.
        const preTripCompletedAt = parseInspectionCompletionTimestamp_(preTripCompletionRaw);
        const hoursSincePreTripCompleted = preTripCompletedAt
          ? (now - preTripCompletedAt.getTime()) / (1000 * 60 * 60)
          : null;
        if (isPostTripReminderEligible(hoursSincePreTripCompleted, sentPost)) {
          const postUrl = buildInspectUrl(name, email || '', rentalDate, 'post');
          sendPostTripReminder_(sheet, i, name, email, phone, locCfg, dateStr, vehicleType, location, postUrl);
        }

        // Suspicious inspection timing warning. Once both inspections are
        // complete, warn the manager if they were submitted
        // CONFIG.SUSPICIOUS_INSPECTION_WINDOW_MINUTES apart or less --
        // inclusive of the boundary itself (see isSuspiciousInspectionTiming()
        // in Helpers.js). Purely informational -- never blocks or alters
        // anything else in the workflow -- and sent at most once per
        // booking (column Z).
        const postTripCompletedAt = parseInspectionCompletionTimestamp_(postTripCompletionRaw);
        if (preTripCompletedAt && postTripCompletedAt && timingWarningSent !== 'Yes') {
          const elapsedMinutes = getInspectionElapsedMinutes(preTripCompletedAt, postTripCompletedAt);
          if (isSuspiciousInspectionTiming(elapsedMinutes, CONFIG.SUSPICIOUS_INSPECTION_WINDOW_MINUTES)) {
            const eventId    = row[0] || '';
            const endDateStr = formatDateTime(new Date(endTime));
            sendSuspiciousInspectionTimingWarning_(
              sheet, i, eventId, name, vehicleType, location, dateStr, endDateStr,
              preTripCompletedAt, postTripCompletedAt, elapsedMinutes, locCfg
            );
          }
        }

      } catch(e) {
        alertAdmin('processReminders error on row ' + (i + 1), e.toString());
      }
    }
  } finally {
    lock.releaseLock();
  }
}

// Builds the exact subject/HTML/SMS content sendPreTripReminder_() sends to
// the customer, without sending anything or touching the sheet. Pulled out
// so the manual "send immediately" test entry point in SandboxTests.js
// (testSendPreTripInspection()) can reuse the real production content
// instead of maintaining a second copy of these templates.
function buildPreTripReminderContent_(name, vehicleType, location, dateStr, preUrl, leaseSigned) {
  const subject = 'Pickup reminder: ' + vehicleType + ' rental on ' + dateStr;
  let html =
    '<p>Hi ' + name + ',</p>' +
    '<p>This is a reminder that your ' + vehicleType + ' pickup at our ' +
    location + ' location is scheduled for ' + dateStr + '.</p>' +
    '<p>You must complete the pre-trip inspection form before you drive the vehicle. ' +
    'Your booking information is already filled in, just add the required photos and submit:</p>' +
    '<p><a href="' + preUrl + '">Complete pre-trip inspection</a></p>' +
    '<p>This same form has been sent by both email and text for your convenience. ' +
    'You only need to complete it once.</p>' +
    '<p>After you complete the pre-trip inspection, we will send you the post-trip inspection ' +
    'form once the vehicle has been returned.</p>';
  if (leaseSigned !== 'Yes') {
    html +=
      '<p>Action needed: Your rental agreement has not been signed. ' +
      'Please check your email for your rental agreement and sign it before your pickup.</p>';
  }
  html +=
    '<p>Reply to this email or call us if you have any questions.</p>' +
    '<p>Thank you,<br>' + CONFIG.COMPANY_NAME + '</p>';

  const sms =
    CONFIG.COMPANY_NAME + ': Your ' + vehicleType + ' pickup at ' + location +
    ' is scheduled for ' + dateStr + '. You must complete the pre-trip inspection before you drive ' +
    'the vehicle: ' + preUrl + ' This same form was also emailed to you -- you only need to ' +
    'complete it once. The post-trip form will follow once the pre-trip inspection is done.';

  return { subject: subject, html: html, sms: sms };
}

// ============================================================
// SEND 24-HOUR / PRE-TRIP REMINDER (called once per eligible row from
// processReminders(), only after isPreTripReminderEligible() has already
// confirmed the deposit is paid, the rental is approved, and the window
// applies)
// ------------------------------------------------------------
// Sends the customer's pre-trip reminder (SMS + email, including the
// pre-trip inspection link) and, only if at least one channel actually
// delivers, writes column K (24hr Sent) = Yes and sends the manager's
// 24-hour summary. This mirrors the "delivered if reached by either
// channel" pattern already used by notifyCustomerOfApproval() (Approval.js)
// for column U -- a row with no phone and no email on file is treated as
// delivered (nothing more could ever be sent to it) so it does not retry
// forever.
//
// The customer email is sent with suppressManagerBcc = true: the manager
// must not receive the blank pre-trip form, not even as a BCC copy, before
// the customer has submitted it. The pre-trip SMS has no BCC concept at
// all (Twilio sends only to the one number given). The manager still gets
// her own 24-hour summary email/SMS below (which never includes the form
// link) -- this only removes her from the customer-addressed copy.
//
// If neither channel delivers (e.g. both SendGrid and Twilio are
// temporarily down), column K is deliberately left blank so the row is
// reconsidered on the next processReminders() run instead of being
// silently marked done despite the customer never having received it.
// The manager's summary is intentionally sent only when the customer
// reminder was delivered -- coupling the two to the same single column K
// avoids needing a second column while still guaranteeing neither message
// is ever duplicated: a failed attempt retries the whole pair together on
// the next run, never just one half of it.
//
// Returns true if the reminder was delivered and K was written, false
// otherwise -- used by tests; processReminders() does not use the
// return value.
// ============================================================
function sendPreTripReminder_(sheet, rowIndex, name, email, phone, locCfg, dateStr, vehicleType, location, preUrl, leaseSigned) {
  const content = buildPreTripReminderContent_(name, vehicleType, location, dateStr, preUrl, leaseSigned);
  const emailSubject = content.subject;
  const emailHtml     = content.html;
  const sms            = content.sms;

  let delivered = false;

  if (phone && phone !== 'No Phone') {
    try { sendSms(phone, sms, locCfg.phone); delivered = true; }
    catch(e) { Logger.log('24hr SMS failed for ' + name + ': ' + e); }
  }
  if (email && email !== 'No Email') {
    // suppressManagerBcc = true: this is the blank pre-trip inspection form.
    // The manager must not receive it in any form -- not as a BCC copy --
    // before the customer has actually submitted it. She gets her own
    // 24-hour summary below instead (which never includes the form link).
    try { sendEmailHtml(email, emailSubject, emailHtml, locCfg.email, locCfg.email, true); delivered = true; }
    catch(e) { Logger.log('24hr email failed for ' + name + ': ' + e); }
  }
  if ((!phone || phone === 'No Phone') && (!email || email === 'No Email')) {
    Logger.log('sendPreTripReminder_: no email or phone for ' + name + ' (row ' + (rowIndex + 1) +
               ') — marking 24hr reminder sent to avoid endless retry');
    delivered = true;
  }

  if (!delivered) return false;

  sheet.getRange(rowIndex + 1, 11).setValue('Yes'); // K: 24hr Sent
  SpreadsheetApp.flush();

  const managerHtml =
    '<p>Hi ' + location + ' Manager,</p>' +
    '<p>Upcoming rental tomorrow:</p>' +
    '<p>' +
    'Customer: ' + name + '<br>' +
    'Vehicle: ' + vehicleType + '<br>' +
    'Location: ' + location + '<br>' +
    'Date/time: ' + dateStr + '<br>' +
    'Lease signed: ' + (leaseSigned === 'Yes' ? 'Yes' : 'Not yet') +
    '</p>';

  if (CONFIG.MANAGER_EMAIL) {
    try { sendEmailHtml(CONFIG.MANAGER_EMAIL, "Tomorrow's rental: " + name + ' (' + vehicleType + ')', managerHtml, locCfg.email, locCfg.email); }
    catch(e) { Logger.log('Manager email failed: ' + e); }
  }
  if (CONFIG.MANAGER_PHONE) {
    try { sendSms(CONFIG.MANAGER_PHONE, "Tomorrow's rental: " + name + ', ' + vehicleType + ' at ' + location + ' on ' + dateStr + '.', locCfg.phone); }
    catch(e) { Logger.log('Manager SMS failed: ' + e); }
  }

  return true;
}

// Builds the exact subject/HTML/SMS content sendPostTripReminder_() sends to
// the customer, without sending anything or touching the sheet. Pulled out
// so the manual "send immediately" test entry point in SandboxTests.js
// (testSendPostTripInspection()) can reuse the real production content
// instead of maintaining a second copy of these templates.
function buildPostTripReminderContent_(name, vehicleType, location, dateStr, postUrl) {
  const subject = 'Post-trip inspection: ' + vehicleType + ' rental';
  const html =
    '<p>Hi ' + name + ',</p>' +
    '<p>Thank you for completing your ' + vehicleType + ' rental ' +
    'at our ' + location + ' location on ' + dateStr + '.</p>' +
    '<p>Now that the vehicle has been returned, please complete the post-trip inspection form. ' +
    'Your booking information is already filled in, just add the required photos and submit:</p>' +
    '<p><a href="' + postUrl + '">Complete post-trip inspection</a></p>' +
    '<p>This same form has been sent by both email and text for your convenience. ' +
    'You only need to complete it once.</p>' +
    '<p>We appreciate your business.</p>' +
    '<p>Thank you,<br>' + CONFIG.COMPANY_NAME + '</p>';

  const sms =
    CONFIG.COMPANY_NAME + ': Please complete the post-trip inspection for your ' +
    vehicleType + ' rental at ' + location + ' now that the vehicle has been returned: ' + postUrl +
    ' This same form was also emailed to you -- you only need to complete it once.';

  return { subject: subject, html: html, sms: sms };
}

// ============================================================
// SEND POST-TRIP REMINDER (called once per eligible row from
// processReminders(), only after isPostTripReminderEligible() has already
// confirmed the pre-trip inspection was completed at least one hour ago and
// the post-trip reminder has not already been sent)
// ------------------------------------------------------------
// Sends the customer's post-trip reminder (SMS + email, including the
// post-trip inspection link) and, only if at least one channel actually
// delivers, writes column L (Post-Rental Sent) = Yes and sends the
// manager's post-trip notice. Mirrors sendPreTripReminder_() above exactly:
// same "delivered if reached by either channel" pattern, same
// no-contact-info fallback, and the manager notice is sent only when the
// customer reminder was delivered so column L still fully represents one
// successful send operation and neither message is ever duplicated.
//
// Same as sendPreTripReminder_() above: the customer email is sent with
// suppressManagerBcc = true, so the manager does not receive a BCC copy of
// the blank post-trip inspection form either. She still gets her own
// dedicated post-trip notice below (which already includes the form link),
// unaffected by this -- only the customer-addressed copy loses the BCC.
//
// Returns true if the reminder was delivered and L was written, false
// otherwise -- used by tests; processReminders() does not use the
// return value.
// ============================================================
function sendPostTripReminder_(sheet, rowIndex, name, email, phone, locCfg, dateStr, vehicleType, location, postUrl) {
  const content = buildPostTripReminderContent_(name, vehicleType, location, dateStr, postUrl);
  const emailSubject = content.subject;
  const emailHtml     = content.html;
  const sms            = content.sms;

  let delivered = false;

  if (phone && phone !== 'No Phone') {
    try { sendSms(phone, sms, locCfg.phone); delivered = true; }
    catch(e) { Logger.log('Post-trip SMS failed for ' + name + ': ' + e); }
  }
  if (email && email !== 'No Email') {
    // suppressManagerBcc = true: same reasoning as sendPreTripReminder_()
    // above -- the manager must not receive the blank post-trip inspection
    // form, not even as a BCC copy. She gets her own post-trip notice below
    // instead.
    try { sendEmailHtml(email, emailSubject, emailHtml, locCfg.email, locCfg.email, true); delivered = true; }
    catch(e) { Logger.log('Post-trip email failed for ' + name + ': ' + e); }
  }
  if ((!phone || phone === 'No Phone') && (!email || email === 'No Email')) {
    Logger.log('sendPostTripReminder_: no email or phone for ' + name + ' (row ' + (rowIndex + 1) +
               ') — marking post-trip reminder sent to avoid endless retry');
    delivered = true;
  }

  if (!delivered) return false;

  sheet.getRange(rowIndex + 1, 12).setValue('Yes'); // L: Post-Rental Sent
  SpreadsheetApp.flush();

  const mgrPostHtml =
    '<p>Hi ' + location + ' Manager,</p>' +
    '<p>Post-trip inspection form sent to ' + name + '.</p>' +
    '<p>' +
    'Vehicle: ' + vehicleType + '<br>' +
    'Location: ' + location + '<br>' +
    'Rental date: ' + dateStr + '<br>' +
    'Email: ' + email + '<br>' +
    'Post-trip form: <a href="' + postUrl + '">View inspection form</a>' +
    '</p>' +
    '<p>If the form is not submitted within 24 hours, please follow up directly.</p>';

  if (CONFIG.MANAGER_EMAIL) {
    try { sendEmailHtml(CONFIG.MANAGER_EMAIL, 'Post-rental inspection: ' + name + ' (' + vehicleType + ')', mgrPostHtml, locCfg.email, locCfg.email); }
    catch(e) { Logger.log('Post-trip manager email failed: ' + e); }
  }

  return true;
}

// ============================================================
// SUSPICIOUS INSPECTION TIMING WARNING (called once per eligible row from
// processReminders(), only after isSuspiciousInspectionTiming() has already
// confirmed both inspections are complete and unusually close together)
// ------------------------------------------------------------
// Sends a neutral, informational warning to the manager only -- never to
// the customer, and never containing a customer-facing form link or
// instructions. Does not accuse the customer of anything and does not block
// or alter any other part of the workflow; it only states that the timing
// may be worth a look. Written to column Z (Suspicious Timing Warning Sent)
// only after a successful send, so this fires at most once per booking and
// a failed send is retried on the next run -- same pattern as columns K/L.
//
// Returns true if the warning was sent and Z was written, false otherwise
// -- used by tests; processReminders() does not use the return value.
// ============================================================
function sendSuspiciousInspectionTimingWarning_(sheet, rowIndex, eventId, name, vehicleType, location,
                                                  startDateStr, endDateStr, preTripCompletedAt,
                                                  postTripCompletedAt, elapsedMinutes, locCfg) {
  if (!CONFIG.MANAGER_EMAIL) return false;

  const elapsedText = formatElapsedMinutes(elapsedMinutes);
  const subject = 'Review recommended: inspection timing for ' + name + ' (' + vehicleType + ')';
  const html =
    '<p>Hi ' + location + ' Manager,</p>' +
    '<p>The pre-trip and post-trip inspection forms for the booking below were submitted ' +
    'unusually close together, which may be worth a look:</p>' +
    '<p>' +
    'Customer: ' + name + '<br>' +
    'Booking ID: ' + eventId + '<br>' +
    'Vehicle: ' + vehicleType + '<br>' +
    'Location: ' + location + '<br>' +
    'Scheduled start: ' + startDateStr + '<br>' +
    'Scheduled end: ' + endDateStr + '<br>' +
    'Pre-trip inspection completed: ' + formatDateTime(preTripCompletedAt) + '<br>' +
    'Post-trip inspection completed: ' + formatDateTime(postTripCompletedAt) + '<br>' +
    'Elapsed time between submissions: ' + elapsedText +
    '</p>' +
    '<p>This is an informational notice only -- it does not mean anything is wrong. ' +
    'We recommend reviewing both inspection responses and contacting the customer if necessary.</p>';

  try {
    sendEmailHtml(CONFIG.MANAGER_EMAIL, subject, html, locCfg.email, locCfg.email);
  } catch(e) {
    Logger.log('Suspicious inspection timing warning failed for ' + name + ': ' + e);
    return false;
  }

  sheet.getRange(rowIndex + 1, 26).setValue('Yes'); // Z: Suspicious Timing Warning Sent
  SpreadsheetApp.flush();
  return true;
}

// ============================================================
// MANUAL IMMEDIATE SEND -- PRE-TRIP (production helper, not customer-facing)
// ------------------------------------------------------------
// Sends a REAL pre-trip inspection message to the booking's actual customer
// contact info, immediately, without waiting for
// isPreTripReminderEligible()'s window. Reuses sendPreTripReminder_()
// exactly as processReminders() does, so this IS a real operational send:
// on success, column K is written and the manager's 24-hour summary goes
// out normally, exactly like the automated path, just triggered
// immediately. Only run this manually from the Apps Script editor, for a
// specific, authorized reason (e.g. a legitimate resend) -- it is not wired
// to any trigger and is not reachable from any customer-facing surface.
//
// rowNumber is the 1-based sheet row, as shown in the Sheets UI.
//
// Safeguards (all throw with a clear message on failure, before anything is
// sent): rowNumber must be a positive integer of 2 or greater (row 1 is the
// header row) and within the sheet's actual row count; the row must have a
// booking identifier (column A), a customer name (column B), at least one
// of email/phone, a location that resolves via getLocationConfig(), and
// INSPECT_FORM_BASE must be configured so the form link can actually be
// built. No interactive confirmation prompt is used -- Apps Script cannot
// reliably show one outside a bound spreadsheet UI context (e.g. when run
// from a trigger or the editor's Run button), so a prompt here could hang
// or fail unpredictably instead of protecting anything; the pre-send log
// line below is the safeguard against running this by accident.
//
// Intentionally NOT idempotent: this does not check column K first, so
// running it again on an already-sent row sends again -- that is the
// point (see "a legitimate resend" above), not a bug.
//
// Returns true if the message was delivered (SUCCESS), false if it was not
// (FAILURE) -- see the log line emitted right before returning.
// ============================================================
function sendPreTripInspectionNowForRow(rowNumber) {
  if (typeof rowNumber !== 'number' || !Number.isInteger(rowNumber) || rowNumber < 2) {
    throw new Error('sendPreTripInspectionNowForRow: rowNumber must be a positive integer sheet row ' +
      'number, 2 or greater (row 1 is the header row). Got: ' + JSON.stringify(rowNumber));
  }

  const sheet = getSheet();
  const data  = sheet.getDataRange().getValues();
  const i     = rowNumber - 1;

  if (i >= data.length) {
    throw new Error('sendPreTripInspectionNowForRow: row ' + rowNumber + ' is out of range ' +
      '(sheet has ' + data.length + ' rows, including the header).');
  }

  const row         = data[i];
  const eventId     = row[0];  // A: Event ID (booking identifier)
  const name        = row[1];
  const email       = row[2];
  const phone       = row[3];
  const rentalDate  = new Date(row[4]);
  const dateStr     = formatDateTime(rentalDate);
  const vehicleType = row[18] || ''; // S: Vehicle Type
  const location    = row[19] || ''; // T: Location
  const leaseSigned = row[14];       // O: Lease Signed

  if (!eventId) {
    throw new Error('sendPreTripInspectionNowForRow: row ' + rowNumber + ' has no booking identifier ' +
      '(column A) -- this does not look like a real booking row.');
  }
  if (!name) {
    throw new Error('sendPreTripInspectionNowForRow: row ' + rowNumber + ' has no customer name (column B).');
  }
  if ((!email || email === 'No Email') && (!phone || phone === 'No Phone')) {
    throw new Error('sendPreTripInspectionNowForRow: row ' + rowNumber + ' has neither an email nor a phone on file -- nothing to send to.');
  }
  if (!CONFIG.INSPECT_FORM_BASE) {
    throw new Error('sendPreTripInspectionNowForRow: INSPECT_FORM_BASE is not set -- the inspection form link cannot be built.');
  }

  const locCfg = getLocationConfig(location); // throws for an unrecognized location
  const preUrl = buildInspectUrl(name, email || '', rentalDate, 'pre');

  Logger.log('sendPreTripInspectionNowForRow: BYPASSING normal eligibility ' +
    '(isPreTripReminderEligible / the 24-26 hour window) for an immediate, manually authorized send. ' +
    'Booking ID: ' + eventId + ', row: ' + rowNumber + ', recipient email: ' + email +
    ', recipient phone: ' + phone + '.');

  const delivered = sendPreTripReminder_(sheet, i, name, email, phone, locCfg, dateStr, vehicleType, location, preUrl, leaseSigned);
  Logger.log('sendPreTripInspectionNowForRow: row ' + rowNumber + ' (' + name + ', booking ' + eventId + ') ' +
    (delivered ? 'SUCCESS -- delivered.' : 'FAILURE -- not delivered; see the preceding log lines for the cause.'));
  return delivered;
}

// ============================================================
// MANUAL IMMEDIATE SEND -- POST-TRIP (production helper, not customer-facing)
// ------------------------------------------------------------
// Same as sendPreTripInspectionNowForRow() above, but for the post-trip
// inspection message -- reuses sendPostTripReminder_() directly, bypassing
// isPostTripReminderEligible()'s one-hour delay. Intended for the case
// where a vehicle is returned unusually early and the post-trip inspection
// needs to go out right away, or for a legitimate resend. A real
// operational send: column L is written and the manager's post-trip notice
// goes out normally on success. Not wired to any trigger, not
// customer-facing -- run manually from the Apps Script editor only.
//
// rowNumber is the 1-based sheet row, as shown in the Sheets UI.
//
// Same safeguards as sendPreTripInspectionNowForRow() above: rowNumber must
// be a positive integer of 2 or greater and within range; the row must have
// a booking identifier, customer name, at least one of email/phone, a
// resolvable location, and INSPECT_FORM_BASE configured. No interactive
// confirmation prompt, for the same reliability reason. Intentionally NOT
// idempotent -- running it again on an already-sent row sends again.
//
// Returns true if the message was delivered (SUCCESS), false if it was not
// (FAILURE) -- see the log line emitted right before returning.
// ============================================================
function sendPostTripInspectionNowForRow(rowNumber) {
  if (typeof rowNumber !== 'number' || !Number.isInteger(rowNumber) || rowNumber < 2) {
    throw new Error('sendPostTripInspectionNowForRow: rowNumber must be a positive integer sheet row ' +
      'number, 2 or greater (row 1 is the header row). Got: ' + JSON.stringify(rowNumber));
  }

  const sheet = getSheet();
  const data  = sheet.getDataRange().getValues();
  const i     = rowNumber - 1;

  if (i >= data.length) {
    throw new Error('sendPostTripInspectionNowForRow: row ' + rowNumber + ' is out of range ' +
      '(sheet has ' + data.length + ' rows, including the header).');
  }

  const row         = data[i];
  const eventId     = row[0];  // A: Event ID (booking identifier)
  const name        = row[1];
  const email       = row[2];
  const phone       = row[3];
  const rentalDate  = new Date(row[4]);
  const dateStr     = formatDateTime(rentalDate);
  const vehicleType = row[18] || ''; // S: Vehicle Type
  const location    = row[19] || ''; // T: Location

  if (!eventId) {
    throw new Error('sendPostTripInspectionNowForRow: row ' + rowNumber + ' has no booking identifier ' +
      '(column A) -- this does not look like a real booking row.');
  }
  if (!name) {
    throw new Error('sendPostTripInspectionNowForRow: row ' + rowNumber + ' has no customer name (column B).');
  }
  if ((!email || email === 'No Email') && (!phone || phone === 'No Phone')) {
    throw new Error('sendPostTripInspectionNowForRow: row ' + rowNumber + ' has neither an email nor a phone on file -- nothing to send to.');
  }
  if (!CONFIG.INSPECT_FORM_BASE) {
    throw new Error('sendPostTripInspectionNowForRow: INSPECT_FORM_BASE is not set -- the inspection form link cannot be built.');
  }

  const locCfg  = getLocationConfig(location); // throws for an unrecognized location
  const postUrl = buildInspectUrl(name, email || '', rentalDate, 'post');

  Logger.log('sendPostTripInspectionNowForRow: BYPASSING normal eligibility ' +
    '(isPostTripReminderEligible / the one-hour post-pre-trip delay) for an immediate, manually ' +
    'authorized send. Booking ID: ' + eventId + ', row: ' + rowNumber + ', recipient email: ' + email +
    ', recipient phone: ' + phone + '.');

  const delivered = sendPostTripReminder_(sheet, i, name, email, phone, locCfg, dateStr, vehicleType, location, postUrl);
  Logger.log('sendPostTripInspectionNowForRow: row ' + rowNumber + ' (' + name + ', booking ' + eventId + ') ' +
    (delivered ? 'SUCCESS -- delivered.' : 'FAILURE -- not delivered; see the preceding log lines for the cause.'));
  return delivered;
}
