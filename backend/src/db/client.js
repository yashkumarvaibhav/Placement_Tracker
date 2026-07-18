import { Pool } from 'pg';
import dns from 'dns/promises';


// We will initialize this lazily to allow async DNS resolution
let pool = null;

const getPool = async () => {
  if (pool) return pool;

  const defaultPort = Number(process.env.PGPORT || 6543);
  const fallbackPort = defaultPort === 6543 ? 5432 : 6543;

  // Configuration for the pool
  // Note: We will use these settings for the "Test" pool directly.
  // We won't re-create the pool, so we ensure these settings are production-ready.
  const baseConfig = {
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000, // Generous timeout for the initial connect
    idleTimeoutMillis: 30000,
    max: 4,
  };

  let resolvedPoolerIPs = [];

  // 1. Resolve IPs for the Pooler (Force IPv4)
  if (process.env.PGHOSTADDR) {
    resolvedPoolerIPs = [process.env.PGHOSTADDR];
  } else {
    try {
      console.log(`[DB] Resolving Pooler DNS (IPv4) for ${process.env.PGHOST}...`);
      const addresses = await dns.resolve4(process.env.PGHOST);
      if (addresses && addresses.length > 0) {
        resolvedPoolerIPs = addresses;
      }
    } catch (err) {
      console.warn('[DB] DNS Resolution failed (Pooler):', err.message);
    }
  }

  const candidates = [];

  // Group A: Pooler IPs (Try both ports)
  for (const ip of resolvedPoolerIPs) {
    candidates.push({ ip, port: defaultPort, label: 'Pooler(PRI)' });
    candidates.push({ ip, port: fallbackPort, label: 'Pooler(SEC)' });
  }

  // Fallback: If no IPs resolved, try hostname
  if (candidates.length === 0) {
    candidates.push({ host: process.env.PGHOST, port: defaultPort, label: 'Pooler(DNS)' });
  }

  // 2. Race/Failover Logic
  for (const candidate of candidates) {
    const targetDesc = candidate.host ? candidate.host : candidate.ip;
    console.log(`[DB] Testing connection to [${candidate.label}] ${targetDesc} on PORT ${candidate.port}...`);

    const candidateConfig = {
      ...baseConfig,
      port: candidate.port,
    };
    if (candidate.ip) candidateConfig.hostaddr = candidate.ip;
    if (candidate.host) candidateConfig.host = candidate.host;

    const testPool = new Pool(candidateConfig);

    // Add an error handler to preventing crashing during the test phase
    testPool.on('error', (err) => {
      // Silently catch errors on the pool during testing, we'll handle them in the try/catch block
    });

    try {
      const client = await testPool.connect();
      // If we are here, we connected!
      client.release();
      console.log(`[DB] Connection VALIDATED on ${targetDesc}:${candidate.port}! Keeping this connection.`);

      // CRITICAL CHANGE: We keep this pool. We do NOT destroy it.
      // Reuse the already-active pool to avoid a second handshake.

      pool = testPool;

      // Update error handler for production use
      pool.removeAllListeners('error');
      pool.on('error', (err) => {
        console.error('[DB] Unexpected error on idle client', err);
        // Do NOT set pool = null immediately, let the pool handle its own recovery if possible,
        // unless it's a fatal error. But for now, just logging is safer to prevent churn.
      });

      return pool;
    } catch (err) {
      console.warn(`[DB] Failed ${candidate.label} ${targetDesc}:${candidate.port}: ${err.message}`);
      await testPool.end(); // Clean up the failed pool
    }
  }

  console.error('[DB] All connection candidates failed.');
  throw new Error('Could not connect to any DB candidate.');
};

const query = async (text, params = []) => {
  let retries = 0;
  const maxRetries = 3;
  while (true) {
    try {
      const p = await getPool();
      const result = await p.query(text, params);
      return result;
    } catch (err) {
      if (retries < maxRetries) {
        retries++;
        console.error(`[DB] Query failed, retrying (${retries}/${maxRetries})...`, err.message);

        // Only reset the global pool if the error is severe (connection related)
        if (err.message.includes('timeout') || err.message.includes('closed') || err.message.includes('refused')) {
          if (pool) {
            try { await pool.end(); } catch (e) { }
            pool = null; // Force a fresh connection hunt next time
          }
        }

        // Quadratic backoff
        await new Promise(res => setTimeout(res, 1000 * Math.pow(2, retries - 1)));
      } else {
        throw err;
      }
    }
  }
};

const transaction = async (callback) => {
  const p = await getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// Multi-statement writes run on a transaction client so they commit or roll back as a unit
// and never go through query()'s retry loop (retrying a non-idempotent write that actually
// landed would duplicate it). Reads outside transactions keep the retrying query().
const runOn = (client) => (text, params = []) => (client ? client.query(text, params) : query(text, params));


export { query, transaction, runOn };

export const closeDb = async () => {
  if (pool) await pool.end();
};
