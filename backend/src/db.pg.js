import { Pool } from 'pg';
import dns from 'dns/promises';
import {
  DEFAULT_BATCH_KEY,
  getBatchConfig,
  getCycleConfig,
  getBranchGroup,
  normalizeBatchPayload,
} from './batches.js';
import {
  isCombinedOfferType,
  isFullTimeOfferType,
  isInternshipOfferType,
  isPlacementQualifyingOfferType,
  isSummerInternOfferType,
} from './offer-types.js';


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

const normalizeProgram = (programRaw = '') => {
  const normalized = programRaw.trim().toUpperCase();
  if (normalized.startsWith('CSE R')) return 'CSE-R';
  if (normalized.startsWith('CSE')) return 'CSE';
  if (normalized.startsWith('ECE')) return 'ECE';
  if (normalized.startsWith('CB')) return 'CB';
  return programRaw || 'CSE';
};

export const initDb = async () => {
  await query(`CREATE TABLE IF NOT EXISTS companies (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT,
      type TEXT CHECK(type IN ('Intern','FTE','Intern+FTE','Summer Intern + FTE','Summer Intern + PPO','Summer Intern','Intern + PPO')),
      ctc DOUBLE PRECISION,
      stipend DOUBLE PRECISION,
      category TEXT,
      eligible_cgpa DOUBLE PRECISION,
      backlog_allowed BOOLEAN DEFAULT false,
      registration_deadline TEXT,
      registration_open_date TEXT,
      offer_date TEXT,
      branches TEXT[],
      roles JSONB,
      batch_key TEXT,
      degree TEXT,
      graduation_year INTEGER
    );`);

  await query(`CREATE TABLE IF NOT EXISTS students (
      id BIGSERIAL PRIMARY KEY,
      roll_number TEXT NOT NULL,
      name TEXT NOT NULL,
      program TEXT NOT NULL,
      placement_status TEXT CHECK(placement_status IN ('Placed','Unplaced','Ineligible','Not Sitting')) NOT NULL,
      company_id BIGINT REFERENCES companies(id),
      offer_type TEXT,
      ctc DOUBLE PRECISION,
      stipend DOUBLE PRECISION,
      registration_deadline TEXT,
      offer_date TEXT,
      batch_key TEXT,
      degree TEXT,
      graduation_year INTEGER
    );`);

  await query(`CREATE TABLE IF NOT EXISTS offers (
      id BIGSERIAL PRIMARY KEY,
      student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      company_id BIGINT NOT NULL REFERENCES companies(id),
      offer_type TEXT,
      role TEXT,
      ctc DOUBLE PRECISION,
      stipend DOUBLE PRECISION,
      registration_deadline TEXT,
      offer_date TEXT
    );`);

  await query(`CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`);

  await query(`CREATE TABLE IF NOT EXISTS placement_calendar_snapshots (
      id BIGSERIAL PRIMARY KEY,
      version INTEGER UNIQUE NOT NULL,
      source_spreadsheet_id TEXT NOT NULL,
      source_sheet_id INTEGER,
      source_sheet_title TEXT,
      source_range TEXT,
      content_hash TEXT UNIQUE NOT NULL,
      total_row_count INTEGER NOT NULL DEFAULT 0,
      visible_row_count INTEGER NOT NULL DEFAULT 0,
      hidden_row_count INTEGER NOT NULL DEFAULT 0,
      total_event_count INTEGER NOT NULL DEFAULT 0,
      visible_event_count INTEGER NOT NULL DEFAULT 0,
      hidden_event_count INTEGER NOT NULL DEFAULT 0,
      raw_snapshot JSONB NOT NULL,
      summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`);

  await query(`CREATE TABLE IF NOT EXISTS placement_calendar_rows (
      id BIGSERIAL PRIMARY KEY,
      snapshot_id BIGINT NOT NULL REFERENCES placement_calendar_snapshots(id) ON DELETE CASCADE,
      source_row_index INTEGER NOT NULL,
      source_row_number INTEGER NOT NULL,
      row_hash TEXT NOT NULL,
      hidden_by_user BOOLEAN NOT NULL DEFAULT false,
      hidden_by_filter BOOLEAN NOT NULL DEFAULT false,
      hidden BOOLEAN NOT NULL DEFAULT false,
      display_values JSONB NOT NULL,
      cells JSONB NOT NULL,
      normalized JSONB NOT NULL DEFAULT '{}'::jsonb,
      raw_row JSONB NOT NULL DEFAULT '{}'::jsonb,
      UNIQUE(snapshot_id, source_row_index)
    );`);

  await query(`CREATE TABLE IF NOT EXISTS placement_calendar_events (
      id BIGSERIAL PRIMARY KEY,
      snapshot_id BIGINT NOT NULL REFERENCES placement_calendar_snapshots(id) ON DELETE CASCADE,
      row_id BIGINT REFERENCES placement_calendar_rows(id) ON DELETE SET NULL,
      source_row_number INTEGER NOT NULL,
      event_hash TEXT NOT NULL,
      title TEXT,
      company TEXT,
      event_type TEXT,
      starts_on DATE,
      ends_on DATE,
      deadline_on DATE,
      status TEXT,
      batches TEXT[],
      branches TEXT[],
      notes TEXT,
      hidden BOOLEAN NOT NULL DEFAULT false,
      raw_event JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`);

  await query('CREATE INDEX IF NOT EXISTS idx_offers_student_id ON offers(student_id);');
  await query('CREATE INDEX IF NOT EXISTS idx_offers_company_id ON offers(company_id);');
  // One offer per (student, company) is an application rule; enforce it in the schema.
  // Dedupe first so the unique index can build on legacy data (keep the oldest row).
  await query(`DELETE FROM offers a USING offers b
     WHERE a.student_id = b.student_id AND a.company_id = b.company_id AND a.id > b.id;`);
  await query('CREATE UNIQUE INDEX IF NOT EXISTS uniq_offers_student_company ON offers(student_id, company_id);');
  await query('CREATE INDEX IF NOT EXISTS idx_calendar_snapshots_created_at ON placement_calendar_snapshots(created_at DESC);');
  await query('CREATE INDEX IF NOT EXISTS idx_calendar_rows_snapshot_id ON placement_calendar_rows(snapshot_id);');
  await query('CREATE INDEX IF NOT EXISTS idx_calendar_events_snapshot_id ON placement_calendar_events(snapshot_id);');
  await query('ALTER TABLE companies ADD COLUMN IF NOT EXISTS batch_key TEXT;');
  await query('ALTER TABLE companies ADD COLUMN IF NOT EXISTS degree TEXT;');
  await query('ALTER TABLE companies ADD COLUMN IF NOT EXISTS graduation_year INTEGER;');
  await query('ALTER TABLE companies ADD COLUMN IF NOT EXISTS reported_offer_count INTEGER;');
  await query('ALTER TABLE companies ADD COLUMN IF NOT EXISTS registration_open_date TEXT;');
  await query('ALTER TABLE companies ADD COLUMN IF NOT EXISTS branches TEXT[];');
  await query('ALTER TABLE companies ADD COLUMN IF NOT EXISTS roles JSONB;');
  await query('ALTER TABLE offers ADD COLUMN IF NOT EXISTS role TEXT;');
  await query('ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_type_check;');
  await query(`ALTER TABLE companies ADD CONSTRAINT companies_type_check
    CHECK(type IN ('Intern','FTE','Intern+FTE','Summer Intern + FTE','Summer Intern + PPO','Summer Intern','Intern + PPO'));`);
  await query('ALTER TABLE students ADD COLUMN IF NOT EXISTS batch_key TEXT;');
  await query('ALTER TABLE students ADD COLUMN IF NOT EXISTS degree TEXT;');
  await query('ALTER TABLE students ADD COLUMN IF NOT EXISTS graduation_year INTEGER;');
  await query('ALTER TABLE students DROP CONSTRAINT IF EXISTS students_roll_number_key;');
  await query('ALTER TABLE students DROP CONSTRAINT IF EXISTS students_placement_status_check;');
  await query(`ALTER TABLE students
    ADD CONSTRAINT students_placement_status_check
    CHECK(placement_status IN ('Placed','Unplaced','Ineligible','Not Sitting'));`);
  await query(`UPDATE companies
    SET batch_key = COALESCE(batch_key, 'mtech-2026'),
        degree = COALESCE(degree, 'M.Tech'),
        graduation_year = COALESCE(graduation_year, 2026)`);
  await query(`UPDATE students
    SET batch_key = COALESCE(batch_key, 'mtech-2026'),
        degree = COALESCE(degree, 'M.Tech'),
        graduation_year = COALESCE(graduation_year, 2026)`);
  await query('CREATE INDEX IF NOT EXISTS idx_companies_batch_key ON companies(batch_key);');
  await query('CREATE INDEX IF NOT EXISTS idx_students_batch_key ON students(batch_key);');
  await query('CREATE UNIQUE INDEX IF NOT EXISTS idx_students_batch_roll_unique ON students(batch_key, roll_number);');
};

