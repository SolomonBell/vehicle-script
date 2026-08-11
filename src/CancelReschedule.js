// ============================================================
// ENGINE: CANCELLATION / RESCHEDULE DETECTION
// ------------------------------------------------------------
// Called from syncCalendarBookings() (CalendarSync.js), once per location,
// using that location's own freshly-fetched calendar events for the current
// sync cycle. Ported from the live production Bainbridge script
// (reliable-storage-rental, Truck Reservation.js) and adapted for the
// multi-location architecture — see docs/setup-notes.md for the design
// rationale.
//
// COLUMNS (append-only, do not renumber — see docs/setup-notes.md):
//   AA (27): Cancelled          — timestamp, auto-detected or manager-typed
//   AB (28): Cancel Notified    — Yes/blank, set only after a delivered notice
//   AC (29): Rescheduled At     — timestamp, most recent reschedule only
// ============================================================

// ============================================================
// PURE DECISION FUNCTION
// ------------------------------------------------------------
// toleranceMs defaults to 60 seconds — a jitter filter, not a grace period.
// A delta of exactly toleranceMs is NOT a reschedule (strict >), matching
// the old Bainbridge script's behavior. NaN in either timestamp (an
// unparseable stored or calendar start time) never counts as a reschedule.
// ============================================================
function isRescheduleDetected(oldStartMs, newStartMs, toleranceMs) {
  if (toleranceMs === undefined) toleranceMs = 60 * 1000;
  if (isNaN(oldStartMs) || isNaN(newStartMs)) return false;
  return Math.abs(oldStartMs - newStartMs) > toleranceMs;
}

// ============================================================
// RESCHEDULE HANDLING (called from syncCalendarBookings() in
// CalendarSync.js when isRescheduleDetected() is true for an already-synced
// Event ID belonging to this location)
// ------------------------------------------------------------
// Two guard conditions come before any normal reschedule processing:
//
//   1. Already cancelled (AA set) — never reschedule a cancelled row. Purely
//      defensive; CalendarSync.js should not even call this for a cancelled
//      row, but this keeps the guarantee local to the function that owns it.
//
//   2. Post-trip inspection already complete (Y set) — the prior rental
//      lifecycle already finished. A calendar-time change at this point most
//      plausibly means the manager repurposed an old event/row rather than
//      genuinely moving the same still-open booking. Automatically re-arming
//      state here risks reusing a stale signed lease / approval / DocuSeal
//      submission ID against whatever this "new" date actually represents.
//      Treated as exceptional: no state is changed, no notice is sent,
//      alertAdmin() is called instead so a human decides what this means.
//
// Normal case: updates E/F to the new calendar time, clears K and L so the
// 24-hour and post-rental reminders re-arm for the new date, and stamps AC.
// If X (Pre-Inspection Form Completed) is already set, the inspection
// lifecycle must restart for the new date — X and Z are also cleared, or
// isPostTripReminderEligible() (Helpers.js) would measure its one-hour delay
// from the stale old completion timestamp and could fire the post-trip
// reminder before the vehicle has even been picked up under the new date.
//
// Preserved untouched in every case: Deposit Paid, Stripe Amount, Lease
// Sent, Lease Signed, Rental Approved, approval reminder state, DocuSeal
// Submission ID — a reschedule moves the rental clock, not already-completed
// financial/legal state.
// ============================================================
function handleReschedule_(sheet, rowIndex, row, newStart, newEnd, locCfg) {
  if (row[26]) return; // AA: Cancelled — never reschedule a cancelled row

  const eventId  = row[0]  || '';
  const name     = row[1]  || '';
  const location = row[19] || ''; // T: Location

  if (row[24]) { // Y: Post-Inspection Form Completed — prior rental lifecycle already finished
    Logger.log('handleReschedule_: row ' + (rowIndex + 1) + ' (' + name + ', ' + location +
               ') has a calendar time change but the post-trip inspection is already complete -- ' +
               'treated as exceptional, NOT an automatic reschedule. No state changed, no notice sent.');
    alertAdmin(
      'Reschedule detected on a completed booking -- manual review needed',
      'Booking ID: ' + eventId + '\n' +
      'Customer: ' + name + '\n' +
      'Location: ' + location + '\n' +
      'Sheet row: ' + (rowIndex + 1) + '\n\n' +
      'This booking\'s calendar event changed time, but column Y (Post-Inspection Form Completed) ' +
      'is already set, meaning the prior rental lifecycle already finished. This was NOT ' +
      'automatically treated as a reschedule -- no columns were changed and no notice was sent. ' +
      'Review the booking and update the Bookings sheet manually if appropriate.'
    );
    return;
  }

  let oldDateStr;
  try { oldDateStr = formatDateTime(new Date(row[4])); }
  catch (e) { oldDateStr = 'the previous time'; }

  const preTripAlreadyCompleted = !!row[23]; // X: Pre-Inspection Form Completed

  sheet.getRange(rowIndex + 1, 5).setValue(newStart);  // E: Start Time
  sheet.getRange(rowIndex + 1, 6).setValue(newEnd);    // F: End Time
  sheet.getRange(rowIndex + 1, 11).setValue('');       // K: 24hr Sent -- re-arm
  sheet.getRange(rowIndex + 1, 12).setValue('');       // L: Post-Rental Sent -- re-arm

  if (preTripAlreadyCompleted) {
    sheet.getRange(rowIndex + 1, 24).setValue('');     // X: Pre-Inspection Form Completed -- re-arm
    sheet.getRange(rowIndex + 1, 26).setValue('');     // Z: Suspicious Timing Warning Sent -- re-arm
  }

  sheet.getRange(rowIndex + 1, 29).setValue(new Date()); // AC: Rescheduled At
  SpreadsheetApp.flush();

  Logger.log('Reschedule detected, row ' + (rowIndex + 1) + ' (' + name + ', ' + location + '): ' +
             oldDateStr + ' -> ' + newStart +
             (preTripAlreadyCompleted ? ' (pre-trip inspection reset -- was already complete for the old date)' : ''));

  sendRescheduleNotice_(row, newStart, oldDateStr, locCfg);
}

