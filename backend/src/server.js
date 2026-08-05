import 'dotenv/config';
import app from './app.js';
import { PORT, SITE_TAKEDOWN } from './config.js';
import { setDbReady } from './ready.js';
import { deleteAppSettings, ensureOfferBackfill, initDb } from './db.js';
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
      // Shared viewer username/password sign-in is gone; drop the stored credentials so no
      // hash survives in the database.
      await deleteAppSettings(['viewer_username', 'viewer_password_hash']);
      dbReady = true;
      setDbReady(true);
      console.log('Database initialized successfully');
      // A suspended site should not keep pushing calendar-change notifications to people who
      // can no longer open it.
      if (SITE_TAKEDOWN) {
        console.log('SITE_TAKEDOWN is on: Placement Calendar auto-sync and its notifications are paused.');
      } else {
        startPlacementCalendarAutoSync();
      }
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
