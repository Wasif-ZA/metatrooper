// Fixture for one Docs and release notes run of pipelines/docs-and-release-notes.json. Waiting at the approve gate.
window.RUN = {
  pipeline: { id: 'docs-and-release-notes', title: 'Docs and release notes', lane: 'Docs and releases', budget_min: 45, requires: ['repo', 'github'] },
  project: { name: 'inkwell', repo: 'acme/inkwell', about: 'a small markdown linter CLI' },
  inputs: [['Since', 'last tag (v1.4.2)'], ['Repository', 'acme/inkwell'], ['Base branch', 'main']],
  run: { id: 'run-8b2f', started: '10:14', elapsed: '19m 42s', tokens: '96,300', cost: '$0.88', dir: '~/.metatrooper/runs/run-8b2f' },
  steps: [
    { id: 'diff', title: 'Collect changes since v1.4.2', kind: 'action', role: 'ingest', uses: 'plugin:github/list-prs', status: 'done', took: '0m 21s', out: '9 merged PRs, 37 commits, v1.4.2..main' },
    { id: 'map', title: 'Map docs to changes', kind: 'agent', role: 'plan', status: 'done', took: '2m 48s', tokens: '14,100', out: 'map.md: 4 docs affected, 1 Diataxis gap' },
    { id: 'update', title: 'Update the affected docs', kind: 'agent', role: 'worker', fanout: 3, status: 'done', took: '9m 12s', tokens: '58,600', out: '3 lanes, 5 files staged on mt/docs-run-8b2f' },
    { id: 'changelog', title: 'Write the release notes', kind: 'agent', role: 'worker', status: 'done', took: '2m 05s', tokens: '12,900', out: 'release-notes.md, CHANGELOG.md section, bump minor' },
    { id: 'samples', title: 'Run every sample and link', kind: 'agent', role: 'verify', uses: 'plugin:shell/run', status: 'done', took: '3m 40s', tokens: '10,700', out: '16/16 samples ok (1 fixed), 42/42 links, --help matches' },
    { id: 'approve', title: 'Approve the release', kind: 'gate', gate: 'approve', status: 'waiting', waiting: '1m 36s' },
    { id: 'release', title: 'Publish the GitHub release', kind: 'action', role: 'publish', uses: 'plugin:github/release', external: true, status: 'pending' },
  ],
  range: { from: 'v1.4.2', to: 'main', head: 'c4e19a0', commits: 37 },
  // merged PRs since the last tag, from plugin:github/list-prs
  prs: [
    { n: 204, title: 'Add --ignore-file to skip paths', label: 'feature', author: 'dev-a', docs: ['docs/reference/cli.md', 'docs/how-to/ignore-files.md'] },
    { n: 206, title: 'Rule MD041: first line must be a heading', label: 'feature', author: 'dev-b', docs: ['docs/reference/rules.md'] },
    { n: 207, title: 'JSON output for check', label: 'feature', author: 'dev-a', docs: ['docs/reference/cli.md', 'README.md'] },
    { n: 209, title: 'Faster scan on large repos', label: 'improvement', author: 'dev-c', docs: [] },
    { n: 210, title: 'Config file can live in .config/', label: 'improvement', author: 'dev-b', docs: ['docs/how-to/config.md'] },
    { n: 212, title: 'Rename --fix to --write (old flag warns)', label: 'improvement', author: 'dev-c', docs: ['README.md', 'docs/reference/cli.md'] },
    { n: 213, title: 'Tabs in tables no longer break MD013', label: 'fix', author: 'dev-a', docs: [] },
    { n: 214, title: 'Exit code 2 on config error, not 1', label: 'fix', author: 'dev-b', docs: ['docs/reference/cli.md'] },
    { n: 216, title: 'Bump test deps', label: 'chore', author: 'dev-c', docs: [], skipped: 'chore, not user-facing' },
  ],
  // map.md: rows are docs, kind is the Diataxis quadrant, prs are the changes that touch it
  map: {
    docs: [
      { file: 'README.md', kind: 'tutorial', prs: [207, 212], status: 'updated', lane: 1 },
      { file: 'docs/reference/cli.md', kind: 'reference', prs: [204, 207, 212, 214], status: 'updated', lane: 2 },
      { file: 'docs/reference/rules.md', kind: 'reference', prs: [206], status: 'updated', lane: 2 },
      { file: 'docs/how-to/config.md', kind: 'how-to', prs: [210], status: 'updated', lane: 3 },
      { file: 'docs/how-to/ignore-files.md', kind: 'how-to', prs: [204], status: 'new', lane: 3 },
      { file: 'docs/explanation/rules-design.md', kind: 'explanation', prs: [], status: 'unchanged' },
    ],
    gaps: [{ kind: 'how-to', pr: 204, text: 'No how-to for skipping paths; reference alone lists the flag', fixed_by: 'docs/how-to/ignore-files.md' }],
  },
  // the three update lanes (fanout 3), one run branch, each lane stages its files
  lanes: [
    { lane: 1, files: ['README.md'], took: '6m 02s', diff: [['README.md', '+14', '-6']] },
    { lane: 2, files: ['docs/reference/cli.md', 'docs/reference/rules.md'], took: '9m 12s', diff: [['docs/reference/cli.md', '+38', '-11'], ['docs/reference/rules.md', '+19', '-0']] },
    { lane: 3, files: ['docs/how-to/config.md', 'docs/how-to/ignore-files.md'], took: '7m 40s', diff: [['docs/how-to/config.md', '+9', '-4'], ['docs/how-to/ignore-files.md', '+38', '-0']] },
  ],
  docs_branch: { branch: 'mt/docs-run-8b2f' },
  // a before / after for one doc page (README.md, the --fix rename)
  doc_diff: {
    file: 'README.md',
    before: ['## Quick start', '', '```sh', 'npm install -g inkwell', 'inkwell check README.md', 'inkwell check --fix README.md', '```', '', 'Exit code 1 means a rule failed.'],
    after: ['## Quick start', '', '```sh', 'npm install -g inkwell', 'inkwell check README.md', 'inkwell check --write README.md', 'inkwell check --format json docs/', '```', '', 'Exit code 1 means a rule failed; 2 means the config could not be read.'],
  },
  // rendered doc pages for the before / after and preview views; before is null for a new page
  pages: {
    'README.md': { pr: [207, 212],
      before: ['# inkwell', '', 'A small markdown linter for docs folders.', '', '## Quick start', '', '```sh', 'npm install -g inkwell', 'inkwell check README.md', 'inkwell check --fix README.md', '```', '', 'Exit code 1 means a rule failed.', '', '## Fix files in place', '', 'Most rules can rewrite the file for you.', '', '```sh', 'inkwell check --fix README.md', '```', '', '## Rules', '', '- MD013 line length', '- MD022 headings need blank lines'],
      after: ['# inkwell', '', 'A small markdown linter for docs folders.', '', '## Quick start', '', '```sh', 'npm install -g inkwell', 'inkwell check README.md', 'inkwell check --write README.md', 'inkwell check --format json docs/', '```', '', 'Exit code 1 means a rule failed; 2 means the config could not be read.', '', '## Fix files in place', '', 'Most rules can rewrite the file for you.', '', '```sh', 'inkwell check --write README.md', '```', '', '## Rules', '', '- MD013 line length', '- MD022 headings need blank lines', '- MD041 first line is a heading'] },
    'docs/reference/cli.md': { pr: [204, 207, 212, 214],
      before: ['# CLI reference', '', '## inkwell check [paths]', '', '| Flag | Does |', '|---|---|', '| `--fix` | Rewrite files to pass the rules |', '| `--config <file>` | Read rules from a file |', '| `--rule <id>` | Run one rule only |', '', '## Exit codes', '', '- `0` every rule passed', '- `1` a rule failed, or the config could not be read'],
      after: ['# CLI reference', '', '## inkwell check [paths]', '', '| Flag | Does |', '|---|---|', '| `--write` | Rewrite files to pass the rules (was `--fix`) |', '| `--config <file>` | Read rules from a file |', '| `--rule <id>` | Run one rule only |', '| `--ignore-file <file>` | Skip paths listed in a file |', '| `--format json` | Print results as JSON |', '', '## Exit codes', '', '- `0` every rule passed', '- `1` a rule failed', '- `2` the config could not be read'] },
    'docs/reference/rules.md': { pr: [206],
      before: ['# Rules', '', '## MD013 line length', '', 'Lines longer than 100 characters fail.', '', '## MD022 headings need blank lines', '', 'A heading needs a blank line above and below.'],
      after: ['# Rules', '', '## MD013 line length', '', 'Lines longer than 100 characters fail.', '', '## MD022 headings need blank lines', '', 'A heading needs a blank line above and below.', '', '## MD041 first line is a heading', '', 'The first line of a file must be a heading.', '', '```md', '# Passes', '```', '', '```md', 'Fails: no heading on line 1', '```'] },
    'docs/how-to/config.md': { pr: [210],
      before: ['# Configure inkwell', '', 'Put `inkwell.json` in the repo root.', '', '```json', '{ "rules": { "MD013": { "max": 120 } } }', '```'],
      after: ['# Configure inkwell', '', 'Put `inkwell.json` in the repo root, or in `.config/inkwell.json`.', 'The root file wins when both exist.', '', '```json', '{ "rules": { "MD013": { "max": 120 } } }', '```', '', '```sh', 'mkdir -p .config && cp inkwell.json .config/', '```'] },
    'docs/how-to/ignore-files.md': { pr: [204], before: null,
      after: ['# Skip paths with an ignore file', '', 'List one path or glob per line, like .gitignore.', '', '```sh', "printf 'vendor/\nbuild/\n' > .inkwellignore", 'inkwell check --ignore-file .inkwellignore .', '```', '', 'Lines starting with `#` are comments.', 'Paths are relative to the ignore file.', '', '## In CI', '', '```sh', 'inkwell check --ignore-file .inkwellignore --format json .', '```'] },
  },
  // earlier entries on the published changelog
  history: [
    { version: 'v1.4.2', date: '2026-09-12', title: 'Quieter output', text: 'Passing files no longer print a line. Use `--verbose` to see them.', labels: ['improvement', 'fix'] },
    { version: 'v1.4.1', date: '2026-08-29', title: 'Windows paths', text: 'Backslash paths now match ignore rules on Windows.', labels: ['fix'] },
    { version: 'v1.4.0', date: '2026-08-05', title: 'Rule MD022', text: 'Headings need a blank line above and below.', labels: ['feature'] },
  ],
  // release-notes.md, grouped; every line names its PR and the doc it points at
  notes: {
    version: 'v1.5.0', previous: 'v1.4.2', bump: 'minor', bump_reason: '3 features, 0 breaking',
    title: 'inkwell 1.5.0',
    intro: 'Skip paths with an ignore file, read results as JSON, and one new rule.',
    groups: [
      { label: 'Added', lines: [
        { text: '`--ignore-file` skips paths listed in a file, like .gitignore.', pr: 204, doc: 'docs/how-to/ignore-files.md' },
        { text: 'Rule MD041: the first line of a file must be a heading.', pr: 206, doc: 'docs/reference/rules.md' },
        { text: '`--format json` prints results as JSON for scripts and CI.', pr: 207, doc: 'docs/reference/cli.md' },
      ] },
      { label: 'Changed', lines: [
        { text: '`--fix` is now `--write`. The old flag still works and prints a warning.', pr: 212, doc: 'README.md' },
        { text: 'The config file can live in `.config/inkwell.json`.', pr: 210, doc: 'docs/how-to/config.md' },
        { text: 'Scans of large repos are about 3x faster.', pr: 209, doc: null },
      ] },
      { label: 'Fixed', lines: [
        { text: 'Tabs inside tables no longer trip MD013.', pr: 213, doc: null },
        { text: 'A config error now exits with code 2, not 1.', pr: 214, doc: 'docs/reference/cli.md' },
      ] },
    ],
    skipped: [[216, 'chore, not user-facing']],
    contributors: ['dev-a', 'dev-b', 'dev-c'],
    full_changelog: 'v1.4.2...v1.5.0',
  },
  // samples step: every code block and CLI example in the touched docs
  samples: {
    total: 16, ok: 16, fixed: 1, links: { total: 42, ok: 42 }, help: 'inkwell --help matches docs/reference/cli.md',
    runs: [
      { n: 1, doc: 'README.md', cmd: 'npm install -g inkwell', result: 'ok' },
      { n: 2, doc: 'README.md', cmd: 'inkwell check README.md', result: 'ok' },
      { n: 3, doc: 'README.md', cmd: 'inkwell check --format json docs/', result: 'ok' },
      { n: 4, doc: 'docs/reference/cli.md', cmd: 'inkwell --help', result: 'ok' },
      { n: 5, doc: 'docs/reference/cli.md', cmd: 'inkwell check --ignore-file .inkwellignore .', result: 'ok' },
      { n: 6, doc: 'docs/reference/cli.md', cmd: 'inkwell check --config broken.json .; echo $?', result: 'ok', out: '2' },
      { n: 7, doc: 'docs/reference/rules.md', cmd: 'inkwell check --rule MD041 sample.md', result: 'ok' },
      { n: 8, doc: 'docs/reference/rules.md', cmd: 'inkwell rules --list', result: 'ok' },
      { n: 9, doc: 'README.md', cmd: 'inkwell check --fix README.md', result: 'failed', out: 'unknown flag --fix (did you mean --write?)', fix: { file: 'README.md', line: 41, from: '--fix', to: '--write', because_pr: 212 }, rerun: 'ok' },
      { n: 10, doc: 'docs/how-to/config.md', cmd: 'mkdir -p .config && cp inkwell.json .config/', result: 'ok' },
      { n: 11, doc: 'docs/how-to/config.md', cmd: 'inkwell check .', result: 'ok' },
      { n: 12, doc: 'docs/how-to/ignore-files.md', cmd: "printf 'vendor/\\nbuild/\\n' > .inkwellignore", result: 'ok' },
      { n: 13, doc: 'docs/how-to/ignore-files.md', cmd: 'inkwell check --ignore-file .inkwellignore .', result: 'ok' },
      { n: 14, doc: 'docs/how-to/ignore-files.md', cmd: 'inkwell check --format json . | head -5', result: 'ok' },
      { n: 15, doc: 'docs/reference/cli.md', cmd: 'inkwell --version', result: 'ok', out: '1.5.0' },
      { n: 16, doc: 'docs/reference/cli.md', cmd: 'inkwell check --write sample.md', result: 'ok' },
    ],
  },
  gate: {
    step: 'approve',
    gate: 'approve',
    summary: 'Read release-notes.md and the docs diff. Approve to publish the GitHub release, reject to stop.',
    action: 'Publish release v1.5.0 on acme/inkwell, tag v1.5.0 at main@c4e19a0, notes from release-notes.md',
    hash: 'sha256:4d9e01b7c3',
    keys: [['A', 'Approve'], ['R', 'Reject'], ['Enter', 'Open line source']],
  },
  // ?state=breaking: alternate run where a breaking change has no migration note; flagged, the run continues to approve
  breaking: {
    pr: { n: 215, title: 'Drop Node 18 support', label: 'breaking', author: 'dev-c' },
    bump_from: 'minor', bump_to: 'major?', version_to: 'v2.0.0',
    problem: 'PR #215 is labelled breaking but no doc says how to move off Node 18',
  },
  stream: {
    diff: ['gh: list merged PRs v1.4.2..main', '9 PRs, 37 commits', 'labels: 3 feature, 3 improvement, 2 fix, 1 chore'],
    map: ['read 9 PRs and their diffs', 'scan docs/ for flags and options named in the diffs', 'README.md, cli.md, rules.md, config.md affected', 'Diataxis gap: #204 has reference only, no how-to', 'wrote map.md'],
    update_1: ['branch mt/docs-run-8b2f', 'README.md: quick start uses --write, add --format json example', 'staged README.md'],
    update_2: ['cli.md: add --ignore-file, --format, exit code 2; rename --fix', 'rules.md: add MD041 with a passing and failing example', 'staged cli.md, rules.md'],
    update_3: ['config.md: .config/ location', 'new how-to: ignore-files.md, 38 lines', 'staged config.md, ignore-files.md'],
    changelog: ['group by label: Added 3, Changed 3, Fixed 2', 'skip #216 (chore)', 'bump: minor (features, no breaking)', 'wrote release-notes.md and CHANGELOG.md section'],
    samples: ['extract 16 code blocks from 5 docs', 'run 1 to 8 ok', 'run 9: unknown flag --fix', 'fix README.md:41 --fix to --write (PR #212)', 'rerun 9 ok', 'run 10 to 16 ok', 'links 42/42 ok', 'inkwell --help vs cli.md: match'],
    release: ['gh release create v1.5.0 --target c4e19a0 --notes-file release-notes.md', 'tag v1.5.0 created', 'release published'],
  },
  release: { url: 'github.com/acme/inkwell/releases/tag/v1.5.0', tag: 'v1.5.0', at: '10:36', took: '0m 06s' },
  // hand-back tray after release. The docs edits are staged; the user runs both items, the app runs neither.
  handback: {
    branch: 'mt/docs-run-8b2f',
    diff: { files: [['README.md', '+14', '-6'], ['docs/reference/cli.md', '+38', '-11'], ['docs/reference/rules.md', '+19', '-0'], ['docs/how-to/config.md', '+9', '-4'], ['docs/how-to/ignore-files.md', '+38', '-0'], ['CHANGELOG.md', '+19', '-0']], added: 137, removed: 21 },
    untracked: [],
    message: 'docs: update for v1.5.0 (ignore files, JSON output, --write)',
    items: [
      { n: 1, text: 'Commit the staged docs on mt/docs-run-8b2f', command: 'git commit -m "docs: update for v1.5.0 (ignore files, JSON output, --write)"' },
      { n: 2, text: 'Merge the docs branch into main', command: 'git merge --no-ff mt/docs-run-8b2f' },
    ],
  },
};