export const getAppSettings = async (keys) => {
  const { rows } = await query(
    'SELECT key, value FROM app_settings WHERE key = ANY($1::text[])',
    [keys],
  );
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
};

export const setAppSettings = async (settings) => {
  const entries = Object.entries(settings);
  if (!entries.length) return;

  const placeholders = entries
    .map((_, index) => `($${index * 2 + 1}, $${index * 2 + 2}, NOW())`)
    .join(', ');
  const values = entries.flatMap(([key, value]) => [key, value]);

  await query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ${placeholders}
     ON CONFLICT (key) DO UPDATE
     SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    values,
  );
};

const calendarSnapshotSelect = `
  SELECT
    id,
    version,
    source_spreadsheet_id,
    source_sheet_id,
    source_sheet_title,
    source_range,
    content_hash,
    total_row_count,
    visible_row_count,
    hidden_row_count,
    total_event_count,
    visible_event_count,
    hidden_event_count,
    summary,
    created_at
  FROM placement_calendar_snapshots
`;

const normalizeCalendarSnapshot = (row) => row ? ({
  ...row,
  total_row_count: Number(row.total_row_count || 0),
  visible_row_count: Number(row.visible_row_count || 0),
  hidden_row_count: Number(row.hidden_row_count || 0),
  total_event_count: Number(row.total_event_count || 0),
  visible_event_count: Number(row.visible_event_count || 0),
  hidden_event_count: Number(row.hidden_event_count || 0),
}) : null;

