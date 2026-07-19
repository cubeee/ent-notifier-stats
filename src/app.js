import { createSQLiteThread, createHttpBackend } from 'sqlite-wasm-http';
import { Chart } from 'chart.js/auto';
import { MatrixController, MatrixElement } from 'chartjs-chart-matrix';

Chart.register(MatrixController, MatrixElement);

const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0') + ':00');
const HEATMAP_DAY_WIDTH = 18; // px per day column, drives horizontal scroll width

// ColorBrewer "YlOrRd" 9-class sequential scale — a multi-hue ramp reads
// small differences (e.g. 1 vs 12 events/hour) far more clearly than a
// single-hue alpha blend, since it recruits both hue and lightness rather
// than opacity alone.
const HEATMAP_STOPS = [
  '#ffffcc', '#ffeda0', '#fed976', '#feb24c', '#fd8d3c',
  '#fc4e2a', '#e31a1c', '#bd0026', '#800026',
].map((hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]);

function heatmapColor(value, max) {
  const t = max > 0 ? Math.min(value / max, 1) : 0;
  const scaled = t * (HEATMAP_STOPS.length - 1);
  const i = Math.floor(scaled);
  const frac = scaled - i;
  const [r1, g1, b1] = HEATMAP_STOPS[i];
  const [r2, g2, b2] = HEATMAP_STOPS[Math.min(i + 1, HEATMAP_STOPS.length - 1)];
  const r = Math.round(r1 + (r2 - r1) * frac);
  const g = Math.round(g1 + (g2 - g1) * frac);
  const b = Math.round(b1 + (b2 - b1) * frac);
  return `rgb(${r}, ${g}, ${b})`;
}

const statusEl = document.getElementById('status');
const timezoneSelect = document.getElementById('timezone');

function setStatus(message) {
  statusEl.textContent = message;
}

function populateTimezones() {
  const defaultTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timezones = typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : [defaultTimezone];

  for (const tz of timezones) {
    const option = document.createElement('option');
    option.value = tz;
    option.textContent = tz;
    timezoneSelect.appendChild(option);
  }
  timezoneSelect.value = defaultTimezone;
}

function bucketByUtcDay(times) {
  const counts = new Map();
  for (const t of times) {
    const dayStart = Math.floor(t / 86400) * 86400;
    counts.set(dayStart, (counts.get(dayStart) || 0) + 1);
  }
  const days = [...counts.keys()].sort((a, b) => a - b);
  return {
    labels: days.map((d) => new Date(d * 1000).toISOString().slice(0, 10)),
    values: days.map((d) => counts.get(d)),
  };
}

function bucketByHourOfDay(times, timezone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  });
  const counts = new Array(24).fill(0);
  for (const t of times) {
    // "24" is used by some locales/timezones for midnight instead of "0"
    const hour = Number(formatter.format(new Date(t * 1000))) % 24;
    counts[hour]++;
  }
  return {
    labels: counts.map((_, hour) => String(hour).padStart(2, '0') + ':00'),
    values: counts,
  };
}

function bucketByDayHour(times, timezone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  });
  const counts = new Map(); // "date|hour" -> count
  const days = new Set();
  let max = 0;
  for (const t of times) {
    const parts = formatter.formatToParts(new Date(t * 1000));
    const get = (type) => parts.find((p) => p.type === type).value;
    const date = `${get('year')}-${get('month')}-${get('day')}`;
    const hour = get('hour') === '24' ? '00' : get('hour');
    const key = `${date}|${hour}`;
    const count = (counts.get(key) || 0) + 1;
    counts.set(key, count);
    days.add(date);
    if (count > max) max = count;
  }

  const dayLabels = [...days].sort();
  const points = [...counts.entries()].map(([key, v]) => {
    const [date, hour] = key.split('|');
    return { x: date, y: hour + ':00', v };
  });
  return { dayLabels, points, max };
}

