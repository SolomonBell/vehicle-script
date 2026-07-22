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
      const signerEmail = data.signerEmail;
      Logger.log('Lease signed by: ' + signerEmail);
      if (signerEmail) markLeaseSigned(signerEmail);
      return ContentService.createTextOutput(JSON.stringify({ received: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Handle Stripe payment event
    const customerEmail = data.customerEmail;
    const amountPaid    = data.amountPaid;
    Logger.log('doPost received: ' + customerEmail + ' / $' + amountPaid);

    if (customerEmail) {
      markDepositPaid(customerEmail, amountPaid);
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
  return ContentService.createTextOutput('Reliable Storage webhook endpoint is live.')
    .setMimeType(ContentService.MimeType.TEXT);
}


// ============================================================
// MARK DEPOSIT PAID
// ============================================================
function markDepositPaid(customerEmail, amountPaid) {
  const sheet = getSheet();
  const data  = sheet.getDataRange().getValues();

  let matched = false;
  for (let i = 1; i < data.length; i++) {
    const rowEmail   = (data[i][2] || '').toLowerCase().trim();
    const depositCol = data[i][6]; // G

    if (rowEmail === customerEmail.toLowerCase().trim() && depositCol !== 'Yes') {
      sheet.getRange(i + 1, 7).setValue('Yes');
      sheet.getRange(i + 1, 8).setValue(amountPaid);
      matched = true;

      const name        = data[i][1];
      const email       = data[i][2];
      const phone       = data[i][3];
      const secondEmail = data[i][12] || '';
      const startTime   = new Date(data[i][4]);
      const dateStr     = formatDateTime(startTime);
      const leaseSent   = data[i][9];

      if (leaseSent !== 'Yes' && email !== 'No Email') {
        try {
          const firstName = name.split(' ')[0];

          // SMS confirmation
          const customerSms =
            'Reliable Storage: Your $' + amountPaid + ' deposit is confirmed for ' + dateStr + '! ' +
            'Your rental agreement will arrive by email shortly for e-signature. ' +
            'Questions? Call or text us.';

          // HTML email confirmation
          const customerEmailHtml =
            '<p>Hi ' + name + ',</p>' +
            '<p>Your <strong>$' + amountPaid + ' deposit</strong> is confirmed for your truck rental on <strong>' + dateStr + '</strong>.</p>' +
            '<p>Your rental agreement will be emailed to you shortly for e-signature — please watch for it and sign promptly.</p>' +
            '<p>You will also receive a reminder 24 hours before your pickup with pre-trip inspection instructions.</p>' +
            '<p>Questions? Reply to this email or call us.</p>' +
            '<p>— Reliable Storage</p>';

          if (phone !== 'No Phone') sendSms(phone, customerSms);
          sendEmailHtml(email, 'Deposit confirmed — ' + dateStr, customerEmailHtml);

          // Send lease via DocuSeal
          sendLeaseViaDocuSeal(name, email, secondEmail, dateStr);

          sheet.getRange(i + 1, 10).setValue('Yes');
          Logger.log('Deposit confirmed and lease sent for: ' + email);

        } catch(e) {
          alertAdmin('markDepositPaid error for ' + email, e.toString());
        }
      }
      break;
    }
  }

  if (!matched) {
    Logger.log('No unmatched booking found for: ' + customerEmail);
    alertAdmin('Stripe payment -- no booking match',
      'Paid email: ' + customerEmail + ' ($' + amountPaid + '). Check sheet manually.');
  }
}

// ============================================================
// MARK LEASE SIGNED
// ============================================================
function markLeaseSigned(signerEmail) {
  const sheet = getSheet();
  const data  = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const rowEmail    = (data[i][2] || '').toLowerCase().trim();
    const leaseSigned = data[i][13]; // N: Lease Signed

    if (rowEmail === signerEmail.toLowerCase().trim() && leaseSigned !== 'Yes') {
      sheet.getRange(i + 1, 14).setValue('Yes');
      Logger.log('Lease signed marked for: ' + signerEmail);
      return;
    }
  }
  Logger.log('No booking found for lease signer: ' + signerEmail);
}