export const listPlacementCalendarSnapshots = async (limit = 30) => {
  const { rows } = await query(
    `${calendarSnapshotSelect}
     ORDER BY version DESC
     LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 30, 1), 100)],
  );
  return rows.map(normalizeCalendarSnapshot);
};

export const getLatestPlacementCalendarSnapshot = async () => {
  const { rows } = await query(
    `${calendarSnapshotSelect}
     ORDER BY version DESC
     LIMIT 1`,
  );
  return normalizeCalendarSnapshot(rows[0]);
};

export const getPreviousPlacementCalendarSnapshotId = async (snapshotId) => {
  const { rows } = await query(
    `SELECT previous.id
     FROM placement_calendar_snapshots current
     JOIN placement_calendar_snapshots previous ON previous.version < current.version
     WHERE current.id = $1
     ORDER BY previous.version DESC
     LIMIT 1`,
    [snapshotId],
  );
  return rows[0]?.id || null;
};

export const getPlacementCalendarSnapshot = async (id) => {
  const snapshotResult = await query(
    `${calendarSnapshotSelect}
     WHERE id = $1`,
    [id],
  );
  const snapshot = normalizeCalendarSnapshot(snapshotResult.rows[0]);
  if (!snapshot) return null;

  const [rowsResult, eventsResult, rawResult] = await Promise.all([
    query(
      `SELECT
        id,
        source_row_index,
        source_row_number,
        row_hash,
        hidden_by_user,
        hidden_by_filter,
        hidden,
        display_values AS values,
        cells,
        normalized,
        raw_row
       FROM placement_calendar_rows
       WHERE snapshot_id = $1
       ORDER BY source_row_index ASC`,
      [id],
    ),
    query(
      `SELECT
        id,
        row_id,
        source_row_number,
        event_hash,
        title,
        company,
        event_type,
        starts_on,
        ends_on,
        deadline_on,
        status,
        batches,
        branches,
        notes,
        hidden,
        raw_event,
        created_at
       FROM placement_calendar_events
       WHERE snapshot_id = $1
       ORDER BY COALESCE(starts_on, deadline_on) NULLS LAST, source_row_number ASC`,
      [id],
    ),
    query(
      'SELECT raw_snapshot FROM placement_calendar_snapshots WHERE id = $1',
      [id],
    ),
  ]);

  return {
    ...snapshot,
    raw_snapshot: rawResult.rows[0]?.raw_snapshot || {},
    rows: rowsResult.rows,
    events: eventsResult.rows,
  };
};

const cellState = (row, columnIndex) => {
  const cell = Array.isArray(row.cells) ? row.cells[columnIndex] : null;
  return {
    value: Array.isArray(row.values) ? row.values[columnIndex] || '' : '',
    effective: cell?.effective ?? null,
    entered: cell?.entered ?? null,
    formula: cell?.formula || null,
    hyperlink: cell?.hyperlink || null,
    note: cell?.note || null,
    format: cell?.format || null,
    row_hidden: !!row.hidden,
  };
};

const stableCellState = (state) => JSON.stringify({
  value: state.value,
  formula: state.formula,
  hyperlink: state.hyperlink,
  note: state.note,
  row_hidden: state.row_hidden,
});

export const getPlacementCalendarCellHistory = async (snapshotId) => {
  const snapshotResult = await query(
    'SELECT id, version FROM placement_calendar_snapshots WHERE id = $1',
    [snapshotId],
  );
  const target = snapshotResult.rows[0];
  if (!target) return null;

  const { rows } = await query(
    `SELECT
      s.id AS snapshot_id,
      s.version,
      s.created_at,
      r.source_row_number,
      r.hidden,
      r.display_values AS values,
      r.cells
     FROM placement_calendar_snapshots s
     JOIN placement_calendar_rows r ON r.snapshot_id = s.id
     WHERE s.version <= $1
     ORDER BY s.version ASC, r.source_row_number ASC`,
    [target.version],
  );

  const historyByCell = new Map();
  for (const row of rows) {
    const columnCount = Math.max(
      Array.isArray(row.values) ? row.values.length : 0,
      Array.isArray(row.cells) ? row.cells.length : 0,
    );

    for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
      const state = cellState(row, columnIndex);
      const key = `${row.source_row_number}:${columnIndex}`;
      const history = historyByCell.get(key) || [];
      const signature = stableCellState(state);
      const latest = history[history.length - 1];
      if (!latest || latest.signature !== signature) {
        history.push({
          snapshot_id: row.snapshot_id,
          version: row.version,
          created_at: row.created_at,
          value: state.value,
          effective: state.effective,
          entered: state.entered,
          formula: state.formula,
          hyperlink: state.hyperlink,
          note: state.note,
          format: state.format,
          row_hidden: state.row_hidden,
          signature,
        });
      }
      historyByCell.set(key, history);
    }
  }

  return Object.fromEntries([...historyByCell.entries()].map(([key, history]) => [
    key,
    history.map(({ signature, ...item }) => item),
  ]));
};

export const createPlacementCalendarSnapshot = async ({
  source,
  content_hash: contentHash,
  raw_snapshot: rawSnapshot,
  summary = {},
  rows = [],
  events = [],
}) => {
  const existing = await query(
    `${calendarSnapshotSelect}
     WHERE content_hash = $1`,
    [contentHash],
  );
  if (existing.rows[0]) {
    return { created: false, snapshot: normalizeCalendarSnapshot(existing.rows[0]) };
  }

  return transaction(async (client) => {
    const versionResult = await client.query(
      'SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM placement_calendar_snapshots',
    );
    const version = versionResult.rows[0].next_version;
    const visibleRows = rows.filter((row) => !row.hidden).length;
    const hiddenRows = rows.length - visibleRows;
    const visibleEvents = events.filter((event) => !event.hidden).length;
    const hiddenEvents = events.length - visibleEvents;

    const snapshotResult = await client.query(
      `INSERT INTO placement_calendar_snapshots (
        version,
        source_spreadsheet_id,
        source_sheet_id,
        source_sheet_title,
        source_range,
        content_hash,
        total_row_count,
        visible_row_count,
        hidden_row_count,
        total_event_count,
        visible_event_count,
        hidden_event_count,
        raw_snapshot,
        summary
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb)
       RETURNING *`,
      [
        version,
        source.spreadsheet_id,
        source.sheet_id,
        source.sheet_title,
        source.source_range,
        contentHash,
        rows.length,
        visibleRows,
        hiddenRows,
        events.length,
        visibleEvents,
        hiddenEvents,
        JSON.stringify(rawSnapshot),
        JSON.stringify(summary),
      ],
    );

    const snapshot = snapshotResult.rows[0];
    const rowIdsByNumber = new Map();
    for (const row of rows) {
      const rowResult = await client.query(
        `INSERT INTO placement_calendar_rows (
          snapshot_id,
          source_row_index,
          source_row_number,
          row_hash,
          hidden_by_user,
          hidden_by_filter,
          hidden,
          display_values,
          cells,
          normalized,
          raw_row
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb)
         RETURNING id`,
        [
          snapshot.id,
          row.source_row_index,
          row.source_row_number,
          row.row_hash,
          !!row.hidden_by_user,
          !!row.hidden_by_filter,
          !!row.hidden,
          JSON.stringify(row.values || []),
          JSON.stringify(row.cells || []),
          JSON.stringify(row.normalized || {}),
          JSON.stringify(row.raw_row || {}),
        ],
      );
      rowIdsByNumber.set(row.source_row_number, rowResult.rows[0].id);
    }

    for (const event of events) {
      await client.query(
        `INSERT INTO placement_calendar_events (
          snapshot_id,
          row_id,
          source_row_number,
          event_hash,
          title,
          company,
          event_type,
          starts_on,
          ends_on,
          deadline_on,
          status,
          batches,
          branches,
          notes,
          hidden,
          raw_event
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9::date, $10::date, $11, $12, $13, $14, $15, $16::jsonb)`,
        [
          snapshot.id,
          rowIdsByNumber.get(event.source_row_number) || null,
          event.source_row_number,
          event.event_hash,
          event.title,
          event.company,
          event.event_type,
          event.starts_on,
          event.ends_on,
          event.deadline_on,
          event.status,
          event.batches || [],
          event.branches || [],
          event.notes,
          !!event.hidden,
          JSON.stringify(event.raw_event || {}),
        ],
      );
    }

    return { created: true, snapshot: normalizeCalendarSnapshot(snapshot) };
  });
};

const comparableRowState = (row) => JSON.stringify({
  values: row.values || [],
  cells: (row.cells || []).map((cell) => ({
    formula: cell?.formula || null,
    hyperlink: cell?.hyperlink || null,
    note: cell?.note || null,
  })),
});

const diffRows = (baseRows, targetRows) => {
  const baseByNumber = new Map(baseRows.map((row) => [row.source_row_number, row]));
  const targetByNumber = new Map(targetRows.map((row) => [row.source_row_number, row]));
  const added = [];
  const removed = [];
  const changed = [];
  const hiddenChanged = [];

  for (const row of targetRows) {
    const base = baseByNumber.get(row.source_row_number);
    if (!base) {
      added.push(row);
      continue;
    }
    if (comparableRowState(base) !== comparableRowState(row)) {
      changed.push({ before: base, after: row });
    }
    if (base.hidden !== row.hidden || base.hidden_by_user !== row.hidden_by_user || base.hidden_by_filter !== row.hidden_by_filter) {
      hiddenChanged.push({ before: base, after: row });
    }
  }

  for (const row of baseRows) {
    if (!targetByNumber.has(row.source_row_number)) removed.push(row);
  }

  return {
    summary: {
      added: added.length,
      removed: removed.length,
      changed: changed.length,
      hidden_changed: hiddenChanged.length,
    },
    added,
    removed,
    changed,
    hidden_changed: hiddenChanged,
  };
};

export const diffPlacementCalendarSnapshots = async (baseSnapshotId, targetSnapshotId) => {
  const [base, target] = await Promise.all([
    getPlacementCalendarSnapshot(baseSnapshotId),
    getPlacementCalendarSnapshot(targetSnapshotId),
  ]);
  if (!base || !target) return null;
  return {
    base: normalizeCalendarSnapshot(base),
    target: normalizeCalendarSnapshot(target),
    rows: diffRows(base.rows || [], target.rows || []),
  };
};

const backfillOffers = async () => {
  const { rows } = await query(
    `SELECT s.id as student_id, s.company_id, s.offer_type, s.ctc, s.stipend, s.registration_deadline, s.offer_date
     FROM students s
     WHERE s.company_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM offers o WHERE o.student_id = s.id)`
  );

  for (const row of rows) {
    await query(
      `INSERT INTO offers (student_id, company_id, offer_type, ctc, stipend, registration_deadline, offer_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        row.student_id,
        row.company_id,
        row.offer_type || null,
        row.ctc ?? null,
        row.stipend ?? null,
        row.registration_deadline || null,
        row.offer_date || null,
      ]
    );
  }
};

