// ============================================================
// DOCUSEAL -- SEND LEASE FOR E-SIGNATURE
// ============================================================
function sendLeaseViaDocuSeal(name, email, secondEmail, startTime, endTime, vehicleType, location) {
  const hasTwoDrivers = secondEmail &&
                        secondEmail !== 'No Second Email' &&
                        secondEmail !== '';

  const templateId = hasTwoDrivers
    ? CONFIG.DOCUSEAL_TEMPLATE_TWO_DRIVERS
    : CONFIG.DOCUSEAL_TEMPLATE_SINGLE;

  const dateStr         = formatDateTime(startTime);
  const reservationDate = formatDate(startTime);
  const returnDateTime  = formatDateTime(endTime);

  // Build submitters array — role names must match template exactly
  const submitters = [
    {
      role:   'Driver #1',
      email:  email,
      name:   name,
      values: {
        storage_location: location,
        vehicle_type:     vehicleType,
        reservation_date: reservationDate,
        pickup_datetime:  dateStr,
        return_datetime:  returnDateTime,
      }
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
      name:  CONFIG.FROM_NAME,
    });
  }

  const payload = {
    template_id: templateId,
    send_email:  true,
    message: {
      subject: 'Your ' + CONFIG.COMPANY_NAME + ' rental agreement — ' + dateStr,
      // DocuSeal message.body is plain text — HTML tags are displayed literally.
      // {{submitter.link}} is substituted by DocuSeal with the signing URL.
      body: 'Hi ' + name + ',\n\n' +
            'Please review and sign your ' + CONFIG.COMPANY_NAME + ' rental agreement.\n\n' +
            (vehicleType ? 'Vehicle: '  + vehicleType + '\n' : '') +
            (location   ? 'Location: ' + location   + '\n' : '') +
            'Pickup: '    + dateStr + '\n' +
            'Sign here: {{submitter.link}}\n\n' +
            'Please complete the agreement before your scheduled pickup.\n\n' +
            'Thank you,\n' +
            CONFIG.COMPANY_NAME
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

// Extracts the shared submission ID from a DocuSeal API response.
// The /submissions endpoint returns an array of submitter objects, one per
// submitter. Each element carries submission_id (the shared identifier) and
// id (the per-submitter identifier). This function prefers submission_id /
// submission.id over the per-submitter id, and returns null if IDs conflict.
function extractDocuSealSubmissionId(response) {
  if (!response || typeof response !== 'object') {
    Logger.log('extractDocuSealSubmissionId: response is missing or not an object (got ' + typeof response + ')');
    return null;
  }

  const isArray = Array.isArray(response);
  Logger.log('extractDocuSealSubmissionId: isArray=' + isArray +
             (isArray ? ', length=' + response.length
                      : ', keys=[' + Object.keys(response).join(', ') + ']'));

  if (isArray) {
    response.forEach(function(item, idx) {
      if (!item || typeof item !== 'object') {
        Logger.log('  [' + idx + ']: not an object');
        return;
      }
      Logger.log('  [' + idx + '] keys: ' + Object.keys(item).join(', '));
      Logger.log('  [' + idx + '] id=' + item.id +
                 ', submission_id=' + item.submission_id +
                 ', submitter_id=' + item.submitter_id +
                 ', submission.id=' + (item.submission && item.submission.id != null
                                       ? item.submission.id : '(none)'));
    });
  } else {
    Logger.log('  id=' + response.id +
               ', submission_id=' + response.submission_id +
               ', submitter_id=' + response.submitter_id +
               ', submission.id=' + (response.submission && response.submission.id != null
                                     ? response.submission.id : '(none)'));
  }

  // ---- Single object ----
  if (!isArray) {
    if (response.id != null)                                   return response.id;
    if (response.submission_id != null)                        return response.submission_id;
    if (response.submission && response.submission.id != null) return response.submission.id;
    Logger.log('extractDocuSealSubmissionId: no id field found in object response');
    return null;
  }

  // ---- Array of submitter objects ----
  // Collect the shared submission ID from each element.
  // submission_id and submission.id are the shared identifier;
  // item.id is the per-submitter ID and is intentionally not used here.
  const ids = [];
  response.forEach(function(item) {
    if (!item || typeof item !== 'object') return;
    if (item.submission_id != null) {
      ids.push(item.submission_id);
    } else if (item.submission && item.submission.id != null) {
      ids.push(item.submission.id);
    }
  });

  if (ids.length === 0) {
    Logger.log('extractDocuSealSubmissionId: no submission_id found in any array element');
    return null;
  }

  const unique = ids.filter(function(id, i, arr) { return arr.indexOf(id) === i; });
  if (unique.length > 1) {
    Logger.log('extractDocuSealSubmissionId: WARNING — conflicting submission IDs: ' +
               unique.join(', ') + ' — returning null');
    return null;
  }

  return ids[0];
}
