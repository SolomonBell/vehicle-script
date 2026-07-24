// ============================================================
// ENGINE 2b: RENTAL APPROVAL CHECK (5-minute trigger)
// Sends initial approval email to manager, then reminders every
// HOURS_BETWEEN_APPROVAL_REMINDERS until MAX_APPROVAL_REMINDERS
// is reached, then escalates once to ADMIN_EMAIL and goes silent.
// Script never writes to column O — only the manager touches it.
// State is tracked in P (Approval Notified At) and Q (Reminder Count).
// ============================================================
function checkRentalEligibility() {
  const sheet = getSheet();
  const data  = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const intakeSent    = data[i][8];                // I: Intake Sent
    const approved      = data[i][14];               // O: Rental Approved
    const lastNotified  = data[i][15];               // P: Approval Notified At
    const reminderCount = Number(data[i][16]) || 0;  // Q: Approval Reminder Count

    // Skip rows that aren't fully initialized yet
    if (intakeSent !== 'Yes') continue;

    // Skip rows the manager has already decided
    if (approved === 'Approved - Free' ||
        approved === 'Approved - Paid' ||
        approved === 'Denied') continue;

    // Skip rows that have already been escalated (permanent skip)
    if (reminderCount > CONFIG.MAX_APPROVAL_REMINDERS) continue;

    const name        = data[i][1];
    const email       = data[i][2];
    const phone       = data[i][3];
    const dateStr     = formatDateTime(new Date(data[i][4]));
    const vehicleType = data[i][17] || '';  // R: Vehicle Type
    const location    = data[i][18] || '';  // S: Location

    const hoursSince = lastNotified
      ? (Date.now() - new Date(lastNotified).getTime()) / (1000 * 60 * 60)
      : Infinity;

    const decisionList =
      '<p>Please set the <strong>Rental Approved</strong> field in the Bookings sheet to one of:</p>' +
      '<ul>' +
      '<li><strong>Approved - Free</strong></li>' +
      '<li><strong>Approved - Paid</strong></li>' +
      '<li><strong>Denied</strong></li>' +
      '</ul>';

    const customerBlock =
      '<p><strong>Customer:</strong> ' + name + '</p>' +
      '<p><strong>Date/time:</strong> ' + dateStr + '</p>' +
      '<p><strong>Vehicle:</strong> ' + vehicleType + '</p>' +
      '<p><strong>Location:</strong> ' + location + '</p>' +
      '<p><strong>Email:</strong> ' + (email || 'No Email') + '</p>' +
      '<p><strong>Phone:</strong> ' + (phone || 'No Phone') + '</p>';

    // Branch A — First send (no email has gone out yet)
    if (reminderCount === 0) {
      const html =
        '<p>A new ' + vehicleType + ' rental needs your approval:</p>' +
        customerBlock +
        decisionList;

      try {
        sendEmailHtml(CONFIG.MANAGER_EMAIL,
          'Action needed — approve rental for ' + name, html);
        // Only update P and Q on successful send so failed sends will retry
        sheet.getRange(i + 1, 16).setValue(new Date());
        sheet.getRange(i + 1, 17).setValue(1);
        SpreadsheetApp.flush();
      } catch(e) {
        Logger.log('checkRentalEligibility initial email failed for ' + name + ': ' + e);
      }
      continue;
    }

    // Branch B — Reminder due
    if (reminderCount >= 1
        && reminderCount < CONFIG.MAX_APPROVAL_REMINDERS
        && hoursSince >= CONFIG.HOURS_BETWEEN_APPROVAL_REMINDERS) {

      const html =
        '<p><strong>This is reminder #' + reminderCount +
          '. The customer is still awaiting approval.</strong></p>' +
        '<p>A ' + vehicleType + ' rental needs your approval:</p>' +
        customerBlock +
        decisionList;

      try {
        sendEmailHtml(CONFIG.MANAGER_EMAIL,
          'Reminder #' + reminderCount + ' — approve rental for ' + name, html);
        sheet.getRange(i + 1, 16).setValue(new Date());
        sheet.getRange(i + 1, 17).setValue(reminderCount + 1);
        SpreadsheetApp.flush();
      } catch(e) {
        Logger.log('checkRentalEligibility reminder email failed for ' + name + ': ' + e);
      }
      continue;
    }

    // Branch C — Cap reached, escalate to admin and go silent
    if (reminderCount === CONFIG.MAX_APPROVAL_REMINDERS
        && hoursSince >= CONFIG.HOURS_BETWEEN_APPROVAL_REMINDERS) {

      const totalHours = CONFIG.HOURS_BETWEEN_APPROVAL_REMINDERS * CONFIG.MAX_APPROVAL_REMINDERS;
      const html =
        '<p><strong>The site manager has not responded to ' +
          CONFIG.MAX_APPROVAL_REMINDERS + ' approval reminders sent over ' +
          totalHours + ' hours.</strong></p>' +
        '<p>The script will not send any more emails for this booking. ' +
          'Please follow up directly.</p>' +
        '<p><strong>Customer details:</strong></p>' +
        customerBlock;

      try {
        sendEmailHtml(CONFIG.ADMIN_EMAIL,
          'ESCALATION: ' + CONFIG.MAX_APPROVAL_REMINDERS +
            ' approval reminders unanswered — ' + name, html);
        // Bump Q past MAX so the top-of-loop check skips this row forever.
        // Do NOT update P — there's nothing more to time off of.
        sheet.getRange(i + 1, 17).setValue(CONFIG.MAX_APPROVAL_REMINDERS + 1);
        SpreadsheetApp.flush();
      } catch(e) {
        Logger.log('checkRentalEligibility escalation email failed for ' + name + ': ' + e);
      }
      continue;
    }

    // Branch D — reminder not yet due, skip silently
  }
}
