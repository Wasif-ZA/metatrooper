// abcstage.js
(() => {
  const sk = (l, head, m) => `<div class="zsk zl-${one(l, ['board', 'photo', 'journal'], 'board')}${m ? ' zm' : ''}"><div class="znv">Bakery<span><i></i><i></i><i></i></span></div><div class="zhero"><i class="zph"></i><div class="ztx"><h4>${need(head)}</h4><s></s><s></s><u>Pre-order</u></div><div class="zhr"><em>Hours</em><p><span>Tue to Fri</span><span>7 to 3</span></p><p><span>Sat</span><span>7 to 2</span></p><p><span>Sun</span><span>8 to 12</span></p></div></div><div class="zbd"><span>Country sourdough</span><span>Seeded rye</span><span>Spelt tin</span></div></div>`;
  const REFK = ['zpa', 'zpb', 'zpc'];
  const refs = a => Array.isArray(a) && a.length ? `<div class="zrefs">${each(a.slice(0, 3), (r, i) => `<div class="zrf"><i class="zth ${REFK[i % 3]}"></i><span><b>PIN</b> ${need(r)}</span></div>`)}</div>` : '';
  const strip = (v, on) => `<div class="zsp${on ? ' zon' : ''}"><div class="zmini">${sk(v.layout, 'Bread from the oven at six')}</div><div class="zsi"><i class="zltr">${need(v.id)}</i><b>${need(v.name)}</b><span>${maybe(v.engine)} · :${maybe(v.port)} · ${maybe(v.cost)}</span></div></div>`;
  KIT.abcstage = {
    group: 'Review and documents',
    about: 'A, B and C side by side as a strip of small previews above one big stage: the chosen variant at full size with its direction, pinned references, agent log and the pick, combine, discard gate.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/design-design-variants', file: 'r3-abc-stage.html', shot: 'check/r3-gate.png' },
    req: { variants: 'arr' },
    opt: { focus: 'str', width: 'str', log: 'arr', gate: 'str' },
    r: p => {
      const vs = p.variants.filter(v => v && typeof v === 'object'), named = vs.filter(v => typeof v.name === 'string' && v.name);
      const cur = named.find(v => v.id === p.focus) || named[0];
      if (!cur) return `<div class="a-abcstage"><div class="ztx">No variants to show yet.</div></div>`;
      const wd = one(p.width, ['1280', '390'], '1280');
      return `<div class="a-abcstage"><div class="zstrip">${each(vs, v => strip(v, v === cur))}</div>
        <div class="zbg"><div class="zstg"><div class="zbar"><i></i><i></i><i></i><span class="zurl">127.0.0.1:${maybe(cur.port)}/</span><span class="zw${wd === '1280' ? ' zon' : ''}">1280</span><span class="zw${wd === '390' ? ' zon' : ''}">390</span></div>
          <div class="zvp ${wd === '390' ? 'zn' : ''}">${sk(cur.layout, cur.headline || 'Bread from the oven at six', wd === '390')}<span class="zfold">fold 800</span></div></div>
        <div class="zside"><div class="zdr"><span class="zk">Direction</span> ${maybe(cur.file)} <em>${need(cur.name)}</em></div>${refs(cur.refs)}<div class="ztx">${maybe(cur.summary)}</div>
          ${p.log ? `<div class="zlg"><span class="zk">Agent</span>${each(p.log, (l, i) => `<div class="${i < 3 ? 'zdim' : ''}">${need(l)}</div>`)}</div>` : ''}
          ${p.gate ? `<div class="zgt">${render({ type: 'gate', title: 'gate 2 of 2 · pick', text: p.gate, why: 'pick one variant, or combine two', actions: [{ label: 'Pick', key: 'P' }, { label: 'Combine', key: 'C' }, { label: 'Discard', key: 'D' }] })}</div>` : ''}</div></div></div>`;
    },
    ex: { type: 'abcstage', focus: 'A', width: '1280', gate: 'Pick one variant, or Combine two, then Continue.',
      log: ['read references r01 to r10', 'wrote direction-0.md', 'serving on http://127.0.0.1:4411', 'write index.html: header, hours board, button, list', 'commit 91c3d7e on mt/variants-run-5d1e-a'],
      variants: [
        { id: 'A', name: 'Chalkboard', engine: 'claude', layout: 'board', file: 'direction-0.md', port: '4411', verdict: 'pick', refs: ['Hand-lettered menu', 'Ruled price list', 'Large warm serif'], summary: 'The page is the shop board. Hours sit in a big boxed panel at the top right; the bread list is hand-ruled.', cost: '$0.52', time: '31m 50s', note: 'hours board and button share the first screen at 1280' },
        { id: 'B', name: 'Counter photo', engine: 'claude', layout: 'photo', file: 'direction-1.md', port: '4412', verdict: 'combine', refs: ['Full-bleed shop photo', 'Text over a panel', 'Large warm serif'], summary: 'The counter photo fills the first screen. A cream panel over it carries the line, hours and button.', cost: '$0.41', time: '29m 14s', note: 'photo is a grey placeholder until a real image is supplied' },
        { id: 'C', name: 'Journal', engine: 'codex', layout: 'journal', file: 'direction-2.md', port: '4413', verdict: 'discard', refs: ['Two-column food page', 'Large warm serif', 'Ruled price list'], summary: 'An editorial page: the photo on the left half, the text on the right, like a food journal spread.', cost: '$0.47', time: '33m 40s', note: 'at 390 the photo stacks above the text and pushes the button below the fold' },
      ] },
  };
})();

// agentdrawer.js
(() => {
  KIT.agentdrawer = {
    group: 'Agent and run',
    about: 'The Ctrl B drawer: Agents heading with session count and Clear, quick-start buttons, one row per session (title, engine · state · branch · diff, age) with a bar on the current one, usage at the foot.',
    origin: { folder: 'ouros-fiveshot-2026-10-30', file: 'now/03-list-ctrl-b.png (agents drawer)', shot: 'now/03-list-ctrl-b.png' },
    req: { sessions: 'arr' },
    opt: { starts: 'arr', cur: 'num', usage: 'arr' },
    r: p => `<div class="a-agentdrawer"><div class="hd"><b>Agents</b><span>${p.sessions.length} session${p.sessions.length === 1 ? '' : 's'}</span><span class="cl">Clear</span><span>×</span></div>
      ${p.starts ? `<div class="starts">${each(p.starts, s => `<span class="bt2">${need(s)}</span>`)}</div>` : ''}
      <div class="ls">${each(p.sessions, (s, i) => `<div class="se${i === (p.cur ?? 0) ? ' cur' : ''} s-${one(s.state, ['working', 'needs', 'starting', 'done', 'idle'], 'idle')}${s.state === 'needs' && SOURCE === 'system' ? ' attn' : ''}"><i></i><div class="tx"><b>${need(s.title)}</b><span>${maybe(s.meta)}</span></div><span class="ag">${maybe(s.age)}</span></div>`)}</div>
      ${p.usage ? `<div class="us"><div class="uh">Usage</div>${each(p.usage, u => `<div class="ur"><b>${need(u.engine)}</b><span>${need(u.text)}</span></div>`)}</div>` : ''}</div>`,
    ex: { type: 'agentdrawer', cur: 0, starts: ['+ claude', '+ codex', 'PowerShell', 'Git Bash'],
      sessions: [{ title: 'Retry on 429 with backoff', meta: 'claude · needs you · main +14 -1', age: '8s', state: 'needs' }, { title: 'Fix the midnight date test', meta: 'codex · working · ouros/date-test', age: '2m', state: 'working' }, { title: 'README quick start', meta: 'gemini · done · docs +61', age: '14m', state: 'done' }],
      usage: [{ engine: 'claude', text: '62% of 5h · resets in 1h 40m' }, { engine: 'codex', text: 'No local source for this provider’s limits' }] },
  };
})();

// agentsplit.js
(() => {
  const pct = v => Math.max(0, Math.min(100, Number(v) || 0));
  const KINDS = ['dim', 'user', 'head', 'tool', 'ok', 'say', 'wait', 'cmd'];
  const seg = s => {
    const st = one(s.state, ['done', 'cur', 'todo', 'needs'], 'todo');
    return `<div class="asg as-${st}${s.gate === true ? ' asgt' : ''}"><span class="astr"><i style="width:${st === 'todo' ? 0 : st === 'cur' ? 55 : 100}%"></i></span><span class="aslb"><b>${need(s.n)}</b> ${need(s.title)}<em>${maybe(s.took)}</em></span></div>`;
  };
  const line = l => `<div class="asl as-${one(l.kind, KINDS, 'say')}">${l.kind === 'cmd' ? '$ ' : l.kind === 'user' ? '&gt; ' : l.kind === 'ok' ? '&#10003; ' : l.kind === 'wait' ? '&#9670; ' : l.kind === 'tool' ? '&#9679; ' : ''}${need(l.text)}</div>`;
  const diff = f => {
    let o = 0, n = 0;
    return `<div class="asf"><div class="asfh">${need(f.name)}<span class="asad">+${need(f.add ?? 0)}</span><span class="asdd">-${need(f.del ?? 0)}</span></div>${each(A(f.lines), l => {
      const s = String(l), c = s[0];
      if (c === '@') { const m = s.match(/-(\d+)\D+\+(\d+)/); o = m ? Number(m[1]) : 1; n = m ? Number(m[2]) : 1; return `<div class="asd ash"><i></i><span>${need(l)}</span></div>`; }
      const num = c === '+' ? n++ : o++;
      if (c !== '+' && c !== '-') n++;
      return `<div class="asd${c === '+' ? ' asp' : c === '-' ? ' asm' : ''}"><i>${num}</i><span>${need(s)}</span></div>`;
    })}</div>`;
  };
  const A = v => Array.isArray(v) ? v : [];
  const dock = g => {
    const files = A(g.files), info = (files.length ? `<div class="aslab">Diff<span>${maybe(g.summary)}</span></div>${each(files, f => `<div class="asdr"><span>${need(f.name)}</span><span class="astr s"><i style="width:${pct(f.pct ?? 60)}%"></i></span><b class="asad">+${need(f.add ?? 0)}</b><b class="asdd">-${need(f.del ?? 0)}</b></div>`)}` : '') + (g.tests ? `<div class="aslab">Tests<span>${need(g.tests)}</span></div>` : '');
    return `<div class="asdk">${info ? `<div class="asdg">${info}</div>` : ''}${render({ type: 'gate', title: g.title, aside: g.sub, text: g.text ?? g.title, why: g.foot ?? 'waiting for you', action: g.action, hash: g.hash, actions: g.actions || [{ label: 'Approve', key: 'A', primary: true }, { label: 'Reject', key: 'R' }] })}</div>`;
  };
  KIT.agentsplit = {
    group: 'Agent and run',
    about: 'The agent and its artifacts side by side: a step strip of dithered bars, the agent transcript on the left, the changes it made on the right, and a gate dock that opens under the diff.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/coding-spec-to-pr', file: 's5-agent-split.html', shot: 'shots/s5-gate.png' },
    req: { steps: 'arr', lines: 'arr' },
    opt: { foot: 'arr', tabs: 'arr', summary: 'str', files: 'arr', gate: 'obj', aside: 'str' },
    r: p => `<div class="a-agentsplit"><div class="asst" style="--n:${Math.max(1, Math.min(12, p.steps.length))}">${each(p.steps, seg)}</div>
<div class="assp"><div class="asl0"><div class="astx">${each(p.lines, line)}</div>${p.foot ? `<div class="asft">${each(p.foot, f => `<span>${need(f)}</span>`)}</div>` : ''}</div>
<div class="asr"><div class="astb">${each(A(p.tabs), t =>`<span class="astab${t.on === true ? ' on' : ''}">${need(t.label)}${t.aside ? ` <em>${need(t.aside)}</em>` : ''}</span>`)}${p.aside ? `<span class="asas">${need(p.aside)}</span>` : ''}</div>
<div class="asbd">${p.summary ? `<div class="assm">${need(p.summary)}</div>` : ''}${each(A(p.files), diff)}</div>${p.gate ? each([p.gate], dock) : ''}</div></div></div>`,
    ex: {
      type: 'agentsplit',
      steps: [
        { n: '01', title: 'SPEC', took: '1m 12s', state: 'done' },
        { n: '02', title: 'APPROVE-SPEC', took: 'by you 38s', state: 'done', gate: true },
        { n: '03', title: 'BUILD', took: '3m 05s', state: 'done' },
        { n: '04', title: 'VERIFY', took: '4s', state: 'done' },
        { n: '05', title: 'APPROVE-PR', took: 'needs you', state: 'needs', gate: true },
        { n: '06', title: 'OPEN-PR', took: 'pending', state: 'todo' },
      ],
      lines: [
        { kind: 'dim', text: 'metatrooper run · spec-to-pr · run-7f3a · started 14:02' },
        { kind: 'user', text: 'What to build: Add a greet(name) function that returns "Hello, <name>!" and a test for it.' },
        { kind: 'head', text: '— 01 spec · claude plan —' },
        { kind: 'tool', text: 'Write(spec.md)  10 lines' },
        { kind: 'say', text: 'Spec written: Add greet(name). 1m 12s, 9,400 tok' },
        { kind: 'head', text: '— 02 approve-spec · gate, you —' },
        { kind: 'ok', text: 'approved by you: "Looks right."  38s' },
        { kind: 'head', text: '— 03 build · claude worker —' },
        { kind: 'tool', text: 'Update(test.js)  added a failing greet test' },
        { kind: 'tool', text: 'Bash(npm test)  FAIL greet is not a function' },
        { kind: 'tool', text: 'Update(index.js)  3 additions' },
        { kind: 'tool', text: 'Bash(npm test)  ok' },
        { kind: 'say', text: 'Done. greet(name) added with a test; both tests pass.' },
        { kind: 'head', text: '— 04 verify · action —' },
        { kind: 'cmd', text: 'npm test' },
        { kind: 'say', text: 'exit 0  ·  2 assertions passed' },
        { kind: 'head', text: '— 05 approve-pr · gate, you —' },
        { kind: 'wait', text: 'approve-pr: waiting for you before open-pr. Diff and action are in the drawer.' },
      ],
      foot: ['started 14:02', 'elapsed 6m 41s', '41,870 tok', '$0.36', '.troop/worktrees/run-7f3a', 'budget 120m'],
      tabs: [{ label: 'spec.md', aside: '10L' }, { label: 'Changes', aside: '+5 -1', on: true }, { label: 'Tests', aside: '2 passed' }],
      aside: 'artifacts follow the run',
      summary: '2 files changed +5 -1 · commit 4c1d9e2 on troop/greet',
      files: [
        { name: 'index.js', add: 3, del: 0, lines: ['@@ -1,3 +1,6 @@', ' export function add(a, b) {', '   return a + b;', ' }', '+export function greet(name) {', '+  return `Hello, ${name}!`;', '+}'] },
        { name: 'test.js', add: 2, del: 1, lines: ['@@ -1,5 +1,6 @@', "-import { add } from './index.js';", "+import { add, greet } from './index.js';"] },
      ],
      gate: { title: 'approve-pr', sub: 'Approve opening the pull request · guards open-pr', text: 'Open a pull request on acme/shopfront from troop/greet into main. Tests passed: true.', summary: '+5 -1', files: [{ name: 'index.js', add: 3, del: 0, pct: 70 }, { name: 'test.js', add: 2, del: 1, pct: 40 }], tests: '2 passed', action: 'git push origin troop/greet\ngh pr create --base main', hash: 'a91c…e04', foot: 'Reject stops the run before open-pr' },
    },
  };
})();

// agentthread.js
(() => {
  const hb = (it, i) => `<div class="hi2"><div class="noz">${i + 1}</div><div class="hb"><b>${need(it.title)}</b><span class="why2">${maybe(it.note)}</span>${it.cmd ? `<code class="cmd">${need(it.cmd)}</code>` : ''}${it.choices ? `<div class="chs">${acts(it.choices.map(c => ({ label: c })))}</div>` : ''}</div><div class="ha">${acts([{ label: 'Copy', key: 'C' }, { label: 'Done', key: 'D' }])}</div></div>`;
  const eng = e => `<div class="eg"><div class="eh"><b>${need(e.engine)}</b><i class="vd v-${one(e.verdict, ['approve', 'reject', 'notes'], 'notes')}">${need(e.verdict)}</i></div>${each(e.lines, l => `<div class="el">${need(l)}</div>`)}</div>`;
  const card = c => {
    const kind = one(c.kind, ['step', 'gate', 'you', 'pair', 'handback'], 'step');
    if (kind === 'you') return `<div class="cd2 you2"><span class="mk2">You</span>${need(c.text)}</div>`;
    const head = `<div class="ctz"><i class="icz"></i><b>${need(c.title)}</b>${c.stamp ? `<span class="stp">${need(c.stamp)}</span>` : ''}<span class="tm">${maybe(c.took)}</span></div>`;
    if (kind === 'gate') return `<div class="cd2 gatez">${head}<div class="gs">${need(c.text)}</div><div class="ga"><span>action</span> <code>${need(c.action)}</code><span class="hs">${maybe(c.hash)}</span></div></div>`;
    if (kind === 'pair') return `<div class="cd2">${head}<div class="pr">${each(c.engines, eng)}</div></div>`;
    if (kind === 'handback') return `<div class="cd2 hand">${head}${each(c.items, hb)}${c.ran ? `<div class="ran"><span>Ran by itself</span> ${need(c.ran)}</div>` : ''}</div>`;
    return `<div class="cd2">${head}${c.lines ? `<div class="lg2">${each(c.lines, l => `<div>${need(l)}</div>`)}</div>` : ''}</div>`;
  };
  KIT.agentthread = {
    group: 'Agent and run',
    about: 'One centred thread of activity cards in time order (steps, gates, two engines side by side, hand-back last), a state chip and run facts on the left margin and the activity list on the right.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/coding-spec-build-review-handback', file: 'r5-thread.html', shot: 'r5-thread-handback.png' },
    req: { cards: 'arr', chip: 'str' },
    opt: { facts: 'arr', activity: 'arr' },
    r: p => `<div class="a-agentthread"><div class="mg"><div class="chipz">${need(p.chip)}</div>${p.facts ? each(p.facts, f => `<div class="fc2"><span class="fk">${need(f.k)}</span>${need(f.v)}</div>`) : ''}</div>
      <div class="th2">${each(p.cards, card)}</div>
      ${p.activity ? `<div class="act2"><div class="ah"><span class="lbl">Activity</span> ${p.activity.length} cards</div>${each(p.activity, a => `<div class="ar"><i></i><span>${need(a.label)}</span><em>${maybe(a.took)}</em></div>`)}</div>` : ''}</div>`,
    ex: {
      type: 'agentthread', chip: 'Complete · yours now',
      facts: [{ k: 'Delegate', v: 'metatrooper loop' }, { k: 'Assignee', v: 'you, still responsible' }, { k: 'Asked', v: 'Add a --dry-run flag to tidy clean that lists what would be removed and removes nothing.' }, { k: 'Branch', v: 'mt/loop-run-5b1d' }, { k: 'Tests', v: '7 pass after fix' }],
      cards: [
        { kind: 'gate', title: 'asks you: pick which findings to fix', text: 'Tick the findings to fix. Unticked findings go to your hand-back list; nothing is dismissed.', action: 'fix B1, G1 on mt/loop-run-5b1d', hash: '#7d2e48b1', stamp: 'Fixing' },
        { title: 'fixed B1 and G1', took: '1m 49s', lines: ['B1: guard removeEmptyDirs behind !opts.dryRun', 'add test: empty folder still there after --dry-run', 'G1: add --dry-run to the help text', 'node --test: 7 pass', 'git add -u'] },
        {
          kind: 'handback', title: 'handed back to you', took: '0s',
          items: [
            { title: 'Commit the staged change', note: 'The agent never commits.', cmd: "git -C .worktrees/run-5b1d commit -m 'Add --dry-run to tidy clean'" },
            { title: 'Push the branch and open the pull request', note: 'Pushing and opening a PR are external.', cmd: 'git push -u origin mt/loop-run-5b1d && gh pr create --base main --fill' },
            { title: 'Decide C1: no test for --dry-run with --force', note: 'You left it unticked at pick-fixes.', choices: ['Send to agent', 'Note in the PR', 'Drop it'] },
            { title: 'Keep or delete scratch/sample-tree.txt', note: 'Untracked; the agent never stages it.', cmd: 'rm scratch/sample-tree.txt' },
          ],
          ran: 'Wrote the spec, built it test first, two engines reviewed, fixed 2 of 3 findings, tests pass (7). Nothing committed or pushed.',
        },
      ],
      activity: [
        { label: 'Write the spec', took: '1m 40s' }, { label: 'Approve the spec', took: '2m 05s' }, { label: 'Build it on a new branch', took: '4m 22s' }, { label: 'Run the tests', took: '3s' },
        { label: 'two reviews', took: '2m 31s' }, { label: 'Sort findings into buckets', took: '0s' }, { label: 'Pick which findings to fix', took: '1m 10s' }, { label: 'Fix the picked findings', took: '1m 49s' }, { label: 'Hand back to you', took: '0s' },
      ],
    },
  };
})();

// approvalsheet.js
(() => {
  KIT.approvalsheet = {
    group: 'Input and actions',
    about: 'The sheet that slides up under the wall: "N agent actions wait for you", one dashed card per action with who asked, when, the exact action and three answers. On an agent surface it draws grey and inert.',
    origin: { folder: 'ouros-fiveshot-2026-10-30', file: 'now/19-approvals-sheet.png (approvals sheet)', shot: 'now/19-approvals-sheet.png' },
    replaces: 'gate',
    req: { items: 'arr' },
    opt: { open: 'bool' },
    r: p => {
      const sys = SOURCE === 'system', n = p.items.length;
      const head = `<div class="hd"><b class="n${n ? '' : ' zero'}">${n}</b><span class="t">${n ? `${n} agent action${n === 1 ? '' : 's'} wait${n === 1 ? 's' : ''} for you` : 'No agent actions waiting'}</span>${sys ? '' : '<span class="nt">drawn by an agent · not an approval</span>'}<span class="cv">${p.open === false ? '⌃' : '⌄'}</span></div>`;
      const cards = p.open === false ? '' : `<div class="cs">${each(p.items, a => `<div class="cd"><div class="who"><i></i>${need(a.agent)}${a.where ? ` · ${need(a.where)}` : ''}${a.age ? ` <span>${need(a.age)}</span>` : ''}</div><div class="ac">${need(a.action)}</div><div class="why">${maybe(a.why)}</div><div class="bt"><button class="btn acc">Approve once</button><button class="btn">Approve for this session</button><button class="btn">Reject</button></div></div>`)}</div>`;
      return `<div class="a-approvalsheet${sys ? '' : ' inert'}">${head}${cards}</div>`;
    },
    ex: { type: 'approvalsheet', items: [
      { agent: 'claude', where: 'in linkkit, opened 12:12 pm', age: '9s', action: 'type into the page in shop.example.com', why: 'new origin' },
      { agent: 'codex', where: 'in linkkit, opened 12:14 pm', age: '2s', action: 'run npm publish --dry-run', why: 'network command' }] },
  };
})();

// apptopbar.js
(() => {
  KIT.apptopbar = {
    group: 'Layout',
    about: 'The app top bar: pixel brand mark, project crumb with waiting count, branch, core status chip, needs-you counter, search box with keys, New split button.',
    origin: { folder: 'ouros-fiveshot-2026-10-30', file: 'ref-css/wall.css (.brand, .crumb, .core, .needs, .search, .nsplit)', shot: 'now/18-wall-with-approvals.png' },
    req: { project: 'str' },
    opt: { brand: 'str', waiting: 'num', branch: 'str', core: 'str', needs: 'num', search: 'str', action: 'str' },
    set: { core: ['online', 'offline', 'starting'] },
    r: p => {
      const n = Number.isFinite(p.needs) ? Math.max(0, Math.round(p.needs)) : 0;
      const w = Number.isFinite(p.waiting) ? Math.max(0, Math.round(p.waiting)) : 0;
      return `<div class="a-apptopbar"><span class="mk"></span><b class="bm">${esc(p.brand || 'ouros')}</b><span class="sl">/</span><span class="pj">${esc(p.project)}${w ? ` <i>· ${w} waiting</i>` : ''} <i class="cv">⌄</i></span>${p.branch ? `<span class="sl">/</span><span class="bn">⑂ ${esc(p.branch)}</span>` : ''}<span class="core c-${p.core || 'online'}"><i></i>core ${esc(p.core || 'online')}</span><span class="nd${n ? '' : ' zero'}"><b>${n}</b>need you</span><span class="sr"><span class="mg">⌕</span><span class="q1">${esc(p.search || 'Search agents and commands')}</span><kbd>Ctrl</kbd><kbd>K</kbd></span><span class="sp"></span><span class="nw">+ ${esc(p.action || 'New')}</span></div>`;
    },
    ex: { type: 'apptopbar', project: 'linkkit', waiting: 3, branch: 'main', core: 'online', needs: 3 },
  };
})();

// artifactcols.js
(() => {
  const A = a => Array.isArray(a) ? a : [];
  const lc = l => String(l)[0] === '+' ? ' o-a' : String(l)[0] === '-' ? ' x' : String(l)[0] === '@' ? ' o-h' : '';
  const kv = rows => `<div class="fa">${each(A(rows), r => `<span>${need(r[0])}</span><span>${need(r[1])}</span>`)}</div>`;
  const BLOCKS = {
    field: b => `<div class="fd"><div class="o-k">${need(b.k)}</div><div class="o-v${b.big ? ' big' : ''}">${need(b.v)}</div></div>`,
    facts: b => `${b.title ? `<div class="o-sc">${need(b.title)}</div>` : ''}${kv(b.rows)}`,
    steps: b => `${b.title ? `<div class="o-sc">${need(b.title)}</div>` : ''}<div class="sl">${each(A(b.items), s => `<div class="o-st"><i class="nd k-${one(s.kind, ['step', 'gate'], 'step')} ${one(s.state, ['done', 'running', 'waiting', 'pending'], 'pending')}"></i><span class="o-t">${need(s.title)}</span><span class="o-s ${one(s.state, ['done', 'running', 'waiting', 'pending'], 'pending')}">${maybe(s.took)}</span><span class="o-m">${maybe(s.sub)}</span></div>`)}</div>`,
    doc: b => `<div class="o-md"><h3>${need(b.title)}</h3>${each(A(b.sections), s => `<h4>${need(s.h)}</h4>${s.text ? `<p>${need(s.text)}</p>` : ''}${A(s.checks).length ? `<ul>${each(A(s.checks), c => `<li><i class="o-ck ok"></i>${need(c)}</li>`)}</ul>` : ''}`)}</div>`,
    term: b => `<div class="bk"><div class="bh">${need(b.head)}<span class="o-m">${maybe(b.meta)}</span></div><div class="o-tb">${each(A(b.lines), l => `<div class="o-ln">${need(l)}</div>`)}</div></div>`,
    diff: b => `<div class="bk"><div class="bh">${need(b.head)}<span class="o-m">${maybe(b.meta)}</span></div>${each(A(b.files), f => `<div class="o-fl"><div class="o-fh">${need(f.name)}<span class="o-r"><span class="o-ad">+${need(f.add ?? 0)}</span><span class="dd">-${need(f.del ?? 0)}</span></span></div><div class="o-hk">${each(A(f.lines), l => `<div class="o-ln${lc(l)}">${need(l)}</div>`)}</div></div>`)}</div>`,
    stamp: b => `<div class="vr"><span class="vd ${one(b.tone, ['ok', 'no'], 'ok')}">${need(b.text)}</span><span class="o-m">${maybe(b.note)}</span></div>`,
    pr: b => `<div class="pr"><div class="top"><span class="num">#${need(b.number)}</span>${b.stamp ? `<span class="vd ok">${need(b.stamp)}</span>` : ''}</div><div class="tt">${need(b.title)}</div><div class="o-br">${maybe(b.meta)}</div>${b.url ? `<div class="o-url">${need(b.url)}</div>` : ''}</div>`,
    checks: b => `${b.title ? `<div class="o-sc">${need(b.title)}</div>` : ''}<div class="cl">${each(A(b.items), c => `<div class="chk"><i class="o-ck ok"></i><span>${need(c.text)}</span><span class="o-v">${maybe(c.value)}</span></div>`)}</div>`,
    quote: b => `<div class="qt">${need(b.text)}</div>`,
  };
  const col = c => {
    const st = one(c.state, ['done', 'running', 'waiting', 'pending'], 'pending');
    return `<div class="co ${st}${c.grow ? ' grow' : ''}"><div class="o-ch"><span class="o-no">${need(c.n)}</span><span class="o-nm">${need(c.title)}</span><span class="fn">${maybe(c.sub)}</span><span class="bg ${st}">${st === 'pending' ? 'pending' : st === 'waiting' ? 'needs you' : need(c.badge || st)}</span></div><div class="o-cb">${each(A(c.blocks), b => (Object.hasOwn(BLOCKS, b.kind) && BLOCKS[b.kind] || (() => {
  const A = a => Array.isArray(a) ? a : []; throw 0; }))(b))}</div>${c.foot ? `<div class="o-ft">${need(c.foot)}</div>` : ''}</div>`;
  };
  const seam = g => `<div class="sm ${one(g.state, ['done', 'waiting', 'pending'], 'done')}"><span class="ln0"></span><span class="vt">${need(g.label)}${g.by ? ` · ${need(g.by)}` : ''}${g.took ? ` · ${need(g.took)}` : ''}</span></div>`;
  KIT.artifactcols = {
    group: 'Agent and run',
    about: 'A run drawn as artifact columns left to right (idea, spec, changes, pull request) with a narrow vertical seam between them where each approval gate sits.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/coding-spec-to-pr', file: 's2-columns.html', shot: 'shots/s2-done.png' },
    req: { cols: 'arr' },
    opt: { gates: 'arr' },
    r: p => `<div class="a-artifactcols">${A(p.cols).map((c, i, cs) => `${each([c], col)}${i === cs.length - 1 ? '' : A(p.gates)[i] && A(p.gates)[i].label ? each([A(p.gates)[i]], seam) : '<div class="sm link"><span class="ln0"></span></div>'}`).join('')}</div>`,
    ex: {
      type: 'artifactcols',
      cols: [
        { n: '01', title: 'Idea', sub: 'inputs', state: 'done', blocks: [
          { kind: 'field', k: 'What to build', v: 'Add a greet(name) function that returns "Hello, <name>!" and a test for it.', big: true },
          { kind: 'field', k: 'GitHub repository', v: 'acme/shopfront' },
          { kind: 'field', k: 'Base branch', v: 'main' },
          { kind: 'facts', title: 'Run', rows: [['run', 'run-7f3a'], ['started', '14:02'], ['branch', 'troop/greet'], ['budget', '120 min']] },
          { kind: 'steps', title: 'Steps', items: [
            { title: 'Write the spec', sub: 'agent · claude · spec.md', took: '1m 12s', state: 'done' },
            { title: 'Approve the spec', sub: 'by you', took: '38s', state: 'done', kind: 'gate' },
            { title: 'Build it on a new branch', sub: '2 files, 1 commit', took: '3m 05s', state: 'done' },
            { title: 'Run the tests', sub: '2 passed', took: '4s', state: 'done' },
            { title: 'Approve opening the PR', sub: 'by you', took: '21s', state: 'done', kind: 'gate' },
            { title: 'Push and open the PR', sub: 'PR #7', took: '9s', state: 'done' },
          ] },
        ] },
        { n: '02', title: 'Spec', sub: 'spec.md', state: 'done', blocks: [
          { kind: 'doc', title: 'Add greet(name)', sections: [
            { h: 'Goal', text: 'Export greet(name) from index.js that returns "Hello, <name>!".' },
            { h: 'Non-goals', text: 'No localisation. No changes to add(a, b).' },
            { h: 'User-visible behaviour', text: 'greet("Ada") returns "Hello, Ada!".' },
            { h: 'Acceptance checks', checks: ['greet("Ada") === "Hello, Ada!"', 'npm test passes, including the existing add test.'] },
          ] },
        ], foot: 'approve-spec by you in 38s' },
        { n: '03', title: 'Changes', sub: 'troop/greet', state: 'done', grow: true, blocks: [
          { kind: 'term', head: 'Build log', meta: 'claude worker · 3m 05s · 28,100 tok · 8 lines', lines: ['● Update(test.js)  ⎿ added a failing greet test', '● Bash(npm test)  ⎿ FAIL greet is not a function', '● Update(index.js)  ⎿ 3 additions', '● Bash(npm test)  ⎿ ok'] },
          { kind: 'diff', head: 'Diff', meta: '2 files · +5 -1 · 1 commit', files: [
            { name: 'index.js', add: 3, del: 0, lines: ['@@ -1,3 +1,6 @@', ' export function add(a, b) {', '+export function greet(name) {', '+  return `Hello, ${name}!`;', '+}'] },
            { name: 'test.js', add: 2, del: 1, lines: ['@@ -1,5 +1,6 @@', "-import { add } from './index.js';", "+import { add, greet } from './index.js';", "+assert.equal(greet('Ada'), 'Hello, Ada!');"] },
          ] },
          { kind: 'term', head: 'Verify', meta: 'npm test', lines: ['$ npm test', 'ok', 'exit 0  ·  2 assertions passed'] },
          { kind: 'stamp', text: 'Passed', note: '2 passed · 4s' },
        ] },
        { n: '04', title: 'Pull request', sub: 'acme/shopfront', state: 'done', blocks: [
          { kind: 'term', head: 'Publish', meta: 'open-pr · 9s', lines: ['$ git push origin troop/greet', '$ gh pr create --base main'] },
          { kind: 'pr', number: 7, stamp: 'Opened', title: 'Add greet(name)', meta: 'troop/greet → main · 2 files · +5 -1', url: 'github.com/acme/shopfront/pull/7' },
          { kind: 'checks', title: 'Checks', items: [{ text: 'verify: npm test', value: '2 passed' }, { text: 'spec acceptance', value: '2 of 2' }, { text: 'approve-pr by you', value: 'a91c…e04' }] },
        ] },
      ],
      gates: [{}, { label: 'approve-spec', by: 'you', took: '38s' }, { label: 'approve-pr', by: 'you', took: '21s' }],
    },
  };
})();

