// Editing helpers for rules blocks. The database decides what is valid; these only shape the editor's state and name
// the first unfinished block in words a person can act on.
export const BLOCK_TYPES = [
  { value: 'section', label: 'Titled section' },
  { value: 'callout', label: 'Eligibility callout' },
  { value: 'steps', label: 'Numbered steps' },
  { value: 'table', label: 'Table' },
  { value: 'notice', label: 'Notice' },
];

const FIELDS = {
  section: { title: '', body: '', items: [] },
  callout: { title: '', body: '', tone: 'eligibility' },
  steps: { title: '', items: [] },
  table: { title: '', columns: ['Column 1', 'Column 2'], rows: [['', '']] },
  notice: { body: '', tone: 'info' },
};

export const newBlock = (type) => ({ id: crypto.randomUUID(), type, hidden: false, ...structuredClone(FIELDS[type]) });

// What is stored: list entries trimmed, empty optional fields left out.
export function cleanBlock(block) {
  const clean = { ...block };
  if (clean.items) clean.items = clean.items.map((item) => item.trim()).filter(Boolean);
  if (clean.type === 'section' && !clean.items?.length) delete clean.items;
  for (const key of ['title', 'body']) if (key in clean && !clean[key].trim()) delete clean[key];
  return clean;
}

export function blockProblem(block) {
  const b = cleanBlock(block);
  if (['section', 'callout'].includes(b.type) && !b.title) return 'needs a title';
  if (['callout', 'notice'].includes(b.type) && !b.body) return 'needs text';
  if (b.type === 'section' && !b.body && !b.items) return 'needs text or at least one point';
  if (b.type === 'steps' && !b.items.length) return 'needs at least one step';
  if (b.type === 'table' && (b.columns.some((column) => !column.trim()) || !b.rows.length)) return 'needs a heading for every column and at least one row';
  return '';
}

// Compares block lists regardless of key order (the database does not keep it).
const canonical = (value) => JSON.stringify(value, (_, v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, v[key]])) : v));
export const sameBlocks = (a, b) => canonical(a) === canonical(b);
export const visibleBlocks = (blocks) => blocks.filter((block) => !block.hidden).map(cleanBlock);
export const blockLabel = (block) => block.title?.trim() || block.body?.trim() || block.items?.[0] || block.columns?.join(', ') || 'Empty';
