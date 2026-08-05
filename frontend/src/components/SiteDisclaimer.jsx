import React from 'react';
import { INSTITUTE, PRODUCT_NAME } from '../institute';

// One canonical wording for the "this is not official data" notice. The landing page and the
// footer on every signed-in page both read from here so the two can never drift apart.
const DISCLAIMER_HEADLINE = `${PRODUCT_NAME} is a personal side project with no affiliation to the ${INSTITUTE.name} Placement Office.`;
const DISCLAIMER_BODY = 'Records are compiled by hand, so some entries may be inconsistent or wrong despite genuine effort to avoid it. Use this only as a reference — it is not an authoritative record of placement outcomes.';
const DISCLAIMER_CONTACT = 'yash25091@iiitd.ac.in';

const SiteDisclaimer = ({ variant = 'panel' }) => (
  <div className={variant === 'panel' ? 'site-disclaimer is-panel' : 'site-disclaimer'}>
    <strong>{DISCLAIMER_HEADLINE}</strong>
    <span>{DISCLAIMER_BODY} Report discrepancies to {DISCLAIMER_CONTACT}.</span>
  </div>
);

const SiteFooter = () => (
  <footer className="site-footer">
    <div className="container">
      <SiteDisclaimer variant="footer" />
    </div>
  </footer>
);

export { SiteDisclaimer, SiteFooter, DISCLAIMER_HEADLINE, DISCLAIMER_BODY, DISCLAIMER_CONTACT };
