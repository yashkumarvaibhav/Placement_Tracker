import { describe, expect, it } from 'vitest';
import { buildNotificationContent } from '../src/calendar-notifications.js';

const snapshot = {
  version: 7,
  created_at: '2026-08-09T04:00:00.000Z',
  total_row_count: 3,
  hidden_row_count: 0,
  total_event_count: 2,
};

// Ten columns, so anything that only reported the first few would be caught.
const headers = [
  'Company', 'Role', 'CTC', 'Batch', 'Branch',
  'Mode', 'Deadline', 'Test Date', 'Interview Date', 'Status',
].map((label, index) => ({ label, column: String.fromCharCode(65 + index) }));

const row = (values, extra = {}) => ({ source_row_number: 12, values, ...extra });

const diffWith = (rows) => ({
  target: { raw_snapshot: { headers } },
  base: { raw_snapshot: { headers } },
  rows: { summary: { added: 0, removed: 0, changed: 0, hidden_changed: 0 }, ...rows },
});

const before = ['Acme', 'SDE', '30 LPA', '2027', 'CSE', 'On-campus', '10 Aug', '12 Aug', '20 Aug', 'Open'];

describe('calendar change notifications', () => {
  it('reports the earlier row, the changed row and the exact change', () => {
    const after = [...before];
    after[2] = '32 LPA';
    const { chatText } = buildNotificationContent({
      snapshot,
      diff: diffWith({ changed: [{ before: row(before), after: row(after) }] }),
    });

    expect(chatText).toContain('earlier row : Acme | SDE | 30 LPA | 2027 | CSE | On-campus | 10 Aug | 12 Aug | 20 Aug | Open');
    expect(chatText).toContain('changed row : Acme | SDE | 32 LPA | 2027 | CSE | On-campus | 10 Aug | 12 Aug | 20 Aug | Open');
    expect(chatText).toContain('exact change : changed CTC from 30 LPA to 32 LPA');
  });

  it('names a column far past the sixth, which the old preview truncated away', () => {
    const after = [...before];
    after[9] = 'Closed';
    const { chatText } = buildNotificationContent({
      snapshot,
      diff: diffWith({ changed: [{ before: row(before), after: row(after) }] }),
    });

    expect(chatText).toContain('exact change : changed Status from Open to Closed');
  });

  it('reports every changed column, not just the first', () => {
    const after = [...before];
    after[1] = 'SDE-2';
    after[6] = '11 Aug';
    const { chatText } = buildNotificationContent({
      snapshot,
      diff: diffWith({ changed: [{ before: row(before), after: row(after) }] }),
    });

    expect(chatText).toContain('exact change : changed Role from SDE to SDE-2');
    expect(chatText).toContain('exact change : changed Deadline from 10 Aug to 11 Aug');
  });

  it('marks a value arriving in a previously empty column as blank -> value', () => {
    const emptied = [...before];
    emptied[8] = '';
    const { chatText } = buildNotificationContent({
      snapshot,
      diff: diffWith({ changed: [{ before: row(emptied), after: row(before) }] }),
    });

    expect(chatText).toContain('exact change : changed Interview Date from (blank) to 20 Aug');
  });

  it('falls back to the spreadsheet column letter when a column has no heading', () => {
    const after = [...before, 'extra'];
    const { chatText } = buildNotificationContent({
      snapshot,
      diff: diffWith({ changed: [{ before: row(before), after: row(after) }] }),
    });

    expect(chatText).toContain('exact change : changed K from (blank) to extra');
  });

  it('says what moved when only a note or link changed and the text did not', () => {
    const cells = (note) => before.map((_, index) => (index === 3 ? { note } : {}));
    const { chatText } = buildNotificationContent({
      snapshot,
      diff: diffWith({
        changed: [{
          before: row(before, { cells: cells('old note') }),
          after: row(before, { cells: cells('new note') }),
        }],
      }),
    });

    expect(chatText).toContain('exact change : changed Batch note from old note to new note');
    expect(chatText).not.toContain('content preserved');
  });

  it('sends the detail to chat, not only the counts', () => {
    const after = [...before];
    after[2] = '32 LPA';
    const { chatText } = buildNotificationContent({
      snapshot,
      diff: diffWith({ changed: [{ before: row(before), after: row(after) }] }),
    });

    expect(chatText).toContain('Placement Calendar v7 captured');
    expect(chatText).toContain('Changed rows');
    expect(chatText.split('\n').length).toBeGreaterThan(5);
  });

  it('stays inside the 4096-character limit chat and WhatsApp impose', () => {
    const changed = Array.from({ length: 200 }, (_, index) => ({
      before: { source_row_number: index, values: before },
      after: { source_row_number: index, values: [...before.slice(0, 2), `${index} LPA`, ...before.slice(3)] },
    }));
    const { chatText } = buildNotificationContent({ snapshot, diff: diffWith({ changed }) });

    expect(chatText.length).toBeLessThan(4096);
    expect(chatText).toContain('more');
  });

  it('reports added and removed rows in full', () => {
    const { chatText } = buildNotificationContent({
      snapshot,
      diff: diffWith({ added: [row(before)], removed: [row(before)] }),
    });

    expect(chatText).toContain('Added rows');
    expect(chatText).toContain('Removed rows');
    expect(chatText).toContain('row : Acme | SDE | 30 LPA | 2027 | CSE | On-campus | 10 Aug | 12 Aug | 20 Aug | Open');
  });

  it('survives a first snapshot with no diff to compare against', () => {
    const { chatText, text, html } = buildNotificationContent({ snapshot, diff: null });
    expect(chatText).toContain('Placement Calendar v7 captured');
    expect(text).toContain('Placement Calendar version 7');
    expect(html).toContain('Placement Calendar v7');
  });
});
