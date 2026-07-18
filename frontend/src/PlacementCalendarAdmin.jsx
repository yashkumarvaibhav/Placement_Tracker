import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from './api';

const columnName = (index) => {
  let name = '';
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
};

const rgbToCss = (color) => {
  if (!color || typeof color !== 'object') return '';
  const red = Math.round((color.red ?? 0) * 255);
  const green = Math.round((color.green ?? 0) * 255);
  const blue = Math.round((color.blue ?? 0) * 255);
  const alpha = color.alpha ?? 1;
  return alpha < 1 ? `rgba(${red}, ${green}, ${blue}, ${alpha})` : `rgb(${red}, ${green}, ${blue})`;
};

const borderToCss = (border) => {
  if (!border?.style) return '';
  const width = border.style === 'SOLID_THICK' ? 2 : 1;
  return `${width}px solid ${rgbToCss(border.color) || '#d0d7de'}`;
};

const cellStyle = (cell = {}) => {
  const format = cell.format || {};
  const style = {};
  const background = rgbToCss(format.background);
  const foreground = rgbToCss(format.text?.foreground);
  if (background) style.backgroundColor = background;
  if (foreground) style.color = foreground;
  if (format.text?.bold) style.fontWeight = 700;
  if (format.text?.italic) style.fontStyle = 'italic';
  if (format.horizontal) style.textAlign = format.horizontal.toLowerCase();
  if (format.vertical) style.verticalAlign = format.vertical.toLowerCase();
  if (format.borders?.top) style.borderTop = borderToCss(format.borders.top);
  if (format.borders?.right) style.borderRight = borderToCss(format.borders.right);
  if (format.borders?.bottom) style.borderBottom = borderToCss(format.borders.bottom);
  if (format.borders?.left) style.borderLeft = borderToCss(format.borders.left);
  return style;
};

const formatDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
};

const formatDateOnly = (value) => {
  if (!value) return '—';
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const [year, month, day] = value.slice(0, 10).split('-');
    return `${day}/${month}/${year}`;
  }
  return value;
};

const valuePreview = (values = []) => values
  .map((value) => String(value || '').trim())
  .filter(Boolean)
  .slice(0, 5)
  .join(' | ') || 'Blank row';

const oauthMessages = {
  connected: 'Google Sheets access connected. You can sync the calendar now.',
  'missing-code': 'Google did not return an OAuth code. Please try connecting again.',
  'state-expired': 'The OAuth request expired. Start the connection again from this page.',
  'missing-refresh-token': 'Google did not return a refresh token. Start the connection again and approve offline access.',
  'wrong-account': 'Connect with yash25091@iiitd.ac.in so the backend can read the private calendar.',
  'callback-error': 'OAuth callback failed. Check backend logs for the exact Google error.',
};

const SnapshotMetric = ({ label, value }) => (
  <div className="calendar-metric">
    <span>{label}</span>
    <strong>{value ?? '—'}</strong>
  </div>
);

const historyValue = (entry) => {
  if (entry?.formula) return entry.formula;
  if (entry?.value !== null && entry?.value !== undefined && String(entry.value).trim() !== '') return String(entry.value);
  if (entry?.entered !== null && entry?.entered !== undefined && entry.entered !== '') return String(entry.entered);
  if (entry?.effective !== null && entry?.effective !== undefined && entry.effective !== '') return String(entry.effective);
  return entry?.value || 'Blank';
};

const CellHistoryPopover = ({ history = [] }) => {
  if (!history.length) return null;
  const visibleHistory = [...history].reverse();

  return (
    <div className="sheet-history-popover" role="tooltip">
      <div className="sheet-history-title">Version history</div>
      {visibleHistory.map((entry, index) => (
        <div key={`${entry.version}-${index}`} className="sheet-history-entry">
          <span>v{entry.version} · {formatDateTime(entry.created_at)}</span>
          <strong>{historyValue(entry)}</strong>
          {entry.row_hidden && <em>Row hidden in this version</em>}
          {entry.note && <em>Note preserved</em>}
        </div>
      ))}
    </div>
  );
};

