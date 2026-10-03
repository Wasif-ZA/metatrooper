function asFindings(text) {
  try {
    const list = JSON.parse(text);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Writes qa-report.md from findings.json and the reverify result. */
export async function run(ctx) {
  const findings = asFindings(await ctx.readFile('findings.json').catch(() => '[]'));
  const verify = ctx.steps.reverify ?? {};
  const fixed = findings.filter((f) => f.fixed_by);
  const open = findings.filter((f) => !f.fixed_by);
  const line = (f) => `- **${f.severity}** ${f.title}${f.file ? ` (${f.file}${f.line ? `:${f.line}` : ''})` : ''}: ${f.detail}`;
  const md = [
    '# Browser QA report',
    '',
    `Branch: ${ctx.steps.qa?.branch ?? 'unknown'}. Tests after the fixes: ${verify.passed ? 'passed' : 'failed'} (exit ${verify.exit_code ?? '?'}).`,
    '',
    `## Fixed (${fixed.length})`,
    '',
    ...(fixed.length ? fixed.map(line) : ['None.']),
    '',
    `## Still open (${open.length})`,
    '',
    ...(open.length ? open.map(line) : ['None.']),
    '',
  ].join('\n');
  await ctx.writeFile('qa-report.md', md);
  return { document: 'qa-report.md', fixed: fixed.length, open: open.length, passed: Boolean(verify.passed) };
}