// axischart.js
(() => {
  const n = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
  const nice = m => { const s = Math.pow(10, Math.floor(Math.log10(m || 1))); return [1, 2, 2.5, 5, 10].map(k => k * s).find(x => x >= m / 4) * 4; };
  KIT.axischart = {
    group: 'Workspaces',
    about: 'A bar chart an analyst can read off: numbered y-axis, gridlines, a value on every bar, an optional target line, one highlighted bar and a second series drawn as an outline behind.',
    origin: { folder: 'new for H4 (persona: data analyst)', file: 'no MetaTrooper source; drawn for the analysis workspace' },
    replaces: 'chart',
    req: { labels: 'arr', values: 'arr' },
    opt: { h: 'num', title: 'str', unit: 'str', prefix: 'str', target: 'num', targetLabel: 'str', mark: 'num', ghost: 'arr', ghostLabel: 'str', valueLabel: 'str' },
    r: p => {
      const L = p.labels.slice(0, 24), V = L.map((_, i) => n(p.values[i], 0, 1e12));
      const G = Array.isArray(p.ghost) ? L.map((_, i) => (p.ghost[i] == null ? null : n(p.ghost[i], 0, 1e12))) : null;
      const top = nice(Math.max(1, ...V, ...(G || []).filter(x => x != null), Number.isFinite(p.target) ? p.target : 0));
      const W = 420, H = n(p.h, 140, 420) || 200, l = 44, r = 8, t = 16, b = 24, iw = W - l - r, ih = H - t - b, bw = iw / Math.max(1, L.length);
      const y = v => (t + ih - (v / top) * ih).toFixed(1);
      const pre = typeof p.prefix === 'string' ? p.prefix : '', unit = typeof p.unit === 'string' ? p.unit : '';
      const ticks = [0, 1, 2, 3, 4].map(i => top * i / 4);
      const fmt = v => esc(pre + (Number.isInteger(v) ? v.toLocaleString('en-AU') : v.toFixed(1)) + unit);
      const grid = ticks.map(v => `<line class="axg" x1="${l}" x2="${W - r}" y1="${y(v)}" y2="${y(v)}"/><text class="axy" x="${l - 6}" y="${(Number(y(v)) + 3.5).toFixed(1)}">${fmt(v)}</text>`).join('');
      const mark = Number.isFinite(p.mark) ? Math.floor(p.mark) : -1;
      const bars = V.map((v, i) => {
        const x = l + i * bw + bw * .2, w = bw * .6;
        const gh = G && G[i] != null && G[i] !== v ? `<rect class="axgh" x="${x.toFixed(1)}" y="${y(G[i])}" width="${w.toFixed(1)}" height="${(t + ih - Number(y(G[i]))).toFixed(1)}"/>` : '';
        return `${gh}<rect class="axb${i === mark ? ' axm' : ''}" x="${x.toFixed(1)}" y="${y(v)}" width="${w.toFixed(1)}" height="${(t + ih - Number(y(v))).toFixed(1)}"/><text class="axv${i === mark ? ' axm' : ''}" x="${(x + w / 2).toFixed(1)}" y="${(Number(y(Math.max(v, G && G[i] != null ? G[i] : 0))) - 5).toFixed(1)}">${fmt(v)}</text><text class="axx" x="${(x + w / 2).toFixed(1)}" y="${H - 8}">${esc(String(L[i]))}</text>`;
      }).join('');
      const tgt = Number.isFinite(p.target) ? `<line class="axt" x1="${l}" x2="${W - r}" y1="${y(n(p.target, 0, 1e12))}" y2="${y(n(p.target, 0, 1e12))}"/>` : '';
      const key = `<span class="axk"><i class="axkb"></i>${maybe(p.valueLabel || 'value')}</span>${G ? `<span class="axk"><i class="axkg"></i>${maybe(p.ghostLabel || 'other')}</span>` : ''}${tgt ? `<span class="axk"><i class="axkt"></i>${maybe(p.targetLabel || 'target')}</span>` : ''}`;
      return `<figure class="a-axischart">${p.title ? `<figcaption><b>${need(p.title)}</b><span class="axkeys">${key}</span></figcaption>` : ''}<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(p.title || 'chart')}">${grid}<line class="axz" x1="${l}" x2="${W - r}" y1="${y(0)}" y2="${y(0)}"/>${tgt}${bars}</svg></figure>`;
    },
    ex: {
      type: 'axischart', title: 'Revenue by month', prefix: '$', unit: 'k', labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
      values: [42, 45, 31, 47, 49, 52], ghost: [null, null, 44, null, null, null], mark: 2, target: 45,
      valueLabel: 'recorded', ghostLabel: 'with missing orders', targetLabel: 'plan',
    },
  };
})();

// beforeafter.js
(() => {
  const A = a => Array.isArray(a) ? a : [];
  const O = o => o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  const T = v => { try { return maybe(v); } catch { return ''; } };
  const page = pg => (pg = O(pg), `<div class="pg"><b class="h">${maybe(pg.h)}</b><span class="in">${maybe(pg.field || pg.placeholder)}</span><span class="bt">${maybe(pg.button || 'Add')}</span>${each(A(pg.items), x => `<span class="li">${need(x)}</span>`)}<span class="ct">${T(pg.count)}</span></div>`);
  const pane = (s, kind) => (s = O(s), `<div class="pn ${kind}"><div class="pf"><span class="k">${T(s.label)}</span><span class="mt">${maybe(s.meta)}</span></div>
    ${s.page && typeof s.page === 'object' ? `<div class="bw"><div class="bb"><i></i><i></i><i></i><span class="url">${maybe(s.url)}</span><span class="sz">${maybe(s.size)}</span></div><div class="vp">${page(s.page)}</div></div>`
      : `<div class="bw none"><div class="vp dz"><span class="stp">${T(s.empty) || 'No after'}</span><span class="rs">${maybe(s.reason)}</span></div></div>`}
    <div class="cap">${each(A(s.caption), c => `<div>${need(c)}</div>`)}</div></div>`);
  KIT.beforeafter = {
    group: 'Review and documents',
    about: 'One finding as a before and after: the broken walk as a drawn browser page beside the page after the fix, or a dithered NO AFTER stamp when the agent left it open; captions under each, actions on top.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/coding-e2e-browser-qa', file: 'r4-before-after.html', shot: 'finding detail (side by side)' },
    replaces: 'compare',
    req: { title: 'str', before: 'obj', after: 'obj' },
    opt: { id: 'str', sev: 'str', where: 'str', state: 'str', view: 'str', actions: 'arr' },
    r: p => `<div class="a-beforeafter"><div class="hd"><span class="id">${maybe(p.id)}</span><span class="tt">${T(p.title)}</span><span class="sy">${maybe(p.sev)}</span><span class="wh">${maybe(p.where)}</span>${p.state ? `<span class="sk sk-${one(p.state, ['open', 'fixed'], 'open')}">${T(p.state)}</span>` : ''}${p.view ? `<span class="vw">${T(p.view)}</span>` : ''}<span class="ac">${acts(Array.isArray(p.actions) ? p.actions : undefined)}</span></div>
      <div class="two">${pane(p.before, 'bf')}${pane(p.after, 'af')}</div></div>`,
    ex: {
      type: 'beforeafter', id: 'F2', title: 'favicon.ico returns 404', sev: 'low', where: '/favicon.ico', state: 'open', view: 'Side by side',
      actions: [{ label: 'Send to agent', primary: true, key: 'S' }, { label: 'Dismiss', key: 'D' }, { label: 'Copy as issue', key: 'C' }],
      before: { label: 'Broken walk', meta: 'frame 1 · goto / · 00:02', url: '127.0.0.1:4317/', size: '1280x800',
        page: { h: 'Shopping list', placeholder: 'Item', count: '0 items' },
        caption: ['GET /favicon.ico returned 404 on load', 'every page, every flow'] },
      after: { label: 'After the fix', meta: 'not fixed', empty: 'No after', reason: 'No icon in the repository; needs an asset or a link tag decision.',
        caption: ['qa-report.md: still open, low', 'a person decides: add an icon or a link tag'] },
    },
  };
})();

// bom.js
(() => {
  const SRC = ['make', 'buy'], ST = ['ok', 'ordered', 'missing', 'changed'];
  KIT.bom = {
    group: 'Workspaces',
    about: 'Bill of materials for an assembly: each part, how many, make or buy, material, mass and stock state, with totals and the revision stamp.',
    origin: { folder: 'new for H4 (persona: mechanical engineer)', file: 'no MetaTrooper source; drawn for the part-design workspace' },
    replaces: 'table',
    req: { assembly: 'str', items: 'arr' },
    opt: { rev: 'str', totals: 'arr' },
    r: p => {
      const rows = each(p.items, (it, i) => `<tr class="bmst-${one(it.status, ST, 'ok')}"><td class="bmn">${i + 1}</td><td class="bmpn">${need(it.part)}${it.note ? `<span class="bmnt">${need(it.note)}</span>` : ''}</td><td class="bmq">${need(it.qty)}</td><td><span class="bmsrc bms-${one(it.source, SRC, 'make')}">${esc(one(it.source, SRC, 'make'))}</span></td><td class="bmm">${maybe(it.material)}</td><td class="bmq">${maybe(it.mass)}</td><td class="bmr">${it.status && it.status !== 'ok' ? `<span class="bmsp">${esc(one(it.status, ST, 'ok'))}</span>` : '<span class="bmok">in stock</span>'}</td></tr>`);
      const tot = p.totals ? `<div class="bmtot">${each(p.totals, t => `<span><i>${need(t[0])}</i>${need(t[1])}</span>`)}</div>` : '';
      return `<div class="a-bom"><div class="bmh"><span class="bmlb">Bill of materials</span><span class="bmas">${need(p.assembly)}</span>${p.rev ? `<span class="bmrv">Rev ${need(p.rev)}</span>` : ''}</div>
<table><thead><tr><th>#</th><th>Part</th><th class="bmr">Qty</th><th>Source</th><th class="bmm">Material</th><th class="bmr">Mass</th><th class="bmr">Stock</th></tr></thead><tbody>${rows}</tbody></table>${tot}</div>`;
    },
    ex: {
      type: 'bom', assembly: 'MA-20 motor mount', rev: 'C',
      items: [
        { part: 'MB-204 motor bracket', qty: '1', source: 'make', material: 'Al 6061-T6', mass: '212 g', status: 'changed', note: 'bore moved 2 mm' },
        { part: 'MP-11 base plate', qty: '1', source: 'make', material: 'Steel S275', mass: '640 g' },
        { part: 'NEMA 23 stepper motor', qty: '1', source: 'buy', material: '', mass: '1.0 kg', status: 'ordered' },
        { part: 'M5 × 12 socket head screw', qty: '8', source: 'buy', material: 'A2 stainless', mass: '4 g' },
        { part: 'M5 flat washer', qty: '8', source: 'buy', material: 'A2 stainless', mass: '1 g', status: 'missing' },
        { part: 'Rubber isolator 20 mm', qty: '4', source: 'buy', material: 'Neoprene', mass: '6 g' },
      ],
      totals: [['Parts', '23'], ['Make', '2'], ['Buy', '4'], ['Mass', '1.93 kg'], ['Cost', '$84.60']],
    },
  };
})();

// browsertab.js
(() => {
  KIT.browsertab = {
    group: 'Review and documents',
    about: 'The built-in browser pane: its own tab strip, back/forward/reload, the address field, Comment (pin a note to the page for an agent) and the page stage. The stage is a wireframe; agents never load a URL into it.',
    origin: { folder: 'ouros-fiveshot-2026-10-30', file: 'now/08-tab-browser.png + metatrooper-browser-fiveshot-2026-10-07', shot: 'now/08-tab-browser.png' },
    replaces: 'preview',
    req: { tabs: 'arr' },
    opt: { url: 'str', active: 'num', lines: 'arr', comments: 'arr' },
    r: p => `<div class="a-browsertab"><div class="ts">${each(p.tabs, (t, i) => `<span class="tab1${i === (p.active ?? 0) ? ' on' : ''}"><i></i>${need(t)}<span class="x">×</span></span>`)}<span class="pl">+</span></div>
      <div class="nv"><span class="ic">←</span><span class="ic">→</span><span class="ic">↻</span><span class="addr${p.url ? '' : ' pl'}">${esc(p.url || 'Search, or type a URL like localhost:3001 (Ctrl+L)')}</span><span class="cm">Comment</span><span class="ic">···</span></div>
      <div class="sg">${p.lines && p.lines.length ? `<div class="wf">${each(p.lines, (l, i) => `<div class="wl${i ? '' : ' h'}">${need(l)}</div>`)}</div>` : ''}${each(p.comments || [], (c, i) => `<span class="pin" style="left:${Math.max(2, Math.min(92, Number(c.x) || 10))}%;top:${Math.max(4, Math.min(88, Number(c.y) || 10))}%"><b>${i + 1}</b>${need(c.text)}</span>`)}</div></div>`,
    ex: { type: 'browsertab', tabs: ['localhost:3001', 'New tab'], url: 'localhost:3001/pricing', lines: ['Short links that last', 'Paste a URL', 'Pricing: Free, Pro, Team'], comments: [{ x: 58, y: 22, text: 'Hero wraps at 390' }] },
  };
})();

// bucketboard.js
(() => {
  const A = a => Array.isArray(a) ? a : [];
  const O = o => o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  const T = v => { try { return maybe(v); } catch { return ''; } };
  const COLS = [['both', 'Both', 'both engines raised it'], ['left', 'Only ', ''], ['right', 'Only ', ''], ['disagree', 'Disagree', 'your call']];
  const eng = v => { try { return need(v).replace(/^./, c => c.toUpperCase()); } catch { return 'Engine'; } };
  const MK = {
    left: '<i class="mk cx"></i>', right: '<i class="mk gm"></i>',
    both: '<i class="mk gm"></i><i class="mk cx"></i>', disagree: '<i class="mk cx"></i><i class="mk gm"></i>',
  };
  const hot = f => f.bucket === 'disagree';
  const op = (m, name, t) => t ? `<div class="op"><span class="who">${m}${name}</span><span>${T(t)}</span></div>` : '';
  const card = (f, p) => `<div class="fc s-${one(f.severity, ['critical', 'high', 'medium', 'low'], 'low')}${hot(f) ? ' hot' : ''}">${hot(f) ? '<span class="edge"></span>' : ''}
    <div class="top"><span class="sev">${need(f.severity)}</span><span class="loc">${maybe(f.where)}</span></div>
    <div class="t">${need(f.title)}</div>
    ${op('<i class="mk cx"></i>', eng(O(p.left).engine), f.left)}${op('<i class="mk gm"></i>', eng(O(p.right).engine), f.right)}
    <div class="acts">${acts(Array.isArray(f.actions) ? f.actions : [{ label: 'Send to agent', key: 'S', primary: true }, { label: 'Dismiss', key: 'D' }, { label: 'Copy', key: 'C' }])}</div></div>`;
  const head = p => ['left', 'right'].map(s => { const q = O(p[s]); return `<div class="eh"><span class="en">${MK[s]}${eng(q.engine)}</span><span class="vd">${T(q.verdict)}</span><span class="em">${T(q.took)}${q.tokens ? ` · ${T(q.tokens)} tok` : ''}</span></div>`; }).join('');
  KIT.bucketboard = {
    group: 'Review and documents',
    about: 'Four columns for one two-engine review: both found it, only one found it, or they disagree. The disagree column is the one that waits on you.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/coding-two-engine-review', file: 'r3-buckets.html', shot: 'shots/r3-sorted.png' },
    req: { left: 'obj', right: 'obj', findings: 'arr' },
    opt: { title: 'str' },
    r: p => `<div class="a-bucketboard"><div class="bh2">${head(p)}</div><div class="board">${COLS.map(([b, label, why]) => {
      const items = A(p.findings).filter(f => f && f.bucket === b);
      const name = b === 'left' ? eng(O(p.left).engine) : b === 'right' ? eng(O(p.right).engine) : '';
      return `<div class="col${b === 'disagree' ? ' dis' : ''}"><div class="chd"><span class="mks">${MK[b]}</span><span>${label}${name}</span><span class="why">${why}</span><span class="cn">${items.length}</span></div>
        <div class="cl">${items.length ? each(items, f => card(f, p)) : '<div class="empty">nothing here</div>'}</div></div>`;
    }).join('')}</div></div>`,
    ex: {
      type: 'bucketboard', title: 'Findings',
      left: { engine: 'codex', verdict: 'reject', took: '3m 10s', tokens: '30,120' },
      right: { engine: 'gemini', verdict: 'approve', took: '2m 41s', tokens: '31,300' },
      findings: [
        { bucket: 'both', severity: 'high', title: 'Unvalidated redirect', where: 'src/routes/login.ts:40-44', left: 'next= is passed to res.redirect without an allow-list.', right: 'The redirect target comes from the query string and is not checked.' },
        { bucket: 'left', severity: 'critical', title: 'Secret in client bundle', where: 'src/config.ts:12', left: 'STRIPE_SECRET is read in a module imported by the browser build.' },
        { bucket: 'right', severity: 'low', title: 'Magic number 3', where: 'src/cart/promo.ts:41', right: 'Name the promo size so 4-for-3 does not need a code change.' },
        { bucket: 'disagree', severity: 'medium', title: 'Error state not announced', where: 'src/checkout/Payment.tsx:18-30', left: 'Needs aria-live so screen readers hear the error.', right: 'The existing toast already announces it; no change needed.' },
      ],
    },
  };
})();

// calllist.js
(() => {
  KIT.calllist = {
    group: 'Workspaces',
    about: 'Today\'s call list for a small business: who, why, by when, a Call button on each, and a tick box to mark it done; done calls drop to the bottom, struck through.',
    origin: { folder: 'new for H4 (persona: shop owner)', file: 'no MetaTrooper source; drawn for the shop workspace' },
    replaces: 'queue',
    req: { items: 'arr' },
    opt: { title: 'str' },
    r: p => {
      const items = [...p.items.filter(i => !(i && i.done === true)), ...p.items.filter(i => i && i.done === true)];
      const left = p.items.filter(i => i && i.done !== true).length;
      const rows = each(items, it => `<div class="clr${it.done === true ? ' cldone' : ''}${it.first === true ? ' clfirst' : ''}"><span class="clck${it.done === true ? ' clon' : ''}"></span><div class="clbd"><div class="clt"><span class="cln">${need(it.who)}</span><span class="clw">${maybe(it.when)}</span></div><div class="cls">${need(it.why)}</div>${it.phone ? `<div class="clp">${need(it.phone)}</div>` : ''}</div>${it.done === true ? '' : '<span class="clcall">Call</span>'}</div>`);
      return `<div class="a-calllist"><div class="clhd"><span class="cllb">${maybe(p.title || 'Who to call')}</span><span class="clct">${esc(String(left))} left</span></div>${rows}</div>`;
    },
    ex: {
      type: 'calllist', title: 'Who to call',
      items: [
        { who: 'Marta, flour mill', why: 'Order 4 sacks for Wednesday delivery', when: 'by noon', phone: '0400 555 101', first: true },
        { who: 'Priya', why: 'Confirm cake design and Saturday pickup', when: 'today', phone: '0400 555 214' },
        { who: 'Joe, egg farm', why: 'Extra 10 trays for the weekend', when: 'Fri', phone: '0400 555 377' },
        { who: 'Corner Cafe', why: 'Next week\'s bread count', when: 'Mon', done: true },
      ],
    },
  };
})();

// citations.js
(() => {
  const ST = ['found', 'normalised', 'rebound', 'missing'];
  const LBL = { found: 'quote found', normalised: 'found, tidied', rebound: 'found, moved', missing: 'quote not found' };
  const chip = c => { const s = one(c.state, ST, 'found'); return `<span class="ctch cts-${s}"><i></i>${need(c.src)}${c.quote ? ` ${need(c.quote)}` : ''} <em>${LBL[s]}</em></span>`; };
  const item = (c, i, p) => c.heading ? `<div class="cthh"><span class="ctno">${i + 1}</span>${need(c.heading)}</div>` : `<div class="ctcl"><span class="ctno">${i + 1}</span><span class="ctid">${need(c.id)}</span><span class="cttx">${need(c.text)}${c.patched ? ` <span class="ctpt">${need(c.patched)}</span>` : ''}</span><span class="ctcs">${each(c.cites || [], chip)}</span></div>${c.note ? `<div class="ctnt"><b>Cite-check</b> ${need(c.note)}</div>` : ''}`;
  KIT.citations = {
    group: 'Review and documents',
    about: 'A written report line by line: each claim carries chips naming the source and quote that back it, marked found, normalised, rebound or missing by the cite-check.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/research-deep-research-cited', file: 'r4-citations.html', shot: 'origin/citations.png' },
    req: { claims: 'arr' },
    opt: { title: 'str', summary: 'str', check: 'str' },
    r: p => {
      const real = p.claims.filter(c => c && !c.heading);
      const cites = real.flatMap(c => Array.isArray(c.cites) ? c.cites : []);
      const ok = cites.filter(c => c && c.state !== 'missing').length;
      return `<div class="a-citations"><div class="cthd"><span class="ctk">${maybe(p.title || 'Report')}</span><span>${real.length} claims</span><span>${cites.length} quotes</span><span>${maybe(p.summary)}</span><b class="cttl${ok < cites.length ? ' ctbad' : ''}">${ok} of ${cites.length} found</b><span class="ctck">${maybe(p.check)}</span></div>
      ${each(p.claims, (c, i) => item(c, i, p))}</div>`;
    },
    ex: {
      type: 'citations', title: 'out/report.md', summary: '4 sections', check: 'cite-check round 2',
      claims: [
        { heading: 'How much cooler' },
        { id: 'c01', text: 'On hot days the top floor ran about 2 to 3 degrees lower than under a bare roof.', patched: 'f1 patched', cites: [{ src: 'Source 1, field trial', quote: 'p. 6' }] },
        { id: 'c02', text: 'The largest measured gap came during a heat wave, at 2.9 degrees in mid afternoon.', cites: [{ src: 'Source 18, heat-wave log', quote: 'p. 2' }] },
        { id: 'c14', text: 'On days above 32 degrees the top floor ran 2.1 to 3.4 degrees cooler.', cites: [{ src: 'Source 9, city study', quote: 'p. 11', state: 'rebound' }], note: 'found on the second try: the quote was not in source 7, so it was moved to source 9' },
        { heading: 'What changes the effect' },
        { id: 'c05', text: 'Deeper substrate gave more cooling on every hot day of the trial.', cites: [{ src: 'Source 4, substrate trial', quote: 'p. 3', state: 'normalised' }], note: 'found after evening out curly quotes and double spaces' },
        { id: 'c09', text: 'Succulent cover kept most of its cooling through a 20 day dry spell.', cites: [{ src: 'Source 9, city study', quote: 'p. 14' }, { src: 'Source 11, dry-spell notes', quote: 'p. 5', state: 'missing' }] },
      ],
    },
  };
})();

// clipcards.js
(() => {
  const fm = scene => {
    const s = one(scene, ['a', 'b'], 'a');
    const body = s === 'b' ? '<i class="zrb"></i><i class="zrt"></i><i class="zh1"><b></b><b></b><b></b><b></b></i><i class="zh2"><b></b><b></b><b></b><b></b></i>'
      : '<i class="zwn"></i><i class="zsf"></i><i class="zpe"><b class="ztr"></b><b class="zhd"></b></i><i class="ztb"></i><i class="zpt"><b class="zlf za"></b><b class="zlf zb"></b><b class="zlf zc"></b></i>';
    return `<div class="zfm zv"><div class="zsc zs-${s}">${body}</div></div>`;
  };
  const card = c => {
    const pick = c.pick === true;
    const tg = each(c.targets || [], t => `<span class="ztg z${one(t.state, ['ok', 'need', 'off'], 'ok')}">${need(t.label)}<i></i></span>`);
    return `<div class="zcard${pick ? ' zpick' : ''}${c.drop === true ? ' zdrop' : ''}"><div class="ztop">${fm(c.scene)}<div class="zmt"><b>${need(c.id)}${c.k ? ` <span class="zkk">${need(c.k)}</span>` : ''}</b><span>${need(c.at)} · ${need(c.len)} s</span>${pick && tg ? `<div class="ztgs">${tg}</div>` : ''}</div></div>
      <div class="zhook">${need(c.hook)}</div><div class="zpay"><i>payoff</i> ${maybe(c.payoff)}</div><div class="zwhy">${maybe(c.why)}</div></div>`;
  };
  KIT.clipcards = {
    group: 'Workspaces',
    about: 'Short-video clip cards: every candidate moment at equal weight with a vertical frame, hook line, payoff and reason; picked clips get a solid border and target chips, the rest stay dashed and dim.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/video-clips-to-scheduled-posts', file: 'r1-clip-cards.html', shot: 'check/r1-gate.png' },
    req: { clips: 'arr' },
    opt: { title: 'str', sub: 'str', stats: 'str' },
    r: p => `<div class="a-clipcards"><div class="zhh"><span class="zlbl">${maybe(p.title || 'Moments')}</span><span class="zsub">${maybe(p.sub)}</span><span class="zst">${maybe(p.stats)}</span></div><div class="zgrid">${each(p.clips, card)}</div></div>`,
    ex: {
      type: 'clipcards', title: 'moments.md', sub: '24 candidates, 15 to 60 s, from workshop.mp4', stats: '6 clips · 18 posts · 1 flag for you',
      clips: [
        { id: 'm01', at: '1:02', len: 39, hook: 'Most compost fails for one reason.', payoff: 'It is too wet, not too dry.', why: 'a claim, then the surprise answer', scene: 'a', drop: true },
        { id: 'm03', k: 'k1', at: '5:05', len: 44, pick: true, hook: 'Greens and browns, in one sentence.', payoff: 'two buckets of browns for every one of greens', why: 'one rule, stated cleanly, stands alone', scene: 'a', targets: [{ label: 'A' }, { label: 'B' }, { label: 'C' }] },
        { id: 'm04', at: '6:42', len: 38, hook: 'You do not need a bin.', payoff: 'a pile in a corner works', why: 'contrarian, but the payoff is weak', scene: 'a', drop: true },
        { id: 'm05', k: 'k2', at: '8:32', len: 47, pick: true, hook: 'Put your hand in it.', payoff: 'warm in the middle means it is working', why: 'a physical test anyone can copy', scene: 'b', targets: [{ label: 'A' }, { label: 'B' }, { label: 'C' }] },
        { id: 'm18', k: 'k5', at: '32:55', len: 56, pick: true, hook: 'Sieve before you use it.', payoff: 'the big bits go back in the heap', why: 'a satisfying hands demo', scene: 'b', targets: [{ label: 'A' }, { label: 'B', state: 'need' }, { label: 'C' }] },
        { id: 'm23', at: '42:20', len: 40, hook: 'Thanks and questions.', payoff: 'none', why: 'no payoff', scene: 'a', drop: true },
      ],
    },
  };
})();

// cmdpalette.js
(() => {
  let n = 0;
  const row = (r, cur) => `<div class="ri${n++ === cur ? ' cur' : ''}"><span class="ic">${r.kind === 'agent' ? '▣' : '›_'}</span><span class="lb">${need(r.name)}</span><span class="sb">${maybe(r.sub)}</span>${r.key ? `<kbd>${need(r.key)}</kbd>` : ''}</div>`;
  KIT.cmdpalette = {
    group: 'Input and actions',
    about: 'The Ctrl K palette: search line with keys, spaced group heads (Agents, Start, Actions, Panels), rows with an icon, a state or shortcut on the right, a bar on the current row, and a move/open/close footer.',
    origin: { folder: 'ouros-fiveshot-2026-10-30', file: 'ref-css/wall.css (.search, .rg, .ri, .sfoot)', shot: 'now/04-search-ctrl-k.png' },
    replaces: 'list',
    req: { groups: 'arr' },
    opt: { query: 'str', cur: 'num' },
    r: p => { n = 0; const cur = Number.isFinite(p.cur) ? p.cur : 0;
      return `<div class="a-cmdpalette"><div class="sb0"><span class="mg">⌕</span><span class="q${p.query ? '' : ' pl'}">${esc(p.query || 'Search agents and commands')}</span><kbd>Ctrl</kbd><kbd>K</kbd></div><div class="rs">${each(p.groups, g => `<div class="rg">${need(g.label)}</div>${each(g.rows || [], r => row(r, cur))}`)}</div><div class="sf"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div></div>`; },
    ex: { type: 'cmdpalette', cur: 0, groups: [
      { label: 'Agents', rows: [{ kind: 'agent', name: 'claude in linkkit, opened 12:12 pm', sub: 'needs you' }, { kind: 'agent', name: 'codex in linkkit, opened 12:14 pm', sub: 'working' }] },
      { label: 'Start', rows: [{ name: 'New claude agent' }, { name: 'New PowerShell tab' }] },
      { label: 'Actions', rows: [{ name: 'Show all agents as a grid', key: 'Ctrl+G' }, { name: 'Open a browser pane' }] }] },
  };
})();

// commandlog.js
(() => {
  const ST = ['ok', 'fail', 'run'];
  const stamp = (t, s) => t ? `<span class="sk sk-${one(s, ['ok', 'fail', 'dim'], 'dim')}">${need(t)}</span>` : '';
  const gl = s => `<i class="gl g-${one(s, ST, 'ok')}"></i>`;
  const act = a => `<div class="ac${a.state === 'fail' ? ' bad' : ''}"><span class="no">#${need(a.n)}</span><span class="vb">${need(a.verb)}</span><span class="ar">${maybe(a.arg)}</span><span class="tm">${maybe(a.t)}</span>${a.state === 'fail' ? '<i class="gl g-fail"></i>' : ''}</div>`;
  const flow = f => `<div class="fw">
    <div class="fh">${gl(f.state)}<span class="ft">${f.no != null ? need(f.no) + '. ' : ''}${need(f.title)}</span>${stamp(f.stamp, f.state === 'fail' ? 'fail' : 'ok')}</div>
    ${f.expect ? `<div class="xp">expect ${need(f.expect)}</div>` : ''}
    ${each(f.actions || [], act)}${f.err ? `<div class="er">${need(f.err)}</div>` : ''}</div>`;
  KIT.commandlog = {
    group: 'Agent and run',
    about: 'Run command log: pipeline steps as ticked rows with duration and verdict stamp, the browser steps nested under each flow as numbered actions with times, failed actions and console errors boxed.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/coding-e2e-browser-qa', file: 'r2-command-log.html', shot: 'left column (run and actions)' },
    req: { steps: 'arr' },
    opt: { title: 'str', pass: 'num', fail: 'num', open: 'num', file: 'str', foot: 'str' },
    r: p => `<div class="a-commandlog"><div class="hd"><span class="k">${maybe(p.title || 'Actions')}</span>${p.pass != null ? `<span class="c"><i class="gl g-ok"></i><b>${need(p.pass)}</b></span>` : ''}${p.fail != null ? `<span class="c"><i class="gl g-fail"></i><b>${need(p.fail)}</b></span>` : ''}${p.open != null ? `<span class="c"><i class="gl g-run"></i><b>${need(p.open)}</b></span>` : ''}<span class="fi">${maybe(p.file)}</span></div>
      ${each(p.steps, s => `<div class="sp${s.state === 'fail' ? ' bad' : ''}"><div class="sx"><span class="bx">${s.state === 'run' ? '' : '&#10003;'}</span><span class="st1">${need(s.title)}</span><span class="du">${maybe(s.dur)}</span>${stamp(s.stamp, s.state === 'fail' ? 'fail' : 'dim')}</div>${s.sub ? `<div class="sb">${need(s.sub)}</div>` : ''}${each(s.flows || [], flow)}</div>`)}
      ${p.foot ? `<div class="fo">${need(p.foot)}</div>` : ''}</div>`,
    ex: {
      type: 'commandlog', title: 'Actions', pass: 1, fail: 2, open: 0, file: 'e2e-browser-qa.json',
      foot: 'flows.md, written by the plan step. Arrows stop through frames.',
      steps: [
        { title: 'List the flows to check', dur: '1m 12s', stamp: 'done', sub: 'flows.md, 3 flows' },
        { title: 'Walk the flows in the browser', dur: '5m 31s', stamp: 'done', flows: [
          { no: 1, title: 'Add an item', state: 'fail', stamp: 'fail', expect: '"milk" is in the list and the count reads "1 item"',
            actions: [{ n: 1, verb: 'goto', arg: '/', t: '00:02' }, { n: 2, verb: 'click', arg: 'Item', t: '00:04' }, { n: 3, verb: 'type', arg: '"milk"', t: '00:06' }, { n: 4, verb: 'click', arg: 'Add', t: '00:08', state: 'fail' }],
            err: "TypeError: Cannot read properties of null (reading 'value')" },
          { no: 2, title: 'A blank item is ignored', state: 'ok', stamp: 'pass', expect: 'the list stays empty and the count reads "0 items"',
            actions: [{ n: 5, verb: 'type', arg: '" "', t: '00:31' }, { n: 6, verb: 'click', arg: 'Add', t: '00:33', state: 'fail' }] },
          { no: 3, title: 'The count follows the list', state: 'fail', stamp: 'fail', expect: 'the count reads "2 items"',
            actions: [{ n: 7, verb: 'type', arg: '"eggs"', t: '00:52' }, { n: 8, verb: 'click', arg: 'Add', t: '00:54', state: 'fail' }, { n: 9, verb: 'type', arg: '"bread", click Add', t: '00:58' }] },
        ] },
        { title: 'Fix what QA found', dur: '3m 48s', stamp: 'done', sub: 'commit 4f1c2d0, 1 commit, 1 fixed, 1 left' },
        { title: 'Run the tests', dur: '2s', stamp: 'passed', sub: 'passed, exit 0', flows: [
          { title: 'Re-walk after the fix', state: 'ok', stamp: 'pass', actions: [{ n: 10, verb: 'click', arg: 'Add, "milk" listed', t: '00:07' }] },
        ] },
        { title: 'Write the QA report', dur: '0s', stamp: 'done', sub: 'qa-report.md' },
      ],
    },
  };
})();

