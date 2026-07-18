import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import {
  createPlacementCalendarSnapshot,
  diffPlacementCalendarSnapshots,
  getAppSettings,
  getLatestPlacementCalendarSnapshot,
  setAppSettings,
} from './db.js';
import { sendPlacementCalendarChangeNotifications } from './calendar-notifications.js';

const ADMIN_EMAIL = 'yash25091@iiitd.ac.in';
const OAUTH_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
];
const TOKEN_KEY = 'placement_calendar_oauth_tokens';
const TOKEN_EMAIL_KEY = 'placement_calendar_oauth_email';
const TOKEN_CONNECTED_AT_KEY = 'placement_calendar_oauth_connected_at';
const STATE_KEY = 'placement_calendar_oauth_state';
const STATE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_SPREADSHEET_ID = '1FqgXNGWUUa5uHRYEHEZ7iYz3ZpOpah7TnGIBGLhyoRU';
const DEFAULT_SHEET_ID = 0;
const DEFAULT_SYNC_INTERVAL_MS = 10 * 60 * 1000;

const configuredHost = process.env.PLACEMENT_ATLAS_HOST || 'placement-atlas.yashkumarvaibhav.me';
const spreadsheetId = process.env.PLACEMENT_CALENDAR_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;
const preferredSheetId = Number(process.env.PLACEMENT_CALENDAR_SHEET_ID ?? DEFAULT_SHEET_ID);

const oauthClientId = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
const oauthClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';
const oauthRedirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI
  || `https://${configuredHost}/api/admin/calendar/oauth/callback`;
const oauthReturnUrl = process.env.PLACEMENT_CALENDAR_OAUTH_RETURN_URL
  || `https://${configuredHost}/#/admin/calendar`;
const tokenSecret = process.env.PLACEMENT_CALENDAR_TOKEN_SECRET || process.env.SESSION_SECRET || '';
const syncIntervalMs = Number(process.env.PLACEMENT_CALENDAR_SYNC_INTERVAL_MS ?? DEFAULT_SYNC_INTERVAL_MS);
let autoSyncTimer = null;

const hashObject = (value) => crypto
  .createHash('sha256')
  .update(stableStringify(value))
  .digest('hex');

const stableStringify = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
};

const encryptionKey = () => {
  if (!tokenSecret) throw new Error('SESSION_SECRET or PLACEMENT_CALENDAR_TOKEN_SECRET is required for calendar OAuth token storage.');
  return crypto.createHash('sha256').update(tokenSecret).digest();
};

const encryptJson = (value) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
};

const decryptJson = (value) => {
  const [ivRaw, tagRaw, ciphertextRaw] = String(value || '').split('.');
  if (!ivRaw || !tagRaw || !ciphertextRaw) return null;

  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, 'base64url')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8'));
};

const createOAuthClient = () => {
  if (!oauthClientId || !oauthClientSecret) {
    const err = new Error('Google OAuth client ID and secret are required.');
    err.code = 'OAUTH_NOT_CONFIGURED';
    throw err;
  }
  return new OAuth2Client(oauthClientId, oauthClientSecret, oauthRedirectUri);
};

const withCalendarStatusParams = (url, params) => {
  const redirect = new URL(url);
  if (redirect.hash) {
    const [hashPath, hashSearch = ''] = redirect.hash.split('?');
    const hashParams = new URLSearchParams(hashSearch);
    for (const [key, value] of Object.entries(params)) {
      hashParams.set(key, value);
    }
    redirect.hash = `${hashPath}?${hashParams.toString()}`;
  } else {
    for (const [key, value] of Object.entries(params)) {
      redirect.searchParams.set(key, value);
    }
  }
  return redirect.toString();
};

const readStoredTokens = async () => {
  const settings = await getAppSettings([TOKEN_KEY]);
  if (!settings[TOKEN_KEY]) return null;
  try {
    return decryptJson(settings[TOKEN_KEY]);
  } catch {
    return null;
  }
};