function sendRescheduleNotice_(row, newStart, oldDateStr, locCfg) {
  const name        = row[1];
  const email       = row[2];
  const phone       = row[3];
  const vehicleType = row[18] || ''; // S: Vehicle Type
  const location    = row[19] || ''; // T: Location

  let newDateStr;
  try { newDateStr = formatDateTime(newStart); }
  catch (e) { newDateStr = 'your new time'; }

  const customerHtml =
    '<p>Hi ' + name + ',</p>' +
    '<p>Your ' + vehicleType + ' reservation at our ' + location + ' location has been ' +
    '<strong>rescheduled</strong>.</p>' +
    '<p>New date/time: <strong>' + newDateStr + '</strong></p>' +
    '<p>If you did not request this change, please reply to this email or call us right away.</p>' +
    '<p>Thank you,<br>' + CONFIG.COMPANY_NAME + '</p>' +
    buildChangeCancelFooter_(locCfg);

  const customerSms =
    CONFIG.COMPANY_NAME + ': Your ' + vehicleType + ' reservation at ' + location +
    ' has been rescheduled to ' + newDateStr + '. Reply or call us with any questions.';

  if (phone && phone !== 'No Phone') {
    try { sendSms(phone, customerSms, locCfg.phone); }
    catch (e) { Logger.log('Reschedule SMS failed for ' + name + ': ' + e); }
  }
  if (email && email !== 'No Email') {
    try { sendEmailHtml(email, 'Your reservation has been rescheduled', customerHtml, locCfg.email, locCfg.email); }
    catch (e) { Logger.log('Reschedule email failed for ' + name + ': ' + e); }
  }

  // ---- Manager notice — current global manager notification behavior, unchanged ----
  if (CONFIG.MANAGER_EMAIL) {
    try {
      const mgrHtml =
        '<p>A ' + vehicleType + ' booking at ' + location + ' has been rescheduled:</p>' +
        '<p><strong>' + name + '</strong></p>' +
        '<p>Old: ' + oldDateStr + '</p>' +
        '<p>New: ' + newDateStr + '</p>' +
        '<p>Email: ' + (email || 'No Email') + '</p>' +
        '<p>Phone: ' + (phone || 'No Phone') + '</p>';
      sendEmailHtml(CONFIG.MANAGER_EMAIL, 'Rescheduled: ' + name + ' (' + location + ')', mgrHtml, locCfg.email, locCfg.email);
    } catch (e) { Logger.log('Reschedule manager email failed for ' + name + ': ' + e); }
  }
  if (CONFIG.MANAGER_PHONE) {
    try { sendSms(CONFIG.MANAGER_PHONE, 'Rescheduled: ' + name + ' (' + location + ') -> ' + newDateStr + '.', locCfg.phone); }
    catch (e) { Logger.log('Reschedule manager SMS failed for ' + name + ': ' + e); }
  }
}

