import fs from 'node:fs';
import path from 'node:path';

export const WIDEN = 3;

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

/** New-side line ranges per file, from each `@@ -a,b +c,d @@` hunk of a unified diff. */
export function hunkRanges(diff) {
  const ranges = new Map();
  let file = null;
  for (const line of diff.split(/\r?\n/)) {
    const f = /^\+\+\+ b\/(.+?)\t?$/.exec(line);
    if (f) { file = f[1]; continue; }
    if (line.startsWith('+++ ')) { file = null; continue; }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (h && file) {
      const start = Number(h[1]);
      const count = h[2] === undefined ? 1 : Number(h[2]);
      if (!ranges.has(file)) ranges.set(file, []);
      ranges.get(file).push([start, start + Math.max(count, 1) - 1]);
    }
  }
  return ranges;
}

function insideChange(f, ranges) {
  const list = ranges.get(f.file);
  return Boolean(list) && list.some(([a, b]) => f.line_start - WIDEN <= b && a <= f.line_end + WIDEN);
}

/** Canonical file and numeric line range, or null when the finding names no usable file or line. */
function normalise(f, root) {
  if (!f || typeof f.file !== 'string') return null;
  let file = f.file.trim().replace(/\\/g, '/');
  const base = root ? String(root).replace(/\\/g, '/').replace(/\/+$/, '') + '/' : '';
  if (base && file.toLowerCase().startsWith(base.toLowerCase())) file = file.slice(base.length);
  file = file.replace(/^(\.\/)+/, '');
  let start = Number(f.line_start ?? f.line);
  let end = Number(f.line_end ?? f.line_start ?? f.line);
  if (!file || /^([A-Za-z]:)?\//.test(file) || !Number.isFinite(start)) return null;
  if (!Number.isFinite(end)) end = start;
  if (start > end) [start, end] = [end, start];
  return { ...f, file, line_start: start, line_end: end };
}

/** Sorts two engines' findings into both, codex_only, gemini_only and disagree; picks no winner. With hunk ranges, findings outside the change go to outside_change unmatched; findings with no usable file or line go to unplaced. */
export function bucketFindings(codex, gemini, ranges = null, root = null) {
  const buckets = { both: [], codex_only: [], gemini_only: [], disagree: [], outside_change: [], unplaced: [] };
  const place = (engine, list) => asFindings(list).flatMap((f) => {
    const n = normalise(f, root);
    if (!n) buckets.unplaced.push({ [engine]: f });
    return n ? [n] : [];
  });
  const codexList = place('codex', codex.findings);
  const geminiList = place('gemini', gemini.findings);
  const used = new Set();
  const split = codex.verdict !== gemini.verdict && (codex.verdict === 'approve' || gemini.verdict === 'approve');
  const inside = (f) => !ranges || insideChange(f, ranges);
  geminiList.forEach((g, i) => { if (!inside(g)) { used.add(i); buckets.outside_change.push({ gemini: g }); } });
  for (const c of codexList) {
    if (!inside(c)) { buckets.outside_change.push({ codex: c }); continue; }
    const j = geminiList.findIndex((g, i) => !used.has(i) && overlaps(c, g));
    if (j < 0) {
      buckets.codex_only.push({ codex: c });
      continue;
    }
    used.add(j);
    buckets[split ? 'disagree' : 'both'].push({ codex: c, gemini: geminiList[j] });
  }
  geminiList.forEach((g, i) => { if (!used.has(i)) buckets.gemini_only.push({ gemini: g }); });
  return buckets;
}

/** The first JSON array of objects with a `file` key anywhere in the text, or null. */
export function findingsInText(text) {
  for (let i = text.indexOf('['); i >= 0; i = text.indexOf('[', i + 1)) {
    let depth = 0;
    let quoted = false;
    for (let j = i; j < text.length; j++) {
      if (quoted) { if (text[j] === '\\') j++; else if (text[j] === '"') quoted = false; } else if (text[j] === '"') quoted = true;
      else if (text[j] === '[') depth++;
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
  const parsed = findingsInText(text);
  return { ...outputs, findings: parsed ?? [], unparsed: parsed === null && outputs.verdict === 'reject' };
}

export async function run(ctx) {
  const codex = withFindings(ctx, 'codex-review');
  const gemini = withFindings(ctx, 'gemini-review');
  let ranges = null;
  try { ranges = hunkRanges(fs.readFileSync(String(ctx.steps.diff?.diff_file), 'utf8')); } catch {}
  if (ranges && !ranges.size) ranges = null;
  const buckets = bucketFindings(codex, gemini, ranges, ctx.inputs.path || ctx.projectPath);
  let n = 0;
  for (const k of ['both', 'codex_only', 'gemini_only', 'disagree']) buckets[k] = buckets[k].map((p) => ({ id: `f${++n}`, ...p }));
  await ctx.writeFile('review-buckets.json', JSON.stringify({ codex_verdict: codex.verdict, gemini_verdict: gemini.verdict, ...(codex.unparsed && { codex_unparsed: true }), ...(gemini.unparsed && { gemini_unparsed: true }), ...buckets }, null, 2));
  return {
    codex_verdict: String(codex.verdict ?? 'unknown'),
    gemini_verdict: String(gemini.verdict ?? 'unknown'),
    both: buckets.both.length,
    codex_only: buckets.codex_only.length,
    gemini_only: buckets.gemini_only.length,
    disagree: buckets.disagree.length,
    outside_change: buckets.outside_change.length,
    buckets_path: 'review-buckets.json',
    buckets_abs: path.join(ctx.runDir, 'review-buckets.json').replaceAll(path.sep, '/'),
  };
}
