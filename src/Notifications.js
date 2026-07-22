// ============================================================
// SMS via Twilio
// ============================================================
// All texts are sent FROM CONFIG.TWILIO_NUM, so every customer message and
// manager alert already shows up in that number's threads in the App — no
// separate "copy the manager" send is needed (Twilio rejects To == From).
function sendSms(toPhone, message) {
  const url = 'https://api.twilio.com/2010-04-01/Accounts/' + CONFIG.TWILIO_SID + '/Messages.json';
  const options = {
    method:  'post',
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(CONFIG.TWILIO_SID + ':' + CONFIG.TWILIO_TOKEN) },
    payload: { To: toPhone, From: CONFIG.TWILIO_NUM, Body: message },
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
function sendEmailHtml(toEmail, subject, htmlBody) {
  const url = 'https://api.sendgrid.com/v3/mail/send';

  // Build the recipient block. The manager is BCC'd on every customer-facing
  // message so she can keep track of what customers receive. We skip the BCC
  // when the email is already addressed to her (approval/booking notices) or
  // to the admin (alert emails) to avoid redundant copies.
  const personalization = { to: [{ email: toEmail }] };
  if (CONFIG.MANAGER_EMAIL &&
      toEmail !== CONFIG.MANAGER_EMAIL &&
      toEmail !== CONFIG.ADMIN_EMAIL) {
    personalization.bcc = [{ email: CONFIG.MANAGER_EMAIL }];
  }

  const payload = {
    personalizations: [personalization],
    from:     { email: CONFIG.FROM_EMAIL, name: CONFIG.FROM_NAME },
    reply_to: { email: CONFIG.REPLY_TO_EMAIL, name: CONFIG.FROM_NAME },
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
