import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const sourcePath = path.join(repoRoot, 'historical-placement-import-report.json');
const outputPath = path.join(repoRoot, 'btech-2026-data-differences.csv');

const report = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const batch = report.batches.find((item) => item.batch_key === 'btech-2026');
if (!batch) throw new Error('B.Tech 2026 comparison was not found in the import report.');

const formatValue = (value) => {
  if (Array.isArray(value)) return value.join(' | ');
  if (value === null || value === undefined) return '';
  return String(value);
};

const newRows = batch.conflicts.map((conflict) => ({
  category: `${conflict.entity}.${conflict.field}`,
  roll_number: conflict.roll_number || '',
  student: conflict.student || '',
  company: conflict.company || '',
  field: conflict.field,
  earlier_database_value: formatValue(conflict.existing),
  new_csv_value: formatValue(conflict.incoming),
  action_taken: conflict.action,
  source_row: conflict.source_row || '',
}));

const existingRows = fs.existsSync(outputPath)
  ? XLSX.utils.sheet_to_json(
    XLSX.readFile(outputPath, { raw: false }).Sheets.Sheet1,
    { defval: '' }
  ).map(({ difference_number, ...row }) => row)
  : [];

const retainedExistingRows = existingRows
  .filter((row) => ![
    'removed because absent from new CSV',
    'removed because student is absent from new CSV',
    'applied new CSV placement set',
  ].includes(row.action_taken))
  .map((row) => ({
    ...row,
    action_taken: row.action_taken === 'replaced offer set with new CSV value'
      ? 'added new-only offer; preserved earlier offer'
      : row.action_taken,
  }));

const preservedRows = (batch.preserved_earlier_only_offers || []).map((offer) => ({
  category: 'offer.company',
  roll_number: offer.roll_number,
  student: offer.student,
  company: offer.company,
  field: 'company',
  earlier_database_value: offer.company,
  new_csv_value: '',
  action_taken: 'preserved earlier-only offer',
  source_row: '',
}));

const rowKey = (row) => [
  row.category,
  row.roll_number,
  row.student,
  row.company,
  row.field,
  row.earlier_database_value,
  row.new_csv_value,
  row.action_taken,
].join('|');

const combinedRows = new Map(retainedExistingRows.map((row) => [rowKey(row), row]));
for (const row of newRows) combinedRows.set(rowKey(row), row);
for (const row of preservedRows) combinedRows.set(rowKey(row), row);
const rows = [...combinedRows.values()].map((row, index) => ({
  difference_number: index + 1,
  ...row,
}));

const worksheet = XLSX.utils.json_to_sheet(rows);
const csv = XLSX.utils.sheet_to_csv(worksheet);
fs.writeFileSync(outputPath, csv);

const categories = rows.reduce((counts, row) => {
  counts[row.category] = (counts[row.category] || 0) + 1;
  return counts;
}, {});

console.log(JSON.stringify({ output: outputPath, differences: rows.length, categories }, null, 2));
