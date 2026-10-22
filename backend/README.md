# Super League Backend

Next.js API for the Super League platform (API and routing only).

## Freshers image uploads and mobile tournament videos

Configure these server environment variables for Freshers player portraits:

- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`
- `R2_FRESHERS_BUCKET_NAME` set to the bucket behind `https://pub-156b66d0ff7841bc9601620610a8ebd3.r2.dev`
- `NEXT_PUBLIC_FRESHERS_R2_URL` set to that public URL (the route has this URL as its default)
- `NEXT_PUBLIC_VIDEO_R2_URL` set to the public R2 host containing the HLS clips (optional; defaults to the current video host)

Set `R2_LOGO_BUCKET=team-logos` for the team-logo bucket.
Set `R2_LOGO_PUBLIC_URL=https://pub-faaac762b0254fb88c3967f021ced499.r2.dev` for that bucket's public base URL (logos are uploaded to the `freshers` directory). Club logos must be strictly 256x256 px PNG format without cropping. Apply `035_team_branding.sql` to add team color storage before captains complete the Team Builder setup.

Apply `030_freshers_road_to_final.sql` in Supabase before using dictator fixture scheduling.

## Getting Started

```bash
pnpm install
pnpm run dev
```

The API runs on [http://localhost:3000](http://localhost:3000). Routes live in `app/api/`, and `middleware.ts` handles CORS, rate limiting and auth for them.

## Deployment

This is a standard Next.js server (Node.js runtime, no Cloudflare adapter), so it is **not** served from Cloudflare Pages. The frontend (Cloudflare Pages, `*.pages.dev`) calls it cross-origin, which is why `middleware.ts` allows `*.super-league.pages.dev` origins. Set `VITE_API_URL` in the frontend to this backend's `/api` base URL.
