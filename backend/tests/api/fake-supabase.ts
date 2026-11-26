// Test double for the Supabase client used by route handlers. Every query builder method returns the builder, and
// awaiting it yields the result set for that table (or RPC name) in `db`. Tests fill `db` per case.
export type Result = { data: unknown; error: unknown };

export const db = {
  tables: {} as Record<string, Result>,
  rpc: {} as Record<string, Result>,
  user: null as { id: string } | null,
  inserts: [] as { table: string; row: unknown }[],
  deletes: [] as string[],
};

export const reset = () => {
  db.tables = {};
  db.rpc = {};
  db.user = null;
  db.inserts = [];
  db.deletes = [];
};

const OK: Result = { data: null, error: null };
const FILTERS = ['select', 'eq', 'neq', 'gt', 'gte', 'lt', 'in', 'is', 'or', 'order', 'limit', 'range', 'match', 'maybeSingle', 'single'];

function builder(result: Result, table = '') {
  const b: Record<string, unknown> = {};
  for (const name of FILTERS) b[name] = () => b;
  b.insert = (row: unknown) => { db.inserts.push({ table, row }); return b; };
  b.update = () => b;
  b.delete = () => { db.deletes.push(table); return b; };
  b.then = (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return b;
}

export function createFakeClient() {
  return {
    from: (table: string) => builder(db.tables[table] ?? OK, table),
    rpc: (name: string) => builder(db.rpc[name] ?? OK),
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
