This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

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

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
