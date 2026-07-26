import React, { useState } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { ThemeToggle } from './ui';
import { DASHBOARD_TITLE, INSTITUTE, PRODUCT_NAME } from '../institute';

const LoginScreen = ({ assetBase, onSuccess, onError, onViewerLogin, error, pending, themeMode, onToggleTheme }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  return (
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
          <span><i>02</i> Verified with Google or viewer credentials</span>
          <span><i>03</i> Built for internal, responsible use</span>
        </div>
      </div>

      <aside className="access-card" aria-labelledby="access-heading">
        <div className="access-card-image" style={{ backgroundImage: `url(${assetBase}institute18-3.jpg)` }}>
          <span>Community access</span>
        </div>
        <div className="access-card-body">
          <span className="eyebrow">Verified access</span>
          <h2 id="access-heading">Continue with IIITD Google</h2>
          <p>Use your <strong>@{INSTITUTE.domain}</strong> account to view the placement data.</p>
          {error && <div className="error-text access-error" role="alert">{error}</div>}
          <div className={pending ? 'google-login-wrap is-pending' : 'google-login-wrap'}>
            <GoogleLogin
              onSuccess={onSuccess}
              onError={onError}
              useOneTap={false}
              auto_select={false}
              button_auto_select={false}
              use_fedcm_for_button={false}
              hd={INSTITUTE.domain}
              ux_mode="popup"
              text="signin_with"
            />
          </div>
          <div className="access-divider"><span>or use viewer access</span></div>
          <form
            className="viewer-login-form"
            onSubmit={(event) => {
              event.preventDefault();
              onViewerLogin({ username, password });
            }}
          >
            <p>Contact the developer for a viewer username and password.</p>
            <label>
              Username
              <input
                type="text"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                disabled={pending}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={pending}
                required
              />
            </label>
            <button type="submit" disabled={pending}>{pending ? 'Verifying...' : 'Continue as viewer'}</button>
          </form>
          {pending && <span className="verification-status">Verifying access...</span>}
          <div className="privacy-note">
            <strong>Viewer access is read-only and cannot grant admin permissions.</strong>
            <span>Google email addresses are checked only for eligibility and are not stored.</span>
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
      <p><strong>Important:</strong> this is an unofficial student side project. It is not operated by, endorsed by, or a substitute for the {INSTITUTE.name} Placement Office.</p>
      <span>Use the information responsibly and report genuine discrepancies to yash25091@iiitd.ac.in.</span>
    </footer>
    </main>
  );
};

export { LoginScreen };