// coveragemap.js
(() => {
  const A = a => Array.isArray(a) ? a : [];
  const O = o => o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  const T = v => { try { return maybe(v); } catch { return ''; } };
  const n = v => Math.max(0, Math.min(99999, Math.round(Number(v)) || 0));
  const eng = v => { try { return need(v).replace(/^./, c => c.toUpperCase()); } catch { return 'Engine'; } };
  const hot = f => f.bucket === 'disagree' || f.severity === 'critical';
  const sil = t => [...String(t).matchAll(/\S+/g)].slice(0, 40).map(m => `<i style="left:calc(var(--cw) * ${n(m.index)});width:calc(var(--cw) * ${Math.min(n(m[0].length), 80)})"></i>`).join('');
  const marker = f => {
    const b = one(f.bucket, ['both', 'left', 'right', 'disagree'], 'left');
    return `<span class="mk${hot(f) ? ' need' : ''}" title="${T(f.title)}">${hot(f) ? '<i class="halo"></i>' : ''}${b !== 'left' ? '<i class="mg"></i>' : ''}${b !== 'right' ? '<i class="mc"></i>' : ''}</span>`;
  };
  const strip = (f, i, p) => {
    const found = A(p.findings).filter(x => x && x.file === f.path);
    const foc = p.focus === i;
    const fr = A(f.rows);
    const rows = each(fr, (r, j) => {
      const gap = j && n(r.n) > n(O(fr[j - 1]).n) + 1 ? `<div class="rowxco gap"><span class="gl">${n(O(fr[j - 1]).n) + 1}-${n(r.n) - 1} unchanged</span></div>` : '';
      const rd = one(r.read, ['left', 'right', 'both'], '');
      const hit = found.filter(x => n(x.line) === n(r.n));
      return `${gap}<div class="rowxco ${r.k === '+' ? 'add' : 'ctx'}${hit.length ? ' hl' + (hit.some(hot) ? ' need' : '') : ''}"><i class="tk t-left${rd === 'left' || rd === 'both' ? ' on' : ''}"></i><i class="tk t-right${rd === 'right' || rd === 'both' ? ' on' : ''}"></i><span class="rn">${n(r.n)}</span>${foc ? `<span class="tx">${need(r.t)}</span>` : `<span class="sil">${sil(need(r.t))}</span>`}${hit.map(marker).join('')}</div>`;
    });
    const slash = need(f.path).split('/');
    return `<div class="fstrip${foc ? ' focus' : ''}"><div class="shxco"><span class="nm">${slash.slice(0, -1).join('/')}${slash.length > 1 ? '/' : ''}<b>${slash[slash.length - 1]}</b></span><span class="pm"><span class="ad">+${n(f.add)}</span> <span class="dl">-${n(f.del)}</span></span></div>${rows}<div class="rowxco end"><span class="eh">rest of file unchanged</span></div></div>`;
  };
  const item = (f, p) => {
    const found = A(p.findings).filter(x => x && x.file === f.path);
    return `<div class="fr"><div class="pp">${need(f.path)}</div><div class="q"><span class="ad">+${n(f.add)}</span><span class="dl">-${n(f.del)}</span><span>${found.length} found</span><span class="rb">${found.map(marker).join('')}</span></div></div>`;
  };
  KIT.coveragemap = {
    group: 'Review and documents',
    about: 'One strip per changed file in dither: what each engine read down the left and right edges, and a marker on every line a finding landed.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/coding-two-engine-review', file: 'r4-coverage-map.html', shot: 'shots/r4-done.png' },
    req: { left: 'obj', right: 'obj', files: 'arr', findings: 'arr' },
    opt: { title: 'str', focus: 'num' },
    r: p => `<div class="a-coveragemap"><div class="tree"><div class="lab">${T(p.title) || 'Changed files'}</div>${each(A(p.files), f => item(f, p))}
      <div class="legend"><div><i class="tkk codex"></i><i class="m cx"></i>${eng(O(p.left).engine)}: read trail, finding</div><div><i class="tkk gemini"></i><i class="m gm"></i>${eng(O(p.right).engine)}: read trail, finding</div><div><i class="m both"></i>both found it, same lines</div><div class="o"><i class="m hot"></i>orange: needs you</div></div></div>
      <div class="strips">${each(A(p.files), (f, i) => strip(f, i, p))}</div></div>`,
    ex: {
      type: 'coveragemap', title: 'Changed files', focus: 1,
      left: { engine: 'codex' }, right: { engine: 'gemini' },
      files: [
        { path: 'src/routes/login.ts', add: 18, del: 4, rows: [
          { n: 38, t: "router.post('/login', async (req, res) => {", read: 'both' }, { n: 39, t: '  const user = await auth(req.body);', read: 'both' },
          { n: 40, k: '+', t: '  const next = req.query.next;', read: 'both' }, { n: 41, k: '+', t: '  if (user) {', read: 'left' },
          { n: 42, k: '+', t: "    return res.redirect(next || '/account');", read: 'both' }, { n: 43, k: '+', t: '  }', read: 'left' },
          { n: 44, k: '+', t: "  res.status(401).render('login', { error: true });", read: 'right' }, { n: 45, t: '});' },
        ] },
        { path: 'src/config.ts', add: 6, del: 1, rows: [
          { n: 10, t: 'export const config = {', read: 'left' }, { n: 11, t: '  apiBase: process.env.API_BASE,', read: 'left' },
          { n: 12, k: '+', t: '  stripeSecret: process.env.STRIPE_SECRET,', read: 'left' }, { n: 13, t: "  currency: 'AUD'," }, { n: 14, t: '};' },
        ] },
        { path: 'src/cart/promo.ts', add: 4, del: 3, rows: [
          { n: 40, t: 'export function promo(line) {', read: 'right' }, { n: 41, k: '+', t: '  const free = Math.floor(line.qty / 3);', read: 'right' },
          { n: 42, k: '+', t: '  return round(line.price * (line.qty - free));', read: 'right' }, { n: 43, t: '}' },
        ] },
        { path: 'src/checkout/Payment.tsx', add: 31, del: 9, rows: [
          { n: 18, k: '+', t: '  const [error, setError] = useState<string | null>(null);', read: 'both' },
          { n: 19, k: '+', t: '  async function pay(form: FormData) {', read: 'both' }, { n: 20, k: '+', t: '    const r = await submitPayment(form);', read: 'left' },
          { n: 21, k: '+', t: '    if (!r.ok) setError(r.message);', read: 'left' }, { n: 30, k: '+', t: '  {error && <p className="err">{error}</p>}', read: 'both' },
        ] },
      ],
      findings: [
        { file: 'src/routes/login.ts', line: 42, bucket: 'both', severity: 'high', title: 'Unvalidated redirect' },
        { file: 'src/config.ts', line: 12, bucket: 'left', severity: 'critical', title: 'Secret in client bundle' },
        { file: 'src/cart/promo.ts', line: 41, bucket: 'right', severity: 'low', title: 'Magic number 3' },
        { file: 'src/checkout/Payment.tsx', line: 21, bucket: 'disagree', severity: 'medium', title: 'Error state not announced' },
      ],
    },
  };
})();

// cuttimeline.js
(() => {
  const arr = v => Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : [];
  const n = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
  const fm = (scene, cap) => {
    const s = one(scene, ['a', 'b', 'c'], 'a');
    const body = '<i class="zwn"></i><i class="zsf"></i><i class="zpe"><b class="ztr"></b><b class="zhd"></b></i><i class="ztb"></i><i class="zpt"><b class="zlf za"></b><b class="zlf zb"></b><b class="zlf zc"></b></i>';
    return `<div class="zfm"><div class="zsc zs-a${s === 'a' ? '' : ' zs-' + s}">${body}</div>${cap ? `<span class="zcp">${need(cap)}</span>` : ''}</div>`;
  };
  const KINDS = ['video', 'caps', 'overlay', 'wave', 'music'];
  const pos = (v, len) => n(v, 0, len) / len * 100;
  const wave = () => Array.from({ length: 420 }, (_, i) => `<i style="height:${Math.round(10 + 78 * Math.abs(Math.sin(i * .71) * Math.sin(i * .19 + 1) * (.6 + .4 * Math.sin(i * .05))))}%"></i>`).join('');
  const item = (it, k, len) => {
    const l = pos(it.start, len), w = n(it.len, 0, len - n(it.start, 0, len)) / len * 100;
    const st = `left:${l.toFixed(2)}%;width:${w.toFixed(2)}%`;
    if (k === 'video') return `<div class="zcl" style="${st}"><div class="zcf">${fm(it.scene).repeat(Math.max(1, Math.min(10, Math.round(w / 6))))}</div><span class="zsl">${need(it.label)}</span></div>`;
    if (k === 'caps') return `<div class="zcl zcp2" style="${st}"><span>${need(it.label)}</span></div>`;
    if (k === 'overlay') return `<div class="zcl zov2" style="${st}"><span>${need(it.label)}</span></div>`;
    const ramps = (it.duck || []).map(d => { const a = n(d[0], 0, len), b = n(d[1], 0, len), s0 = n(it.start, 0, len), w0 = Math.max(.001, n(it.len, 0, len)), x1 = Math.max(0, (a - s0) / w0 * 100), x2 = Math.min(100, (b - s0) / w0 * 100); return [x1, x2]; });
    let pts = '0,3', cur = 0;
    ramps.forEach(([x1, x2]) => { pts += ` ${x1.toFixed(2)},3 ${(x1 + .8).toFixed(2)},8 ${(x2 - .8).toFixed(2)},8 ${x2.toFixed(2)},3`; });
    pts += ' 100,3';
    return `<div class="zcl zmu" style="${st}"><svg class="zdk" viewBox="0 0 100 10" preserveAspectRatio="none"><polyline points="${pts}"/></svg><span>${need(it.label)}</span></div>`;
  };
  const row = (t, len) => {
    const k = one(t.kind, KINDS, 'video');
    const inner = k === 'wave' ? `<div class="zwv">${wave()}</div>` : each(t.items || [], it => item(it, k, len));
    return `<div class="zrw"><div class="zhh"><b>${need(t.label)}</b><i>${maybe(t.sub)}</i></div><div class="ztrk zk-${k}">${inner}</div></div>`;
  };
  KIT.cuttimeline = {
    group: 'Workspaces',
    about: 'Edit timeline: an overview strip with a zoom window, stacked tracks (overlays, video frames, captions, voice, music), cut and flag marks, and a playhead.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/video-footage-to-edit', file: 'r1-timeline.html', shot: 'check/r1-gate.png' },
    req: { tracks: 'arr', length: 'num' },
    opt: { tabs: 'arr', title: 'str', file: 'str', playhead: 'num', marks: 'arr', scale: 'arr', view: 'obj', stats: 'arr', foot: 'str' },
    r: p => {
      const len = Math.max(1, Number(p.length) || 1);
      const vid = arr((arr(p.tracks).find(t => t.kind === 'video') || {}).items);
      const sceneAt = f => { const it = vid.find(v => f >= n(v.start, 0, len) && f < n(v.start, 0, len) + n(v.len, 0, len)); return it ? it.scene : 'a'; };
      const strip = Array.from({ length: 16 }, (_, i) => `<div class="zth">${fm(sceneAt((i + .5) / 16 * len))}</div>`).join('');
      const v = p.view || {};
      const view = v.len ? `<div class="zzw" style="left:${pos(v.start, len).toFixed(2)}%;width:${(n(v.len, 0, len) / len * 100).toFixed(2)}%"></div>` : '';
      const scale = (p.scale || []).length > 1 ? p.scale : null;
      const ruler = scale ? each(scale, (s, i) => `<span style="left:${(i / (scale.length - 1) * 100).toFixed(2)}%">${need(s)}</span>`) : '';
      const marks = each(p.marks || [], m => {
        const k = one(m.kind, ['cut', 'flag', 'need', 'take'], 'cut');
        return `<i class="zmk zk-${k}" style="left:${pos(m.at, len).toFixed(2)}%"><b></b>${m.label ? `<em>${need(m.label)}</em>` : ''}</i>`;
      });
      const ph = p.playhead != null ? `<i class="zph" style="left:${pos(p.playhead, len).toFixed(2)}%"></i>` : '';
      const hasNeed = (p.marks || []).some(m => m && m.kind === 'need');
      const tc = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
      const transport = `<span class="ztc"><b class="ztp">▶</b><b>◂|</b><b>|▸</b><span class="ztn">${tc(n(p.playhead, 0, len))}</span><span class="ztt">/ ${tc(len)}</span></span>`;
      return `<div class="a-cuttimeline"><div class="zbar"><span class="zlbl">${maybe(p.title || 'Timeline')}</span><span class="zfl">${maybe(p.file)}</span>${p.tabs ? `<span class="ztabs">${each(p.tabs, (t, i) => `<b${i === 0 ? ' class="zon"' : ''}>${need(t)}</b>`)}</span>` : ''}<span class="zst">${each(p.stats || [], s => `<span>${need(s)}</span>`)}</span></div>
        <div class="zscr"><div class="ztl">
          <div class="zrw zwhole"><div class="zhh"><b>whole</b></div><div class="zov0"><div class="zthumbs">${strip}</div>${view}</div></div>
          <div class="zrw zrul"><div class="zhh"></div><div class="zrl">${ruler}</div></div>
          ${each(p.tracks, t => row(t, len))}
          <div class="zovl">${marks}${ph}</div>
        </div></div>
        <div class="zfoot">${transport}<span class="zlg"><i class="zlk"></i>cut</span><span class="zlg"><i class="zlk zt"></i>take switch</span><span class="zlg"><i class="zdm"></i>flag</span>${hasNeed ? '<span class="zlg zneed"><i class="zdm"></i>left for you</span>' : ''}<span class="zag">${maybe(p.foot)}</span></div></div>`;
    },
    ex: {
      type: 'cuttimeline', title: 'Timeline', tabs: ['Tracks', 'Text', 'Strip c28'], file: 'edit/timeline.otio', length: 118, playhead: 69.6, scale: ['0:00', '0:30', '1:00', '1:30', '1:58'],
      view: { start: 52, len: 36 }, stats: ['41/41 cuts', '46 captions', '5 overlays'], foot: 'agent: passed, nothing left the agent can fix',
      tracks: [
        { label: 'V2', sub: 'overlays', kind: 'overlay', items: [{ start: 0, len: 5, label: 'title card' }, { start: 92, len: 6, label: 'step label' }] },
        { label: 'V1', sub: 'video', kind: 'video', items: [{ start: 0, len: 22, label: 'take-02', scene: 'b' }, { start: 22, len: 42, label: 'take-01', scene: 'a' }, { start: 64, len: 54, label: 'take-03', scene: 'c' }] },
        { label: 'CAP', sub: 'captions', kind: 'caps', items: [{ start: 1, len: 14, label: 'cut back to firm, pale roots' }, { start: 16, len: 16, label: 'put a layer of soil' }, { start: 34, len: 17, label: 'the plant sits below the rim' }, { start: 66, len: 22, label: 'fill in around it' }, { start: 90, len: 26, label: 'leave a little room at the top' }] },
        { label: 'A1', sub: 'voice', kind: 'wave' },
        { label: 'A2', sub: 'music', kind: 'music', items: [{ start: 0, len: 118, label: 'ambient-loop-01 bed -30 LUFS, duck -12 dB', duck: [[2, 18], [30, 44], [64, 90]] }] },
      ],
      marks: [{ at: 22, kind: 'take' }, { at: 64, kind: 'take', label: 'c30' }, { at: 21.4, kind: 'flag', label: 'c07' }, { at: 47.9, kind: 'flag', label: 'c19' }, { at: 69.6, kind: 'need', label: 'c28' }, { at: 81.2, kind: 'flag', label: 'c33' }],
    },
  };
})();

// datagrid.js
(() => {
  const TYPES = { num: 'number', text: 'text', date: 'date', cat: 'category', bool: 'yes/no' };
  const pct = v => Math.max(0, Math.min(100, Number(v) || 0));
  KIT.datagrid = {
    group: 'Workspaces',
    about: 'A data table the way an analyst reads one: each column with its type, empty-cell count and a small spread of its values, rows numbered, odd cells marked.',
    origin: { folder: 'new for H4 (persona: data analyst)', file: 'no MetaTrooper source; drawn for the analysis workspace' },
    replaces: 'table',
    req: { file: 'str', columns: 'arr', rows: 'arr' },
    opt: { total: 'str', marks: 'arr', note: 'str' },
    r: p => {
      const marks = new Map((p.marks || []).filter(m => m && Number.isFinite(m.row) && Number.isFinite(m.col)).map(m => [`${m.row}:${m.col}`, m]));
      const head = each(p.columns, c => { const em = Number(c.empty) || 0; return `<th class="${c.sel === true ? 'dgsel' : ''}"><div class="dgcn">${need(c.name)}</div><div class="dgcap"><span class="dgty">${esc(TYPES[one(c.type, Object.keys(TYPES), 'text')])}</span>${em > 0 ? `<span class="dgnl dgsome">${esc(String(em))} empty</span>` : ''}</div>
<div class="dghi">${Array.isArray(c.spread) ? c.spread.slice(0, 16).map(v => `<i style="height:${pct(v)}%"></i>`).join('') : ''}</div>${c.min !== undefined || c.max !== undefined ? `<div class="dgmm"><span>${maybe(c.min)}</span><span>${maybe(c.max)}</span></div>` : ''}</th>`; });
      const body = each(p.rows, (r, i) => `<tr><td class="dgrn">${i + 1}</td>${(Array.isArray(r) ? r : []).map((v, j) => {
        const m = marks.get(`${i}:${j}`), col = p.columns[j] || {};
        const empty = v === null || v === '';
        return `<td class="${col.type === 'num' ? 'dgnum' : ''}${empty ? ' dgemp' : ''}${m ? ' dgmk' : ''}${col.sel === true ? ' dgsel' : ''}">${empty ? 'empty' : esc(String(v))}${m && m.note ? `<span class="dgtip">${need(m.note)}</span>` : ''}</td>`;
      }).join('')}</tr>`);
      return `<div class="a-datagrid"><div class="dgbar"><span class="dglb">Data</span><span class="dgfile">${need(p.file)}</span><span class="dgtot">${maybe(p.total)}</span></div>
<div class="dgsc"><table><thead><tr><th class="dgrn"></th>${head}</tr></thead><tbody>${body}</tbody></table></div>${p.note ? `<div class="dgft">${need(p.note)}</div>` : ''}</div>`;
    },
    ex: {
      type: 'datagrid', file: 'orders-2026.csv', total: '12,480 rows · 7 columns · showing 1 to 8',
      columns: [
        { name: 'order_id', type: 'text', empty: 0 },
        { name: 'date', type: 'date', empty: 0, spread: [20, 24, 30, 28, 35, 40, 38, 52, 60, 58, 66, 90] },
        { name: 'region', type: 'cat', empty: 0, spread: [90, 64, 40, 22] },
        { name: 'product', type: 'cat', empty: 0, spread: [70, 55, 42, 30, 18, 12] },
        { name: 'units', type: 'num', empty: 0, spread: [80, 60, 34, 20, 10, 6, 3, 2] },
        { name: 'revenue', type: 'num', empty: 41, sel: true, spread: [70, 88, 52, 30, 18, 9, 4, 2, 1, 1, 1, 6] },
        { name: 'returned', type: 'bool', empty: 0, spread: [94, 6] },
      ],
      rows: [
        ['A-10021', '2026-01-04', 'North', 'Trail pack 30L', 2, 178.00, 'no'],
        ['A-10022', '2026-01-04', 'Coast', 'Rain shell', 1, 129.00, 'no'],
        ['A-10023', '2026-01-05', 'North', 'Camp stove', 1, null, 'no'],
        ['A-10024', '2026-01-05', 'Inland', 'Trail pack 30L', 1, 89.00, 'yes'],
        ['A-10025', '2026-01-06', 'Coast', 'Head torch', 4, 96.00, 'no'],
        ['A-10026', '2026-01-06', 'North', 'Rain shell', 1, 12900.00, 'no'],
        ['A-10027', '2026-01-07', 'Islands', 'Camp stove', 2, 118.00, 'no'],
        ['A-10028', '2026-01-07', 'Inland', 'Head torch', 1, 24.00, 'no'],
      ],
      marks: [{ row: 5, col: 5, note: '100× the usual price' }],
      note: 'revenue has 41 empty cells and 1 value 100 times too big. Row 6 looks like cents typed as dollars.',
    },
  };
})();

// depledger.js
(() => {
  const arr = v => Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : [];
  const pc = v => Math.max(0, Math.min(100, Number(v) || 0));
  const row = r => `<div class="dlrw${r.hot === true ? ' dlhot' : ''}"><span class="dlcb"></span><b class="dlnm">${need(r.name)}</b><span>${need(r.current)}</span><span>${need(r.latest)}</span><span class="dlty">${maybe(r.type || 'none')}</span><span>${maybe(r.licence)}</span><span class="dlav${r.advisory ? '' : ' dlnone'}">${r.advisory ? need(r.advisory) : 'none'}</span><span class="dlcp">${r.compat == null ? '' : `<i class="dlbr"><u style="width:${pc(r.compat)}%"></u></i>${pc(r.compat)}%`}</span></div>`;
  const group = g => `<div class="dlgp${g.hot === true ? ' dlhot' : ''}"><div class="dlgh">${need(g.label)} <b>${g.rows.length}</b></div>${each(g.rows, row)}${g.detail ? detail(g.detail) : ''}</div>`;
  const detail = d => `<div class="dldt">
    <div class="dlbx"><div class="dlk">Upgrade path</div>${each(d.path || [], (s, i) => `<div class="dlst${i === 0 ? ' dltop' : ''}">${need(s)}</div>`)}</div>
    <div class="dlbx"><div class="dlk">Release notes</div>${each(d.notes || [], n => `<div class="dlnn"><span class="dlvr">${need(n.ver)}</span><span>${need(n.text)}</span></div>`)}</div>
    <div class="dlbx"><div class="dlk">Findings <span>${maybe(d.closes)}</span></div>${each(d.findings || [], f => `<div class="dlfn"><span class="dlfi">${need(f.id)}</span><span class="dlft">${need(f.title)}</span><span class="dlfs">${maybe(f.state)}</span><span class="dldots">${[1, 2, 3, 4, 5].map(i => `<i${i <= Math.max(0, Math.min(5, Math.round(Number(f.sev) || 0))) ? ' class="on"' : ''}></i>`).join('')}</span></div>`)}${d.verdict ? `<div class="dlvd">${need(d.verdict)}</div>` : ''}</div></div>`;
  const lic = (x, max) => `<div class="dllr"><span>${need(x.name)}</span><i class="dlbr"><u style="width:${Math.max(2, Math.min(100, Math.round(100 * (Number(x.count) || 0) / max)))}%"></u></i><span class="dln">${need(x.count)}</span></div>`;
  KIT.depledger = {
    group: 'Review and documents',
    about: 'Dependency ledger: every package with current, latest, type, licence, advisory and a compatibility bar; the one needing approval opens into its upgrade path, notes and findings.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/security-security-review-and-upgrade', file: 'r2-ledger.html', shot: 'origin/depledger.png' },
    req: { title: 'str', groups: 'arr' },
    opt: { sub: 'str', licences: 'arr', licenceNote: 'str', summary: 'arr', summaryNote: 'str' },
    r: p => {
      const max = Math.max(1, ...arr(p.licences).map(x => Number(x.count) || 0));
      return `<div class="a-depledger"><div class="dlhd"><b>${need(p.title)}</b><span>${maybe(p.sub)}</span></div>
      <div class="dlth"><span></span><span>Package</span><span>Current</span><span>Latest</span><span>Type</span><span>Licence</span><span>Advisory</span><span>Compat</span></div>
      ${each(p.groups, group)}
      ${p.licences ? `<div class="dllc"><div class="dlk">Licence report <span>${maybe(p.licenceNote)}</span></div>${each(p.licences, x => lic(x, max))}</div>` : ''}${p.summary ? `<div class="dlsm">${each(p.summary, s => `<span><b>${need(s.n)}</b>${need(s.label)}</span>`)}<em>${maybe(p.summaryNote)}</em></div>` : ''}</div>`;
    },
    ex: {
      type: 'depledger', title: 'Dependency dashboard', sub: 'acme/ledger-cli · 42 deps · 6 direct · 36 transitive · mit',
      groups: [
        { label: 'Needs approval', hot: true, rows: [{ name: 'yamlish', current: '2.4.1', latest: '3.0.2', type: 'major', licence: 'MIT', advisory: 'GHSA-demo-7q2x-yaml', compat: '91', hot: true }],
          detail: {
            path: ['yamlish 2.4.1 -> 3.0.2', 'drops yamlish-core 1.2.0', 'codemod load( to parse( x3', 'bump b41e09c', 'check round 1: 37/38', 'fix 5c7d2aa, 1 assertion', 'check round 2: 38/38', 'licences 42, 0 conflicts'],
            notes: [{ ver: '3.0.0', text: 'load() renamed to parse(); the full schema is gone, !!js/* tags now throw' }, { ver: '3.0.1', text: 'faster anchors' }, { ver: '3.0.2', text: 'fix: error line numbers off by one' }],
            closes: 'closes 1 of 3',
            findings: [{ id: 'F1', title: 'Untrusted YAML loaded with the full schema', sev: 4, state: 'closed by upgrade' }, { id: 'F2', title: 'Token-shaped string in a test fixture', sev: 3, state: 'not closed, in report' }, { id: 'F3', title: 'Error message echoes the full file path', sev: 1, state: 'not closed, in report' }],
            verdict: 'yamlish 3 drops the full schema and parse() is safe by default; the advisory is the same bug.',
          } },
        { label: 'Up to date', rows: [
          { name: 'argkit', current: '5.1.0', latest: '5.1.0', licence: 'MIT' },
          { name: 'tablefmt', current: '1.8.3', latest: '1.8.3', licence: 'ISC' },
          { name: 'decimal-lite', current: '0.9.4', latest: '0.9.4', licence: 'Apache-2.0' },
        ] },
      ],
      licences: [{ name: 'MIT', count: '27' }, { name: 'ISC', count: '6' }, { name: 'Apache-2.0', count: '2' }, { name: 'BSD-3-Clause', count: '1' }],
      licenceNote: 'every package against mit',
      summary: [{ n: '42', label: 'checked' }, { n: '0', label: 'conflicts' }, { n: '0', label: 'unknown' }], summaryNote: 'yamlish MIT at 2.4.1, MIT at 3.0.2: licence unchanged by the upgrade',
    },
  };
})();

// diffscope.js
(() => {
  const chip = (c, on) => `<span class="cp${on ? ' on' : ''}">${need(c.name)}${c.add ? ` <i class="ad">${need(c.add)}</i>` : ''}${c.del ? ` <i class="dl">${need(c.del)}</i>` : ''}</span>`;
  KIT.diffscope = {
    group: 'Review and documents',
    about: 'The Diff tab: whose changes (all agents or one), which scope (last turn, uncommitted, whole branch), which file, then the hunk with line numbers and the files not yet added.',
    origin: { folder: 'ouros-fiveshot-2026-10-30', file: 'now/05-tab-diff.png (Diff tab)', shot: 'now/05-tab-diff.png' },
    replaces: 'diff',
    req: { hunks: 'arr' },
    opt: { agents: 'arr', agent: 'num', scopes: 'arr', scope: 'num', files: 'arr', file: 'num', untracked: 'arr', action: 'str' },
    r: p => `<div class="a-diffscope">${p.agents ? `<div class="rw">${each(p.agents, (a, i) => chip(a, i === (p.agent ?? 0)))}<span class="sp"></span>${p.action ? `<span class="hb">${esc(p.action)}</span>` : ''}</div>` : ''}
      ${p.scopes ? `<div class="rw">${each(p.scopes, (s, i) => `<span class="cp sc${i === (p.scope ?? 0) ? ' on' : ''}">${need(s)}</span>`)}</div>` : ''}
      ${p.files ? `<div class="rw">${each(p.files, (f, i) => chip(f, i === (p.file ?? 0)))}</div>` : ''}
      <div class="hunk">${each(p.hunks, h => `<div class="hhead">${need(h.head)}</div>${each(h.lines || [], l => { const s = String(l.text ?? l); const k = s[0] === '+' ? 'a' : s[0] === '-' ? 'r' : ''; return `<div class="dline ${k}"><span class="no">${maybe(l.no)}</span><span>${need(s)}</span></div>`; })}`)}</div>
      ${p.untracked && p.untracked.length ? `<div class="ut"><b>New files not yet added</b><ul>${each(p.untracked, u => `<li>${need(u)}</li>`)}</ul></div>` : ''}</div>`,
    ex: { type: 'diffscope', action: 'Hand back', agent: 1,
      agents: [{ name: 'All changes', add: '+16', del: '-2' }, { name: 'claude', add: '+14', del: '-1' }, { name: 'codex', add: '+2', del: '-1' }],
      scopes: ['Last turn', 'Uncommitted', 'Whole branch'], files: [{ name: 'src/api/client.ts', add: '+14', del: '-1' }],
      hunks: [{ head: '@@ -40,3 +40,5 @@', lines: [{ no: 40, text: '-  return fetch(url)' }, { no: 40, text: '+  for (let i = 0; i < 5; i++) {' }, { no: 41, text: '+    const r = await fetch(url); if (r.status !== 429) return r' }, { no: 42, text: '+    await sleep(2 ** i * 500) }' }] }],
      untracked: ['notes.md'] },
  };
})();

// directionlanes.js
(() => {
  const REFK = ['pa', 'pb', 'pc'];
  const refs = a => Array.isArray(a) && a.length ? `<div class="refs">${each(a.slice(0, 3), (r, i) => `<div class="zrf"><i class="zth ${REFK[i % 3]}"></i><span><b>PIN</b> ${need(r)}</span></div>`)}</div>` : '';
  const lane = l => `<div class="zln"><div class="lh"><i class="ltr">${need(l.id)}</i><div><b>${need(l.name)}</b><span>${maybe(l.engine)} · ${maybe(l.branch)}</span></div><em class="ls">${maybe(l.state || 'not started')}</em></div>
    <div class="zblk"><span class="zk">Pinned references</span>${refs(l.refs)}</div>
    <div class="wr">wrote ${maybe(l.file)}</div>
    <div class="zdir">${maybe(l.summary)}${l.rules ? `<ul>${each(l.rules, r => `<li>${need(r)}</li>`)}</ul>` : ''}</div>
    ${l.borrows ? `<div class="bo">${each(l.borrows, (b, i) => `<span><b>r0${i + 1}</b> ${need(b)}</span>`)}</div>` : ''}
    <div class="agt"><span class="zk">Agent</span><dl><dt>engine</dt><dd>${maybe(l.engine)}</dd><dt>port</dt><dd>:${maybe(l.port)}</dd><dt>cost</dt><dd>${maybe(l.cost)}</dd><dt>time</dt><dd>${maybe(l.time)}</dd></dl></div>
    <div class="ac">${acts([{ label: 'Pick', key: 'P' }, { label: 'Combine', key: 'C' }, { label: 'Discard', key: 'D' }])}</div></div>`;
  KIT.directionlanes = {
    group: 'Review and documents',
    about: 'Design directions as parallel lanes, one per agent: its pinned references, the direction it wrote, the rules it borrowed, an agent stat block and a pick, combine, discard gate under all lanes.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/design-design-variants', file: 'r5-direction-lanes.html', shot: 'check/r5-gate.png' },
    req: { lanes: 'arr' },
    opt: { gate: 'str', action: 'str' },
    r: p => `<div class="a-directionlanes"><div class="ls3">${each(p.lanes, lane)}</div>${p.gate ? `<div class="zgate">${render({ type: 'gate', title: 'gate 1 of 2', text: p.gate, why: 'approve the three directions before variants are built', ...(p.action ? { action: p.action } : {}), actions: [{ label: 'Approve', key: 'Enter', primary: true }, { label: 'Reject', key: 'R' }] })}</div>` : ''}</div>`,
    ex: { type: 'directionlanes', gate: 'Read direction-0.md to direction-2.md. Approve to build all three, reject to stop.', action: 'build 3 variants in 3 worktrees',
      lanes: [
        { id: 'A', name: 'Chalkboard', engine: 'claude', branch: 'lane-a', file: 'direction-0.md', port: '4411', cost: '$0.00', time: '-', state: 'not started', refs: ['Hand-lettered menu', 'Ruled price list', 'Large warm serif'], summary: 'The page is the shop board. Hours sit in a big boxed panel at the top right; the bread list is hand-ruled.', rules: ['Layout: header line, then hours board and button side by side', 'Colour: cream ground, terracotta rules, dark brown text'], borrows: ['hours as a boxed board reads at a glance', 'bread list with hand-ruled lines'] },
        { id: 'B', name: 'Counter photo', engine: 'claude', branch: 'lane-b', file: 'direction-1.md', port: '4412', cost: '$0.00', time: '-', state: 'not started', refs: ['Full-bleed shop photo', 'Text over a panel', 'Large warm serif'], summary: 'The counter photo fills the first screen. A cream panel over it carries the line, hours and button.', rules: ['Layout: full-bleed photo, overlay panel bottom left', 'Type: large serif headline, plain sans for hours'], borrows: ['the brief asks for a big counter photo', 'keeps hours above the fold over the photo'] },
        { id: 'C', name: 'Journal', engine: 'codex', branch: 'lane-c', file: 'direction-2.md', port: '4413', cost: '$0.00', time: '-', state: 'not started', refs: ['Two-column food page', 'Large warm serif', 'Ruled price list'], summary: 'An editorial page: the photo on the left half, the text on the right, like a food journal spread.', rules: ['Layout: two columns above the fold', 'Type: serif body at 18 px, generous leading'], borrows: ['editorial calm, photo left, text right', 'warmth without clip art'] },
      ] },
  };
})();

// dither.js
(() => {
  KIT.dither = {
    group: 'Data',
    about: 'The dither material as a part: a dot-grid meter, an activity spark of dot columns, or a framed dither field that marks a screen as live. A signature on one element, never a page texture.',
    origin: { folder: 'metatrooper-material-2026-10-10 + ouros-fiveshot-2026-10-30/ref-css/wall.css (.bar, .mini, .eq, .edge)', file: 'wall.css', shot: 'now/18-wall-with-approvals.png' },
    req: { kind: 'str' },
    opt: { value: 'num', values: 'arr', label: 'str', aside: 'str', tone: 'str' },
    set: { kind: ['meter', 'spark', 'field'], tone: ['plain', 'live', 'needs'] },
    r: p => {
      const t = ` t-${p.tone || 'plain'}`;
      if (p.kind === 'meter') { const v = Math.max(0, Math.min(100, Number(p.value) || 0)); return `<div class="a-dither km${t}"><span class="l">${maybe(p.label)}</span><span class="tk"><i style="width:${v.toFixed(1)}%"></i></span><span class="v">${p.aside ? esc(p.aside) : v.toFixed(0) + '%'}</span></div>`; }
      if (p.kind === 'spark') { const vs = (p.values || []).slice(-40).map(x => Math.max(0, Math.min(1, Number(x) || 0))); return `<div class="a-dither ks${t}"><span class="l">${maybe(p.label)}</span><span class="cols">${vs.map(x => `<i style="height:${Math.max(2, Math.round(x * 18))}px"></i>`).join('')}</span><span class="v">${maybe(p.aside)}</span></div>`; }
      return `<div class="a-dither kf${t}"><div class="in"><b>${maybe(p.label)}</b><span>${maybe(p.aside)}</span></div></div>`;
    },
    ex: { type: 'dither', kind: 'spark', label: 'tokens / min', aside: '14k', tone: 'live', values: [0.2, 0.4, 0.3, 0.8, 1, 0.6, 0.5, 0.7, 0.9, 0.4, 0.2, 0.3, 0.6, 0.8, 0.5, 0.4, 0.7, 1, 0.9, 0.6] },
  };
})();