const normalizeMergeRange = (range = {}) => {
  const startRowIndex = Number(range.startRowIndex ?? 0);
  const endRowIndex = Number(range.endRowIndex ?? startRowIndex + 1);
  const startColumnIndex = Number(range.startColumnIndex ?? 0);
  const endColumnIndex = Number(range.endColumnIndex ?? startColumnIndex + 1);

  return {
    rowNumber: startRowIndex + 1,
    columnIndex: startColumnIndex,
    rowSpan: Math.max(1, endRowIndex - startRowIndex),
    colSpan: Math.max(1, endColumnIndex - startColumnIndex),
  };
};

const SheetCell = ({ row, columnIndex, cellHistory, colSpan = 1, rowSpan = 1 }) => {
  const cell = row?.cells?.[columnIndex] || {};
  const value = row?.values?.[columnIndex] || '';
  const history = cellHistory?.[`${row?.source_row_number}:${columnIndex}`] || [];
  const changed = history.length > 1;
  const hasHistory = changed;
  const classes = [
    'sheet-cell',
    row?.hidden ? 'sheet-hidden-row-cell' : '',
    changed ? 'sheet-cell-changed' : '',
    cell.note ? 'sheet-cell-note' : '',
  ].filter(Boolean).join(' ');

  return (
    <td
      className={classes}
      style={cellStyle(cell)}
      colSpan={colSpan > 1 ? colSpan : undefined}
      rowSpan={rowSpan > 1 ? rowSpan : undefined}
      tabIndex={hasHistory ? 0 : undefined}
    >
      {cell.hyperlink ? (
        <a href={cell.hyperlink} target="_blank" rel="noreferrer">{value || cell.hyperlink}</a>
      ) : (
        value || ''
      )}
      {changed && <span className="sheet-change-corner" aria-hidden="true" />}
      {hasHistory && <CellHistoryPopover history={history} />}
    </td>
  );
};

