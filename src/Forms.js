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
