# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A static, single-page frontend that visualizes event-scouting history from `ent-notifier`. It fetches a SQLite database file (`events.db`) directly in the browser (via `sql.js`/wasm), runs one query, and renders four Chart.js charts (daily counts, hour-of-day distribution, hourly rate trend, and a day×hour heatmap). There is no backend — the whole app is client-side and deploys as static files to GitHub Pages.

## Tech stack

- Vite 7 (build tool, dev server)
- Vanilla JS (ES modules), no framework
- `sql.js` — SQLite compiled to wasm, used to query `events.db` in-browser
- Chart.js 4 (+ `chartjs-chart-matrix` for the heatmap, `chartjs-plugin-zoom` for pan/zoom, `chartjs-adapter-luxon` for time-axis formatting)
- Deployed via GitHub Pages (see `.github/workflows/deploy-frontend-pages.yml`)

## Key files/directories

- `src/app.js` — the entire application: DB loading, query, bucketing/aggregation functions, and all four chart renderers.
- `index.html` — page shell and chart containers (`canvas` elements) that `app.js` mounts into.
- `vite.config.js` — uses relative `base: './'` for GitHub Pages portability, and `worker: { format: 'es' }` (required by `sql.js`'s wasm loader).
- `public/events.db` — the SQLite snapshot bundled into the site; the only column read is `events.discovered_time` (UTC unix seconds).
- `.github/workflows/deploy-frontend-pages.yml` — builds with `npm ci && npm run build` and deploys `dist/` to Pages. Note: a fresh `events.db` snapshot still needs to be synced into `dist/` post-build before deploy — not yet wired up (see TODO comment in the workflow).

## Commands

- `npm run dev` — start the Vite dev server
- `npm run build` — production build to `dist/`
- `npm run preview` — serve the built `dist/` locally

There are no test or lint scripts configured in this project.

## Additional documentation

- `.claude/docs/architectural_patterns.md` — data-loading strategy, chart rendering/update conventions, and timezone-handling approach used throughout `app.js`.
