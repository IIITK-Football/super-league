// Reads and writes the small YAML subset used by backlog item files (backlog/items/SL-xxx.md). No dependency:
// the format is deliberately limited so it can be parsed and rewritten exactly.
//
//   ---
//   id: SL-018                      scalar: string, number, true/false/null, or a "double quoted" JSON string
//   dependsOn: [SL-010, SL-011]     flow list of scalars
//   checks:                         block list of flat mappings (one level only)
//     - id: C1
//       text: "..."
//   ---
//   free Markdown body, kept byte for byte
const KEY_ORDER = ['id', 'title', 'phase', 'status', 'legacy', 'startCommit', 'dependsOn', 'decisions', 'groups', 'plan', 'walkthrough', 'checks'];

function parseScalar(raw) {
  const v = raw.trim();
  if (v === '') return '';
  if (v.startsWith('"')) return JSON.parse(v);
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  if (/^-?\d+$/.test(v)) return Number(v);
  if (v.startsWith('[') || v.startsWith('{')) throw new Error(`unsupported value: ${v}`);
  return v;
}

function splitFlow(inner) {
  const parts = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '"' && inner[i - 1] !== '\\') quoted = !quoted;
    if (c === ',' && !quoted) {
      parts.push(cur);
      cur = '';
    } else cur += c;
  }
  if (cur.trim() !== '') parts.push(cur);
  return parts.map(parseScalar);
}

function parseValue(raw) {
  const v = raw.trim();
  if (v.startsWith('[')) {
    if (!v.endsWith(']')) throw new Error(`unsupported value: ${v}`);
    return splitFlow(v.slice(1, -1));
  }
  return parseScalar(v);
}

export function parseItem(text) {
  if (!text.startsWith('---\n')) throw new Error('missing front matter (the file must start with ---)');
  const end = text.indexOf('\n---\n', 3);
  if (end < 0) {
    if (text.endsWith('\n---')) return parseItem(`${text}\n`);
    throw new Error('unterminated front matter (no closing ---)');
  }
  const block = text.slice(4, end);
  const body = text.slice(end + 5);
  const meta = {};
  let list = null; // the key currently collecting a block list of mappings
  let item = null;
  for (const line of block.split('\n')) {
    if (line.trim() === '') continue;
    const top = line.match(/^([A-Za-z][A-Za-z0-9]*):(?: (.*))?$/);
    if (top && !line.startsWith(' ')) {
      const [, key, value] = top;
      if (key in meta) throw new Error(`duplicate key: ${key}`);
      list = null;
      item = null;
      if (value === undefined || value === '') {
        meta[key] = [];
        list = key;
      } else meta[key] = parseValue(value);
      continue;
    }
    const start = line.match(/^ {2}- ([A-Za-z][A-Za-z0-9]*): ?(.*)$/);
    if (start && list) {
      item = { [start[1]]: parseScalar(start[2]) };
      meta[list].push(item);
      continue;
    }
    const more = line.match(/^ {4}([A-Za-z][A-Za-z0-9]*): ?(.*)$/);
    if (more && item) {
      if (more[1] in item) throw new Error(`duplicate key in list item: ${more[1]}`);
      item[more[1]] = parseScalar(more[2]);
      continue;
    }
    throw new Error(`unsupported front matter syntax: ${line}`);
  }
  return { meta, body };
}

// Canonical form: a string with no whitespace and only safe characters stays plain (ids, statuses, paths, `test:path`);
// anything else is a double-quoted JSON string. The same input always serializes the same way.
const PLAIN = /^[A-Za-z0-9_./@:()+-]+$/;
function scalar(v) {
  if (typeof v === 'string') {
    const ambiguous = v === '' || /^(true|false|null)$/.test(v) || /^-?\d+$/.test(v);
    return !ambiguous && PLAIN.test(v) ? v : JSON.stringify(v);
  }
  return String(v);
}

export function serializeItem({ meta, body }) {
  const keys = [...KEY_ORDER.filter((k) => k in meta), ...Object.keys(meta).filter((k) => !KEY_ORDER.includes(k))];
  const lines = ['---'];
  for (const key of keys) {
    const v = meta[key];
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && v[0] !== null) {
      lines.push(`${key}:`);
      for (const entry of v) {
        const entries = Object.entries(entry);
        entries.forEach(([k, val], i) => lines.push(`${i === 0 ? '  - ' : '    '}${k}: ${scalar(val)}`));
      }
    } else if (Array.isArray(v)) {
      lines.push(`${key}: [${v.map(scalar).join(', ')}]`);
    } else {
      lines.push(`${key}: ${scalar(v)}`);
    }
  }
  lines.push('---');
  return `${lines.join('\n')}\n${body}`;
}
