import React from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { ThemeToggle } from './ui';
import { SiteDisclaimer } from './SiteDisclaimer';
import { DASHBOARD_TITLE, INSTITUTE, PRODUCT_NAME } from '../institute';

const LoginScreen = ({ onSuccess, onError, error, notice, pending, themeMode, onToggleTheme }) => (
    <main className="landing-page">
    <nav className="landing-nav">
      <a className="landing-brand" href="#top" aria-label={`${PRODUCT_NAME} home`}>
        <span><strong>{PRODUCT_NAME}</strong><small>{DASHBOARD_TITLE}</small></span>
      </a>
      <div className="landing-nav-actions">
        <span className="unofficial-pill">Unofficial side project</span>
        <ThemeToggle themeMode={themeMode} onToggle={onToggleTheme} compact />
      </div>
    </nav>

    <section id="top" className="landing-hero">
      <div className="landing-hero-copy">
        <h1>{DASHBOARD_TITLE}</h1>
        <p>Cohort outcomes, recruiter records, and compensation context in one searchable, student-built reference.</p>
        <div className="landing-principles" aria-label="Access and privacy summary">
          <span><i>01</i> Restricted to {INSTITUTE.name} students</span>
          <span><i>02</i> Verified with an institute Google account</span>
          <span><i>03</i> Built for internal, responsible use</span>
        </div>
        <SiteDisclaimer />
      </div>

      <aside className="access-card" aria-labelledby="access-heading">
        <div className="access-card-body">
          <span className="eyebrow">Verified access</span>
          <h2 id="access-heading">Continue with {INSTITUTE.short} Google</h2>
          <p>Use your <strong>@{INSTITUTE.domain}</strong> account to view the placement data.</p>
          {error && <div className="error-text access-error" role="alert">{error}</div>}
          {notice && (
            <div className="access-notice" role="status">
              <strong>{notice.code === 'ACCESS_DENIED' ? 'Access not granted' : 'Waiting for admin approval'}</strong>
              <span>{notice.message}</span>
            </div>
          )}
          <div className={pending ? 'google-login-wrap is-pending' : 'google-login-wrap'}>
            {/* Every prop below other than useOneTap is spread straight into
                google.accounts.id.initialize, which ignores keys it does not know. The domain
                hint is `hosted_domain` there — `hd` is a field on an OAuth token response, not
                an input, so passing it did nothing and the chooser kept offering whichever
                account the browser had signed in first. It is only a hint either way; the
                backend is what actually enforces the domain. */}
            <GoogleLogin
              onSuccess={onSuccess}
              onError={onError}
              useOneTap={false}
              auto_select={false}
              use_fedcm_for_button={false}
              hosted_domain={INSTITUTE.domain}
              ux_mode="popup"
              text="signin_with"
            />
          </div>
          {pending && <span className="verification-status">Verifying access...</span>}
          <div className="privacy-note">
            <strong>Access is read-only and limited to verified {INSTITUTE.name} Google accounts.</strong>
            <span>Your Google address is never shown to viewers. It is used privately to link your roster identity and audit any skill ratings you submit.</span>
          </div>
        </div>
      </aside>
    </section>

    <section className="landing-about" aria-labelledby="about-heading">
      <h2 id="about-heading">What is inside</h2>
      <div className="landing-feature-grid">
        <article><h3>Cohort overview</h3><p>Placement progress and offer composition across batches and programs.</p></article>
        <article><h3>Company directory</h3><p>Recruiters, roles, eligibility, compensation, and recorded hiring footprints.</p></article>
        <article><h3>Student outcomes</h3><p>Searchable internal records with structured offer journeys.</p></article>
      </div>
    </section>

    <footer className="landing-footer">
      <SiteDisclaimer variant="footer" />
    </footer>
    </main>
);

export { LoginScreen };