// ============================================================
// CANCELLATION DETECTION (called once per location, after that location's
// event loop in syncCalendarBookings(), CalendarSync.js)
// ------------------------------------------------------------
// events must already be a successfully-read array for this location this
// cycle (see the try/catch around CalendarApp's getEvents() in
// CalendarSync.js) — a genuinely failed read must never reach this
// function, and an empty array here is always a legitimate "zero events"
// state, never a proxy for a failed read. There is deliberately no
// events.length === 0 guard: that heuristic would silently stop detecting a
// real cancellation on the one case that matters most -- a location's last
// remaining future booking being deleted, which legitimately makes the next
// successful read return zero events.
//
// Every row is filtered to row[19] === calCfg.location (T: Location) before
// being evaluated, so one location's calendar can never cancel another
// location's rows, even though this scans the whole sheet once per
// location.
// ============================================================
function runCancellationDetectionForLocation_(sheet, calCfg, events, now, future) {
  const currentIds = events.map(function(e) { return e.getId(); });

  let locCfg;
  try {
    locCfg = getLocationConfig(calCfg.location);
  } catch (e) {
    Logger.log('runCancellationDetectionForLocation_: ' + e.message);
    return;
  }

  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    try {
      const row = data[i];
      if (row[19] !== calCfg.location) continue; // T: Location -- never evaluate another location's rows

      const eventId          = row[0];             // A: Event ID
      const startTime         = new Date(row[4]);    // E: Start Time
      const alreadyCancelled = !!row[26];           // AA: Cancelled
      const alreadyNotified  = row[27] === 'Yes';   // AB: Cancel Notified

      if (alreadyCancelled && alreadyNotified) continue; // fully handled already

      const validStart   = !isNaN(startTime.getTime());
      const inWindow     = validStart && startTime >= now && startTime <= future;
      const autoDetected = inWindow && !!eventId && currentIds.indexOf(eventId) === -1;

      // Cancel if the manager hand-flagged it (AA already non-empty) OR a
      // calendar delete was just detected. Neither -> nothing to do.
      if (!alreadyCancelled && !autoDetected) continue;

      if (!alreadyCancelled) {
        sheet.getRange(i + 1, 27).setValue(new Date()); // AA: Cancelled -- stamp auto-detection time
        Logger.log('Cancellation detected (calendar delete), row ' + (i + 1) + ' (' +
                   calCfg.location + '): ' + row[1]);
      }

      if (!alreadyNotified) {
        const delivered = sendCancellationNotice_(row, locCfg);
        if (delivered) {
          sheet.getRange(i + 1, 28).setValue('Yes'); // AB: Cancel Notified -- only after a real delivery
        }
      }

      SpreadsheetApp.flush();

    } catch (e) {
      alertAdmin('runCancellationDetectionForLocation_ error (' + calCfg.location + '), row ' + (i + 1),
                 e.toString());
    }
  }
}