const storeTokens = async (tokens, email) => {
  await setAppSettings({
    [TOKEN_KEY]: encryptJson(tokens),
    [TOKEN_EMAIL_KEY]: email,
    [TOKEN_CONNECTED_AT_KEY]: new Date().toISOString(),
  });
};

const clearTokens = async () => {
  await setAppSettings({
    [TOKEN_KEY]: '',
    [TOKEN_EMAIL_KEY]: '',
    [TOKEN_CONNECTED_AT_KEY]: '',
  });
};

export const getCalendarOAuthStatus = async () => {
  const settings = await getAppSettings([TOKEN_KEY, TOKEN_EMAIL_KEY, TOKEN_CONNECTED_AT_KEY]);
  const hasReadableTokens = settings[TOKEN_KEY] ? !!(await readStoredTokens()) : false;
  return {
    configured: !!oauthClientId && !!oauthClientSecret,
    connected: hasReadableTokens,
    email: hasReadableTokens ? settings[TOKEN_EMAIL_KEY] || '' : '',
    connected_at: hasReadableTokens ? settings[TOKEN_CONNECTED_AT_KEY] || '' : '',
    spreadsheet_id: spreadsheetId,
    sheet_id: preferredSheetId,
    redirect_uri: oauthRedirectUri,
  };
};

export const createCalendarOAuthUrl = async () => {
  const client = createOAuthClient();
  const state = crypto.randomBytes(24).toString('base64url');
  await setAppSettings({
    [STATE_KEY]: JSON.stringify({ state, expires_at: Date.now() + STATE_TTL_MS }),
  });

  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: true,
    scope: OAUTH_SCOPES,
    state,
  });
};

export const handleCalendarOAuthCallback = async ({ code, state }) => {
  if (!code || !state) {
    return withCalendarStatusParams(oauthReturnUrl, { calendarOAuth: 'failed', reason: 'missing-code' });
  }

  const settings = await getAppSettings([STATE_KEY]);
  let storedState = null;
  try {
    storedState = JSON.parse(settings[STATE_KEY] || '{}');
  } catch {
    storedState = null;
  }

  if (!storedState?.state || storedState.state !== state || Number(storedState.expires_at) < Date.now()) {
    return withCalendarStatusParams(oauthReturnUrl, { calendarOAuth: 'failed', reason: 'state-expired' });
  }

  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens?.refresh_token) {
    return withCalendarStatusParams(oauthReturnUrl, { calendarOAuth: 'failed', reason: 'missing-refresh-token' });
  }

  let email = '';
  if (tokens.id_token) {
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: oauthClientId });
    email = String(ticket.getPayload()?.email || '').toLowerCase();
  }

  if (email !== ADMIN_EMAIL) {
    return withCalendarStatusParams(oauthReturnUrl, { calendarOAuth: 'failed', reason: 'wrong-account' });
  }

  await storeTokens(tokens, email);
  await setAppSettings({ [STATE_KEY]: '{}' });
  return withCalendarStatusParams(oauthReturnUrl, { calendarOAuth: 'connected' });
};

export const disconnectCalendarOAuth = async () => {
  await clearTokens();
};

const authorizedClient = async () => {
  const tokens = await readStoredTokens();
  if (!tokens?.refresh_token) {
    const err = new Error('Placement Calendar OAuth is not connected.');
    err.code = 'CALENDAR_OAUTH_REQUIRED';
    throw err;
  }
  const client = createOAuthClient();
  client.setCredentials(tokens);
  return client;
};

const extendedValue = (value = {}) => {
  if (Object.prototype.hasOwnProperty.call(value, 'stringValue')) return value.stringValue;
  if (Object.prototype.hasOwnProperty.call(value, 'numberValue')) return value.numberValue;
  if (Object.prototype.hasOwnProperty.call(value, 'boolValue')) return value.boolValue;
  if (Object.prototype.hasOwnProperty.call(value, 'formulaValue')) return value.formulaValue;
  if (Object.prototype.hasOwnProperty.call(value, 'errorValue')) return value.errorValue;
  return null;
};