let dailyChart;
function renderDailyChart(times) {
  const { labels, values } = bucketByUtcDay(times);
  dailyChart?.destroy();
  dailyChart = new Chart(document.getElementById('dailyChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Events', data: values, backgroundColor: '#3b6ea5' }],
    },
    options: {
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

let hourChart;
function renderHourOfDayChart(times, timezone) {
  const { labels, values } = bucketByHourOfDay(times, timezone);
  hourChart?.destroy();
  hourChart = new Chart(document.getElementById('hourChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Events', data: values, backgroundColor: '#a53b6e' }],
    },
    options: {
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

let heatmapChart;
function renderHeatmapChart(times, timezone) {
  const { dayLabels, points, max } = bucketByDayHour(times, timezone);

  // Category-scale grid sized by day count, not responsive width — a
  // heatmap of years of days needs horizontal scroll, not shrinking cells
  // down to illegibility, so the inner container is sized explicitly and
  // scrolls within the fixed-width outer #heatmapScroll (see index.html).
  document.getElementById('heatmapInner').style.width =
    Math.max(dayLabels.length * HEATMAP_DAY_WIDTH, 300) + 'px';

  heatmapChart?.destroy();
  heatmapChart = new Chart(document.getElementById('heatmapChart'), {
    type: 'matrix',
    data: {
      datasets: [{
        label: 'Events',
        data: points,
        backgroundColor: (ctx) => heatmapColor(ctx.dataset.data[ctx.dataIndex]?.v ?? 0, max),
        borderWidth: 1,
        borderColor: '#fff',
        width: ({ chart }) => (chart.chartArea || {}).width / dayLabels.length - 1,
        height: ({ chart }) => (chart.chartArea || {}).height / 24 - 1,
      }],
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => `${items[0].raw.x} ${items[0].raw.y}`,
            label: (item) => `${item.raw.v} event${item.raw.v === 1 ? '' : 's'}`,
          },
        },
      },
      scales: {
        x: {
          type: 'category',
          labels: dayLabels,
          offset: true,
          grid: { display: false },
          ticks: { autoSkip: true, maxRotation: 60, minRotation: 60 },
        },
        y: {
          type: 'category',
          labels: HOUR_LABELS,
          offset: true,
          reverse: true,
          grid: { display: false },
        },
      },
    },
  });
}

async function main() {
  populateTimezones();

  setStatus('Loading events…');

  // GitHub Pages can't send the COOP/COEP headers required for
  // SharedArrayBuffer, so the "shared" multi-worker backend never works
  // there — request "sync" explicitly rather than relying on the
  // library's automatic (but noisily-logged) fallback.
  const httpBackend = createHttpBackend({
    backendType: 'sync',
    maxPageSize: 4096,
    timeout: 10000,
    cacheSize: 4096,
  });
  const db = await createSQLiteThread({ http: httpBackend });
  await db('open', {
    filename: 'file:' + encodeURI(new URL('events.db', location.href)),
    vfs: 'http',
  });

  // Single narrow query feeds both charts: discovered_time is the
  // leftmost column of idx_events_discovered_time, so this is a covering
  // index scan (the wider events table b-tree is never touched) — the
  // cheapest possible access pattern over HTTP range requests, since it's
  // a sequential read of small, densely packed index pages.
  const times = [];
  await db('exec', {
    sql: 'SELECT discovered_time FROM events ORDER BY discovered_time',
    callback: (msg) => times.push(msg.row[0]),
  });

  setStatus('');

  renderDailyChart(times);
  renderHourOfDayChart(times, timezoneSelect.value);
  renderHeatmapChart(times, timezoneSelect.value);

  timezoneSelect.addEventListener('change', () => {
    renderHourOfDayChart(times, timezoneSelect.value);
    renderHeatmapChart(times, timezoneSelect.value);
  });
}

main().catch((err) => {
  console.error(err);
  setStatus('Failed to load events: ' + err.message);
});
