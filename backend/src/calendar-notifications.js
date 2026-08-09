import nodemailer from 'nodemailer';
import { PRODUCT_NAME } from './config.js';
import { columnName } from './sheet-columns.js';

const DEFAULT_ADMIN_EMAIL = 'yash25091@iiitd.ac.in';

const smtpHost = process.env.SMTP_HOST || '';
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpSecure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true';
const smtpUser = process.env.SMTP_USER || '';
const smtpPass = process.env.SMTP_PASS || '';
const smtpFrom = process.env.SMTP_FROM || smtpUser || '';
const notificationTo = process.env.PLACEMENT_CALENDAR_NOTIFY_EMAIL || DEFAULT_ADMIN_EMAIL;
const googleChatWebhookUrl = process.env.PLACEMENT_CALENDAR_GOOGLE_CHAT_WEBHOOK_URL || '';
const whatsappApiVersion = process.env.WHATSAPP_CLOUD_API_VERSION || process.env.PLACEMENT_CALENDAR_WHATSAPP_API_VERSION || 'v20.0';
const whatsappToken = process.env.WHATSAPP_CLOUD_API_TOKEN || process.env.PLACEMENT_CALENDAR_WHATSAPP_TOKEN || '';
const whatsappPhoneNumberId = process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID || process.env.PLACEMENT_CALENDAR_WHATSAPP_PHONE_NUMBER_ID || '';
const whatsappTo = process.env.PLACEMENT_CALENDAR_WHATSAPP_TO || '';

let transporter = null;

export const isCalendarEmailConfigured = () => (
  !!smtpHost
  && Number.isFinite(smtpPort)
  && smtpPort > 0
  && !!smtpFrom
);

export const isCalendarGoogleChatConfigured = () => !!googleChatWebhookUrl;

export const isCalendarWhatsappConfigured = () => (
  !!whatsappToken
  && !!whatsappPhoneNumberId
  && !!whatsappTo
);

const getTransporter = () => {
  if (!isCalendarEmailConfigured()) return null;
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined,
  });
  return transporter;
};

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const formatDateTime = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown time';
  return date.toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  });
};

const BLANK = '(blank)';
// Google Chat and WhatsApp both cut a text message off at 4096 characters, so the detail is
// built against a budget and says how many entries it dropped rather than being truncated
// mid-row by the transport.
const DETAIL_CHAR_BUDGET = 3200;

const cellText = (value) => String(value ?? '').trim();

// Every column of the row, in sheet order. Interior blanks are kept so the positions still line
// up with the sheet; only the trailing empties Sheets pads rows with are dropped.
const fullRow = (row = {}) => {
  const values = [...(row.values || [])];
  while (values.length && !cellText(values[values.length - 1])) values.pop();
  if (!values.length) return 'Blank row';
  return values.map(cellText).join(' | ');
};

const rowNumberOf = (item = {}) => item.after?.source_row_number
  ?? item.before?.source_row_number
  ?? item.source_row_number
  ?? '?';

// Column headings come from the captured header row; a column with no heading falls back to its
// spreadsheet letter so it is still named rather than reported as an index.
const columnLabeller = (diff) => {
  const headers = diff?.target?.raw_snapshot?.headers
    || diff?.base?.raw_snapshot?.headers
    || [];
  return (index) => {
    const header = headers[index];
    const label = cellText(header?.label);
    return label || header?.column || columnName(index);
  };
};

const cellAttribute = (row, index, key) => {
  const cell = Array.isArray(row?.cells) ? row.cells[index] : null;
  return cell?.[key] || null;
};

// One line per column that actually moved. A row can also register as changed with its display
// text untouched — a formula, link or note edit — so those are reported too instead of the old
// "content preserved", which said something changed without saying what.
const describeCellChanges = (before, after, labelFor) => {
  const beforeValues = before?.values || [];
  const afterValues = after?.values || [];
  const width = Math.max(
    beforeValues.length,
    afterValues.length,
    (before?.cells || []).length,
    (after?.cells || []).length,
  );

  const changes = [];
  for (let index = 0; index < width; index += 1) {
    const from = cellText(beforeValues[index]);
    const to = cellText(afterValues[index]);
    if (from !== to) {
      changes.push(`changed ${labelFor(index)} from ${from || BLANK} to ${to || BLANK}`);
      continue;
    }
    for (const key of ['formula', 'hyperlink', 'note']) {
      const fromAttribute = cellAttribute(before, index, key);
      const toAttribute = cellAttribute(after, index, key);
      if (fromAttribute !== toAttribute) {
        changes.push(`changed ${labelFor(index)} ${key} from ${fromAttribute || BLANK} to ${toAttribute || BLANK}`);
      }
    }
  }
  return changes;
};