const compactBorder = (border = {}) => border.style || border.color || border.colorStyle ? ({
  style: border.style || null,
  color: border.colorStyle?.rgbColor || border.color || null,
}) : null;

const compactFormat = (format = {}) => ({
  background: format.backgroundColorStyle?.rgbColor || format.backgroundColor || null,
  text: format.textFormat ? {
    bold: !!format.textFormat.bold,
    italic: !!format.textFormat.italic,
    foreground: format.textFormat.foregroundColorStyle?.rgbColor || format.textFormat.foregroundColor || null,
    link: format.textFormat.link?.uri || null,
  } : null,
  borders: format.borders ? {
    top: compactBorder(format.borders.top),
    right: compactBorder(format.borders.right),
    bottom: compactBorder(format.borders.bottom),
    left: compactBorder(format.borders.left),
  } : null,
  horizontal: format.horizontalAlignment || null,
  vertical: format.verticalAlignment || null,
  wrap: format.wrapStrategy || null,
});

const cellSnapshot = (cell = {}) => ({
  formatted: cell.formattedValue ?? '',
  effective: extendedValue(cell.effectiveValue),
  entered: extendedValue(cell.userEnteredValue),
  formula: cell.userEnteredValue?.formulaValue || null,
  hyperlink: cell.hyperlink || null,
  note: cell.note || null,
  format: compactFormat(cell.effectiveFormat || cell.userEnteredFormat || {}),
});

const isCellMeaningful = (cell) => (
  cell.formatted !== ''
  || cell.effective !== null
  || cell.entered !== null
  || !!cell.formula
  || !!cell.hyperlink
  || !!cell.note
);

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

const headerKey = (value, index, seen) => {
  const base = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || `column_${columnName(index).toLowerCase()}`;
  const count = seen.get(base) || 0;
  seen.set(base, count + 1);
  return count ? `${base}_${count + 1}` : base;
};

const parseDateText = (value) => {
  const text = String(value || '').trim();
  if (!text) return null;

  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) return toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const split = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (split) {
    const first = Number(split[1]);
    const second = Number(split[2]);
    const year = Number(split[3].length === 2 ? `20${split[3]}` : split[3]);
    const day = first > 12 ? first : second > 12 ? second : first;
    const month = first > 12 ? second : second > 12 ? first : second;
    return toIsoDate(year, month, day);
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime()) && /[a-zA-Z]/.test(text)) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
};

const sheetSerialDate = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 20000 || number > 80000) return null;
  const date = new Date(Math.round((number - 25569) * 86400 * 1000));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

