# Super League — IIIT Kottayam

![Status](https://img.shields.io/badge/Status-Live-success)
![Contributions](https://img.shields.io/badge/Contributions-Welcome-blue)

**Super League** is the official football league and fantasy prediction platform for the Indian Institute of Information Technology, Kottayam. Designed and built by three students, it is maintained by the open-source community and serves as the authoritative digital record for collegiate football at IIIT Kottayam.

| | |
|---|---|
| **Live** | [super-league.pages.dev](https://super-league.pages.dev/) |
| **Test** | [develop.super-league.pages.dev](https://develop.super-league.pages.dev/) |


---

## Features

**Real-Time League Tracking**
Live match scores, results, and standings for both the Men's and Women's divisions.

**FUT-Style Player Profiles**
Custom player cards with unique playstyles, core attributes, and historical statistics for every IIIT Kottayam footballer.

**Fantasy Prediction Engine**
A proprietary fantasy system in which users predict match results, exact scorelines, and goalscorers ahead of kickoff to compete on a global leaderboard.

**League Administration**
Centralised access to official rules, newsletter integration, and a Legends archive preserving historical college football records.

---

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18, Vite, Tailwind CSS 4, React Router |
| Backend | Next.js (API routes), Zod |
| Database & Auth | Supabase (Postgres, Auth, RLS) |
| Storage | Cloudflare R2 |
| Hosting | Cloudflare Pages (frontend) |

```
frontend/   React + Vite app, Cloudflare Pages Functions for OG meta tags
backend/    Next.js API and Supabase migrations
```

---

## Getting Started

```bash
cd frontend   # or: cd backend
pnpm install
pnpm run dev
```

See the [Contributing Guide](CONTRIBUTING.md) for the full workflow.

---

## Core Team

Super League was designed and engineered by:

- Kevin Mathew
- Abhinav S
- Ebin Thomas

The platform is maintained by the Super League Core Team and community contributors.

---

## Contributing

Super League operates under a **Benevolent Dictator / Maintainer** governance model. To protect the integrity of the live platform, contributors do not have direct write access to `main` and are required to follow a fork-based workflow.

For local setup instructions, branching conventions, and pull request standards, refer to the [Contributing Guide](CONTRIBUTING.md).

> When opening a pull request, ensure **Allow edits from maintainers** is enabled so the Core Team can assist with conflict resolution where necessary.
