/**
 * The tokenizer port (Story 9.1): text and a delimiter in, rows of cells out. The phone may put Papa Parse behind this; the
 * reference implementation below is pure, handles RFC 4180 quoting, and is what core and its tests use.
 */
export type CsvTokenizer = (text: string, delimiter: string) => string[][];

/**
 * Splits CSV text into rows of cells. A quoted field keeps its delimiters, doubled quotes (`""`) and line breaks as one cell, so an
 * embedded line break never adds a row. Line ends are `\r\n`, `\n` or `\r`; a final line end does not make an empty row. A blank
 * line is a row with one empty cell, so row numbers stay the file's own.
 */
export const tokenizeCsv: CsvTokenizer = (text, delimiter) => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let started = false; // anything seen on this row yet (so a trailing line end is not a row)
  const endCell = () => {
    row.push(cell);
    cell = '';
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
    started = false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') {
      quoted = true;
      started = true;
    } else if (ch === delimiter) {
      endCell();
      started = true;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      endRow();
    } else {
      cell += ch;
      started = true;
    }
  }
  if (started || cell !== '' || row.length > 0) endRow();
  return rows;
};
