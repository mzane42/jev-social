# jev-social dashboard

Local analytics dashboard for jev-social niche reports (Vite + React + TypeScript,
Tailwind CSS v4 + shadcn/ui, Recharts, lucide-react, react-router).

It is a separate package: the root CLI stays zero-dependency.

## Run

```sh
cd dashboard && npm install && npm run dev
```

The report API only exists under `npm run dev` (a Vite `configureServer` middleware
in `vite.config.ts`). `vite preview` and a static `dist/` build have no data.

## Data

The API reads the local SQLite database written by the CLI, read-only, on every
request (new reports appear on reload):

| Variable | Default |
| --- | --- |
| `JEV_SOCIAL_DB` | `~/.jev-social/jev-social.db` |

Fill it from the repo root:

```sh
npm start -- reports import                     # ~/.jev-social/reports
npm start -- reports import path/to/other/reports
npm start -- reports classify                   # Jev theme / format / news hook per video
```

## API

- `GET /api/reports`: every report as `[{ niche, account, date, data }]`; each item
  carries `jev` (its latest classification in that niche) or `null`.
- `GET /api/reports/:niche/:account/latest`: newest report for one account
  (`account` is e.g. `tiktok%40handle`).

## Screens

- `/n/:niche/a/:account`: account analysis.
- `/n/:niche`: niche comparison.
- `/radar`: story radar.
- `/` redirects to the first niche.

## Mock data

Real once an account is classified: theme, format and news-hook cohorts, theme/format
chips, "what to copy / avoid" (buckets with 2+ videos at ≥1.5× or <0.5× the median),
and the niche cohort comparison (bucket median ÷ account median). Performance tiers
are always real. Still mock (badged): the key-point fallback when no insights exist,
the hook lab notes, and the whole story radar. The "avg delay after news" KPI shows
"—" until the Story radar supplies event dates.

Report data is private: never commit it or copy it into fixtures.
