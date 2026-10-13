'use strict';

/**
 * Escape a Markdown table cell without trimming its surrounding whitespace.
 * @param {*} value Cell value; null and undefined become an empty string.
 * @returns {string} Text with escaped pipes and line breaks replaced by spaces.
 */
function mdCell(value) {
  return String(value == null ? '' : value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * Format one Markdown table row, escaping each cell.
 * @param {Array<*>} cells Cell values in column order.
 * @returns {string} A pipe-delimited row with a space around each cell.
 */
function mdRow(cells) {
  return `| ${cells.map(mdCell).join(' | ')} |`;
}

/**
 * Format a Markdown table with a header, separator and optional data rows.
 * @param {Array<*>} header Column headings.
 * @param {Array<Array<*>>} rows Data rows matching the header's column count.
 * @param {Array<'l'|'r'|'c'>} [align=[]] Per-column alignment; omitted columns use '---'.
 * @returns {string} Newline-separated table without a trailing newline.
 * @throws {Error} If a data row has the wrong column count; names its zero-based index.
 */
function mdTable(header, rows, align = []) {
  const separator = header.map((_, index) => {
    const direction = align[index];
    return direction === 'l' ? ':---' : direction === 'r' ? '---:' : direction === 'c' ? ':---:' : '---';
  });
  const body = rows.map((row, index) => {
    if (row.length !== header.length) {
      throw new Error(`Markdown table row ${index} has ${row.length} columns; expected ${header.length}`);
    }
    return mdRow(row);
  });
  return [mdRow(header), mdRow(separator), ...body].join('\n');
}

module.exports = { mdCell, mdRow, mdTable };
