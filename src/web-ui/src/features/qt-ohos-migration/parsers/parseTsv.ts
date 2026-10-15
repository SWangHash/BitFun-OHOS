import type { LedgerRow, ParsedTsv } from '../model/types';

/**
 * Tolerant TSV parser for the migration ledgers.
 *
 * Accepts BOM, CRLF, blank lines, short rows and long rows. Values are taken by
 * column name so column reordering in future skill versions keeps working.
 */
export function parseTsv(text: string | undefined, expectedHeader?: readonly string[]): ParsedTsv {
  const source = (text ?? '').replace(/^\uFEFF/, '');
  const lines = source.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return {
      header: [],
      rows: [],
      missingColumns: expectedHeader ? [...expectedHeader] : [],
      extraColumns: [],
    };
  }

  const header = lines[0].split('\t').map((cell) => cell.trim());
  const rows: LedgerRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split('\t');
    const row: LedgerRow = {};
    header.forEach((column, index) => {
      if (column) row[column] = (cells[index] ?? '').trim();
    });
    rows.push(row);
  }

  const headerSet = new Set(header);
  const expectedSet = new Set(expectedHeader ?? []);
  return {
    header,
    rows,
    missingColumns: expectedHeader ? expectedHeader.filter((column) => !headerSet.has(column)) : [],
    extraColumns: expectedHeader ? header.filter((column) => column && !expectedSet.has(column)) : [],
  };
}
