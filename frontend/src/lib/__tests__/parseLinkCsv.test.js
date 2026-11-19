// Group: frontend-components. The account-link import file: header `player_id,email`, one player per line, quoted
// fields, a blank email kept blank (the database then uses the contact email), and clear errors for a wrong shape.
import { describe, expect, it } from 'vitest';
import { MAX_LINK_ROWS, parseLinkCsv } from '../parseLinkCsv';

describe('parseLinkCsv', () => {
  it('reads rows under the header, trimming cells and skipping blank lines', () => {
    expect(parseLinkCsv('\uFEFFPlayer_ID, Email\r\n a1 , x@y.in \n\n"b2",""\nc3\n')).toEqual({
      rows: [{ player_id: 'a1', email: 'x@y.in' }, { player_id: 'b2', email: '' }, { player_id: 'c3', email: '' }], error: '',
    });
  });

  it('keeps quoted commas and quotes inside a field', () => {
    expect(parseLinkCsv('player_id,email\n"a,1","x""y@z.in"').rows).toEqual([{ player_id: 'a,1', email: 'x"y@z.in' }]);
  });

  it('explains a wrong shape instead of guessing', () => {
    expect(parseLinkCsv('').error).toMatch(/header line/);
    expect(parseLinkCsv('email,player_id\na,b').error).toMatch(/first line must be the header/);
    expect(parseLinkCsv('player_id,email').error).toMatch(/no players/);
    expect(parseLinkCsv('player_id,email\na,b,c').error).toMatch(/Line 2/);
    expect(parseLinkCsv('player_id,email\n"a,b').error).toMatch(/Line 2/);
    const many = ['player_id,email', ...Array.from({ length: MAX_LINK_ROWS + 1 }, (_, i) => `p${i},`)].join('\n');
    expect(parseLinkCsv(many).error).toMatch(/At most 500/);
  });
});
