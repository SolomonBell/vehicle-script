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

      try {
        // 24-hour reminder
        if (hoursUntilStart <= 26 && hoursUntilStart >= 0 && sent24hr !== 'Yes'
            && (approved === 'Approved - Free' || approved === 'Approved - Paid')) {

          // *** WRITE FLAG FIRST — before anything can throw ***
          sheet.getRange(i + 1, 11).setValue('Yes');
          SpreadsheetApp.flush();

          const preUrl      = buildInspectUrl(name, email || '', rentalDate, 'pre');
          const depositPaid = row[6];
          const leaseSigned = row[13];

          let emailSubject = 'Your truck pickup is tomorrow!';
          let emailHtml    = '<p>Hi ' + name + ',</p>';

          if (depositPaid !== 'Yes') {
            emailSubject = 'Action needed — your pickup is tomorrow';
            emailHtml +=
              '<p>⚠️ <strong>Your pickup is tomorrow but we have not received your deposit yet.</strong></p>' +
              '<p>Please pay your $' + CONFIG.DEPOSIT_AMOUNT + ' deposit immediately to confirm your booking:</p>' +
              '<p><a href="' + CONFIG.STRIPE_PAYMENT_URL + '">Pay deposit now</a></p>' +
              '<p>If you have any questions please reply to this email or call us.</p>';
          } else {
            emailHtml += '<p>Your truck pickup is <strong>tomorrow!</strong></p>';
            if (leaseSigned !== 'Yes') {
              emailHtml +=
                '<p>⚠️ <strong>Action needed:</strong> You have not yet signed your rental agreement. ' +
                'Please check your email for the rental agreement and sign it before your pickup.</p>';
            }
            emailHtml +=
              '<p>Before driving off, please complete your pre-trip inspection form. ' +
              'Your name, email, and rental date are already filled in — just add photos and submit:</p>' +
              '<p><a href="' + preUrl + '">Complete pre-trip inspection form</a></p>' +
              '<p>See you tomorrow!</p>';
          }

          emailHtml += '<p>— Reliable Storage</p>';

          const sms = depositPaid !== 'Yes'
            ? 'Reliable Storage: Your pickup is tomorrow but we have not received your deposit. Please pay now: ' + CONFIG.STRIPE_PAYMENT_URL
            : 'Reliable Storage: Pickup is tomorrow! Complete your pre-trip inspection: ' + preUrl;

          // Each send in its own try/catch — one failure won't block the others
          if (phone !== 'No Phone') {
            try { sendSms(phone, sms); }
            catch(e) { Logger.log('24hr SMS failed for ' + name + ': ' + e); }
          }
          if (email !== 'No Email') {
            try { sendEmailHtml(email, emailSubject, emailHtml); }
            catch(e) { Logger.log('24hr email failed for ' + name + ': ' + e); }
          }

          const managerHtml =
            '<p>Upcoming rental tomorrow:</p>' +
            '<p><strong>' + name + '</strong> — ' + formatDateTime(rentalDate) + '</p>' +
            '<p>Deposit paid: ' + (depositPaid === 'Yes' ? '✅ Yes' : '❌ No') + '</p>' +
            '<p>Lease signed: ' + (leaseSigned === 'Yes' ? '✅ Yes' : '❌ Not yet') + '</p>' +
            '<p>Pre-trip inspection form:<br><a href="' + preUrl + '">Inspection form link</a></p>';

          if (CONFIG.MANAGER_EMAIL) {
            try { sendEmailHtml(CONFIG.MANAGER_EMAIL, "Tomorrow's rental — " + name, managerHtml); }
            catch(e) { Logger.log('Manager email failed: ' + e); }
          }
          if (CONFIG.MANAGER_PHONE) {
            try { sendSms(CONFIG.MANAGER_PHONE, "Tomorrow's rental: " + name + ' at ' + formatDateTime(rentalDate) + '. Deposit: ' + (depositPaid === 'Yes' ? 'Yes' : 'NO')); }
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
            'Thanks for using Reliable Storage! Please submit your post-trip inspection ' +
            '(your info is pre-filled): ' + postUrl;

          const emailHtml =
            '<p>Hi ' + name + ',</p>' +
            '<p>Thanks for returning the truck!</p>' +
            '<p>Please complete your post-trip inspection form. ' +
            'Your name, email, and rental date are already filled in — just add photos and submit:</p>' +
            '<p><a href="' + postUrl + '">Complete post-trip inspection form</a></p>' +
            '<p>We appreciate your business!</p>' +
            '<p>— Reliable Storage</p>';

          if (phone !== 'No Phone') {
            try { sendSms(phone, sms); }
            catch(e) { Logger.log('Post-rental SMS failed for ' + name + ': ' + e); }
          }
          if (email !== 'No Email') {
            try { sendEmailHtml(email, 'Post-trip inspection — please complete', emailHtml); }
            catch(e) { Logger.log('Post-rental email failed for ' + name + ': ' + e); }
          }

          if (CONFIG.MANAGER_EMAIL) {
            try {
              const mgrPostHtml =
                '<p>A customer has been sent their post-trip inspection form:</p>' +
                '<p><strong>Customer:</strong> ' + name + '</p>' +
                '<p><strong>Rental date:</strong> ' + formatDateTime(rentalDate) + '</p>' +
                '<p><strong>Post-trip inspection form:</strong><br>' +
                '<a href="' + postUrl + '">Inspection form link</a></p>' +
                '<p>If the customer has not submitted the form within 24 hours, please follow up directly.</p>';
              sendEmailHtml(CONFIG.MANAGER_EMAIL, 'Post-rental inspection needed — ' + name, mgrPostHtml);
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
