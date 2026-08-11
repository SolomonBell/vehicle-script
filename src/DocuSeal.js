// ============================================================
// DOCUSEAL -- SEND LEASE FOR E-SIGNATURE
// ------------------------------------------------------------
// additionalDriverName / additionalDriverEmail come from the Bookings sheet
// columns M and N (Additional Driver Name / Additional Driver Email -- see
// processIntakeFormSubmission_() in Forms.js), which are authoritative once
// the intake form has been submitted. additionalDriverEmail may also be an
// earlier, Calendar-description-derived fallback value if the intake form
// has not been submitted yet (see syncCalendarBookings() in CalendarSync.js)
// -- but DocuSeal is never actually sent until intake is complete (column W
// = 'Yes', enforced by isDocuSealEligible() at every call site), so by the
// time this function runs, additionalDriverEmail has always gone through
// the validated intake write whenever it holds a real email: intake
// validation requires a nonblank additionalDriverName alongside any
// nonblank additionalDriverEmail (see Forms.js), so the two are never
// expected to disagree about whether a second driver exists.
// ============================================================
function sendLeaseViaDocuSeal(name, email, additionalDriverName, additionalDriverEmail, startTime, endTime, vehicleType, location) {
  // Fail closed: a lease must never be created without the required
  // Reliable Storage Manager co-signer. getLocationConfig() throws for an
  // unrecognized location, same as every other caller of this function.
  const locCfg = getLocationConfig(location);
  if (!locCfg.managerEmail) {
    const msg = 'sendLeaseViaDocuSeal: no manager email configured for location "' + location +
      '" (see MANAGER_EMAIL_<LOCATION> in Script Properties) -- refusing to send a lease without ' +
      'the required Reliable Storage Manager signer.';
    Logger.log(msg);
    alertAdmin('DocuSeal lease blocked -- missing manager email for ' + location,
      'Location: ' + location + '\n' +
      'Customer: ' + name + ' (' + email + ')\n\n' +
      'No manager e-mail is configured for this location (see MANAGER_EMAIL_<LOCATION> in Script ' +
      'Properties). The lease was NOT sent -- it would be missing the required manager co-signer. ' +
      'Set the missing Script Property and resend.');
    throw new Error(msg);
  }

  const hasTwoDrivers = additionalDriverEmail &&
                        additionalDriverEmail !== 'No Second Email' &&
                        additionalDriverEmail !== '';

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
    // additionalDriverName is expected to be non-blank here -- see the
    // function-level comment above. Deliberately NOT substituted with a
    // placeholder like the old hardcoded 'Second Driver' if it somehow is
    // blank (e.g. a pre-migration booking whose second-driver email came
    // only from the Calendar description and was never confirmed by an
    // intake submission): sending whatever is actually known, including
    // blank, and letting a DocuSeal validation error surface loudly via
    // alertAdmin (see the callers of this function) is safer than silently
    // pretending a name is known when it is not.
    submitters.push({
      role:  'Driver #2',
      email: additionalDriverEmail,
      name:  additionalDriverName
    });
  }

  // Manager must sign both template types. locCfg.managerEmail is guaranteed
  // non-blank here -- the fail-closed check at the top of this function
  // already threw before building any submitters if it were missing.
  submitters.push({
    role:  'Reliable Storage Manager', // must match DocuSeal template role name exactly
    email: locCfg.managerEmail,
    name:  CONFIG.FROM_NAME,
  });

  const payload = {
    template_id: templateId,
    send_email:  true,
    message: {
      subject: 'Your ' + CONFIG.COMPANY_NAME + ' rental agreement for ' + dateStr,
      // DocuSeal message.body is plain text — HTML tags are displayed literally.
      // {{submitter.link}} is substituted by DocuSeal with the signing URL.
      // This message is shared across all submitters (customer, second driver,
      // and the Reliable Storage Manager submitter), so the wording below is
      // written to make sense for anyone who receives it: it explains that a
      // signature is required from this recipient specifically, and that the
      // rental cannot proceed for the customer until every required signature,
      // including the manager's, is complete.
      body: 'Hi ' + name + ',\n\n' +
            'A ' + CONFIG.COMPANY_NAME + ' rental agreement is ready for your review and signature.\n\n' +
            'Please open the link below, review the details, and sign electronically. ' +
            'The rental cannot proceed until every required signer, including the Reliable ' +
            'Storage manager, has signed.\n\n' +
            (vehicleType ? 'Vehicle: '  + vehicleType + '\n' : '') +
            (location   ? 'Location: ' + location   + '\n' : '') +
            'Pickup: '    + dateStr + '\n' +
            'Sign here: {{submitter.link}}\n\n' +
            'Please complete this before the scheduled pickup.\n\n' +
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
             (hasTwoDrivers ? ' and ' + additionalDriverEmail + ' (' + additionalDriverName + ')' : ''));
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
