import * as cheerio from 'cheerio';

export type TableRow = Record<string, string>;

// Handles two common shapes:
//  - classic tabular: one header row of column names, followed by data rows
//  - key-value: every row is its own <th>key</th><td>value</td> pair (common
//    for "product info" style tables), which we collapse into a single record
export function extractTables(rawHtml: string): TableRow[][] {
  const $ = cheerio.load(rawHtml);
  const tables: TableRow[][] = [];

  $('table').each((_, tableEl) => {
    const $rows = $(tableEl).find('tr').toArray();
    if ($rows.length === 0) return;

    const isKeyValue = $rows.every((row) => $(row).children().first().is('th'));

    if (isKeyValue) {
      const record: TableRow = {};
      for (const row of $rows) {
        const $cells = $(row).children();
        const key = $cells.first().text().trim();
        const value = $cells
          .slice(1)
          .map((_, cell) => $(cell).text().trim())
          .get()
          .join(' ');
        if (key) record[key] = value;
      }
      if (Object.keys(record).length > 0) tables.push([record]);
      return;
    }

    const headerRow = $rows[0];
    if (!headerRow) return;
    const headers = $(headerRow)
      .find('th, td')
      .map((i, cell) => $(cell).text().trim() || `column_${i}`)
      .get();

    const rows: TableRow[] = [];
    for (const row of $rows.slice(1)) {
      const $cells = $(row).find('td, th');
      if ($cells.length === 0) continue;

      const record: TableRow = {};
      $cells.each((i, cell) => {
        record[headers[i] ?? `column_${i}`] = $(cell).text().trim();
      });
      rows.push(record);
    }

    if (rows.length > 0) tables.push(rows);
  });

  return tables;
}
