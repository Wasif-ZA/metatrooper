// Fixture for one Form fill batch run of pipelines/form-fill-batch.json: steps from catalog A7 and issue 24, approve-once decided by Wasif 2026-10-05, DECISIONS.md #10.
// The form is a local Windows fixture app driven by the desktop plugin (UI Automation). Every name and address is invented (.example).
// State: rows 1 and 2 filled, captcha continued and shot, unsent in their own windows; row 3 filled, waiting at the captcha handoff gate. The run never solves the captcha. Nothing is submitted until the one approve.
window.RUN = {
  pipeline: { id: 'form-fill-batch', title: 'Form fill batch', lane: 'Desktop and forms', plugins: ['desktop'], budget_min: 30, loop_max: 20 },
  project: { name: 'plot-signups', dir: '~/forms/plot-signups', repo: '~/forms/plot-signups' },
  inputs: [['Form', 'PlotSignup.exe (fixture)'], ['Rows', 'rows.csv, 6 rows']],
  run: { id: 'run-f3a9', started: '2026-10-05T10:12+11:00', elapsed: '2m 28s', tokens: '9,880', cost: '$0.07', dir: '~/.metatrooper/runs/run-f3a9', done_elapsed: '5m 36s' },
  row: 3, rows_total: 6, rows_left: 3,
  steps: [
    { id: 'map', title: 'Map columns to fields', kind: 'agent', role: 'plan', status: 'done', took: '22s', tokens: '2,410', out: 'rows.json, 6 rows, 5 fields mapped' },
    { id: 'fill', title: 'Fill the next row', kind: 'agent', role: 'worker', status: 'done', took: '38s', tokens: '2,890', out: 'row 3 filled, captcha: shown, rows_left 3', loop: true },
    { id: 'captcha', title: 'Hand the captcha to you', kind: 'gate', gate: 'handoff', status: 'waiting', waiting: '0m 01s', summary: 'Row 3: the form shows a captcha. Solve it in the window, then press Continue.', loop: true },
    { id: 'shot', title: 'Screenshot the filled row', kind: 'action', role: 'visual-check', uses: 'plugin:desktop/screenshot', unconfirmed: 'no plugins/desktop manifest', status: 'pending', loop: true, loop_def: { steps: ['fill', 'captcha', 'shot'], until: 'steps.fill.outputs.rows_left == "0"', max: 20 } },
    { id: 'approve', title: 'Approve the whole batch', kind: 'gate', gate: 'approve', guards_step: 'submit', status: 'pending' },
    { id: 'submit', title: 'Submit every row', kind: 'action', role: 'publish', external: true, uses: 'plugin:desktop/submit', unconfirmed: 'no plugins/desktop manifest', status: 'pending', took: '9s' },
    { id: 'confirm', title: 'Read the confirmations', kind: 'action', role: 'verify', uses: 'plugin:desktop/read', unconfirmed: 'no plugins/desktop manifest', status: 'pending', took: '4s' },
  ],
  fields: [['name', 'Full name', 'Edit', 'txtName'], ['email', 'Email', 'Edit', 'txtEmail'], ['plot', 'Plot size', 'ComboBox', 'cboPlot'], ['start', 'Start date', 'Edit', 'dtStart'], ['notes', 'Notes', 'Edit', 'txtNotes']],
  // rows.json: [n, name, email, plot, start, notes, status, captcha, confirmation, shot]. status: ready (filled, shot, unsent) | waiting | pending | submitted.
  rows: [
    [1, 'Ira Vellum', 'ira@plots.example', 'half', '2026-11-01', 'near the tap if possible', 'ready', 'none', 'PS-1041', 'shot-1.png'],
    [2, 'Bo Tamsin', 'bo@plots.example', 'full', '2026-11-01', '', 'ready', 'none', 'PS-1042', 'shot-2.png'],
    [3, 'Cass Rowan', 'cass@plots.example', 'quarter', '2026-11-15', 'raised bed', 'waiting', 'shown', 'PS-1043', 'shot-3.png'],
    [4, 'Dee Marlow', 'dee@plots.example', 'half', '2026-12-01', '', 'pending', 'none', 'PS-1044', 'shot-4.png'],
    [5, 'Eli Brook', 'eli@plots.example', 'quarter', '2026-11-15', 'shared with row 4', 'pending', 'none', 'PS-1045', 'shot-5.png'],
    [6, 'Fen Oakes', 'fen@plots.example', 'full', '2026-12-01', '', 'pending', 'none', 'PS-1046', 'shot-6.png'],
  ],
  // the form window as drawn (no screenshots), one per row. captcha_panel: the fixture's stand-in, a code the user types.
  window: { title: 'Plot sign-up (fixture)', size: [640, 520], captcha_panel: { label: 'Type the code shown', code: 'K7QM', field: 'txtCode', solved: false } },
  // the one approve gate, after the loop. The hash covers the resolved with (every row's values) and the destination.
  gate: {
    step: 'approve', guards_step: 'submit', rows: 6,
    summary: 'Submit all 6 rows to Plot sign-up (fixture): Submit in each row window, rows 1 to 6 in order.',
    action: { step: 'submit', action: 'plugin:desktop/submit', args: { window: 'Plot sign-up (fixture) · row <n>', rows: '1 to 6, values as shown' }, destination: 'Plot sign-up (fixture)' },
    hash: '7c2e91b04a',
  },
  log: [
    ['10:12:04', 'map', 'read rows.csv: 6 rows, columns name, email, plot, start, notes'],
    ['10:12:21', 'map', 'UI tree: txtName, txtEmail, cboPlot, dtStart, txtNotes, btnSubmit'],
    ['10:12:26', 'fill', 'row 1: window opened, 5 fields typed, captcha: none'],
    ['10:13:05', 'captcha', 'row 1: no captcha, Continue by you'],
    ['10:13:07', 'shot', 'row 1: wrote shot-1.png'],
    ['10:13:08', 'fill', 'row 2: window opened, 5 fields typed, captcha: none'],
    ['10:13:46', 'captcha', 'row 2: no captcha, Continue by you'],
    ['10:13:48', 'shot', 'row 2: wrote shot-2.png'],
    ['10:13:49', 'fill', 'row 3: window opened, 5 fields typed'],
    ['10:14:27', 'fill', 'row 3: panel "Type the code shown" found, captcha: shown, not touched'],
    ['10:14:28', 'captcha', 'row 3: waiting for you'],
  ],
  stream: {
    fill: ['open window Plot sign-up (fixture) · row 3', 'txtName: Cass Rowan', 'txtEmail: cass@plots.example', 'cboPlot: quarter', 'dtStart: 2026-11-15', 'txtNotes: raised bed', 'panel txtCode appeared: captcha shown', 'not touched, left for you; rows_left 3'],
    shot: ['window screenshot 640x520', 'wrote shot-3.png'],
    submit: ['row 1: btnSubmit, form accepted', 'row 2: btnSubmit, form accepted', 'row 3: btnSubmit, form accepted', 'row 4: btnSubmit, form accepted', 'row 5: btnSubmit, form accepted', 'row 6: btnSubmit, form accepted'],
    confirm: ['row 1: lblConfirm PS-1041', 'row 2: lblConfirm PS-1042', 'row 3: lblConfirm PS-1043', 'row 4: lblConfirm PS-1044', 'row 5: lblConfirm PS-1045', 'row 6: lblConfirm PS-1046', 'missing 0, wrote out/confirmations.csv'],
  },
  handback: [
    ['Keep the confirmation numbers', 'start ~/forms/plot-signups/out/confirmations.csv'],
    ['Move the sheet so it is not sent twice', 'move ~/forms/plot-signups/rows.csv ~/forms/plot-signups/sent/rows-2026-10-05.csv'],
  ],
  handback_reject: 'Rejected: nothing was sent. The six windows stay filled; close them or rerun from rows.csv.',
};
