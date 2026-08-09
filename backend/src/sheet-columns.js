// Spreadsheet column name for a zero-based index: 0 -> A, 25 -> Z, 26 -> AA.
// Lives on its own because both the sync and the change notifications need it, and importing
// one from the other would make the pair circular.
export const columnName = (index) => {
  let name = '';
  let current = Number(index) + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
};

export default columnName;
