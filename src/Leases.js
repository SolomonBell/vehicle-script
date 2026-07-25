// ============================================================
// ENGINE 2: LEASE CATCH-UP
// ============================================================
function sendLeaseToNewBookings() {
  const sheet = getSheet();
  const data  = sheet.getDataRange().getValues();
  Logger.log('sendLeaseToNewBookings: checking ' + (data.length - 1) + ' row(s)');

  for (let i = 1; i < data.length; i++) {
    const depositPaid = data[i][6];
    const leaseSent   = data[i][9];
    const email       = data[i][2];
    const name        = data[i][1];
    const secondEmail = data[i][12] || '';
    const startTime   = new Date(data[i][4]);
    const endTime     = new Date(data[i][5]);
    const vehicleType = data[i][17] || '';  // R: Vehicle Type
    const location    = data[i][18] || '';  // S: Location

    const approved = data[i][14]; // O: Rental Approved
    Logger.log('Row ' + (i + 1) + ': G(DepositPaid)="' + depositPaid +
               '", J(LeaseSent)="' + leaseSent +
               '", O(Approved)="' + approved + '"');

    if (approved === 'Denied' || approved === '') {
      Logger.log('Row ' + (i + 1) + ': SKIP — O="' + approved +
                 '" (need "Approved - Free" or "Approved - Paid")');
      continue; // denied or pending — skip
    }

    if (depositPaid === 'Yes' && leaseSent !== 'Yes' && email !== 'No Email'
        && (approved === 'Approved - Free' || approved === 'Approved - Paid')) {
      Logger.log('Row ' + (i + 1) + ': ELIGIBLE — calling sendLeaseViaDocuSeal() for ' + email);
      try {
        const docuSealResp = sendLeaseViaDocuSeal(name, email, secondEmail, startTime, endTime, vehicleType, location);
        const submissionId = extractDocuSealSubmissionId(docuSealResp);
        Logger.log('Row ' + (i + 1) + ': DocuSeal response submissionId=' + submissionId);

        sheet.getRange(i + 1, 10).setValue('Yes'); // J: Lease Sent
        if (submissionId != null) {
          sheet.getRange(i + 1, 20).setValue(submissionId); // T: DocuSeal Submission ID
        }
        Logger.log('Catch-up lease sent via DocuSeal for: ' + email);
      } catch(e) {
        Logger.log('Row ' + (i + 1) + ': DocuSeal error — ' + e.toString());
        alertAdmin('sendLeaseToNewBookings error for ' + email, e.toString());
      }
    } else {
      const reasons = [];
      if (depositPaid !== 'Yes')   reasons.push('G="' + depositPaid + '" (need "Yes")');
      if (leaseSent === 'Yes')     reasons.push('J="Yes" (already sent)');
      if (email === 'No Email')    reasons.push('C="No Email"');
      if (approved !== 'Approved - Free' && approved !== 'Approved - Paid')
                                   reasons.push('O="' + approved + '" (unrecognized value)');
      Logger.log('Row ' + (i + 1) + ': SKIP — ' + reasons.join('; '));
    }
  }
}
