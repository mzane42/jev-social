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

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `JEV_SOCIAL_REPORTS_DIR` | `~/.jev-social/reports` | Main reports root. |
| `JEV_SOCIAL_EXTRA_REPORTS` | (none) | Extra read-only roots, comma-separated. Lower priority than the main root on collisions. |

Layout expected under each root: `<niche>/<platform@handle>/<YYYY-MM-DD>/data.json`.
Folders are re-scanned on every request, so new niches appear on reload.

Example with extra roots:

```sh
JEV_SOCIAL_EXTRA_REPORTS=/path/to/smoke-reports,/other/reports npm run dev
```

## API

- `GET /api/reports`: every `data.json` as `[{ niche, account, date, data }]`.
- `GET /api/reports/:niche/:account/latest`: newest report for one account
  (`account` is the folder name, e.g. `tiktok%40handle`).

Only directories under the configured roots are listed or read. Path segments are
validated against strict patterns and resolved through `realpath` before any read.

## Screens

- `/n/:niche/a/:account`: account analysis.
- `/n/:niche`: niche comparison.
- `/radar`: story radar.
- `/` redirects to the first niche.

## Mock data

Cohorts (theme, format, timing), key-point fallback, copy/avoid, hook notes,
theme/format chips, the "avg delay after news" KPI, the niche cohort comparison and
the whole story radar come from `src/mocks/` and carry a "mock data" badge. Their
types live in `src/types.ts` so the backend can later fill the same shapes.
Performance tiers are computed from real item views (hit > 3× median, flop < 0.2×).

Report data is private: never commit it or copy it into fixtures.
