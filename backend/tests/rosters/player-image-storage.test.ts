// Group: rosters. Player portraits use the shared binding-backed storage: the identity-scoped key players/<id>.png, and
// an upload is refused (503, nothing stored) when the R2_PLAYERS binding or its public base is missing, or when the
// public base is a production host outside production.
import { afterEach, describe, expect, it } from 'vitest';
import { ImageError, portraitKey, uploadPortrait } from '@/lib/roster/playerImage';
import { bindBuckets, type Bucket } from '@/lib/storage';

const stored = new Map<string, unknown>();
const bucket: Bucket = { put: async (key, value) => { stored.set(key, value); return {}; }, delete: async (key) => { stored.delete(key); } };

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  stored.clear();
  bindBuckets({});
});
const configure = (base = 'https://pub-staging-players.r2.dev') => Object.assign(process.env, { SL_ENVIRONMENT: 'staging', MEDIA_BASE_PLAYERS: base });

describe('player portrait storage', () => {
  it('uses the identity-scoped key', () => {
    expect(portraitKey('p1')).toBe('players/p1.png');
  });

  it('stores through the R2_PLAYERS binding and returns the public URL', async () => {
    bindBuckets({ R2_PLAYERS: bucket });
    configure();
    expect(await uploadPortrait('players/p1.png', Buffer.from([1]))).toBe('https://pub-staging-players.r2.dev/players/p1.png');
    expect([...stored.keys()]).toEqual(['players/p1.png']);
  });

  it('refuses without the binding, storing nothing', async () => {
    configure();
    await expect(uploadPortrait('players/p1.png', Buffer.from([1]))).rejects.toBeInstanceOf(ImageError);
    await expect(uploadPortrait('players/p1.png', Buffer.from([1]))).rejects.toMatchObject({ status: 503 });
  });

  it('refuses the production portrait host outside production, storing nothing', async () => {
    bindBuckets({ R2_PLAYERS: bucket });
    configure('https://pub-156b66d0ff7841bc9601620610a8ebd3.r2.dev');
    await expect(uploadPortrait('players/p1.png', Buffer.from([1]))).rejects.toMatchObject({ status: 503 });
    expect(stored.size).toBe(0);
  });
});
