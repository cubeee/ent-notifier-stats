# Architectural patterns

Patterns observed across `src/app.js` — read this before adding a new chart, changing data loading, or touching timezone handling.

## Data loading: whole-file fetch, single query, in-memory aggregation

The DB is loaded once in `main()`: `initSqlJs` (wasm) and the `events.db` fetch run concurrently via `Promise.all`, then a single `SELECT discovered_time FROM events ORDER BY discovered_time` populates a plain `times` array (unix seconds) that every chart's bucketing function consumes. The DB (`SQL.Database`) is closed immediately after the query — no other queries or the db handle should be needed elsewhere.

This is deliberate over an HTTP-range/Worker-based partial-read approach (tried and reverted — see the comment above `main()`): at this project's DB size, whole-file fetch is simpler and more reliable. Don't reintroduce range-based fetching without solving the corruption issue noted there.

The query relies on `discovered_time` being the leftmost column of `idx_events_discovered_time` for a covering-index scan. If new columns are read from `events`, check whether this still avoids a full table-btree touch.

## Bucketing functions are pure and timezone-explicit

Each chart has a paired `bucketByX(times, timezone)` function that takes the raw `times` array (and a timezone where relevant) and returns plain `{ labels, values }` or similar data — no DOM/Chart.js references. Aggregation logic (UTC day bucketing, hour-of-day via `Intl.DateTimeFormat`, day×hour matrix) lives entirely in these functions, separate from `renderXChart`, which only builds/updates the Chart.js instance.

When timezone conversion is needed, use `Intl.DateTimeFormat`/`formatToParts` with an explicit `timeZone` option rather than manual offset math, and remember some locales report hour `"24"` for midnight — normalize it (`% 24` or explicit check), as every existing bucketing function does.

## Chart lifecycle: destroy-and-recreate, except when only the axis changes

Each chart has a module-level `let xChart` variable. `renderXChart` calls `xChart?.destroy()` before creating a new `Chart(...)`, since Chart.js instances aren't designed to have their dataset shape changed in place — this is the default pattern for any new chart.

The one exception is `updateHourlyChartTimezone`, which mutates `hourlyChart.options.scales.x.adapters.date.zone` and calls `.update()` instead of destroying/recreating. This works only because `hourlyRateTrend`'s bucketing is timezone-independent (timestamps are absolute unix ms; only the axis *display* zone changes) — and it preserves the user's pan/zoom state, which a destroy/recreate would reset. Follow this pattern only for charts where the underlying data truly doesn't depend on timezone.

## Timezone selector wiring

`timezoneSelect`'s `change` listener re-renders every chart whose bucketing depends on timezone (hour-of-day, heatmap) and calls the lighter axis-only update for the hourly trend chart. The daily chart buckets by UTC day and is intentionally not re-rendered on timezone change — new charts should decide explicitly whether they're UTC-fixed or timezone-sensitive and follow the corresponding wiring.
