import 'dotenv/config';
import app from './app.js';
import { PORT } from './config.js';
import { setDbReady } from './ready.js';
import { ensureDefaultViewerCredentials } from './auth.js';
import { ensureOfferBackfill, initDb } from './db.js';
import { startPlacementCalendarAutoSync } from './calendar-sync.js';

// This deployment runs as a bare `node` process with no supervisor, so an escaped rejection
// or exception must not take the site down for everyone. Log loudly and keep serving.
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL-ish] Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[FATAL-ish] Uncaught exception:', err);
});

const start = async () => {
  app.listen(PORT, () => {
    console.log(`API running on http://localhost:${PORT}`);
  });

  let dbReady = false;
  while (!dbReady) {
    try {
      await initDb();
      await ensureDefaultViewerCredentials();
      dbReady = true;
      setDbReady(true);
      console.log('Database initialized successfully');
      startPlacementCalendarAutoSync();
    } catch (err) {
      console.error('Failed to connect to DB, retrying in 10s...', err.message);
      await new Promise(res => setTimeout(res, 10000));
    }
  }

  // Backfill offers for legacy rows seeded before offers table existed
  try {
    await ensureOfferBackfill();
  } catch (err) {
    console.error('Offer backfill skipped:', err.message);
  }
};

start();