// dropmenu.js
(() => {
  KIT.dropmenu = {
    group: 'Input and actions',
    about: 'The app’s dropdown menu: spaced uppercase group heads, plain rows with an optional check or key, a folded group ("▸ Scratch and temp folders (2)") and a footer action under a rule. Used for the project picker, New agent and tile menus.',
    origin: { folder: 'ouros-fiveshot-2026-10-30', file: 'now/10-project-picker.png, now/09-menu-new-agent.png', shot: 'now/10-project-picker.png' },
    req: { groups: 'arr' },
    opt: { footer: 'str' },
    r: p => `<div class="a-dropmenu">${each(p.groups, g => g.folded === true
      ? `<div class="gh fd">▸ ${need(g.label)}${Array.isArray(g.items) ? ` (${g.items.length})` : ''}</div>`
      : `<div class="gh">${need(g.label)}</div>${each(g.items || [], i => `<div class="it${i.on === true ? ' on' : ''}"><span class="nm">${need(i.name)}</span><span class="sb">${maybe(i.sub)}</span>${i.key ? `<kbd>${need(i.key)}</kbd>` : ''}${i.on === true ? '<span class="ck">✓</span>' : ''}</div>`)}`)}${p.footer ? `<div class="ft">${esc(p.footer)}</div>` : ''}</div>`,
    ex: { type: 'dropmenu', footer: 'Open folder…', groups: [
      { label: 'This window', items: [{ name: 'linkkit', on: true, sub: '3 waiting' }] },
      { label: 'Scratch and temp folders', folded: true, items: [{ name: 'tmp-1' }, { name: 'tmp-2' }] },
      { label: 'Agents', items: [{ name: 'claude' }, { name: 'codex' }, { name: 'gemini' }] },
      { label: 'Terminals', items: [{ name: 'PowerShell', key: 'Ctrl `' }, { name: 'Git Bash' }] }] },
  };
})();

// duel.js
(() => {
  const BUCKETS = [['both', 'Both found'], ['left', 'Only '], ['right', 'Only '], ['disagree', 'Disagree']];
  const side = e => `<div class="side"><div class="eh"><span class="en">${need(e.engine)}</span><span class="vd v-${one(e.verdict, ['approve', 'reject', 'notes'], 'notes')}">${need(e.verdict)}</span></div>
    <div class="em">${maybe(e.took)}${e.tokens != null ? ` · ${need(e.tokens)} tok` : ''}</div></div>`;
  const sideOr = e => each([e], side);
  const say = (eng, t, cls) => t ? `<div class="say ${cls}"><span class="who">${need(eng)}</span>${need(t)}</div>` : '';
  const card = (f, p) => `<div class="card s-${one(f.severity, ['critical', 'high', 'medium', 'low'], 'low')}${f.bucket === 'disagree' ? ' dis' : ''}">
    <div class="ch"><span class="sev">${need(f.severity)}</span><span class="tt">${need(f.title)}</span><span class="at">${maybe(f.where)}</span></div>
    <div class="two">${say(p.left.engine, f.left, 'l')}${f.bucket === 'disagree' ? '<i class="dm"></i>' : ''}${say(p.right.engine, f.right, 'r')}</div>
    <div class="a">${acts(f.actions || [{ label: 'Send to agent' }, { label: 'Dismiss' }, { label: 'Copy as comment' }])}</div></div>`;
  KIT.duel = {
    group: 'Review and documents',
    about: 'Two engines judge the same change side by side; their findings sorted into both found, only one, and disagree.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/coding-two-engine-review', file: 'r2-duel.html', shot: 'shots/r2-sorted.png' },
    replaces: 'compare',
    req: { left: 'obj', right: 'obj', findings: 'arr' },
    opt: { title: 'str' },
    r: p => {
      const name = { left: String(p.left.engine ?? "left"), right: String(p.right.engine ?? "right") };
      const groups = BUCKETS.map(([b, label]) => {
        const items = p.findings.filter(f => f && f.bucket === b);
        if (!items.length) return '';
        const head = label + (b === 'left' || b === 'right' ? name[b] : '');
        return `<div class="bk"><div class="bh">${esc(head)} <b>${items.length}</b>${b === 'disagree' ? ' · yours to call' : ''}</div>${each(items, f => card(f, p))}</div>`;
      }).join('');
      const counts = BUCKETS.map(([b, l]) => `<span>${esc(l + (b === 'left' || b === 'right' ? name[b] : ''))} <b>${p.findings.filter(f => f && f.bucket === b).length}</b></span>`).join('');
      return `<div class="a-duel">${sideOr(p.left)}<div class="mid"><div class="mh"><span class="lbl">${maybe(p.title || 'Findings')}</span><span class="cn">${counts}</span></div>${groups}</div>${sideOr(p.right)}</div>`;
    },
    ex: {
      type: 'duel', title: 'Findings',
      left: { engine: 'codex', verdict: 'reject', took: '3m 10s', tokens: '30,120' },
      right: { engine: 'gemini', verdict: 'approve', took: '2m 41s', tokens: '31,300' },
      findings: [
        { bucket: 'both', severity: 'high', title: 'Unvalidated redirect', where: 'src/routes/login.ts:40', left: 'next= is passed to res.redirect without an allow-list.', right: 'The redirect target comes from the query string and is not checked.' },
        { bucket: 'left', severity: 'critical', title: 'Secret in client bundle', where: 'src/config.ts:12', left: 'STRIPE_SECRET is read in a module the browser build imports.' },
        { bucket: 'right', severity: 'low', title: 'Magic number 3', where: 'src/cart/promo.ts:41', right: 'Name the promo size so 4-for-3 does not need a code change.' },
        { bucket: 'disagree', severity: 'medium', title: 'Error state not announced', where: 'src/checkout/Payment.tsx:18', left: 'Needs aria-live so screen readers hear the error.', right: 'The existing toast already announces it.' },
      ],
    },
  };
})();

// featuretree.js
(() => {
  const KINDS = { sketch: 'SK', extrude: 'EX', cut: 'CT', revolve: 'RV', fillet: 'FL', chamfer: 'CH', hole: 'HL', pattern: 'PT', mirror: 'MR', plane: 'PL', shell: 'SH' };
  const STATES = ['ok', 'under', 'error', 'off'];
  const row = (f, depth, at, rb) => {
    const kind = one(f.kind, Object.keys(KINDS), 'sketch'), st = one(f.state, STATES, 'ok');
    const past = rb >= 0 && at.i > rb;
    const line = `<div class="ftr ftd${Math.min(3, depth)} fts-${st}${f.sel === true ? ' ftsel' : ''}${past ? ' ftpast' : ''}"><span class="ftk">${KINDS[kind]}</span><span class="ftn">${need(f.name)}</span>${f.note && st === 'ok' ? `<span class="ftnt">${need(f.note)}</span>` : ''}${st !== 'ok' ? `<span class="ftst">${esc({ under: 'open', error: 'fails', off: 'off' }[st])}</span>` : ''}</div>`;
    at.i++;
    const kids = depth < 3 && Array.isArray(f.children) ? each(f.children, c => row(c, depth + 1, at, rb)) : '';
    const bar = rb >= 0 && at.i - 1 === rb && depth === 0 ? '<div class="ftrb"><span>ROLLBACK</span></div>' : '';
    return line + kids + bar;
  };
  KIT.featuretree = {
    group: 'Workspaces',
    about: 'The feature history of a part: sketches under the features they drive, each step\'s state, and a rollback bar you can drag.',
    origin: { folder: 'new for H4 (persona: mechanical engineer)', file: 'no MetaTrooper source; drawn for the part-design workspace' },
    replaces: 'tree',
    req: { part: 'str', features: 'arr' },
    opt: { rollback: 'num', planes: 'arr' },
    r: p => {
      const rb = Number.isFinite(p.rollback) ? Math.max(-1, Math.min(500, Math.floor(p.rollback))) : -1;
      const at = { i: 0 };
      const body = each(p.features, f => row(f, 0, at, rb));
      const counts = { error: 0, under: 0 };
      const walk = (l, d) => d < 4 && (Array.isArray(l) ? l : []).forEach(f => { if (f && counts[f.state] !== undefined) counts[f.state]++; if (f) walk(f.children, d + 1); });
      walk(p.features, 0);
      const planes = each(p.planes || ['Front plane', 'Top plane', 'Right plane', 'Origin'], n => `<div class="ftr ftd0 ftpl"><span class="ftk">PL</span><span class="ftn">${need(n)}</span></div>`);
      return `<div class="a-featuretree"><div class="fth"><span class="ftlb">History</span><span class="ftpn">${need(p.part)}</span></div>
<div class="ftsum"><span>${at.i} features</span>${counts.under ? `<span class="ftu">${counts.under} under-defined</span>` : ''}${counts.error ? `<span class="fte">${counts.error} failing</span>` : ''}</div>
<div class="ftls">${planes}<div class="ftsep"></div>${body}</div></div>`;
    },
    ex: {
      type: 'featuretree', part: 'MB-204 motor bracket', rollback: 9,
      features: [
        { name: 'Base plate', kind: 'extrude', note: '10 mm', children: [{ name: 'Sketch 1', kind: 'sketch', note: '120 × 80' }] },
        { name: 'Upright', kind: 'extrude', note: '70 mm', children: [{ name: 'Sketch 2', kind: 'sketch' }] },
        { name: 'Motor bore', kind: 'cut', note: 'Ø28 through', children: [{ name: 'Sketch 3', kind: 'sketch', state: 'under', note: '1 free' }], sel: true },
        { name: 'Gusset', kind: 'extrude', note: '8 mm', children: [{ name: 'Sketch 4', kind: 'sketch' }] },
        { name: 'Gusset mirror', kind: 'mirror', note: 'about Right plane' },
        { name: 'Mount holes', kind: 'hole', note: '4 × M5' },
        { name: 'Edge fillets', kind: 'fillet', note: 'R2 · 6 edges', state: 'error' },
        { name: 'Weight pockets', kind: 'cut', state: 'off' },
      ],
    },
  };
})();

// flashcard.js
(() => {
  const GRADES = [['Again', '1m'], ['Hard', '6m'], ['Good', '1d'], ['Easy', '4d']];
  KIT.flashcard = {
    group: 'Workspaces',
    about: 'A flashcard review: the card with question and answer, where it came from, what is left today, and four grade buttons that each say when the card comes back.',
    origin: { folder: 'new for H4 (persona: student)', file: 'no MetaTrooper source; drawn for the study workspace' },
    req: { deck: 'str', front: 'str' },
    opt: { back: 'str', source: 'str', left: 'arr', grades: 'arr', tag: 'str', revealed: 'bool', card: 'str' },
    r: p => {
      const g = Array.isArray(p.grades) && p.grades.length ? p.grades : GRADES;
      const shown = !!p.back && p.revealed !== false;
      const left = each(p.left || [], l => `<span><b>${need(l[1])}</b>${need(l[0])}</span>`);
      const foot = shown
        ? `<div class="fcgr">${each(g, (x, i) => `<span class="fcb${i === 2 ? ' fcon' : ''}"><b>${need(x[0])}</b><i>${need(x[1])}</i><em>${i + 1}</em></span>`)}</div>`
        : '<div class="fcrv"><span class="fcrb">Show answer</span><em>Space</em></div>';
      return `<div class="a-flashcard"><div class="fchd"><span class="fclb">Deck</span><span class="fcdk">${need(p.deck)}</span>${p.card ? `<span class="fcno">${need(p.card)}</span>` : ''}<span class="fclf">${left}</span></div>
<div class="fcstage"><div class="fccard">${p.tag ? `<span class="fctag">${need(p.tag)}</span>` : ''}<div class="fcq">${need(p.front)}</div>${shown ? `<div class="fcrule"></div><div class="fca">${need(p.back)}</div>` : '<div class="fcrule fchid"></div><div class="fcshow">Think of the answer, then show it.</div>'}${p.source ? `<div class="fcsrc">${need(p.source)}</div>` : ''}</div></div>
${foot}</div>`;
    },
    ex: {
      type: 'flashcard', deck: 'Biology · Genetics', tag: 'weak topic',
      front: 'A heterozygous tall plant (Tt) is crossed with a short plant (tt). What fraction of the offspring are short?',
      back: 'One half. Half get t from the Tt parent, and every offspring gets t from the tt parent, so tt = 1/2.',
      source: 'from your notes · Genetics lecture 4, slide 12',
      left: [['new', '6'], ['learning', '3'], ['due', '25']],
    },
  };
})();

// flowgrid.js
(() => {
  const ST = ['ok', 'fail', 'run'];
  const page = pg => pg ? `<div class="pg"><b class="h">${maybe(pg.h)}</b><span class="in">${maybe(pg.field)}</span><span class="bt">${maybe(pg.button || 'Add')}</span>${each(pg.items || [], x => `<span class="li">${need(x)}</span>`)}<span class="ct">${maybe(pg.count)}</span></div>` : '';
  const gl = s => `<i class="gl g-${one(s, ST, 'ok')}"></i>`;
  const stamp = (t, s) => t ? `<span class="sk sk-${one(s, ['ok', 'fail', 'dim'], 'dim')}">${need(t)}</span>` : '';
  const cell = f => f ? `<div class="tc${f.state === 'fail' ? ' bad' : ''}"><div class="bw"><div class="bb"><i></i><i></i><i></i></div><div class="vp">${page(f.page)}${f.state === 'fail' ? '<span class="xm">x</span>' : ''}</div></div><div class="lb">${gl(f.state)}<span class="vb">${need(f.verb)}</span><span class="tm">${maybe(f.t)}</span></div></div>` : '';
  KIT.flowgrid = {
    group: 'Agent and run',
    about: 'Flow grid: a counts bar, then one row per user flow with its expectation and result stamps on the left, a strip of drawn page thumbnails per step in the middle, and a verdict note on the right.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/coding-e2e-browser-qa', file: 'r3-flow-grid.html', shot: 'flow grid (counts and rows)' },
    req: { flows: 'arr' },
    opt: { counts: 'arr', heads: 'arr' },
    r: p => `<div class="a-flowgrid">${p.counts ? `<div class="cn">${each(p.counts, c => `<div class="cv${c.hot === true ? ' hot' : ''}"><span class="k">${need(c.label)}</span><b>${need(c.value)}</b></div>`)}</div>` : ''}
      <div class="gh">${each((p.heads || ['Flow, from flows.md', 'Steps in the browser, first walk', 'After the fix']).slice(0, 3), h => `<span class="k">${need(h)}</span>`)}</div>
      ${each(p.flows, f => `<div class="fr"><div class="lc"><div class="nm"><span class="no">${need(f.no)}</span><span>${need(f.title)}</span></div><div class="xp">${maybe(f.expect)}</div><div class="rs">${each(f.results || [], (r, i) => `${i ? '<span class="th">then</span>' : ''}${stamp(r.text, r.state)}`)}</div></div>
        <div class="ts">${each(f.frames, cell)}</div>
        <div class="rc"><span class="k">${maybe(f.verdict)}</span><span class="tx">${maybe(f.note)}</span>${f.stamp ? stamp(f.stamp, f.stampState) : ''}</div></div>`)}</div>`,
    ex: {
      type: 'flowgrid',
      counts: [{ label: 'Flows', value: '3' }, { label: 'Pass', value: '3' }, { label: 'Fail', value: '0' }, { label: 'Findings', value: '2' }, { label: 'Fixed', value: '1' }, { label: 'Open', value: '1', hot: true }],
      flows: [
        { no: '1', title: 'Add an item', expect: 'expect "milk" is in the list and the count reads "1 item"',
          results: [{ text: 'fail', state: 'fail' }, { text: 'pass', state: 'ok' }],
          frames: [
            { verb: 'goto /', t: '00:02', state: 'ok', page: { h: 'Shopping list', count: '0 items' } },
            { verb: 'click Item', t: '00:04', state: 'ok', page: { h: 'Shopping list', count: '0 items' } },
            { verb: 'type "milk"', t: '00:06', state: 'ok', page: { h: 'Shopping list', field: 'milk', count: '0 items' } },
            { verb: 'click Add', t: '00:08', state: 'fail', page: { h: 'Shopping list', field: 'milk', count: '0 items' } },
          ],
          verdict: 'After the fix', note: '"milk" is listed, 1 item', stamp: 'pass', stampState: 'ok' },
        { no: '2', title: 'A blank item is ignored', expect: 'expect the list stays empty and the count reads "0 items"',
          results: [{ text: 'pass', state: 'ok' }],
          frames: [
            { verb: 'type " "', t: '00:31', state: 'ok', page: { h: 'Shopping list', count: '0 items' } },
            { verb: 'click Add', t: '00:33', state: 'fail', page: { h: 'Shopping list', count: '0 items' } },
          ],
          verdict: 'First walk passed', note: 'list unchanged, but the console shows the same TypeError' },
        { no: '3', title: 'The count follows the list', expect: 'expect the count reads "2 items"',
          results: [{ text: 'fail', state: 'fail' }, { text: 'pass', state: 'ok' }],
          frames: [
            { verb: 'type "eggs"', t: '00:52', state: 'ok', page: { h: 'Shopping list', field: 'eggs', count: '0 items' } },
            { verb: 'click Add', t: '00:54', state: 'fail', page: { h: 'Shopping list', field: 'eggs', count: '0 items' } },
            { verb: 'type "bread"', t: '00:58', state: 'ok', page: { h: 'Shopping list', field: 'bread', count: '0 items' } },
          ],
          verdict: 'Re-walk', note: 'count reads "2 items"', stamp: 'pass', stampState: 'ok' },
      ],
    },
  };
})();

// foldbar.js
(() => {
  KIT.foldbar = {
    group: 'Agent and run',
    about: 'Folded wall tiles: each agent shrinks to one dotted bar (dot, task, where it is), with a "more folded" row under them.',
    origin: { folder: 'ouros-fiveshot-2026-10-30', file: 'ref-css/wall.css (.pane.fold, .fold-more)', shot: 'now/13-tile-folded.png' },
    req: { items: 'arr' },
    opt: { more: 'str' },
    r: p => `<div class="a-foldbar">${each(p.items, t => `<div class="fb s-${one(t.state, ['working', 'needs', 'done', 'idle'], 'idle')}${t.state === 'needs' && SOURCE === 'system' ? ' attn' : ''}"><span class="dt"></span><span class="task">${need(t.task)}</span><span class="fl">${maybe(t.where)}</span><span class="bdg">${t.state === 'needs' ? (SOURCE === 'system' ? 'needs you' : 'asks you') : maybe(t.state)}</span></div>`)}${p.more ? `<div class="more">${esc(p.more)}</div>` : ''}</div>`,
    ex: { type: 'foldbar', more: '+ 2 more folded', items: [
      { task: 'Retry on 429 with backoff', where: 'claude · main · question', state: 'needs' },
      { task: 'Fix the midnight date test', where: 'codex · ouros/date-test · npm test 12 passed', state: 'working' },
      { task: 'README quick start', where: 'gemini · docs · 4m ago', state: 'done' }] },
  };
})();

// footstrip.js
(() => {
  KIT.footstrip = {
    group: 'Layout',
    about: 'The strip under the wall: needs-you count on the left (Inbox when nothing waits), pane switches on the right with an underline on the open one.',
    origin: { folder: 'ouros-fiveshot-2026-10-30', file: 'now/18-wall-with-approvals.png (bottom strip)', shot: 'now/18-wall-with-approvals.png' },
    req: { tabs: 'arr' },
    opt: { needs: 'num', active: 'num' },
    r: p => { const n = Number.isFinite(p.needs) ? Math.max(0, Math.round(p.needs)) : 0;
      return `<div class="a-footstrip"><span class="nd${n ? '' : ' zero'}">${n ? `<i></i>${n} need you` : 'Inbox'}</span><span class="sp"></span>${each(p.tabs, (t, i) => `<span class="tab1${i === p.active ? ' on' : ''}">${need(typeof t === 'object' && t ? t.label : t)}${t && t.count != null ? ` ${need(t.count)}` : ''}</span>`)}</div>`; },
    ex: { type: 'footstrip', needs: 3, active: 1, tabs: [{ label: 'Diff', count: 2 }, 'Git', 'Hand back', 'Browser'] },
  };
})();

// gitpanel.js
(() => {
  KIT.gitpanel = {
    group: 'Review and documents',
    about: 'The Git tab: branch box with push and pull, changes with a status letter and Stage per file, staged list, commit box, then history with times.',
    origin: { folder: 'ouros-fiveshot-2026-10-30', file: 'now/06-tab-git.png (Git tab)', shot: 'now/06-tab-git.png' },
    req: { branch: 'str', changes: 'arr' },
    opt: { status: 'str', staged: 'arr', history: 'arr', message: 'str' },
    r: p => `<div class="a-gitpanel"><div class="bx"><div class="bh"><b>${esc(p.branch)}</b><span>${maybe(p.status)}</span></div><div class="ba"><span class="bt2">Push</span><span class="bt2">Pull</span></div></div>
      <div class="sect"><b>Changes (${p.changes.length})</b>${p.changes.length ? '<span class="bt2 on">Stage all</span>' : ''}</div>
      ${each(p.changes, c => `<div class="fr"><span class="stl s-${one(c.st, ['M', 'U', 'A', 'D'], 'M')}">${one(c.st, ['M', 'U', 'A', 'D'], 'M')}</span><span class="fpath">${need(c.path)}</span><span class="nm">${c.add ? `+${need(String(c.add).replace(/^\+/, ''))}` : ''}${c.del ? ` -${need(String(c.del).replace(/^-/, ''))}` : ''}</span><span class="bt2 on">Stage</span></div>`)}
      <div class="sect"><b>Staged (${(p.staged || []).length})</b></div>${p.staged && p.staged.length ? each(p.staged, s => `<div class="fr"><span class="fpath">${need(s)}</span></div>`) : '<div class="em">Stage a file above to commit it.</div>'}
      <div class="cm">${p.message ? esc(p.message) : `<i>Commit message (commits to ${esc(p.branch)})</i>`}</div><span class="cbtn">Commit</span>
      ${p.history ? `<div class="sect"><b>History</b></div>${each(p.history, h => `<div class="hr"><span>${need(h.msg)}</span><span>${maybe(h.at)}</span></div>`)}` : ''}</div>`,
    ex: { type: 'gitpanel', branch: 'main', status: 'up to date with origin',
      changes: [{ st: 'M', path: 'src/api/client.ts', add: 14, del: 1 }, { st: 'U', path: 'notes.md' }],
      history: [{ msg: 'Tests for the retry loop', at: '13 seconds ago' }, { msg: 'Bump node to 22', at: '14 seconds ago' }, { msg: 'Rate limit config', at: '2 minutes ago' }] },
  };
})();

// handbacksheet.js
(() => {
  const pct = (v, max) => Math.max(0, Math.min(100, Math.round(Number(v) / max * 100) || 0));
  const strip = (steps, n) => `<div class="stripz">${each(steps, s => `<div class="st2 st-${one(s.state, ['done', 'cur', 'todo'], 'done')}"><i></i><span>${need(s.label)}</span></div>`)}<div class="sum"><b>${n} items for you</b></div></div>`;
  const item = (it, i) => `<div class="itz${it.done === true ? ' gone' : ' hotz'}"><div class="noz">${i + 1}</div>
    <div class="bd"><b>${need(it.title)}</b><span class="why2">${maybe(it.note)}</span>${it.cmd ? `<code class="cmd">${need(it.cmd)}</code>` : ''}
    ${it.choices ? `<div class="ch2">${acts(it.choices.map(c => ({ label: c })))}</div>` : ''}</div>
    <div class="ha">${acts([{ label: 'Copy', key: 'C' }, { label: 'Done', key: 'D' }])}</div></div>`;
  const stat = (f, max) => `<div class="sf"><span class="pa">${need(f.path)}</span><span class="adz">+${need(f.add)}</span><span class="dl2">-${need(f.del)}</span><span class="brz"><i style="width:${pct(Number(f.add) + Number(f.del), max)}%"></i></span></div>`;
  KIT.handbacksheet = {
    group: 'Review and documents',
    about: 'The end of an agent run as a numbered list of things only you can do, each with its exact command, Copy and Done; staged files, drafted message and a line on what ran by itself on the side. No commit button.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/coding-spec-build-review-handback', file: 'r1-handback.html', shot: 'r1-handback.png' },
    replaces: 'handback',
    req: { items: 'arr' },
    opt: { title: 'str', steps: 'arr', staged: 'arr', untracked: 'arr', message: 'str', ran: 'str' },
    r: p => {
      const open = p.items.filter(i => i && i.done !== true).length;
      const staged = (Array.isArray(p.staged) ? p.staged : []).filter(f => f && typeof f === 'object');
      const max = Math.max(1, ...staged.map(f => Number(f.add) + Number(f.del) || 0));
      const rail = (staged.length || Array.isArray(p.untracked) || p.message) ? `<div class="railz">
        ${staged.length ? `<div class="rhz">Staged <span>${staged.length} files, restaged</span></div>${each(staged, f => stat(f, max))}` : ''}
        ${Array.isArray(p.untracked) ? `<div class="rhz">Untracked</div>${each(p.untracked, u => `<div class="un">? ${need(u)}</div>`)}<div class="nv">never staged by the agent</div>` : ''}
        ${p.message != null ? `<div class="msgz"><div class="rhz">Drafted message</div>${need(p.message)}</div>` : ''}</div>` : '';
      return `<div class="a-handbacksheet">${Array.isArray(p.steps) ? strip(p.steps, open) : ''}
        <div class="hbody"><div class="list"><div class="lh"><span class="lbl">${maybe(p.title || 'For you')} <b>${open}</b> of ${p.items.length} left</span><span class="cp">Copy only · <s>Commit</s> not a button here</span></div>
        ${each(p.items, item)}
        ${p.ran != null ? `<div class="ran"><span>Ran by itself</span> ${need(p.ran)}</div>` : ''}</div>${rail}</div></div>`;
    },
    ex: {
      type: 'handbacksheet', title: 'For you',
      steps: ['spec', 'approve', 'build', 'verify', 'review x2', 'bucket', 'pick', 'fix', 'hand back'].map(label => ({ label, state: 'done' })),
      items: [
        { title: 'Commit the staged change', note: 'The agent never commits.', cmd: "git -C .worktrees/run-5b1d commit -m 'Add --dry-run to tidy clean'" },
        { title: 'Push the branch and open the pull request', note: 'Pushing and opening a PR are external.', cmd: 'git push -u origin mt/loop-run-5b1d && gh pr create --base main --fill' },
        { title: 'Decide C1: no test for --dry-run with --force', note: 'You left it unticked at pick-fixes.', choices: ['Send to agent', 'Note in the PR', 'Drop it'] },
        { title: 'Keep or delete scratch/sample-tree.txt', note: 'Untracked; the agent never stages it.', cmd: 'rm scratch/sample-tree.txt' },
      ],
      staged: [{ path: 'src/commands/clean.js', add: '14', del: '3' }, { path: 'src/cli.js', add: '3', del: '0' }, { path: 'test/clean-dry-run.test.js', add: '31', del: '0' }],
      untracked: ['scratch/sample-tree.txt'],
      message: 'Add --dry-run to tidy clean',
      ran: 'Wrote the spec, built it test first, two engines reviewed, fixed 2 of 3 findings, tests pass (7). Nothing committed or pushed.',
    },
  };
})();

// handbacktab.js
(() => {
  KIT.handbacktab = {
    group: 'Review and documents',
    about: 'The Hand-back tab: what is staged and the exact commit command for you to run (Ouros never commits), then untracked files it will never stage.',
    origin: { folder: 'ouros-fiveshot-2026-10-30', file: 'now/07-tab-handback.png (Hand-back tab)', shot: 'now/07-tab-handback.png' },
    replaces: 'handback',
    req: { staged: 'arr' },
    opt: { untracked: 'arr', command: 'str', note: 'str' },
    r: p => `<div class="a-handbacktab"><div class="hd"><b>Staged changes</b><span class="bt2">Refresh</span></div>
      ${p.staged.length ? `<ul class="ls">${each(p.staged, s => `<li>${need(s)}</li>`)}</ul>${p.command ? `<div class="cmd"><code>${esc(p.command)}</code><span class="bt2">Copy</span></div>` : ''}` : ''}
      <p class="nt">${p.note ? esc(p.note) : p.staged.length ? 'Run it yourself. Ouros never commits.' : 'Nothing staged. Stage files in the <b>Git tab</b> or with git add. Ouros never commits; it gives you the command to run yourself.'}</p>
      ${p.untracked && p.untracked.length ? `<b class="ut">Untracked (never staged here)</b><ul class="ls">${each(p.untracked, u => `<li>${need(u)}</li>`)}</ul>` : ''}</div>`,
    ex: { type: 'handbacktab', staged: ['src/api/client.ts', 'test/retry.test.ts'], command: 'git commit -m "Retry on 429 with backoff"', untracked: ['notes.md'] },
  };
})();

// inboxdrop.js
(() => {
  KIT.inboxdrop = {
    group: 'Agent and run',
    about: 'The inbox dropdown under the needs-you counter: a pixel heading and one row per waiting agent (dot, who and what, the line it stopped on).',
    origin: { folder: 'ouros-fiveshot-2026-10-30', file: 'now/12-inbox.png (inbox popover)', shot: 'now/12-inbox.png' },
    req: { items: 'arr' },
    opt: { title: 'str', empty: 'str' },
    r: p => `<div class="a-inboxdrop"><div class="hd">${esc(p.title || 'Inbox')}</div>${p.items.length ? each(p.items, i => `<div class="rw${i.unread === false ? ' seen' : ''}"><i></i><b>${need(i.text)}</b><span>${maybe(i.detail)}</span></div>`) : `<div class="em">${esc(p.empty || 'Nothing is waiting on you.')}</div>`}</div>`,
    ex: { type: 'inboxdrop', items: [
      { text: 'claude in linkkit is asking you', detail: 'Which backoff cap, 30s or 60s?' },
      { text: 'codex in linkkit wants to run a command', detail: 'npm publish --dry-run' },
      { text: 'gemini finished in docs', detail: 'README.md +61', unread: false }] },
  };
})();

// inkstamp.js
(() => {
  KIT.inkstamp = {
    group: 'Agent and run',
    about: 'The rotated pixel stamp printed twice, offset, like rubber-stamp ink: NEEDS YOU, DONE, SHIPPED, REJECTED. Needs-you ink is orange only on Ouros surfaces.',
    origin: { folder: 'ouros-fiveshot-2026-10-30', file: 'ref-css/wall.css (.stamp .ink.y/.ink.p)', shot: 'now/18-wall-with-approvals.png' },
    req: { text: 'str' },
    opt: { tone: 'str', note: 'str' },
    set: { tone: ['needs', 'done', 'fail', 'plain'] },
    r: p => `<div class="a-inkstamp t-${p.tone || 'plain'}"><span class="sp1"><span class="ink y">${esc(p.text)}</span><span class="ink p">${esc(p.text)}</span></span>${p.note ? `<span class="nt">${esc(p.note)}</span>` : ''}</div>`,
    ex: { type: 'inkstamp', text: 'needs you', tone: 'needs', note: 'claude is waiting on one answer' },
  };
})();

// leadtable.js
(() => {
  const pct = (a, b) => { const x = Number(a), y = Number(b); return y > 0 && x >= 0 ? Math.min(100, Math.round(x / y * 100)) : 0; };
  const cell = c => `<div class="zle-cl zle-cl-${one(c.state, ['ok', 'flag', 'none'], 'ok')}"><i class="zle-dt"></i><span>${need(c.text)}</span></div>`;
  const row = r => `<div class="zle-rw zle-rw-${one(r.state, ['ok', 'flag', 'off'], 'ok')}"><div class="zle-pr"><span class="zle-id">${need(r.id)}</span><span class="zle-nm"><b>${need(r.name)}</b><em>${maybe(r.sub)}</em></span></div>
    ${each(r.cells || [], cell)}<div class="zle-stc"><span class="zle-st zle-st-${one(r.state, ['ok', 'flag', 'off'], 'ok')}">${need(r.status)}</span></div></div>`;
  const head = c => `<div class="zle-ch"><div class="zle-ct"><span class="zle-tk">&#10003;</span><b>${need(c.label)}</b><span class="zle-n">${maybe(c.note)}</span></div><div class="zle-br"><i style="width:${pct(c.done, c.total)}%"></i></div></div>`;
  KIT.leadtable = {
    group: 'Data',
    about: 'Prospect table: one row per business, one cell per step with the evidence found, a dither bar on each column, and a stamp for what is left for you.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/leadgen-prospect-list-to-drafts', file: 'r1-lead-table.html', shot: 'origin/leadtable.png' },
    replaces: 'table',
    req: { columns: 'arr', rows: 'arr' },
    opt: { title: 'str', summary: 'str' },
    r: p => `<div class="a-leadtable"><div class="zle-th"><span class="zle-lbl">${maybe(p.title || 'Lead table')}</span><span class="zle-sm">${maybe(p.summary)}</span></div>
      <div class="zle-gr"><div class="zle-hd"><div class="zle-ch zle-pc"><span class="zle-n">Prospect</span></div>${each(p.columns, head)}<div class="zle-ch"><span class="zle-n">Status</span></div></div>
      ${each(p.rows, row)}</div></div>`,
    ex: {
      type: 'leadtable', title: 'Lead table', summary: '6 rows, 4 drafts, 1 left for you',
      columns: [{ label: 'Load', done: 6, total: 6, note: '6/6' }, { label: 'Source', done: 6, total: 6, note: '6/6' }, { label: 'Hook', done: 5, total: 5, note: '5/5' }, { label: 'Check', done: 4, total: 5, note: '4/5' }],
      rows: [
        { id: 'P01', name: 'Kettle and Spoke Cafe', sub: 'cafe · contact form', cells: [{ text: 'kept' }, { text: '3 pages' }, { text: 'table bookings are by phone only' }, { text: '5/5 pass' }], status: 'checked' },
        { id: 'P02', name: 'Rook Lane Bikes', sub: 'bike shop · contact form', cells: [{ text: 'kept' }, { text: '3 pages' }, { text: 'service bookings need a call' }, { text: '5/5 pass' }], status: 'checked' },
        { id: 'P03', name: 'Rook Lane Bikes', sub: 'bike shop · contact form', state: 'off', cells: [{ text: 'dup of P02', state: 'none' }], status: 'dup of P02' },
        { id: 'P04', name: 'Fennick Florist', sub: 'florist · contact form', state: 'flag', cells: [{ text: 'kept' }, { text: '3 pages' }, { text: 'orders by appointment since 1998' }, { text: 'not on page', state: 'flag' }], status: 'left for you' },
        { id: 'P05', name: 'Saltmarsh Yoga', sub: 'yoga studio · contact form', cells: [{ text: 'kept' }, { text: '1 page' }, { text: 'no fact', state: 'none' }], status: 'no fact' },
        { id: 'P06', name: 'Quill and Ivy Florist', sub: 'florist · contact form', cells: [{ text: 'kept' }, { text: '3 pages' }, { text: 'weddings book Thursdays only' }, { text: '5/5 pass' }], status: 'checked' },
      ],
    },
  };
})();

