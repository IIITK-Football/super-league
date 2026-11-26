// Test double for the Supabase client used by route handlers. Every query builder method returns the builder, and
// awaiting it yields the result set for that table (or RPC name) in `db`. Tests fill `db` per case and read `calls`
// to check the filters a route sent.
export type Result = { data: unknown; error: unknown; count?: number | null };
export type Call = { target: string; method: string; args: unknown[] };

export const db = {
  tables: {} as Record<string, Result>,
  rpc: {} as Record<string, Result>,
  user: null as { id: string } | null,
  calls: [] as Call[],
  inserts: [] as { table: string; row: unknown }[],
  deletes: [] as string[],
};

export const reset = () => {
  db.tables = {};
  db.rpc = {};
  db.user = null;
  db.calls = [];
  db.inserts = [];
  db.deletes = [];
};

const OK: Result = { data: null, error: null };
const FILTERS = ['select', 'eq', 'neq', 'gt', 'gte', 'lt', 'in', 'is', 'or', 'order', 'limit', 'range', 'match', 'maybeSingle', 'single'];

function builder(initial: Result, target: string) {
  let result = initial;
  const b: Record<string, unknown> = {};
  for (const method of FILTERS) b[method] = (...args: unknown[]) => { db.calls.push({ target, method, args }); return b; };
  b.insert = (row: unknown) => { db.calls.push({ target, method: 'insert', args: [row] }); db.inserts.push({ table: target, row }); return b; };
  // An update answers with db.tables['<table>.update'] when a test sets one (to fail a write, say), else the read result.
  b.update = (row: unknown) => {
    db.calls.push({ target, method: 'update', args: [row] });
    result = db.tables[`${target}.update`] ?? result;
    return b;
  };
  b.delete = () => { db.calls.push({ target, method: 'delete', args: [] }); db.deletes.push(target); return b; };
  b.then = (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return b;
}

export function createFakeClient() {
  return {
    from: (table: string) => builder(db.tables[table] ?? OK, table),
    rpc: (name: string, args?: unknown) => {
      db.calls.push({ target: name, method: 'rpc', args: [args] });
      return builder(db.rpc[name] ?? OK, name);
    },
    auth: {
      getUser: async () => (db.user
        ? { data: { user: db.user }, error: null }
        : { data: { user: null }, error: { message: 'Auth session missing' } }),
    },
  };
}

// For vi.mock('@supabase/supabase-js') and vi.mock('@supabase/ssr').
export const supabaseModule = { createClient: () => createFakeClient() };
export const ssrModule = { createServerClient: () => createFakeClient() };
