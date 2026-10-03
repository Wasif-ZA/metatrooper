import fs from 'node:fs';
import path from 'node:path';

const WIDEN = 3;

function asFindings(value) {
  let list = value;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { list = []; }
  }
  return Array.isArray(list) ? list : [];
}

function overlaps(a, b) {
  return a.file === b.file
    && a.line_start - WIDEN <= b.line_end + WIDEN
    && b.line_start - WIDEN <= a.line_end + WIDEN;
}

/** Sorts two engines' findings into both, codex_only, gemini_only and disagree; picks no winner. */
export function bucketFindings(codex, gemini) {
  const buckets = { both: [], codex_only: [], gemini_only: [], disagree: [] };
  const used = new Set();
  const split = codex.verdict !== gemini.verdict && (codex.verdict === 'approve' || gemini.verdict === 'approve');
  for (const c of asFindings(codex.findings)) {
    const j = asFindings(gemini.findings).findIndex((g, i) => !used.has(i) && overlaps(c, g));
    if (j < 0) {
      buckets.codex_only.push({ codex: c });
      continue;
    }
    used.add(j);
    buckets[split ? 'disagree' : 'both'].push({ codex: c, gemini: asFindings(gemini.findings)[j] });
  }
  asFindings(gemini.findings).forEach((g, i) => { if (!used.has(i)) buckets.gemini_only.push({ gemini: g }); });
  return buckets;
}

/** The first JSON array of objects with a `file` key anywhere in the text, or null. */
export function findingsInText(text) {
  for (let i = text.indexOf('['); i >= 0; i = text.indexOf('[', i + 1)) {
    let depth = 0;
    for (let j = i; j < text.length; j++) {
      if (text[j] === '[') depth++;
      else if (text[j] === ']' && --depth === 0) {
        try {
          const list = JSON.parse(text.slice(i, j + 1));
          if (Array.isArray(list) && list.every((f) => f && typeof f === 'object' && 'file' in f)) return list;
        } catch {}
        break;
      }
    }
  }
  return null;
}

function withFindings(ctx, stepId) {
  const outputs = ctx.steps[stepId] ?? {};
  if (asFindings(outputs.findings).length) return outputs;
  let text = '';
  try { text = fs.readFileSync(path.join(ctx.runDir, `${stepId}.md`), 'utf8'); } catch {}
  return { ...outputs, findings: findingsInText(text) ?? [] };
}

export async function run(ctx) {
  const codex = withFindings(ctx, 'codex-review');
  const gemini = withFindings(ctx, 'gemini-review');
  const buckets = bucketFindings(codex, gemini);
  await ctx.writeFile('review-buckets.json', JSON.stringify({ codex_verdict: codex.verdict, gemini_verdict: gemini.verdict, ...buckets }, null, 2));
  return {
    codex_verdict: String(codex.verdict ?? 'unknown'),
    gemini_verdict: String(gemini.verdict ?? 'unknown'),
    both: buckets.both.length,
    codex_only: buckets.codex_only.length,
    gemini_only: buckets.gemini_only.length,
    disagree: buckets.disagree.length,
    buckets_path: 'review-buckets.json',
  };
}