// manuscript.js
(() => {
  const n = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
  KIT.manuscript = {
    group: 'Workspaces',
    about: 'A manuscript page for a writer: the chapter set as a page, edits marked in the text, notes in the margin beside the paragraph they belong to, and the word count against the target.',
    origin: { folder: 'new for H4 (persona: writer)', file: 'no MetaTrooper source; drawn for the writing workspace' },
    replaces: 'doc',
    req: { title: 'str', paras: 'arr' },
    opt: { book: 'str', draft: 'str', words: 'num', target: 'num' },
    r: p => {
      const words = n(p.words, 0, 10000000), target = n(p.target, 0, 10000000);
      const body = each(p.paras, (q, i) => `<div class="msrow"><p class="${q.changed === true ? 'msch' : ''}${q.cut === true ? ' mscut' : ''}">${i === 0 ? `<span class="msdrop">${esc(String(q.text || '').slice(0, 1))}</span>${esc(String(q.text || '').slice(1))}` : need(q.text)}</p><div class="msnote">${q.note ? `<div class="msn"><span class="msby">${maybe(q.by || 'note')}</span>${need(q.note)}<span class="msact"><button class="msi">Ignore</button><button class="msa">Accept</button></span></div>` : ''}</div></div>`);
      const meter = target ? `<div class="msmt"><span>${esc(words.toLocaleString('en-AU'))} of ${esc(target.toLocaleString('en-AU'))} words</span><span class="msbar"><i style="width:${Math.min(100, words / target * 100).toFixed(1)}%"></i></span></div>` : '';
      return `<div class="a-manuscript"><div class="mshd"><span class="mslb">${maybe(p.book)}</span>${p.draft ? `<span class="msstp">${need(p.draft)}</span>` : ''}</div><div class="mspage"><h3>${need(p.title)}</h3>${body}</div>${meter}</div>`;
    },
    ex: {
      type: 'manuscript', book: 'The Salt Road · a novel', draft: 'Draft 2', words: 61240, target: 80000, title: 'Chapter 7 · Low Tide',
      paras: [
        { text: 'The ferry left without her. Ines watched it shrink against the grey until it was only a smudge, and then not even that, and she understood that the island had decided to keep her one more night.' },
        { text: 'She walked back up the slipway past the shuttered café, the net sheds, the chapel with its door tied shut with blue rope.', changed: true, note: 'Tightened: cut "slowly" and "old". Reads faster into the next beat.', by: 'claude' },
        { text: 'Tomas was waiting at the top, as if he had known. Maybe he had. On the island everyone knew the tides better than the clocks.', note: 'Tomas appears in ch. 3 with a limp. Keep it here?', by: 'claude' },
        { text: 'It was not raining, exactly. The air was just wet, and it was everywhere.', cut: true, note: 'Same image as ch. 2, page 3. Suggest cutting.', by: 'claude' },
      ],
    },
  };
})();

// pageview.js
(() => {
  const line = l => l.kind === 'h'
    ? `<div class="zpa-vhh"><b>${need(l.text)}</b></div>`
    : `<div class="zpa-vln${l.hot ? ' zpa-hot' : ''}">${l.mark ? `<i class="zpa-vmk">${need(l.mark)}</i>` : ''}<span class="zpa-vtx">${need(l.text)}</span>${l.cite ? `<span class="zpa-vct">${need(l.cite)}</span>` : ''}</div>`;
  const page = (pg, i, n) => `<div class="zpa-vpg"><div class="zpa-vph"><span>${maybe(pg.file)}</span><span>${maybe(pg.tag)}</span></div>
    ${pg.title ? `<div class="zpa-vpt">${need(pg.title)}</div>` : ''}${pg.sub ? `<div class="zpa-vps">${need(pg.sub)}</div>` : ''}
    ${each(pg.lines, line)}<div class="zpa-vpf">${i + 1} / ${n}</div></div>`;
  KIT.pageview = {
    group: 'Review and documents',
    about: 'A printed spread: two pages of notes where every line carries a chip naming the slide it came from, and the line under review is marked and lit.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/study-study-notes-to-pdf', file: 'r1-page-view.html', shot: 'origin/pageview.png' },
    req: { pages: 'arr' },
    opt: { title: 'str', round: 'str' },
    r: p => `<div class="a-pageview"><div class="zpa-sh"><span class="zpa-lbl">${maybe(p.title || 'Spread')}</span><span class="zpa-rd">${maybe(p.round)}</span></div>
      <div class="zpa-sp">${each(p.pages, (pg, i) => page(pg, i, p.pages.length))}</div></div>`,
    ex: {
      type: 'pageview', title: 'Spread', round: 'Round 2',
      pages: [
        { file: 'WEEK06-CACHE-NOTES.PDF', tag: 'A4 · ROUND 2', title: 'How caches work: study notes', sub: 'Invented course, lecture 6',
          lines: [
            { kind: 'h', text: '1  Why caches exist' },
            { text: 'The CPU is far faster than main memory; one DRAM load takes about 100 cycles.', cite: 'p.3' },
            { text: 'Memory is a hierarchy: registers, L1, L2, L3, DRAM, disk.', cite: 'p.4' },
            { text: 'Spatial locality: data next to it is used soon.', cite: 'p.5' },
            { kind: 'h', text: '2  Lines, hits and misses' },
            { text: 'A hit means the data is already in the cache; a miss means fetching it from below.', cite: 'p.7' },
          ] },
        { file: 'WEEK06-CACHE-NOTES.PDF', tag: 'A4 · ROUND 2',
          lines: [
            { text: 'Miss penalty is the extra time a miss costs.', cite: 'p.7' },
            { text: 'AMAT = hit time + miss rate x miss penalty.', cite: 'p.8' },
            { text: 'Caches use SRAM: fast, but it costs more per bit.', cite: 'p.9', mark: 'RW', hot: true },
            { text: 'Main memory uses DRAM: slower, cheaper per bit and denser.', cite: 'p.9' },
            { kind: 'h', text: '3  Where a block can go' },
            { text: 'Direct-mapped: each block has exactly one possible place.', cite: 'p.10' },
          ] },
      ],
    },
  };
})();

// panetabs.js
(() => {
  KIT.panetabs = {
    group: 'Layout',
    about: 'The side pane’s tab row: boxed active tab, count chips, a close mark, and whatever the open tab holds underneath.',
    origin: { folder: 'ouros-fiveshot-2026-10-30', file: 'now/06-tab-git.png (pane tab row)', shot: 'now/06-tab-git.png' },
    replaces: 'tabs',
    req: { tabs: 'arr' },
    opt: { active: 'num', children: 'arr' },
    r: p => `<div class="a-panetabs"><div class="row1">${each(p.tabs, (t, i) => `<span class="tab1${i === (p.active ?? 0) ? ' on' : ''}">${need(t.label)}${t.count != null ? `<b>${need(t.count)}</b>` : ''}</span>`)}<span class="x">×</span></div>${p.children ? `<div class="bd">${kids(p.children)}</div>` : ''}</div>`,
    ex: { type: 'panetabs', active: 1, tabs: [{ label: 'Diff', count: 2 }, { label: 'Git' }, { label: 'Hand-back' }, { label: 'Browser' }],
      children: [{ type: 'note', text: 'The open tab draws here.' }] },
  };
})();

// partprops.js
(() => {
  const CS = ['ok', 'under', 'over'];
  KIT.partprops = {
    group: 'Workspaces',
    about: 'Properties of the selected part or face: material, mass, measures, and the sketch constraints with how many degrees of freedom are left.',
    origin: { folder: 'new for H4 (persona: mechanical engineer)', file: 'no MetaTrooper source; drawn for the part-design workspace' },
    replaces: 'kv',
    req: { title: 'str', sections: 'arr' },
    opt: { constraints: 'arr', free: 'num', stamp: 'str' },
    r: p => {
      const free = Number.isFinite(p.free) ? Math.max(0, Math.min(99, Math.floor(p.free))) : null;
      const secs = each(p.sections, s => `<div class="ppsc"><div class="pplb">${need(s.label)}</div>${each(s.rows, r => `<div class="ppkv"><span class="ppk">${need(r[0])}</span><span class="ppv">${need(r[1])}</span></div>`)}</div>`);
      const cons = p.constraints ? `<div class="ppsc"><div class="pplb">Constraints${free !== null ? ` <b>${free ? free + ' free' : 'none free'}</b>` : ''}</div><div class="ppcs">${each(p.constraints, c => `<span class="ppc ppc-${one(c.state, CS, 'ok')}">${need(c.name)}${c.count ? ` <i>${need(c.count)}</i>` : ''}</span>`)}</div></div>` : '';
      const stamp = p.stamp ? `<span class="ppstp${free ? ' ppopen' : ''}">${need(p.stamp)}</span>` : '';
      return `<div class="a-partprops"><div class="pph"><span class="ppt">${need(p.title)}</span>${stamp}</div>${secs}${cons}</div>`;
    },
    ex: {
      type: 'partprops', title: 'Sketch 3 · motor bore', stamp: 'Under-defined', free: 1,
      sections: [
        { label: 'Body', rows: [['Material', 'Aluminium 6061-T6'], ['Mass', '212 g'], ['Volume', '78.5 cm³'], ['Centre of mass', '60.0, 31.2, 24.8 mm']] },
        { label: 'Selected', rows: [['Circle', 'Ø28.000 mm'], ['Centre', '60.000, 52.000 mm'], ['Plane', 'Upright front face']] },
      ],
      constraints: [
        { name: 'Diameter', count: '1' }, { name: 'Horizontal distance', count: '1' }, { name: 'Coincident', count: '2' },
        { name: 'Vertical distance', state: 'under', count: 'missing' },
      ],
    },
  };
})();

// pipebar.js
(() => {
  const ST = ['done', 'cur', 'todo', 'needs', 'failed'];
  const node = (n, i) => {
    const st = one(n.state, ST, 'todo'), kd = one(n.kind, ['step', 'gate'], 'step');
    return `<div class="pbn pb-${st} pbk-${kd}">${i ? `<i class="pbw${st === 'todo' ? '' : ' on'}"></i>` : ''}<span class="pbg"></span><span class="pbm">${need(n.title)}</span><span class="pbv">${st === 'needs' ? 'needs you' : maybe(n.value)}</span></div>`;
  };
  const A = v => Array.isArray(v) ? v : [];
  const gate = g => `<div class="pbq">${A(g.checks).length ? `<div class="pbc">${each(g.checks, c => `<span><i></i>${need(c)}</span>`)}</div>` : ''}${render({ type: 'gate', title: g.title, aside: g.sub, text: g.text ?? g.title, why: g.note ?? 'approval covers this command only', action: g.action, hash: g.hash, actions: g.actions || [{ label: 'Approve', key: 'A', primary: true }, { label: 'Reject', key: 'R' }] })}</div>`;
  const side = s => `<div class="pbr"><div class="pbrs${s.waiting === true ? ' w' : ''}"><i></i>${need(s.status)}</div><div class="pbkv">${each(A(s.rows), r => `<span>${need(r[0])}</span><span>${need(r[1])}</span>`)}</div>${A(s.artifacts).length ? `<div class="pbl">Artifacts</div>${each(s.artifacts, a => `<div class="pbf${a.off === true ? ' off' : ''}${a.gate === true ? ' g' : ''}"><i></i><span>${need(a.name)}</span><span>${maybe(a.value)}</span></div>`)}` : ''}</div>`;
  KIT.pipebar = {
    group: 'Agent and run',
    about: 'The whole pipeline as one dithered pipe: a pixel-font title, dot-matrix step shapes joined by wires, orange squares for gates; the gate that waits opens below with its exact command.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/coding-spec-to-pr', file: 's4-pipe.html', shot: 'shots/s4-gate.png' },
    replaces: 'pipe',
    req: { title: 'str', nodes: 'arr' },
    opt: { sub: 'str', legend: 'str', gate: 'obj', side: 'obj' },
    r: p => `<div class="a-pipebar"><div class="pbb"><div class="pbh1"><h2>${need(p.title)}</h2>${p.sub ? `<span class="pbsub">${need(p.sub)}</span>` : ''}${p.legend ? `<span class="pblg"><i></i>${need(p.legend)}</span>` : ''}</div><div class="pbrow" style="--n:${Math.max(1, Math.min(12, p.nodes.length))}">${each(p.nodes, node)}</div></div>${p.gate || p.side ? `<div class="pbbd">${p.gate ? each([p.gate], gate) : ''}${p.side ? each([p.side], side) : ''}</div>` : ''}</div>`,
    ex: {
      type: 'pipebar', title: 'spec-to-pr', sub: 'Spec to PR · Coding lane · acme/shopfront · troop/greet into main', legend: 'orange step needs you: the run waits until you approve',
      nodes: [
        { title: 'spec', value: '1m 12s · spec.md', state: 'done' },
        { title: 'approve spec', value: '38s · by you', state: 'done', kind: 'gate' },
        { title: 'build', value: '3m 05s · 2 files, 1 commit', state: 'done' },
        { title: 'verify', value: '4s · 2 passed', state: 'done' },
        { title: 'approve PR', value: '', state: 'needs', kind: 'gate' },
        { title: 'open PR', value: 'pending', state: 'todo' },
      ],
      gate: { title: 'Approve opening the pull request', sub: 'step 5 of 6 · guards open-pr', text: 'Open a pull request on acme/shopfront from troop/greet into main. Tests passed: true.', action: 'git push origin troop/greet\ngh pr create --base main', hash: 'a91c…e04', checks: ['verify: 2 passed', 'diff: 2 files, +5 -1', 'troop/greet into main'] },
      side: { status: 'waiting for you at approve-pr', waiting: true, rows: [['started', '14:02'], ['elapsed', '6m 41s'], ['tokens', '41,870'], ['cost', '$0.36'], ['branch', 'troop/greet']], artifacts: [{ name: 'spec.md', value: '10 lines' }, { name: 'build log', value: '8 lines' }, { name: 'diff', value: '2 files +5 -1' }, { name: 'gate decision', value: 'a91c…e04', gate: true }, { name: 'PR #7', value: 'not yet', off: true }] },
    },
  };
})();

// posture.js
(() => {
  const side = (s, cls, dflt) => `<div class="pssd ${cls}"><div class="psph"><span class="psk">${maybe(s.label || dflt)}</span><b>${maybe(s.name)}</b><em>${maybe(s.ref)}</em>${s.tag ? `<span class="pstg">${need(s.tag)}</span>` : ''}</div>`;
  const cell = v => `<div class="pscv">${need(v)}</div>`;
  const code = (c, key) => `<div class="pscd"><div class="psch"><span>${need(c.path)}</span><em>${maybe(c[key + 'Note'])}</em></div>${each(c[key], l => `<div class="pscl${l.hot === true ? ' pshot' : ''}"><span class="psno">${need(l.n)}</span><span>${need(l.text)}</span></div>`)}</div>`;
  KIT.posture = {
    group: 'Review and documents',
    about: 'Security posture as before, delta and after: a metric table with the change stamped between the two columns, and the code lines that moved underneath.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/security-security-review-and-upgrade', file: 'r4-posture.html', shot: 'origin/posture.png' },
    req: { before: 'obj', after: 'obj', rows: 'arr' },
    opt: { code: 'arr', files: 'num', add: 'num', del: 'num' },
    r: p => {
      const rows = p.rows;
      const foot = p.files == null ? '' : `<div class="psft"><b>${Math.max(0, Math.round(Number(p.files)))}</b><span>files</span><span class="psad">+${Math.max(0, Math.round(Number(p.add) || 0))}</span><span class="psdl">-${Math.max(0, Math.round(Number(p.del) || 0))}</span></div>`;
      const sideBlock = (s, cls, key) => `${side(s, cls, key === 'after' ? 'After' : 'Before')}${each(rows, r => `<div class="pspr"><span class="pslb">${need(r.label)}</span>${cell(r[key])}${key === 'after' ? `<span class="psdd">${need(r.delta)}</span>` : ''}</div>`)}${p.code ? each(p.code, c => code(c, key)) : ''}</div>`;
      return `<div class="a-posture">${sideBlock(p.before, 'psb', 'before')}
      <div class="pssd psm"><div class="psph"><span class="psk">Delta</span></div>${each(rows, r => `<div class="pspr"><span class="psdp">${need(r.delta)}</span></div>`)}${p.code ? each(p.code, () => '<div class="pscd pssp"></div>') : ''}${foot}</div>
      ${sideBlock(p.after, 'psa', 'after')}</div>`;
    },
    ex: {
      type: 'posture',
      before: { label: 'Before', name: 'yamlish 2.4.1', ref: 'main', tag: 'GHSA-demo-7q2x-yaml' },
      after: { label: 'After', name: 'yamlish 3.0.2', ref: 'mt/upgrade-yamlish-3', tag: 'Advisory closed' },
      rows: [
        { label: 'Advisories', before: '1 high', after: '0', delta: '-1 high' },
        { label: 'Reachable findings', before: '2 (F1 high, F3 low)', after: '1 (F3 low)', delta: '-1 reachable' },
        { label: 'Findings in report', before: '3', after: '2', delta: '-1' },
        { label: 'Licences', before: '42 ok', after: '42 ok', delta: 'same' },
        { label: 'Install scripts', before: '0', after: '0', delta: 'same' },
        { label: 'Tests', before: '38/38', after: '38/38 (1 assertion changed)', delta: '1 assertion' },
      ],
      code: [
        { path: 'src/config.js:22', beforeNote: 'F1 closed by upgrade', afterNote: 'bump b41e09c',
          before: [{ n: '21', text: 'function loadConfig(text) {' }, { n: '22', text: '  return yaml.load(text, { schema: yaml.FULL });', hot: true }, { n: '23', text: '}' }],
          after: [{ n: '21', text: 'function loadConfig(text) {' }, { n: '22', text: '  return yaml.parse(text);', hot: true }, { n: '23', text: '}' }] },
      ],
      files: 5, add: 17, del: 22,
    },
  };
})();

// postweek.js
(() => {
  const arr = v => Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : [];
  const fm = scene => {
    const s = one(scene, ['a', 'b'], 'a');
    const body = s === 'b' ? '<i class="zrb"></i><i class="zrt"></i><i class="zh1"><b></b><b></b><b></b><b></b></i><i class="zh2"><b></b><b></b><b></b><b></b></i>'
      : '<i class="zwn"></i><i class="zsf"></i><i class="zpe"><b class="ztr"></b><b class="zhd"></b></i><i class="ztb"></i><i class="zpt"><b class="zlf za"></b><b class="zlf zb"></b><b class="zlf zc"></b></i>';
    return `<div class="zfm zv"><div class="zsc zs-${s}">${body}</div></div>`;
  };
  const ST = ['pass', 'scheduled', 'flag', 'dropped', 'slot'];
  const post = (x, st) => {
    const s = one(x.state, ST, 'pass');
    const word = { pass: 'pass', scheduled: 'scheduled', flag: 'left for you', dropped: 'dropped', slot: 'empty slot' }[s];
    return `<div class="zpost zs-${s}">${s === 'dropped' || s === 'slot' ? '' : fm(x.scene)}<div class="ztx"><b>${need(x.k)} ${need(x.at)}</b><span>${maybe(x.text)}</span><em>${word}</em></div></div>`;
  };
  KIT.postweek = {
    group: 'Workspaces',
    about: 'Week calendar of scheduled short-video posts: one row per feed, one column per day, each post a vertical frame with its time, line and state (pass, scheduled, left for you, dropped, empty slot).',
    origin: { folder: 'metatrooper-lanes-2026-10-04/video-clips-to-scheduled-posts', file: 'r3-week.html', shot: 'check/r3-gate.png' },
    req: { days: 'arr', lanes: 'arr' },
    opt: { title: 'str', file: 'str', now: 'num', stats: 'str', foot: 'str' },
    r: p => {
      const nd = p.days.length;
      const heads = each(p.days, (d, i) => `<div class="zdh${p.now === i ? ' znow' : ''}">${need(d.label)}${p.now === i ? '<i>now</i>' : ''}</div>`);
      const lanes = each(p.lanes, l => {
        const cells = p.days.map((d, i) => {
          const x = arr(l.posts).find(q => Number(q.day) === i);
          return `<div class="zcell"><span class="zdl">${need(d.label)}</span>${x ? post(x) : ''}</div>`;
        }).join('');
        return `<div class="zlane"><div class="zln"><b>${need(l.name)}</b><span>${maybe(l.note)}</span></div><div class="zcells">${cells}</div></div>`;
      });
      const hasFlag = arr(p.lanes).some(l => arr(l.posts).some(x => x.state === 'flag'));
      return `<div class="a-postweek" style="--nd:${Math.min(14, Math.max(1, nd))}"><div class="zbar"><span class="zlbl">${maybe(p.title || 'Week')}</span><span class="zfl">${maybe(p.file)}</span><span class="ztabs"><b>Week</b><i>List</i></span><span class="zst">${maybe(p.stats)}</span></div>
        <div class="zgr"><div class="zhrow"><div class="zln"></div><div class="zheads">${heads}</div></div>${lanes}</div>
        <div class="zfoot"><span class="zag">${maybe(p.foot)}</span><span class="zlg"><i class="zbx"></i>checked</span>${hasFlag ? '<span class="zlg zneed"><i class="zbx"></i>left for you</span>' : ''}<span class="zlg"><i class="zbx zdash"></i>empty or dropped slot</span></div></div>`;
    },
    ex: {
      type: 'postweek', title: 'Week', file: 'out/schedule.json, proposed', now: 0, stats: '11 posts · 1 flag for you', foot: 'agent: approve · one a day per feed',
      days: [{ label: 'Tue 6 Oct' }, { label: 'Wed 7 Oct' }, { label: 'Thu 8 Oct' }, { label: 'Fri 9 Oct' }, { label: 'Sat 10 Oct' }, { label: 'Sun 11 Oct' }],
      lanes: [
        { name: 'Feed A', note: 'test account · 12:30 daily', posts: [
          { day: 0, k: 'k1', at: '12:30', text: 'Two to one. That is the rule.', state: 'pass', scene: 'a' },
          { day: 1, k: 'k2', at: '12:30', text: 'Warm in the middle = working', state: 'pass', scene: 'b' },
          { day: 2, k: 'k3', at: '12:30', text: 'Three things to keep out', state: 'pass', scene: 'a' },
          { day: 3, k: 'k4', at: '12:30', text: 'Six months later', state: 'pass', scene: 'b' },
          { day: 4, k: 'k5', at: '12:30', text: 'The sieve step', state: 'flag', scene: 'b' },
          { day: 5, k: 'k6', at: '12:30', text: 'Start with leaves and scraps', state: 'pass', scene: 'a' }] },
        { name: 'Feed B', note: 'test account · 17:00 daily', posts: [
          { day: 0, k: 'k1', at: '17:00', text: 'Greens vs browns in 40 seconds', state: 'pass', scene: 'a' },
          { day: 1, k: 'k2', at: '17:00', text: 'The hand test for compost', state: 'pass', scene: 'b' },
          { day: 2, k: 'k3', at: '17:00', text: 'What not to compost', state: 'scheduled', scene: 'a' },
          { day: 3, k: 'k4', at: '17:00', text: '', state: 'slot' },
          { day: 4, k: 'k5', at: '17:00', text: 'Why I sieve my compost', state: 'dropped' }] },
      ],
    },
  };
})();

// previewstage.js
(() => {
  const LOAVES = [['Country sourdough', '$9'], ['Seeded rye', '$8'], ['Spelt tin', '$10']];
  const LF = ['<path class="zlb" d="M14 46 C14 22 36 12 60 12 C84 12 106 22 106 46 Z"/><path class="zls" d="M40 26 L50 38 M54 22 L64 36 M70 23 L78 36"/>', '<path class="zlb" d="M6 46 C6 30 30 20 60 20 C90 20 114 30 114 46 Z"/><path class="zls" d="M28 30 L36 42 M46 26 L54 40 M64 26 L72 40 M82 29 L90 41"/>', '<path class="zlb" d="M26 46 L26 28 C26 14 44 12 60 12 C76 12 94 14 94 28 L94 46 Z"/><path class="zls" d="M26 38 L94 38 M44 24 L52 24 M68 24 L76 24"/>'];
  const loaf = i => `<i class="zloaf"><svg viewBox="0 0 120 56" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${LF[i % 3]}<path class="zlg" d="M4 46 H116"/></svg></i>`;
  const sk = (l, head, m, extra, scrolled) => {
    const top = scrolled ? '<div class="zscrl">↑ hero, hours</div>' : `<div class="zhero"><i class="zph"></i><div class="ztx"><h4>${need(head)}</h4><p class="zlede">Sourdough, rye and spelt from the wood oven, baked before the shop opens.</p><u>Pre-order</u></div><div class="zhr"><em>Hours</em><p><span>Tue to Fri</span><span>7 to 3</span></p><p><span>Sat</span><span>7 to 2</span></p><p><span>Sun</span><span>8 to 12</span></p></div></div>`;
    return `<div class="zsk zl-${one(l, ['board', 'photo', 'journal'], 'board')}${m ? ' zm' : ''}"><div class="znv">Bakery<span><b>Bread</b><b>Hours</b><b>Order</b></span></div>${top}<div class="zbd"><em class="zsh2">This week's bread</em><div class="zcards">${LOAVES.map(([nm, pr], i) => `<div class="zcard">${loaf(i)}<span>${nm}</span><b>${pr}</b></div>`).join('')}</div></div>${extra || ''}</div>`;
  };
  const POS = ['hero', 'hours', 'bread'];
  const pin = n => `<i class="zpin zp-${one(n.where, POS, 'hero')}${n.fix ? ' zok' : ''}">${need(n.n)}</i>`;
  const frame = (url, w, inner, cls) => `<div class="zbr ${cls}"><div class="zbb"><i></i><i></i><i></i><span class="zurl">${need(url)}</span><span class="zvs">${need(w)}</span></div>${inner}</div>`;
  KIT.previewstage = {
    group: 'Review and documents',
    about: 'The site being built, drawn live in a desktop and a phone frame side by side, with critique pins on the page, one card per note, and a section checklist at the foot.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/design-website-build', file: 'r1-preview-stage.html', shot: 'check/r1-critique.png' },
    replaces: 'preview',
    req: { title: 'str', notes: 'arr' },
    opt: { action: 'str', url: 'str', headline: 'str', widths: 'arr', versions: 'arr', sections: 'arr', stamp: 'str' }, // a section with added: true is also drawn into both frames
    r: p => {
      const url = p.url || '127.0.0.1:4410', head = p.headline || 'Bread baked before sunrise, six days a week';
      const ws = (Array.isArray(p.widths) ? p.widths : []).filter(w => typeof w === 'string' && w);
      const widths = ws.length ? ws : ['1280', '390'];
      const added = (Array.isArray(p.sections) ? p.sections : []).filter(s => s && s.added === true && typeof s.label === 'string');
      const extra = added.length ? `<div class="zadd">${each(added, s => `<div class="zas"><em>${need(s.label)}</em>${Array.isArray(s.items) && s.items.length ? `<div class="zpr">${each(s.items, it => `<div class="zpc${it.hl ? ' zhl' : ''}"><b>${need(it.name)}</b><span>${maybe(it.what)}</span><strong>${need(it.price)}</strong></div>`)}</div>` : '<s></s><s></s>'}<span class="zan">new</span></div>`)}</div>` : '';
      const vers = Array.isArray(p.versions) ? p.versions : [];
      const pins = each(p.notes, n => pin(n));
      const tabs = vers.length ? `<span class="zk">Version</span><span class="ztabs">${each(vers, (v, i) => `<span class="${i === vers.length - 1 ? 'zon' : ''}">${need(v.label)}${v.commit ? ` <em>${need(v.commit)}</em>` : ''}</span>`)}</span>` : '';
      const chips = `<span class="zk">Width</span><span class="ztabs">${each(widths, w => `<span>${need(w)}</span>`)}<span class="zon">both</span></span>`;
      const cards = each(p.notes, n => `<div class="znc${n.fix ? ' zok' : ''}"><i class="zdot">${need(n.n)}</i><div><b>${need(n.text)}</b>${n.fix ? `<span class="zfx">${need(n.fix)}</span>` : ''}</div></div>`);
      const listed = (Array.isArray(p.sections) ? p.sections : []).filter(s => s && s.added !== true);
      const secs = listed.length ? `<div class="zck"><span class="zk">Sections</span>${each(listed, s => `<span class="zci${s.done ? ' zd' : ''}"><i></i>${need(s.label)}</span>`)}</div>` : '';
      return `<div class="a-previewstage"><div class="ztb">${tabs}<span class="zsp"></span>${p.stamp ? `<span class="zst">${need(p.stamp)}</span>` : ''}${chips}${p.action ? `<button class="btn acc zact">${need(p.action)}</button>` : ''}</div>
        <div class="zfrm">${frame(url, widths[0], `<div class="zpg">${sk('board', head, false, extra, !!extra)}${extra ? '' : pins}</div>`, 'zdk')}${frame(url, widths[widths.length - 1], `<div class="zpg">${sk('board', head, true, extra, !!extra)}</div>`, 'zmb')}</div>
        <div class="znl">${cards}</div>${secs}<div class="zttl">${need(p.title)}</div></div>`;
    },
    ex: {
      type: 'previewstage', title: 'bakery-site, critique 1', stamp: 'critique 1 of 3',
      versions: [{ label: 'build', commit: 'a71e0c3' }, { label: 'critique 1', commit: 'c39b5e8' }],
      notes: [
        { n: '1', where: 'hero', text: 'Headline runs off the right edge at 390 px', fix: 'clamp() on the hero heading, 48 px down to 34 px' },
        { n: '2', where: 'hours', text: 'Hours times are light grey on flour: contrast 2.9 to 1', fix: 'times use rye instead of the muted grey' },
        { n: '3', where: 'bread', text: 'Bread list has no price column at 1280' },
      ],
      sections: [{ label: 'hero', done: true }, { label: 'hours', done: true }, { label: 'bread', done: false }, { label: 'pre-order', done: false }],
    },
  };
})();

