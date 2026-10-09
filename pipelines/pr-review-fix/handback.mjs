import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { WIDEN } from '../two-engine-review/bucket.mjs';

const KEYS = ['both', 'codex_only', 'gemini_only', 'disagree'];

const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(String(file), 'utf8')); } catch { return null; }
};

const label = (p) => {
  const f = p.codex || p.gemini;
  return `${f.title || String(f.body || '').slice(0, 80) || 'untitled finding'} (${f.file}:${f.line_start})`;
};

const spans = (p) => [p.codex, p.gemini].filter(Boolean);

/** Per file, the fix's hunks as [oldStart, oldCount, newStart, newCount] from `git diff -U0 HEAD`. */
function hunks(dir) {
  const out = new Map();
  let r;
  try { r = spawnSync('git', ['-C', dir, '-c', 'core.quotepath=off', 'diff', '-U0', '--no-color', 'HEAD'], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 }); } catch { return out; }
  let file = null;
  for (const line of String(r.stdout ?? '').split(/\r?\n/)) {
    const f = /^--- a\/(.+?)\t?$/.exec(line);
    if (f) { file = f[1]; continue; }
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (h && file) out.set(file, [...(out.get(file) ?? []), [Number(h[1]), h[2] === undefined ? 1 : Number(h[2]), Number(h[3]), h[4] === undefined ? 1 : Number(h[4])]]);
  }
  return out;
}

/** Moves a pre-fix line to where it sits after the fix. */
function shift(moves, file, n) {
  let delta = 0;
  for (const [a, b, c, d] of moves.get(file) ?? []) {
    if (a + Math.max(b, 1) - 1 < n) delta += d - b;
    else if (a <= n) return c;
  }
  return n + delta;
}

function reported(again, p, moves) {
  return KEYS.some((k) => (again[k] ?? []).some((q) => spans(q).some((b) => spans(p).some((a) => {
    const s = shift(moves, a.file, a.line_start), e = shift(moves, a.file, a.line_end);
    return a.file === b.file && s - WIDEN <= b.line_end + WIDEN && b.line_start - WIDEN <= e + WIDEN;
  }))));
}

/** Writes handback.md: each finding as fixed with proof, claimed without proof, still found or not picked. */
export async function run(ctx) {
  const first = ctx.steps.freeze?.buckets ?? readJson(ctx.steps.review?.buckets_abs);
  const again = readJson(ctx.steps.rereview?.buckets_abs);
  const picks = new Set(ctx.steps.freeze?.pick ?? readJson(path.join(ctx.runDir, 'picks.json'))?.pick ?? []);
  const moves = ctx.steps.checkout?.worktree ? hunks(String(ctx.steps.checkout.worktree)) : new Map();
  const proof = readJson(path.join(ctx.runDir, 'proof.json'))?.results ?? {};
  const readable = (b) => b && !['codex_verdict', 'gemini_verdict'].some((k) => ['failed', 'unknown'].includes(b[k]));
  const items = [];
  for (const [id, b] of [['review', first], ['rereview', again]]) if (!readable(b)) items.push({ kind: 'human', text: `Review results missing for ${id}: read ${ctx.runDir}/${id}/` });
  for (const p of KEYS.flatMap((k) => first?.[k] ?? [])) {
    const r = proof[p.id];
    if (!picks.has(p.id)) items.push({ kind: 'not-picked', text: `${label(p)}: not picked` });
    else if (readable(again) && reported(again, p, moves)) items.push({ kind: 'still-found', text: `${label(p)}: still found after the fix${r?.passed ? ' (its proof passed)' : ''}` });
    else if (!r || !r.claimed) items.push({ kind: 'still-found', text: `${label(p)}: not fixed${r?.why ? `, ${r.why}` : ''}` });
    else if (!r.passed) items.push({ kind: 'claimed', text: `${label(p)}: claimed fixed, no proof (${r.why})` });
    else if (!readable(again)) items.push({ kind: 'claimed', text: `${label(p)}: proof passed but the rereview did not run` });
    else items.push({ kind: 'fixed', text: `${label(p)}: fixed, proof passed and the rereview no longer reports it` });
  }
  items.push({ kind: 'human', text: `Review and commit the work in ${ctx.steps.checkout?.worktree ?? 'the worktree'}` });
  const numbered = items.map((x, i) => ({ n: i + 1, ...x }));
  const count = (k) => numbered.filter((x) => x.kind === k).length;
  const md = ['# Hand-back', '', ...numbered.map((x) => `${x.n}. [${x.kind}] ${x.text}`), ''].join('\n');
  await ctx.writeFile('handback.md', md);
  return { document: 'handback.md', count: numbered.length, fixed: count('fixed'), claimed: count('claimed'), still_found: count('still-found'), not_picked: count('not-picked'), items: numbered };
}
