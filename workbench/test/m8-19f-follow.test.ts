// M8-19f: Follow agent toggles from the tab-group chip and from the palette; each new file the agent touches opens in its changes view.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

let ide = fs.readFileSync(new URL('../ui/src/ide.jsx', import.meta.url), 'utf8');
const pick = (re: RegExp, what: string) => { const b = ide.match(re)?.[0]; assert.ok(b, `${what} must exist`); return b.replace(/^export /gm, ''); };

// Optional in-memory mutation of the source text (used only for mutation checks: F_MUT="from@@to").
const mut = process.env.F_MUT;
function mutated(code: string) { if (!mut) return code; const [a, b] = mut.split('@@'); if (!code.includes(a)) return code; return code.replace(a, b); }

function harness(sessions: any[], changed: Record<string, string[]>) {
  const setFollowSrc = mutated(pick(/^export function setFollow\([^]*?^\}/m, 'setFollow'));
  const stepSrc = mutated(pick(/^function followStep\([^]*?^\}/m, 'followStep'));
  const chipRaw = mutated(pick(/^function FollowChip\([^]*?^\}/m, 'FollowChip'));
  // No JSX in node: turn the single <Button .../> into a plain call to a stub.
  const chip = chipRaw.replace(/return <Button[^]*?variant=\{([^]*?)\} label=\{([^]*?)\}\n\s*tooltip=\{[^]*?\} onClick=\{([^]*?)\} \/>;/, 'return Button({ variant: $1, label: $2, onClick: $3 });');
  assert.ok(chip.includes('Button({'), 'chip JSX rewritten');
  const opened: any[] = [], toasts: string[] = [];
  const env: any = { ui: { snap: { sessions } }, cur: { pid: 'p', follow: null, followSeen: new Set() }, bumps: 0 };
  const code = `${setFollowSrc}\n${stepSrc}\n${chip}\nreturn { setFollow, followStep, FollowChip, getCur: () => cur };`;
  const fn = new Function('ui', 'changedFiles', 'slashed', 'agentsIn', 'agentName', 'openFile', 'toast', 'bump', 'Button', 'cur', code);
  // cur must be a shared binding: wrap in an object-backed variable
  const curObj = env.cur;
  const api = fn(env.ui, (id: string) => changed[id] || [], (p: string) => p.split(String.fromCharCode(92)).join('/'),
    (pid: string) => sessions.filter((x) => x.project_id === pid && x.state !== 'exited'),
    (id: string) => sessions.find((x) => x.id === id)?.engine_id || 'the agent',
    (...a: any[]) => { opened.push(a); }, (m: string) => toasts.push(m), () => { env.bumps++; }, (p: any) => p, curObj);
  return { ...api, opened, toasts, st: curObj, env };
}
const agent = (id: string, extra: any = {}) => ({ id, project_id: 'p', engine_id: `eng-${id}`, state: 'running', ...extra });

test('M8-19f: setFollow seeds followSeen with files already changed, and setFollow(null) turns it off', () => {
  const h = harness([agent('a')], { a: ['src' + String.fromCharCode(92) + 'x.ts', 'y.ts'] });
  h.setFollow('a');
  assert.equal(h.st.follow, 'a');
  assert.deepEqual([...h.st.followSeen].sort(), ['src/x.ts', 'y.ts']);
  h.followStep(h.st);
  assert.equal(h.opened.length, 0, 'already-changed files are not opened');
  assert.ok(h.env.bumps >= 1);
  h.setFollow(null);
  assert.equal(h.st.follow, null);
  assert.equal(h.st.followSeen.size, 0);
});

test('M8-19f: followStep opens only a newly changed file, in changes view with the owner, once', () => {
  const changed: Record<string, string[]> = { a: ['old.ts'] };
  const h = harness([agent('a')], changed);
  h.setFollow('a');
  changed.a = ['old.ts', 'new.ts'];
  h.followStep(h.st);
  assert.equal(h.opened.length, 1);
  assert.equal(h.opened[0][0], h.st);
  assert.equal(h.opened[0][1], 'new.ts');
  assert.deepEqual(h.opened[0][2], { owner: 'a', changes: true });
  h.followStep(h.st);
  assert.equal(h.opened.length, 1, 'a second step with no new files opens nothing');
  changed.a = ['old.ts', 'new.ts', 'p.ts', 'q.ts'];
  h.followStep(h.st);
  assert.equal(h.opened.length, 2);
  assert.equal(h.opened[1][1], 'q.ts', 'the last new file is the one opened');
});

test('M8-19f: followStep does nothing when not following', () => {
  const h = harness([agent('a')], { a: ['n.ts'] });
  h.followStep(h.st);
  assert.equal(h.opened.length, 0);
  assert.equal(h.toasts.length, 0);
});

test('M8-19f: followStep stops and toasts when the followed agent exited or vanished', () => {
  for (const sessions of [[agent('a', { state: 'exited' })], []]) {
    const h = harness(sessions, { a: ['n.ts'] });
    h.st.follow = 'a'; h.st.followSeen = new Set();
    h.followStep(h.st);
    assert.equal(h.st.follow, null);
    assert.deepEqual(h.toasts, ['Stopped following: the agent has ended.']);
    assert.equal(h.opened.length, 0);
  }
});

test('M8-19f: FollowChip toggles between "Follow agent" and "Following <engine>"', () => {
  const h = harness([agent('a'), agent('b')], {});
  const off = h.FollowChip({ st: h.st });
  assert.equal(off.label, 'Follow agent');
  assert.equal(off.variant, 'ghost');
  off.onClick();
  assert.equal(h.st.follow, 'a', 'follows the first agent');
  const on = h.FollowChip({ st: h.st });
  assert.equal(on.label, 'Following eng-a');
  assert.equal(on.variant, 'secondary');
  on.onClick();
  assert.equal(h.st.follow, null);
  assert.equal(h.FollowChip({ st: h.st }).label, 'Follow agent');
});

test('M8-19f: FollowChip renders nothing with no agents and no follow, but stays while following', () => {
  const h = harness([], {});
  assert.equal(h.FollowChip({ st: h.st }), null);
  h.st.follow = 'gone';
  assert.equal(h.FollowChip({ st: h.st }).label, 'Following the agent');
});

test('M8-19f: the palette offers Follow for the other agents and Stop following when on', () => {
  const body = pick(/^export function ideCommands\([^]*?^\}/m, 'ideCommands');
  assert.match(body, /for \(const x of agentsIn\(st\.pid\)\) if \(x\.id !== st\.follow\) out\.push\(cmd\('Follow', `Follow \$\{x\.engine_id\}: \$\{taskOf\(x\)\}`\.slice\(0, 80\), \(\) => setFollow\(x\.id\)\)\)/);
  assert.match(body, /if \(st\.follow\) out\.push\(cmd\('Follow', 'Stop following', \(\) => setFollow\(null\)\)\)/);
});

test('M8-19f: the chip sits in the editor tab bar before TabActions, and drawIde steps follow on each snapshot', () => {
  assert.match(ide, /<FollowChip st=\{st\} \/>\s*<TabActions /);
  assert.match(ide, /cur\.gitSnap = ui\.snap\.git \|\| \{\};\s*followStep\(cur\);/);
});
