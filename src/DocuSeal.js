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
      role:  'Reliable Storage Manager', // must match DocuSeal template role name exactly
      email: CONFIG.MANAGER_EMAIL,
      name:  CONFIG.FROM_NAME
    });
  }

  const payload = {
    template_id: templateId,
    send_email:  true,
    message: {
      subject: 'Your ' + CONFIG.FROM_NAME + ' Rental Agreement -- ' + dateStr,
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

// Extracts the submission ID from a DocuSeal API response.
// The DocuSeal API response shape is not documented in this repo. This function
// logs top-level response keys (not values) so one live sandbox submission can
// confirm the exact field path. The most likely field is response.id per REST
// convention. If the response shape differs, update this function after reviewing
// the logged keys.
function extractDocuSealSubmissionId(response) {
  if (!response || typeof response !== 'object') {
    Logger.log('Warning: DocuSeal response is missing or not an object.');
    return null;
  }
  // Log keys only — no values logged here, so no sensitive data is exposed.
  Logger.log('DocuSeal response top-level keys: ' + Object.keys(response).join(', '));
  const id = response.id;
  if (id == null) {
    Logger.log('Warning: DocuSeal response has no "id" field. Check log for key list to find correct path.');
    return null;
  }
  return id;
}