// prfirst.js
(() => {
  const A = v => Array.isArray(v) ? v : [];
  const diff = f => {
    let o = 0, n = 0;
    const rows = each(A(f.lines), l => {
      const s = String(l), c = s[0];
      if (c === '@') { const m = s.match(/-(\d+)\D+\+(\d+)/); o = m ? Number(m[1]) : 1; n = m ? Number(m[2]) : 1; return `<div class="o-ln o-h"><i></i><i></i><b></b><span>${need(l)}</span></div>`; }
      const a = c === '+' ? '' : o++, b = c === '-' ? '' : n++;
      return `<div class="o-ln${c === '+' ? ' o-a' : c === '-' ? ' x' : ''}"><i>${a}</i><i>${b}</i><b>${c === '+' || c === '-' ? c : ''}</b><span>${need(s.slice(c === '+' || c === '-' || c === ' ' ? 1 : 0))}</span></div>`;
    });
    return `<div class="df"><div class="o-dh"><span class="fnm">${need(f.name)}</span><span class="o-ad">+${need(f.add ?? 0)}</span><span class="dd">-${need(f.del ?? 0)}</span><span class="vw${f.viewed === true ? ' o-on' : ''}">Viewed</span></div>${rows}</div>`;
  };
  const sect = s => `<div class="o-h">${need(s.h)}</div>${s.text ? `<div class="o-p">${need(s.text)}</div>` : ''}${A(s.checks).length ? each(s.checks, c => `<div class="o-ck"><i></i>${need(c)}</div>`) : ''}`;
  const chk = c => `<div class="ci q-${one(c.state, ['done', 'waiting', 'queued'], 'queued')}"><i class="cg"></i><div><div class="o-ct"><b>${need(c.title)}</b><span class="kd">${maybe(c.kind)}</span><span class="cr">${maybe(c.right)}</span></div><div class="cs">${maybe(c.sub)}</div>${A(c.lines).length ? `<div class="cl">${each(c.lines, l => `<div>${need(l)}</div>`)}</div>` : ''}</div></div>`;
  const gate = g => `<div class="o-gate">${render({ type: 'gate', title: g.title, aside: g.sub, text: g.text ?? g.title, why: g.note ?? 'opens on GitHub only after you approve', action: g.action, hash: g.hash, actions: g.actions || [{ label: 'Open pull request', key: 'A', primary: true }, { label: 'Reject', key: 'R' }] })}</div>`;
  KIT.prfirst = {
    group: 'Review and documents',
    about: 'The pull request drawn before it exists: description, files changed, checks, and a gate under the diff that asks you to open it.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/coding-spec-to-pr', file: 's3-pr-first.html', shot: 'shots/s3-gate.png' },
    req: { title: 'str', files: 'arr' },
    opt: { state: 'str', meta: 'str', head: 'str', base: 'str', facts: 'arr', tabs: 'arr', description: 'arr', asked: 'arr', checks: 'arr', gate: 'obj', add: 'str', del: 'str' },
    r: p => {
      const g = p.gate;
      return `<div class="a-prfirst">
  <div class="hd"><div class="o-tl"><h2>${need(p.title)}</h2></div><div class="fx">${each(A(p.facts), f => `<div><span class="o-k">${need(f[0])}</span><span class="o-v">${need(f[1])}</span></div>`)}</div></div>
  <div class="o-mt"><span class="pl ${one(p.state, ['draft', 'open', 'merged'], 'draft')}">${need(p.state || 'draft')}</span>${p.meta ? `<span class="mm">${need(p.meta)}</span>` : ''}${p.base ? `<span class="o-ch">${need(p.base)}</span>` : ''}${p.head ? `<span class="mm">from</span><span class="o-ch">${need(p.head)}</span>` : ''}</div>
  ${p.tabs ? `<div class="o-tb">${each(p.tabs, (t, i) => `<span class="o-tab${t.on === true ? ' o-on' : ''}">${need(t.label)}${t.count != null ? `<em>${need(t.count)}</em>` : ''}</span>`)}<span class="df0">${p.add ? `<b class="o-ad">${need(p.add)}</b>` : ''}${p.del ? `<b class="dd">${need(p.del)}</b>` : ''}</span></div>` : ''}
  <div class="gr">
    <div class="lf"><div class="o-cd"><div class="ch2"><span>Description</span></div><div class="o-cb">${each(A(p.description), sect)}</div></div>${p.asked ? `<div class="o-cd"><div class="ch2"><span>Asked for</span></div><div class="o-cb kvs">${each(p.asked, r => `<span>${need(r[0])}</span><span>${need(r[1])}</span>`)}</div></div>` : ''}</div>
    <div class="o-md"><div class="o-fl">${each(p.files, diff)}</div>${g ? each([g], gate) : ''}</div>
    <div class="o-rt"><div class="ch2"><span>Checks</span><span class="o-r">${A(p.checks).length ? `${A(p.checks).filter(c => c && c.state === 'done').length} of ${p.checks.length} passed` : ''}</span></div>${each(A(p.checks), chk)}</div>
  </div>
</div>`;
    },
    ex: {
      type: 'prfirst', title: 'Add greet(name)', state: 'draft', meta: 'DRAFT, NOT ON GITHUB YET · troop will ask to merge 1 commit into', base: 'acme/shopfront:main', head: 'troop/greet',
      facts: [['Run', 'run-7f3a'], ['Elapsed', '6m 41s'], ['Tokens', '41,870'], ['Cost', '$0.36']],
      tabs: [{ label: 'Conversation' }, { label: 'Commits', count: 1 }, { label: 'Checks', count: '4/6' }, { label: 'Files changed', count: 2, on: true }],
      add: '+5', del: '-1',
      description: [
        { h: 'Goal', text: 'Export greet(name) from index.js that returns "Hello, <name>!".' },
        { h: 'Non-goals', text: 'No localisation. No changes to add(a, b).' },
        { h: 'Acceptance checks', checks: ['greet("Ada") === "Hello, Ada!"', 'npm test passes, including the existing add test.'] },
      ],
      asked: [['What to build', 'Add a greet(name) function and a test for it.'], ['GitHub repository', 'acme/shopfront'], ['Base branch', 'main']],
      files: [
        { name: 'index.js', add: 3, del: 0, lines: ['@@ -1,3 +1,6 @@', ' export function add(a, b) {', '   return a + b;', ' }', '+export function greet(name) {', '+  return `Hello, ${name}!`;', '+}'] },
        { name: 'test.js', add: 2, del: 1, lines: ['@@ -1,5 +1,6 @@', " import assert from 'node:assert/strict';", "-import { add } from './index.js';", "+import { add, greet } from './index.js';", ' ', ' assert.equal(add(2, 3), 5);', "+assert.equal(greet('Ada'), 'Hello, Ada!');", " console.log('ok');"] },
      ],
      checks: [
        { title: 'spec', kind: 'agent', state: 'done', right: '1m 12s', sub: 'claude · 9,400 tok · spec.md' },
        { title: 'approve-spec', kind: 'gate', state: 'done', right: '38s', sub: 'by you. "Looks right."' },
        { title: 'build', kind: 'agent', state: 'done', right: '3m 05s', sub: 'claude · 28,100 tok · 2 files, 1 commit', lines: ['Read(index.js)  Read 3 lines', 'Bash(npm test)  FAIL greet is not a function', 'Bash(npm test)  ok'] },
        { title: 'verify', kind: 'action', state: 'done', right: '4s', sub: '2 passed', lines: ['$ npm test', 'exit 0  ·  2 assertions passed'] },
        { title: 'approve-pr', kind: 'gate', state: 'waiting', right: 'needs you', sub: 'guards open-pr. Review the files, then open.' },
        { title: 'open-pr', kind: 'action', state: 'queued', right: 'queued', sub: 'push and open on GitHub' },
      ],
      gate: { title: 'Ready to open. Waiting for you', sub: 'approve-pr · guards open-pr · step 5 of 6', text: 'Open a pull request on acme/shopfront from troop/greet into main. Tests passed: true.', action: 'git push origin troop/greet && gh pr create --base main', hash: 'a91c…e04', note: 'Runs exactly this command, nothing else.' },
    },
  };
})();

// prinline.js
(() => {
  const n = v => Math.max(0, Math.min(99999, Math.round(Number(v)) || 0));
  const SEV = ['critical', 'high', 'medium', 'low'];
  const A = a => Array.isArray(a) ? a : [];
  const O = o => o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  const T = v => { try { return maybe(v); } catch { return ''; } };
  const MK = {
    left: '<span class="mk cx"></span>', right: '<span class="mk gm"></span>',
    both: '<span class="mk both"><i class="gm"></i><i class="cx"></i></span>',
    disagree: '<span class="mk pair"><i class="cx"></i><i class="gm"></i></span>',
  };
  const bucket = b => one(b, ['both', 'left', 'right', 'disagree'], 'left');
  const hotc = c => c.bucket === 'disagree' || c.severity === 'critical';
  const sq = (a, d) => {
    const t = Math.max(a + d, 5), na = Math.round(a / t * 5), nd = Math.round(d / t * 5);
    return `<span class="sq">${[0, 1, 2, 3, 4].map(i => `<i class="${i < na ? 'a' : i < na + nd ? 'd' : ''}"></i>`).join('')}</span>`;
  };
  const stamp = t => `<span class="stamp"><span class="si"><span class="ink y" aria-hidden="true">${esc(t)}</span><span class="ink p">${esc(t)}</span></span></span>`;
  const who = (b, p) => {
    const l = eng(O(p.left).engine), r = eng(O(p.right).engine);
    return b === 'both' ? `<b>${l}</b> and <b>${r}</b> agree` : b === 'left' ? `Only <b>${l}</b>` : b === 'right' ? `Only <b>${r}</b>` : `<b>${l}</b> and <b>${r}</b> disagree`;
  };
  const eng = v => { try { return need(v).replace(/^./, c => c.toUpperCase()); } catch { return 'Engine'; } };
  const comment = (c, p) => {
    const b = bucket(c.bucket), hot = hotc(c);
    const q = (m, t) => t ? `<div class="q">${m}<span>${T(t)}</span></div>` : '';
    const body = b === 'disagree'
      ? `<div class="split"><div><div class="shxpr">${MK.left}<b>${eng(O(p.left).engine)}</b> says</div>${T(c.left)}</div><div><div class="shxpr">${MK.right}<b>${eng(O(p.right).engine)}</b> says</div>${T(c.right)}</div></div>`
      : q(MK.left, c.left) + q(MK.right, c.right);
    return `<div class="cm b-${b}${hot ? ' need' : ''}"><div class="cmh">${MK[b]}<span class="who">${who(b, p)}</span><span class="loc">L${n(c.from || c.line)}${c.from && c.from !== c.line ? '-' + n(c.line) : ''}</span><span class="sev ${one(c.severity, SEV, 'low')}">${one(c.severity, SEV, 'low')}</span><span class="cma">${acts(Array.isArray(c.actions) ? c.actions : [{ label: 'Send to agent', key: 'S', primary: true }, { label: 'Dismiss' }, { label: 'Copy as comment' }])}</span></div>
      <div class="cmb"><div class="tt">${need(c.title)}${hot ? stamp('Needs you') : ''}</div>${body}</div></div>`;
  };
    const file = (f, p) => {
    const cs = A(f.comments).map(O).filter(c => Object.keys(c).length);
    const fr = A(f.rows);
    const rows = each(fr, (r, i) => {
      const k = r.k === '+' ? '+' : '';
      const at = cs.filter(c => n(c.line) === n(r.n));
      const inr = cs.some(c => n(r.n) >= n(c.from || c.line) && n(r.n) <= n(c.line));
      const g = cs.find(c => n(c.from || c.line) === n(r.n));
      const gap = i && n(r.n) !== n(O(fr[i - 1]).n) + 1 ? `<div class="dr h"><span class="g"></span><span class="n"></span><span class="s"></span><span class="t">@@ +${n(r.n)} @@</span></div>` : '';
      return `${gap}<div class="dr${k ? ' a' : ''}${inr ? ' in' : ''}"><span class="g">${g ? MK[bucket(g.bucket)] : ''}</span><span class="n">${n(r.n)}</span><span class="s">${k}</span><span class="t">${need(r.t) || ' '}</span></div>${at.map(c => `<div class="cw">${each([c], c => comment(c, p))}</div>`).join('')}`;
    });
    return `<div class="fb"><div class="fh"><span class="fn">${need(f.path)}</span><span class="ad">+${n(f.add)}</span><span class="dl">-${n(f.del)}</span>${sq(n(f.add), n(f.del))}<span class="fm">${cs.length} finding${cs.length === 1 ? '' : 's'}</span></div><div class="dt">${rows}</div></div>`;
  };
  KIT.prinline = {
    group: 'Review and documents',
    about: 'A pull-request diff where two engines leave inline review comments on the lines they are about: agreements fold into one comment, the one argument sits open side by side.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/coding-two-engine-review', file: 'r1-pr-inline.html', shot: 'r1-pr-inline.html?state=sorted (no stored shot)' },
    replaces: 'thread',
    req: { title: 'str', left: 'obj', right: 'obj', files: 'arr' },
    opt: { range: 'str', stats: 'str' },
    r: p => `<div class="a-prinline"><div class="phd"><div class="phl"><div class="pht">${need(p.title)}${p.range ? ` <span class="phr">${need(p.range)}</span>` : ''}</div>
      <div class="phs"><span class="pill">Reviewed</span>${MK.left}<b>${eng(O(p.left).engine)}</b> and ${MK.right}<b>${eng(O(p.right).engine)}</b>${p.stats ? ` <span class="phst">${need(p.stats)}</span>` : ''}</div></div>
      <div class="phv"><span class="verdict">${T(O(p.left).verdict)}</span><span class="verdict">${T(O(p.right).verdict)}</span></div></div>
      ${each(A(p.files), f => file(f, p))}</div>`,
    ex: {
      type: 'prinline', title: 'Review of shopfront', range: 'HEAD~3..HEAD', stats: '4 files, 212 lines',
      left: { engine: 'codex', verdict: 'reject' }, right: { engine: 'gemini', verdict: 'approve' },
      files: [
        { path: 'src/routes/login.ts', add: 18, del: 4, rows: [
          { n: 38, t: "router.post('/login', async (req, res) => {" }, { n: 39, t: '  const user = await auth(req.body);' },
          { n: 40, k: '+', t: '  const next = req.query.next;' }, { n: 41, k: '+', t: '  if (user) {' },
          { n: 42, k: '+', t: "    return res.redirect(next || '/account');" }, { n: 43, k: '+', t: '  }' },
          { n: 44, k: '+', t: "  res.status(401).render('login', { error: true });" }, { n: 45, t: '});' },
        ], comments: [{ bucket: 'both', severity: 'high', title: 'Unvalidated redirect', from: 40, line: 44, left: 'next= is passed to res.redirect without an allow-list.', right: 'The redirect target comes from the query string and is not checked.' }] },
        { path: 'src/config.ts', add: 6, del: 1, rows: [
          { n: 10, t: 'export const config = {' }, { n: 11, t: '  apiBase: process.env.API_BASE,' },
          { n: 12, k: '+', t: '  stripeSecret: process.env.STRIPE_SECRET,' }, { n: 13, t: "  currency: 'AUD'," }, { n: 14, t: '};' },
        ], comments: [{ bucket: 'left', severity: 'critical', title: 'Secret in client bundle', line: 12, left: 'STRIPE_SECRET is read in a module imported by the browser build.' }] },
        { path: 'src/checkout/Payment.tsx', add: 31, del: 9, rows: [
          { n: 18, k: '+', t: '  const [error, setError] = useState<string | null>(null);' },
          { n: 19, k: '+', t: '  async function pay(form: FormData) {' }, { n: 20, k: '+', t: '    const r = await submitPayment(form);' },
          { n: 21, k: '+', t: '    if (!r.ok) setError(r.message);' }, { n: 22, k: '+', t: '  }' },
          { n: 30, k: '+', t: '  {error && <p className="err">{error}</p>}' },
        ], comments: [{ bucket: 'disagree', severity: 'medium', title: 'Error state not announced', from: 18, line: 30, left: 'Needs aria-live so screen readers hear the error.', right: 'The existing toast already announces it; no change needed.' }] },
      ],
    },
  };
})();

// qasession.js
(() => {
  const pc = v => Math.round(Math.max(0, Math.min(100, Number(v) || 0)) * 10) / 10;
  const A = a => Array.isArray(a) ? a : [];
  const O = o => o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  const T = v => { try { return maybe(v); } catch { return ''; } };
  const KINDS = ['dot', 'x', 'ring', 'hot'];
  const page = pg => (pg = O(pg), `<div class="pg"><b class="h">${maybe(pg.h)}</b><span class="in">${maybe(pg.field || pg.placeholder)}</span><span class="bt">${maybe(pg.button || 'Add')}</span>${each(A(pg.items), x => `<span class="li">${need(x)}</span>`)}<span class="ct">${T(pg.count)}</span></div>`);
  const replay = r => (r = O(r), `<div class="rp"><div class="rh"><i class="rec"></i><span class="k">${T(r.label) || 'Replay'}</span><span class="mt">${maybe(r.meta)}</span></div>
    <div class="bw"><div class="bb"><i></i><i></i><i></i><span class="url">${maybe(r.url)}</span><span class="sz">${maybe(r.size)}</span></div><div class="vp">${page(r.page)}
    ${r.pip && typeof r.pip === 'object' ? `<div class="pip"><div class="pf"><span class="k">${T(r.pip.label)}</span><span class="mt">${T(r.pip.meta)}</span></div><div class="pbd">${page(r.pip.page)}</div></div>` : ''}
    ${r.note ? `<span class="nt">${T(r.note)}</span>` : ''}</div></div></div>`);
  KIT.qasession = {
    group: 'Agent and run',
    about: 'QA session: a replay of the browser at the chosen moment with a first-walk inset, over a swim-lane timeline of the run (pipeline steps, browser actions, console errors, network, tests) with an end marker.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/coding-e2e-browser-qa', file: 'r5-session.html', shot: 'replay and session lanes' },
    req: { segs: 'arr', lanes: 'arr' },
    opt: { replay: 'obj', title: 'str', playhead: 'num', end: 'str' },
    r: p => `<div class="a-qasession">${p.replay && typeof p.replay === 'object' ? replay(p.replay) : ''}
      <div class="ss"><div class="sx"><span class="k lh">${T(p.title) || 'Session'}</span><div class="sg">${each(A(p.segs), s => `<span class="sgi" style="flex:${Math.max(1, Math.min(100, Number(s.w) || 1))}"><b>${need(s.label)}</b> ${maybe(s.dur)}</span>`)}</div></div>
      ${each(A(p.lanes), l => `<div class="lne"><div class="lh"><b class="k">${need(l.label)}</b><span>${maybe(l.sub)}</span></div><div class="lt">
        ${each(A(l.blocks), b => `<span class="bk" style="left:${pc(b.at)}%;width:${pc(b.w)}%">${b.state === 'done' ? '&#10003; ' : ''}${need(b.label)}</span>`)}
        ${each(A(l.marks), m => `<span class="mk m-${one(m.kind, KINDS, 'dot')}" style="left:${pc(m.at)}%"><i></i>${m.label ? `<em>${need(m.label)}</em>` : ''}</span>`)}</div></div>`)}
      ${p.playhead != null ? `<span class="ph2" style="left:calc(112px + (100% - 112px) * ${pc(p.playhead) / 100})">${p.end ? `<em>${T(p.end)}</em>` : ''}</span>` : ''}</div></div>`,
    ex: {
      type: 'qasession', title: 'Session', playhead: 99.5, end: 'end',
      replay: { label: 'Replay', meta: 'chromium 1280x800 · #10 click Add · rewalk 00:07', url: 'http://127.0.0.1:4317/', size: '1280x800',
        page: { h: 'Shopping list', placeholder: 'Item', items: ['milk'], count: '1 item' },
        pip: { label: 'First walk', meta: 'frame 4 · 0 items', page: { h: 'Shopping list', field: 'milk', count: '0 items' } },
        note: 're-walk after 4f1c2d0: "milk" listed, 1 item' },
      segs: [{ label: 'flows', dur: '1m 12s', w: 8 }, { label: 'qa', dur: '5m 31s', w: 46 }, { label: 'fix', dur: '3m 48s', w: 30 }, { label: 'reverify', dur: '2s', w: 8 }, { label: 'report', dur: '0s', w: 8 }],
      lanes: [
        { label: 'Agent', sub: 'pipeline steps', blocks: [{ at: 1, w: 8, label: 'flows', state: 'done' }, { at: 9.5, w: 45, label: 'Walk the flows in the browser', state: 'done' }, { at: 55, w: 29, label: 'Fix what QA found', state: 'done' }, { at: 85, w: 7, label: 'reverify', state: 'done' }, { at: 93, w: 6.5, label: 'report', state: 'done' }] },
        { label: 'Browser', sub: 'actions', marks: [{ at: 15, kind: 'dot' }, { at: 17, kind: 'dot' }, { at: 19, kind: 'dot' }, { at: 21, kind: 'x' }, { at: 34, kind: 'dot' }, { at: 36, kind: 'x' }, { at: 48, kind: 'dot' }, { at: 50, kind: 'x' }, { at: 54, kind: 'dot' }, { at: 92, kind: 'ring', label: 're-walk' }] },
        { label: 'Console', sub: 'errors', marks: [{ at: 21, kind: 'x' }, { at: 36, kind: 'x' }, { at: 50, kind: 'x', label: 'TypeError x3 at app.js:13' }] },
        { label: 'Network', sub: 'requests', marks: [{ at: 9, kind: 'ring' }, { at: 11, kind: 'ring' }, { at: 13, kind: 'ring' }, { at: 15.5, kind: 'hot', label: '/favicon.ico 404' }] },
        { label: 'Tests', sub: 'npm test, node test.js', marks: [{ at: 78, kind: 'ring', label: 'npm test: ok' }, { at: 88, kind: 'ring', label: 'node test.js ok' }] },
      ],
    },
  };
})();

// releasedraft.js
(() => {
  const line = l => `<div class="rdln"><span class="rdtx">${need(l.text)}</span><span class="rdpr">${maybe(l.pr)}</span><span class="rdtg">${l.label ? `<i>${need(l.label)}</i>` : ''}</span><span class="rddc${l.doc ? '' : ' rdnone'}">${l.doc ? need(l.doc) : 'no doc'}</span></div>`;
  const rows = g => Array.isArray(g?.lines) ? g.lines : [];
  const group = g => `<div class="rdgr"><div class="rdgh">${need(g.label)} <b>${rows(g).length}</b></div>${each(rows(g), line)}</div>`;
  const field = (k, v) => v == null ? '' : `<div class="rdfd"><span>${k}</span><b>${need(v)}</b></div>`;
  KIT.releasedraft = {
    group: 'Review and documents',
    about: 'Release notes drafted as a form: version fields on top, then every note line tied to the pull request, label and doc page it came from.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/docs-docs-and-release-notes', file: 'r1-release-draft.html', shot: 'origin/releasedraft.png' },
    req: { title: 'str', groups: 'arr' },
    opt: { intro: 'str', tag: 'str', target: 'str', previous: 'str', bump: 'str', file: 'str', skipped: 'arr' },
    r: p => {
      const n = p.groups.reduce((a, g) => a + rows(g).length, 0);
      const skip = p.skipped && p.skipped.length ? `<div class="rdsk">${each(p.skipped, s => `<span>${need(s)}</span>`)}</div>` : '';
      return `<div class="a-releasedraft"><div class="rdfds">${field('Tag', p.tag)}${field('Target', p.target)}${field('Previous', p.previous)}${field('Bump', p.bump)}</div>
      <div class="rdnt"><div class="rdnh"><span class="rdk">Release notes</span><span class="rdfl">${maybe(p.file)}</span><span class="rdct">${n} lines, every one sourced: PR, label, doc</span></div>
      <div class="rdnb"><div class="rdti">${need(p.title)}</div>${p.intro ? `<div class="rdin">${need(p.intro)}</div>` : ''}${each(p.groups, group)}</div>${skip}</div></div>`;
    },
    ex: {
      type: 'releasedraft', title: 'inkwell 1.5.0', intro: 'Skip paths with an ignore file, read results as JSON, and one new rule.',
      tag: 'v1.5.0', target: 'main@c4e19a0', previous: 'v1.4.2', bump: 'minor',
      file: 'release-notes.md',
      groups: [
        { label: 'Added', lines: [
          { text: '--ignore-file skips paths listed in a file, like .gitignore.', pr: '#204', label: 'feature', doc: 'docs/how-to/ignore-files.md' },
          { text: 'Rule MD041: the first line of a file must be a heading.', pr: '#206', label: 'feature', doc: 'docs/reference/rules.md' },
          { text: '--format json prints results as JSON for scripts and CI.', pr: '#207', label: 'feature', doc: 'docs/reference/cli.md' },
        ] },
        { label: 'Changed', lines: [
          { text: '--fix is now --write. The old flag still works and prints a warning.', pr: '#212', label: 'improvement', doc: 'README.md' },
          { text: 'Scans of large repos are about 3x faster.', pr: '#209', label: 'improvement' },
        ] },
        { label: 'Fixed', lines: [
          { text: 'A config error now exits with code 2, not 1.', pr: '#214', label: 'fix', doc: 'docs/reference/cli.md' },
        ] },
      ],
      skipped: ['skipped #216: chore, not user-facing', 'contributors dev-a, dev-b, dev-c'],
    },
  };
})();

// rowgrid.js
(() => {
  const ST = ['done', 'run', 'need', 'wait'];
  const glyph = { done: '&#10003;', run: '&#8943;', need: '', wait: '' };
  const cell = c => {
    const s = one(c.state, ST, 'wait');
    return `<div class="zro-fc zro-fc-${s}"><i class="zro-bx">${glyph[s]}</i><span class="zro-fv">${need(c.text)}</span>${c.sub ? `<span class="zro-fs">${need(c.sub)}</span>` : ''}</div>`;
  };
  const row = (r, i) => `<div class="zro-fr${r.focus ? ' zro-now' : ''}"><span class="zro-ix">${i + 1}</span><span class="zro-who"><b>${need(r.name)}</b><em>${maybe(r.sub)}</em></span>${each(r.cells, cell)}</div>`;
  KIT.rowgrid = {
    group: 'Data',
    about: 'Batch form fill: one row per submission, one cell per field with its fill state (done, running, needs you, not yet); the row in hand is marked.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/forms-form-fill-batch', file: 'r1-row-grid.html', shot: 'origin/rowgrid.png' },
    replaces: 'table',
    req: { columns: 'arr', rows: 'arr' },
    opt: { title: 'str', summary: 'str' },
    r: p => `<div class="a-rowgrid"><div class="zro-th"><span class="zro-lbl">${maybe(p.title || 'Rows')}</span><span class="zro-sm">${maybe(p.summary)}</span>
      <span class="zro-lg"><i class="zro-bx zro-s-done">&#10003;</i>done<i class="zro-bx zro-s-run">&#8943;</i>running<i class="zro-bx zro-s-need"></i>needs you<i class="zro-bx zro-s-wait"></i>not yet</span></div>
      <div class="zro-gd"><div class="zro-fr zro-hd"><span class="zro-ix">#</span><span>Name</span>${each(p.columns, c => `<span>${need(c)}</span>`)}</div>${each(p.rows, row)}</div></div>`,
    ex: {
      type: 'rowgrid', title: 'Rows', summary: '4 rows, 2/4 filled, 0/4 submitted',
      columns: ['Fill', 'Captcha', 'Submit'],
      rows: [
        { name: 'Ira Vellum', sub: 'ira@plots.example', cells: [{ text: '5 fields', sub: 'full', state: 'done' }, { text: 'none', sub: 'by you', state: 'done' }, { text: 'queued', state: 'wait' }] },
        { name: 'Bo Tamsin', sub: 'bo@plots.example', cells: [{ text: '5 fields', sub: 'full', state: 'done' }, { text: 'none', sub: 'by you', state: 'done' }, { text: 'queued', state: 'wait' }] },
        { name: 'Cass Rowan', sub: 'cass@plots.example', focus: true, cells: [{ text: '5 fields', sub: 'quarter', state: 'run' }, { text: 'shown', sub: 'press Enter', state: 'need' }, { text: 'queued', state: 'wait' }] },
        { name: 'Dee Marlow', sub: 'dee@plots.example', cells: [{ text: 'half', sub: '2026-12-01', state: 'wait' }, { text: 'not yet', state: 'wait' }, { text: 'queued', state: 'wait' }] },
      ],
    },
  };
})();

// runlog.js
(() => {
  const A = v => Array.isArray(v) ? v : [];
  const pct = v => Math.max(0, Math.min(100, Number(v) || 0));
  const dfile = f => `<div class="df"><div class="o-dh">${need(f.name)} <span class="o-ad">+${need(f.add ?? 0)}</span> <span class="dd">-${need(f.del ?? 0)}</span></div>${each(A(f.lines), l => `<div class="o-ln${String(l)[0] === '+' ? ' o-a' : String(l)[0] === '-' ? ' x' : String(l)[0] === '@' ? ' o-h' : ''}">${need(l)}</div>`)}</div>`;
  const stampOf = s => ({ done: 'done', rejected: 'rejected', approved: 'approved' })[s.stamp] ? `<span class="o-sp ${s.stamp === 'rejected' ? 'no' : 'ok'}">${need(s.stamp)}</span>` : '';
  const row = s => {
    const st = one(s.state, ['done', 'running', 'waiting', 'pending', 'rejected'], 'pending');
    return `<div class="rw s-${st}"><div class="o-rl"><span class="o-gl k-${one(s.kind, ['input', 'agent', 'gate', 'action'], 'agent')}"></span><div><div class="o-t">${need(s.title)}</div><div class="o-m">${s.kind ? `<b>${need(s.kind)}</b>` : ''}${maybe(s.sub)}</div></div><div class="rd"><span class="du">${st === 'waiting' ? 'waiting ' : ''}${maybe(s.took)}</span>${stampOf(s)}</div></div></div>`;
  };
  KIT.runlog = {
    group: 'Agent and run',
    about: 'One pipeline run as a list of steps with a header strip of run facts; the step waiting on you opens into a gate card and the right pane shows the exact action and the diff.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/coding-spec-to-pr', file: 's1-run-log.html', shot: 'shots/s1-gate.png' },
    req: { run: 'obj', steps: 'arr' },
    opt: { gate: 'obj', files: 'arr', artifacts: 'arr', follow: 'str' },
    r: p => {
      const r = p.run, g = p.gate || null, steps = p.steps;
      const done = steps.filter(s => s && s.state === 'done').length;
      const cells = steps.map(s => `<i class="${s && s.state === 'done' ? 'd' : s && s.state === 'running' ? 'r' : s && s.state === 'waiting' ? 'w' : s && s.state === 'rejected' ? 'x' : ''}"></i>`).join('');
      const fact = (k, f) => { try { return `<div class="o-fc"><span class="o-k">${k}</span><span class="o-v">${f()}</span></div>`; } catch { return ''; } };
      const files = A(p.files);
      return `<div class="a-runlog">
  <div class="sum">
    ${fact('Run', () => `<b class="rid">${need(r.id)}</b>${g ? '<span class="o-f wait">needs you</span>' : ''}`)}
    ${fact('Pipeline', () => `${need(r.pipeline)}${r.lane ? ` <span class="o-f">${need(r.lane)}</span>` : ''}`)}
    ${r.branch ? fact('Branch', () => `${need(r.branch)}${r.base ? ` <span class="o-f">into ${need(r.base)}</span>` : ''}`) : ''}
    ${fact('Elapsed', () => `${maybe(r.elapsed)}<span class="o-bar"><i style="width:${pct(r.pct)}%"></i></span>${r.budget ? `<span class="o-f">${need(r.budget)}</span>` : ''}`)}
    ${r.tokens ? fact('Tokens', () => need(r.tokens)) : ''}${r.cost ? fact('Cost', () => need(r.cost)) : ''}
    ${fact('Steps', () => `<span class="o-cells">${cells}</span><span class="o-f">${done} of ${steps.length}</span>`)}
  </div>
  <div class="bd">
    <div class="o-lt"><div class="o-sh"><h2>Steps</h2><span class="o-n">${done} of ${steps.length} done</span></div><div class="ls">${each(steps, row)}</div>
      ${A(p.artifacts).length ? `<div class="ar"><div class="o-k">Artifacts</div><div class="wr">${each(p.artifacts, a => `<span class="at">${need(a)}</span>`)}</div></div>` : ''}</div>
    <div class="o-rt">${g ? `<div class="o-rh"><span class="o-gl k-gate"></span><span class="tt">${maybe(g.title ?? 'Approval')}</span>${p.follow ? `<span class="fo">${need(p.follow)}</span>` : ''}</div>
      <div class="o-rb">${render({ type: 'gate', title: g.title, text: g.summary ?? g.title ?? 'Approval', why: [g.guards && 'guards ' + g.guards, g.hash && 'hash ' + g.hash].filter(x => typeof x === 'string').join(' · ') || 'waiting for you', action: g.action, hash: g.hash, actions: g.actions || [{ label: 'Approve', key: 'A', primary: true }, { label: 'Reject', key: 'R' }] })}
      ${files.length ? `<div class="o-k o-ch">Changes · ${files.length} files</div>${each(files, dfile)}` : ''}</div>` : `<div class="o-rb">${files.length ? `<div class="o-k o-ch">Changes · ${files.length} files</div>${each(files, dfile)}` : '<div class="em">Nothing waiting on you.</div>'}</div>`}</div>
  </div>
</div>`;
    },
    ex: {
      type: 'runlog',
      run: { id: 'run-7f3a', pipeline: 'Spec to PR', lane: 'Coding', branch: 'troop/greet', base: 'main', elapsed: '6m 41s', budget: '120m', pct: 5.5, tokens: '41,870', cost: '$0.36' },
      steps: [
        { title: 'Run inputs', kind: 'input', state: 'done', sub: 'Add a greet(name) function that returns "Hello, name!"', took: '14:02' },
        { title: 'Write the spec', kind: 'agent', state: 'done', sub: 'claude · spec.md', took: '1m 12s', stamp: 'done' },
        { title: 'Approve the spec', kind: 'gate', state: 'done', sub: 'by you · "Looks right."', took: '38s', stamp: 'approved' },
        { title: 'Build it on a new branch', kind: 'agent', state: 'done', sub: 'claude · 2 files, 1 commit', took: '3m 05s', stamp: 'done' },
        { title: 'Run the tests', kind: 'action', state: 'done', sub: '2 passed', took: '4s', stamp: 'done' },
        { title: 'Approve opening the pull request', kind: 'gate', state: 'waiting', sub: 'guards open-pr', took: '0s' },
        { title: 'Push and open the pull request', kind: 'action', state: 'pending', sub: 'publish' },
      ],
      gate: { title: 'Approve opening the pull request', summary: 'Open a pull request on acme/shopfront from troop/greet into main. Tests passed: true.', action: 'git push origin troop/greet && gh pr create --base main', hash: 'a91c…e04', guards: 'open-pr' },
      follow: 'Follow the run',
      files: [
        { name: 'index.js', add: 3, del: 0, lines: ['@@ -1,3 +1,6 @@', ' export function add(a, b) {', '   return a + b;', ' }', '+export function greet(name) {', '+  return `Hello, ${name}!`;', '+}'] },
        { name: 'test.js', add: 2, del: 1, lines: ['@@ -1,5 +1,6 @@', "-import { add } from './index.js';", "+import { add, greet } from './index.js';", " assert.equal(add(2, 3), 5);", "+assert.equal(greet('Ada'), 'Hello, Ada!');"] },
      ],
      artifacts: ['spec.md', 'diff +5 -1', 'build log', 'test output', 'gate a91c…e04'],
    },
  };
})();

