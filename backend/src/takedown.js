import { PLACEMENT_ATLAS_HOST, PORTFOLIO_URL, SITE_TAKEDOWN } from './config.js';

const NOTICE_TITLE = 'This website has been taken down.';
const NOTICE_BODY = 'Feel free to visit yashkumarvaibhav.me to view my portfolio/website — whatever is suitable for people like me.';

const isUnder = (path, prefix) => path === prefix || path.startsWith(`${prefix}/`);

// The takedown covers the Placement Atlas hostname, the API on every hostname, and the legacy
// /Placement_Tracker path. It deliberately does NOT cover the portfolio site this same process
// serves at yashkumarvaibhav.me — that is where the notice sends people.
const isSuspended = (req) => req.hostname === PLACEMENT_ATLAS_HOST
  || isUnder(req.path, '/api')
  || isUnder(req.path, '/Placement_Tracker');

const noticePage = () => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Placement Atlas — taken down</title>
    <style>
      :root { color-scheme: light dark; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: #ffffff;
        color: #4d4d4d;
        font-family: Georgia, "Times New Roman", serif;
        line-height: 1.6;
      }
      main { max-width: 34rem; text-align: left; }
      h1 {
        margin: 0 0 1rem;
        font-size: clamp(1.6rem, 5vw, 2.2rem);
        font-weight: 600;
        color: #333333;
        letter-spacing: -0.01em;
      }
      p { margin: 0 0 1.25rem; font-size: 1.05rem; }
      a {
        color: #0b746f;
        text-decoration: none;
        border-bottom: 1px solid rgba(11, 116, 111, 0.35);
      }
      a:hover { border-bottom-color: #0b746f; }
      .rule {
        width: 3rem;
        height: 2px;
        margin: 0 0 1.75rem;
        background: #0b746f;
        border-radius: 2px;
      }
      .fine {
        margin: 0;
        font-size: 0.9rem;
        color: #808080;
        font-family: Arial, "Helvetica Neue", "Segoe UI", sans-serif;
      }
      @media (prefers-color-scheme: dark) {
        body { background: #10191b; color: #d2dada; }
        h1 { color: #f3f6f6; }
        a { color: #7ce4de; border-bottom-color: rgba(124, 228, 222, 0.35); }
        a:hover { border-bottom-color: #7ce4de; }
        .rule { background: #7ce4de; }
        .fine { color: #839193; }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="rule"></div>
      <h1>${NOTICE_TITLE}</h1>
      <p>Feel free to visit <a href="${PORTFOLIO_URL}">yashkumarvaibhav.me</a> to view my portfolio/website — whatever is suitable for people like me.</p>
      <p class="fine">Access to Placement Atlas is suspended for all users.</p>
    </main>
  </body>
</html>
`;

// Mounted ahead of every route: nothing behind it runs, so no landing page, no sign-in, and no
// data endpoint is reachable while the takedown is on.
export const takedownGate = (req, res, next) => {
  if (!SITE_TAKEDOWN || !isSuspended(req)) return next();

  // no-store keeps Cloudflare and browsers from holding on to the notice after the site returns.
  res.set('Cache-Control', 'no-store');
  res.status(503);

  if (isUnder(req.path, '/api')) {
    return res.json({ message: `${NOTICE_TITLE} ${NOTICE_BODY}` });
  }
  return res.type('html').send(noticePage());
};

export default takedownGate;
