// Which institute this deployment serves. There is no college selector today — this is the one
// place that decides it, so adding one later means changing this value (or feeding it from the
// selector) instead of hunting down institute names in the markup.
export const INSTITUTE = {
  key: 'lauda',
  short: 'LU',
  name: 'Lauda University',
  // Sign-in domain shown to the reader and passed to Google as the `hd` hint. This is the real
  // domain of the accounts Google verifies, so it does not follow the display name above. The
  // backend keeps its own allow-list, so this must stay in step with it.
  domain: 'iiitd.ac.in',
};

// The product keeps its own name; the institute only qualifies the descriptor beneath it.
export const PRODUCT_NAME = 'Kaju Katli';
export const DASHBOARD_TITLE = `${INSTITUTE.short} Placement Dashboard`;
export const DOCUMENT_TITLE = `${PRODUCT_NAME} · ${DASHBOARD_TITLE}`;
