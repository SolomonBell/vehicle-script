// ============================================================
// HELPERS
// ============================================================
function getSheet() {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!sheetId) throw new Error('Script Property "SHEET_ID" is not set');
  const ss = SpreadsheetApp.openById(sheetId);
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) throw new Error('Tab "' + CONFIG.SHEET_NAME + '" not found in spreadsheet ' + sheetId);
  return sheet;
}

function getExistingEventIds(sheet) {
  return sheet.getDataRange().getValues().slice(1).map(r => r[0]).filter(Boolean);
}

// Extracts customer name from "Booked by\nName\n..." in description
function extractBookedByName(text) {
  const m = text.match(/<b>Booked by<\/b>[\s\r\n]+([^\r\n<]+)/i);
  return m ? m[1].trim() : null;
}

// Extracts the primary (first) email -- the customer's email
// Skips the second driver email by looking for it specifically
function extractPrimaryEmail(text) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.match(/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/)) {
      const prevLine = (lines[i - 1] || '').toLowerCase();
      if (!prevLine.includes('second')) {
        return line;
      }
    }
  }
  return null;
}

// Extracts second driver email specifically from after the label
function extractSecondDriverEmail(text) {
  const m = text.match(/<b>Second Driver[^<]*<\/b>[\s\r\n]+([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i);
  return m ? m[1].trim() : null;
}

// Always returns phone in +1XXXXXXXXXX format
function extractPhone(text) {
  const m = text.match(/(\+?1?\s?[\(\-]?\d{3}[\)\-\s]?\s?\d{3}[\-\s]?\d{4})/);
  if (!m) return null;
  const digits = m[0].replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return '+' + digits;
}

// Coerce a value to a valid Date, or throw a descriptive error naming the bad
// value. Guards the formatters below against non-Date inputs (e.g. a start time
// that arrives as a string), which previously surfaced as the opaque
// "Invalid argument: date. Should be of type: Date".
function toDate(value, label) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    throw new Error('Expected a Date for ' + (label || 'value') +
      ' but got ' + JSON.stringify(value) + ' (type ' + typeof value + ')');
  }
  return d;
}

// Human-readable date for emails and lease subject
function formatDate(date) {
  return Utilities.formatDate(toDate(date, 'formatDate'), Session.getScriptTimeZone(), 'MMMM d, yyyy');
}

