// ============================================================
// RELIABLE STORAGE -- TRUCK RENTAL AUTOMATION  v8
// Google Apps Script | Paste into Extensions > Apps Script
// ============================================================
// CHANGES IN v8:
//   - Manager (site@example.com) is now BCC'd on
//     every customer-facing email so she can track what
//     customers receive. Emails already addressed to her or to
//     the admin are excluded to avoid duplicate copies.
//     (Centralized in sendEmailHtml — covers future messages.)
//   - Primary sending address (FROM_EMAIL) changed from
//     info@ to site@example.com.
//   - Customer reply-to changed from andrew@ to bainbridge@
//     so replies reach the site manager.
//   - SMS: no copy logic added. All texts are already sent FROM
//     the Bainbridge Twilio number (+12065550111 / TWILIO_NUM),
//     so every customer text and manager alert already appears
//     in the App's thread for that number. (A copy to that
//     number is impossible anyway — Twilio rejects To == From.)
//   - NOTE: the DocuSeal lease email is sent by DocuSeal, not
//     through sendEmailHtml, so it is not BCC'd here. The
//     manager already signs every lease as a DocuSeal submitter.
// ============================================================
// SHEET COLUMNS (Row 1 = headers):
//   A: Event ID              B: Customer Name        C: Email
//   D: Phone                 E: Start Time           F: End Time
//   G: Deposit Paid          H: Stripe Amount        I: Intake Sent
//   J: Lease Sent            K: 24hr Sent            L: Post-Rental Sent
//   M: Second Driver Email   N: Lease Signed         O: Rental Approved
//   P: Approval Notified At  Q: Approval Reminder Count
//   R: Vehicle Type          S: Location
// ============================================================
// CHANGES IN v7:
//   - Approval reminder loop reworked. Script no longer writes
//     to column O at all -- that column is manager-only with a
//     strict three-value dropdown (Approved - Free / Approved -
//     Paid / Denied). State is tracked in new columns P and Q.
//     Manager gets initial email, then reminders every
//     HOURS_BETWEEN_APPROVAL_REMINDERS, capped at
//     MAX_APPROVAL_REMINDERS, then a single escalation to
//     ADMIN_EMAIL and silence. Fixes the 5-minute reminder
//     storm caused by the old "write Pending to O" pattern.
//   - All secrets, API keys, and form/calendar URLs moved out
//     of CONFIG and into Script Properties. Rotate via Project
//     Settings > Script Properties; no code change required.
//   - MANAGER_PHONE corrected to +12065550100 (missing country
//     code was causing Twilio "Invalid To Phone Number" errors).
//   - Deposit amount in customer-facing messages updated from
//     $100 to $50 to match the current Stripe payment link.
// ============================================================
// CHANGES IN v6:
//   - Customer name now extracted from event description
//     ("Andrew Sherrard") instead of event title
//     ("Bainbridge Cargo Van (Andrew Sherrard)")
//   - Rental date now pre-fills correctly in intake form URL
//   - All emails switched to HTML for clean clickable links
//   - alertAdmin now uses SendGrid instead of Gmail
//   - DocuSeal is now live on a paid plan (test_mode removed)
// ============================================================

// All secrets, API keys, tokens, and form/calendar URLs are stored in
// Script Properties (Project Settings > Script Properties), NOT in this file.
// To rotate a secret, update the value in Script Properties — no code change.

const PROPS = PropertiesService.getScriptProperties().getProperties();

