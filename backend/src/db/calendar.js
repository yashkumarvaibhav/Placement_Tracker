import { query, transaction } from './client.js';

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