// Sends the one-time cancellation notice to the customer and (best-effort,
// non-gating) to the manager. Returns true if at least one customer channel
// delivered, or if the row has neither a phone nor an email on file (same
// "no way to reach them, do not retry forever" convention as
// sendPreTripReminder_() / notifyCustomerOfApproval()) — the caller only
// writes AB (Cancel Notified) when this returns true, so a total SendGrid +
// Twilio outage does not permanently mark a customer notified.
function sendCancellationNotice_(row, locCfg) {
  const name        = row[1];
  const email       = row[2];
  const phone       = row[3];
  const vehicleType = row[18] || ''; // S: Vehicle Type
  const location    = row[19] || ''; // T: Location

  let dateStr;
  try { dateStr = formatDateTime(new Date(row[4])); }
  catch (e) { dateStr = 'your reserved date'; }

  const customerHtml =
    '<p>Hi ' + name + ',</p>' +
    '<p>Your ' + vehicleType + ' reservation at our ' + location + ' location for ' +
    '<strong>' + dateStr + '</strong> has been cancelled.</p>' +
    '<p>If this was a mistake, or you would like to rebook, just reply to this email or call us -- ' +
    'we are happy to help.</p>' +
    '<p>Thank you,<br>' + CONFIG.COMPANY_NAME + '</p>' +
    buildChangeCancelFooter_(locCfg);

  const customerSms =
    CONFIG.COMPANY_NAME + ': Your ' + vehicleType + ' reservation at ' + location + ' for ' + dateStr +
    ' has been cancelled. Reply or call us if you would like to rebook.';

  let delivered = false;

  if (phone && phone !== 'No Phone') {
    try { sendSms(phone, customerSms, locCfg.phone); delivered = true; }
    catch (e) { Logger.log('Cancellation SMS failed for ' + name + ': ' + e); }
  }
  if (email && email !== 'No Email') {
    try {
      sendEmailHtml(email, 'Your reservation has been cancelled', customerHtml, locCfg.email, locCfg.email);
      delivered = true;
    } catch (e) { Logger.log('Cancellation email failed for ' + name + ': ' + e); }
  }
  if ((!phone || phone === 'No Phone') && (!email || email === 'No Email')) {
    Logger.log('sendCancellationNotice_: no email or phone for ' + name +
               ' -- marking notified to avoid endless retry');
    delivered = true;
  }

  // ---- Manager notice — current global manager notification behavior, unchanged ----
  if (CONFIG.MANAGER_EMAIL) {
    try {
      const mgrHtml =
        '<p>A ' + vehicleType + ' booking at ' + location + ' has been cancelled:</p>' +
        '<p><strong>' + name + '</strong></p>' +
        '<p>Date/time: ' + dateStr + '</p>' +
        '<p>Email: ' + (email || 'No Email') + '</p>' +
        '<p>Phone: ' + (phone || 'No Phone') + '</p>';
      sendEmailHtml(CONFIG.MANAGER_EMAIL, 'Cancelled: ' + name + ' (' + location + ')', mgrHtml, locCfg.email, locCfg.email);
    } catch (e) { Logger.log('Cancellation manager email failed for ' + name + ': ' + e); }
  }
  if (CONFIG.MANAGER_PHONE) {
    try { sendSms(CONFIG.MANAGER_PHONE, 'Cancelled: ' + name + ' (' + location + ') on ' + dateStr + '.', locCfg.phone); }
    catch (e) { Logger.log('Cancellation manager SMS failed for ' + name + ': ' + e); }
  }

  return delivered;
}

// ============================================================
// CHANGE/CANCEL FOOTER
// ------------------------------------------------------------
// Appended explicitly only inside the two customer-facing messages above --
// deliberately NOT wired into sendEmailHtml() globally, and NOT added to any
// other existing customer email (welcome, deposit confirmation, pre/post-trip
// inspection, approval notice). Those are already-shipped, already-tested
// messages nobody asked to change; scope stays limited to the two new
// cancellation/reschedule notices.
// ============================================================
function buildChangeCancelFooter_(locCfg) {
  const phoneLine = (locCfg && locCfg.phone) ? ' or text us at ' + locCfg.phone : '';
  return '<hr style="border:none;border-top:1px solid #ddd;margin:18px 0 10px">' +
    '<p style="font-size:13px;color:#555;line-height:1.45">' +
    '<strong>Need to reschedule or cancel this reservation?</strong><br>' +
    'Just reply to this email' + phoneLine + ', and we\'ll take care of it for you.' +
    '</p>';
}
