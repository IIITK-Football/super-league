// Group: tooling. The staging media check refuses the production site, takes the Cloudflare Access token only from the
// Keychain or the environment (never a file in the repository), and accepts only the staging bucket URLs.
import { describe, expect, it } from 'vitest';
import { accessHeaders, isStagingMediaUrl, png, verifySite } from '../../../scripts/staging-media-check.mjs';

describe('staging media check', () => {
  it('accepts only preview hosts of the staging site', () => {
    expect(verifySite('https://develop.super-league.pages.dev')).toEqual([]);
    expect(verifySite('https://super-league.pages.dev').join()).toContain('never production');
    expect(verifySite('https://evil.example.com').join()).toContain('preview host');
    expect(verifySite('http://develop.super-league.pages.dev').join()).toContain('https');
  });

  it('reads the Access token from the environment or the Keychain, and refuses without one', () => {
    expect(accessHeaders({ CF_ACCESS_CLIENT_ID: 'id', CF_ACCESS_CLIENT_SECRET: 's' } as unknown as NodeJS.ProcessEnv, () => '')).toEqual({ 'CF-Access-Client-Id': 'id', 'CF-Access-Client-Secret': 's' });
    const keychain = (service: string) => (service.endsWith('id') ? 'kid' : 'ksecret');
    expect(accessHeaders({} as unknown as NodeJS.ProcessEnv, keychain)).toEqual({ 'CF-Access-Client-Id': 'kid', 'CF-Access-Client-Secret': 'ksecret' });
    expect(() => accessHeaders({} as unknown as NodeJS.ProcessEnv, () => '')).toThrow(/No Cloudflare Access service token/);
  });

  it('counts only staging bucket URLs as stored correctly', () => {
    expect(isStagingMediaUrl('https://pub-b62195e579bd4e96b5b0c15cb5e55bb7.r2.dev/players/x.png')).toBe(true);
    expect(isStagingMediaUrl('https://pub-156b66d0ff7841bc9601620610a8ebd3.r2.dev/players/x.png')).toBe(false);
    expect(isStagingMediaUrl(undefined as unknown as string)).toBe(false);
  });

  it('builds valid PNGs of the sizes the upload routes require', () => {
    const p = png(500);
    expect([...p.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(p.readUInt32BE(16)).toBe(500);
    expect(png(256).readUInt32BE(20)).toBe(256);
  });
});