// screening.js
(() => {
  const n = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
  const LEAF = 'M0 0 C-13 -3 -20 -19 -9 -31 C-3 -37 7 -36 11 -28 C19 -16 12 -3 0 0Z';
  const SLIT = 'M-6 -9 L-14 -12 M-5 -18 L-14 -22 M5 -10 L12 -14 M5 -20 L12 -25';
  const plant = '<svg class="zsvg" viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect class="zw" width="160" height="62"/><rect class="zwd" x="10" y="8" width="34" height="40"/><path class="zwl" d="M27 8 V48 M10 28 H44"/><rect class="zsh" x="118" y="24" width="32" height="2"/><rect class="ztab2" y="62" width="160" height="28"/><path class="zedge" d="M0 62 H160"/>'
    + '<path class="zsm" d="M80 52 L68 36 M80 52 L80 30 M80 52 L94 34"/>'
    + [[68, 36, -32, .8], [80, 30, 4, 1], [94, 34, 34, .9]].map(([x, y, r, o]) => `<g transform="translate(${x} ${y}) rotate(${r}) scale(.75)" opacity="${o}"><path class="zlv" d="${LEAF}"/><path class="zsx" d="${SLIT}"/></g>`).join('')
    + '<path class="zpo" d="M62 56 H98 L94 80 H66 Z"/><rect class="zrm" x="59" y="52" width="42" height="6"/><ellipse class="zsoil" cx="80" cy="55" rx="19" ry="2"/></svg>';
  const wheel = '<svg class="zsvg" viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect class="zw" width="160" height="58"/><rect class="zwd" x="112" y="10" width="34" height="30"/><rect class="zsh" x="10" y="20" width="40" height="2"/><rect class="zsh" x="10" y="34" width="40" height="2"/>'
    + '<path class="zpo" d="M20 14 h8 v6 h-8z M34 13 h7 v7 h-7z M14 29 h10 v5 h-10z"/><rect class="ztab2" y="58" width="160" height="32"/><path class="zedge" d="M0 58 H160"/>'
    + '<ellipse class="zpo" cx="80" cy="72" rx="44" ry="9"/><ellipse class="zsoil" cx="80" cy="70" rx="38" ry="6"/><ellipse class="zrm" cx="80" cy="66" rx="24" ry="4"/>'
    + '<path class="zlv" d="M71 66 C63 61 61 50 67 44 C71 40 74 37 74 31 C74 28 72 27 72 26 H88 C88 27 86 28 86 31 C86 37 89 40 93 44 C99 50 97 61 89 66 Z"/><ellipse class="zsoil" cx="80" cy="26" rx="8" ry="1.4"/><path class="zsx" d="M65 52 C75 54 85 54 95 52 M64 58 C75 60 85 60 96 58"/>'
    + '<path class="zpo" d="M40 46 C50 44 58 46 64 50 L63 56 C55 54 47 56 38 58 Z M120 46 C110 44 102 46 96 50 L97 56 C105 54 113 56 122 58 Z"/></svg>';
  const fm = (scene, cap, ratio) => {
    const s = one(scene, ['a', 'b', 'c'], 'a');
    const body = s === 'b' ? '<i class="zrb"></i><i class="zrt"></i><i class="zh1"><b></b><b></b><b></b><b></b></i><i class="zh2"><b></b><b></b><b></b><b></b></i>' : s === 'c' ? wheel : plant;
    return `<div class="zfm${ratio === '9/16' ? ' zv' : ''}"><div class="zsc zs-${s}">${body}</div>${cap ? `<span class="zcp">${need(cap)}</span>` : ''}</div>`;
  };
  const bars = (c, seed) => Array.from({ length: c }, (_, i) => `<i style="height:${Math.round(12 + 76 * Math.abs(Math.sin(i * .83 + seed) * Math.sin(i * .21 + 1)))}%"></i>`).join('');
  const note = nt => {
    const st = one(nt.state, ['plain', 'fixed', 'open'], 'plain');
    return `<div class="znt z${st}"><span class="zby">${need(nt.by)}</span><div class="znb"><div class="znh"><span class="ztc">${need(nt.at)}</span><span class="zsr">${maybe(nt.src)}</span>${st === 'fixed' ? '<span class="zstp">Fixed</span>' : st === 'open' ? '<span class="zstp zhot">Left for you</span>' : ''}</div>
      <div class="ztx">${need(nt.text)}</div>${st === 'open' && nt.choices ? `<div class="zch">${each(nt.choices, c => `<button class="btn">${need(c)}</button>`)}</div>` : ''}</div></div>`;
  };
  KIT.screening = {
    group: 'Workspaces',
    about: 'Screening room: a player with a waveform scrub bar and reviewer markers, a transport row, and a notes column where each note is fixed or left for you.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/video-footage-to-edit', file: 'r2-screening.html', shot: 'check/r2-gate.png' },
    req: { notes: 'arr', length: 'num' },
    opt: { ratio: 'str', tabs: 'arr', meta: 'str', playhead: 'num', time: 'str', total: 'str', caption: 'str', scene: 'str', stats: 'str', around: 'obj', input: 'str' },
    r: p => {
      const len = Math.max(1, Number(p.length) || 1);
      const px = p.playhead != null ? (n(p.playhead, 0, len) / len * 100).toFixed(2) : null;
      const tabs = each(p.tabs || [], t => `<span class="ztab${t.on === true ? ' zon' : ''}"><b>${need(t.label)}</b><i>${maybe(t.sub)}</i></span>`);
      const mk = each(p.notes, nt => `<i class="zmk z${one(nt.state, ['plain', 'fixed', 'open'], 'plain')}" style="left:${(n(nt.sec, 0, len) / len * 100).toFixed(2)}%"><b></b><em>${need(nt.by)}</em></i>`);
      const open = p.notes.filter(x => x && x.state === 'open').length;
      const ar = p.around;
      const around = ar ? `<div class="zar"><div class="zah"><span class="zlb">${maybe(ar.label)}</span><span>${maybe(ar.range)}</span></div><div class="zfs">${[0, 1, 2, 3, 4].map(i => `<div class="zfr">${fm(p.scene)}</div>`).join('')}<i class="zcut"></i></div><div class="zwv2">${bars(70, 3)}<i class="zcut"></i></div></div>` : '';
      return `<div class="a-screening"><div class="zpl">
        <div class="ztbar">${tabs}<span class="zmt">${maybe(p.meta)}</span></div>
        <div class="zstg">${fm(p.scene, p.caption, p.ratio)}</div>
        <div class="zsc2"><div class="zwv">${bars(190, 0)}</div>${mk}${px ? `<i class="zph" style="left:${px}%"></i>` : ''}</div>
        <div class="zctl"><span class="zpb"></span><span class="zbig"><b>${maybe(p.time)}</b><i>${p.total ? '/ ' + need(p.total) : ''}</i></span><span class="zkh"><kbd>J</kbd><kbd>K</kbd><kbd>L</kbd> scrub <kbd>Space</kbd> play</span><span class="zstt">${maybe(p.stats)}</span></div>
      </div><div class="znl"><div class="znlh"><span class="zlbl">Notes</span><span class="zct">${p.notes.length}${open ? ` &middot; ${open} open` : ''}</span></div>
        <div class="znls">${each(p.notes, note)}</div>${around}${p.input ? `<div class="zinp"><span class="zyou">you</span><span class="zit">${need(p.input)}</span><kbd>N</kbd></div>` : ''}</div></div>`;
    },
    ex: {
      type: 'screening', length: 118, playhead: 69.6, time: '1:09.6', total: '1:58.4', caption: 'below the rim, and set', stats: '46 captions · music ducked -12 db',
      meta: 'out/final.mp4 · 1920x1080 · 30 fps · 41.2 MB', input: 'Note at 1:09.6',
      tabs: [{ label: 'rough', sub: 'edit pass 1' }, { label: 'final', sub: 'edit pass 2', on: true }, { label: '9:16', sub: 'centre crop' }],
      around: { label: 'c28 · 3 s around the cut', range: '1:08.1 to 1:11.1' },
      notes: [
        { at: '0:21.4', sec: 21.4, by: 'VC', src: 'visual-check', text: 'c07 jump cut, punched in to 110%', state: 'fixed' },
        { at: '0:47.9', sec: 47.9, by: 'VC', src: 'visual-check', text: 'c19 clipped "So", boundary +60 ms', state: 'fixed' },
        { at: '1:09.6', sec: 69.6, by: 'VC', src: 'visual-check', text: 'c28 breath cut, sentence runs on. Keep the breath or keep the cut?', state: 'open', choices: ['keep the cut', 'keep the breath +0.4 s'] },
        { at: '1:21.2', sec: 81.2, by: 'VC', src: 'visual-check', text: 'c33 pop at the cut, fade added', state: 'fixed' },
        { at: '1:44.6', sec: 104.6, by: 'ED', src: 'edit', text: 'laugh kept as the plan said' },
      ],
    },
  };
})();

// sessionsplit.js
(() => {
  const obj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const gate = g => obj(g) ? render({ type: 'gate', title: g.name, text: g.text, why: g.why ?? 'needs your decision', aside: g.aside, actions: g.actions, action: g.action, hash: g.hash }) : '';
  const msg = m => m.kind === 'you'
    ? `<div class="mg you2"><span class="mk2">You</span>${need(m.text)}</div>`
    : `<div class="mg"><div class="mh"><i class="${m.done === true ? 'ok2' : ''}"></i><span class="mk2">${need(m.label)}</span><span class="mt2">${maybe(m.took)}</span></div>${need(m.text)}${m.stamp ? `<span class="stp">${need(m.stamp)}</span>` : ''}</div>`;
  const pane = e => `<div class="pn"><div class="eh"><span class="en">${need(e.engine)}</span><span class="em">${maybe(e.model)}</span><span class="tk">${maybe(e.tokens)}</span><span class="vd v-${one(e.verdict, ['approve', 'reject', 'notes'], 'notes')}">${need(e.verdict)}</span></div>
    <div class="lg2">${each(e.lines, l => `<div>${need(l)}</div>`)}</div></div>`;
  const fnd = f => `<div class="fd"><i class="bx2"></i><span class="id">${need(f.id)}</span><div class="fb"><b>${need(f.title)}</b><span class="wh2">${maybe(f.where)}</span><div class="ftz">${maybe(f.text)}</div></div><span class="bk">${maybe(f.bucket)}</span><span class="svz">${maybe(f.severity)}</span></div>`;
  KIT.sessionsplit = {
    group: 'Agent and run',
    about: 'A chat-style step column on the left, a plan checklist and tabbed workspace on the right: two engines side by side, then the findings you tick.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/coding-spec-build-review-handback', file: 'r3-session-split.html', shot: 'r3-session-split-pick.png' },
    req: { messages: 'arr', plan: 'obj', tabs: 'arr', engines: 'arr' },
    opt: { title: 'str', sub: 'str', active: 'num', gate: 'obj', findings: 'arr', worktree: 'str' },
    r: p => {
      const n = Math.max(0, Math.min(p.tabs.length - 1, Math.floor(Number(p.active)) || 0));
      const items = Array.isArray(p.plan.items) ? p.plan.items : [];
      const done = items.filter(x => x === true).length;
      return `<div class="a-sessionsplit"><div class="chat"><div class="ch2">${maybe(p.title || 'Session')} <span>${maybe(p.sub)}</span></div>
        <div class="ms2">${each(p.messages, msg)}</div>${gate(p.gate)}</div>
        <div class="workz"><div class="pl"><div class="plh"><span class="lbl">Plan</span> ${done}/${items.length}</div><div class="pg">${items.map(x => `<i class="${x === true ? 'on2' : ''}"></i>`).join('')}</div></div>
        <div class="tbz">${each(p.tabs, (t, i) => `<span class="${i === n ? 'on2' : ''}">${need(t)}</span>`)}<em>${maybe(p.worktree)}</em></div>
        <div class="pns">${each(p.engines, pane)}</div>
        ${Array.isArray(p.findings) ? `<div class="fds">${each(p.findings, fnd)}</div>` : ''}</div></div>`;
    },
    ex: {
      type: 'sessionsplit', title: 'Session', sub: 'loop · tidy-cli', active: 3, worktree: '.worktrees/run-5b1d',
      plan: { items: [true, true, true, true, true, true, true, false, false, false] },
      tabs: ['Spec', 'Terminal', 'Diff', 'Review', 'Hand-back'],
      messages: [
        { kind: 'you', text: 'Add a --dry-run flag to tidy clean that lists what would be removed and removes nothing.' },
        { label: 'Spec', took: '1m 40s', done: true, text: 'I read the repo and wrote spec.md with 3 acceptance checks.' },
        { label: 'Gate approve-spec', took: '2m 05s', done: true, text: 'Approved. Build it.', stamp: 'Approved' },
        { label: 'Build', took: '4m 22s', done: true, text: 'Built it test first on mt/loop-run-5b1d. 3 files staged, not committed.' },
        { label: 'Verify', took: '3s', done: true, text: 'node --test: 6 pass, exit 0.' },
        { label: 'Review x2', took: '2m 31s', done: true, text: 'Both engines answered: codex reject, gemini approve. Neither wins.' },
      ],
      gate: { name: 'pick-fixes', text: 'Tick the findings to fix. Unticked findings go to your hand-back list; nothing is dismissed.', action: 'fix (tick findings) on mt/loop-run-5b1d', hash: '#7d2e48b1', actions: [{ label: 'Fix the ticked findings', key: 'F', primary: true }, { label: 'Reject', key: 'R' }] },
      engines: [
        { engine: 'Codex', model: 'GPT-5.6', tokens: '27,480 tok', verdict: 'reject', lines: ['read diff (3 files, 64 lines)', 'clean.js:42 removeEmptyDirs still runs under --dry-run', 'no test covers --dry-run with --force', 'verdict: reject (2 findings)'] },
        { engine: 'Gemini', model: 'Gemini 3.8 Flash', tokens: '24,910 tok', verdict: 'approve', lines: ['read diff (3 files, 64 lines)', 'clean.js:42 empty folders are pruned even when dry', '--help text does not list --dry-run', 'verdict: approve (2 findings)'] },
      ],
      findings: [
        { id: 'B1', title: 'Dry run still removes empty folders', where: 'src/commands/clean.js:40-45', text: 'removeEmptyDirs runs after the loop whatever the flag, so --dry-run deletes empty folders.', bucket: 'both', severity: 'high' },
        { id: 'C1', title: 'No test for --dry-run with --force', where: 'test/clean-dry-run.test.js:1-31', text: '--force widens the match set; nothing proves the dry listing honours it.', bucket: 'codex only', severity: 'medium' },
        { id: 'G1', title: 'Help text does not mention --dry-run', where: 'src/cli.js:19', text: 'The README lists it but tidy clean --help does not.', bucket: 'gemini only', severity: 'low' },
      ],
    },
  };
})();

// sitepages.js
(() => {
  const KINDS = ['hero', 'text', 'grid', 'list', 'form', 'price', 'map', 'footer'];
  const mini = k => ({
    hero: '<i class="spw"></i><i class="sphf"></i>', text: '<i></i><i></i><i class="sps"></i>', grid: '<i class="spq"></i><i class="spq"></i><i class="spq"></i>',
    list: '<i></i><i></i><i></i>', form: '<i class="spf"></i><i class="spf"></i><i class="spb"></i>', price: '<i class="spp"></i><i class="spp sphi"></i><i class="spp"></i>',
    map: '<i class="spm"></i>', footer: '<i class="sps"></i><i class="sps"></i>',
  }[k]);
  const sec = s => {
    const k = one(s.kind, KINDS, 'text');
    return `<div class="spsc${s.sel === true ? ' spsel' : ''}${s.added === true ? ' spadd' : ''}${s.hidden === true ? ' sphid' : ''}"><span class="spg">⋮⋮</span><span class="spmn k-${k}">${mini(k)}</span><span class="spnm">${need(s.name)}</span>${s.added === true ? '<span class="sptg">new</span>' : ''}${s.hidden === true ? '<span class="sptg">hidden</span>' : ''}${s.note ? `<span class="spnt">${need(s.note)}</span>` : ''}</div>`;
  };
  KIT.sitepages = {
    group: 'Workspaces',
    about: 'The outline of a website being built: its pages, and each page\'s sections in order, with a small sketch of each section\'s layout and room to add one.',
    origin: { folder: 'new for H4 (persona: website)', file: 'no MetaTrooper source; drawn for the website-builder workspace' },
    replaces: 'tree',
    req: { site: 'str', pages: 'arr' },
    opt: { domain: 'str', state: 'str' },
    r: p => {
      const pages = each(p.pages, pg => {
        const open = pg.open === true;
        return `<div class="sppg${open ? ' spopen' : ''}"><div class="spph"><span class="spar">${open ? '▾' : '▸'}</span><span class="sppn">${need(pg.name)}</span><span class="sppp">${maybe(pg.path)}</span>${Array.isArray(pg.sections) ? `<span class="spct">${pg.sections.length}</span>` : ''}</div>${open && Array.isArray(pg.sections) ? `<div class="spss">${each(pg.sections, sec)}<div class="spad">+ Add section</div></div>` : ''}</div>`;
      });
      return `<div class="a-sitepages"><div class="sphd"><span class="splb">Pages</span><span class="spsn">${need(p.site)}</span></div>${p.domain ? `<div class="spdm"><span>${need(p.domain)}</span>${p.state ? `<span class="spstp">${need(p.state)}</span>` : ''}</div>` : ''}<div class="spls">${pages}<div class="spad sppa">+ Add page</div></div></div>`;
    },
    ex: {
      type: 'sitepages', site: 'Rye & Crumb bakery', domain: 'ryeandcrumb.example', state: 'draft',
      pages: [
        { name: 'Home', path: '/', open: true, sections: [
          { name: 'Hero', kind: 'hero', note: 'photo + 1 line' }, { name: 'Today\'s bread', kind: 'grid', sel: true },
          { name: 'Pricing', kind: 'price', added: true }, { name: 'Opening hours', kind: 'list' },
          { name: 'Find us', kind: 'map' }, { name: 'Footer', kind: 'footer' }] },
        { name: 'Pre-order', path: '/order', sections: [{ name: 'Order form', kind: 'form' }, { name: 'Footer', kind: 'footer' }] },
        { name: 'Our story', path: '/story', sections: [{ name: 'Text', kind: 'text' }] },
      ],
    },
  };
})();

// slidenote.js
(() => {
  const bullet = b => `<div class="zsl-bl${b.hit ? ' hit' : ''}"><i class="zsl-dot"></i>${need(b.text)}</div>`;
  const note = (n, i) => `<div class="zsl-nt${n.hot ? ' zsl-hot' : ''}"><span class="zsl-nn">${need(n.n)}</span>${n.mark ? `<i class="zsl-mk">${need(n.mark)}</i>` : ''}<span class="zsl-nx">${need(n.text)}</span><span class="zsl-np">${maybe(n.cite)}</span><span class="zsl-nm">${maybe(n.meta)}</span>${n.was ? `<span class="zsl-was">${need(n.was)}</span>` : ''}</div>`;
  KIT.slidenote = {
    group: 'Review and documents',
    about: 'A lecture slide beside the note lines written from it, joined by dotted connectors from each slide bullet to its note; a rewritten line shows what it was.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/study-study-notes-to-pdf', file: 'r2-slide-and-note.html', shot: 'origin/slidenote.png' },
    req: { slide: 'obj', notes: 'arr' },
    opt: { title: 'str' },
    r: p => `<div class="a-slidenote"><div class="zsl-bf"><div class="zsl-hd"><span class="zsl-lbl">Before</span><span class="zsl-sm">${maybe(p.slide.meta)}</span></div>
      <div class="zsl-sl"><span class="zsl-sn">${maybe(p.slide.num)}</span><div class="zsl-stt">${maybe(p.slide.title || 'Untitled slide')}</div>${each(Array.isArray(p.slide.bullets) ? p.slide.bullets : [], bullet)}<div class="zsl-ft">${maybe(p.slide.foot)}</div></div></div>
      
      <div class="zsl-af"><div class="zsl-hd"><span class="zsl-lbl">After</span><span class="zsl-sm">${maybe(p.title || '')}</span></div>${each(p.notes, note)}</div></div>`,
    ex: {
      type: 'slidenote', title: '2 lines cite slide 9',
      slide: { num: 9, meta: 'slide 9/18', title: 'SRAM and DRAM', foot: 'Lecture 6: how caches work',
        bullets: [{ text: 'SRAM: fast, costs more per bit, used for caches', hit: true }, { text: 'DRAM: slower, cheaper per bit, denser, used for main memory', hit: true }] },
      notes: [
        { n: 12, text: 'Caches use SRAM: fast, but it costs more per bit.', cite: 'p.9', meta: 'rewritten from bullet 1', mark: 'RW', hot: true, was: 'SRAM is about 10x cheaper per bit than DRAM.' },
        { n: 13, text: 'Main memory uses DRAM: slower, cheaper per bit and denser.', cite: 'p.9', meta: 'matches bullet 2' },
      ],
    },
  };
})();

// spechinge.js
(() => {
  const sect = s => `<div class="sc"><div class="sl">${need(s.label)}</div>${each(Array.isArray(s.lines) ? s.lines : [], l => `<div class="ln2">${need(l)}</div>`)}</div>`;
  const chk = c => `<div class="ckz ${c.met === true ? 'met' : 'open'}"><i></i><span class="tx">${need(c.text)}</span><span class="by2">${maybe(c.by)}</span></div>`;
  const phase = ph => `<div class="ph2 ph-${one(ph.state, ['done', 'cur', 'needs', 'todo'], 'todo')}"><i class="bx2"></i><span class="pn">${need(ph.label)}</span><span class="ptz">${maybe(ph.text)}</span><span class="pk">${maybe(ph.took)}</span></div>`;
  KIT.spechinge = {
    group: 'Review and documents',
    about: 'A spec on the left and the run on the right, split at a hinge: acceptance checks tick as phases pass, and the approval gate sits under the spec.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/coding-spec-build-review-handback', file: 'r2-spec-hinge.html', shot: 'r2-spec-hinge-handback.png' },
    req: { spec: 'obj', phases: 'arr' },
    opt: { hinge: 'str', gate: 'obj' },
    r: p => {
      const s = p.spec, g = p.gate;
      const arr = v => Array.isArray(v) ? v : [];
      const checks = arr(s.checks);
      const met = checks.filter(c => c && c.met === true).length;
      const gate = g && typeof g === 'object' && !Array.isArray(g) ? render({ type: 'gate', title: g.name, text: g.text, why: g.why ?? 'needs your decision', aside: g.aside, actions: g.actions, action: g.action, hash: g.hash }) : '';
      return `<div class="a-spechinge"><div class="doc"><div class="dh2"><span class="lbl">${maybe(s.file || 'spec.md')}</span><span class="mt2">${met}/${checks.length} checks met${s.meta ? ' · ' + need(s.meta) : ''}</span></div>
        ${s.asked != null ? `<div class="asked"><span class="sl">You asked</span>${maybe(s.asked)}</div>` : ''}
        ${s.title != null ? `<div class="ti">${maybe(s.title)}</div>` : ''}${each(arr(s.sections), sect)}
        <div class="sc"><div class="sl">Acceptance checks</div>${each(checks, chk)}</div>${gate}</div>
        <div class="hinge"><i class="nd"></i><span class="hl">${maybe(p.hinge || '')}</span></div>
        <div class="run2">${each(p.phases, phase)}</div></div>`;
    },
    ex: {
      type: 'spechinge', hinge: 'approved by you · #a1f0c93e',
      gate: { name: 'hand-back', text: 'Stage the 3 files for your commit. Nothing is committed or pushed.', why: 'commit and push are yours', action: 'git add src/commands/clean.js src/cli.js test/clean-dry-run.test.js', hash: '#a1f0c93e', actions: [{ label: 'Stage files', key: 'S', primary: true }, { label: 'Reject', key: 'R' }] },
      spec: {
        file: 'spec.md', meta: '1m 40s, 9,210 tok', asked: 'Add a --dry-run flag to tidy clean that lists what would be removed and removes nothing.', title: 'Add --dry-run to tidy clean',
        sections: [
          { label: 'Goal', lines: ['tidy clean --dry-run prints every path that tidy clean would remove, and removes nothing.'] },
          { label: 'Non-goals', lines: ['No change to what tidy clean removes without the flag.', 'No interactive confirm prompt.'] },
          { label: 'Behaviour', lines: ['Each path on its own line, prefixed would remove.', 'A last line: N paths, X KB, nothing removed.', 'Exit 0 when the listing succeeds.'] },
        ],
        checks: [
          { text: 'A test proves no file or folder is gone after --dry-run.', met: true, by: 'met by fix' },
          { text: 'The listing matches what a real run removes.', met: true, by: 'met by build' },
          { text: 'tidy clean --help mentions --dry-run.', met: true, by: 'met by fix' },
        ],
      },
      phases: [
        { label: 'Build', text: '3 files staged, not committed', took: '4m 22s', state: 'done' },
        { label: 'Verify', text: 'node --test: 6 pass, exit 0', took: '3s', state: 'done' },
        { label: 'Review x2', text: 'codex reject, gemini approve, 3 findings', took: '2m 31s', state: 'done' },
        { label: 'Pick fixes', text: 'fixing B1, G1, 1 to you', took: '1m 10s', state: 'done' },
        { label: 'Fix', text: '2 fixed, 7 pass, restaged', took: '1m 49s', state: 'done' },
        { label: 'Hand back', text: '4 of 4 for you', took: '0s', state: 'needs' },
      ],
    },
  };
})();

// startagent.js
(() => {
  KIT.startagent = {
    group: 'Input and actions',
    about: 'The empty-wall start form: how much to ask before each tool call (a two-way choice), then numbered steps: folder, agent, an optional task, Start.',
    origin: { folder: 'ouros-fiveshot-2026-10-30', file: 'now/01-start-empty.png (start form)', shot: 'now/01-start-empty.png' },
    req: { folder: 'str', agents: 'arr' },
    opt: { path: 'str', modes: 'arr', mode: 'num', agent: 'num', placeholder: 'str' },
    r: p => `<div class="a-startagent">${p.modes ? `<b class="h">Before each tool call</b><div class="md">${each(p.modes, (m, i) => `<span class="bt2${i === (p.mode ?? 0) ? ' on' : ''}">${need(m)}</span>`)}</div>` : ''}
      <b class="h">Start an agent</b><ol><li class="dim">Folder: <b>${esc(p.folder)}</b> <span>${maybe(p.path)}</span></li>
      <li>Agent: ${each(p.agents, (a, i) => `<span class="bt2${i === p.agent ? ' on' : ''}">${need(a)}</span>`)}</li>
      <li>Task (optional):<div class="ta">${esc(p.placeholder || 'What should it do? Leave empty to just open it.')}</div><span class="go">Start</span></li></ol></div>`,
    ex: { type: 'startagent', folder: 'linkkit', path: '~/demo/linkkit', agents: ['claude', 'codex', 'gemini'], modes: ['Ask before each tool call (recommended)', 'Auto mode in Ouros worktrees'], mode: 0, agent: 0 },
  };
})();

// stockshelf.js
(() => {
  const n = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
  KIT.stockshelf = {
    group: 'Workspaces',
    about: 'Stock on hand for a small shop: one bar per item with a reorder notch, items under the notch marked low, and how long each lasts at this week\'s pace.',
    origin: { folder: 'new for H4 (persona: shop owner)', file: 'no MetaTrooper source; drawn for the shop workspace' },
    replaces: 'meter',
    req: { items: 'arr' },
    opt: { title: 'str' },
    r: p => {
      const rows = each(p.items, it => {
        const max = n(it.max, 1, 1e9), have = n(it.have, 0, max), at = n(it.reorder, 0, max);
        const low = have <= at;
        return `<div class="ssr${low ? ' sslow' : ''}"><div class="ssh"><span class="ssn">${need(it.name)}</span>${low ? '<span class="sstag">low</span>' : ''}<span class="ssv">${esc(have.toLocaleString('en-AU'))} of ${esc(max.toLocaleString('en-AU'))} ${maybe(it.unit)}</span></div>
<div class="ssbar"><i style="width:${(have / max * 100).toFixed(1)}%"></i><b style="left:${(at / max * 100).toFixed(1)}%"></b></div>
<div class="ssf"><span>${maybe(it.lasts)}</span>${low ? `<span class="ssbtn">${maybe(it.action || 'Reorder')}</span>` : ''}</div></div>`;
      });
      return `<div class="a-stockshelf"><div class="sshd"><span class="sslb">${maybe(p.title || 'Stock')}</span><span class="sskey"><b></b>reorder at</span></div>${rows}</div>`;
    },
    ex: {
      type: 'stockshelf', title: 'Stock',
      items: [
        { name: 'Flour', have: 18, max: 100, reorder: 30, unit: 'kg', lasts: 'runs out Thursday', action: 'Order from Marta' },
        { name: 'Butter', have: 9, max: 40, reorder: 10, unit: 'kg', lasts: 'lasts to Friday' },
        { name: 'Eggs', have: 60, max: 360, reorder: 90, unit: 'eggs', lasts: 'lasts to Saturday', action: 'Order from Joe' },
        { name: 'Sugar', have: 34, max: 50, reorder: 12, unit: 'kg', lasts: 'about 2 weeks' },
      ],
    },
  };
})();

// takecards.js
(() => {
  const n = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
  const fm = scene => {
    const s = one(scene, ['a', 'b'], 'a');
    const body = s === 'b' ? '<i class="zrb"></i><i class="zrt"></i><i class="zh1"><b></b><b></b><b></b><b></b></i><i class="zh2"><b></b><b></b><b></b><b></b></i>'
      : '<i class="zwn"></i><i class="zsf"></i><i class="zpe"><b class="ztr"></b><b class="zhd"></b></i><i class="ztb"></i><i class="zpt"><b class="zlf za"></b><b class="zlf zb"></b><b class="zlf zc"></b></i>';
    return `<div class="zfm"><div class="zsc zs-${s}">${body}</div></div>`;
  };
  const card = t => {
    const len = Math.max(1, Number(t.len) || 1);
    const v = one(t.verdict, ['kept', 'partly', 'dropped'], 'kept');
    const kept = each(t.kept || [], k => `<i class="zkp" style="left:${(n(k[0], 0, len) / len * 100).toFixed(2)}%;width:${((n(k[1], 0, len) - n(k[0], 0, len)) / len * 100).toFixed(2)}%"></i>`);
    const sw = t.swap ? `<i class="zswp" style="left:${(n(t.swap.from, 0, len) / len * 100).toFixed(2)}%;width:${((n(t.swap.to, 0, len) - n(t.swap.from, 0, len)) / len * 100).toFixed(2)}%"><span>${need(t.swap.label)}</span></i>` : '';
    return `<div class="zcard zv-${v}"><div class="zth">${fm(t.scene)}<span class="ztag">${need(t.name)}</span><span class="zstmp">${v === 'kept' ? 'Kept' : v === 'partly' ? 'Partly' : 'Dropped'}</span></div>
      <div class="zbd"><div class="zhdr"><b>${need(t.name)}.mp4</b><span>${maybe(t.dur)}</span></div>
        <div class="zmt"><span>${maybe(t.spec)}</span><span>${t.peak ? 'peak ' + need(t.peak) : ''}</span></div>
        <div class="zkbar">${kept}${sw}</div>
        <div class="zkl">${maybe(t.keptText)}</div><div class="znt">${maybe(t.note)}</div><div class="zat">${t.at ? 'in the programme at <b>' + need(t.at) + '</b>' : ''}</div></div></div>`;
  };
  KIT.takecards = {
    group: 'Workspaces',
    about: 'Take cards: one card per raw take with a drawn frame, its specs, a dithered keep bar (kept spans filled, swapped-out span dashed) and a kept, partly or dropped stamp.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/video-footage-to-edit', file: 'r4-take-cards.html', shot: 'check/r4-gate.png' },
    req: { takes: 'arr' },
    opt: { title: 'str', sub: 'str' },
    r: p => `<div class="a-takecards"><div class="zhh"><span class="zlbl">${maybe(p.title || 'The takes')}</span><span class="zsub">${maybe(p.sub)}</span></div><div class="zgrid">${each(p.takes, card)}</div></div>`,
    ex: {
      type: 'takecards', title: 'The takes', sub: '3 takes · 3:00 in · 1:58.4 out',
      takes: [
        { name: 'take-01', dur: '1:12.0', spec: '1920x1080 30 fps -19.2 LUFS', peak: '-2.8 dB', len: 72, kept: [[0, 22], [34, 72]], swap: { from: 22, to: 34, label: 'swapped out' }, keptText: '41.6 s kept of 72 s', note: 'intro and steps 1 to 2; 0:31 to 0:58 has three restarts', at: '0:00.0 and 1:01.0', scene: 'a', verdict: 'partly' },
        { name: 'take-02', dur: '0:41.0', spec: '1920x1080 30 fps -18.6 LUFS', peak: '-3.4 dB', len: 41, kept: [[6, 41]], keptText: '31.6 s kept of 41 s', note: 'retake of the roots section', at: '0:29.4', scene: 'b', verdict: 'kept' },
        { name: 'take-03', dur: '1:07.0', spec: '1920x1080 30 fps -19.8 LUFS', peak: '-3 dB', len: 67, kept: [[0, 45]], keptText: '45.2 s kept of 67 s', note: 'soil, watering and outro', at: '1:13.2', scene: 'a', verdict: 'kept' },
        { name: 'take-04', dur: '0:18.0', spec: '1920x1080 30 fps -21.1 LUFS', peak: '-6 dB', len: 18, kept: [], keptText: '0 s kept of 18 s', note: 'phone rang; nothing usable', at: 'not used', scene: 'a', verdict: 'dropped' },
      ],
    },
  };
})();

// tracestrip.js
(() => {
  const ST = ['ok', 'fail', 'run'];
  const gl = s => `<i class="gl g-${one(s, ST, 'run')}"></i>`;
  const page = pg => pg ? `<div class="pg"><b class="h">${maybe(pg.h)}</b><span class="in">${maybe(pg.field)}</span><span class="bt">${maybe(pg.button || 'Add')}</span>${each(pg.items || [], x => `<span class="li">${need(x)}</span>`)}<span class="ct">${maybe(pg.count)}</span></div>` : '<div class="pg blank"></div>';
  const frame = f => `<div class="fr${f.on === true ? ' on' : ''} s-${one(f.state, ST, 'ok')}">
    <div class="bw"><div class="bb"><i></i><i></i><i></i></div><div class="vp">${page(f.page)}${f.state === 'fail' ? '<span class="xm">x</span>' : ''}</div></div>
    <div class="lb">${gl(f.state)}<span class="vb">${need(f.verb)}</span><span class="tm">${maybe(f.t)}</span></div></div>`;
  KIT.tracestrip = {
    group: 'Agent and run',
    about: 'Film strip of a browser QA run: one group per flow, a drawn page thumbnail per step with its action and time, failed steps marked, the current frame outlined.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/coding-e2e-browser-qa', file: 'r1-trace.html', shot: 'film strip (top row)' },
    req: { flows: 'arr' },
    opt: { title: 'str', sub: 'str', meta: 'str' },
    r: p => {
      const n = p.flows.reduce((a, f) => a + (Array.isArray(f && f.frames) ? f.frames.length : 0), 0);
      return `<div class="a-tracestrip"><div class="hd"><span class="k">${maybe(p.title || 'Film strip')}</span><span class="n"><b>${n}</b> frames</span><span class="n">${maybe(p.sub)}</span><span class="n">${maybe(p.meta)}</span></div>
        <div class="grp">${each(p.flows, f => `<div class="fl"><div class="fh">${gl(f.state)}<span class="k">${need(f.label)}</span><span class="ft">${need(f.title)}</span></div><div class="rowxtr">${each(f.frames, frame)}</div></div>`)}</div></div>`;
    },
    ex: {
      type: 'tracestrip', title: 'Film strip', sub: 'walk + re-walk', meta: '127.0.0.1:4317',
      flows: [
        { label: 'Flow 1', title: 'Add an item', state: 'fail', frames: [
          { verb: 'goto /', t: '00:02', state: 'ok', page: { h: 'Shopping list', field: '', count: '0 items' } },
          { verb: 'click Item', t: '00:04', state: 'ok', page: { h: 'Shopping list', field: '', count: '0 items' } },
          { verb: 'type "milk"', t: '00:06', state: 'ok', page: { h: 'Shopping list', field: 'milk', count: '0 items' } },
          { verb: 'click Add', t: '00:08', state: 'fail', on: true, page: { h: 'Shopping list', field: 'milk', count: '0 items' } },
        ] },
        { label: 'Flow 2', title: 'A blank item is ignored', state: 'ok', frames: [
          { verb: 'type " "', t: '00:31', state: 'ok', page: { h: 'Shopping list', field: '', count: '0 items' } },
          { verb: 'click Add', t: '00:33', state: 'fail', page: { h: 'Shopping list', field: '', count: '0 items' } },
        ] },
        { label: 'Flow 3', title: 'The count follows the list', state: 'fail', frames: [
          { verb: 'type "eggs"', t: '00:52', state: 'ok', page: { h: 'Shopping list', field: 'eggs', count: '0 items' } },
          { verb: 'click Add', t: '00:54', state: 'fail', page: { h: 'Shopping list', field: 'eggs', count: '0 items' } },
          { verb: 'type "bread"', t: '00:58', state: 'ok', page: { h: 'Shopping list', field: 'bread', count: '0 items' } },
        ] },
        { label: 'Re-walk', title: 'after the fix', state: 'ok', frames: [
          { verb: 'click Add', t: '00:07', state: 'ok', page: { h: 'Shopping list', field: '', items: ['milk'], count: '1 item' } },
        ] },
      ],
    },
  };
})();

