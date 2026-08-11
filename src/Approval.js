// ============================================================
// ENGINE 2b: RENTAL APPROVAL CHECK (5-minute trigger)
// Sends initial approval email to manager, then reminders every
// HOURS_BETWEEN_APPROVAL_REMINDERS until MAX_APPROVAL_REMINDERS
// is reached, then escalates once to ADMIN_EMAIL and goes silent.
// Once the manager sets Rental Approved to Approved - Free or
// Approved - Paid, manager reminders stop immediately -- but the
// CUSTOMER is not notified until the lease has actually been signed
// (column O, set only by the DocuSeal signed webhook). The approved
// value may sit in the sheet for as long as it takes; each run just
// checks column O again. Once signed, the very next run sends the
// one-time customer notification (tracked in column V so later runs
// do not resend). Script never writes to column P -- only the manager
// touches it.
// State is tracked in Q (Approval Notified At) and R (Reminder Count)
// for the manager reminder loop, and V (Customer Approval Notified)
// for the one-time customer notification.
// ============================================================
function checkRentalEligibility() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    Logger.log('checkRentalEligibility: could not acquire lock, skipping');
    return;
  }

  try {
    checkRentalEligibility_();
  } finally {
    lock.releaseLock();
  }
}

// Actual implementation, run only while checkRentalEligibility() holds the
// script lock -- guards against an overlapping execution reading column V
// before a prior run has finished writing it, which could otherwise send
// the customer approval email twice. Same locking pattern as
// processReminders() (Reminders.js).
function checkRentalEligibility_() {
  const sheet = getSheet();
  const data  = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const intakeSent       = data[i][8];                // I: Intake Sent
    const approved         = data[i][15];               // P: Rental Approved
    const lastNotified     = data[i][16];               // Q: Approval Notified At
    const reminderCount    = Number(data[i][17]) || 0;  // R: Approval Reminder Count
    const leaseSigned      = data[i][14];                // O: Lease Signed
    const customerNotified = data[i][21];                // V: Customer Approval Notified
    const cancelled        = data[i][26];                // AA: Cancelled

    // Skip rows that aren't fully initialized yet
    if (intakeSent !== 'Yes') continue;

    // Cancelled bookings get no further approval processing -- no more
    // manager reminders, and no "your rental is approved" customer notice.
    if (cancelled) continue;

    // Manager has approved (with or without a fee) -- manager reminders
    // stop here regardless of lease-signature status. The customer is only
    // notified once the lease has actually been signed (column O); until
    // then this row is silently skipped and re-checked on the next run.
    if (approved === 'Approved - Free' || approved === 'Approved - Paid') {
      if (shouldNotifyCustomerOfApproval(approved, leaseSigned, customerNotified)) {
        notifyCustomerOfApproval(sheet, data, i);
      }
      continue;
    }

    // Manager has denied -- nothing further for this function to do.
    if (approved === 'Denied') continue;

    // Skip rows that have already been escalated (permanent skip)
    if (reminderCount > CONFIG.MAX_APPROVAL_REMINDERS) continue;

    const name        = data[i][1];
    const email        = data[i][2];
    const phone        = data[i][3];
    const dateStr      = formatDateTime(new Date(data[i][4]));
    const vehicleType  = data[i][18] || '';  // S: Vehicle Type
    const location     = data[i][19] || '';  // T: Location

    let locCfg;
    try {
      locCfg = getLocationConfig(location);
    } catch(e) {
      Logger.log('checkRentalEligibility: ' + e.message + ' (row ' + (i + 1) + ') — skipping');
      continue;
    }

    const hoursSince = lastNotified
      ? (Date.now() - new Date(lastNotified).getTime()) / (1000 * 60 * 60)
      : Infinity;

    const decisionList =
      '<p>Please set the Rental Approved field in the Bookings sheet to one of:</p>' +
      '<ul>' +
      '<li>Approved - Free</li>' +
      '<li>Approved - Paid</li>' +
      '<li>Denied</li>' +
      '</ul>';

    const customerBlock =
      '<p>' +
      'Customer: ' + name + '<br>' +
      'Vehicle: ' + vehicleType + '<br>' +
      'Location: ' + location + '<br>' +
      'Date/time: ' + dateStr + '<br>' +
      'Email: ' + (email || 'No Email') + '<br>' +
      'Phone: ' + (phone || 'No Phone') +
      '</p>';

    // Branch A — First send (no email has gone out yet)
    if (reminderCount === 0) {
      const html =
        '<p>Hi ' + location + ' Manager,</p>' +
        '<p>A new ' + vehicleType + ' rental needs your approval:</p>' +
        customerBlock +
        decisionList;

      try {
        sendEmailHtml(CONFIG.MANAGER_EMAIL,
          'Action needed: approve rental for ' + name, html, locCfg.email, locCfg.email);
        // Only update Q and R on successful send so failed sends will retry
        sheet.getRange(i + 1, 17).setValue(new Date());
        sheet.getRange(i + 1, 18).setValue(1);
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
        '<p>Hi ' + location + ' Manager,</p>' +
        '<p>This is reminder #' + reminderCount +
          '. The customer is still awaiting approval.</p>' +
        '<p>A ' + vehicleType + ' rental needs your approval:</p>' +
        customerBlock +
        decisionList;

      try {
        sendEmailHtml(CONFIG.MANAGER_EMAIL,
          'Reminder #' + reminderCount + ': approve rental for ' + name, html, locCfg.email, locCfg.email);
        sheet.getRange(i + 1, 17).setValue(new Date());
        sheet.getRange(i + 1, 18).setValue(reminderCount + 1);
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
        '<p>The site manager has not responded to ' +
          CONFIG.MAX_APPROVAL_REMINDERS + ' approval reminders sent over ' +
          totalHours + ' hours.</p>' +
        '<p>The script will not send any more emails for this booking. ' +
          'Please follow up directly.</p>' +
        '<p>Customer details:</p>' +
        customerBlock;

      try {
        sendEmailHtml(CONFIG.ADMIN_EMAIL,
          'ESCALATION: ' + CONFIG.MAX_APPROVAL_REMINDERS +
            ' approval reminders unanswered for ' + name, html, locCfg.email, locCfg.email);
        // Bump R past MAX so the top-of-loop check skips this row forever.
        // Do NOT update Q — there's nothing more to time off of.
        sheet.getRange(i + 1, 18).setValue(CONFIG.MAX_APPROVAL_REMINDERS + 1);
        SpreadsheetApp.flush();
      } catch(e) {
        Logger.log('checkRentalEligibility escalation email failed for ' + name + ': ' + e);
      }
      continue;
    }

    // Branch D — reminder not yet due, skip silently
  }
}

// ============================================================
// NOTIFY CUSTOMER OF APPROVAL (called once per row from checkRentalEligibility)
// Sends the customer a one-time email (and SMS, if a phone is on file) telling
// them their rental has been approved. Only ever called once column O (Lease
// Signed) is already 'Yes' -- see shouldNotifyCustomerOfApproval() -- so this
// does not need to hedge about whether the lease has been signed yet, and
// does not read column J (Lease Sent) at all. Idempotency is tracked in
// column V (Customer Approval Notified) — separate from columns Q/R, which
// belong only to the manager reminder loop. V is set to 'Yes' only after a
// successful send so a failed attempt is retried on the next trigger run.
// ============================================================
function notifyCustomerOfApproval(sheet, data, i) {
  const name        = data[i][1];
  const email       = data[i][2];
  const phone       = data[i][3];
  const dateStr     = formatDateTime(new Date(data[i][4]));
  const vehicleType = data[i][18] || ''; // S: Vehicle Type
  const location    = data[i][19] || ''; // T: Location

  let locCfg;
  try {
    locCfg = getLocationConfig(location);
  } catch(e) {
    Logger.log('notifyCustomerOfApproval: ' + e.message + ' (row ' + (i + 1) + ') — skipping');
    return;
  }

  const firstName = (name || '').split(' ')[0];

  const html =
    '<p>Hi ' + name + ',</p>' +
    '<p>Good news, your ' + vehicleType + ' rental at our ' + location +
    ' location on ' + dateStr + ' has been approved.</p>' +
    '<p>Reply to this email or call us if you have any questions.</p>' +
    '<p>Thank you,<br>' + CONFIG.COMPANY_NAME + '</p>';

  const sms =
    CONFIG.COMPANY_NAME + ': Good news ' + firstName + ', your ' + vehicleType +
    ' rental on ' + dateStr + ' is approved.';

  let delivered = false;

  if (phone && phone !== 'No Phone') {
    try { sendSms(phone, sms, locCfg.phone); delivered = true; }
    catch(e) { Logger.log('notifyCustomerOfApproval: SMS failed for ' + name + ': ' + e); }
  }

  if (email && email !== 'No Email') {
    try {
      sendEmailHtml(email, 'Your rental is approved', html, locCfg.email, locCfg.email);
      delivered = true;
    } catch(e) {
      Logger.log('notifyCustomerOfApproval: email failed for ' + name + ': ' + e);
    }
  } else if (!phone || phone === 'No Phone') {
    // No email and no phone on file — nothing we can deliver. Mark it notified
    // anyway so the row does not retry forever with no way to reach the customer.
    Logger.log('notifyCustomerOfApproval: no email or phone for ' + name + ' (row ' + (i + 1) + ') — marking notified to avoid endless retry');
    delivered = true;
  }

  if (delivered) {
    sheet.getRange(i + 1, 22).setValue('Yes'); // V: Customer Approval Notified
    SpreadsheetApp.flush();
  }
}
