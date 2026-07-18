import { describe, expect, it } from 'vitest';
import { extractTables } from './tables.js';

describe('extractTables', () => {
  it('extracts a classic header-row table into row objects', () => {
    const html = `
      <table>
        <tr><th>Name</th><th>Price</th></tr>
        <tr><td>Widget</td><td>$5</td></tr>
        <tr><td>Gadget</td><td>$10</td></tr>
      </table>
    `;

    const tables = extractTables(html);

    expect(tables).toEqual([
      [
        { Name: 'Widget', Price: '$5' },
        { Name: 'Gadget', Price: '$10' },
      ],
    ]);
  });

  it('collapses a key-value style table (per-row <th>) into a single record', () => {
    const html = `
      <table class="table table-striped">
        <tr><th>UPC</th><td>a897fe39b1053632</td></tr>
        <tr><th>Price (excl. tax)</th><td>&#163;51.77</td></tr>
        <tr><th>Availability</th><td>In stock (22 available)</td></tr>
      </table>
    `;

    const tables = extractTables(html);

    expect(tables).toEqual([
      [
        {
          UPC: 'a897fe39b1053632',
          'Price (excl. tax)': '£51.77',
          Availability: 'In stock (22 available)',
        },
      ],
    ]);
  });

  it('returns an empty array when there are no tables', () => {
    expect(extractTables('<p>no tables here</p>')).toEqual([]);
  });

  it('extracts multiple tables independently', () => {
    const html = `
      <table><tr><th>A</th></tr><tr><td>1</td></tr></table>
      <table><tr><th>B</th></tr><tr><td>2</td></tr></table>
    `;
    expect(extractTables(html)).toEqual([[{ A: '1' }], [{ B: '2' }]]);
  });
});
