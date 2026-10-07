// Fixture for one data-to-dashboard run of pipelines/data-to-dashboard.json. Waiting at the signoff gate.
window.RUN = {
  pipeline: { id: 'data-to-dashboard', title: 'Data to dashboard', lane: 'Data', requires: ['data'], inferred: true },
  project: { name: 'tea-shop-reports', repo: 'acme/tea-shop-reports' },
  inputs: [['Source', 'data/orders.csv'], ['Source total', '$48,310.00 over 1,241 orders (shop export footer)'], ['KPIs', 'revenue, orders, average order value, refund rate, revenue by region'], ['Period', 'week 39 (2026-09-21 to 2026-09-27) vs week 38']],
  run: { id: 'run-7c2d', started: '08:00', elapsed: '6m 12s', tokens: '41,280', cost: '$0.38', dev: 'http://127.0.0.1:4530' },
  steps: [
    { id: 'load', title: 'Load the CSV', kind: 'action', role: 'ingest', uses: 'plugin:data/load', status: 'done', took: '4s', out: 'raw_orders: 1,253 rows, 8 columns' },
    { id: 'clean', title: 'Clean the table', kind: 'agent', role: 'worker', status: 'done', took: '1m 18s', tokens: '9,840', out: 'orders: 1,240 rows; 71 changes logged in CLEANING.md' },
    { id: 'qa', title: 'Check against the source', kind: 'agent', role: 'verify', uses: 'plugin:data/query', status: 'done', took: '42s', tokens: '5,110', out: 'totals off by 0.05%, under 0.5%: pass' },
    { id: 'plan', title: 'Pick KPIs and charts', kind: 'agent', role: 'plan', status: 'done', took: '51s', tokens: '6,020', out: '5 KPIs, 2 charts in DASHBOARD.md' },
    { id: 'build', title: 'Build the dashboard', kind: 'agent', role: 'worker', uses: 'plugin:data/render', status: 'done', took: '1m 05s', tokens: '10,900', out: 'dashboard.html, 5 cards, 2 charts' },
    { id: 'readback', title: 'Read the numbers back', kind: 'agent', role: 'visual-check', status: 'done', took: '1m 02s', tokens: '6,730', out: '2 rounds, 5 of 5 match', loop: { steps: ['build', 'readback'], max: 2, rounds: 2 } },
    { id: 'narrate', title: 'Write what moved', kind: 'agent', role: 'worker', status: 'done', took: '38s', tokens: '2,680', out: 'SUMMARY.md, 6 lines' },
    { id: 'signoff', title: 'Check the numbers, then Continue', kind: 'gate', gate: 'handoff', status: 'waiting', waiting: '1m 40s' },
  ],
  // orders.csv: one row per order. Invented shop, invented figures.
  csv: {
    file: 'data/orders.csv', rows: 1253, columns: ['order_id', 'date', 'region', 'product', 'qty', 'unit_price', 'currency', 'status'],
    sample: [
      ['T-10421', '2026-09-21', 'north', 'sencha 100 g', '2', '14.50', 'AUD', 'paid'],
      ['T-10422', '21/09/2026', 'South', 'oolong 50 g', '1', '$18.00', 'AUD', 'paid'],
      ['T-10423', '2026-09-21', '', 'chai blend 200 g', '3', '9.80', 'AUD', 'refunded'],
      ['T-10423', '2026-09-21', '', 'chai blend 200 g', '3', '9.80', 'AUD', 'refunded'],
      ['T-10424', '2026-09-22', 'east', 'matcha 30 g', '', '23.80', 'AUD', 'paid'],
      ['T-10425', '2026-09-22', 'west', 'earl grey 100 g', '2', '11.20', 'AUD', 'paid'],
    ],
  },
  // clean: every change, counted. rows: 1,253 - 12 duplicates - 1 dropped = 1,240.
  cleaning: [
    { change: 'duplicate order_id removed', rows: 12, column: 'order_id' },
    { change: 'date DD/MM/YYYY to ISO', rows: 31, column: 'date' },
    { change: 'unit_price "$18.00" text to 18.00', rows: 18, column: 'unit_price' },
    { change: 'region blank to "unknown"', rows: 9, column: 'region' },
    { change: 'row dropped: qty blank, $23.80', rows: 1, column: 'qty' },
  ],
  clean: { before: 1253, after: 1240, changes: 71 },
  // coverage: 8 columns by 5 checks. ok | fixed | flag.
  checks: ['type', 'nulls', 'duplicates', 'format', 'range'],
  coverage: [
    { column: 'order_id', cells: ['ok', 'ok', 'fixed', 'ok', 'ok'] },
    { column: 'date', cells: ['ok', 'ok', 'ok', 'fixed', 'ok'] },
    { column: 'region', cells: ['ok', 'fixed', 'ok', 'ok', 'ok'] },
    { column: 'product', cells: ['ok', 'ok', 'ok', 'ok', 'ok'] },
    { column: 'qty', cells: ['ok', 'fixed', 'ok', 'ok', 'ok'] },
    { column: 'unit_price', cells: ['fixed', 'ok', 'ok', 'ok', 'ok'] },
    { column: 'currency', cells: ['ok', 'ok', 'ok', 'ok', 'ok'] },
    { column: 'status', cells: ['ok', 'ok', 'ok', 'ok', 'ok'] },
  ],
  // qa: clean total against the source total. Fails the run over 0.5%.
  qa: {
    source_rows: 1241, clean_rows: 1240, source_total: '48,310.00', clean_total: '48,286.20', diff: '23.80',
    working: '|48,310.00 - 48,286.20| / 48,310.00 = 23.80 / 48,310.00 = 0.000493, so 0.05%, under 0.5%',
    nulls: 0, verdict: 'pass', note: '1 order off: T-10424 dropped by clean (qty blank)',
  },
  // plan: DASHBOARD.md.
  kpis: [
    { id: 'revenue', label: 'Revenue', chart: 'number + daily dot-line', this: '25,412.60', last: '22,873.60', change: '+11.1%', working: '(25,412.60 - 22,873.60) / 22,873.60 = 2,539.00 / 22,873.60 = +11.1%' },
    { id: 'orders', label: 'Orders', chart: 'number', this: '652', last: '588', change: '+10.9%', working: '(652 - 588) / 588 = 64 / 588 = +10.9%' },
    { id: 'aov', label: 'Average order value', chart: 'number', this: '38.98', last: '38.90', change: '+0.2%', working: '25,412.60 / 652 = 38.98; 22,873.60 / 588 = 38.90' },
    { id: 'refunds', label: 'Refund rate', chart: 'number', this: '4.0%', last: '2.6%', change: '+1.4 pts', working: '26 / 652 = 4.0%; 15 / 588 = 2.6%' },
    { id: 'regions', label: 'Revenue by region', chart: 'dot-bars, this week solid, last week dotted' },
  ],
  regions: [
    { region: 'north', this: 8104.20, last: 7980.00 },
    { region: 'south', this: 6950.40, last: 5410.60 },
    { region: 'east', this: 5822.00, last: 5601.00 },
    { region: 'west', this: 4412.00, last: 3800.00 },
    { region: 'unknown', this: 124.00, last: 82.00 },
  ],
  daily: { this: [3410.20, 3302.80, 3655.40, 3590.00, 3884.60, 4012.20, 3557.40], last: [3120.00, 3005.40, 3240.80, 3366.20, 3470.00, 3512.60, 3158.60] },
  dashboard: { file: 'dashboard.html', url: 'http://127.0.0.1:4530/dashboard.html', cards: 5, charts: 2 },
  // readback: each headline as drawn on the page vs the table. Round 1 AOV used last week's filter; build fixed it.
  readback: [
    { round: 1, verdict: 'mismatch', reads: [['revenue', '25,412.60', '25,412.60', true], ['orders', '652', '652', true], ['aov', '38.90', '38.98', false], ['refunds', '4.0%', '4.0%', true], ['change', '+11.1%', '+11.1%', true]], note: 'AOV card bound to week 38; build re-bound it to week 39' },
    { round: 2, verdict: 'match', reads: [['revenue', '25,412.60', '25,412.60', true], ['orders', '652', '652', true], ['aov', '38.98', '38.98', true], ['refunds', '4.0%', '4.0%', true], ['change', '+11.1%', '+11.1%', true]], note: '5 of 5 match' },
  ],
  summary: [
    'Revenue $25,412.60, up 11.1% on last week ($22,873.60).',
    'Orders 652, up 64. Average order value flat at $38.98.',
    'South moved most: $6,950.40, up $1,539.80 (+28.5%).',
    'Refund rate rose to 4.0% from 2.6% (26 of 652 orders).',
    '9 orders had no region; they sit under "unknown" ($124.00).',
    'Totals match the shop export within 0.05% (1 order dropped, qty blank).',
  ],
  stream: {
    load: ['data load data/orders.csv', 'raw_orders: 1,253 rows, 8 columns'],
    clean: ['12 duplicate order_id removed', '31 dates to ISO', '18 prices text to number', '9 blank regions to unknown', '1 row dropped: T-10424 qty blank', 'wrote CLEANING.md, 1,240 rows'],
    qa: ['source: 1,241 orders, $48,310.00', 'clean: 1,240 orders, $48,286.20', '23.80 / 48,310.00 = 0.05%', 'nulls: 0', 'pass'],
    plan: ['question: what moved this week', '5 KPIs, 2 charts', 'wrote DASHBOARD.md'],
    build: ['data render DASHBOARD.md', 'dashboard.html, 5 cards, 2 charts', 'serve http://127.0.0.1:4530'],
    readback: ['round 1: open dashboard.html in pane', 'revenue 25,412.60 = 25,412.60', 'aov 38.90 != 38.98', 'round 1: 4 of 5', 'build: AOV card re-bound to week 39', 'round 2: 5 of 5'],
    narrate: ['wrote SUMMARY.md, 6 lines'],
  },
  gate: {
    step: 'signoff', kind: 'handoff',
    summary: 'Check the numbers, then Continue: 5 headlines read back 5 of 5, totals within 0.05% of the source, summary 6 lines.',
    keys: [['C', 'Continue'], ['R', 'Reject']],
  },
  // done state: what only the user can do. Nothing is sent by the run.
  handback: [
    ['Send the summary', 'copy .troop/runs/run-7c2d/SUMMARY.md into your email; attach dashboard.html'],
    ['Set the weekly schedule', 'form view: schedule 0 8 * * 1 (Monday 08:00, runs only while MetaTrooper is open)'],
  ],
  // qa failed: clean dropped 38 orders dated 31/09/2026.
  fail: {
    step: 'qa', status: 'failed', took: '39s',
    stream: ['source: 1,241 orders, $48,310.00', 'clean: 1,203 orders, $47,392.00', '|48,310.00 - 47,392.00| / 48,310.00 = 918.00 / 48,310.00 = 0.0190, so 1.90%', 'over 0.5%: fail', 'cause: clean dropped 38 orders dated 31/09/2026 (no such day)'],
    error_line: 3,
  },
  // readback hit max 2 with AOV still wrong.
  gaveup: [
    { round: 1, verdict: 'mismatch', reads: [['aov', '38.90', '38.98', false]], note: 'AOV card bound to week 38' },
    { round: 2, verdict: 'mismatch', reads: [['aov', '38.90', '38.98', false]], note: 'render cached the old query; AOV still reads 38.90', unfixed: true },
  ],
  result: { dashboard: 'dashboard.html', summary: 'SUMMARY.md', status: 'signed off' },
};
