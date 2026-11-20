// Group: api-services. Media storage fails closed: every setting is required, and outside production only
// sl-staging-* / sl-local-* buckets can be written and no production media host can be published. Keys come from the
// owning record, never from a client filename.
import { describe, expect, it } from 'vitest';
import { keys, PRODUCTION_MEDIA_HOSTS, StorageError, storageFor, videoBase } from '../../backend/lib/storage';

const creds = { R2_ACCOUNT_ID: 'acct', R2_ACCESS_KEY_ID: 'id', R2_SECRET_ACCESS_KEY: 'secret' };
const staging = {
  ...creds,
  SL_ENVIRONMENT: 'staging',
  MEDIA_PLAYERS_BUCKET: 'sl-staging-player-images',
  MEDIA_PLAYERS_PUBLIC_URL: 'https://staging-players.example.test/',
};

describe('media storage configuration', () => {
  it('resolves a configured staging bucket and builds public URLs from server keys', () => {
    const s = storageFor('players', staging);
    expect(s.bucket).toBe('sl-staging-player-images');
    expect(s.publicUrl(keys.player('abc'))).toBe('https://staging-players.example.test/players/abc.png');
  });

  it.each(['team-logos', 'player-images', 'fresher-images', 'news-images', 'sl-prod-x'])('refuses production bucket "%s" outside production', (bucket) => {
    expect(() => storageFor('players', { ...staging, MEDIA_PLAYERS_BUCKET: bucket })).toThrow(StorageError);
    expect(() => storageFor('players', { ...staging, SL_ENVIRONMENT: undefined, MEDIA_PLAYERS_BUCKET: bucket })).toThrow(StorageError);
  });

  it.each(PRODUCTION_MEDIA_HOSTS)('refuses production host %s outside production', (host) => {
    expect(() => storageFor('players', { ...staging, MEDIA_PLAYERS_PUBLIC_URL: `https://${host}` })).toThrow(/production media host/);
  });

  it.each(['MEDIA_PLAYERS_BUCKET', 'MEDIA_PLAYERS_PUBLIC_URL', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'])('refuses when %s is missing', (name) => {
    expect(() => storageFor('players', { ...staging, [name]: undefined })).toThrow(StorageError);
  });

  it('allows production buckets and hosts only in production', () => {
    const prod = { ...creds, SL_ENVIRONMENT: 'production', MEDIA_LOGOS_BUCKET: 'team-logos', MEDIA_LOGOS_PUBLIC_URL: `https://${PRODUCTION_MEDIA_HOSTS[0]}` };
    expect(storageFor('logos', prod).bucket).toBe('team-logos');
  });

  it('needs a configured video base, with no hard-coded default', () => {
    expect(() => videoBase({})).toThrow(StorageError);
    expect(videoBase({ MEDIA_VIDEO_PUBLIC_URL: 'https://video.example.test/' })).toBe('https://video.example.test');
  });

  it('generates keys from records and fixed types, never from a filename', () => {
    expect(keys.teamLogo('t1')).toBe('teams/t1/logo.png');
    expect(keys.newsImage('n1', 'image/jpeg')).toBe('news/n1.jpg');
    expect(() => keys.newsImage('n1', 'text/html')).toThrow(/PNG, JPEG, WebP or GIF/);
  });
});
