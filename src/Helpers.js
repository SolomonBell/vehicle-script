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
// actually been completed (column V — set by onIntakeFormSubmit(), not by
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