// Date pre-fill for Google Forms
function formatDateForForm(date) {
  return Utilities.formatDate(toDate(date, 'formatDateForForm'), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function formatDateTime(date) {
  return Utilities.formatDate(toDate(date, 'formatDateTime'), Session.getScriptTimeZone(), 'MMMM d, yyyy \'at\' h:mm a');
}

// Compact date/time format matching the style already used for the booking
// Start Time and End Time cells (see CalendarSync.js's
// setNumberFormat('m/d/yy h:mm AM/PM')), but with a four-digit year so the
// value stays unambiguous when combined with a flag in one cell (see
// formatInspectionCompletionValue() below). Same timezone mechanism
// (Session.getScriptTimeZone()) as every other formatter in this file.
function formatDateTimeShort(date) {
  return Utilities.formatDate(toDate(date, 'formatDateTimeShort'), Session.getScriptTimeZone(), 'M/d/yyyy h:mm a');
}

// Builds the exact cell value written to columns W (Pre-Inspection Form
// Completed) and X (Post-Inspection Form Completed) when the customer
// completes the corresponding form: the literal flag 'Yes' plus the actual
// form-submission time, combined in one cell (e.g. "Yes 8/2/2026 9:15 AM").
// Pairs with parseInspectionCompletionTimestamp_() below, which reverses it.
function formatInspectionCompletionValue(date) {
  return 'Yes ' + formatDateTimeShort(date);
}

// Parses a completion-cell value written by formatInspectionCompletionValue()
// back into a Date representing the recorded completion time. Returns null
// if the value is blank, does not start with "Yes", or the remaining text
// cannot be parsed as a date -- callers must treat null as "not completed"
// or "completion time unknown" and never guess a time. Used by
// processReminders() (Reminders.js) to measure elapsed time since the
// pre-trip inspection was completed.
function parseInspectionCompletionTimestamp_(cellValue) {
  const text = String(cellValue || '').trim();
  if (text.indexOf('Yes') !== 0) return null;
  const remainder = text.slice(3).trim(); // strip the leading "Yes"
  if (!remainder) return null;
  const parsed = new Date(remainder);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function getDepositAmount(vehicleType) {
  const amounts = {
    'Cargo Van':    CONFIG.DEPOSIT_AMOUNT_CARGO_VAN,
    'Moving Truck': CONFIG.DEPOSIT_AMOUNT_MOVING_TRUCK,
  };
  const amount = amounts[vehicleType];
  if (amount) return amount;
  if (vehicleType) Logger.log('WARNING: getDepositAmount — unknown vehicleType "' + vehicleType + '"');
  return CONFIG.DEPOSIT_AMOUNT;
}

function getStripePriceId(vehicleType) {
  const ids = {
    'Cargo Van':    CONFIG.STRIPE_PRICE_ID_CARGO_VAN,
    'Moving Truck': CONFIG.STRIPE_PRICE_ID_MOVING_TRUCK,
  };
  const id = ids[vehicleType];
  if (id) return id;
  if (vehicleType) Logger.log('WARNING: getStripePriceId — unknown vehicleType "' + vehicleType + '"');
  return null;
}

function createStripeCheckoutSession(vehicleType, clientReferenceId, customerEmail) {
  const priceId = getStripePriceId(vehicleType);
  if (!priceId) {
    throw new Error('createStripeCheckoutSession: no Price ID configured for vehicle type "' +
                    vehicleType + '"');
  }

  const payload = {
    mode:                                    'payment',
    'line_items[0][price]':                  priceId,
    'line_items[0][quantity]':               '1',
    'payment_intent_data[capture_method]':   'manual',
    'client_reference_id':                   clientReferenceId,
    success_url:                             'https://reliablestorage.com',
  };
  if (customerEmail && customerEmail !== 'No Email') {
    payload['customer_email'] = customerEmail;
  }

  const options = {
    method:  'post',
    headers: { Authorization: 'Bearer ' + CONFIG.STRIPE_SECRET_KEY },
    payload: payload,
    muteHttpExceptions: true,
  };

  const resp = UrlFetchApp.fetch('https://api.stripe.com/v1/checkout/sessions', options);
  if (resp.getResponseCode() >= 400) {
    throw new Error('Stripe API error ' + resp.getResponseCode() +
                    ' creating checkout session for "' + vehicleType + '"');
  }

  return JSON.parse(resp.getContentText()).url;
}

// Returns true only when the deposit has cleared AND the intake form has
// actually been completed (column V — set by processIntakeFormSubmission_(), not by
// Intake Sent/column I, which only means the intake link was emailed) AND
// the lease has not already been sent. Deliberately order-independent: it
// does not matter whether the deposit or the intake form completes first,
// only that both are true before a DocuSeal submission is created.
function isDocuSealEligible(depositPaid, intakeCompleted, leaseSent) {
  return depositPaid === 'Yes' && intakeCompleted === 'Yes' && leaseSent !== 'Yes';
}

// Returns true only when the manager has approved the rental (paid or free),
// the lease has actually been signed (column N -- not merely sent), and the
// customer has not already been sent the one-time approval notification
// (column U). Denied and blank/pending approval values return false, and so
// does an approved-but-not-yet-signed row: the manager's approval value may
// sit in the sheet for as long as it takes the DocuSeal signed webhook to
// update column N -- this deliberately does not fire early just because
// column O already has an approved value. Used by checkRentalEligibility()
// to decide whether notifyCustomerOfApproval() should run for a given row.
function shouldNotifyCustomerOfApproval(approved, leaseSigned, customerNotified) {
  return (approved === 'Approved - Free' || approved === 'Approved - Paid') &&
         leaseSigned === 'Yes' &&
         customerNotified !== 'Yes';
}

// Returns true only when a booking is currently eligible for its one-time
// 24-hour/pre-trip reminder: inside the reminder window (0 <= hoursUntilStart
// <= 26), not already sent (sent24hr !== 'Yes'), approved (paid or free), and
// with the deposit cleared. Deposit and approval are both real eligibility
// gates here -- neither is merely a content choice -- so a booking that is
// missing either one when it first enters the window is safely re-evaluated
// on every later run (the caller re-checks this on each processReminders()
// pass) for as long as it stays inside the window, right up until the rental
// actually starts (hoursUntilStart going negative permanently excludes it,
// matching "never send the pre-trip reminder after the rental has begun").
// Used by processReminders() (Reminders.js) to decide whether to attempt the
// customer's pre-trip reminder for a given row.
function isPreTripReminderEligible(hoursUntilStart, sent24hr, approved, depositPaid) {
  return hoursUntilStart <= 26 && hoursUntilStart >= 0 &&
         sent24hr !== 'Yes' &&
         (approved === 'Approved - Free' || approved === 'Approved - Paid') &&
         depositPaid === 'Yes';
}

// Returns true only when the pre-trip inspection was completed at a known
// time, at least one hour has elapsed since that completion, and the
// post-trip reminder has not already been sent. hoursSincePreTripCompleted
// is null when the pre-trip completion timestamp is missing or unparseable
// (see parseInspectionCompletionTimestamp_()) -- in that case this always
// returns false, since there is nothing to measure the one-hour delay from.
// The one-hour delay is measured from the actual recorded completion time,
// not from when the pre-trip reminder was sent or from the booking's Start
// or End Time. Used by processReminders() (Reminders.js): re-checked on
// every run, so a booking is picked up on the first run where an hour has
// actually elapsed, with the same granularity as the processReminders()
// trigger interval -- this is what makes the one-hour delay durable across
// separate Apps Script executions without any timer or sleep call.
function isPostTripReminderEligible(hoursSincePreTripCompleted, sentPost) {
  return hoursSincePreTripCompleted !== null &&
         hoursSincePreTripCompleted >= 1 &&
         sentPost !== 'Yes';
}

// Returns { email, phone } for the given booking location — the from-address and
// from-number to use for all emails and SMS related to that booking.
// Throws if the location is not one of the four active locations so the caller's
// catch block can alert the admin. Never falls back to a different location.
function getLocationConfig(location) {
  const MAP = {
    'Bainbridge':   { email: CONFIG.EMAIL_BAINBRIDGE,   phone: CONFIG.PHONE_BAINBRIDGE   },
    'Poulsbo':      { email: CONFIG.EMAIL_POULSBO,       phone: CONFIG.PHONE_POULSBO      },
    'Port Orchard': { email: CONFIG.EMAIL_PORT_ORCHARD,  phone: CONFIG.PHONE_PORT_ORCHARD },
    'Fairgrounds':  { email: CONFIG.EMAIL_FAIRGROUNDS,   phone: CONFIG.PHONE_FAIRGROUNDS  },
  };
  const cfg = MAP[location];
  if (!cfg) {
    Logger.log('ERROR: getLocationConfig — unknown location "' + (location || '') + '". ' +
               'Valid locations: ' + Object.keys(MAP).join(', ') + '.');
    throw new Error('Unknown location "' + (location || '') + '". Check column S and CALENDAR_CONFIGS.');
  }
  return cfg;
}