const CONFIG = {
  SHEET_NAME:     'Bookings',
  ADMIN_EMAIL:    PROPS.ADMIN_EMAIL,
  MANAGER_EMAIL:  PROPS.MANAGER_EMAIL,
  MANAGER_PHONE:  PROPS.MANAGER_PHONE,

  // ---- Stripe -------------------------------------------------
  STRIPE_PAYMENT_URL:             PROPS.STRIPE_PAYMENT_URL,
  STRIPE_PAYMENT_URL_CARGO_VAN:   PROPS.STRIPE_PAYMENT_URL_CARGO_VAN,
  STRIPE_PAYMENT_URL_MOVING_TRUCK: PROPS.STRIPE_PAYMENT_URL_MOVING_TRUCK,

  // ---- Twilio (SMS) --------------------------------------------
  TWILIO_SID:   PROPS.TWILIO_SID,
  TWILIO_TOKEN: PROPS.TWILIO_TOKEN,
  TWILIO_NUM:   PROPS.TWILIO_NUM,

  // ---- SendGrid (email) ----------------------------------------
  SENDGRID_KEY:   PROPS.SENDGRID_KEY,
  FROM_EMAIL:     PROPS.FROM_EMAIL,
  FROM_NAME:      'Reliable Storage',
  REPLY_TO_EMAIL: PROPS.REPLY_TO_EMAIL,

  // ---- DocuSeal (e-signature) ---------------------------------
  DOCUSEAL_KEY:                  PROPS.DOCUSEAL_KEY,
  DOCUSEAL_TEMPLATE_SINGLE:      Number(PROPS.DOCUSEAL_TEMPLATE_SINGLE),
  DOCUSEAL_TEMPLATE_TWO_DRIVERS: Number(PROPS.DOCUSEAL_TEMPLATE_TWO_DRIVERS),

  // ---- Intake Form (Form 1) ------------------------------------
  INTAKE_FORM_BASE:   PROPS.INTAKE_FORM_BASE,
  INTAKE_ENTRY_NAME:  PROPS.INTAKE_ENTRY_NAME,
  INTAKE_ENTRY_PHONE: PROPS.INTAKE_ENTRY_PHONE,
  INTAKE_ENTRY_EMAIL: PROPS.INTAKE_ENTRY_EMAIL,
  INTAKE_ENTRY_DATE:  PROPS.INTAKE_ENTRY_DATE,

  // ---- Inspection Form (Form 2) --------------------------------
  INSPECT_FORM_BASE:   PROPS.INSPECT_FORM_BASE,
  INSPECT_ENTRY_NAME:  PROPS.INSPECT_ENTRY_NAME,
  INSPECT_ENTRY_EMAIL: PROPS.INSPECT_ENTRY_EMAIL,
  INSPECT_ENTRY_DATE:  PROPS.INSPECT_ENTRY_DATE,
  INSPECT_ENTRY_TYPE:  PROPS.INSPECT_ENTRY_TYPE,
  INSPECT_VAL_PRE:     PROPS.INSPECT_VAL_PRE,
  INSPECT_VAL_POST:    PROPS.INSPECT_VAL_POST,

  DAYS_AHEAD:        60,
  POST_RENTAL_HOURS: 1,

  HOURS_BETWEEN_APPROVAL_REMINDERS: 12,
  MAX_APPROVAL_REMINDERS: 3,   // 1 initial + 2 follow-ups; 3rd = escalation

  // ---- Deposit amounts (customer-facing messages) ---------------
  DEPOSIT_AMOUNT:              PROPS.DEPOSIT_AMOUNT              || '50',
  DEPOSIT_AMOUNT_CARGO_VAN:    PROPS.DEPOSIT_AMOUNT_CARGO_VAN    || '50',
  DEPOSIT_AMOUNT_MOVING_TRUCK: PROPS.DEPOSIT_AMOUNT_MOVING_TRUCK || '100',
};

// Maps each calendar Script Property to its location and vehicle type.
// syncCalendarBookings() reads every entry; entries with an unset calendarId are skipped.
const CALENDAR_CONFIGS = [
  {
    propKey:     'CALENDAR_ID_BAINBRIDGE_CARGO_VAN',
    calendarId:  PROPS.CALENDAR_ID_BAINBRIDGE_CARGO_VAN,
    location:    'Bainbridge',
    vehicleType: 'Cargo Van',
  },
  {
    propKey:     'CALENDAR_ID_POULSBO_MOVING_TRUCK',
    calendarId:  PROPS.CALENDAR_ID_POULSBO_MOVING_TRUCK,
    location:    'Poulsbo',
    vehicleType: 'Moving Truck',
  },
  {
    propKey:     'CALENDAR_ID_PORT_ORCHARD_MOVING_TRUCK',
    calendarId:  PROPS.CALENDAR_ID_PORT_ORCHARD_MOVING_TRUCK,
    location:    'Port Orchard',
    vehicleType: 'Moving Truck',
  },
  {
    propKey:     'CALENDAR_ID_FAIRGROUNDS_MOVING_TRUCK',
    calendarId:  PROPS.CALENDAR_ID_FAIRGROUNDS_MOVING_TRUCK,
    location:    'Fairgrounds',
    vehicleType: 'Moving Truck',
  },
];
