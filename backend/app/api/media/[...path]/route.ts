import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const videoBaseUrl = (process.env.NEXT_PUBLIC_VIDEO_R2_URL || 'https://pub-b7d837d92cb644838cb24feef9b3329e.r2.dev').replace(/\/$/, '');
const allowedStreams = new Set([
  'superLeague1', 'superLeague2', 'superLeague3',
  'wsl1', 'wsl2', 'wsl3',
  'freshers1', 'freshers2', 'freshers3',
]);

type RouteContext = { params: Promise<{ path: string[] }> };

function getAllowedPath(path: string[]) {
  if (!path.length || path.some((part) => !/^[a-zA-Z0-9._-]+$/.test(part) || part === '.' || part === '..')) return null;
  if (!allowedStreams.has(path[0])) return null;
  return path.join('/');
}

function localMediaUrl(remoteUrl: URL, stream: string) {
  const remoteHost = new URL(videoBaseUrl).host;
  if (remoteUrl.host !== remoteHost || !remoteUrl.pathname.startsWith(`/${stream}/`)) return null;
  return `/api/media${remoteUrl.pathname}`;
}

async function proxyMedia(request: Request, context: RouteContext) {
  const { path } = await context.params;
  const relativePath = getAllowedPath(path);
  if (!relativePath) return NextResponse.json({ error: 'Media path not found' }, { status: 404 });

  const upstreamUrl = `${videoBaseUrl}/${relativePath}`;
  const headers = new Headers();
  const range = request.headers.get('range');
  if (range) headers.set('range', range);

  try {
    const response = await fetch(upstreamUrl, { headers, cache: 'no-store' });
    if (!response.ok) return new NextResponse(null, { status: response.status });

    const contentType = response.headers.get('content-type') || '';
    if (relativePath.endsWith('.m3u8') || contentType.includes('mpegurl')) {
      const stream = path[0];
      const playlist = await response.text();
      const rewritten = playlist.split(/\r?\n/).map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;

        if (trimmed.startsWith('#')) {
          return line.replace(/URI="([^"]+)"/g, (match, uri: string) => {
            const resolved = new URL(uri, upstreamUrl);
            const localUrl = localMediaUrl(resolved, stream);
            return localUrl ? `URI="${localUrl}"` : match;
          });
        }

        const resolved = new URL(trimmed, upstreamUrl);
        return localMediaUrl(resolved, stream) || line;
      }).join('\n');

      return new NextResponse(rewritten, {
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'public, max-age=30',
        },
      });
    }

    const responseHeaders = new Headers({
      'Content-Type': contentType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Accept-Ranges': 'bytes',
    });
    for (const header of ['content-length', 'content-range']) {
      const value = response.headers.get(header);
      if (value) responseHeaders.set(header, value);
    }
    return new NextResponse(response.body, { status: response.status, headers: responseHeaders });
  } catch (error) {
    console.error('Video proxy failed:', error);
    return NextResponse.json({ error: 'Could not load this video' }, { status: 502 });
  }
}

export async function GET(request: Request, context: RouteContext) {
  return proxyMedia(request, context);
}

export async function HEAD(request: Request, context: RouteContext) {
  return proxyMedia(request, context);
}