const SpreadsheetGrid = ({ snapshot, cellHistory }) => {
  const rows = snapshot?.rows || [];
  const rawSnapshot = snapshot?.raw_snapshot || {};
  const gridProperties = rawSnapshot.grid_properties || {};
  const columnMetadata = rawSnapshot.column_metadata || [];
  const rowMetadata = rawSnapshot.row_metadata || [];
  const rowsByNumber = useMemo(() => new Map(rows.map((row) => [row.source_row_number, row])), [rows]);
  const mergeRanges = useMemo(() => (rawSnapshot.merges || []).map(normalizeMergeRange), [rawSnapshot.merges]);
  const mergeStarts = useMemo(() => new Map(
    mergeRanges.map((merge) => [`${merge.rowNumber}:${merge.columnIndex}`, merge]),
  ), [mergeRanges]);
  const coveredCells = useMemo(() => {
    const covered = new Set();
    mergeRanges.forEach((merge) => {
      for (let rowNumber = merge.rowNumber; rowNumber < merge.rowNumber + merge.rowSpan; rowNumber += 1) {
        for (let columnIndex = merge.columnIndex; columnIndex < merge.columnIndex + merge.colSpan; columnIndex += 1) {
          if (rowNumber !== merge.rowNumber || columnIndex !== merge.columnIndex) {
            covered.add(`${rowNumber}:${columnIndex}`);
          }
        }
      }
    });
    return covered;
  }, [mergeRanges]);

  const meaningfulMaxRow = Math.max(...rows.map((row) => row.source_row_number), 0);
  const sheetRowCount = Number(gridProperties.rowCount || 0);
  const maxRowNumber = Math.min(
    Math.max(30, meaningfulMaxRow + 12),
    sheetRowCount || Math.max(30, meaningfulMaxRow + 12),
  );
  const maxMergeColumn = Math.max(
    0,
    ...mergeRanges.map((merge) => merge.columnIndex + merge.colSpan),
  );
  const columnCount = Math.max(
    16,
    rawSnapshot.headers?.length || 0,
    maxMergeColumn,
    ...rows.map((row) => Math.max(row.values?.length || 0, row.cells?.length || 0)),
  );
  const columns = Array.from({ length: columnCount }, (_, index) => columnName(index));
  const rowNumbers = Array.from({ length: maxRowNumber }, (_, index) => index + 1);
  const columnWidths = Array.from({ length: columnCount }, (_, index) => {
    const pixelSize = Number(columnMetadata[index]?.pixelSize);
    return Number.isFinite(pixelSize) && pixelSize > 0 ? pixelSize : 100;
  });

  return (
    <div className="sheet-grid-wrap" aria-label="Preserved Placement Calendar sheet">
      <table className="sheet-grid">
        <colgroup>
          <col className="sheet-row-number-col" />
          {columnWidths.map((width, index) => (
            <col key={columns[index]} style={{ width: `${width}px` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className="sheet-corner" />
            {columns.map((column) => <th key={column} className="sheet-column-header">{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {rowNumbers.map((rowNumber) => {
            const row = rowsByNumber.get(rowNumber) || { source_row_number: rowNumber, values: [], cells: [], hidden: false };
            const rowHeight = Number(rowMetadata[rowNumber - 1]?.pixelSize);
            return (
              <tr
                key={rowNumber}
                className={row.hidden ? 'sheet-hidden-row' : ''}
                style={Number.isFinite(rowHeight) && rowHeight > 0 ? { height: `${rowHeight}px` } : undefined}
              >
                <th className="sheet-row-header">
                  <span>{rowNumber}</span>
                  {row.hidden && <i title="This row was hidden in Google Sheets">Hidden</i>}
                </th>
                {columns.map((_, columnIndex) => {
                  if (coveredCells.has(`${rowNumber}:${columnIndex}`)) return null;
                  const merge = mergeStarts.get(`${rowNumber}:${columnIndex}`);
                  return (
                    <SheetCell
                      key={`${rowNumber}-${columnIndex}`}
                      row={row}
                      columnIndex={columnIndex}
                      cellHistory={cellHistory}
                      colSpan={merge?.colSpan || 1}
                      rowSpan={merge?.rowSpan || 1}
                    />
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const DiffRows = ({ title, rows = [], type }) => {
  if (!rows.length) return null;

  return (
    <section className="calendar-diff-section">
      <h3>{title}</h3>
      <div className="calendar-diff-list">
        {rows.slice(0, 12).map((item, index) => {
          const before = type === 'changed' ? item.before : item;
          const after = type === 'changed' ? item.after : item;
          return (
            <article key={`${title}-${index}`} className="calendar-diff-item">
              <span className="badge">Row {after?.source_row_number || before?.source_row_number}</span>
              {type === 'changed' ? (
                <>
                  <p><strong>Before:</strong> {valuePreview(before?.values)}</p>
                  <p><strong>After:</strong> {valuePreview(after?.values)}</p>
                </>
              ) : (
                <p>{valuePreview(item.values)}</p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
};

const PlacementCalendarAdmin = ({ authHeaders }) => {
  const location = useLocation();
  const [status, setStatus] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState('');
  const [snapshot, setSnapshot] = useState(null);
  const [cellHistory, setCellHistory] = useState({});
  const [diff, setDiff] = useState(null);
  const [includeHidden] = useState(true);
  const [pending, setPending] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const oauthNotice = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const outcome = params.get('calendarOAuth');
    const reason = params.get('reason');
    if (outcome === 'connected') return { tone: 'success', text: oauthMessages.connected };
    if (outcome === 'failed') return { tone: 'error', text: oauthMessages[reason] || 'Google Sheets access could not be connected.' };
    return null;
  }, [location.search]);

  const loadStatus = async () => {
    const response = await api.get('/admin/calendar/oauth/status', authHeaders);
    setStatus(response.data);
  };

  const loadSnapshots = async () => {
    const response = await api.get('/admin/calendar/snapshots', authHeaders);
    setSnapshots(response.data || []);
    return response.data || [];
  };

  const loadSnapshot = async (snapshotId) => {
    if (!snapshotId) {
      setSnapshot(null);
      setCellHistory({});
      setDiff(null);
      return;
    }

    const response = await api.get(`/admin/calendar/snapshots/${snapshotId}`, authHeaders);
    setSnapshot(response.data);
    const historyResponse = await api.get(`/admin/calendar/snapshots/${snapshotId}/cell-history`, authHeaders);
    setCellHistory(historyResponse.data?.history || {});
    const diffResponse = await api.get(`/admin/calendar/snapshots/${snapshotId}/diff`, {
      ...authHeaders,
      params: { against: 'previous' },
    });
    setDiff(diffResponse.data?.diff || null);
  };

  const loadInitialData = async () => {
    setPending('load');
    setError('');
    try {
      await loadStatus();
      const list = await loadSnapshots();
      const nextId = String(list[0]?.id || '');
      setSelectedSnapshotId(nextId);
      if (nextId) await loadSnapshot(nextId);
    } catch (err) {
      if (err.response?.status !== 404) {
        setError(err.response?.data?.message || 'Placement Calendar data could not be loaded.');
      }
    } finally {
      setPending('');
    }
  };

  useEffect(() => {
    loadInitialData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authHeaders]);

  useEffect(() => {
    if (!selectedSnapshotId) return;
    loadSnapshot(selectedSnapshotId).catch((err) => {
      setError(err.response?.data?.message || 'Selected calendar version could not be loaded.');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSnapshotId]);

  const connectOAuth = async () => {
    setPending('oauth');
    setError('');
    setMessage('');
    try {
      const response = await api.post('/admin/calendar/oauth/start', {}, authHeaders);
      window.location.assign(response.data.authorization_url);
    } catch (err) {
      setPending('');
      setError(err.response?.data?.message || 'Google OAuth could not be started.');
    }
  };

  const disconnectOAuth = async () => {
    setPending('disconnect');
    setError('');
    setMessage('');
    try {
      await api.delete('/admin/calendar/oauth', authHeaders);
      setMessage('Google Sheets access disconnected. Existing calendar snapshots remain preserved.');
      await loadStatus();
    } catch (err) {
      setError(err.response?.data?.message || 'Google Sheets access could not be disconnected.');
    } finally {
      setPending('');
    }
  };

  const syncNow = async () => {
    setPending('sync');
    setError('');
    setMessage('');
    try {
      const response = await api.post('/admin/calendar/sync', {}, authHeaders);
      setMessage(response.data.created
        ? `Captured calendar version ${response.data.snapshot.version}.`
        : 'No calendar changes found. The latest stored version is still current.');
      const list = await loadSnapshots();
      const nextId = String(response.data.snapshot?.id || list[0]?.id || '');
      setSelectedSnapshotId(nextId);
      if (nextId) await loadSnapshot(nextId);
      await loadStatus();
    } catch (err) {
      setError(err.response?.data?.message || 'Calendar sync failed.');
    } finally {
      setPending('');
    }
  };

  const visibleEvents = useMemo(() => (
    (snapshot?.events || []).filter((event) => includeHidden || !event.hidden)
  ), [includeHidden, snapshot]);

  return (
    <main className="container section-page calendar-admin-page">
      {oauthNotice && <div className={oauthNotice.tone === 'success' ? 'page-alert success-alert' : 'page-alert error-alert'}>{oauthNotice.text}</div>}
      {message && <div className="page-alert success-alert">{message}</div>}
      {error && <div className="page-alert error-alert" role="alert">{error}</div>}

      {snapshot && (
        <>
          <section className="calendar-sheet-section">
            <div className="calendar-section-head">
              <div>
                <span className="eyebrow">Preserved sheet</span>
                <h2>Snapshot grid</h2>
              </div>
              <div className="calendar-sheet-controls">
                <label className="calendar-version-control">
                  <span>Version</span>
                  <select value={selectedSnapshotId} onChange={(event) => setSelectedSnapshotId(event.target.value)}>
                    {snapshots.length ? snapshots.map((item) => (
                      <option key={item.id} value={item.id}>
                        v{item.version} · {formatDateTime(item.created_at)}
                      </option>
                    )) : <option value="">No snapshots yet</option>}
                  </select>
                </label>
                <button type="button" onClick={syncNow} disabled={!status?.connected || pending === 'sync'}>
                  {pending === 'sync' ? 'Syncing...' : 'Sync now'}
                </button>
                <span className="badge">{snapshot.total_row_count} rows</span>
                {!!snapshot.hidden_row_count && <span className="badge hidden-badge">{snapshot.hidden_row_count} hidden</span>}
              </div>
            </div>
            <SpreadsheetGrid snapshot={snapshot} cellHistory={cellHistory} />
          </section>

          <section className="calendar-table-section calendar-secondary-section">
            <div className="calendar-section-head">
              <div>
                <span className="eyebrow">Parsed calendar</span>
                <h2>Events</h2>
              </div>
              <span className="badge">{visibleEvents.length} shown</span>
            </div>
            <div className="directory-table-wrap calendar-table-wrap">
              <table className="directory-table calendar-table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Title</th>
                    <th>Company</th>
                    <th>Type</th>
                    <th>Date</th>
                    <th>Deadline</th>
                    <th>Status</th>
                    <th>Visibility</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleEvents.map((event) => (
                    <tr key={event.id}>
                      <td>{event.source_row_number}</td>
                      <td>{event.title || '—'}</td>
                      <td>{event.company || '—'}</td>
                      <td>{event.event_type || '—'}</td>
                      <td>{formatDateOnly(event.starts_on || event.ends_on)}</td>
                      <td>{formatDateOnly(event.deadline_on)}</td>
                      <td>{event.status || '—'}</td>
                      <td>{event.hidden ? <span className="badge hidden-badge">Hidden</span> : <span className="badge visible-badge">Visible</span>}</td>
                    </tr>
                  ))}
                  {!visibleEvents.length && (
                    <tr><td colSpan="8">No parsed events in this version.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {diff?.rows && (
            <section className="card calendar-diff-card">
              <div className="calendar-section-head">
                <div>
                  <span className="eyebrow">Version changes</span>
                  <h2>Compared with previous version</h2>
                </div>
                <div className="calendar-diff-summary">
                  <span>+{diff.rows.summary.added}</span>
                  <span>-{diff.rows.summary.removed}</span>
                  <span>{diff.rows.summary.changed} changed</span>
                  <span>{diff.rows.summary.hidden_changed} visibility</span>
                </div>
              </div>
              <DiffRows title="Added rows" rows={diff.rows.added} />
              <DiffRows title="Removed rows" rows={diff.rows.removed} />
              <DiffRows title="Changed rows" rows={diff.rows.changed} type="changed" />
              <DiffRows title="Visibility changes" rows={diff.rows.hidden_changed} type="changed" />
            </section>
          )}
        </>
      )}

      {!snapshot && (
        <section className="calendar-empty-state">
          <div>
            <span className="eyebrow">Preserved sheet</span>
            <h2>No snapshot captured yet</h2>
          </div>
          <button type="button" onClick={syncNow} disabled={!status?.connected || pending === 'sync'}>
            {pending === 'sync' ? 'Syncing...' : 'Sync now'}
          </button>
        </section>
      )}

      <section className="calendar-admin-grid calendar-settings-grid">
        <article className="card calendar-connection-card">
          <span className={status?.connected ? 'status-pill status-placed' : 'status-pill status-unplaced'}>
            <span className="status-dot" />
            {status?.connected ? 'Connected' : 'Not connected'}
          </span>
          <h2>Google Sheets OAuth</h2>
          <p className="subtext">
            {status?.connected
              ? `Connected as ${status.email || 'the admin Google account'}.`
              : 'Connect with yash25091@iiitd.ac.in to let the backend read the private calendar.'}
          </p>
          <dl className="calendar-meta-list">
            <div><dt>Sheet ID</dt><dd>{status?.spreadsheet_id || '—'}</dd></div>
            <div><dt>Redirect URI</dt><dd>{status?.redirect_uri || '—'}</dd></div>
            <div><dt>Connected at</dt><dd>{formatDateTime(status?.connected_at)}</dd></div>
          </dl>
          <div className="calendar-admin-actions">
            <button type="button" className="secondary" onClick={connectOAuth} disabled={pending === 'oauth'}>
              {status?.connected ? 'Reconnect Google' : 'Connect Google'}
            </button>
            {status?.connected && (
              <button type="button" className="danger-button" onClick={disconnectOAuth} disabled={pending === 'disconnect'}>
                {pending === 'disconnect' ? 'Disconnecting...' : 'Disconnect OAuth'}
              </button>
            )}
          </div>
        </article>
      </section>
    </main>
  );
};

export default PlacementCalendarAdmin;
