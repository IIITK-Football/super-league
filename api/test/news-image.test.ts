// Group: api-services. News images upload THROUGH the Worker (no presigned URL, no R2 credentials): an editor or
// dictator posts the image, it is stored under a server key through the R2_NEWS binding, and the public bucket URL is
// returned. A normal account, no session, a wrong or spoofed type, an oversize file and a missing binding are refused
// and store nothing. Runs the Worker app against THIS repository's local Supabase stack (127.0.0.1:54321).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { bindBuckets } from '../../backend/lib/storage';
import { clients, localKeys, uniqueEmail } from '../../backend/tests/auth/local-supabase';
import { memoryBucket } from './memory-bucket';

let app: ReturnType<typeof createApp>;
let admin: ReturnType<typeof clients>['admin'];
const users: string[] = [];
const token: Record<string, string> = {};
let store = memoryBucket();

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0, 0, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

async function account(label: string, role?: string) {
  const keys = localKeys();
  const c = clients(keys);
  const { data, error } = await admin.auth.admin.createUser({ email: uniqueEmail(`news-${label}`), email_confirm: true });
  if (error) throw error;
  users.push(data.user.id);
  if (role) await admin.from('user_roles').upsert({ user_id: data.user.id, role }, { onConflict: 'user_id,role', ignoreDuplicates: true });
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: data.user.email! });
  const v = await c.anon().auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: 'magiclink' });
  if (v.error) throw v.error;
  return v.data.session!.access_token;
}

beforeAll(async () => {
  const keys = localKeys();
  Object.assign(process.env, {
    SUPABASE_URL: keys.url, SUPABASE_PUBLISHABLE_KEY: keys.publishable, SUPABASE_SECRET_KEY: keys.secret,
    SL_ENVIRONMENT: 'local', MEDIA_BASE_NEWS: 'https://pub-staging-news.r2.dev',
  });
  admin = clients(keys).admin;
  app = createApp();
  token.editor = await account('editor', 'editor');
  token.dictator = await account('dictator', 'dictator');
  token.normal = await account('normal');
}, 60000);

afterAll(async () => {
  for (const id of users) await admin.auth.admin.deleteUser(id);
  bindBuckets({});
}, 30000);

beforeEach(() => {
  store = memoryBucket();
  bindBuckets({ R2_NEWS: store.bucket });
});

const upload = (who: string | null, bytes: Uint8Array, type: string) => {
  const form = new FormData();
  form.set('image', new File([bytes.slice()], 'my holiday photo.png', { type }));
  return app.request('http://localhost/api/admin/newsletter/image', {
    method: 'POST',
    headers: who ? { Authorization: `Bearer ${token[who]}` } : {},
    body: form,
  });
};

describe('news image upload through the Worker', () => {
  it.each(['editor', 'dictator'])('stores an image for an %s under a server key and returns its public URL', async (who) => {
    const res = await upload(who, JPEG, 'image/jpeg');
    expect(res.status).toBe(200);
    const body = await res.json();
    const [key] = [...store.objects.keys()];
    expect(key).toMatch(/^news\/[0-9a-f-]{36}\.jpg$/);
    expect(key).not.toContain('holiday');
    expect(store.objects.get(key)?.contentType).toBe('image/jpeg');
    expect(body.publicUrl).toBe(`https://pub-staging-news.r2.dev/${key}`);
  });

  it('refuses a normal account', async () => {
    expect((await upload('normal', PNG, 'image/png')).status).toBe(403);
    expect(store.objects.size).toBe(0);
  });

  it('refuses without a session before the handler runs', async () => {
    expect((await upload(null, PNG, 'image/png')).status).toBe(401);
    expect(store.objects.size).toBe(0);
  });

  it('refuses a type that is not an image', async () => {
    expect((await upload('editor', new TextEncoder().encode('<svg onload=alert(1)>'), 'image/svg+xml')).status).toBe(400);
    expect(store.objects.size).toBe(0);
  });

  it('refuses bytes that do not match the declared type', async () => {
    expect((await upload('editor', JPEG, 'image/png')).status).toBe(400);
    expect(store.objects.size).toBe(0);
  });

  it('refuses a file over 10 MB', async () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(PNG);
    expect((await upload('editor', big, 'image/png')).status).toBe(413);
    expect(store.objects.size).toBe(0);
  });

  it('answers 503 when the news binding is missing', async () => {
    bindBuckets({});
    expect((await upload('editor', PNG, 'image/png')).status).toBe(503);
  });

  it('the presigned upload route is gone', async () => {
    expect((await app.request('http://localhost/api/admin/newsletter/upload-url', { method: 'POST', headers: { Authorization: `Bearer ${token.editor}` } })).status).toBe(404);
  });
});