export const listCompanies = async (batchKey = DEFAULT_BATCH_KEY) => {
  const resolvedBatch = getBatchConfig(batchKey);
  const { rows } = await query('SELECT * FROM companies WHERE batch_key = $1 ORDER BY name ASC', [resolvedBatch.key]);
  return rows;
};

// Companies are cycle-scoped: a cycle is a graduation year spanning both degrees.
export const listCompaniesByCycle = async (graduationYear) => {
  const { rows } = await query('SELECT * FROM companies WHERE graduation_year = $1 ORDER BY name ASC', [graduationYear]);
  return rows;
};

export const getCompany = async (id) => {
  const { rows } = await query('SELECT * FROM companies WHERE id = $1', [id]);
  return rows[0];
};

export const createCompany = async (payload) => {
  const batchData = normalizeBatchPayload(payload);
  const { rows } = await query(
    `INSERT INTO companies (name, role, type, ctc, stipend, category, eligible_cgpa, backlog_allowed, registration_deadline, registration_open_date, offer_date, branches, roles, batch_key, degree, graduation_year)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING *`,
    [
      payload.name,
      payload.role || '',
      payload.type || null,
      payload.ctc ?? null,
      payload.stipend ?? null,
      payload.category || null,
      payload.eligible_cgpa ?? null,
      payload.backlog_allowed ? true : false,
      payload.registration_deadline || null,
      payload.registration_open_date || null,
      payload.offer_date || null,
      Array.isArray(payload.branches) && payload.branches.length ? payload.branches : null,
      Array.isArray(payload.roles) && payload.roles.length ? JSON.stringify(payload.roles) : null,
      batchData.batch_key,
      batchData.degree,
      batchData.graduation_year,
    ]
  );
  return rows[0];
};

