// Group: rosters. Player portraits use the shared storage configuration: the identity-scoped key players/<id>.png,
// and outside production an upload is refused (503, nothing sent) unless it targets a non-production bucket.
import { afterEach, describe, expect, it, vi } from 'vitest';

const sent: unknown[] = [];
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { send = async (cmd: unknown) => { sent.push(cmd); return {}; }; },
  PutObjectCommand: class { constructor(public input: unknown) {} },
}));
const { ImageError, portraitKey, uploadPortrait } = await import('@/lib/roster/playerImage');

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  sent.length = 0;
});
const configure = (bucket: string, url = 'https://players.example.test') =>
  Object.assign(process.env, { SL_ENVIRONMENT: 'staging', R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'b', R2_SECRET_ACCESS_KEY: 'c', MEDIA_PLAYERS_BUCKET: bucket, MEDIA_PLAYERS_PUBLIC_URL: url });

describe('player portrait storage', () => {
  it('uses the identity-scoped key', () => {
    expect(portraitKey('p1')).toBe('players/p1.png');
  });

  it('uploads to a staging bucket and returns its public URL', async () => {
    configure('sl-staging-player-images');
    expect(await uploadPortrait('players/p1.png', Buffer.from([1]))).toBe('https://players.example.test/players/p1.png');
    expect(sent).toHaveLength(1);
  });

  it.each([['fresher-images'], ['player-images']])('refuses production bucket %s outside production, sending nothing', async (bucket) => {
    configure(bucket);
    await expect(uploadPortrait('players/p1.png', Buffer.from([1]))).rejects.toMatchObject({ status: 503 });
    await expect(uploadPortrait('players/p1.png', Buffer.from([1]))).rejects.toBeInstanceOf(ImageError);
    expect(sent).toHaveLength(0);
  });

  it('refuses the production portrait host outside production', async () => {
    configure('sl-staging-player-images', 'https://pub-156b66d0ff7841bc9601620610a8ebd3.r2.dev');
    await expect(uploadPortrait('players/p1.png', Buffer.from([1]))).rejects.toMatchObject({ status: 503 });
    expect(sent).toHaveLength(0);
  });
});
