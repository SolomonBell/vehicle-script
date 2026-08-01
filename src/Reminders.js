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
      const approved  = row[14]; // O: Rental Approved

      if (isNaN(startTime)) continue;

      const hoursAfterEnd   = (now - endTime)   / (1000 * 60 * 60);
      if (hoursAfterEnd > 48 && sent24hr === 'Yes' && sentPost === 'Yes') continue;

      const hoursUntilStart = (startTime - now) / (1000 * 60 * 60);
      const rentalDate      = new Date(row[4]);
      const dateStr         = formatDateTime(rentalDate);
      const vehicleType     = row[17] || '';  // R: Vehicle Type
      const location        = row[18] || '';  // S: Location

      try {
        const locCfg = getLocationConfig(location);

        // 24-hour reminder. Deposit and approval are both real eligibility
        // gates (see isPreTripReminderEligible in Helpers.js) -- a booking
        // missing either one is skipped silently here and re-evaluated on
        // every later run for as long as it stays in the window.
        const depositPaid = row[6];
        if (isPreTripReminderEligible(hoursUntilStart, sent24hr, approved, depositPaid)) {
          const preUrl = buildInspectUrl(name, email || '', rentalDate, 'pre');
          sendPreTripReminder_(sheet, i, name, email, phone, locCfg, dateStr, vehicleType, location, preUrl, row[13]);
        }

        // Post-rental reminder
        if (hoursAfterEnd >= CONFIG.POST_RENTAL_HOURS && sentPost !== 'Yes') {

          // *** WRITE FLAG FIRST ***
          sheet.getRange(i + 1, 12).setValue('Yes');
          SpreadsheetApp.flush();

          const postUrl = buildInspectUrl(name, email || '', rentalDate, 'post');

          const sms =
            CONFIG.COMPANY_NAME + ': Please complete the post-trip inspection for your ' +
            vehicleType + ' rental at ' + location + ': ' + postUrl;

          const emailHtml =
            '<p>Hi ' + name + ',</p>' +
            '<p>Thank you for completing your ' + vehicleType + ' rental ' +
            'at our ' + location + ' location on ' + dateStr + '.</p>' +
            '<p>Please complete the post-trip inspection form. ' +
            'Your booking information is already filled in, just add the required photos and submit:</p>' +
            '<p><a href="' + postUrl + '">Complete post-trip inspection</a></p>' +
            '<p>We appreciate your business.</p>' +
            '<p>Thank you,<br>' + CONFIG.COMPANY_NAME + '</p>';

          if (phone !== 'No Phone') {
            try { sendSms(phone, sms, locCfg.phone); }
            catch(e) { Logger.log('Post-rental SMS failed for ' + name + ': ' + e); }
          }
          if (email !== 'No Email') {
            try { sendEmailHtml(email, 'Post-trip inspection: ' + vehicleType + ' rental', emailHtml, locCfg.email, locCfg.email); }
            catch(e) { Logger.log('Post-rental email failed for ' + name + ': ' + e); }
          }

          if (CONFIG.MANAGER_EMAIL) {
            try {
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
              sendEmailHtml(CONFIG.MANAGER_EMAIL, 'Post-rental inspection: ' + name + ' (' + vehicleType + ')', mgrPostHtml, locCfg.email, locCfg.email);
            } catch(e) { Logger.log('Post-rental manager email failed for ' + name + ': ' + e); }
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
  const emailSubject = 'Pickup reminder: ' + vehicleType + ' rental on ' + dateStr;
  let emailHtml =
    '<p>Hi ' + name + ',</p>' +
    '<p>This is a reminder that your ' + vehicleType + ' pickup at our ' +
    location + ' location is scheduled for ' + dateStr + '.</p>' +
    '<p>Before using the vehicle, please complete the pre-trip inspection form. ' +
    'Your booking information is already filled in, just add the required photos and submit:</p>' +
    '<p><a href="' + preUrl + '">Complete pre-trip inspection</a></p>';
  if (leaseSigned !== 'Yes') {
    emailHtml +=
      '<p>Action needed: Your rental agreement has not been signed. ' +
      'Please check your email for your rental agreement and sign it before your pickup.</p>';
  }
  emailHtml +=
    '<p>Reply to this email or call us if you have any questions.</p>' +
    '<p>Thank you,<br>' + CONFIG.COMPANY_NAME + '</p>';

  const sms =
    CONFIG.COMPANY_NAME + ': Your ' + vehicleType + ' pickup at ' + location +
    ' is scheduled for ' + dateStr + '. Complete the pre-trip inspection before departure: ' + preUrl;

  let delivered = false;

  if (phone && phone !== 'No Phone') {
    try { sendSms(phone, sms, locCfg.phone); delivered = true; }
    catch(e) { Logger.log('24hr SMS failed for ' + name + ': ' + e); }
  }
  if (email && email !== 'No Email') {
    try { sendEmailHtml(email, emailSubject, emailHtml, locCfg.email, locCfg.email); delivered = true; }
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
    'Lease signed: ' + (leaseSigned === 'Yes' ? 'Yes' : 'Not yet') + '<br>' +
    'Pre-trip inspection form: <a href="' + preUrl + '">Inspection form link</a>' +
    '</p>';

  if (CONFIG.MANAGER_EMAIL) {
    try { sendEmailHtml(CONFIG.MANAGER_EMAIL, "Tomorrow's rental: " + name + ' (' + vehicleType + ')', managerHtml, locCfg.email, locCfg.email); }
    catch(e) { Logger.log('Manager email failed: ' + e); }
  }
  if (CONFIG.MANAGER_PHONE) {
    try { sendSms(CONFIG.MANAGER_PHONE, "Tomorrow's rental: " + name + ' — ' + vehicleType + ' at ' + location + ' on ' + dateStr + '.', locCfg.phone); }
    catch(e) { Logger.log('Manager SMS failed: ' + e); }
  }

  return true;
}
