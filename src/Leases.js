// ============================================================
// ENGINE 2: LEASE CATCH-UP
// ============================================================
function sendLeaseToNewBookings() {
  const sheet = getSheet();
  const data  = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const depositPaid = data[i][6];
    const leaseSent   = data[i][9];
    const email       = data[i][2];
    const name        = data[i][1];
    const secondEmail = data[i][12] || '';
    const startTime   = new Date(data[i][4]);
    const dateStr     = formatDateTime(startTime);

    const approved = data[i][14]; // O: Rental Approved
    if (approved === 'Denied' || approved === '') continue; // denied or pending — skip
    if (depositPaid === 'Yes' && leaseSent !== 'Yes' && email !== 'No Email'
        && (approved === 'Approved - Free' || approved === 'Approved - Paid')) {
      try {
        sendLeaseViaDocuSeal(name, email, secondEmail, dateStr);
        sheet.getRange(i + 1, 10).setValue('Yes');
        Logger.log('Catch-up lease sent via DocuSeal for: ' + email);
      } catch(e) {
        alertAdmin('sendLeaseToNewBookings error for ' + email, e.toString());
      }
    }
  }
}
