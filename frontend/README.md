# Super League Frontend

React + Vite app, deployed on Cloudflare Pages.

```bash
pnpm install
pnpm run dev
```

Copy `.env.example` to `.env` and fill in the Supabase and `VITE_API_URL` values. `functions/_middleware.js` is a Cloudflare Pages Function that rewrites Open Graph meta tags per page.
