import nodemailer from 'nodemailer';

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

const rowPreview = (row = {}) => (row.values || [])
  .map((value) => String(value || '').trim())
  .filter(Boolean)
  .slice(0, 6)
  .join(' | ') || 'Blank row';

const changedRowPreview = (item = {}) => {
  const before = rowPreview(item.before);
  const after = rowPreview(item.after);
  if (before === after) return `Row ${item.after?.source_row_number || item.before?.source_row_number}: content preserved`;
  return `Row ${item.after?.source_row_number || item.before?.source_row_number}: ${before} -> ${after}`;
};

const listRows = (title, rows = [], mapper = rowPreview) => {
  if (!rows.length) return '';
  const items = rows.slice(0, 8).map((row) => `- ${mapper(row)}`).join('\n');
  const suffix = rows.length > 8 ? `\n- ...and ${rows.length - 8} more` : '';
  return `\n${title}\n${items}${suffix}\n`;
};

const listRowsHtml = (title, rows = [], mapper = rowPreview) => {
  if (!rows.length) return '';
  const items = rows.slice(0, 8)
    .map((row) => `<li>${escapeHtml(mapper(row))}</li>`)
    .join('');
  const suffix = rows.length > 8 ? `<li>...and ${rows.length - 8} more</li>` : '';
  return `<h3>${escapeHtml(title)}</h3><ul>${items}${suffix}</ul>`;
};

const buildNotificationContent = ({ snapshot, diff }) => {
  const rowSummary = diff?.rows?.summary || {
    added: snapshot?.total_row_count || 0,
    removed: 0,
    changed: 0,
    hidden_changed: snapshot?.hidden_row_count || 0,
  };
  const subject = `Placement Calendar v${snapshot.version} captured: ${rowSummary.added} added, ${rowSummary.removed} removed, ${rowSummary.changed} changed`;
  const capturedAt = formatDateTime(snapshot.created_at);
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
    listRows('Added rows', diff?.rows?.added || []),
    listRows('Removed rows', diff?.rows?.removed || []),
    listRows('Changed rows', diff?.rows?.changed || [], changedRowPreview),
    listRows('Visibility changes', diff?.rows?.hidden_changed || [], changedRowPreview),
    '',
    'Open Placement Atlas -> Calendar to inspect the preserved sheet and cell history.',
  ].filter(Boolean).join('\n');
  const shortText = [
    `Placement Calendar v${snapshot.version} captured`,
    `Rows: ${snapshot.total_row_count}, hidden: ${snapshot.hidden_row_count}, events: ${snapshot.total_event_count}`,
    `Changes: +${rowSummary.added}, -${rowSummary.removed}, ${rowSummary.changed} changed, ${rowSummary.hidden_changed} visibility`,
  ].join('\n');

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
      ${listRowsHtml('Added rows', diff?.rows?.added || [])}
      ${listRowsHtml('Removed rows', diff?.rows?.removed || [])}
      ${listRowsHtml('Changed rows', diff?.rows?.changed || [], changedRowPreview)}
      ${listRowsHtml('Visibility changes', diff?.rows?.hidden_changed || [], changedRowPreview)}
      <p>Open Placement Atlas -> Calendar to inspect the preserved sheet and cell history.</p>
    </div>
  `;

  return { subject, text, shortText, html };
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

  const { shortText } = buildNotificationContent({ snapshot, diff });
  const response = await fetch(googleChatWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: shortText }),
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

  const { shortText } = buildNotificationContent({ snapshot, diff });
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
        body: shortText,
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
