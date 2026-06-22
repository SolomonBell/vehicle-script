// ============================================================
// DOCUSEAL -- SEND LEASE FOR E-SIGNATURE
// ============================================================
function sendLeaseViaDocuSeal(name, email, secondEmail, dateStr) {
  const hasTwoDrivers = secondEmail &&
                        secondEmail !== 'No Second Email' &&
                        secondEmail !== '';

  const templateId = hasTwoDrivers
    ? CONFIG.DOCUSEAL_TEMPLATE_TWO_DRIVERS
    : CONFIG.DOCUSEAL_TEMPLATE_SINGLE;

  // Build submitters array — role names must match template exactly
  const submitters = [
    {
      role:  hasTwoDrivers ? 'Driver #1' : 'Driver',
      email: email,
      name:  name
    }
  ];

  if (hasTwoDrivers) {
    submitters.push({
      role:  'Driver #2',
      email: secondEmail,
      name:  'Second Driver'
    });
  }

  // Manager must sign both template types
  if (CONFIG.MANAGER_EMAIL) {
    submitters.push({
      role:  'Reliable Storage Manager',
      email: CONFIG.MANAGER_EMAIL,
      name:  'Reliable Storage'
    });
  }

  const payload = {
    template_id: templateId,
    send_email:  true,
    message: {
      subject: 'Your Reliable Storage Rental Agreement -- ' + dateStr,
      body:    'Hi ' + name + ', please review and sign your truck rental agreement.\n\nClick here to sign: {{submitter.link}}\n\nThank you!'
    },
    submitters: submitters
  };

  const options = {
    method:  'post',
    headers: {
      'X-Auth-Token': CONFIG.DOCUSEAL_KEY,
      'Content-Type': 'application/json'
    },
    payload:            JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const resp = UrlFetchApp.fetch('https://api.docuseal.com/submissions', options);

  if (resp.getResponseCode() >= 400) {
    throw new Error('DocuSeal error: ' + resp.getContentText());
  }

  Logger.log('DocuSeal lease sent to: ' + email +
             (hasTwoDrivers ? ' and ' + secondEmail : ''));
  return JSON.parse(resp.getContentText());
}
