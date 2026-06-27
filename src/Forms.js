// ============================================================
// PRE-FILLED URL BUILDERS
// ============================================================
function buildIntakeUrl(name, email, phone, rentalDate) {
  const base = CONFIG.INTAKE_FORM_BASE;
  // Use MM/DD/YYYY format which Google Forms date fields expect
  const date = formatDateForForm(rentalDate);
  return base
    + '?usp=pp_url'
    + '&entry.' + CONFIG.INTAKE_ENTRY_NAME  + '=' + encodeURIComponent(name)
    + '&entry.' + CONFIG.INTAKE_ENTRY_EMAIL + '=' + encodeURIComponent(email)
    + '&entry.' + CONFIG.INTAKE_ENTRY_PHONE + '=' + encodeURIComponent(phone)
    + '&entry.' + CONFIG.INTAKE_ENTRY_DATE  + '=' + encodeURIComponent(date);
}

function testBuildIntakeUrl() {
  const sheet = getSheet();
  const data  = sheet.getDataRange().getValues();

  let row = null;
  for (let i = 1; i < data.length; i++) {
    if ((data[i][1] || '').toString().toLowerCase().includes('test customer')) {
      row = data[i];
      break;
    }
  }

  if (!row) {
    Logger.log('No row found with name containing "Test Customer". Add one to the sheet first.');
    return;
  }

  const name      = row[1];
  const email     = row[2];
  const phone     = (row[3] || '').toString().replace(/^'/, '');
  const startTime = new Date(row[4]);

  Logger.log('Name:  ' + name);
  Logger.log('Email: ' + email);
  Logger.log('Phone: ' + phone);
  Logger.log('Date:  ' + startTime);

  const url = buildIntakeUrl(name, email, phone, startTime);
  Logger.log('Intake URL: ' + url);
}

function buildInspectUrl(name, email, rentalDate, type) {
  const base    = CONFIG.INSPECT_FORM_BASE;
  const date    = formatDate(rentalDate);
  const typeVal = type === 'pre' ? CONFIG.INSPECT_VAL_PRE : CONFIG.INSPECT_VAL_POST;
  return base
    + '?usp=pp_url'
    + '&entry.' + CONFIG.INSPECT_ENTRY_NAME  + '=' + encodeURIComponent(name)
    + '&entry.' + CONFIG.INSPECT_ENTRY_EMAIL + '=' + encodeURIComponent(email)
    + '&entry.' + CONFIG.INSPECT_ENTRY_DATE  + '=' + encodeURIComponent(date)
    + '&entry.' + CONFIG.INSPECT_ENTRY_TYPE  + '=' + encodeURIComponent(typeVal);
}