export const updateCompany = async (id, payload) => {
  const batchData = normalizeBatchPayload(payload);
  const { rows } = await query(
    `UPDATE companies SET name=$1, role=$2, type=$3, ctc=$4, stipend=$5, category=$6, eligible_cgpa=$7, backlog_allowed=$8, registration_deadline=$9, registration_open_date=$10, offer_date=$11, branches=$12, roles=$13, batch_key=$14, degree=$15, graduation_year=$16
     WHERE id=$17 RETURNING *`,
    [
      payload.name,
      payload.role || '',
      payload.type || null,
      payload.ctc ?? null,
      payload.stipend ?? null,
      payload.category || null,
      payload.eligible_cgpa ?? null,
      payload.backlog_allowed ? true : false,
      payload.registration_deadline || null,
      payload.registration_open_date || null,
      payload.offer_date || null,
      Array.isArray(payload.branches) && payload.branches.length ? payload.branches : null,
      Array.isArray(payload.roles) && payload.roles.length ? JSON.stringify(payload.roles) : null,
      batchData.batch_key,
      batchData.degree,
      batchData.graduation_year,
      id,
    ]
  );
  return rows[0];
};

// Companies are referenced by offers and by students' denormalized primary-offer columns,
// neither with ON DELETE rules — deleting a referenced company violates the FK. Callers use
// this to refuse the delete with a clear message instead.
export const countCompanyReferences = async (id) => {
  const { rows } = await query(
    `SELECT
       (SELECT COUNT(*) FROM offers WHERE company_id = $1) AS offer_count,
       (SELECT COUNT(*) FROM students WHERE company_id = $1) AS student_count`,
    [id]
  );
  return {
    offers: Number(rows[0]?.offer_count) || 0,
    students: Number(rows[0]?.student_count) || 0,
  };
};

export const deleteCompany = async (id) => {
  await query('DELETE FROM companies WHERE id=$1', [id]);
};

const fetchStudentWithCompanies = async ({ studentId = null, batchKey = DEFAULT_BATCH_KEY, graduationYear = null, client = null } = {}) => {
  const run = runOn(client);
  const params = [];
  const whereParts = [];

  if (graduationYear !== null) {
    // Cycle scope: all students of a graduation year, across both degrees.
    params.push(graduationYear);
    whereParts.push(`s.graduation_year = $${params.length}`);
  } else if (batchKey) {
    params.push(getBatchConfig(batchKey).key);
    whereParts.push(`s.batch_key = $${params.length}`);
  }

  if (studentId !== null) {
    params.push(studentId);
    whereParts.push(`s.id = $${params.length}`);
  }

  const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

  const { rows: students } = await run(
    `SELECT s.*, c.name as company_name, c.category as company_category, c.type as company_type, c.ctc as company_ctc, c.stipend as company_stipend
     FROM students s
     LEFT JOIN companies c ON s.company_id = c.id
     ${whereClause}
     ORDER BY s.roll_number ASC`,
    params
  );

  const studentIds = students.map((s) => s.id);
  if (!studentIds.length) {
    return students.map((s) => ({ ...s, offers: [], branch_group: getBranchGroup(s.program) }));
  }

  const { rows: offers } = await run(
    `SELECT o.*, co.name as company_name, co.category as company_category, co.type as company_type, co.ctc as company_ctc, co.stipend as company_stipend
     FROM offers o
     JOIN companies co ON o.company_id = co.id
     WHERE o.student_id = ANY($1::bigint[])`,
    [studentIds]
  );

  const offersByStudent = offers.reduce((acc, offer) => {
    acc[offer.student_id] = acc[offer.student_id] || [];
    acc[offer.student_id].push(offer);
    return acc;
  }, {});

  return students.map((s) => ({ ...s, offers: offersByStudent[s.id] || [], branch_group: getBranchGroup(s.program) }));
};

export const listStudents = (batchKey = DEFAULT_BATCH_KEY) => fetchStudentWithCompanies({ batchKey });

export const listStudentsByCycle = (graduationYear) => fetchStudentWithCompanies({ graduationYear, batchKey: null });

export const getStudent = async (id, client = null) => {
  const students = await fetchStudentWithCompanies({ studentId: id, batchKey: null, client });
  return students[0];
};