const toIsoDate = (year, month, day) => {
  if (!year || !month || !day || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
};

const pickValue = (record, candidates) => {
  for (const candidate of candidates) {
    if (record[candidate] !== undefined && record[candidate] !== null && String(record[candidate]).trim() !== '') {
      return String(record[candidate]).trim();
    }
  }
  return '';
};

const pickDate = (record, rawCells, candidates) => {
  for (const candidate of candidates) {
    if (record[candidate] !== undefined && record[candidate] !== null && String(record[candidate]).trim() !== '') {
      const textDate = parseDateText(record[candidate]);
      if (textDate) return textDate;

      const columnIndex = Number(candidate.replace(/^column_/, ''), 36);
      const cell = Number.isFinite(columnIndex) ? rawCells[columnIndex] : null;
      const serialDate = sheetSerialDate(cell?.effective);
      if (serialDate) return serialDate;
    }
  }
  return null;
};

const splitTokens = (value) => String(value || '')
  .split(/[,;/|]+/)
  .map((item) => item.trim())
  .filter(Boolean);

const normalizeEvent = ({ row, headerKeys, headerRowIndex }) => {
  if (row.source_row_index <= headerRowIndex || !row.values.some(Boolean)) return null;

  const record = {};
  headerKeys.forEach((key, index) => {
    record[key] = row.values[index] || '';
  });

  const title = pickValue(record, ['title', 'event', 'activity', 'company', 'company_name', 'organisation', 'organization', 'name']);
  const company = pickValue(record, ['company', 'company_name', 'organisation', 'organization', 'recruiter', 'name']);
  const eventType = pickValue(record, ['type', 'event_type', 'activity_type', 'process', 'round']);
  const status = pickValue(record, ['status', 'stage', 'state']);
  const notes = pickValue(record, ['notes', 'remarks', 'comment', 'comments', 'description', 'details']);
  const startsOn = pickDate(record, row.cells, ['date', 'start_date', 'starts_on', 'event_date', 'interview_date', 'ppt_date']);
  const endsOn = pickDate(record, row.cells, ['end_date', 'ends_on']);
  const deadlineOn = pickDate(record, row.cells, ['deadline', 'registration_deadline', 'last_date', 'last_date_of_registration', 'last_day']);
  const batches = splitTokens(pickValue(record, ['batch', 'batches', 'degree', 'program', 'programs', 'eligible_batches']));
  const branches = splitTokens(pickValue(record, ['branch', 'branches', 'eligible_branches', 'eligible_branch']));

  if (!title && !company && !eventType && !startsOn && !deadlineOn && !notes) return null;

  return {
    source_row_number: row.source_row_number,
    event_hash: hashObject({
      values: row.values,
      hidden: row.hidden,
      hidden_by_user: row.hidden_by_user,
      hidden_by_filter: row.hidden_by_filter,
    }),
    title: title || company || eventType || `Row ${row.source_row_number}`,
    company: company || null,
    event_type: eventType || null,
    starts_on: startsOn,
    ends_on: endsOn,
    deadline_on: deadlineOn,
    status: status || null,
    batches,
    branches,
    notes: notes || null,
    hidden: row.hidden,
    raw_event: record,
  };
};

const extractSheetSnapshot = (spreadsheet) => {
  const sheet = (spreadsheet.sheets || []).find((item) => Number(item.properties?.sheetId) === preferredSheetId)
    || spreadsheet.sheets?.[0];
  if (!sheet) throw new Error('No sheets were returned from Google Sheets.');

  const gridData = sheet.data?.[0] || {};
  const rowData = gridData.rowData || [];
  const rowMetadata = gridData.rowMetadata || [];
  const columnMetadata = gridData.columnMetadata || [];

  const rows = rowData
    .map((rawRow, index) => {
      const cells = (rawRow.values || []).map(cellSnapshot);
      const meaningful = cells.some(isCellMeaningful);
      const metadata = rowMetadata[index] || {};
      const hiddenByUser = !!metadata.hiddenByUser;
      const hiddenByFilter = !!metadata.hiddenByFilter;
      const values = cells.map((cell) => String(cell.formatted ?? ''));
      return {
        source_row_index: index,
        source_row_number: index + 1,
        hidden_by_user: hiddenByUser,
        hidden_by_filter: hiddenByFilter,
        hidden: hiddenByUser || hiddenByFilter,
        values,
        cells,
        raw_row: { values: rawRow.values || [], metadata },
        meaningful,
      };
    })
    .filter((row) => row.meaningful);

  const headerRow = rows.find((row) => row.values.filter((value) => String(value).trim()).length >= 2) || rows[0] || null;
  const seen = new Map();
  const headerKeys = headerRow
    ? headerRow.values.map((value, index) => headerKey(value, index, seen))
    : [];

  const normalizedRows = rows.map((row) => ({
    ...row,
    row_hash: hashObject({
      values: row.values,
      cells: row.cells,
      hidden_by_user: row.hidden_by_user,
      hidden_by_filter: row.hidden_by_filter,
    }),
    normalized: headerKeys.reduce((record, key, index) => {
      record[key] = row.values[index] || '';
      return record;
    }, {}),
    meaningful: undefined,
  }));

  const events = normalizedRows
    .map((row) => normalizeEvent({ row, headerKeys, headerRowIndex: headerRow?.source_row_index ?? -1 }))
    .filter(Boolean);

  const rawSnapshot = {
    spreadsheet_id: spreadsheet.spreadsheetId,
    spreadsheet_title: spreadsheet.properties?.title || '',
    sheet_id: sheet.properties?.sheetId,
    sheet_title: sheet.properties?.title || '',
    sheet_index: sheet.properties?.index,
    grid_properties: sheet.properties?.gridProperties || {},
    merges: sheet.merges || [],
    row_metadata: rowMetadata,
    column_metadata: columnMetadata,
    headers: headerRow ? headerKeys.map((key, index) => ({
      key,
      label: headerRow.values[index] || columnName(index),
      column: columnName(index),
    })) : [],
    rows: normalizedRows.map((row) => ({
      row_number: row.source_row_number,
      hidden: row.hidden,
      values: row.values,
    })),
  };

  const canonicalSnapshot = {
    source: rawSnapshot,
    rows: normalizedRows.map((row) => ({
      source_row_number: row.source_row_number,
      hidden_by_user: row.hidden_by_user,
      hidden_by_filter: row.hidden_by_filter,
      cells: row.cells,
    })),
  };

  return {
    source: {
      spreadsheet_id: spreadsheetId,
      sheet_id: Number(sheet.properties?.sheetId),
      sheet_title: sheet.properties?.title || '',
      source_range: sheet.properties?.title || '',
    },
    raw_snapshot: rawSnapshot,
    content_hash: hashObject(canonicalSnapshot),
    rows: normalizedRows,
    events,
    summary: {
      spreadsheet_title: rawSnapshot.spreadsheet_title,
      sheet_title: rawSnapshot.sheet_title,
      total_rows: normalizedRows.length,
      visible_rows: normalizedRows.filter((row) => !row.hidden).length,
      hidden_rows: normalizedRows.filter((row) => row.hidden).length,
      total_events: events.length,
      visible_events: events.filter((event) => !event.hidden).length,
      hidden_events: events.filter((event) => event.hidden).length,
      header_row_number: headerRow?.source_row_number || null,
      column_count: headerKeys.length,
    },
  };
};

const fetchSpreadsheet = async () => {
  const client = await authorizedClient();
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`);
  url.searchParams.set('includeGridData', 'true');
  const response = await client.request({ url: url.toString(), method: 'GET' });
  return response.data;
};

export const syncPlacementCalendar = async () => {
  const spreadsheet = await fetchSpreadsheet();
  const snapshotPayload = extractSheetSnapshot(spreadsheet);
  const latest = await getLatestPlacementCalendarSnapshot();
  if (latest?.content_hash === snapshotPayload.content_hash) {
    return {
      created: false,
      snapshot: latest,
      summary: snapshotPayload.summary,
    };
  }

  const created = await createPlacementCalendarSnapshot(snapshotPayload);
  let notifications = [];
  if (created.created) {
    try {
      const diff = latest?.id
        ? await diffPlacementCalendarSnapshots(latest.id, created.snapshot.id)
        : null;
      notifications = await sendPlacementCalendarChangeNotifications({
        snapshot: created.snapshot,
        diff,
      });
    } catch (err) {
      console.error('Placement Calendar notification failed:', err.message);
      notifications = [{ sent: false, reason: err.message }];
    }
  }

  return {
    created: created.created,
    snapshot: created.snapshot,
    summary: snapshotPayload.summary,
    notifications,
  };
};

export const startPlacementCalendarAutoSync = () => {
  if (autoSyncTimer || !Number.isFinite(syncIntervalMs) || syncIntervalMs <= 0) return null;

  autoSyncTimer = setInterval(async () => {
    try {
      await syncPlacementCalendar();
    } catch (err) {
      if (err.code !== 'CALENDAR_OAUTH_REQUIRED' && err.code !== 'OAUTH_NOT_CONFIGURED') {
        console.error('Placement Calendar auto-sync failed:', err.message);
      }
    }
  }, Math.max(syncIntervalMs, 60 * 1000));

  autoSyncTimer.unref?.();
  return autoSyncTimer;
};