const changedRowBlock = (item, labelFor) => {
  const changes = describeCellChanges(item?.before, item?.after, labelFor);
  return [
    `Row ${rowNumberOf(item)}`,
    `earlier row : ${fullRow(item?.before)}`,
    `changed row : ${fullRow(item?.after)}`,
    ...(changes.length
      ? changes.map((change) => `exact change : ${change}`)
      : ['exact change : none in the cell contents']),
  ].join('\n');
};

const visibilityBlock = (item) => {
  const was = item?.before?.hidden ? 'hidden' : 'visible';
  const now = item?.after?.hidden ? 'hidden' : 'visible';
  return [
    `Row ${rowNumberOf(item)}`,
    `row : ${fullRow(item?.after || item?.before)}`,
    `exact change : changed visibility from ${was} to ${now}`,
  ].join('\n');
};

const plainRowBlock = (row) => `Row ${rowNumberOf(row)}\nrow : ${fullRow(row)}`;

// Sections share one budget so a long list of added rows cannot crowd out the changed ones.
const sectionWriter = () => {
  let remaining = DETAIL_CHAR_BUDGET;
  return (title, items = [], toBlock) => {
    if (!items.length) return '';
    const kept = [];
    for (const item of items) {
      const block = toBlock(item);
      if (block.length + 2 > remaining) break;
      remaining -= block.length + 2;
      kept.push(block);
    }
    const omitted = items.length - kept.length;
    const tail = omitted ? `\n\n...and ${omitted} more` : '';
    return `\n${title}\n${kept.join('\n\n')}${tail}\n`;
  };
};

const buildChangeDetail = (diff) => {
  const labelFor = columnLabeller(diff);
  const section = sectionWriter();
  return [
    section('Changed rows', diff?.rows?.changed || [], (item) => changedRowBlock(item, labelFor)),
    section('Added rows', diff?.rows?.added || [], plainRowBlock),
    section('Removed rows', diff?.rows?.removed || [], plainRowBlock),
    section('Visibility changes', diff?.rows?.hidden_changed || [], visibilityBlock),
  ].filter(Boolean).join('');
};

