// Group: api-services. Media storage through R2 bindings fails closed: a missing binding or public base is refused,
// production media hosts are refused as public bases outside production, and keys come from the owning record.
import { afterEach, describe, expect, it } from 'vitest';
import { bindBuckets, keys, PRODUCTION_MEDIA_HOSTS, StorageError, storageFor, videoBase } from '../../backend/lib/storage';
import { memoryBucket } from './memory-bucket';

const staging = { SL_ENVIRONMENT: 'staging', MEDIA_BASE_PLAYERS: 'https://pub-staging.r2.dev/' };
afterEach(() => bindBuckets({}));

describe('media storage through bindings', () => {
  it('stores through the bound bucket and builds the public URL from the server key', async () => {
    const { bucket, objects } = memoryBucket();
    bindBuckets({ R2_PLAYERS: bucket });
    const s = storageFor('players', staging);
    await s.put(keys.player('abc'), new Uint8Array([1, 2]), 'image/png');
    expect(objects.get('players/abc.png')?.contentType).toBe('image/png');
    expect(s.publicUrl(keys.player('abc'))).toBe('https://pub-staging.r2.dev/players/abc.png');
    await s.delete('players/abc.png');
    expect(objects.size).toBe(0);
  });

  it('refuses when the binding is missing, whatever the configuration', () => {
    expect(() => storageFor('players', staging)).toThrow(/R2_PLAYERS binding is missing/);
  });

  it('ignores a binding that is not a bucket', () => {
    bindBuckets({ R2_PLAYERS: 'sl-staging-player-images' });
    expect(() => storageFor('players', staging)).toThrow(StorageError);
  });

  it('refuses a missing or invalid public base', () => {
    bindBuckets({ R2_PLAYERS: memoryBucket().bucket });
    expect(() => storageFor('players', { SL_ENVIRONMENT: 'staging' })).toThrow(/MEDIA_BASE_PLAYERS is not set/);
    expect(() => storageFor('players', { SL_ENVIRONMENT: 'staging', MEDIA_BASE_PLAYERS: 'not a url' })).toThrow(/not a URL/);
  });

  it.each(PRODUCTION_MEDIA_HOSTS)('refuses production host %s as a public base outside production', (host) => {
    bindBuckets({ R2_PLAYERS: memoryBucket().bucket });
    expect(() => storageFor('players', { SL_ENVIRONMENT: 'staging', MEDIA_BASE_PLAYERS: `https://${host}` })).toThrow(/production media host/);
    expect(() => storageFor('players', { MEDIA_BASE_PLAYERS: `https://${host}` })).toThrow(/production media host/);
  });

  it('allows production hosts only in production', () => {
    bindBuckets({ R2_LOGOS: memoryBucket().bucket });
    expect(storageFor('logos', { SL_ENVIRONMENT: 'production', MEDIA_BASE_LOGOS: `https://${PRODUCTION_MEDIA_HOSTS[0]}` }).publicUrl('a')).toContain(PRODUCTION_MEDIA_HOSTS[0]);
  });

  it('needs a configured video base, with no hard-coded default', () => {
    expect(() => videoBase({})).toThrow(StorageError);
    expect(videoBase({ MEDIA_BASE_VIDEO: 'https://video.example.test/' })).toBe('https://video.example.test');
  });

  it('generates keys from records and fixed types, never from a filename', () => {
    expect(keys.teamLogo('t1')).toBe('teams/t1/logo.png');
    expect(keys.newsImage('n1', 'image/jpeg')).toBe('news/n1.jpg');
    expect(() => keys.newsImage('n1', 'text/html')).toThrow(/PNG, JPEG, WebP or GIF/);
  });
});
