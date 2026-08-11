// ============================================================
// STRIPE WEBHOOK RECEIVER
// ============================================================
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // ---- Shared-secret validation --------------------------------
    // WEBHOOK_SHARED_SECRET must be set in Script Properties.
    // Pipedream includes the same value as data.secret in every POST.
    const expectedSecret = PROPS.WEBHOOK_SHARED_SECRET;
    if (!expectedSecret) {
      throw new Error('Setup error: WEBHOOK_SHARED_SECRET is not set in Script Properties.');
    }
    if (!data.secret || data.secret !== expectedSecret) {
      Logger.log('doPost rejected: missing or invalid secret.');
      return ContentService.createTextOutput(JSON.stringify({ received: false }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // -------------------------------------------------------------

    // Handle DocuSeal lease signed event
    if (data.type === 'lease_signed') {
      const submissionId = data.submissionId || null;
      const signerEmail  = data.signerEmail  || null;
      // signerRole is read and logged only -- it is NOT used in any decision
      // below. Deciding which signer is the final required customer signer
      // (Driver #1 alone for a one-driver lease, Driver #2 after Driver #1
      // for a two-driver lease) is done upstream, in the deployed Pipedream
      // DocuSeal workflow -- see "Final signing-completion logic" in
      // docs/setup-notes.md. By the time a lease_signed POST reaches here,
      // Pipedream has already filtered out the manager's signature, the
      // non-final driver's signature on a two-driver lease, and DocuSeal's
      // submission.completed event, so markLeaseSigned() below can safely
      // mark the row signed on this call alone.
      const signerRole   = data.signerRole   || null;
      Logger.log('Lease signed — role: ' + signerRole +
                 ', email: ' + signerEmail +
                 (submissionId ? ', submissionId: ' + submissionId : ', no submissionId'));
      if (signerEmail || submissionId) markLeaseSigned(submissionId, signerEmail);
      return ContentService.createTextOutput(JSON.stringify({ received: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Handle Stripe payment event
    const customerEmail = data.customerEmail;
    const amountPaid    = data.amountPaid;
    const encodedEventId = data.eventId || null;

    let eventId = null;
    if (encodedEventId) {
      try {
        const padded = encodedEventId + '==='.slice(0, (4 - encodedEventId.length % 4) % 4);
        eventId = Utilities.newBlob(Utilities.base64DecodeWebSafe(padded)).getDataAsString();
      } catch (e) {
        Logger.log('doPost: could not decode client_reference_id "' + encodedEventId + '": ' + e);
      }
    }

    Logger.log('doPost received: ' + customerEmail + ' / $' + amountPaid +
               (eventId ? ' / eventId=' + eventId : ' / no eventId'));

    if (customerEmail) {
      markDepositPaid(customerEmail, amountPaid, eventId);
    } else {
      alertAdmin('Stripe webhook -- no email', JSON.stringify(data));
    }

    return ContentService.createTextOutput(JSON.stringify({ received: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch(err) {
    Logger.log('doPost error: ' + err.toString());
    alertAdmin('doPost error', err.toString());
    return ContentService.createTextOutput(JSON.stringify({ received: true }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet() {
  return ContentService.createTextOutput(CONFIG.COMPANY_NAME + ' webhook endpoint is live.')
    .setMimeType(ContentService.MimeType.TEXT);
}


// ============================================================
// MARK DEPOSIT PAID
// ============================================================
function markDepositPaid(customerEmail, amountPaid, eventId) {
  const sheet = getSheet();
  const data  = sheet.getDataRange().getValues();

  // ---- Locate the matching row ----------------------------------------
  // Primary: match by eventId (column A) — unique, no ambiguity.
  // Fallback: match by customerEmail (column C, case-insensitive) — preserves
  //           behavior for rows created before client_reference_id was added.
  let matched    = false;
  let matchedRow = -1;

  if (eventId) {
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === eventId && data[i][6] !== 'Yes') {
        matchedRow = i;
        matched    = true;
        break;
      }
    }
    if (!matched) {
      Logger.log('markDepositPaid: no eventId match for "' + eventId + '" — trying email fallback');
    }
  }

  if (!matched) {
    for (let i = 1; i < data.length; i++) {
      const rowEmail   = (data[i][2] || '').toLowerCase().trim();
      const depositCol = data[i][6]; // G
      if (rowEmail === customerEmail.toLowerCase().trim() && depositCol !== 'Yes') {
        matchedRow = i;
        matched    = true;
        break;
      }
    }
  }

  if (!matched) {
    Logger.log('No unmatched booking found for: ' + customerEmail);
    alertAdmin('Stripe payment -- no booking match',
      'Paid email: ' + customerEmail + ' ($' + amountPaid + '). Check sheet manually.');
    return;
  }

  // ---- Process the matched row ----------------------------------------
  const i = matchedRow;

  sheet.getRange(i + 1, 7).setValue('Yes');
  sheet.getRange(i + 1, 8).setValue(amountPaid);

  const name                  = data[i][1];
  const email                  = data[i][2];
  const phone                  = data[i][3];
  const additionalDriverName   = data[i][12] || ''; // M: Additional Driver Name
  const additionalDriverEmail  = data[i][13] || ''; // N: Additional Driver Email
  const startTime               = new Date(data[i][4]);
  const endTime                 = new Date(data[i][5]);
  const dateStr                 = formatDateTime(startTime);
  const leaseSent               = data[i][9];
  const vehicleType             = data[i][18] || '';  // S: Vehicle Type
  const location                = data[i][19] || '';  // T: Location
  const cancelled                = data[i][26];        // AA: Cancelled
  const locCfg                  = getLocationConfig(location);

  // Deposit Paid / Stripe Amount above are recorded unconditionally --
  // financial history is real regardless of a later cancellation. Only the
  // customer "your rental is proceeding" messaging and the DocuSeal lease
  // send below are gated on cancellation status.
  if (leaseSent !== 'Yes' && email !== 'No Email' && !cancelled) {
    try {
      const firstName       = name.split(' ')[0];
      const intakeCompleted = data[i][22] || ''; // W: Intake Form Completed

      // SMS confirmation
      const customerSms = intakeCompleted === 'Yes'
        ? CONFIG.COMPANY_NAME + ': Your $' + amountPaid + ' deposit is confirmed for your ' +
          vehicleType + ' at ' + location + ' on ' + dateStr + '. ' +
          'Check your email for the rental agreement to sign.'
        : CONFIG.COMPANY_NAME + ': Your $' + amountPaid + ' deposit is confirmed for your ' +
          vehicleType + ' at ' + location + ' on ' + dateStr + '. ' +
          'Please also complete your intake form if you have not already.';

      // HTML email confirmation
      const leaseStatusLine = intakeCompleted === 'Yes'
        ? "You'll receive a rental agreement by email shortly. Please sign it before your pickup."
        : 'Once your intake form is complete, we will send your rental agreement by email for you to sign.';

      const customerEmailHtml =
        '<p>Hi ' + name + ',</p>' +
        '<p>We received your $' + amountPaid + ' deposit for your ' +
        vehicleType + ' rental at our ' + location +
        ' location, scheduled for ' + dateStr + '.</p>' +
        '<p>' + leaseStatusLine + '</p>' +
        (intakeCompleted === 'Yes' ? '' :
          '<p>If you have not already, please complete your intake form using the link from your welcome email.</p>') +
        '<p>We\'ll send a reminder the day before your pickup.</p>' +
        '<p>Reply to this email or call us if you have any questions.</p>' +
        '<p>Thank you,<br>' + CONFIG.COMPANY_NAME + '</p>';

      if (phone !== 'No Phone') {
        try { sendSms(phone, customerSms, locCfg.phone); }
        catch(e) { Logger.log('markDepositPaid: SMS failed for ' + email + ': ' + e); }
      }
      sendEmailHtml(email, 'Deposit confirmed: ' + vehicleType + ' rental on ' + dateStr, customerEmailHtml, locCfg.email, locCfg.email);

      // Send the lease via DocuSeal only once the intake form has also been
      // completed (column W) -- not merely sent (column I). If intake is not
      // yet complete, processIntakeFormSubmission_() sends the lease when it arrives.
      if (isDocuSealEligible('Yes', intakeCompleted, leaseSent)) {
        const docuSealResp = sendLeaseViaDocuSeal(name, email, additionalDriverName, additionalDriverEmail, startTime, endTime, vehicleType, location);
        const submissionId = extractDocuSealSubmissionId(docuSealResp);

        sheet.getRange(i + 1, 10).setValue('Yes'); // J: Lease Sent
        if (submissionId != null) {
          sheet.getRange(i + 1, 21).setValue(submissionId); // U: DocuSeal Submission ID
        }
        Logger.log('Deposit confirmed and lease sent for: ' + email);
      } else {
        Logger.log('Deposit confirmed for ' + email + '; lease withheld until intake form is completed (column W).');
      }

    } catch(e) {
      alertAdmin('markDepositPaid error for ' + email, e.toString());
    }
  } else if (cancelled) {
    Logger.log('markDepositPaid: deposit recorded for cancelled booking ' + email +
               ' -- no confirmation message or lease sent.');
  }
}

// ============================================================
// MARK LEASE SIGNED
// ------------------------------------------------------------
// This workflow now relies on Pipedream to determine the final required
// customer signer before forwarding a lease_signed event -- Driver #1 alone
// for a one-driver lease, Driver #2 (after Driver #1) for a two-driver
// lease, with the manager's signature and DocuSeal's submission.completed
// event both ignored upstream. See "Final signing-completion logic" in
// docs/setup-notes.md for the full per-template rule and the deployed
// Pipedream code. markLeaseSigned() assumes the webhook has already been
// filtered appropriately and therefore simply marks the booking as
// customer-signed on the first matching call, with no per-role check of
// its own.
// ============================================================
function markLeaseSigned(submissionId, signerEmail) {
  const sheet = getSheet();
  const data  = sheet.getDataRange().getValues();

  // Primary lookup: match by DocuSeal Submission ID in column U (index 20).
  // Normalize to string because IDs may arrive as numbers or strings.
  if (submissionId != null) {
    const needle = String(submissionId).trim();
    for (let i = 1; i < data.length; i++) {
      const rowSubId    = String(data[i][20] || '').trim(); // U: DocuSeal Submission ID
      const leaseSigned = data[i][14];                      // O: Lease Signed
      if (rowSubId !== '' && rowSubId === needle && leaseSigned !== 'Yes') {
        sheet.getRange(i + 1, 15).setValue('Yes'); // O: Lease Signed
        Logger.log('Lease signed (by submissionId ' + submissionId + '): row ' + (i + 1));
        return;
      }
    }
    Logger.log('markLeaseSigned: no submissionId match for ' + submissionId + ' — trying email fallback');
  }

  // Fallback: match by email in column C (index 2).
  if (!signerEmail) {
    Logger.log('markLeaseSigned: no submissionId and no signerEmail — cannot match');
    return;
  }
  const emailNeedle = signerEmail.toLowerCase().trim();
  for (let i = 1; i < data.length; i++) {
    const rowEmail    = (data[i][2] || '').toLowerCase().trim(); // C: Email
    const leaseSigned = data[i][14];                             // O: Lease Signed
    if (rowEmail === emailNeedle && leaseSigned !== 'Yes') {
      sheet.getRange(i + 1, 15).setValue('Yes'); // O: Lease Signed
      Logger.log('Lease signed (by email fallback ' + signerEmail + '): row ' + (i + 1));
      return;
    }
  }
  Logger.log('markLeaseSigned: no booking found for submissionId=' + submissionId +
             ', email=' + signerEmail);
}