export const buildNotificationContent = ({ snapshot, diff }) => {
  const rowSummary = diff?.rows?.summary || {
    added: snapshot?.total_row_count || 0,
    removed: 0,
    changed: 0,
    hidden_changed: snapshot?.hidden_row_count || 0,
  };
  const subject = `Placement Calendar v${snapshot.version} captured: ${rowSummary.added} added, ${rowSummary.removed} removed, ${rowSummary.changed} changed`;
  const capturedAt = formatDateTime(snapshot.created_at);
  const detail = buildChangeDetail(diff);
  const text = [
    `Placement Calendar version ${snapshot.version} was captured at ${capturedAt}.`,
    '',
    `Rows stored: ${snapshot.total_row_count}`,
    `Hidden rows: ${snapshot.hidden_row_count}`,
    `Parsed events: ${snapshot.total_event_count}`,
    '',
    `Compared with previous version:`,
    `Added rows: ${rowSummary.added}`,
    `Removed rows: ${rowSummary.removed}`,
    `Changed rows: ${rowSummary.changed}`,
    `Visibility changes: ${rowSummary.hidden_changed}`,
    detail,
    '',
    `Open ${PRODUCT_NAME} -> Calendar to inspect the preserved sheet and cell history.`,
  ].filter(Boolean).join('\n');
  // What the chat and WhatsApp channels send. They used to carry the counts alone, which said
  // something had changed without saying what.
  const chatText = [
    `Placement Calendar v${snapshot.version} captured`,
    `Rows: ${snapshot.total_row_count}, hidden: ${snapshot.hidden_row_count}, events: ${snapshot.total_event_count}`,
    `Changes: +${rowSummary.added}, -${rowSummary.removed}, ${rowSummary.changed} changed, ${rowSummary.hidden_changed} visibility`,
    detail,
  ].filter(Boolean).join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; color: #202124; line-height: 1.5;">
      <h2 style="margin: 0 0 8px;">Placement Calendar v${escapeHtml(snapshot.version)}</h2>
      <p>Captured at ${escapeHtml(capturedAt)}.</p>
      <p>
        <strong>Rows:</strong> ${escapeHtml(snapshot.total_row_count)}
        &nbsp; <strong>Hidden:</strong> ${escapeHtml(snapshot.hidden_row_count)}
        &nbsp; <strong>Events:</strong> ${escapeHtml(snapshot.total_event_count)}
      </p>
      <p>
        <strong>Added:</strong> ${escapeHtml(rowSummary.added)}
        &nbsp; <strong>Removed:</strong> ${escapeHtml(rowSummary.removed)}
        &nbsp; <strong>Changed:</strong> ${escapeHtml(rowSummary.changed)}
        &nbsp; <strong>Visibility:</strong> ${escapeHtml(rowSummary.hidden_changed)}
      </p>
      ${detail ? `<pre style="white-space: pre-wrap; font-family: 'Courier New', monospace; font-size: 13px; background: #f4f6f6; border: 1px solid #e0e4e4; border-radius: 6px; padding: 12px;">${escapeHtml(detail.trim())}</pre>` : ''}
      <p>Open ${PRODUCT_NAME} -> Calendar to inspect the preserved sheet and cell history.</p>
    </div>
  `;

  return { subject, text, chatText, html };
};

export const sendPlacementCalendarChangeEmail = async ({ snapshot, diff }) => {
  const mailer = getTransporter();
  if (!mailer) {
    return { channel: 'email', sent: false, reason: 'smtp-not-configured' };
  }

  const { subject, text, html } = buildNotificationContent({ snapshot, diff });

  const info = await mailer.sendMail({
    from: smtpFrom,
    to: notificationTo,
    subject,
    text,
    html,
  });

  return { channel: 'email', sent: true, message_id: info.messageId, to: notificationTo };
};

export const sendPlacementCalendarGoogleChatNotification = async ({ snapshot, diff }) => {
  if (!isCalendarGoogleChatConfigured()) {
    return { channel: 'google_chat', sent: false, reason: 'webhook-not-configured' };
  }

  const { chatText } = buildNotificationContent({ snapshot, diff });
  const response = await fetch(googleChatWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: chatText }),
  });

  if (!response.ok) {
    throw new Error(`Google Chat notification failed with HTTP ${response.status}`);
  }

  return { channel: 'google_chat', sent: true };
};

export const sendPlacementCalendarWhatsappNotification = async ({ snapshot, diff }) => {
  if (!isCalendarWhatsappConfigured()) {
    return { channel: 'whatsapp', sent: false, reason: 'whatsapp-not-configured' };
  }

  const { chatText } = buildNotificationContent({ snapshot, diff });
  const response = await fetch(`https://graph.facebook.com/${whatsappApiVersion}/${whatsappPhoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${whatsappToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: whatsappTo,
      type: 'text',
      text: {
        preview_url: false,
        body: chatText,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`WhatsApp notification failed with HTTP ${response.status}${body ? `: ${body.slice(0, 240)}` : ''}`);
  }

  return { channel: 'whatsapp', sent: true };
};

export const sendPlacementCalendarChangeNotifications = async ({ snapshot, diff }) => {
  const senders = [
    { channel: 'email', send: sendPlacementCalendarChangeEmail },
    { channel: 'google_chat', send: sendPlacementCalendarGoogleChatNotification },
    { channel: 'whatsapp', send: sendPlacementCalendarWhatsappNotification },
  ];
  const results = [];

  for (const sender of senders) {
    try {
      results.push(await sender.send({ snapshot, diff }));
    } catch (err) {
      results.push({
        channel: sender.channel,
        sent: false,
        reason: err.message,
      });
    }
  }

  return results;
};
