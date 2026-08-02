// ============================================================
// SMS via Twilio
// ============================================================
// fromPhone is the Twilio sender number (E.164). All callers must pass the
// location-specific PHONE_<LOCATION> value from getLocationConfig(). There is
// no fallback — a missing fromPhone will produce a Twilio "From is required" error
// so the omission surfaces immediately rather than silently using the wrong number.
function sendSms(toPhone, message, fromPhone) {
  const url = 'https://api.twilio.com/2010-04-01/Accounts/' + CONFIG.TWILIO_SID + '/Messages.json';
  const options = {
    method:  'post',
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(CONFIG.TWILIO_SID + ':' + CONFIG.TWILIO_TOKEN) },
    payload: { To: toPhone, From: fromPhone, Body: message },
    muteHttpExceptions: true
  };
  const resp = UrlFetchApp.fetch(url, options);
  if (resp.getResponseCode() >= 400) {
    throw new Error('Twilio error: ' + resp.getContentText());
  }
}


// ============================================================
// EMAIL via SendGrid (HTML)
// ============================================================
// Builds the SendGrid `personalizations` recipient block for one email: the
// primary recipient (`to`), plus a BCC to the manager unless suppressed via
// suppressManagerBcc, or the email is already addressed to the manager or
// admin (avoids a redundant copy). Pulled out into its own pure function so
// this can be verified directly -- e.g. that the manager appears nowhere in
// the recipient data (not even BCC) for a specific message -- without
// needing to intercept the SendGrid API call itself. See
// testInspectionEmailsExcludeManagerFromRecipients() in SandboxTests.js.
function buildEmailPersonalization_(toEmail, suppressManagerBcc) {
  const personalization = { to: [{ email: toEmail }] };
  if (!suppressManagerBcc &&
      CONFIG.MANAGER_EMAIL &&
      toEmail !== CONFIG.MANAGER_EMAIL &&
      toEmail !== CONFIG.ADMIN_EMAIL) {
    personalization.bcc = [{ email: CONFIG.MANAGER_EMAIL }];
  }
  return personalization;
}

// fromEmail and replyToEmail are the location-specific EMAIL_<LOCATION> value.
// Both default to the global CONFIG values when not provided — used only by
// alertAdmin() which has no booking location context.
//
// suppressManagerBcc (optional, default false/undefined): when true, the
// manager is not added as To, CC, or BCC on this email, no matter what
// toEmail is. Every existing call site omits this argument, so the manager
// BCC behavior is unchanged everywhere except where a caller explicitly
// opts in -- currently only the pre-trip inspection customer email
// (Reminders.js), because the blank pre-trip inspection form must never
// reach the manager, including by BCC, before the customer submits it.
function sendEmailHtml(toEmail, subject, htmlBody, fromEmail, replyToEmail, suppressManagerBcc) {
  const from    = fromEmail    || CONFIG.FROM_EMAIL;
  const replyTo = replyToEmail || CONFIG.REPLY_TO_EMAIL;
  const url = 'https://api.sendgrid.com/v3/mail/send';

  const personalization = buildEmailPersonalization_(toEmail, suppressManagerBcc);

  const payload = {
    personalizations: [personalization],
    from:     { email: from, name: CONFIG.FROM_NAME },
    reply_to: { email: replyTo, name: CONFIG.FROM_NAME },
    subject:  subject,
    content:  [{ type: 'text/html', value: htmlBody }]
  };
  const options = {
    method:  'post',
    headers: {
      Authorization:  'Bearer ' + CONFIG.SENDGRID_KEY,
      'Content-Type': 'application/json'
    },
    payload:            JSON.stringify(payload),
    muteHttpExceptions: true
  };
  const resp = UrlFetchApp.fetch(url, options);
  if (resp.getResponseCode() >= 400) {
    throw new Error('SendGrid error: ' + resp.getContentText());
  }
}


function alertAdmin(subject, body) {
  Logger.log('[ALERT] ' + subject + ': ' + body);
  try {
    sendEmailHtml(
      CONFIG.ADMIN_EMAIL,
      '[Rental Script] ' + subject,
      '<p>' + body.replace(/\n/g, '<br>') + '</p>'
    );
  } catch(e) {
    Logger.log('Could not send admin alert: ' + e.toString());
  }
}