// triagequeue.js
(() => {
  const n = v => Math.max(0, Math.min(99999, Math.round(Number(v)) || 0));
  const A = a => Array.isArray(a) ? a : [];
  const O = o => o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  const T = v => { try { return maybe(v); } catch { return ''; } };
  const eng = v => { try { return need(v).replace(/^./, c => c.toUpperCase()); } catch { return 'Engine'; } };
  const BK = ['both', 'left', 'right', 'disagree'];
  const MK = { left: '<i class="mk cx"></i>', right: '<i class="mk gm"></i>', both: '<i class="mk both"></i>', disagree: '<i class="mk cx"></i><i class="mk gm"></i>' };
  const hot = f => f.bucket === 'disagree';
  const tag = (f, p) => { const b = one(f.bucket, BK, 'left'); return `<span class="tg${b === 'disagree' ? ' hot' : ''}">${b === 'both' ? 'Both' : b === 'disagree' ? 'Disagree' : 'Only ' + eng(O(p[b]).engine)}</span>`; };
  const step = s => `<div class="stp s-${one(s.state, ['done', 'running', 'pending'], 'done')}"><span class="stcb">${s.state === 'pending' ? '' : '&#10003;'}</span><span class="stn">${need(s.title)}<small>${maybe(s.kind)}</small></span><span class="dur">${maybe(s.took)}</span>${s.verdict ? `<span class="vst">${need(s.verdict)}</span>` : '<span></span>'}</div>`;
  const item = (f, i, p) => `<div class="qi${i === p.selected ? ' sel' : ''}${hot(f) ? ' hot' : ''}"><span class="rk">${i + 1}</span><div class="qm"><div class="qt">${need(f.title)}</div><div class="qf">${maybe(f.where)}</div></div><div class="qr"><div class="r2"><span class="sevt${f.severity === 'critical' ? ' hot' : ''}">${need(f.severity)}</span>${tag(f, p)}</div><span class="mks">${MK[one(f.bucket, BK, 'left')]}</span></div></div>`;
  const opn = (m, name, t, on) => `<div class="opx${t ? '' : ' none'}${on ? ' look' : ''}"><div class="oh"><span class="mks">${m}</span><span class="nm">${name}</span><span class="ov">${t ? 'raised it' : 'no finding'}</span></div><div class="otx">${t ? T(t) : 'Never raised this.'}</div></div>`;
  const detail = (f, p) => {
    const b = one(f.bucket, BK, 'left');
    return `<div class="dpane${hot(f) ? ' hot' : ''}"><div class="dhead"><span class="pos">Finding <b>${n(p.selected) + 1}</b> of ${p.count} left</span>${tag(f, p)}<span class="sevt">${T(f.severity)}</span><span class="kh"><kbd>J</kbd><kbd>K</kbd> next, previous</span></div>
      <div class="ft"><div class="h1">${T(f.title)}</div><div class="locl"><span>${maybe(f.where)}</span><span class="mks">${MK[b]}</span><span class="why">${hot(f) && b === 'disagree' ? 'the engines disagree; you decide' : hot(f) ? 'critical; only one engine saw it' : ''}</span></div></div>
      ${A(f.code).length ? `<div class="codeb"><div class="cbh">${maybe(f.file || f.where)}</div><div class="cbb">${each(A(f.code), r => `<div class="cl${r.hl ? ' hl' : ''}"><span class="no">${n(r.n)}</span><span class="sg">${r.k === '+' ? '+' : ''}</span><span>${need(r.t)}</span></div>`)}</div></div>` : ''}
      <div class="opsb">${opn(MK.left, eng(O(p.left).engine), f.left, b === 'disagree')}${opn(MK.right, eng(O(p.right).engine), f.right, b === 'disagree')}</div>
      <div class="keyrow">${acts(Array.isArray(f.actions) ? f.actions : [{ label: 'Send to agent', key: 'S', primary: true }, { label: 'Dismiss', key: 'D' }, { label: 'Copy as comment', key: 'C' }])}<span class="nav"><button class="btn">Previous</button><button class="btn">Next</button></span></div></div>`;
  };
  KIT.triagequeue = {
    group: 'Review and documents',
    about: 'A ranked queue of review findings on the left, one finding at full size on the right with both engines side by side and the keys to act; disagreements and criticals rise to the top.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/coding-two-engine-review', file: 'r5-triage.html', shot: 'shots/r5-sorted.png' },
    replaces: 'queue',
    req: { left: 'obj', right: 'obj', items: 'arr' },
    opt: { steps: 'arr', selected: 'num', handled: 'num' },
    r: p => {
      const items = A(p.items);
      const si = Math.min(n(p.selected), items.length - 1);
      const sel = items[si];
      const pp = { ...p, selected: si, count: items.length };
      const done = n(p.handled);
      return `<div class="a-triagequeue"><div class="qside">${Array.isArray(p.steps) ? `<div class="sech"><span>Steps</span></div><div class="steps">${each(p.steps, step)}</div>` : ''}
        <div class="sech"><span>Triage queue</span><span class="cnt"><b>${done}</b> of ${items.length} handled</span></div>
        <div class="leg"><span>${MK.left} ${eng(O(p.left).engine)}</span><span>${MK.right} ${eng(O(p.right).engine)}</span><span class="rkn">ranked: disagree, critical, both, low</span></div>
        <div class="queue">${each(items, (f, i) => item(f, i, pp))}</div></div>
        ${sel ? each([sel], f => detail(f, pp)) : ''}</div>`;
    },
    ex: {
      type: 'triagequeue', selected: 0, handled: 0,
      left: { engine: 'codex' }, right: { engine: 'gemini' },
      steps: [
        { title: 'Collect the diff', kind: 'code', took: '1s', verdict: 'done' },
        { title: 'Codex review', kind: 'agent', took: '3m 10s', verdict: 'reject' },
        { title: 'Gemini review', kind: 'agent', took: '2m 41s', verdict: 'approve' },
        { title: 'Sort findings into buckets', kind: 'code', took: '0s', verdict: 'done' },
      ],
      items: [
        { bucket: 'disagree', severity: 'medium', title: 'Error state not announced', where: 'src/checkout/Payment.tsx:18-30', file: 'src/checkout/Payment.tsx',
          code: [{ n: 18, k: '+', t: 'const [error, setError] = useState<string | null>(null);', hl: true }, { n: 19, k: '+', t: 'async function pay(form: FormData) {', hl: true }, { n: 20, k: '+', t: '  const r = await submitPayment(form);', hl: true }, { n: 21, k: '+', t: '  if (!r.ok) setError(r.message);', hl: true }, { n: 22, k: '+', t: '}', hl: true }, { n: 30, k: '+', t: '{error && <p className="err">{error}</p>}', hl: true }],
          left: 'Needs aria-live so screen readers hear the error.', right: 'The existing toast already announces it; no change needed.' },
        { bucket: 'left', severity: 'critical', title: 'Secret in client bundle', where: 'src/config.ts:12', left: 'STRIPE_SECRET is read in a module imported by the browser build.' },
        { bucket: 'both', severity: 'high', title: 'Unvalidated redirect', where: 'src/routes/login.ts:40-44', left: 'next= is passed to res.redirect without an allow-list.', right: 'The redirect target comes from the query string and is not checked.' },
        { bucket: 'right', severity: 'low', title: 'Magic number 3', where: 'src/cart/promo.ts:41', right: 'Name the promo size so 4-for-3 does not need a code change.' },
      ],
    },
  };
})();

// usagecard.js
(() => {
  KIT.usagecard = {
    group: 'Data',
    about: 'Per-engine usage: engine name, a dither bar for each limit window and what is left; an engine with no local source says so instead of guessing.',
    origin: { folder: 'ouros-fiveshot-2026-10-30', file: 'ref-css/wall.css (.pop, .urow, .ul, .bar dither)', shot: 'now/03-list-ctrl-b.png' },
    replaces: 'meter',
    req: { rows: 'arr' },
    opt: { title: 'str', aside: 'str' },
    r: p => `<div class="a-usagecard"><div class="hd"><span>${esc(p.title || 'Usage')}</span><span>${maybe(p.aside)}</span></div>${each(p.rows, r => {
      if (!Array.isArray(r.limits) || !r.limits.length) return `<div class="ur na"><span class="e">${need(r.engine)}</span><span class="nv">${maybe(r.note) || 'No local source for this provider’s limits'}</span></div>`;
      return `<div class="ur"><span class="e">${need(r.engine)}</span>${each(r.limits, l => { const v = Math.max(0, Math.min(100, Number(l.used) || 0)); return `<span class="ul"><span class="w">${need(l.window)}</span><span class="bar"><i style="width:${v.toFixed(0)}%"></i></span><span class="v">${v.toFixed(0)}%</span><span class="rs">${maybe(l.resets)}</span></span>`; })}</div>`;
    })}</div>`,
    ex: { type: 'usagecard', aside: 'this machine', rows: [
      { engine: 'claude', limits: [{ window: '5h', used: 62, resets: '1h 40m' }, { window: '7d', used: 23, resets: '4d' }] },
      { engine: 'codex', limits: [{ window: '5h', used: 18, resets: '3h 05m' }] },
      { engine: 'gemini' }] },
  };
})();

// variantsgrid.js
(() => {
  const sk = (l, head, m) => `<div class="zsk zl-${one(l, ['board', 'photo', 'journal'], 'board')}${m ? ' zm' : ''}"><div class="znv">Bakery<span><i></i><i></i><i></i></span></div><div class="zhero"><i class="zph"></i><div class="ztx"><h4>${need(head)}</h4><s></s><s></s><u>Pre-order</u></div><div class="zhr"><em>Hours</em><p><span>Tue to Fri</span><span>7 to 3</span></p><p><span>Sat</span><span>7 to 2</span></p><p><span>Sun</span><span>8 to 12</span></p></div></div><div class="zbd"><span>Country sourdough</span><span>Seeded rye</span><span>Spelt tin</span></div></div>`;
  const REFK = ['zpa', 'zpb', 'zpc'];
  const refs = a => a && a.length ? `<div class="zrefs">${each(a.slice(0, 3), (r, i) => `<div class="zrf"><i class="zth ${REFK[i % 3]}"></i><span><b>PIN</b> ${need(r)}</span></div>`)}</div>` : '';
  const tile = v => `<div class="ztl${v.verdict ? ' zvd-' + one(v.verdict, ['pick', 'combine', 'discard'], 'pick') : ''}"><div class="zth2"><i class="zltr">${need(v.id)}</i><b>${need(v.name)}</b><span>${maybe(v.engine)} · ${maybe(v.file)}</span>${v.port ? `<em>serving :${need(v.port)}</em>` : ''}</div>
    <div class="zpv">${sk(v.layout, v.headline || 'Bread from the oven at six')}${v.verdict ? `<span class="zst zv-${one(v.verdict, ['pick', 'combine', 'discard'], 'pick')}">${need(v.verdict)}</span>` : ''}</div>
    ${refs(v.refs)}<div class="zag"><span>AGENT</span> ${maybe(v.summary)}</div>
    <div class="zms"><span>cost <b>${maybe(v.cost)}</b></span><span>time <b>${maybe(v.time)}</b></span></div>${v.note ? `<div class="znt">${need(v.note)}</div>` : ''}
    <div class="zac">${acts([{ label: 'Pick', key: 'P' }, { label: 'Combine', key: 'C' }, { label: 'Discard', key: 'D' }])}</div></div>`;
  KIT.variantsgrid = {
    group: 'Review and documents',
    about: 'Design variants as a grid of tiles: each a drawn site thumbnail, its pinned references, what the agent did, and a pick, combine or discard stamp.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/design-design-variants', file: 'r1-variants-grid.html', shot: 'check/r1-gate.png' },
    req: { variants: 'arr' },
    opt: { title: 'str', prompt: 'str' },
    r: p => `<div class="a-variantsgrid"><div class="zhd"><b>${maybe(p.title || 'Design variants')}</b>${p.prompt ? `<span>${need(p.prompt)}</span>` : ''}</div><div class="zgr">${each(p.variants, tile)}</div></div>`,
    ex: { type: 'variantsgrid', title: 'Design variants', prompt: 'Pick one tile, or Combine two, then Continue.', variants: [
        { id: 'A', name: 'Chalkboard', engine: 'claude', layout: 'board', file: 'direction-0.md', port: '4411', verdict: 'pick', refs: ['Hand-lettered menu', 'Ruled price list', 'Large warm serif'], summary: 'The page is the shop board. Hours sit in a big boxed panel at the top right; the bread list is hand-ruled.', cost: '$0.52', time: '31m 50s', note: 'hours board and button share the first screen at 1280' },
        { id: 'B', name: 'Counter photo', engine: 'claude', layout: 'photo', file: 'direction-1.md', port: '4412', verdict: 'combine', refs: ['Full-bleed shop photo', 'Text over a panel', 'Large warm serif'], summary: 'The counter photo fills the first screen. A cream panel over it carries the line, hours and button.', cost: '$0.41', time: '29m 14s', note: 'photo is a grey placeholder until a real image is supplied' },
        { id: 'C', name: 'Journal', engine: 'codex', layout: 'journal', file: 'direction-2.md', port: '4413', verdict: 'discard', refs: ['Two-column food page', 'Large warm serif', 'Ruled price list'], summary: 'An editorial page: the photo on the left half, the text on the right, like a food journal spread.', cost: '$0.47', time: '33m 40s', note: 'at 390 the photo stacks above the text and pushes the button below the fold' },
      ] },
  };
})();

// viewport3d.js
(() => {
  const C = Math.cos(Math.PI / 6), S = Math.sin(Math.PI / 6);
  const num = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
  const pt = a => Array.isArray(a) && a.length === 3 ? a.map(v => num(v, -2000, 2000)) : null;
  const iso = ([x, y, z]) => [(x - y) * C, (x + y) * S - z];
  const ring = (h, n = 20) => {
    const [x, y, z] = h.at, r = num(h.r, 0.5, 200);
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2, u = Math.cos(a) * r, v = Math.sin(a) * r;
      return h.face === 'front' ? [x + u, y, z + v] : h.face === 'right' ? [x, y + u, z + v] : [x + u, y + v, z];
    });
  };
  const box = b => {
    const [x, y, z] = b.at, w = num(b.size[0], 1, 2000), d = num(b.size[1], 1, 2000), h = num(b.size[2], 1, 2000);
    return {
      key: x + y + z, sel: b.sel === true,
      faces: [
        ['top', [[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]]],
        ['front', [[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]]],
        ['right', [[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]]],
      ],
    };
  };
  KIT.viewport3d = {
    group: 'Workspaces',
    about: 'A 3D part viewport drawn in SVG: solid blocks, holes, dimensions, a view cube and an axis triad, with the selection called out.',
    origin: { folder: 'new for H4 (persona: mechanical engineer)', file: 'no MetaTrooper source; drawn for the part-design workspace' },
    replaces: 'preview',
    req: { part: 'str', bodies: 'arr' },
    opt: { holes: 'arr', dims: 'arr', view: 'str', mode: 'str', selected: 'str', status: 'arr', tools: 'arr' },
    set: { view: ['iso', 'front', 'top', 'right'], mode: ['shaded', 'wire', 'section'] },
    r: p => {
      const bodies = p.bodies.filter(b => b && pt(b.at) && Array.isArray(b.size) && b.size.length === 3)
        .map(b => box({ ...b, at: pt(b.at) })).sort((a, b) => a.key - b.key);
      const holes = (p.holes || []).filter(h => h && pt(h.at)).map(h => ({ ...h, at: pt(h.at) }));
      const dims = (p.dims || []).filter(d => d && pt(d.from) && pt(d.to)).map(d => ({ text: d.text, a: iso(pt(d.from)), b: iso(pt(d.to)) }));
      const all = bodies.flatMap(b => b.faces.flatMap(f => f[1].map(iso))).concat(dims.flatMap(d => [d.a, d.b]));
      if (!all.length) return `<div class="a-viewport3d"><div class="vempty">${need(p.part)} · nothing to draw</div></div>`;
      const xs = all.map(q => q[0]), ys = all.map(q => q[1]);
      const W = 760, H = 420, pad = 56;
      const k = Math.min((W - pad * 2) / Math.max(1, Math.max(...xs) - Math.min(...xs)), (H - pad * 2) / Math.max(1, Math.max(...ys) - Math.min(...ys)));
      const ox = W / 2 - ((Math.max(...xs) + Math.min(...xs)) / 2) * k, oy = H / 2 - ((Math.max(...ys) + Math.min(...ys)) / 2) * k;
      const P = q => `${(q[0] * k + ox).toFixed(1)},${(q[1] * k + oy).toFixed(1)}`;
      const poly = (pts, cls) => `<polygon class="${cls}" points="${pts.map(P).join(' ')}"/>`;
      const solid = bodies.map(b => b.faces.map(([f, pts]) => poly(pts.map(iso), `vf v${f}${b.sel ? ' vsel' : ''}`)).join('')).join('');
      const bore = holes.map(h => poly(ring(h).map(iso), 'vhole')).join('');
      const dim = dims.map(d => {
        const [x1, y1] = P(d.a).split(',').map(Number), [x2, y2] = P(d.b).split(',').map(Number);
        let nx = -(y2 - y1), ny = x2 - x1;
        if (nx * ((x1 + x2) / 2 - W / 2) + ny * ((y1 + y2) / 2 - H / 2) < 0) { nx = -nx; ny = -ny; }
        const l = Math.hypot(nx, ny) || 1, off = 18, ux = (nx / l) * off, uy = (ny / l) * off;
        const mx = (x1 + x2) / 2 + ux * 1.6, my = (y1 + y2) / 2 + uy * 1.6;
        return `<g class="vdim"><line x1="${x1}" y1="${y1}" x2="${(x1 + ux).toFixed(1)}" y2="${(y1 + uy).toFixed(1)}"/><line x1="${x2}" y1="${y2}" x2="${(x2 + ux).toFixed(1)}" y2="${(y2 + uy).toFixed(1)}"/><line class="vm" x1="${(x1 + ux).toFixed(1)}" y1="${(y1 + uy).toFixed(1)}" x2="${(x2 + ux).toFixed(1)}" y2="${(y2 + uy).toFixed(1)}"/><text x="${mx.toFixed(1)}" y="${(my + 4).toFixed(1)}">${need(d.text)}</text></g>`;
      }).join('');
      const grid = Array.from({ length: 9 }, (_, i) => {
        const t = -200 + i * 50;
        return `<line x1="${P(iso([t, -200, 0]))}" x2="${P(iso([t, 200, 0]))}"/><line x1="${P(iso([-200, t, 0]))}" x2="${P(iso([200, t, 0]))}"/>`;
      }).join('').replace(/x1="([\d.-]+),([\d.-]+)" x2="([\d.-]+),([\d.-]+)"/g, 'x1="$1" y1="$2" x2="$3" y2="$4"');
      const view = one(p.view, ['iso', 'front', 'top', 'right'], 'iso');
      const tools = each(p.tools || ['Select', 'Sketch', 'Extrude', 'Hole', 'Fillet', 'Measure', 'Section'], (t, i) => `<span class="${i ? '' : 'von'}">${need(t)}</span>`);
      const status = each(p.status || [], s => `<span>${need(s)}</span>`);
      const mode = one(p.mode, ['shaded', 'wire', 'section'], 'shaded');
      const modes = `<span class="vmd">${each(['shaded', 'wire', 'section'], m => `<span class="${m === mode ? 'von' : ''}">${esc(m)}</span>`)}</span>`;
      const nav = '<span class="vnav"><span title="Orbit">⟲ orbit</span><span title="Pan">✥ pan</span><span title="Zoom to fit">⤢ fit</span></span>';
      return `<div class="a-viewport3d vm-${mode}"><div class="vbar"><span class="vnm">${need(p.part)}</span><span class="vtl">${tools}</span><span class="vvw">${each(['iso', 'front', 'top', 'right'], v => `<span class="${v === view ? 'von' : ''}">${esc(v)}</span>`)}</span></div>
<div class="vbar2">${modes}${nav}</div>
<div class="vstage"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(p.part)}"><g class="vgrid">${grid}</g>${solid}${bore}${dim}</svg>
<div class="vcube"><svg viewBox="-34 -34 68 68"><polygon class="vct" points="0,-26 22,-13 0,0 -22,-13"/><polygon class="vcf" points="-22,-13 0,0 0,26 -22,13"/><polygon class="vcr" points="0,0 22,-13 22,13 0,26"/><text x="0" y="-9">T</text><text x="-11" y="10">F</text><text x="11" y="10">R</text></svg></div>
<div class="vaxes"><svg viewBox="0 0 60 60"><line class="vx" x1="20" y1="44" x2="44" y2="56"/><line class="vy" x1="20" y1="44" x2="0" y2="54"/><line class="vz" x1="20" y1="44" x2="20" y2="14"/><text x="48" y="58">X</text><text x="1" y="47">Y</text><text x="24" y="16">Z</text></svg></div>
${p.selected ? `<div class="vpick"><span class="vlt">selected</span>${need(p.selected)}</div>` : ''}</div>
${status ? `<div class="vfoot">${status}</div>` : ''}</div>`;
    },
    ex: {
      type: 'viewport3d', part: 'MB-204 motor bracket', view: 'iso', selected: 'Face 7 · top of base · 120 × 80 mm',
      bodies: [
        { at: [0, 0, 0], size: [120, 80, 10], sel: true },
        { at: [0, 0, 10], size: [120, 12, 70] },
        { at: [8, 12, 10], size: [8, 24, 26] },
        { at: [104, 12, 10], size: [8, 24, 26] },
      ],
      holes: [
        { at: [26, 50, 10], r: 5, face: 'top' }, { at: [94, 50, 10], r: 5, face: 'top' },
        { at: [26, 68, 10], r: 5, face: 'top' }, { at: [94, 68, 10], r: 5, face: 'top' },
        { at: [60, 12, 52], r: 14, face: 'front' },
      ],
      dims: [
        { from: [0, 80, 0], to: [120, 80, 0], text: '120' },
        { from: [120, 0, 0], to: [120, 80, 0], text: '80' },
        { from: [0, 0, 10], to: [0, 0, 80], text: '70' },
      ],
      status: ['Fully constrained', 'Aluminium 6061', '212 g', 'Units mm'],
    },
  };
})();

// walltile.js
(() => {
  const STATES = ['working', 'needs', 'starting', 'done', 'idle'];
  const mark = (state, sys) => state === 'needs' && sys
    ? '<span class="stmp"><span class="ink y">needs you</span><span class="ink p">needs you</span></span>'
    : `<span class="bdg">${state === 'needs' ? 'asks you' : esc(state)}</span>`;
  const spark = v => `<span class="spk">${each(v.slice(0, 10), x => `<i class="${Number(x) > 0 ? 'on' : ''}" style="height:${Math.round(Math.max(1, Math.min(8, Number(x) * 8 || 1)))}px"></i>`)}</span>`;
  KIT.walltile = {
    group: 'Agent and run',
    about: 'One agent on the wall: dotted pane, two-row header (engine chip, task, stamp, actions; state words, activity spark, branch and diff), terminal body, dither halo while it works or needs you.',
    origin: { folder: 'ouros-fiveshot-2026-10-30', file: 'ref-css/wall.css (.pane, .ph, .stamp, .edge)', shot: 'now/18-wall-with-approvals.png' },
    replaces: 'tile',
    req: { engine: 'str', task: 'str', state: 'str', lines: 'arr' },
    opt: { label: 'str', branch: 'str', add: 'str', del: 'str', meta: 'str', actions: 'arr', spark: 'arr' },
    set: { state: STATES },
    r: p => {
      const sys = SOURCE === 'system';
      return `<div class="a-walltile s-${p.state}${p.state === 'needs' && sys ? ' attn' : ''}"><section class="pn">
        <div class="hdr"><div class="r1"><span class="dt"></span><span class="eng">${esc(p.engine)}</span><span class="task">${esc(p.task)}</span>${mark(p.state, sys)}<span class="act">${acts(p.actions)}</span></div>
        <div class="r2"><span class="fl">${maybe(p.label)}</span>${p.spark ? spark(p.spark) : ''}<span class="meta">${maybe(p.branch)}${p.add ? ` <b class="ad">${need(p.add)}</b>` : ''}${p.del ? ` <b class="dl">${need(p.del)}</b>` : ''}${p.meta ? ` · ${need(p.meta)}` : ''}</span></div></div>
        <div class="bd">${each(p.lines.slice(0, 40), l => `<div>${need(l)}</div>`)}</div></section></div>`;
    },
    ex: { type: 'walltile', engine: 'claude', task: 'Retry on 429 with backoff', state: 'needs', label: 'question', spark: [0, 1, 1, 0.4, 1, 0.6, 0, 0, 1, 1], branch: 'main', add: '+14', del: '-1', meta: '88k tok',
      actions: [{ label: 'Give window' }, { label: 'Diff' }, { label: 'Hand back' }],
      lines: ['$ npm test -- retry', ' PASS test/retry.test.ts (6)', 'wrote src/api/client.ts +14 -1', 'Which backoff cap should I use, 30s or 60s?'] },
  };
})();

// workspacestack.js
(() => {
  const ws = w => `<div class="wk${w.current === true ? ' cur2' : ''}"><b>${need(w.name)}</b><span class="brz">${maybe(w.branch)}</span><span class="stt s-${one(w.state, ['needs', 'ready', 'build'], 'build')}">${need(w.status)}</span></div>`;
  const stp = s => `<div class="sp2 sp-${one(s.state, ['done', 'needs', 'todo'], 'todo')}"><i></i><span class="sn">${need(s.label)}</span><span class="skz">${maybe(s.took)}</span></div>`;
  const ev = e => `<div class="ev2"><i class="${e.done === true ? 'ok2' : ''}"></i><div class="eb"><div class="eh"><b>${need(e.label)}</b><span>${maybe(e.took)}</span></div><div class="et">${maybe(e.text)}</div></div></div>`;
  const arr = v => Array.isArray(v) ? v : [];
  const obj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const gate = g => obj(g) ? render({ type: 'gate', title: g.name, text: g.text, why: g.why ?? 'needs your decision', aside: g.aside, actions: g.actions, action: g.action, hash: g.hash }) : '';
  const dl = l => `<div class="dl2 ${l.sign === '+' ? 'add' : l.sign === '-' ? 'del' : ''}"><span class="n2">${need(l.n)}</span><span class="sg">${l.sign === '+' || l.sign === '-' ? need(l.sign) : ''}</span><span class="txz">${need(l.text)}</span></div>`;
  const fd = f => `<div class="fd"><i class="bx2"></i><span class="id">${need(f.id)}</span><div class="fb"><b>${need(f.title)}</b><span class="wh2">${maybe(f.where)}</span></div><span class="bk">${maybe(f.bucket)}</span></div>`;
  KIT.workspacestack = {
    group: 'Workspaces',
    about: 'Three panes for one agent loop: the workspaces and steps on the left, the agent stream with its gate in the middle, the diff, checks and findings stacked on the right.',
    origin: { folder: 'metatrooper-lanes-2026-10-04/coding-spec-build-review-handback', file: 'r4-workspaces.html', shot: 'r4-workspaces-pick.png' },
    req: { project: 'str', workspaces: 'arr', steps: 'arr', stream: 'arr', diff: 'obj' },
    opt: { gate: 'obj', checks: 'obj', findings: 'arr', worktree: 'str', base: 'str', prompt: 'str' },
    r: p => `<div class="a-workspacestack">
      <div class="col2 l"><div class="ph2"><span class="lbl">${need(p.project)}</span> ${p.workspaces.length} workspaces</div>${each(p.workspaces, ws)}
        <div class="sps">${each(p.steps, stp)}</div>
        ${p.worktree || p.base ? `<div class="wt"><span>Worktree</span>${maybe(p.worktree)}<span>Base</span>${maybe(p.base)}</div>` : ''}</div>
      <div class="col2 m"><div class="ph2"><span class="lbl">Agent</span> ${p.stream.filter(e => e && e.done === true).length}/${p.steps.length} steps</div>
        <div class="sm">${each(p.stream, ev)}</div>${gate(p.gate)}
        <div class="inp">${maybe(p.prompt || 'Message the agent in this workspace')}<kbd>Enter</kbd></div></div>
      <div class="col2 rz"><div class="blkz"><div class="ph2"><span class="lbl">Diff</span> ${maybe(p.diff.stat)}</div><div class="fn">${maybe(p.diff.file)} <span class="adz">+${maybe(p.diff.add)}</span> <span class="de">-${maybe(p.diff.del)}</span></div>${each(arr(p.diff.lines), dl)}</div>
        ${obj(p.checks) ? `<div class="blkz"><div class="ph2"><span class="lbl">Checks</span> ${arr(p.findings).length} findings</div><div class="vf">${maybe(p.checks.verify)}</div>
          <div class="eng2">${each(arr(p.checks.engines), e => `<div class="en"><b>${need(e.name)}</b><span>${maybe(e.tokens)}</span><i class="vd v-${one(e.verdict, ['approve', 'reject', 'notes'], 'notes')}">${need(e.verdict)}</i></div>`)}</div>
          ${each(arr(p.findings), fd)}</div>` : ''}</div></div>`,
    ex: {
      type: 'workspacestack', project: 'tidy-cli', worktree: '.worktrees/run-5b1d', base: 'main',
      workspaces: [
        { name: 'add-dry-run-flag', branch: 'mt/loop-run-5b1d', status: 'needs you', state: 'needs', current: true },
        { name: 'fix-flaky-watch-test', branch: 'mt/loop-run-41c0', status: 'ready to merge, 2 for you', state: 'ready' },
        { name: 'rename-config-keys', branch: 'mt/loop-run-77ae', status: 'build, 2m 10s', state: 'build' },
      ],
      steps: [
        { label: 'Write the spec', took: '1m 40s', state: 'done' }, { label: 'Approve the spec', took: '2m 05s', state: 'done' }, { label: 'Build it on a new branch', took: '4m 22s', state: 'done' },
        { label: 'Run the tests', took: '3s', state: 'done' }, { label: 'Codex review', took: '2m 31s', state: 'done' }, { label: 'Gemini review', took: '1m 58s', state: 'done' },
        { label: 'Sort findings into buckets', took: '0s', state: 'done' }, { label: 'Pick which findings to fix', took: 'waiting', state: 'needs' },
        { label: 'Fix the picked findings', state: 'todo' }, { label: 'Hand back to you', state: 'todo' },
      ],
      stream: [
        { label: 'Write the spec', took: '1m 40s', done: true, text: 'wrote spec.md (3 acceptance checks)' },
        { label: 'Build it on a new branch', took: '4m 22s', done: true, text: 'git add src/commands/clean.js src/cli.js test/clean-dry-run.test.js' },
        { label: 'Run the tests', took: '3s', done: true, text: 'exit 0' },
        { label: 'codex + gemini review', took: '2m 31s', done: true, text: 'x verdict: reject (2 findings); verdict: approve (2 findings)' },
        { label: 'Sort findings into buckets', took: '0s', done: true, text: 'both 1, codex only 1, gemini only 1, disagree 0' },
      ],
      gate: { name: 'pick-fixes', text: 'Tick the findings to fix. Unticked findings go to your hand-back list; nothing is dismissed.', action: 'fix (tick findings) on mt/loop-run-5b1d', hash: '#7d2e48b1', actions: [{ label: 'Fix the ticked findings', key: 'F', primary: true }, { label: 'Reject', key: 'R' }] },
      diff: {
        stat: '3 files staged, +48 -3', file: 'src/commands/clean.js', add: '14', del: '3',
        lines: [
          { n: '30', text: 'export async function clean(root, opts) {' },
          { n: '31', sign: '+', text: '  const found = await walk(root, opts.patterns);' },
          { n: '32', sign: '+', text: '  if (opts.dryRun) {' },
          { n: '33', sign: '+', text: "    for (const p of found) log(`would remove ${p.path}`);" },
          { n: '34', sign: '+', text: "    log(`${found.length} paths, ${kb(found)} KB, nothing removed`);" },
          { n: '42', sign: '-', text: '  await removeEmptyDirs(root);' },
        ],
      },
      checks: { verify: 'verify 6 pass, exit 0 · after fix not yet', engines: [{ name: 'Codex', tokens: '27,480 tok', verdict: 'reject' }, { name: 'Gemini', tokens: '24,910 tok', verdict: 'approve' }] },
      findings: [
        { id: 'B1', title: 'Dry run still removes empty folders', where: 'src/commands/clean.js:40-45', bucket: 'both' },
        { id: 'C1', title: 'No test for --dry-run with --force', where: 'test/clean-dry-run.test.js:1-31', bucket: 'codex only' },
        { id: 'G1', title: 'Help text does not mention --dry-run', where: 'src/cli.js:19', bucket: 'gemini only' },
      ],
    },
  };
})();
