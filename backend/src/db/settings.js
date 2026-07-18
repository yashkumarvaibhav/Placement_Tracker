import { query } from './client.js';

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
