// ============================================================
// RELIABLE STORAGE -- TRUCK RENTAL AUTOMATION  v8
// Google Apps Script | Paste into Extensions > Apps Script
// ============================================================
// CHANGES IN v8:
//   - Manager is now BCC'd on every customer-facing email so she
//     can track what customers receive. Emails already addressed
//     to her or to the admin are excluded to avoid duplicate copies.
//     (Centralized in sendEmailHtml — covers future messages.)
//   - Primary sending address (FROM_EMAIL) was updated.
//   - Customer reply-to was updated so replies reach the site manager.
//   - SMS: no copy logic added. All texts are already sent FROM
//     TWILIO_NUM, so every customer text and manager alert already
//     appears in the App's thread for that number. (A copy is
//     impossible anyway — Twilio rejects To == From.)
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
//   R: Vehicle Type          S: Location             T: DocuSeal Submission ID
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
//   - MANAGER_PHONE corrected (missing country code was causing
//     Twilio "Invalid To Phone Number" errors).
//   - Deposit amount in customer-facing messages updated to match
//     the current Stripe payment link.
// ============================================================
// CHANGES IN v6:
//   - Customer name now extracted from event description
//     ("Booked by / Name") instead of event title
//     ("Vehicle Type (Name)")
//   - Rental date now pre-fills correctly in intake form URL
//   - All emails switched to HTML for clean clickable links
//   - alertAdmin now uses SendGrid instead of Gmail
//   - DocuSeal is now live on a paid plan (test_mode removed)
// ============================================================

// All configuration — secrets, API keys, tokens, URLs, and operational settings —
// is stored in Script Properties (Project Settings > Script Properties), NOT in this file.
// To change a setting or rotate a credential, update the value in Script Properties — no code change.

const PROPS = PropertiesService.getScriptProperties().getProperties();

const CONFIG = {
  SHEET_NAME:     PROPS.SHEET_NAME,
  COMPANY_NAME:   PROPS.COMPANY_NAME,
  ADMIN_EMAIL:    PROPS.ADMIN_EMAIL,
  MANAGER_EMAIL:  PROPS.MANAGER_EMAIL,
  MANAGER_PHONE:  PROPS.MANAGER_PHONE,

  // ---- Stripe -------------------------------------------------
  STRIPE_SECRET_KEY:            PROPS.STRIPE_SECRET_KEY,
  STRIPE_PRICE_ID_CARGO_VAN:    PROPS.STRIPE_PRICE_ID_CARGO_VAN,
  STRIPE_PRICE_ID_MOVING_TRUCK: PROPS.STRIPE_PRICE_ID_MOVING_TRUCK,

  // ---- Twilio (SMS) --------------------------------------------
  TWILIO_SID:   PROPS.TWILIO_SID,
  TWILIO_TOKEN: PROPS.TWILIO_TOKEN,

  // ---- SendGrid (email) ----------------------------------------
  SENDGRID_KEY:   PROPS.SENDGRID_KEY,
  FROM_EMAIL:     PROPS.FROM_EMAIL,
  FROM_NAME:      PROPS.FROM_NAME,
  REPLY_TO_EMAIL: PROPS.REPLY_TO_EMAIL,

  // ---- Location-specific senders (email and SMS) ---------------
  // Each active location has its own sending email address and Twilio phone number.
  // All customer-facing and manager-facing messages for a booking use the sender
  // for that booking's location (column S). FROM_EMAIL is used only by alertAdmin().
  EMAIL_BAINBRIDGE:   PROPS.EMAIL_BAINBRIDGE,
  PHONE_BAINBRIDGE:   PROPS.PHONE_BAINBRIDGE,
  EMAIL_POULSBO:      PROPS.EMAIL_POULSBO,
  PHONE_POULSBO:      PROPS.PHONE_POULSBO,
  EMAIL_PORT_ORCHARD: PROPS.EMAIL_PORT_ORCHARD,
  PHONE_PORT_ORCHARD: PROPS.PHONE_PORT_ORCHARD,
  EMAIL_FAIRGROUNDS:  PROPS.EMAIL_FAIRGROUNDS,
  PHONE_FAIRGROUNDS:  PROPS.PHONE_FAIRGROUNDS,

  // ---- DocuSeal (e-signature) ---------------------------------
  DOCUSEAL_KEY:                  PROPS.DOCUSEAL_API_KEY,
  DOCUSEAL_TEMPLATE_SINGLE:      Number(PROPS.DOCUSEAL_TEMPLATE_ONE_DRIVER),
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

  DAYS_AHEAD:        Number(PROPS.DAYS_AHEAD),        // Number of days ahead to scan calendars for bookings.
  POST_RENTAL_HOURS: Number(PROPS.POST_RENTAL_HOURS), // Number of hours after a rental ends before sending the post-rental message.

  HOURS_BETWEEN_APPROVAL_REMINDERS: Number(PROPS.HOURS_BETWEEN_APPROVAL_REMINDERS), // Hours between approval reminder messages.
  MAX_APPROVAL_REMINDERS:           Number(PROPS.MAX_APPROVAL_REMINDERS),           // Reminders sent before escalating to admin; 1 initial + (MAX-1) follow-ups, then escalation.

  // ---- Deposit amounts (customer-facing messages) ---------------
  DEPOSIT_AMOUNT:              PROPS.DEPOSIT_AMOUNT,
  DEPOSIT_AMOUNT_CARGO_VAN:    PROPS.DEPOSIT_AMOUNT_CARGO_VAN,
  DEPOSIT_AMOUNT_MOVING_TRUCK: PROPS.DEPOSIT_AMOUNT_MOVING_TRUCK,
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