// Diff-based sync of a student's offers: rows for companies that stay keep their ids (other
// features hold offer ids across edits, e.g. the PPO conversion), removed companies are
// deleted, new ones inserted. Incoming offers are deduped per company to match the schema's
// unique (student_id, company_id) rule.
const replaceOffers = async (studentId, offers = [], client = null) => {
  const run = runOn(client);
  const incoming = [];
  const seen = new Set();
  for (const offer of offers) {
    if (!offer.company_id || seen.has(String(offer.company_id))) continue;
    seen.add(String(offer.company_id));
    incoming.push(offer);
  }

  const { rows: existing } = await run('SELECT id, company_id FROM offers WHERE student_id = $1', [studentId]);
  const existingByCompany = new Map(existing.map((row) => [String(row.company_id), row.id]));

  for (const offer of incoming) {
    const fields = [
      offer.offer_type || null,
      offer.role || null,
      offer.ctc ?? null,
      offer.stipend ?? null,
      offer.registration_deadline || null,
      offer.offer_date || null,
    ];
    const existingId = existingByCompany.get(String(offer.company_id));
    if (existingId) {
      await run(
        'UPDATE offers SET offer_type=$1, role=$2, ctc=$3, stipend=$4, registration_deadline=$5, offer_date=$6 WHERE id=$7',
        [...fields, existingId]
      );
    } else {
      await run(
        `INSERT INTO offers (student_id, company_id, offer_type, role, ctc, stipend, registration_deadline, offer_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [studentId, offer.company_id, ...fields]
      );
    }
  }

  const removedIds = existing.filter((row) => !seen.has(String(row.company_id))).map((row) => row.id);
  if (removedIds.length) {
    await run('DELETE FROM offers WHERE id = ANY($1::bigint[])', [removedIds]);
  }
};

// Offers are decoupled from placement_status: a placed student keeps all offers, while a
// non-placed student keeps only non-qualifying offers (e.g. a summer internship) as recorded
// outcomes. Because the admin form doesn't manage offers for non-placed students, an
// offer-less payload must not erase a stored summer internship — fall back to the student's
// existing non-qualifying offers in that case.
const resolveStudentOffers = async (id, payload, isPlaced, client = null) => {
  if (isPlaced) return payload.offers || [];
  const incoming = (payload.offers || []).filter(
    (offer) => !isPlacementQualifyingOfferType(offer.offer_type)
  );
  if (incoming.length) return incoming;
  if (id == null) return [];
  const existing = await getStudent(id, client);
  return (existing?.offers || []).filter(
    (offer) => !isPlacementQualifyingOfferType(offer.offer_type)
  );
};

// Resolves the offers to persist plus the denormalized "primary offer" columns on the student
// row. For placed students these mirror the form's primary fields (unchanged); for non-placed
// students they mirror a retained non-qualifying offer, if any.
const buildStudentWrite = async (id, payload, client = null) => {
  const isPlaced = payload.placement_status === 'Placed';
  const offers = await resolveStudentOffers(id, payload, isPlaced, client);
  const primary = offers[0] || null;
  return {
    offers,
    company_id: isPlaced ? (payload.offers?.[0]?.company_id || payload.company_id || null) : (primary?.company_id || null),
    offer_type: isPlaced ? (payload.offers?.[0]?.offer_type || payload.offer_type || null) : (primary?.offer_type || null),
    ctc: isPlaced ? (payload.ctc ?? null) : (primary?.ctc ?? null),
    stipend: isPlaced ? (payload.stipend ?? null) : (primary?.stipend ?? null),
    registration_deadline: isPlaced ? (payload.registration_deadline || null) : (primary?.registration_deadline || null),
    offer_date: isPlaced ? (payload.offer_date || null) : (primary?.offer_date || null),
  };
};

export const createStudent = async (payload) => transaction(async (client) => {
  const write = await buildStudentWrite(null, payload, client);
  const batchData = normalizeBatchPayload(payload);

  const { rows } = await client.query(
    `INSERT INTO students (roll_number, name, program, placement_status, company_id, offer_type, ctc, stipend, registration_deadline, offer_date, batch_key, degree, graduation_year)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id`,
    [
      payload.roll_number,
      payload.name,
      normalizeProgram(payload.program),
      payload.placement_status,
      write.company_id,
      write.offer_type,
      write.ctc,
      write.stipend,
      write.registration_deadline,
      write.offer_date,
      batchData.batch_key,
      batchData.degree,
      batchData.graduation_year,
    ]
  );

  const studentId = rows[0]?.id;
  await replaceOffers(studentId, write.offers, client);
  return getStudent(studentId, client);
});

export const updateStudent = async (id, payload) => transaction(async (client) => {
  const write = await buildStudentWrite(id, payload, client);
  const batchData = normalizeBatchPayload(payload);

  await client.query(
    `UPDATE students SET roll_number=$1, name=$2, program=$3, placement_status=$4, company_id=$5, offer_type=$6, ctc=$7, stipend=$8, registration_deadline=$9, offer_date=$10, batch_key=$11, degree=$12, graduation_year=$13
     WHERE id=$14`,
    [
      payload.roll_number,
      payload.name,
      normalizeProgram(payload.program),
      payload.placement_status,
      write.company_id,
      write.offer_type,
      write.ctc,
      write.stipend,
      write.registration_deadline,
      write.offer_date,
      batchData.batch_key,
      batchData.degree,
      batchData.graduation_year,
      id,
    ]
  );

  await replaceOffers(id, write.offers, client);
  return getStudent(id, client);
});

// Attaches a single offer (e.g. added from a company's page) to a student and reconciles
// placement_status per policy: a qualifying offer (FTE/PPO/winter Intern) marks the student
// Placed; a summer-intern-only offer leaves their status unchanged. Never downgrades.
export const addOfferToStudent = async (studentId, offer) => transaction(async (client) => {
  const existing = await client.query(
    'SELECT 1 FROM offers WHERE student_id = $1 AND company_id = $2 LIMIT 1',
    [studentId, offer.company_id]
  );
  if (existing.rows.length) throw new Error('This student already has an offer from this company');

  await client.query(
    `INSERT INTO offers (student_id, company_id, offer_type, role, ctc, stipend, registration_deadline, offer_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      studentId,
      offer.company_id,
      offer.offer_type || null,
      offer.role || null,
      offer.ctc ?? null,
      offer.stipend ?? null,
      offer.registration_deadline || null,
      offer.offer_date || null,
    ]
  );

  const refreshed = await getStudent(studentId, client);
  const offers = refreshed?.offers || [];
  const qualifying = offers.find((o) => isPlacementQualifyingOfferType(o.offer_type));
  if (qualifying && refreshed.placement_status !== 'Placed') {
    await client.query(
      `UPDATE students SET placement_status='Placed', company_id=$1, offer_type=$2, ctc=$3, stipend=$4, registration_deadline=$5, offer_date=$6 WHERE id=$7`,
      [qualifying.company_id, qualifying.offer_type, qualifying.ctc ?? null, qualifying.stipend ?? null, qualifying.registration_deadline || null, qualifying.offer_date || null, studentId]
    );
  } else if (!refreshed.company_id && offers.length) {
    const primary = offers[0];
    await client.query(
      `UPDATE students SET company_id=$1, offer_type=$2, ctc=$3, stipend=$4 WHERE id=$5`,
      [primary.company_id, primary.offer_type, primary.ctc ?? null, primary.stipend ?? null, studentId]
    );
  }
  return getStudent(studentId, client);
});

// Converts an internship-only offer (Intern / Summer Intern) into its "+ PPO" variant with
// the full-time package details. A PPO is a qualifying outcome, so a not-yet-placed student
// becomes Placed with this offer as their primary; for an already-placed student the
// denormalized primary-offer columns are refreshed only when this offer is the primary.
export const convertOfferToPpo = async (offerId, { ctc, role, offer_date } = {}) => transaction(async (client) => {
  const { rows } = await client.query('SELECT * FROM offers WHERE id = $1', [offerId]);
  const offer = rows[0];
  if (!offer) throw new Error('Offer not found');
  if (!isInternshipOfferType(offer.offer_type) || isFullTimeOfferType(offer.offer_type)) {
    throw new Error('Only Intern or Summer Intern offers can be converted to PPO');
  }

  const newType = isSummerInternOfferType(offer.offer_type) ? 'Summer Intern + PPO' : 'Intern + PPO';
  await client.query(
    'UPDATE offers SET offer_type=$1, ctc=$2, role=COALESCE($3, role), offer_date=COALESCE($4, offer_date) WHERE id=$5',
    [newType, ctc ?? null, role || null, offer_date || null, offerId]
  );

  const refreshed = await getStudent(offer.student_id, client);
  const converted = (refreshed?.offers || []).find((o) => String(o.id) === String(offerId));
  if (converted) {
    if (refreshed.placement_status !== 'Placed') {
      await client.query(
        `UPDATE students SET placement_status='Placed', company_id=$1, offer_type=$2, ctc=$3, stipend=$4, registration_deadline=$5, offer_date=$6 WHERE id=$7`,
        [converted.company_id, converted.offer_type, converted.ctc ?? null, converted.stipend ?? null, converted.registration_deadline || null, converted.offer_date || null, offer.student_id]
      );
    } else if (String(refreshed.company_id || '') === String(converted.company_id)) {
      await client.query(
        'UPDATE students SET offer_type=$1, ctc=$2, stipend=$3, offer_date=$4 WHERE id=$5',
        [converted.offer_type, converted.ctc ?? null, converted.stipend ?? null, converted.offer_date || null, offer.student_id]
      );
    }
  }
  return getStudent(offer.student_id, client);
});

export const deleteStudent = async (id) => {
  await query('DELETE FROM students WHERE id=$1', [id]);
};

export const buildStats = async (batchKey = DEFAULT_BATCH_KEY, graduationYear = null) => {
  const cycle = graduationYear !== null;
  const batch = cycle ? getCycleConfig(graduationYear) : getBatchConfig(batchKey);
  const companies = cycle ? await listCompaniesByCycle(graduationYear) : await listCompanies(batch.key);
  const students = cycle ? await listStudentsByCycle(graduationYear) : await listStudents(batch.key);

  if (batch.aggregate_only) {
    const totalOffers = companies.reduce((sum, company) => sum + (Number(company.reported_offer_count) || 0), 0);
    const companiesWithOffers = companies.filter((company) => Number(company.reported_offer_count) > 0).length;
    const aggregate = {
      total_students: 0,
      eligible_students: 0,
      excluded_students: 0,
      placed_students: 0,
      unplaced_students: 0,
      total_offers: totalOffers,
      total_intern_offers: 0,
      total_fte_offers: 0,
      total_combo_offers: 0,
      total_Aplus_offers: 0,
      total_A_offers: 0,
      total_B_offers: 0,
      highest_ctc: null,
      average_ctc: null,
      median_ctc: null,
      highest_stipend: null,
      average_stipend: null,
      median_stipend: null,
      placement_percentage: 0,
      internship_percentage: 0,
      fte_percentage: 0,
    };

    return {
      batch,
      aggregate_only: true,
      number_of_companies: companiesWithOffers,
      total_companies_listed: companies.length,
      total_offers: totalOffers,
      total_students: 0,
      eligible_students: 0,
      excluded_students: 0,
      unplaced_students: 0,
      total_placed_students: 0,
      available_programs: ['CSE'],
      branch_summary: { overall: aggregate, cse: aggregate, ece: { ...aggregate, total_offers: 0 }, cb: { ...aggregate, total_offers: 0 } },
    };
  }

  const studentIds = students.map((student) => student.id);
  if (!studentIds.length) {
    const empty = {
      total_students: 0,
      eligible_students: 0,
      excluded_students: 0,
      placed_students: 0,
      unplaced_students: 0,
      total_offers: 0,
      total_intern_offers: 0,
      total_fte_offers: 0,
      total_combo_offers: 0,
      total_Aplus_offers: 0,
      total_A_offers: 0,
      total_B_offers: 0,
      highest_ctc: null,
      average_ctc: null,
      median_ctc: null,
      highest_stipend: null,
      average_stipend: null,
      median_stipend: null,
      placement_percentage: 0,
      internship_percentage: 0,
      fte_percentage: 0,
    };
    return {
      batch,
      number_of_companies: companies.length,
      total_offers: 0,
      total_intern_offers: 0,
      total_fte_offers: 0,
      total_combo_offers: 0,
      total_Aplus_offers: 0,
      total_A_offers: 0,
      total_B_offers: 0,
      highest_ctc: null,
      lowest_ctc: null,
      average_ctc: null,
      median_ctc: null,
      highest_stipend: null,
      lowest_stipend: null,
      average_stipend: null,
      median_stipend: null,
      fte_percentage: 0,
      internship_percentage: 0,
      overall_placement_percentage: 0,
      total_students: 0,
      eligible_students: 0,
      excluded_students: 0,
      unplaced_students: 0,
      total_placed_students: 0,
      available_programs: [],
      branch_summary: { overall: empty, cse: empty, ece: empty, cb: empty },
    };
  }

  const { rows: offers } = await query(
    `SELECT o.*, c.category as company_category, c.type as company_type, c.ctc as company_ctc, c.stipend as company_stipend
     FROM offers o
     JOIN companies c ON o.company_id = c.id`
     + ` WHERE o.student_id = ANY($1::bigint[])`,
    [studentIds]
  );

  const studentProgramMap = students.reduce((acc, s) => {
    acc[s.id] = s.program;
    return acc;
  }, {});

  const offersWithProgram = offers.map((o) => ({ ...o, program: studentProgramMap[o.student_id] }));

  const median = (arr) => {
    if (!arr.length) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  const average = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

  const toPct = (num, den) => (den ? Number(((num / den) * 100).toFixed(2)) : 0);

  const isIncludedInPlacementRate = (student) => !['not sitting', 'ineligible'].includes(
    String(student?.placement_status || '').trim().toLowerCase()
  );

  const summarize = (subset, offerProgramFilter = null) => {
    const total = subset.length;
    const placed = subset.filter((s) => s.placement_status === 'Placed').length;
    const placementEligibleTotal = subset.filter(isIncludedInPlacementRate).length;
    const excludedStudents = Math.max(total - placementEligibleTotal, 0);
    const unplacedStudents = Math.max(placementEligibleTotal - placed, 0);
    const offersSubset = offerProgramFilter
      ? offersWithProgram.filter((o) => offerProgramFilter(o.program))
      : offersWithProgram;

    const comboSub = offersSubset.filter((o) => isCombinedOfferType(o.offer_type));
    const internSub = offersSubset.filter((o) => isInternshipOfferType(o.offer_type) && !isCombinedOfferType(o.offer_type));
    const fteSub = offersSubset.filter((o) => isFullTimeOfferType(o.offer_type) && !isCombinedOfferType(o.offer_type));

    const byCategory = { Aplus: 0, A: 0, B: 0 };
    for (const o of offersSubset) {
      const cat = o.company_category;
      if (!cat) continue;
      if (cat.toUpperCase() === 'A+') byCategory.Aplus += 1;
      else if (cat.toUpperCase() === 'A') byCategory.A += 1;
      else if (cat.toUpperCase() === 'B') byCategory.B += 1;
    }

    const ctcValues = offersSubset
      .map((o) => o.ctc ?? o.company_ctc)
      .filter((v) => typeof v === 'number');
    const stipendValues = offersSubset
      .map((o) => o.stipend ?? o.company_stipend)
      .filter((v) => typeof v === 'number');

    const internCount = internSub.length + comboSub.length;
    const fteCount = fteSub.length + comboSub.length;

    return {
      total_students: total,
      eligible_students: batch.placements_only ? null : placementEligibleTotal,
      excluded_students: batch.placements_only ? null : excludedStudents,
      placed_students: placed,
      unplaced_students: batch.placements_only ? null : unplacedStudents,
      total_offers: offersSubset.length,
      total_intern_offers: internSub.length,
      total_fte_offers: fteSub.length + comboSub.length,
      total_combo_offers: comboSub.length,
      total_Aplus_offers: byCategory.Aplus,
      total_A_offers: byCategory.A,
      total_B_offers: byCategory.B,
      highest_ctc: ctcValues.length ? Math.max(...ctcValues) : null,
      average_ctc: average(ctcValues),
      median_ctc: median(ctcValues),
      highest_stipend: stipendValues.length ? Math.max(...stipendValues) : null,
      average_stipend: average(stipendValues),
      median_stipend: median(stipendValues),
      placement_percentage: batch.placements_only ? null : toPct(placed, placementEligibleTotal),
      internship_percentage: toPct(internCount, total),
      fte_percentage: toPct(fteCount, total),
    };
  };

  const totalStudents = students.length;
  const placementEligibleStudents = students.filter(isIncludedInPlacementRate).length;
  const excludedStudents = Math.max(totalStudents - placementEligibleStudents, 0);
  const inBranch = (branchGroup) => (program) => getBranchGroup(program) === branchGroup;
  const branchSummary = {
    overall: summarize(students),
    cse: summarize(students.filter((s) => getBranchGroup(s.program) === 'CSE'), inBranch('CSE')),
    ece: summarize(students.filter((s) => getBranchGroup(s.program) === 'ECE'), inBranch('ECE')),
    cb: summarize(students.filter((s) => getBranchGroup(s.program) === 'CB'), inBranch('CB')),
  };

  const overall = branchSummary.overall;
  const placedCount = overall.placed_students;
  const unplacedCount = overall.unplaced_students;
  const fteCount = overall.total_fte_offers;
  const internCount = overall.total_intern_offers;
  const historicalReportedOffers = companies.reduce(
    (sum, company) => sum + (Number(company.reported_offer_count) || 0),
    0
  );
  const historicalRecruiters = companies.filter((company) => Number(company.reported_offer_count) > 0).length;

  return {
    batch,
    number_of_companies: companies.length,
    total_offers: overall.total_offers,
    total_intern_offers: overall.total_intern_offers,
    total_fte_offers: overall.total_fte_offers,
    total_combo_offers: overall.total_combo_offers,
    total_Aplus_offers: overall.total_Aplus_offers,
    total_A_offers: overall.total_A_offers,
    total_B_offers: overall.total_B_offers,
    highest_ctc: overall.highest_ctc,
    lowest_ctc: null,
    average_ctc: overall.average_ctc,
    median_ctc: overall.median_ctc,
    highest_stipend: overall.highest_stipend,
    lowest_stipend: null,
    average_stipend: overall.average_stipend,
    median_stipend: overall.median_stipend,
    fte_percentage: overall.fte_percentage,
    internship_percentage: overall.internship_percentage,
    overall_placement_percentage: batch.placements_only ? null : toPct(placedCount, placementEligibleStudents),
    total_students: totalStudents,
    eligible_students: batch.placements_only ? null : placementEligibleStudents,
    excluded_students: batch.placements_only ? null : excludedStudents,
    unplaced_students: batch.placements_only ? null : unplacedCount,
    total_placed_students: placedCount,
    historical_reported_offers: historicalReportedOffers,
    historical_recruiters: historicalRecruiters,
    available_programs: [...new Set(students.map((student) => student.program).filter(Boolean))].sort(),
    branch_summary: branchSummary,
  };
};

export const closeDb = async () => {
  if (pool) await pool.end();
};
export const ensureOfferBackfill = backfillOffers;
export const getTableCounts = async () => {
  const [companies, students, offers, calendarSnapshots] = await Promise.all([
    query('SELECT count(*)::int AS count FROM companies'),
    query('SELECT count(*)::int AS count FROM students'),
    query('SELECT count(*)::int AS count FROM offers'),
    query('SELECT count(*)::int AS count FROM placement_calendar_snapshots'),
  ]);

  return {
    companies: companies.rows[0]?.count ?? 0,
    students: students.rows[0]?.count ?? 0,
    offers: offers.rows[0]?.count ?? 0,
    placement_calendar_snapshots: calendarSnapshots.rows[0]?.count ?? 0,
  };
};
