// Parses the account-link import file: a CSV whose header is `player_id,email` (in that order, any case). Each data
// row names a player by id and the email of the verified account to link; a blank email means "use the player's
// contact email". Quoted fields are supported. Returns { rows: [{ player_id, email }], error } where error explains
// the first problem with the file's shape; the database then checks every row (it never matches by name).
export const MAX_LINK_ROWS = 500;

function splitLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { cells.push(cell); cell = ''; }
    else cell += ch;
  }
  if (quoted) return null;
  cells.push(cell);
  return cells.map((c) => c.trim());
}

export function parseLinkCsv(text) {
  const lines = String(text ?? '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) return { rows: [], error: 'Paste the file: a header line `player_id,email`, then one line per player.' };
  const header = splitLine(lines[0])?.map((h) => h.toLowerCase());
  if (!header || header.length !== 2 || header[0] !== 'player_id' || header[1] !== 'email') {
    return { rows: [], error: 'The first line must be the header `player_id,email`.' };
  }
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitLine(lines[i]);
    if (!cells || cells.length > 2) return { rows: [], error: `Line ${i + 1} must have a player id and an email, separated by one comma.` };
    rows.push({ player_id: cells[0], email: cells[1] ?? '' });
  }
  if (!rows.length) return { rows: [], error: 'The file has a header but no players.' };
  if (rows.length > MAX_LINK_ROWS) return { rows: [], error: `At most ${MAX_LINK_ROWS} players per import; this file has ${rows.length}.` };
  return { rows, error: '' };
}
