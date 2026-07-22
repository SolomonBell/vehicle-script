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

function extractVehicleType(title) {
  if (/cargo van/i.test(title))    return 'Cargo Van';
  if (/moving truck/i.test(title)) return 'Moving Truck';
  return '';
}

function getStripePaymentUrl(vehicleType) {
  const urls = {
    'Cargo Van':    CONFIG.STRIPE_PAYMENT_URL_CARGO_VAN,
    'Moving Truck': CONFIG.STRIPE_PAYMENT_URL_MOVING_TRUCK,
  };
  const url = urls[vehicleType];
  if (url) return url;
  if (vehicleType) Logger.log('WARNING: getStripePaymentUrl — unknown vehicleType "' + vehicleType + '"');
  return CONFIG.STRIPE_PAYMENT_URL;
}
