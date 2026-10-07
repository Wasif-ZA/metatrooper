// Fixture for one Security review and upgrade run of pipelines/security-review-and-upgrade.json: steps decided by two engines, DECISIONS.md #3. Waiting at the approve-upgrade gate.
window.RUN = {
  pipeline: { id: 'security-review-and-upgrade', title: 'Security review and upgrade', lane: 'Security and upkeep', requires: ['repo', 'security'], budget_min: 60 },
  project: { name: 'ledger-cli', repo: 'acme/ledger-cli', licence: 'MIT', manager: 'npm' },
  inputs: [['Scope', 'majors and security fixes'], ['Repository', 'acme/ledger-cli (main)']],
  run: { id: 'run-8c2f', started: '09:14', elapsed: '11m 06s', tokens: '61,300', cost: '$0.58', dir: '~/.metatrooper/runs/run-8c2f', paused_why: null },
  steps: [
    { id: 'inventory', title: 'List dependencies', kind: 'action', role: 'ingest', uses: 'plugin:security/list-deps', status: 'done', took: '14s', out: '42 deps (6 direct), 1 outdated, 1 advisory' },
    { id: 'notes', title: 'Read release notes', kind: 'agent', role: 'research', status: 'done', took: '1m 02s', tokens: '6,800', out: '2 breaking changes in yamlish 3.0.0' },
    { id: 'plan', title: 'Review and plan', kind: 'agent', role: 'plan', uses: 'plugin:security/review-prompts', status: 'done', took: '3m 26s', tokens: '26,000', out: '3 findings (1 high, 1 medium, 1 low); one major: yamlish 2.4.1 to 3.0.2, closes F1' },
    { id: 'bump', title: 'Bump and run the codemod', kind: 'agent', role: 'worker', worktree: true, uses: 'plugin:security/upgrade', status: 'done', took: '1m 51s', tokens: '12,400', out: 'commit b41e09c, 3 call sites rewritten' },
    { id: 'check', title: 'Build, types, tests', kind: 'action', role: 'verify', uses: 'plugin:repo/run-tests', status: 'done', took: '41s', out: 'round 1: 37/38; round 2: 38/38', passed: true },
    { id: 'fix', title: 'Fix breakages', kind: 'agent', role: 'worker', status: 'done', took: '1m 20s', tokens: '9,600', out: 'commit 5c7d2aa, 1 test assertion changed', loop: { steps: ['check', 'fix'], until: 'steps.check.passed', max: 2 } },
    { id: 'licences', title: 'Licence report', kind: 'action', role: 'verify', uses: 'plugin:security/licence-report', status: 'done', took: '6s', out: '42 checked, 0 conflicts with MIT' },
    { id: 'approve-upgrade', title: 'Approve the upgrade', kind: 'gate', gate: 'approve', status: 'waiting', waiting: '1m 55s' },
  ],
  // inventory: the 6 direct deps in full; the 36 transitive ones as a count with licence totals.
  deps: [
    { name: 'yamlish', direct: true, current: '2.4.1', wanted: '2.4.1', latest: '3.0.2', type: 'major', licence: 'MIT', advisory: 'GHSA-demo-7q2x-yaml', reachable: true, compat: '91%', clears: ['yamlish-core 1.2.0'] },
    { name: 'argkit', direct: true, current: '5.1.0', wanted: '5.1.0', latest: '5.1.0', type: 'none', licence: 'MIT' },
    { name: 'tablefmt', direct: true, current: '1.8.3', wanted: '1.8.3', latest: '1.8.3', type: 'none', licence: 'ISC' },
    { name: 'decimal-lite', direct: true, current: '0.9.4', wanted: '0.9.4', latest: '0.9.4', type: 'none', licence: 'Apache-2.0' },
    { name: 'colorize-min', direct: true, current: '2.0.1', wanted: '2.0.1', latest: '2.0.1', type: 'none', licence: 'MIT' },
    { name: 'testbench (dev)', direct: true, current: '4.3.0', wanted: '4.3.0', latest: '4.3.0', type: 'none', licence: 'MIT' },
  ],
  transitive: { count: 36, licences: [['MIT', 27], ['ISC', 6], ['Apache-2.0', 2], ['BSD-3-Clause', 1]] },
  advisories: [
    { id: 'GHSA-demo-7q2x-yaml', package: 'yamlish', affected: '< 3.0.0', patched: '3.0.0', severity: 'high', score: 4, summary: 'Tag constructors run code when loading untrusted YAML with the full schema.', url: 'https://example.org/advisories/GHSA-demo-7q2x-yaml' },
  ],
  // review findings. score is a 1 to 5 dot bar; severity is never coloured.
  findings: [
    { id: 'F1', severity: 'high', score: 4, title: 'Untrusted YAML loaded with the full schema', file: 'src/config.js', line: 22, reachable: true, path: 'cli import --file -> loadConfig -> yamlish.load', closed_by: 'upgrade', reason: 'yamlish 3 drops the full schema and parse() is safe by default; the advisory is the same bug.', code: ["const yaml = require('yamlish');", 'function loadConfig(text) {', '  return yaml.load(text, { schema: yaml.FULL });', '}'] },
    { id: 'F2', severity: 'medium', score: 3, title: 'Token-shaped string in a test fixture', file: 'tests/fixtures/sample.env', line: 3, reachable: false, closed_by: null, reason: 'Looks like a token (`demo_tok_0000...`); test only, but scanners will flag it. Rename to an obvious placeholder.', code: ['LEDGER_URL=http://127.0.0.1:7070', 'LEDGER_USER=demo', 'LEDGER_TOKEN=demo_tok_0000000000000000'] },
    { id: 'F3', severity: 'low', score: 1, title: 'Error message echoes the full file path', file: 'src/cli.js', line: 58, reachable: true, closed_by: null, reason: 'Prints the absolute path on a parse error. Local CLI, low impact; kept in the report.', code: ['} catch (err) {', '  console.error(`could not read ${path.resolve(file)}: ${err.message}`);'] },
  ],
  notes: {
    package: 'yamlish', from: '2.4.1', to: '3.0.2', source: 'https://example.org/yamlish/CHANGELOG',
    breaking: [
      ['3.0.0', '`load()` renamed to `parse()`; `load` removed', 'codemod: 3 call sites'],
      ['3.0.0', 'the full schema is gone; `!!js/*` tags now throw', 'hits tests/config.test.js'],
    ],
    other: [['3.0.1', 'faster anchors'], ['3.0.2', 'fix: error line numbers off by one']],
  },
  plan: ['One major upgrade: yamlish 2.4.1 to 3.0.2 (minimum patched is 3.0.0; 3.0.2 adds only fixes).', 'Run the codemod for load() to parse().', 'Expect one test to break: it asserts the unsafe tag loads.', 'Closes F1 and the advisory. F2 and F3 stay in the report.'],
  bump: { branch: 'mt/upgrade-yamlish-3', worktree: '.mt/worktrees/run-8c2f-up', commit: 'b41e09c', codemod: 'load( to parse( in src/config.js:22, src/import.js:14, src/import.js:31' },
  checks: [
    { round: 1, build: 'pass', types: 'pass', tests: { passed: 37, failed: 1, total: 38 }, failing: 'config > loads !!js/function tags', error: 'YamlishTagError: unknown tag !!js/function at line 2' },
    { round: 2, build: 'pass', types: 'pass', tests: { passed: 38, failed: 0, total: 38 } },
  ],
  fix: { commit: '5c7d2aa', note: 'The old test asserted the unsafe behaviour. It now expects !!js/function to throw.', diff: [
    ['tests/config.test.js', "-  it('loads !!js/function tags', () => {", "-    expect(loadConfig(TAGGED)).toHaveProperty('run');", "+  it('rejects !!js/function tags', () => {", '+    expect(() => loadConfig(TAGGED)).toThrow(/unknown tag/);'],
  ] },
  licence_report: { checked: 42, project: 'MIT', conflicts: 0, unknown: 0, changed: [['yamlish', 'MIT', 'MIT']] },
  diff: { files: [['package.json', '+1', '-1'], ['package-lock.json', '+9', '-14'], ['src/config.js', '+2', '-2'], ['src/import.js', '+2', '-2'], ['tests/config.test.js', '+3', '-3']], added: 17, removed: 22 },
  // neutral facts shown with equal weight at the gate
  gate_notes: ['1 test assertion changed: tests/config.test.js now expects !!js/function to throw', 'F2 and F3 are not fixed by this run; both are in security-report.md', 'compat 91%: share of public repos whose CI passed on 2.4.1 to 3.0.2'],
  before_after: {
    rows: [
      ['Advisories', '1 high', '0'],
      ['Reachable findings', '2 (F1 high, F3 low)', '1 (F3 low)'],
      ['Findings in report', '3', '2'],
      ['Licences', '42 ok', '42 ok'],
      ['Install scripts', '0', '0'],
      ['Tests', '38/38', '38/38 (1 assertion changed)'],
      ['Direct deps outdated', '1', '0'],
    ],
  },
  gate: {
    step: 'approve-upgrade',
    gate: 'approve',
    summary: 'Upgrade yamlish 2.4.1 to 3.0.2 on mt/upgrade-yamlish-3. Checks passed 38/38 after 1 test change. Approve to hand back the branch and reports, reject to stop.',
    action: 'Write security-report.md and licence-report.md; hand back mt/upgrade-yamlish-3 (b41e09c, 5c7d2aa) with the push and PR commands, not run',
    hash: 'sha256:5e19ac03d7',
    keys: [['A', 'Approve'], ['R', 'Reject'], ['D', 'Open diff'], ['F', 'Findings']],
  },
  // live agent and action output per step, for the demo.
  stream: {
    inventory: ['npm ls --all --json', '42 packages, 6 direct', 'npm outdated: yamlish 2.4.1 (latest 3.0.2, major)', 'advisory GHSA-demo-7q2x-yaml on yamlish < 3.0.0'],
    notes: ['fetch example.org/yamlish/CHANGELOG', '3.0.0 breaking: load() renamed parse()', '3.0.0 breaking: full schema removed, !!js tags throw'],
    plan: ['security prompt set: 9 checks over 14 files', 'F1 src/config.js:22 untrusted YAML, full schema, reachable', 'F2 tests/fixtures/sample.env:3 token-shaped string', 'F3 src/cli.js:58 path echoed in error', '3 findings written to findings.json', 'one major, no others outdated', 'target 3.0.2 (minimum patched 3.0.0)', 'expect tests/config.test.js to break'],
    bump: ['cwd .mt/worktrees/run-8c2f-up', 'npm install yamlish@3.0.2', 'added 1, removed 2, changed 1', 'codemod: load( to parse( (3 call sites)', 'src/config.js:22 drop { schema: FULL }', 'commit b41e09c on mt/upgrade-yamlish-3'],
    check1: ['npm run build: ok', 'npm run typecheck: ok', 'npm test', '  37 passed', '  x config > loads !!js/function tags', '    YamlishTagError: unknown tag !!js/function at line 2', '  1 failed'],
    fix: ['read failure: test expects an unsafe tag to load', 'this is the fix working, not a regression', 'change assertion to expect a throw', 'commit 5c7d2aa on mt/upgrade-yamlish-3'],
    check2: ['npm run build: ok', 'npm run typecheck: ok', 'npm test', '  38 passed'],
    licences: ['licence report: 42 packages', 'MIT 31, ISC 7, Apache-2.0 3, BSD-3-Clause 1', '0 conflicts with project licence MIT'],
    tray: ['write security-report.md (3 findings, 1 closed)', 'write licence-report.md (42 packages)', 'diff main...mt/upgrade-yamlish-3: 5 files, +17 -22', 'hand-back ready'],
  },
  // hand-back tray after approval. Commands are shown, never run by the app.
  handback: {
    branch: 'mt/upgrade-yamlish-3',
    commits: ['b41e09c bump yamlish to 3.0.2 and rename load to parse', '5c7d2aa expect !!js/function tags to throw'],
    reports: [['security-report.md', '3 findings, F1 closed by this upgrade'], ['licence-report.md', '42 packages, 0 conflicts']],
    commands: ['git push -u origin mt/upgrade-yamlish-3', 'gh pr create --repo acme/ledger-cli --head mt/upgrade-yamlish-3 --title "Bump yamlish from 2.4.1 to 3.0.2" --body-file ~/.metatrooper/runs/run-8c2f/security-report.md'],
    not_run: true,
  },
  bar: { text: 'security · yamlish 2.4.1 → 3.0.2 · check 2/2 · 11m 06s', done: 'security done · 1 upgrade · 2 findings · hand-back ready' },
};
