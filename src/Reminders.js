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

        // 24-hour reminder
        if (hoursUntilStart <= 26 && hoursUntilStart >= 0 && sent24hr !== 'Yes'
            && (approved === 'Approved - Free' || approved === 'Approved - Paid')) {

          // *** WRITE FLAG FIRST — before anything can throw ***
          sheet.getRange(i + 1, 11).setValue('Yes');
          SpreadsheetApp.flush();

          const preUrl      = buildInspectUrl(name, email || '', rentalDate, 'pre');
          const depositPaid = row[6];
          const leaseSigned = row[13];

          let emailSubject;
          let emailHtml = '<p>Hi ' + name + ',</p>';

          if (depositPaid !== 'Yes') {
            emailSubject = 'Action needed — deposit due for tomorrow\'s ' + vehicleType + ' pickup';
            emailHtml +=
              '<p>Your <strong>' + vehicleType + '</strong> pickup at our <strong>' + location +
              '</strong> location is scheduled for <strong>' + dateStr + '</strong>.</p>' +
              '<p><strong>We have not received your $' + getDepositAmount(vehicleType) + ' deposit.</strong> ' +
              'Please check your original welcome email for the deposit payment link.</p>' +
              '<p>Reply to this email or call us if you need assistance.</p>' +
              '<p>Thank you,<br>' + CONFIG.COMPANY_NAME + '</p>';
          } else {
            emailSubject = 'Pickup reminder — ' + vehicleType + ' rental on ' + dateStr;
            emailHtml +=
              '<p>This is a reminder that your <strong>' + vehicleType + '</strong> pickup at our <strong>' +
              location + '</strong> location is scheduled for <strong>' + dateStr + '</strong>.</p>' +
              '<p>Before using the vehicle, please complete the pre-trip inspection form. ' +
              'Your booking information is already filled in — add the required photos and submit:</p>' +
              '<p><a href="' + preUrl + '">Complete pre-trip inspection</a></p>';
            if (leaseSigned !== 'Yes') {
              emailHtml +=
                '<p><strong>Action needed:</strong> Your rental agreement has not been signed. ' +
                'Please check your email for your rental agreement and sign it before your pickup.</p>';
            }
            emailHtml +=
              '<p>Reply to this email or call us if you have any questions.</p>' +
              '<p>Thank you,<br>' + CONFIG.COMPANY_NAME + '</p>';
          }

          const sms = depositPaid !== 'Yes'
            ? CONFIG.COMPANY_NAME + ': Your ' + vehicleType + ' pickup at ' + location +
              ' is scheduled for ' + dateStr + ', but your $' + getDepositAmount(vehicleType) +
              ' deposit is still due. Please check your original welcome email for the payment link.'
            : CONFIG.COMPANY_NAME + ': Your ' + vehicleType + ' pickup at ' + location +
              ' is scheduled for ' + dateStr + '. Complete the pre-trip inspection before departure: ' + preUrl;

          // Each send in its own try/catch — one failure won't block the others
          if (phone !== 'No Phone') {
            try { sendSms(phone, sms, locCfg.phone); }
            catch(e) { Logger.log('24hr SMS failed for ' + name + ': ' + e); }
          }
          if (email !== 'No Email') {
            try { sendEmailHtml(email, emailSubject, emailHtml, locCfg.email, locCfg.email); }
            catch(e) { Logger.log('24hr email failed for ' + name + ': ' + e); }
          }

          const managerHtml =
            '<p>Upcoming rental tomorrow:</p>' +
            '<p>' +
            '<strong>Customer:</strong> ' + name + '<br>' +
            '<strong>Vehicle:</strong> ' + vehicleType + '<br>' +
            '<strong>Location:</strong> ' + location + '<br>' +
            '<strong>Date/time:</strong> ' + dateStr + '<br>' +
            '<strong>Deposit paid:</strong> ' + (depositPaid === 'Yes' ? '✅ Yes' : '❌ No') + '<br>' +
            '<strong>Lease signed:</strong> ' + (leaseSigned === 'Yes' ? '✅ Yes' : '❌ Not yet') + '<br>' +
            '<strong>Pre-trip inspection form:</strong> <a href="' + preUrl + '">Inspection form link</a>' +
            '</p>';

          if (CONFIG.MANAGER_EMAIL) {
            try { sendEmailHtml(CONFIG.MANAGER_EMAIL, "Tomorrow's rental — " + name + ' — ' + vehicleType, managerHtml, locCfg.email, locCfg.email); }
            catch(e) { Logger.log('Manager email failed: ' + e); }
          }
          if (CONFIG.MANAGER_PHONE) {
            try { sendSms(CONFIG.MANAGER_PHONE, "Tomorrow's rental: " + name + ' — ' + vehicleType + ' at ' + location + ' on ' + dateStr + '. Deposit: ' + (depositPaid === 'Yes' ? 'Yes' : 'No'), locCfg.phone); }
            catch(e) { Logger.log('Manager SMS failed: ' + e); }
          }
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
            '<p>Thank you for completing your <strong>' + vehicleType + '</strong> rental ' +
            'at our <strong>' + location + '</strong> location on <strong>' + dateStr + '</strong>.</p>' +
            '<p>Please complete the post-trip inspection form. ' +
            'Your booking information is already filled in — add the required photos and submit:</p>' +
            '<p><a href="' + postUrl + '">Complete post-trip inspection</a></p>' +
            '<p>We appreciate your business.</p>' +
            '<p>Thank you,<br>' + CONFIG.COMPANY_NAME + '</p>';

          if (phone !== 'No Phone') {
            try { sendSms(phone, sms, locCfg.phone); }
            catch(e) { Logger.log('Post-rental SMS failed for ' + name + ': ' + e); }
          }
          if (email !== 'No Email') {
            try { sendEmailHtml(email, 'Post-trip inspection — ' + vehicleType + ' rental', emailHtml, locCfg.email, locCfg.email); }
            catch(e) { Logger.log('Post-rental email failed for ' + name + ': ' + e); }
          }

          if (CONFIG.MANAGER_EMAIL) {
            try {
              const mgrPostHtml =
                '<p>Post-trip inspection form sent to <strong>' + name + '</strong>.</p>' +
                '<p>' +
                '<strong>Vehicle:</strong> ' + vehicleType + '<br>' +
                '<strong>Location:</strong> ' + location + '<br>' +
                '<strong>Rental date:</strong> ' + dateStr + '<br>' +
                '<strong>Email:</strong> ' + email + '<br>' +
                '<strong>Post-trip form:</strong> <a href="' + postUrl + '">View inspection form</a>' +
                '</p>' +
                '<p>If the form is not submitted within 24 hours, please follow up directly.</p>';
              sendEmailHtml(CONFIG.MANAGER_EMAIL, 'Post-rental inspection — ' + name + ' — ' + vehicleType, mgrPostHtml, locCfg.email, locCfg.email);
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
