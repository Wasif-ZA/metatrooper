import fs from 'node:fs';

function buckets(file) {
  try {
    return JSON.parse(fs.readFileSync(String(file), 'utf8'));
  } catch {
    return null;
  }
}

function finding(pair) {
  const f = pair.codex || pair.gemini || pair;
  const at = f.file ? ` (${f.file}${f.line_start ? `:${f.line_start}` : ''})` : '';
  return `${f.severity ? `**${f.severity}** ` : ''}${f.title || String(f.body || '').slice(0, 80) || 'untitled finding'}${at}`;
}

const list = (b, keys) => keys.flatMap((k) => (Array.isArray(b[k]) ? b[k] : []).map((p) => ({ k, p })));

/** Writes handback.md: disputed and unresolved findings and the human-only steps, numbered. */
export async function run(ctx) {
  const [first, again] = [buckets(ctx.steps.review?.buckets_abs), buckets(ctx.steps.rereview?.buckets_abs)];
  const unread = (b) => !b || ['codex_verdict', 'gemini_verdict'].some((k) => ['failed', 'unknown'].includes(b[k]));
  const missing = [['review', first], ['rereview', again]].filter(([, b]) => unread(b));
  const unparsed = [['review', first], ['rereview', again]].flatMap(([id, b]) => ['codex', 'gemini'].filter((e) => b?.[`${e}_unparsed`]).map((e) => [id, e]));
  const build = ctx.steps.build ?? {};
  const items = [
    ...missing.map(([id]) => ({ kind: 'human', text: `Review results missing for ${id}: read ${ctx.runDir}/${id}/` })),
    ...unparsed.map(([id, e]) => ({ kind: 'human', text: `${e} rejected in ${id} but its findings could not be read: read its output under ${ctx.runDir}/${id}/` })),
    ...[first, again].flatMap((b) => list(b ?? {}, ['unplaced'])).map(({ p }) => ({ kind: 'human', text: `${finding(p)}: could not be placed on a file and line, check it by hand` })),
    ...list(first ?? {}, ['disagree', 'codex_only', 'gemini_only']).map(({ k, p }) => ({ kind: 'disputed', text: `${finding(p)}: ${k === 'disagree' ? 'the engines disagree' : `only ${k.replace('_only', '')} found it`}` })),
    ...list(again ?? {}, ['both', 'disagree']).map(({ p }) => ({ kind: 'unresolved', text: `${finding(p)}: still found after the fix` })),
    ...(ctx.steps.reverify?.passed ? [] : [{ kind: 'human', text: `Tests fail after the fix (exit ${ctx.steps.reverify?.exit_code ?? '?'})` }]),
    { kind: 'human', text: `Review and commit the work in ${build.worktree ?? 'the worktree'} on ${build.branch ?? 'its branch'}` },
  ].map((x, i) => ({ n: i + 1, ...x }));
  const md = ['# Hand-back', '', ...items.map((x) => `${x.n}. [${x.kind}] ${x.text}`), ''].join('\n');
  await ctx.writeFile('handback.md', md);
  return { document: 'handback.md', count: items.length, items };
}
